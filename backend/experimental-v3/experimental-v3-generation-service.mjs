import { compileCreativeDirectorV3ImagePrompt } from '../benchmark/creative-director-v3-image-prompt-compiler.mjs';
import { createOpenAICreativeDirectorV3Adapter } from '../benchmark/creative-director-v3-openai-adapter.mjs';
import { runCreativeDirectorV3WithFailSafe } from '../benchmark/creative-director-v3-execution.mjs';
import { V3_CAMPAIGN_ROLES } from '../benchmark/creative-director-v3.mjs';
import { createOpenAIGPTImageBenchmarkProvider } from '../benchmark/openai-gpt-image-benchmark-provider.mjs';
import { validateProductIdentityAnalysis } from '../image-to-image/product-identity-analyzer.mjs';

const CATEGORY_SEMANTICS = Object.freeze({
  food: ['consumable', ['tabletop service', 'culinary preparation']],
  beverages: ['consumable', ['tabletop service', 'refreshment moment']],
  clothing: ['wearable', ['valid body placement', 'wardrobe display']],
  jewelry: ['wearable', ['valid body placement', 'luxury display']],
  cosmetics: ['handheld', ['beauty ritual', 'vanity display']],
  electronics: ['digital_or_screen_based', ['functional use', 'creative workspace']],
  automotive: ['vehicle_or_mobility', ['road', 'architectural exterior']],
  environment: ['architectural', ['interior environment', 'architectural setting']],
  person: ['unknown_safe_context', ['portrait setting']],
  general: ['surface_supported', ['commercial studio', 'plausible real-world setting']],
});

const ALLOWED_CATEGORIES = new Set(Object.keys(CATEGORY_SEMANTICS));
const ALLOWED_QUALITIES = new Set(['medium', 'high']);
const ALLOWED_RATIOS = new Set(['1:1', '4:5', '9:16', '16:9']);
const STRUCTURAL_FEATURE_PATTERN = /\b(?:closure|clasp|connector|attachment|fasten(?:er|ing)?|buckle|hinge|extension chain|extender|cap|fecho|fechamento|conector|engate|fixa(?:ção|cao)|fivela|dobradiça|dobradica|corrente extensora|extensor|tampa)\b/i;
const defaultLogger = process.env.NODE_TEST_CONTEXT ? undefined : Object.freeze({
  info(event) { console.info(`[ExperimentalV3] ${JSON.stringify(event)}`); },
});

export class ExperimentalV3ValidationError extends Error {
  constructor(message, { code = 'INVALID_EXPERIMENTAL_V3_REQUEST', status = 400 } = {}) {
    super(message);
    this.name = 'ExperimentalV3ValidationError';
    this.code = code;
    this.status = status;
  }
}

function requiredText(value, field, maxLength = 1000) {
  if (typeof value !== 'string' || value.trim().length < 2 || value.length > maxLength) {
    throw new ExperimentalV3ValidationError(`Campo inválido: ${field}.`);
  }
  return value.trim();
}

export function validateExperimentalV3Request(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ExperimentalV3ValidationError('Solicitação experimental inválida.');
  }
  const inputAssetId = requiredText(payload.inputAssetId, 'inputAssetId', 64);
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(inputAssetId)) {
    throw new ExperimentalV3ValidationError('Imagem de referência inválida.', { code: 'INVALID_ASSET_ID' });
  }
  if (!ALLOWED_CATEGORIES.has(payload.category)) {
    throw new ExperimentalV3ValidationError('Categoria inválida.', { code: 'INVALID_CATEGORY' });
  }
  if (!ALLOWED_RATIOS.has(payload.aspectRatio)) {
    throw new ExperimentalV3ValidationError('Proporção inválida.', { code: 'INVALID_ASPECT_RATIO' });
  }
  const quality = payload.quality ?? 'medium';
  if (!ALLOWED_QUALITIES.has(quality)) {
    throw new ExperimentalV3ValidationError('Qualidade inválida.', { code: 'INVALID_QUALITY' });
  }
  return Object.freeze({
    inputAssetId,
    category: payload.category,
    objective: requiredText(payload.objective, 'objective', 300),
    description: typeof payload.description === 'string' ? payload.description.trim().slice(0, 1000) : '',
    aspectRatio: payload.aspectRatio,
    quality,
  });
}

