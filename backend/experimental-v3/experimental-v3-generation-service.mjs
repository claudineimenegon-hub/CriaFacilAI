import {
  compileCreativeDirectorV3ImagePrompt,
  deriveProposalUnitAllocation,
} from '../benchmark/creative-director-v3-image-prompt-compiler.mjs';
import { createOpenAICreativeDirectorV3Adapter } from '../benchmark/creative-director-v3-openai-adapter.mjs';
import { runCreativeDirectorV3WithFailSafe } from '../benchmark/creative-director-v3-execution.mjs';
import {
  editorialDetailPurposeValid,
  V3_CAMPAIGN_ROLES,
} from '../benchmark/creative-director-v3.mjs';
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
const ASSET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const VISUAL_SOURCE_KINDS = new Set(['full_set', 'isolated_item']);
const ISOLATION_STATES = new Set(['isolated', 'contaminated', 'unknown']);
const STRUCTURAL_FEATURE_PATTERN = /\b(?:closure|clasp|connector|attachment|fasten(?:er|ing)?|buckle|strap|hinge|hook|joint|terminal|extension chain|extender|cap|fecho|fechamento|conector|engate|fixa(?:ção|cao)|fivela|alça|alca|dobradiça|dobradica|gancho|junta|junção|juncao|terminal|corrente extensora|extensor|tampa)\b/i;
const WEARABLE_FUNCTIONAL_TYPE_PATTERN = /\b(?:ear(?:ring)?|auricular|neck(?:lace)?|upper[ -]?torso|collar|pendant|finger|hand[ -]?worn|ring|wrist|watch|bracelet|bangle|face|head[ -]?worn|eyewear|glasses|spectacles|foot(?:wear)?|shoe|boot|sneaker|wearable|garment|clothing|apparel|dress|shirt|trouser|jacket|body[ -]?compatible)\b/i;
const defaultLogger = process.env.NODE_TEST_CONTEXT ? undefined : Object.freeze({
  info(event) { console.info(`[ExperimentalV3] ${JSON.stringify(event)}`); },
});

export class ExperimentalV3ValidationError extends Error {
  constructor(message, { code = 'INVALID_EXPERIMENTAL_V3_REQUEST', status = 400, details } = {}) {
    super(message);
    this.name = 'ExperimentalV3ValidationError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function validateCanonicalVisualAssetBinding(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExperimentalV3ValidationError(`Referência canônica inválida: ${index}.`);
  }
  const canonicalItemId = requiredText(value.canonicalItemId, `canonicalVisualAssets[${index}].canonicalItemId`, 120);
  const assetId = requiredText(value.assetId, `canonicalVisualAssets[${index}].assetId`, 64);
  if (!ASSET_ID_PATTERN.test(assetId) || !VISUAL_SOURCE_KINDS.has(value.sourceKind) ||
      !ISOLATION_STATES.has(value.isolationState) || !SHA256_PATTERN.test(value.sha256) ||
      !['image/jpeg', 'image/png'].includes(value.mimeType) ||
      !Number.isSafeInteger(value.width) || value.width < 1 ||
      !Number.isSafeInteger(value.height) || value.height < 1 ||
      typeof value.userConfirmed !== 'boolean' ||
      typeof value.isolationConfidence !== 'number' || value.isolationConfidence < 0 ||
      value.isolationConfidence > 1) {
    throw new ExperimentalV3ValidationError(`Referência canônica inválida: ${index}.`, {
      code: 'INVALID_CANONICAL_VISUAL_ASSET',
    });
  }
  if (value.sourceKind === 'isolated_item' &&
      (value.isolationState !== 'isolated' || value.userConfirmed !== true)) {
    throw new ExperimentalV3ValidationError('A referência isolada precisa ser confirmada pelo usuário.', {
      code: 'INVALID_CANONICAL_VISUAL_ASSET',
    });
  }
  return Object.freeze({
    canonicalItemId, assetId, sourceKind: value.sourceKind,
    isolationState: value.isolationState, isolationConfidence: value.isolationConfidence,
    userConfirmed: value.userConfirmed, mimeType: value.mimeType,
    width: value.width, height: value.height, sha256: value.sha256.toLowerCase(),
  });
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
  if (!ASSET_ID_PATTERN.test(inputAssetId)) {
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
    canonicalVisualAssets: Object.freeze((payload.canonicalVisualAssets ?? [])
      .map(validateCanonicalVisualAssetBinding)),
  });
}

