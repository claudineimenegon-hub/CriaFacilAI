import {
  canonicalizeProductIdentityEnum,
  PRODUCT_IDENTITY_ENUMS,
  ProductIdentityAnalyzer,
  validateProductIdentityAnalysis,
} from './product-identity-analyzer.mjs';
import { prepareGeminiAnalysisImages } from './gemini-analysis-preprocessor.mjs';

export const DEFAULT_GEMINI_PRODUCT_IDENTITY_MODEL = 'gemini-3.5-flash-lite';
export const GEMINI_GENERATE_CONTENT_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';
export const GEMINI_PRODUCT_IDENTITY_TIMEOUT_MS = 60_000;
export const GEMINI_PRODUCT_IDENTITY_MAX_ATTEMPTS = 2;
export const GEMINI_PRODUCT_IDENTITY_CACHE_TTL_MS = 5 * 60_000;
export const GEMINI_PRODUCT_IDENTITY_CACHE_MAX_ENTRIES = 100;
export const GEMINI_PRODUCT_IDENTITY_CACHE_KEY_VERSION = 'product-identity-v3-policy-1';
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
          visualLocalization: {
            type: 'object',
            properties: {
              normalizedBoundingBox: {
                type: 'object',
                properties: {
                  xMin: { type: 'number' }, yMin: { type: 'number' },
                  xMax: { type: 'number' }, yMax: { type: 'number' },
                },
                required: ['xMin', 'yMin', 'xMax', 'yMax'],
              },
              positivePoints: {
                type: 'array', items: { type: 'object', properties: {
                  x: { type: 'number' }, y: { type: 'number' },
                }, required: ['x', 'y'] },
              },
              optionalNegativePoints: {
                type: 'array', items: { type: 'object', properties: {
                  x: { type: 'number' }, y: { type: 'number' },
                }, required: ['x', 'y'] },
              },
              localizationConfidence: { type: 'number' },
              evidenceSource: { type: 'string' },
            },
            required: ['normalizedBoundingBox', 'positivePoints', 'optionalNegativePoints',
              'localizationConfidence', 'evidenceSource'],
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
  `Use state exactly one of ${PRODUCT_IDENTITY_ENUMS.state.join(', ')}. Unknown inventory must contain no items or relationships.`,
  `Use observationCompleteness exactly one of ${PRODUCT_IDENTITY_ENUMS.observationCompleteness.join(', ')}.`,
  `For ambiguous feature visibility, use exactly one of ${PRODUCT_IDENTITY_ENUMS.ambiguousFeatureVisibility.join(', ')}.`,
  'Keep items generic and individually addressable. This policy applies to every product category.',
  'For every confidently localized canonical item, include visualLocalization with a normalized [0,1] bounding box, one or more positive points inside only that item, optional negative points on nearby different items, localizationConfidence, and evidenceSource="multimodal_analysis". Omit visualLocalization when the item cannot be localized unambiguously. Localization is only segmentation evidence and never changes identity, quantity, or components.',
  'When clearly visible, record small structural or functional components as observedFeatures linked to their canonical item, including clasps, extenders, connectors, closures, joints, hooks, buckles, straps, hinges, fasteners, terminals, attachments, and equivalent visible functional connections. Do not invent hidden components, promote ambiguous micro-details, or require a component that lacks sufficient visual evidence.',
  `When at least two canonical items have a robust source-visible size relationship, optionally report relativeScale using their exact IDs, relation exactly one of ${PRODUCT_IDENTITY_ENUMS.relativeScaleRelation.join(', ')}, and confidence exactly one of ${PRODUCT_IDENTITY_ENUMS.relativeScaleConfidence.join(', ')}. Omit unknown or uncertain comparisons and never estimate physical measurements.`,
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

function safeEnumToken(value) {
  if (typeof value !== 'string') return undefined;
  const token = value.trim();
  return token.length > 0 && token.length <= 40 && /^[A-Za-z0-9 _-]+$/.test(token)
    ? token : undefined;
}

function normalizeStructuredAnalysis(value) {
  let normalized = value;
  let applied = false;
  const invalidEnums = [];
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
    return { analysis: normalized, applied, invalidEnums };
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
  const normalizeEnum = (object, key, enumName, path) => {
    if (!object || typeof object !== 'object' || Array.isArray(object) ||
        typeof object[key] !== 'string') return;
    const canonical = canonicalizeProductIdentityEnum(enumName, object[key]);
    if (canonical === undefined) {
      invalidEnums.push(Object.freeze({
        path,
        ...(safeEnumToken(object[key]) ? { receivedEnumToken: safeEnumToken(object[key]) } : {}),
      }));
      return;
    }
    if (canonical !== object[key]) applied = true;
    object[key] = canonical;
  };
  rename(clone, 'items', ['products']);
  rename(clone, 'relationships', ['relations']);
  normalizeEnum(clone, 'state', 'state', 'analysis.state');
  if (Array.isArray(clone.items)) {
    for (const [itemIndex, item] of clone.items.entries()) {
      rename(item, 'functionalType', ['functional_type']);
      rename(item, 'observationCompleteness', ['observation_completeness']);
      rename(item, 'observedFeatures', ['observed_features']);
      rename(item, 'ambiguousFeatures', ['ambiguous_features']);
      normalizeEnum(item?.functionalType, 'state', 'state', `items[${itemIndex}].functionalType.state`);
      normalizeEnum(item?.quantity, 'state', 'state', `items[${itemIndex}].quantity.state`);
      normalizeEnum(item, 'observationCompleteness', 'observationCompleteness',
        `items[${itemIndex}].observationCompleteness`);
      if (Array.isArray(item?.ambiguousFeatures)) {
        for (const [featureIndex, feature] of item.ambiguousFeatures.entries()) {
          rename(feature, 'observedConstraint', ['observed_constraint']);
          rename(feature, 'plausibleHypotheses', ['plausible_hypotheses']);
          normalizeEnum(feature, 'visibility', 'ambiguousFeatureVisibility',
            `items[${itemIndex}].ambiguousFeatures[${featureIndex}].visibility`);
        }
      }
    }
  }
  if (Array.isArray(clone.relationships)) {
    for (const [relationshipIndex, relationship] of clone.relationships.entries()) {
      rename(relationship, 'memberIds', ['member_ids', 'itemIds', 'item_ids']);
      normalizeEnum(relationship, 'state', 'state', `relationships[${relationshipIndex}].state`);
    }
  }
  if (Array.isArray(clone.relativeScale)) {
    clone.relativeScale = clone.relativeScale.filter((comparison, comparisonIndex) => {
      if (!comparison || typeof comparison !== 'object' || Array.isArray(comparison)) return true;
      rename(comparison, 'subjectId', ['subject_id']);
      rename(comparison, 'referenceId', ['reference_id']);
      normalizeEnum(comparison, 'relation', 'relativeScaleRelation',
        `relativeScale[${comparisonIndex}].relation`);
      normalizeEnum(comparison, 'confidence', 'relativeScaleConfidence',
        `relativeScale[${comparisonIndex}].confidence`);
      if (!PRODUCT_IDENTITY_ENUMS.relativeScaleRelation.includes(comparison.relation) ||
          !PRODUCT_IDENTITY_ENUMS.relativeScaleConfidence.includes(comparison.confidence)) {
        applied = true;
        return false;
      }
      return true;
    });
  }
  return { analysis: clone, applied, invalidEnums };
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
  else if (/state is invalid|observationCompleteness is invalid|visibility is invalid|relativeScale\[\d+\]\.(?:relation|confidence) is invalid/.test(message)) {
    validationReason = 'invalid_enum';
  } else if (/unknown|Unknown analysis/.test(message)) validationReason = 'invalid_unknown_value';
  else if (/must be|is required|is invalid/.test(message)) validationReason = 'invalid_structure';
  const field = message.match(/^(analysis\.state|items\[\d+\]\.(?:functionalType\.state|quantity\.state|observationCompleteness|ambiguousFeatures\[\d+\]\.visibility)|relationships\[\d+\]\.state|relativeScale\[\d+\]\.(?:relation|confidence)) is invalid\./)?.[1];
  let enumName;
  if (field?.endsWith('.state') || field === 'analysis.state') enumName = 'state';
  else if (field?.endsWith('.observationCompleteness')) enumName = 'observationCompleteness';
  else if (field?.endsWith('.visibility')) enumName = 'ambiguousFeatureVisibility';
  else if (field?.endsWith('.relation')) enumName = 'relativeScaleRelation';
  else if (field?.endsWith('.confidence')) enumName = 'relativeScaleConfidence';
  return {
    validationStage: 'schema_validation', validationReason,
    ...(field && enumName ? {
      validationField: field,
      allowedEnumValues: PRODUCT_IDENTITY_ENUMS[enumName],
    } : {}),
  };
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

function abortError() {
  const error = new Error('Operation aborted.');
  error.name = 'AbortError';
  return error;
}

function defaultBackoff(ms, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(abortError());
    }, { once: true });
  });
}

