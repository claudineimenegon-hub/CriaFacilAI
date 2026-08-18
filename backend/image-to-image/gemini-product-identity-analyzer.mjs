import {
  PRODUCT_IDENTITY_ANALYSIS_LIMITS,
  ProductIdentityAnalyzer,
  validateProductIdentityAnalysis,
} from './product-identity-analyzer.mjs';

export const DEFAULT_GEMINI_PRODUCT_IDENTITY_MODEL = 'gemini-2.5-flash-lite';
export const GEMINI_GENERATE_CONTENT_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_HTTP_RESPONSE_BYTES = 128 * 1024;

const stateSchema = { type: 'string', enum: ['known', 'uncertain', 'unknown'] };
const nullableString = { type: ['string', 'null'] };
const evidenceStringSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { state: stateSchema, value: nullableString },
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
      type: 'array', maxItems: PRODUCT_IDENTITY_ANALYSIS_LIMITS.items,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' },
          functionalType: evidenceStringSchema,
          quantity: evidenceQuantitySchema,
          observationCompleteness: {
            type: 'string', enum: ['complete', 'partial', 'unknown'],
          },
          observedFeatures: {
            type: 'array', maxItems: PRODUCT_IDENTITY_ANALYSIS_LIMITS.observedFeaturesPerItem,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string' }, name: { type: 'string' }, value: { type: 'string' },
              },
              required: ['name', 'value'],
            },
          },
          ambiguousFeatures: {
            type: 'array', maxItems: PRODUCT_IDENTITY_ANALYSIS_LIMITS.ambiguousFeaturesPerItem,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string' }, name: { type: 'string' },
                visibility: { type: 'string', enum: ['partial', 'hidden'] },
                observedConstraint: nullableString,
                plausibleHypotheses: {
                  type: 'array', maxItems: PRODUCT_IDENTITY_ANALYSIS_LIMITS.hypothesesPerFeature,
                  items: { type: 'string' },
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
      type: 'array', maxItems: PRODUCT_IDENTITY_ANALYSIS_LIMITS.relationships,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          type: { type: 'string' },
          memberIds: { type: 'array', maxItems: 16, items: { type: 'string' } },
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
  constructor(code, message) {
    super(message);
    this.name = 'GeminiProductIdentityAnalyzerError';
    this.code = code;
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

export class GeminiProductIdentityAnalyzer extends ProductIdentityAnalyzer {
  constructor({
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.PRODUCT_IDENTITY_ANALYZER_MODEL ??
      DEFAULT_GEMINI_PRODUCT_IDENTITY_MODEL,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    logger,
  } = {}) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
  }

  get isConfigured() {
    return typeof this.apiKey === 'string' && this.apiKey.trim().length > 0;
  }

  async analyze({ inputs, declaredCategory, userBrief, cacheKey } = {}) {
    void cacheKey;
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
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const endpoint = `${GEMINI_GENERATE_CONTENT_BASE_URL}/${encodeURIComponent(this.model)}:generateContent`;
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
          ...inputs.map(({ bytes, mimeType }) => ({
            inlineData: { mimeType, data: Buffer.from(bytes).toString('base64') },
          })),
        ],
      }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseJsonSchema: GEMINI_PRODUCT_IDENTITY_RESPONSE_SCHEMA,
      },
    };
    let outcome = { status: null, fallback: true };
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
      outcome.status = response.status;
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
        throw new GeminiProductIdentityAnalyzerError(
          'GEMINI_HTTP_ERROR', 'Product identity provider request failed.',
        );
      }
      let payload;
      let analysis;
      try {
        payload = JSON.parse(rawResponse);
        analysis = JSON.parse(responseText(payload));
      } catch {
        throw new GeminiProductIdentityAnalyzerError(
          'GEMINI_INVALID_JSON', 'Product identity provider returned invalid JSON.',
        );
      }
      const validated = validateProductIdentityAnalysis(analysis);
      outcome = {
        status: response.status,
        fallback: false,
        state: validated.state,
        items: validated.items.length,
        relationships: validated.relationships.length,
      };
      return validated;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new GeminiProductIdentityAnalyzerError(
          'GEMINI_TIMEOUT', 'Product identity provider timed out.',
        );
      }
      if (error instanceof GeminiProductIdentityAnalyzerError ||
          error?.code === 'INVALID_PRODUCT_IDENTITY_ANALYSIS') throw error;
      throw new GeminiProductIdentityAnalyzerError(
        'GEMINI_NETWORK_ERROR', 'Product identity provider request failed.',
      );
    } finally {
      clearTimeout(timeout);
      this.logger?.info?.({
        component: 'ProductIdentityAnalyzer',
        provider: 'gemini',
        model: this.model,
        status: outcome.status,
        latencyMs: Math.round(performance.now() - startedAt),
        inputCount: inputs.length,
        inputs: sanitizedInputMetadata(inputs),
        state: outcome.state,
        items: outcome.items,
        relationships: outcome.relationships,
        fallback: outcome.fallback,
      });
    }
  }
}