function selectedIdsForReferences(brief, productIdentity) {
  if (brief.campaignRole === 'hero_commercial') {
    return productIdentity.items.map(({ id }) => id);
  }
  if (brief.campaignRole !== 'contextual_lifestyle') {
    return [...new Set([
      ...brief.productPresentation.requiredVisibleItems,
      ...brief.productPresentation.optionalVisibleItems,
    ].map(({ itemId }) => itemId))];
  }
  const allocation = deriveProposalUnitAllocation({ brief, productIdentity });
  return allocation
    .filter(({ humanAllocated, sceneAllocated }) => humanAllocated + sceneAllocated > 0)
    .map(({ itemId }) => itemId);
}

async function resolveCampaignReferences({
  brief, productIdentity, request, source, assetStore, logger,
}) {
  const selectedCanonicalItemIds = selectedIdsForReferences(brief, productIdentity);
  if (productIdentity.items.length === 1 || brief.campaignRole === 'hero_commercial') {
    logger?.info?.({
      component: 'ExperimentalV3CanonicalReferences', campaignRole: brief.campaignRole,
      selectedCanonicalItemIds, referenceCanonicalItemIds: selectedCanonicalItemIds,
      referenceCount: 1, isolationStates: ['contaminated'], providerCallBlocked: false,
    });
    return [source];
  }
  const isolated = request.canonicalVisualAssets.filter(({ sourceKind, isolationState, userConfirmed }) =>
    sourceKind === 'isolated_item' && isolationState === 'isolated' && userConfirmed);
  const byItem = new Map();
  for (const binding of isolated) {
    if (byItem.has(binding.canonicalItemId) ||
        [...byItem.values()].some(({ assetId }) => assetId === binding.assetId)) {
      throw new ExperimentalV3ValidationError('Referência canônica duplicada.', {
        code: 'INVALID_CANONICAL_VISUAL_ASSET',
      });
    }
    byItem.set(binding.canonicalItemId, binding);
  }
  const missingCanonicalItemIds = selectedCanonicalItemIds.filter((id) => !byItem.has(id));
  if (missingCanonicalItemIds.length) {
    const details = Object.freeze({
      campaignRole: brief.campaignRole,
      missingCanonicalItemIds,
      reason: 'isolated_item_required',
    });
    logger?.info?.({
      component: 'ExperimentalV3CanonicalReferences', campaignRole: brief.campaignRole,
      selectedCanonicalItemIds, referenceCanonicalItemIds: [], referenceCount: 0,
      isolationStates: [], providerCallBlocked: true,
    });
    throw new ExperimentalV3ValidationError('São necessárias referências isoladas para esta campanha.', {
      code: 'CANONICAL_REFERENCE_REQUIRED', status: 409, details,
    });
  }
  const references = [];
  for (const canonicalItemId of selectedCanonicalItemIds) {
    const binding = byItem.get(canonicalItemId);
    const asset = await assetStore.readImage(binding.assetId);
    if (!asset || asset.metadata?.hash !== binding.sha256 ||
        asset.mimeType !== binding.mimeType || asset.metadata?.width !== binding.width ||
        asset.metadata?.height !== binding.height) {
      throw new ExperimentalV3ValidationError('Referência canônica inválida ou expirada.', {
        code: 'INVALID_CANONICAL_VISUAL_ASSET',
      });
    }
    references.push({ bytes: Buffer.from(asset.bytes), mimeType: asset.mimeType, metadata: asset.metadata });
  }
  logger?.info?.({
    component: 'ExperimentalV3CanonicalReferences', campaignRole: brief.campaignRole,
    selectedCanonicalItemIds, referenceCanonicalItemIds: selectedCanonicalItemIds,
    referenceCount: references.length, isolationStates: selectedCanonicalItemIds.map(() => 'isolated'),
    providerCallBlocked: false,
  });
  return references;
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
  const structuralComponents = criticalFeatures
    .filter(({ featureId }) => featureId != null)
    .map(({ itemId, featureId, name, value }) => ({
      componentId: featureId,
      parentItemId: itemId,
      name,
      value,
      evidence: 'observed',
      requiredWhenParentVisible: true,
    }));
  const relativeScale = (identity.relativeScale ?? [])
    .map(({ subjectId, referenceId, relation, confidence }) => ({
      subjectId, referenceId, relation, confidence,
    }));
  const [categoryAffordance, validContexts] = CATEGORY_SEMANTICS[request.category];
  const wearableItemIds = items
    .filter(({ functionalType }) => WEARABLE_FUNCTIONAL_TYPE_PATTERN.test(functionalType))
    .map(({ id }) => id);
  const identityConfirmsWearable = wearableItemIds.length > 0;
  const effectiveAffordances = identityConfirmsWearable
    ? ['wearable'] : [categoryAffordance];
  const affordanceSource = identityConfirmsWearable
    ? (categoryAffordance === 'wearable' ? 'combined' : 'product_identity') : 'category';
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
      structuralComponents,
      relativeScale,
    },
    productSemantics: {
      functionalType: items.map(({ functionalType }) => functionalType).join(' and '),
      affordances: effectiveAffordances,
      wearableItemIds,
      affordanceSource,
      requestedCategory: request.category,
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

function safeDiagnosticPhrase(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return 'invalid';
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > 120 ||
      /(?:data:image|base64|bearer\s|authorization|api[_-]?key|token)/i.test(normalized)) {
    return 'redacted';
  }
  return normalized;
}

