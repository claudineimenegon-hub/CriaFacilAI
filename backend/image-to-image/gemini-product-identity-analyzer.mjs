import {
  ProductIdentityAnalyzer,
  validateProductIdentityAnalysis,
} from './product-identity-analyzer.mjs';
import { prepareGeminiAnalysisImages } from './gemini-analysis-preprocessor.mjs';

export const DEFAULT_GEMINI_PRODUCT_IDENTITY_MODEL = 'gemini-3.5-flash-lite';
export const GEMINI_GENERATE_CONTENT_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_HTTP_RESPONSE_BYTES = 128 * 1024;
// The Gemini response schema intentionally contains only its supported structural
// subset. All limits, enums and cross-field invariants remain locally authoritative.
const tokenString = { type: 'string' };
const optionalTokenString = { type: 'string', nullable: true };
const stateSchema = { type: 'string' };
const evidenceStringSchema = {
  type: 'object',
  properties: { state: stateSchema, value: optionalTokenString },
  required: ['state', 'value'],
};
const evidenceQuantitySchema = {
  type: 'object',
  properties: {
    state: stateSchema,
    value: { type: 'integer', nullable: true },
  },
  required: ['state', 'value'],
};

export const GEMINI_PRODUCT_IDENTITY_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    state: stateSchema,
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: tokenString,
          functionalType: evidenceStringSchema,
          quantity: evidenceQuantitySchema,
          observationCompleteness: { type: 'string' },
          observedFeatures: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: tokenString, name: tokenString, value: tokenString,
              },
              required: ['name', 'value'],
            },
          },
          ambiguousFeatures: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: tokenString, name: tokenString,
                visibility: { type: 'string' },
                observedConstraint: optionalTokenString,
                plausibleHypotheses: {
                  type: 'array',
                  items: tokenString,
                },
              },
              required: [
                'name', 'visibility', 'observedConstraint', 'plausibleHypotheses',
              ],
            },
          },
        },
        required: [
          'id', 'functionalType', 'quantity', 'observationCompleteness',
          'observedFeatures', 'ambiguousFeatures',
        ],
      },
    },
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: tokenString,
          memberIds: { type: 'array', items: tokenString },
          state: stateSchema,
        },
        required: ['type', 'memberIds', 'state'],
      },
    },
    relativeScale: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subjectId: tokenString,
          referenceId: tokenString,
          relation: tokenString,
          confidence: tokenString,
        },
        required: ['subjectId', 'referenceId', 'relation', 'confidence'],
      },
    },
  },
  required: ['state', 'items', 'relationships'],
});

const analysisInstruction = [
  'Analyze the reference media only for commercially relevant product identity evidence.',
  'Return only the requested JSON structure.',
  'Record only actually visible traits as observedFeatures.',
  'Record unsafe-to-determine or hidden traits as ambiguousFeatures.',
  'Never promote an inference to observed fact. Never invent inventory, quantity, type, geometry, branding, or relationships.',
  'Use known, uncertain, or unknown conservatively. Unknown inventory must contain no items or relationships.',
  'Keep items generic and individually addressable. This policy applies to every product category.',
  'When at least two canonical items have a robust source-visible size relationship, optionally report relativeScale using their exact IDs, one of slightly_larger, approximately_same, clearly_larger, or significantly_smaller, and a conservative confidence. Omit uncertain comparisons and never estimate physical measurements.',
].join(' ');

export class GeminiProductIdentityAnalyzerError extends Error {
  constructor(code, message, { statusHttp = null } = {}) {
    super(message);
    this.name = 'GeminiProductIdentityAnalyzerError';
    this.code = code;
    this.statusHttp = Number.isInteger(statusHttp) ? statusHttp : null;
  }
}

function sanitizedInputMetadata(inputs) {
  return inputs.map(({ bytes, mimeType, metadata }) => ({
    mimeType,
    bytes: bytes.length,
    width: Number.isInteger(metadata?.width) ? metadata.width : undefined,
    height: Number.isInteger(metadata?.height) ? metadata.height : undefined,
  }));
}

function responseText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return undefined;
  return parts.find((part) => typeof part?.text === 'string')?.text;
}

function parseStructuredAnalysis(text) {
  if (typeof text !== 'string') throw new SyntaxError('Missing structured output.');
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return { value: JSON.parse(fenced ? fenced[1] : trimmed), applied: Boolean(fenced) };
}