function evidenceValue(evidence, fallback) {
  return evidence?.state !== 'unknown' && evidence?.value != null ? evidence.value : fallback;
}

export function buildCreativeDirectorV3Input({ analysis, request }) {
  const identity = validateProductIdentityAnalysis(analysis);
  if (identity.state === 'unknown' || identity.items.length === 0) {
    throw new ExperimentalV3ValidationError(
      'A análise do produto ainda não está configurada para o modo experimental.',
      { code: 'PRODUCT_ANALYSIS_REQUIRED', status: 503 },
    );
  }
  const items = identity.items.map((item) => {
    const functionalType = evidenceValue(item.functionalType);
    const quantity = evidenceValue(item.quantity);
    if (typeof functionalType !== 'string' || !Number.isSafeInteger(quantity) || quantity < 1) {
      throw new ExperimentalV3ValidationError(
        'Não foi possível confirmar tipo e quantidade do produto.',
        { code: 'PRODUCT_IDENTITY_UNCERTAIN', status: 422 },
      );
    }
    return { id: item.id, functionalType, quantity };
  });
  const knownIds = new Set(items.map(({ id }) => id));
  const relationships = identity.relationships
    .filter(({ state, memberIds }) => state !== 'unknown' && memberIds.every((id) => knownIds.has(id)))
    .map(({ type, memberIds }) => ({ type, itemIds: [...memberIds] }));
  const observedFeatures = identity.items.flatMap((item) =>
    item.observedFeatures.map((feature) => `${item.id}: ${feature.name}=${feature.value}`));
  const ambiguousFeatures = identity.items.flatMap((item) =>
    item.ambiguousFeatures.map((feature) => `${item.id}: ${feature.name} is ${feature.visibility}`));
  const observedFeatureEvidence = identity.items.flatMap((item) =>
    item.observedFeatures.map((feature) => ({
      itemId: item.id,
      ...(feature.id == null ? {} : { featureId: feature.id }),
      name: feature.name,
      value: feature.value,
    })));
  const ambiguousFeatureEvidence = identity.items.flatMap((item) =>
    item.ambiguousFeatures.map((feature) => ({
      itemId: item.id,
      ...(feature.id == null ? {} : { featureId: feature.id }),
      name: feature.name,
      visibility: feature.visibility,
      observedConstraint: feature.observedConstraint,
      plausibleHypotheses: [...feature.plausibleHypotheses],
      certainty: 'ambiguous',
    })));
  const criticalFeatures = observedFeatureEvidence
    .filter(({ name, value }) => STRUCTURAL_FEATURE_PATTERN.test(`${name} ${value}`))
    .map((feature) => ({ ...feature, evidence: 'observed' }));
  const relativeScale = (identity.relativeScale ?? [])
    .map(({ subjectId, referenceId, relation, confidence }) => ({
      subjectId, referenceId, relation, confidence,
    }));
  const [primaryAffordance, validContexts] = CATEGORY_SEMANTICS[request.category];
  return {
    productIdentity: {
      category: request.category,
      items,
      relationships,
      observedFeatures,
      ambiguousFeatures,
      observedFeatureEvidence,
      ambiguousFeatureEvidence,
      criticalFeatures,
      relativeScale,
    },
    productSemantics: {
      functionalType: items.map(({ functionalType }) => functionalType).join(' and '),
      affordances: [primaryAffordance],
      validContexts,
      invalidContexts: ['physically implausible use', 'unrelated body placement'],
    },
    userIntent: {
      objective: request.objective,
      aspectRatio: request.aspectRatio,
      requestedStyle: request.objective,
      additionalInstructions: request.description || null,
    },
    generationPolicy: { proposalCount: 4, targetQuality: request.quality, creativeFreedom: 'high' },
  };
}

export function experimentalOutputDimensions(aspectRatio) {
  if (aspectRatio === '1:1') return { width: 1024, height: 1024 };
  if (aspectRatio === '16:9') return { width: 1536, height: 1024 };
  return { width: 1024, height: 1536 };
}

function safeVisualError(error) {
  const allowed = new Set([
    'PROVIDER_NOT_CONFIGURED', 'UPSTREAM_TIMEOUT', 'UPSTREAM_HTTP_ERROR',
    'UPSTREAM_NETWORK_ERROR', 'INVALID_PROVIDER_RESPONSE', 'INVALID_OUTPUT_IMAGE',
  ]);
  return allowed.has(error?.code) ? error.code : 'VISUAL_GENERATION_FAILED';
}

