import { prepareGeminiAnalysisImages } from './gemini-analysis-preprocessor.mjs';
import {
  compileVisibilityExpectation,
  ProductFidelityGuard,
  uncertainProductFidelityResult,
  validateProductFidelityGuardResult,
} from './product-fidelity-guard.mjs';
import {
  DEFAULT_GEMINI_PRODUCT_IDENTITY_MODEL,
  GEMINI_GENERATE_CONTENT_BASE_URL,
} from './gemini-product-identity-analyzer.mjs';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_HTTP_RESPONSE_BYTES = 64 * 1024;

export const GEMINI_PRODUCT_FIDELITY_GUARD_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    verdict: { type: 'string' },
    violations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          itemId: { type: ['string', 'null'] },
          confidence: { type: 'string' },
        },
        required: ['code', 'itemId', 'confidence'],
      },
    },
  },
  required: ['verdict', 'violations'],
});

const instruction = [
  'Perform only objective product fidelity verification.',
  'Canonical identity is fact. Fidelity constraints are rules. Visibility expectation defines what this proposal must show.',
  'Compare source reference media with the generated proposal. Do not reconstruct identity or reinterpret visibility intent.',
  'Judge only functional type, count, known pair/set relationships, unexpected product-like items, evident cross-item structural mutation, contextual physical scale when a reliable body/environment reference exists, and observed material appearance when visually verifiable.',
  'Do not judge beauty, style, creativity, composition, setting, sophistication, or taste.',
  'Insufficient visual evidence, occlusion, crop, macro framing, uncertain relationships, unknown quantities, or unverifiable material/scale require uncertain rather than fail.',
  'Only a high-confidence contradiction of a known applicable expectation may be fail.',
  'Props, displays, pedestals, boxes, and scenery are not unexpected products unless clearly product-like and noncanonical.',
  'Return only the requested JSON.',
].join(' ');

function responseText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? parts.find((part) => typeof part?.text === 'string')?.text : undefined;
}

function generatedInput(generatedImage) {
  if (typeof generatedImage?.imageBase64 !== 'string' ||
      !['image/png', 'image/jpeg'].includes(generatedImage?.mimeType)) {
    throw new TypeError('Generated guard image is invalid.');
  }
  const bytes = Buffer.from(generatedImage.imageBase64, 'base64');
  if (bytes.length === 0) throw new TypeError('Generated guard image is invalid.');
  return { bytes, mimeType: generatedImage.mimeType };
}

function guardFacts({ canonicalIdentity, fidelityConstraints, visibilityExpectation }) {
  return {
    canonicalItems: (canonicalIdentity?.sourceInventory?.items ?? []).map((item) => ({
      id: item.id,
      functionalType: item.functionalType,
      quantity: item.quantity,
      observedFeatures: item.observedFeatures.map(({ id, name, value }) => ({ id, name, value })),
      canonicalHiddenHypotheses: item.ambiguousFeatures.map(({ id, canonicalHypothesis }) => ({
        id, value: canonicalHypothesis.value, confidence: canonicalHypothesis.confidence,
      })),
    })),
    relationships: canonicalIdentity?.sourceInventory?.relationships ?? [],
    itemLocks: fidelityConstraints?.itemLocks ?? [],
    relationshipLocks: fidelityConstraints?.relationshipLocks ?? [],
    globalLocks: fidelityConstraints?.globalLocks ?? {},
    materialAppearance: fidelityConstraints?.materialAppearance ?? [],
    visibilityExpectation,
  };
}

export class GeminiProductFidelityGuard extends ProductFidelityGuard {
  constructor({
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.PRODUCT_FIDELITY_GUARD_MODEL ?? DEFAULT_GEMINI_PRODUCT_IDENTITY_MODEL,
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

  async inspect(input = {}) {
    const startedAt = performance.now();
    let statusHttp = null;
    let fallback = true;
    let result = uncertainProductFidelityResult();
    try {
      if (!this.isConfigured) throw new Error('PRODUCT_FIDELITY_GUARD_NOT_CONFIGURED');
      const visibilityExpectation = compileVisibilityExpectation(input);
      const preparedSources = await this.prepareInputs(input.sourceInputs);
      const preparedGenerated = await this.prepareInputs([generatedInput(input.generatedImage)]);
      const facts = guardFacts({ ...input, visibilityExpectation });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response;
      try {
        response = await this.fetchImpl(
          `${GEMINI_GENERATE_CONTENT_BASE_URL}/${encodeURIComponent(this.model)}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
            body: JSON.stringify({
              contents: [{
                role: 'user',
                parts: [
                  { text: `${instruction}\nFIDELITY FACTS: ${JSON.stringify(facts)}\nSOURCE REFERENCES:` },
                  ...preparedSources.map(({ bytes, mimeType }) => ({
                    inlineData: { mimeType, data: Buffer.from(bytes).toString('base64') },
                  })),
                  { text: 'GENERATED PROPOSAL TO VERIFY:' },
                  ...preparedGenerated.map(({ bytes, mimeType }) => ({
                    inlineData: { mimeType, data: Buffer.from(bytes).toString('base64') },
                  })),
                ],
              }],
              generationConfig: {
                responseFormat: {
                  text: { mimeType: 'APPLICATION_JSON', schema: GEMINI_PRODUCT_FIDELITY_GUARD_SCHEMA },
                },
              },
            }),
            signal: controller.signal,
          },
        );
      } finally {
        clearTimeout(timeout);
      }
      statusHttp = response.status;
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_HTTP_RESPONSE_BYTES || !response.ok) {
        throw new Error('PRODUCT_FIDELITY_GUARD_UPSTREAM_ERROR');
      }
      const payload = JSON.parse(raw);
      result = validateProductFidelityGuardResult(
        JSON.parse(responseText(payload)), input.canonicalIdentity,
        { fidelityConstraints: input.fidelityConstraints, visibilityExpectation },
      );
      fallback = false;
      return result;
    } catch {
      return result;
    } finally {
      this.logger?.info?.({
        component: 'ProductFidelityGuard',
        provider: 'gemini',
        model: this.model,
        proposalIndex: Number.isInteger(input.proposalIndex) ? input.proposalIndex : null,
        guardAttempt: Number.isInteger(input.guardAttempt) ? input.guardAttempt : 0,
        verdict: result.verdict,
        violationCodes: result.violations.map(({ code }) => code),
        repairAttempt: Number.isInteger(input.repairAttempt) ? input.repairAttempt : 0,
        statusHttp,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        fallback,
      });
    }
  }
}
