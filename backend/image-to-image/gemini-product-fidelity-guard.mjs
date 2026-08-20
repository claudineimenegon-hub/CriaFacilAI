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
  'Before deciding: (1) identify every product-like object in the generated image; (2) map each visible object to an exact canonical itemId when possible; (3) compare visible quantities with visibilityExpectation; (4) detect product-like objects that cannot map to canonical inventory; (5) compare every known functionalType; (6) verify required relationships.',
  'Copy itemId exactly from canonicalItems. Never use a descriptive name or functionalType as itemId and never invent an ID. Use itemId null only for unexpected_item when a noncanonical object has no canonical ID.',
  'A known canonical functionalType visibly appearing as another functional type is type_mismatch. Features or structures merged or transferred between canonical items are structural_mutation. A product-like object with no canonical match is unexpected_item. Applicable codes may coexist.',
  'When visibilityStrictness is contextual and the generated image visibly places a product on or beside anatomy such as a finger, hand, ear, neck, foot, face, or body, use that anatomy as a valid scale reference even when the source image has no body. Clearly implausible oversizing or undersizing is high-confidence contextual_scale. Macro framing without reliable anatomy or environmental scale remains uncertain.',
  'Allowed verdict values are pass, fail, uncertain. Allowed confidence values are high, medium, low. Allowed violation codes are type_mismatch, count_mismatch, relationship_violation, unexpected_item, structural_mutation, contextual_scale, material_appearance.',
  'Return only the requested JSON.',
].join(' ');

function technicalResult(fallbackReason, validationReason, input) {
  return uncertainProductFidelityResult({
    fallback: true,
    fallbackReason,
    validationReason,
    verificationStatus: input?.inspectionRetryAttempt === 1 ? 'unverified' : 'technical_fallback',
  });
}

function taggedError(fallbackReason, validationReason) {
  const error = new Error('PRODUCT_FIDELITY_GUARD_DIAGNOSTIC');
  error.fallbackReason = fallbackReason;
  error.validationReason = validationReason ?? null;
  return error;
}

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
    let result = technicalResult('unexpected_error', null, input);
    try {
      if (!this.isConfigured) throw taggedError('not_configured');
      const visibilityExpectation = compileVisibilityExpectation(input);
      let preparedSources;
      let preparedGenerated;
      try {
        preparedSources = await this.prepareInputs(input.sourceInputs);
        preparedGenerated = await this.prepareInputs([generatedInput(input.generatedImage)]);
      } catch {
        throw taggedError('input_preparation');
      }
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
      } catch (error) {
        throw taggedError(error?.name === 'AbortError' ? 'timeout' : 'network_error');
      } finally {
        clearTimeout(timeout);
      }
      statusHttp = response.status;
      let raw;
      try {
        raw = await response.text();
      } catch {
        throw taggedError('response_read_error');
      }
      if (Buffer.byteLength(raw, 'utf8') > MAX_HTTP_RESPONSE_BYTES) {
        throw taggedError('response_too_large');
      }
      if (!response.ok) throw taggedError('upstream_http');
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw taggedError('invalid_envelope_json');
      }
      const text = responseText(payload);
      if (typeof text !== 'string') throw taggedError('missing_response_text');
      let parsedResult;
      try {
        parsedResult = JSON.parse(text);
      } catch {
        throw taggedError('invalid_result_json');
      }
      try {
        result = validateProductFidelityGuardResult(
          parsedResult, input.canonicalIdentity,
          { fidelityConstraints: input.fidelityConstraints, visibilityExpectation },
        );
      } catch (error) {
        throw taggedError('invalid_guard_result', error?.validationReason);
      }
      fallback = false;
      return result;
    } catch (error) {
      result = technicalResult(
        error?.fallbackReason ?? 'unexpected_error', error?.validationReason ?? null, input,
      );
      return result;
    } finally {
      this.logger?.info?.({
        component: 'ProductFidelityGuard',
        provider: 'gemini',
        model: this.model,
        proposalIndex: Number.isInteger(input.proposalIndex) ? input.proposalIndex : null,
        guardAttempt: Number.isInteger(input.guardAttempt) ? input.guardAttempt : 0,
        inspectionRetryAttempt: Number.isInteger(input.inspectionRetryAttempt)
          ? input.inspectionRetryAttempt : 0,
        verdict: result.verdict,
        violationCodes: result.violations.map(({ code }) => code),
        repairAttempt: Number.isInteger(input.repairAttempt) ? input.repairAttempt : 0,
        statusHttp,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        fallback: result.fallback ?? fallback,
        fallbackReason: result.fallbackReason ?? null,
        validationReason: result.validationReason ?? null,
        verificationStatus: result.verificationStatus,
      });
    }
  }
}