function transientRetryReason(error) {
  if (error?.code === 'GEMINI_TIMEOUT') return 'GEMINI_TIMEOUT';
  if (error?.code !== 'GEMINI_HTTP_ERROR') return undefined;
  if ([429, 502, 503, 504].includes(error.statusHttp)) return `HTTP_${error.statusHttp}`;
  if (error.upstreamStatus === 'UNAVAILABLE') return 'UPSTREAM_UNAVAILABLE';
  return undefined;
}

function safeValidatedCopy(analysis) {
  return validateProductIdentityAnalysis(structuredClone(analysis));
}

export class GeminiProductIdentityAnalyzer extends ProductIdentityAnalyzer {
  constructor({
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.PRODUCT_IDENTITY_ANALYZER_MODEL ??
      DEFAULT_GEMINI_PRODUCT_IDENTITY_MODEL,
    fetchImpl = globalThis.fetch,
    timeoutMs = GEMINI_PRODUCT_IDENTITY_TIMEOUT_MS,
    prepareInputs = prepareGeminiAnalysisImages,
    backoff = defaultBackoff,
    random = Math.random,
    cacheTtlMs = GEMINI_PRODUCT_IDENTITY_CACHE_TTL_MS,
    cacheMaxEntries = GEMINI_PRODUCT_IDENTITY_CACHE_MAX_ENTRIES,
    now = Date.now,
    logger,
  } = {}) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.prepareInputs = prepareInputs;
    this.backoff = backoff;
    this.random = random;
    this.cacheTtlMs = cacheTtlMs;
    this.cacheMaxEntries = cacheMaxEntries;
    this.now = now;
    this.logger = logger;
    this.successCache = new Map();
    this.inFlight = new Map();
  }

  get isConfigured() {
    return typeof this.apiKey === 'string' && this.apiKey.trim().length > 0;
  }

  async analyze(options = {}) {
    const sourceHash = typeof options.cacheKey === 'string' && /^[a-f0-9]{64}$/i.test(options.cacheKey)
      ? options.cacheKey : undefined;
    if (!sourceHash) return this.#analyzeUncached(options, { cacheHit: false, inFlightShared: false });
    const compositeKey = `${GEMINI_PRODUCT_IDENTITY_CACHE_KEY_VERSION}:${this.model}:${sourceHash}`;
    const cached = this.successCache.get(compositeKey);
    if (cached && cached.expiresAt > this.now()) {
      this.logger?.info?.({
        component: 'ProductIdentityAnalyzer', provider: 'gemini', model: this.model,
        errorCode: null, statusHttp: null, timeoutMs: this.timeoutMs, latencyMs: 0,
        totalLatencyMs: 0, attempt: 0, maxAttempts: GEMINI_PRODUCT_IDENTITY_MAX_ATTEMPTS,
        retryUsed: false, retryReason: null, backoffMs: 0, cacheHit: true,
        cacheKeyVersion: GEMINI_PRODUCT_IDENTITY_CACHE_KEY_VERSION, inFlightShared: false,
        state: cached.analysis.state, items: cached.analysis.items.length,
        relationships: cached.analysis.relationships.length, fallback: false,
      });
      return safeValidatedCopy(cached.analysis);
    }
    if (cached) this.successCache.delete(compositeKey);
    const active = this.inFlight.get(compositeKey);
    if (active) {
      this.logger?.info?.({
        component: 'ProductIdentityAnalyzer', provider: 'gemini', model: this.model,
        errorCode: null, statusHttp: null, timeoutMs: this.timeoutMs, latencyMs: 0,
        totalLatencyMs: 0, attempt: 0, maxAttempts: GEMINI_PRODUCT_IDENTITY_MAX_ATTEMPTS,
        retryUsed: false, retryReason: null, backoffMs: 0, cacheHit: false,
        cacheKeyVersion: GEMINI_PRODUCT_IDENTITY_CACHE_KEY_VERSION, inFlightShared: true,
      });
      return safeValidatedCopy(await active);
    }
    const pending = this.#analyzeUncached(options, { cacheHit: false, inFlightShared: false })
      .then((analysis) => {
        const stored = safeValidatedCopy(analysis);
        this.successCache.set(compositeKey, {
          analysis: stored, expiresAt: this.now() + this.cacheTtlMs,
        });
        while (this.successCache.size > this.cacheMaxEntries) {
          this.successCache.delete(this.successCache.keys().next().value);
        }
        return stored;
      })
      .finally(() => this.inFlight.delete(compositeKey));
    this.inFlight.set(compositeKey, pending);
    return safeValidatedCopy(await pending);
  }

  async #analyzeUncached({
    inputs, declaredCategory, userBrief, signal,
  } = {}, cacheTelemetry = {}) {
    const startedAt = performance.now();
    const endpoint = `${GEMINI_GENERATE_CONTENT_BASE_URL}/${encodeURIComponent(this.model)}:generateContent`;
    let outcome = { statusHttp: null, fallback: true };
    let terminalError;
    let preparedInputs;
    let attemptCount = 0;
    let normalizationApplied = false;
    let retryUsed = false;
    let retryReason = null;
    let backoffMs = 0;
    let fallbackUsed = false;
    const attemptDiagnostics = [];
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
      for (let attempt = 1; attempt <= GEMINI_PRODUCT_IDENTITY_MAX_ATTEMPTS; attempt += 1) {
        attemptCount = attempt;
        const controller = new AbortController();
        const onExternalAbort = () => controller.abort();
        signal?.addEventListener('abort', onExternalAbort, { once: true });
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
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
        try {
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
            { statusHttp: response.status },
          );
          Object.assign(httpError, diagnostics);
          throw httpError;
        }
        let attemptNormalizationApplied = false;
        let invalidEnums = [];
        try {
          const payload = JSON.parse(rawResponse);
          const parsed = parseStructuredAnalysis(responseText(payload));
          const normalized = normalizeStructuredAnalysis(parsed.value);
          invalidEnums = normalized.invalidEnums;
          attemptNormalizationApplied = parsed.applied || normalized.applied;
          normalizationApplied ||= attemptNormalizationApplied;
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
          const diagnostics = validationDiagnostics(recoverableError);
          const invalidEnum = diagnostics.validationField
            ? invalidEnums.find(({ path }) => path === diagnostics.validationField) : undefined;
          attemptDiagnostics.push(Object.freeze({
            attempt,
            validationField: diagnostics.validationField ?? 'response',
            validationReason: diagnostics.validationReason ??
              (recoverableError.code === 'GEMINI_INVALID_JSON' ? 'invalid_json' : 'other_allowlisted_reason'),
            retryUsed: false,
            normalizationApplied: attemptNormalizationApplied,
            ...(invalidEnum?.receivedEnumToken
              ? { receivedEnumToken: invalidEnum.receivedEnumToken } : {}),
          }));
          throw recoverableError;
        }
        } catch (error) {
          let attemptError = error;
          if (error?.name === 'AbortError') {
            attemptError = new GeminiProductIdentityAnalyzerError(
              'GEMINI_TIMEOUT', 'Product identity provider timed out.',
            );
          }
          const reason = transientRetryReason(attemptError);
          if (reason && attempt < GEMINI_PRODUCT_IDENTITY_MAX_ATTEMPTS && !signal?.aborted) {
            retryUsed = true;
            retryReason = reason;
            backoffMs = Math.round(1_500 + Math.max(0, Math.min(1, this.random())) * 1_500);
            clearTimeout(timeout);
            signal?.removeEventListener('abort', onExternalAbort);
            await this.backoff(backoffMs, { signal });
            continue;
          }
          throw attemptError;
        } finally {
          clearTimeout(timeout);
          signal?.removeEventListener('abort', onExternalAbort);
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
      const event = {
        component: 'ProductIdentityAnalyzer',
        provider: 'gemini',
        model: this.model,
        errorCode: terminalError?.code ?? null,
        statusHttp: outcome.statusHttp,
        timeoutMs: this.timeoutMs,
        latencyMs: Math.round(performance.now() - startedAt),
        totalLatencyMs: Math.round(performance.now() - startedAt),
        inputCount: Array.isArray(inputs) ? inputs.length : 0,
        inputs: Array.isArray(preparedInputs) ? sanitizedInputMetadata(preparedInputs) : [],
        state: outcome.state ?? 'unknown',
        items: outcome.items ?? 0,
        relationships: outcome.relationships ?? 0,
        fallback: outcome.fallback,
        attempt: attemptCount,
        maxAttempts: GEMINI_PRODUCT_IDENTITY_MAX_ATTEMPTS,
        normalizationApplied,
        retryUsed,
        retryReason,
        backoffMs,
        cacheHit: cacheTelemetry.cacheHit === true,
        cacheKeyVersion: GEMINI_PRODUCT_IDENTITY_CACHE_KEY_VERSION,
        inFlightShared: cacheTelemetry.inFlightShared === true,
        fallbackUsed,
        finalState: outcome.state ?? 'unknown',
        itemCount: outcome.items ?? 0,
        relationshipCount: outcome.relationships ?? 0,
        ...(attemptDiagnostics.length ? { attemptDiagnostics } : {}),
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