function normalizeStructuredAnalysis(value) {
  let normalized = value;
  let applied = false;
  if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
    const keys = Object.keys(normalized);
    const wrapper = ['analysis', 'productIdentityAnalysis', 'result']
      .find((key) => keys.length === 1 && normalized[key] &&
        typeof normalized[key] === 'object' && !Array.isArray(normalized[key]));
    if (wrapper) {
      normalized = normalized[wrapper];
      applied = true;
    }
  }
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    return { analysis: normalized, applied };
  }
  const clone = structuredClone(normalized);
  const rename = (object, canonical, aliases) => {
    if (!object || typeof object !== 'object' || Array.isArray(object) ||
        Object.hasOwn(object, canonical)) return;
    const alias = aliases.find((name) => Object.hasOwn(object, name));
    if (!alias) return;
    object[canonical] = object[alias];
    delete object[alias];
    applied = true;
  };
  rename(clone, 'items', ['products']);
  rename(clone, 'relationships', ['relations']);
  if (Array.isArray(clone.items)) {
    for (const item of clone.items) {
      rename(item, 'functionalType', ['functional_type']);
      rename(item, 'observationCompleteness', ['observation_completeness']);
      rename(item, 'observedFeatures', ['observed_features']);
      rename(item, 'ambiguousFeatures', ['ambiguous_features']);
      if (Array.isArray(item?.ambiguousFeatures)) {
        for (const feature of item.ambiguousFeatures) {
          rename(feature, 'observedConstraint', ['observed_constraint']);
          rename(feature, 'plausibleHypotheses', ['plausible_hypotheses']);
        }
      }
    }
  }
  if (Array.isArray(clone.relationships)) {
    for (const relationship of clone.relationships) {
      rename(relationship, 'memberIds', ['member_ids', 'itemIds', 'item_ids']);
    }
  }
  return { analysis: clone, applied };
}

function isSafeFallbackAnalysis(analysis) {
  return analysis.state !== 'unknown' && analysis.items.length > 0 && analysis.items.every((item) =>
    item.functionalType.state !== 'unknown' && typeof item.functionalType.value === 'string' &&
    item.quantity.state !== 'unknown' && Number.isSafeInteger(item.quantity.value) &&
    item.quantity.value > 0);
}

function validationDiagnostics(error) {
  if (error?.code !== 'INVALID_PRODUCT_IDENTITY_ANALYSIS') return {};
  const message = typeof error.message === 'string' ? error.message : '';
  let validationReason = 'other_allowlisted_reason';
  if (/is not allowed/.test(message)) validationReason = 'additional_property';
  else if (/Item IDs must be unique/.test(message)) validationReason = 'duplicate_item_id';
  else if (/references an unknown item|memberIds is invalid/.test(message)) {
    validationReason = 'invalid_relationship';
  } else if (/quantity.*integer|quantity.*value/.test(message)) validationReason = 'invalid_quantity';
  else if (/state is invalid|observationCompleteness is invalid|visibility is invalid/.test(message)) {
    validationReason = 'invalid_enum';
  } else if (/unknown|Unknown analysis/.test(message)) validationReason = 'invalid_unknown_value';
  else if (/must be|is required|is invalid/.test(message)) validationReason = 'invalid_structure';
  return { validationStage: 'schema_validation', validationReason };
}

function safeDiagnosticText(value, maxLength = 240) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!normalized || /data:|base64|authorization|api[ _-]?key|x-goog-api-key/i.test(normalized) ||
      /[A-Za-z0-9+/_=-]{40,}/.test(normalized)) return undefined;
  return normalized.slice(0, maxLength);
}