export function createExperimentalV3GenerationService({
  assetStore,
  productIdentityAnalyzer,
  creativeDirectorAdapterFactory = (sourceImage) => createOpenAICreativeDirectorV3Adapter({ sourceImage }),
  runCreativeDirector = runCreativeDirectorV3WithFailSafe,
  imageProvider = createOpenAIGPTImageBenchmarkProvider(),
  logger,
} = {}) {
  const effectiveLogger = logger ?? defaultLogger ?? { info() {} };
  return Object.freeze({
    async generate(rawRequest) {
      const request = validateExperimentalV3Request(rawRequest);
      const asset = await assetStore?.readImage(request.inputAssetId);
      if (!asset) {
        throw new ExperimentalV3ValidationError('Imagem não encontrada ou expirada.', {
          code: 'ASSET_NOT_FOUND', status: 404,
        });
      }
      const source = Object.freeze({ bytes: Buffer.from(asset.bytes), mimeType: asset.mimeType, metadata: asset.metadata });
      if (!productIdentityAnalyzer || productIdentityAnalyzer.isConfigured === false) {
        throw new ExperimentalV3ValidationError(
          'A análise do produto ainda não está configurada para o modo experimental.',
          { code: 'PRODUCT_ANALYSIS_REQUIRED', status: 503 },
        );
      }
      const analysis = await productIdentityAnalyzer.analyze({
        inputs: [source], declaredCategory: request.category,
        userBrief: [request.objective, request.description].filter(Boolean).join('. '),
        cacheKey: asset.metadata?.hash ?? request.inputAssetId,
      });
      const input = buildCreativeDirectorV3Input({ analysis, request });
      const direction = await runCreativeDirector({
        input,
        modelAdapter: creativeDirectorAdapterFactory(source),
        logger: effectiveLogger,
      });
      const briefs = direction.briefs;
      const dimensions = experimentalOutputDimensions(request.aspectRatio);
      const results = [];
      for (let start = 0; start < briefs.length; start += 2) {
        const batch = briefs.slice(start, start + 2).map(async (brief) => {
          const visibleItemIds = [...new Set([
            ...brief.productPresentation.requiredVisibleItems,
            ...brief.productPresentation.optionalVisibleItems,
          ].map(({ itemId }) => itemId))];
          const visible = new Set(visibleItemIds);
          const countByItem = (features) => Object.fromEntries(input.productIdentity.items.map(({ id }) => [
            id, features.filter(({ itemId }) => itemId === id).length,
          ]));
          effectiveLogger.info({
            component: 'ExperimentalV3ProposalInventory',
            campaignRole: brief.campaignRole,
            visibleItemIds,
            omittedItemIds: input.productIdentity.items.map(({ id }) => id).filter((id) => !visible.has(id)),
            featureCountByItem: countByItem(input.productIdentity.observedFeatureEvidence),
            criticalFeatureCountByItem: countByItem(input.productIdentity.criticalFeatures),
            relativeScaleRelationCount: input.productIdentity.relativeScale.length,
            visibilityMode: brief.visibilityIntent.mode,
            pairPolicy: brief.visibilityIntent.pairPolicy,
            humanInteractionMode: brief.humanInteraction.mode,
          });
          const prompt = compileCreativeDirectorV3ImagePrompt({
            brief, productIdentity: input.productIdentity,
            productSemantics: input.productSemantics, userIntent: input.userIntent,
          });
          try {
            const image = await imageProvider.generate({
              prompt, inputs: [source],
              parameters: { common: {}, provider: { quality: request.quality } },
              preservation: {}, output: { ...dimensions, count: 1 },
            });
            return { campaignRole: brief.campaignRole, status: 'completed', imageBase64: image.imageBase64 };
          } catch (error) {
            return { campaignRole: brief.campaignRole, status: 'error', errorCode: safeVisualError(error) };
          }
        });
        results.push(...await Promise.all(batch));
      }
      if (results.length !== 4 || V3_CAMPAIGN_ROLES.some((role) => !results.some((item) => item.campaignRole === role))) {
        throw new Error('INVALID_EXPERIMENTAL_V3_RESULT');
      }
      return {
        expectedCount: 4,
        status: results.every((item) => item.status === 'completed') ? 'completed' : 'partial',
        quality: request.quality,
        results,
      };
    },
  });
}