function relationshipDiagnostics(productIdentity, itemId) {
  return productIdentity.relationships
    .filter(({ itemIds }) => itemIds.includes(itemId))
    .map(({ type, itemIds }) => ({ type, itemIds: [...itemIds] }));
}

function relativeScaleDiagnostics(productIdentity, itemId) {
  return (productIdentity.relativeScale ?? [])
    .filter(({ subjectId, referenceId }) => subjectId === itemId || referenceId === itemId)
    .map(({ subjectId, referenceId, relation, confidence }) => ({
      subjectId, referenceId, relation, confidence,
    }));
}

function canonicalInventoryDiagnostics(analysis, productIdentity) {
  const sourceItems = new Map(analysis.items.map((item) => [item.id, item]));
  return productIdentity.items.map(({ id, functionalType, quantity }) => {
    const sourceItem = sourceItems.get(id);
    return {
      itemId: id,
      functionalType,
      canonicalQuantity: quantity,
      functionalTypeState: sourceItem?.functionalType?.state ?? 'unknown',
      quantityState: sourceItem?.quantity?.state ?? 'unknown',
      observationCompleteness: sourceItem?.observationCompleteness ?? 'unknown',
      observedFeatureCount: sourceItem?.observedFeatures?.length ?? 0,
      ambiguousFeatureCount: sourceItem?.ambiguousFeatures?.length ?? 0,
      structuralComponentCount: (productIdentity.structuralComponents ?? [])
        .filter(({ parentItemId }) => parentItemId === id).length,
      relationships: relationshipDiagnostics(productIdentity, id),
      relativeScale: relativeScaleDiagnostics(productIdentity, id),
    };
  });
}

