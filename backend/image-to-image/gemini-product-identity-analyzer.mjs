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
const STATES = ['known', 'uncertain', 'unknown'];
const COMPLETENESS_VALUES = ['complete', 'partial', 'unknown'];
const VISIBILITY_VALUES = ['partial', 'hidden'];
const TOKEN_CHARACTERS = 120;

// Keep the provider-facing shape aligned with the local validator. Cross-field
// invariants (for example relationship membership) remain locally authoritative.
const tokenString = { type: 'string', minLength: 1, maxLength: TOKEN_CHARACTERS };
const optionalTokenString = { type: ['string', 'null'], maxLength: TOKEN_CHARACTERS };
const stateSchema = { type: 'string', enum: STATES };
const evidenceStringSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { state: stateSchema, value: optionalTokenString },
  required: ['state', 'value'],
};
const evidenceQuantitySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    state: stateSchema,
    value: { type: ['integer', 'null'], minimum: 1, maximum: 1000 },
  },
  required: ['state', 'value'],
};

export const GEMINI_PRODUCT_IDENTITY_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    state: stateSchema,
    items: {
      type: 'array',
      maxItems: 16,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: tokenString,
          functionalType: evidenceStringSchema,
          quantity: evidenceQuantitySchema,
          observationCompleteness: { type: 'string', enum: COMPLETENESS_VALUES },
          observedFeatures: {
            type: 'array',
            maxItems: 16,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: tokenString, name: tokenString, value: tokenString,
              },
              required: ['name', 'value'],
            },
          },
          ambiguousFeatures: {
            type: 'array',
            maxItems: 12,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: tokenString, name: tokenString,
                visibility: { type: 'string', enum: VISIBILITY_VALUES },
                observedConstraint: optionalTokenString,
                plausibleHypotheses: {
                  type: 'array',
                  maxItems: 4,
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
      maxItems: 16,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: tokenString,
          memberIds: { type: 'array', minItems: 1, maxItems: 16, items: tokenString },
          state: stateSchema,
        },
        required: ['type', 'memberIds', 'state'],
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
  return JSON.parse(fenced ? fenced[1] : trimmed);
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

  async analyze({ inputs, declaredCategory, userBrief, cacheKey } = {}) {
    void cacheKey;
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const endpoint = `${GEMINI_GENERATE_CONTENT_BASE_URL}/${encodeURIComponent(this.model)}:generateContent`;
    let outcome = { statusHttp: null, fallback: true };
    let terminalError;
    let preparedInputs;
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
      const requestBody = {
        contents: [{
          role: 'user',
          parts: [
            {
              text: [
                analysisInstruction,
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
      let payload;
      let analysis;
      try {
        payload = JSON.parse(rawResponse);
        analysis = parseStructuredAnalysis(responseText(payload));
      } catch {
        throw new GeminiProductIdentityAnalyzerError(
          'GEMINI_INVALID_JSON', 'Product identity provider returned invalid JSON.',
        );
      }
      const validated = validateProductIdentityAnalysis(analysis);
      outcome = {
        statusHttp: response.status,
        fallback: false,
        state: validated.state,
        items: validated.items.length,
        relationships: validated.relationships.length,
      };
      return validated;
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