function safeGeminiUpstreamDiagnostics(rawResponse) {
  try {
    const upstreamError = JSON.parse(rawResponse)?.error;
    const upstreamStatus = typeof upstreamError?.status === 'string' &&
      /^[A-Z][A-Z0-9_]{0,63}$/.test(upstreamError.status)
      ? upstreamError.status : undefined;
    const fieldViolations = (Array.isArray(upstreamError?.details) ? upstreamError.details : [])
      .flatMap((detail) => Array.isArray(detail?.fieldViolations) ? detail.fieldViolations : [])
      .slice(0, 8)
      .map((violation) => {
        const field = typeof violation?.field === 'string' &&
          /^[A-Za-z0-9_.\[\]-]{1,240}$/.test(violation.field)
          ? violation.field : undefined;
        const description = safeDiagnosticText(violation?.description);
        return field ? { field, ...(description ? { description } : {}) } : undefined;
      })
      .filter(Boolean);
    return {
      upstreamMessage: safeDiagnosticText(upstreamError?.message),
      upstreamStatus,
      fieldViolations,
    };
  } catch {
    return { upstreamMessage: undefined, upstreamStatus: undefined, fieldViolations: [] };
  }
}

export class GeminiProductIdentityAnalyzer extends ProductIdentityAnalyzer {
  constructor({
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.PRODUCT_IDENTITY_ANALYZER_MODEL ??
      DEFAULT_GEMINI_PRODUCT_IDENTITY_MODEL,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    prepareInputs = prepareGeminiAnalysisImages,
    logger,
  } = {}) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.prepareInputs = prepareInputs;
    this.logger = logger;
  }

  get isConfigured() {
    return typeof this.apiKey === 'string' && this.apiKey.trim().length > 0;
  }

  async analyze({ inputs, declaredCategory, userBrief, cacheKey, fallbackAnalysis } = {}) {
    void cacheKey;
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const endpoint = `${GEMINI_GENERATE_CONTENT_BASE_URL}/${encodeURIComponent(this.model)}:generateContent`;
    let outcome = { statusHttp: null, fallback: true };
    let terminalError;
    let preparedInputs;
    let attemptCount = 0;
    let normalizationApplied = false;
    let retryUsed = false;
    let fallbackUsed = false;
    try {
      if (!this.isConfigured) {
        throw new GeminiProductIdentityAnalyzerError(
          'GEMINI_NOT_CONFIGURED', 'Product identity perception is not configured.',
        );
      }
      if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 4) {
        throw new GeminiProductIdentityAnalyzerError(
          'INVALID_ANALYZER_INPUT', 'Product identity analyzer inputs are invalid.',
        );
      }
      try {
        preparedInputs = await this.prepareInputs(inputs);
      } catch {
        throw new GeminiProductIdentityAnalyzerError(
          'INVALID_ANALYZER_INPUT', 'Product identity analyzer inputs are invalid.',
        );
      }
      let recoverableError;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        attemptCount = attempt;
        const requestBody = {
          contents: [{
            role: 'user',
            parts: [
              {
                text: [
                  analysisInstruction,
                  ...(attempt === 2 ? [
                    'Technical correction: return exactly the schema fields and types; do not wrap, rename, add, or omit fields.',
                  ] : []),
                  `Declared category (context only, not evidence): ${String(declaredCategory ?? 'unknown').slice(0, 80)}`,
                  `User brief (context only, not evidence): ${String(userBrief ?? '').slice(0, 4000)}`,
                ].join('\n'),
              },
              ...preparedInputs.map(({ bytes, mimeType }) => ({
                inlineData: { mimeType, data: Buffer.from(bytes).toString('base64') },
              })),
            ],
          }],
          generationConfig: {
            responseFormat: {
              text: {
                mimeType: 'APPLICATION_JSON',
                schema: GEMINI_PRODUCT_IDENTITY_RESPONSE_SCHEMA,
              },
            },
          },
        };
        const response = await this.fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
        outcome.statusHttp = response.status;
        const contentLength = Number(response.headers?.get?.('content-length'));
        if (Number.isFinite(contentLength) && contentLength > MAX_HTTP_RESPONSE_BYTES) {
          throw new GeminiProductIdentityAnalyzerError(
            'GEMINI_RESPONSE_TOO_LARGE', 'Product identity response exceeded the safe limit.',
          );
        }
        const rawResponse = await response.text();
        if (Buffer.byteLength(rawResponse, 'utf8') > MAX_HTTP_RESPONSE_BYTES) {
          throw new GeminiProductIdentityAnalyzerError(
            'GEMINI_RESPONSE_TOO_LARGE', 'Product identity response exceeded the safe limit.',
          );
        }
        if (!response.ok) {
          const diagnostics = safeGeminiUpstreamDiagnostics(rawResponse);
          const httpError = new GeminiProductIdentityAnalyzerError(
            'GEMINI_HTTP_ERROR', 'Product identity provider request failed.',
          );
          Object.assign(httpError, diagnostics);
          throw httpError;
        }
        try {
          const payload = JSON.parse(rawResponse);
          const parsed = parseStructuredAnalysis(responseText(payload));
          const normalized = normalizeStructuredAnalysis(parsed.value);
          normalizationApplied ||= parsed.applied || normalized.applied;
          const validated = validateProductIdentityAnalysis(normalized.analysis);
          outcome = {
            statusHttp: response.status,
            fallback: false,
            state: validated.state,
            items: validated.items.length,
            relationships: validated.relationships.length,
          };
          return validated;
        } catch (error) {
          recoverableError = error?.code === 'INVALID_PRODUCT_IDENTITY_ANALYSIS'
            ? error
            : new GeminiProductIdentityAnalyzerError(
              'GEMINI_INVALID_JSON', 'Product identity provider returned invalid JSON.',
            );
          if (attempt === 1) {
            retryUsed = true;
            continue;
          }
        }
      }
      if (fallbackAnalysis !== undefined) {
        try {
          const validatedFallback = validateProductIdentityAnalysis(fallbackAnalysis);
          if (isSafeFallbackAnalysis(validatedFallback)) {
            fallbackUsed = true;
            outcome = {
              statusHttp: outcome.statusHttp,
              fallback: true,
              state: validatedFallback.state,
              items: validatedFallback.items.length,
              relationships: validatedFallback.relationships.length,
            };
            return validatedFallback;
          }
        } catch {
          // Invalid or incomplete evidence is never promoted into a product identity.
        }
      }
      throw recoverableError;
    } catch (error) {
      let normalizedError;
      if (error?.name === 'AbortError') {
        normalizedError = new GeminiProductIdentityAnalyzerError(
          'GEMINI_TIMEOUT', 'Product identity provider timed out.',
        );
      } else if (error instanceof GeminiProductIdentityAnalyzerError ||
          error?.code === 'INVALID_PRODUCT_IDENTITY_ANALYSIS') {
        normalizedError = error;
      } else {
        normalizedError = new GeminiProductIdentityAnalyzerError(
          'GEMINI_NETWORK_ERROR', 'Product identity provider request failed.',
        );
      }
      normalizedError.statusHttp = Number.isInteger(outcome.statusHttp)
        ? outcome.statusHttp : normalizedError.statusHttp ?? null;
      normalizedError.provider = 'gemini';
      normalizedError.model = this.model;
      normalizedError.latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      Object.assign(normalizedError, validationDiagnostics(normalizedError));
      terminalError = normalizedError;
      throw normalizedError;
    } finally {
      clearTimeout(timeout);
      const event = {
        component: 'ProductIdentityAnalyzer',
        provider: 'gemini',
        model: this.model,
        errorCode: terminalError?.code ?? null,
        statusHttp: outcome.statusHttp,
        latencyMs: Math.round(performance.now() - startedAt),
        inputCount: Array.isArray(inputs) ? inputs.length : 0,
        inputs: Array.isArray(preparedInputs) ? sanitizedInputMetadata(preparedInputs) : [],
        state: outcome.state ?? 'unknown',
        items: outcome.items ?? 0,
        relationships: outcome.relationships ?? 0,
        fallback: outcome.fallback,
        attempt: attemptCount,
        normalizationApplied,
        retryUsed,
        fallbackUsed,
        finalState: outcome.state ?? 'unknown',
        itemCount: outcome.items ?? 0,
        relationshipCount: outcome.relationships ?? 0,
        ...(terminalError?.validationStage
          ? { validationStage: terminalError.validationStage } : {}),
        ...(terminalError?.validationReason
          ? { validationReason: terminalError.validationReason } : {}),
        ...(terminalError?.upstreamMessage
          ? { upstreamMessage: terminalError.upstreamMessage } : {}),
        ...(terminalError?.upstreamStatus
          ? { upstreamStatus: terminalError.upstreamStatus } : {}),
        ...(terminalError?.fieldViolations?.length
          ? { fieldViolations: terminalError.fieldViolations } : {}),
      };
      if (this.logger?.info) {
        this.logger.info(event);
        if (terminalError) terminalError.diagnosticLogged = true;
      }
    }
  }
}