function proposalContractDiagnostics({ brief, productIdentity, allocation }) {
  const required = new Map(brief.productPresentation.requiredVisibleItems
    .map(({ itemId, quantity }) => [itemId, quantity]));
  const optional = new Map(brief.productPresentation.optionalVisibleItems
    .map(({ itemId, quantity }) => [itemId, quantity]));
  const allocationByItem = new Map(allocation.map((entry) => [entry.itemId, entry]));
  const placementByItem = new Map((brief.humanInteraction.physicalPlacement ?? [])
    .map((placement) => [placement.itemId, placement]));
  return productIdentity.items.map(({ id, functionalType, quantity }) => {
    const visibility = required.has(id) ? 'required' : optional.has(id) ? 'optional' : 'omitted';
    const unitAllocation = allocationByItem.get(id);
    const placement = placementByItem.get(id);
    const humanAllocatedUnits = unitAllocation?.humanAllocated ?? 0;
    const hasExactAllocation = unitAllocation?.sceneAllocated !== undefined;
    const sceneAllocatedUnits = hasExactAllocation ? unitAllocation.sceneAllocated : null;
    const occludedOrOutOfFrameUnits = hasExactAllocation
      ? unitAllocation.occludedOrOutOfFrame : null;
    const requestedVisibleUnits = hasExactAllocation
      ? humanAllocatedUnits + sceneAllocatedUnits
      : visibility === 'required' ? required.get(id) : null;
    return {
      itemId: id,
      functionalType,
      canonicalQuantity: quantity,
      visibility,
      requestedQuantity: required.get(id) ?? optional.get(id) ?? 0,
      humanAllocatedUnits,
      sceneAllocatedUnits,
      occludedOrOutOfFrameUnits,
      maxSceneAllocatedUnits: unitAllocation?.maxSceneAllocated ?? 0,
      requestedVisibleUnits,
      pairPolicy: brief.visibilityIntent.pairPolicy,
      placement: placement ? {
        interactionMode: safeDiagnosticPhrase(placement.interactionMode),
        anatomicalAnchor: safeDiagnosticPhrase(placement.anatomicalAnchor),
        orientation: safeDiagnosticPhrase(placement.orientation),
      } : null,
      observedFeatureCount: (productIdentity.observedFeatureEvidence ?? [])
        .filter(({ itemId }) => itemId === id).length,
      structuralComponentCount: (productIdentity.structuralComponents ?? [])
        .filter(({ parentItemId }) => parentItemId === id).length,
    };
  });
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
    async analyze(rawRequest) {
      const request = validateExperimentalV3Request(rawRequest);
      const asset = await assetStore?.readImage(request.inputAssetId);
      if (!asset) {
        throw new ExperimentalV3ValidationError('Imagem não encontrada ou expirada.', {
          code: 'ASSET_NOT_FOUND', status: 404,
        });
      }
      if (!productIdentityAnalyzer || productIdentityAnalyzer.isConfigured === false) {
        throw new ExperimentalV3ValidationError('A análise do produto não está configurada.', {
          code: 'PRODUCT_ANALYSIS_REQUIRED', status: 503,
        });
      }
      const analysis = await productIdentityAnalyzer.analyze({
        inputs: [{ bytes: Buffer.from(asset.bytes), mimeType: asset.mimeType, metadata: asset.metadata }],
        declaredCategory: request.category,
        userBrief: [request.objective, request.description].filter(Boolean).join('. '),
        cacheKey: asset.metadata?.hash,
      });
      const input = buildCreativeDirectorV3Input({ analysis, request });
      return Object.freeze({
        items: input.productIdentity.items.map(({ id, functionalType, quantity }) =>
          Object.freeze({ id, functionalType, quantity })),
        source: Object.freeze({
          assetId: request.inputAssetId, mimeType: asset.mimeType,
          width: asset.metadata?.width, height: asset.metadata?.height,
          sha256: asset.metadata?.hash,
        }),
      });
    },
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
      const canonicalIds = new Set(input.productIdentity.items.map(({ id }) => id));
      if (request.canonicalVisualAssets.some(({ canonicalItemId }) => !canonicalIds.has(canonicalItemId))) {
        throw new ExperimentalV3ValidationError('Referência associada a item canônico inexistente.', {
          code: 'INVALID_CANONICAL_VISUAL_ASSET',
        });
      }
      effectiveLogger.info({
        component: 'ExperimentalV3CanonicalInventory',
        analysisState: analysis.state,
        validationState: 'locally_validated',
        canonicalItemCount: input.productIdentity.items.length,
        relationshipCount: input.productIdentity.relationships.length,
        relativeScaleCount: input.productIdentity.relativeScale.length,
        items: canonicalInventoryDiagnostics(analysis, input.productIdentity),
      });
      const direction = await runCreativeDirector({
        input,
        modelAdapter: creativeDirectorAdapterFactory(source),
        logger: effectiveLogger,
      });
      const briefs = direction.briefs;
      const referencesByRole = new Map(await Promise.all(briefs.map(async (brief) => [
        brief.campaignRole,
        await resolveCampaignReferences({
          brief, productIdentity: input.productIdentity, request, source,
          assetStore, logger: effectiveLogger,
        }),
      ])));
      effectiveLogger.info({
        component: 'ExperimentalV3DeterministicRoleSelection',
        editorialSelectedIds: direction.editorialSelectedIds,
        conceptualSelectedIds: direction.conceptualSelectedIds,
        selectionStrategy: direction.selectionStrategy,
        selectionDeterministic: direction.selectionDeterministic === true,
      });
      const lifestyle = briefs.find(({ campaignRole }) => campaignRole === 'contextual_lifestyle');
      effectiveLogger.info({
        component: 'ExperimentalV3LifestylePolicy',
        requestedCategory: request.category,
        effectiveAffordances: input.productSemantics.affordances,
        affordanceSource: input.productSemantics.affordanceSource,
        lifestyleHumanRequired: lifestyle?.humanInteraction?.presence === 'required' &&
          lifestyle?.humanInteraction?.mode === 'required',
        humanAllocatedUnitCount: (lifestyle?.humanInteraction?.unitAllocation ?? [])
          .reduce((sum, { humanAllocatedUnits }) => sum + humanAllocatedUnits, 0),
      });
      const dimensions = experimentalOutputDimensions(request.aspectRatio);
      const results = [];
      for (let start = 0; start < briefs.length; start += 2) {
        const batch = briefs.slice(start, start + 2).map(async (brief) => {
          const visibleItemIds = [...new Set([
            ...brief.productPresentation.requiredVisibleItems,
            ...brief.productPresentation.optionalVisibleItems,
          ].map(({ itemId }) => itemId))];
          const countByItem = (features) => Object.fromEntries(input.productIdentity.items.map(({ id }) => [
            id, features.filter(({ itemId }) => itemId === id).length,
          ]));
          const structuralFeatureCountByItem = countByItem(input.productIdentity.criticalFeatures);
          const allocation = deriveProposalUnitAllocation({
            brief, productIdentity: input.productIdentity,
          });
          const proposalItems = proposalContractDiagnostics({
            brief, productIdentity: input.productIdentity, allocation,
          });
          effectiveLogger.info({
            component: 'ExperimentalV3ProposalInventory',
            proposalId: brief.proposalId,
            campaignRole: brief.campaignRole,
            selectedCanonicalItemIds: visibleItemIds,
            items: proposalItems,
            canonicalQuantities: Object.fromEntries(allocation.map(({ itemId, canonicalQuantity }) =>
              [itemId, canonicalQuantity])),
            humanAllocatedUnits: Object.fromEntries(allocation.map(({ itemId, humanAllocated }) =>
              [itemId, humanAllocated])),
            maxSceneAllocatedUnits: Object.fromEntries(allocation.map(({ itemId, maxSceneAllocated }) =>
              [itemId, maxSceneAllocated])),
            structuralFeatureCountByItem,
            hasStructuralComponentsByItem: Object.fromEntries(Object.entries(structuralFeatureCountByItem)
              .map(([itemId, count]) => [itemId, count > 0])),
            editorialScope: brief.productPresentation.presentationScope,
            editorialDetailPurposeValid: editorialDetailPurposeValid(brief),
            schemaValid: direction.schemaValid === true,
            diversityValid: direction.diversityValid === true,
          });
          const prompt = compileCreativeDirectorV3ImagePrompt({
            brief, productIdentity: input.productIdentity,
            productSemantics: input.productSemantics, userIntent: input.userIntent,
          });
          effectiveLogger.info({
            component: 'ExperimentalV3PreProviderContract',
            proposalId: brief.proposalId,
            campaignRole: brief.campaignRole,
            canonicalItemCount: input.productIdentity.items.length,
            selectedItemCount: proposalItems.filter(({ visibility }) => visibility !== 'omitted').length,
            intentionallyOmittedItemCount: proposalItems.filter(({ visibility }) => visibility === 'omitted').length,
            items: proposalItems,
          });
          try {
            const image = await imageProvider.generate({
              prompt, inputs: referencesByRole.get(brief.campaignRole),
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
