import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDeterministicCreativeDirectorV3Model,
  runCreativeDirectorV3,
  selectDeterministicV3RoleItems,
  validateCreativeDirectorV3Input,
  validateCreativeDirectorV3Output,
} from '../benchmark/creative-director-v3.mjs';
import {
  compileCreativeDirectorV3ImagePrompt,
  deriveProposalUnitAllocation,
} from '../benchmark/creative-director-v3-image-prompt-compiler.mjs';
import {
  buildCreativeDirectorV3Input,
  createExperimentalV3GenerationService,
  experimentalOutputDimensions,
  validateExperimentalV3Request,
} from '../experimental-v3/experimental-v3-generation-service.mjs';
import { OPENAI_CREATIVE_DIRECTOR_V3_SCHEMA } from '../benchmark/creative-director-v3-openai-adapter.mjs';
import { createOpenAIGPTImageBenchmarkProvider } from '../benchmark/openai-gpt-image-benchmark-provider.mjs';
import { createAnalysisSessionStore } from '../experimental-v3/experimental-v3-session-stores.mjs';

function humanPresenceInput({ category, functionalType, affordance, objective = 'Create a premium campaign' }) {
  return validateCreativeDirectorV3Input({
    productIdentity: {
      category,
      items: [{ id: 'product-1', functionalType, quantity: 1 }],
      relationships: [], observedFeatures: [], ambiguousFeatures: [],
    },
    productSemantics: {
      functionalType, affordances: [affordance],
      validContexts: ['commercial context'], invalidContexts: ['physically implausible use'],
    },
    userIntent: { objective, aspectRatio: '1:1', requestedStyle: null, additionalInstructions: null },
    generationPolicy: { proposalCount: 4, targetQuality: 'standard', creativeFreedom: 'high' },
  });
}

const assetId = '00000000-0000-4000-8000-000000000001';
const sourceBytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const testProviderCapabilities = Object.freeze({
  maxInputImages: 4,
  acceptedMimeTypes: Object.freeze(['image/jpeg', 'image/png']),
  maxBytesPerInput: 20 * 1024 * 1024,
  supportsMultipleInputs: true,
});
let idempotencySequence = 0;

async function generateAfterAnalysis(instance, rawRequest) {
  const inventory = await instance.analyze(rawRequest);
  idempotencySequence += 1;
  return instance.generate({
    ...rawRequest,
    analysisId: inventory.analysisId,
    idempotencyKey: `test-generation-${idempotencySequence}`,
  });
}
const analysis = {
  state: 'known',
  items: [
    {
      id: 'product-pair', functionalType: { state: 'known', value: 'wearable product' },
      quantity: { state: 'known', value: 2 }, observationCompleteness: 'partial',
      observedFeatures: [
        { id: 'color-feature', name: 'color', value: 'source-observed blue' },
        { id: 'closure-feature', name: 'visible fastening element', value: 'source-observed connector' },
      ],
      ambiguousFeatures: [{
        id: 'hidden-feature', name: 'hidden-back', visibility: 'hidden',
        observedConstraint: 'must continue the visible outer geometry',
        plausibleHypotheses: ['plain continuation', 'concealed support'],
      }],
    },
  ],
  relationships: [{ type: 'pair', memberIds: ['product-pair'], state: 'known' }],
};

function request(overrides = {}) {
  return {
    inputAssetId: assetId, category: 'general', objective: 'Campanha premium',
    description: 'Apresentação sofisticada', aspectRatio: '1:1', ...overrides,
  };
}

function service({ failRole } = {}) {
  let directorCalls = 0;
  const visualCalls = [];
  const deterministic = createDeterministicCreativeDirectorV3Model();
  const instance = createExperimentalV3GenerationService({
    assetStore: { readImage: async () => ({ bytes: sourceBytes, mimeType: 'image/jpeg', metadata: { hash: 'safe-hash' } }) },
    productIdentityAnalyzer: { analyze: async () => analysis },
    creativeDirectorAdapterFactory: () => ({
      name: 'mock-director',
      async generate(input) { directorCalls += 1; return deterministic.generate(input); },
    }),
    imageProvider: {
      async generate(input) {
        visualCalls.push(input);
        const role = /Campaign role: ([a-z_]+)/.exec(input.prompt)?.[1];
        if (role === failRole) throw Object.assign(new Error('private'), { code: 'UPSTREAM_TIMEOUT' });
        return { imageBase64: Buffer.from(role).toString('base64') };
      },
    },
  });
  return { instance, visualCalls, directorCalls: () => directorCalls };
}

test('request usa medium por padrão e rejeita valores técnicos inválidos', () => {
  assert.equal(validateExperimentalV3Request(request()).quality, 'medium');
  assert.throws(() => validateExperimentalV3Request(request({ quality: 'ultra' })), /Qualidade/);
  assert.throws(() => validateExperimentalV3Request(request({ inputAssetId: 'fixture' })), /referência/);
});

test('schema OpenAI e fallback determinístico compartilham allocation e placement', async () => {
  const humanSchema = OPENAI_CREATIVE_DIRECTOR_V3_SCHEMA.properties.briefs.items
    .properties.humanInteraction;
  assert.ok(humanSchema.required.includes('unitAllocation'));
  assert.ok(humanSchema.required.includes('physicalPlacement'));
  assert.deepEqual(Object.keys(humanSchema.properties.unitAllocation.items.properties), [
    'itemId', 'canonicalQuantity', 'humanAllocatedUnits',
    'sceneAllocatedUnits', 'occludedOrOutOfFrameUnits',
  ]);
  const input = humanPresenceInput({
    category: 'clothing', functionalType: 'wearable garment', affordance: 'wearable',
  });
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
  assert.ok(briefs.every((brief) => Array.isArray(brief.humanInteraction.unitAllocation)));
  assert.ok(briefs.every((brief) => Array.isArray(brief.humanInteraction.physicalPlacement)));
});

test('ponte constrói Product Identity V3 real sem fixture e preserva pair e evidência', () => {
  const normalized = validateExperimentalV3Request(request());
  const input = buildCreativeDirectorV3Input({ analysis, request: normalized });
  assert.deepEqual(input.productIdentity.items, [{ id: 'product-pair', functionalType: 'wearable product', quantity: 2 }]);
  assert.deepEqual(input.productIdentity.relationships, [{ type: 'pair', itemIds: ['product-pair'] }]);
  assert.match(input.productIdentity.observedFeatures[0], /source-observed blue/);
  assert.deepEqual(input.productIdentity.observedFeatureEvidence[0], {
    itemId: 'product-pair', featureId: 'color-feature', name: 'color', value: 'source-observed blue',
  });
  assert.deepEqual(input.productIdentity.ambiguousFeatureEvidence[0], {
    itemId: 'product-pair', featureId: 'hidden-feature', name: 'hidden-back', visibility: 'hidden',
    observedConstraint: 'must continue the visible outer geometry',
    plausibleHypotheses: ['plain continuation', 'concealed support'], certainty: 'ambiguous',
  });
  assert.deepEqual(input.productIdentity.criticalFeatures, [{
    itemId: 'product-pair', featureId: 'closure-feature', name: 'visible fastening element',
    value: 'source-observed connector', evidence: 'observed',
  }]);
  assert.deepEqual(input.productIdentity.structuralComponents, [{
    componentId: 'closure-feature', parentItemId: 'product-pair',
    name: 'visible fastening element', value: 'source-observed connector',
    evidence: 'observed', requiredWhenParentVisible: true,
  }]);
  assert.equal(input.productIdentity.criticalFeatures.some(({ name }) => name === 'color'), false);
  assert.equal(JSON.stringify(input).includes('fixture'), false);
});

test('critical feature chega ao prompt somente para item selecionado e nunca é inventada', async () => {
  const normalized = validateExperimentalV3Request(request());
  const extraItem = {
    id: 'other-product', functionalType: { state: 'known', value: 'generic product' },
    quantity: { state: 'known', value: 1 }, observationCompleteness: 'complete',
    observedFeatures: [{ id: 'surface-feature', name: 'surface color', value: 'neutral' }],
    ambiguousFeatures: [],
  };
  const input = validateCreativeDirectorV3Input(buildCreativeDirectorV3Input({
    analysis: { ...analysis, items: [...analysis.items, extraItem] }, request: normalized,
  }));
  const brief = (await createDeterministicCreativeDirectorV3Model().generate(input))[2];
  const selected = [{ itemId: 'product-pair', quantity: 2 }];
  const subset = {
    ...brief,
    productPresentation: {
      ...brief.productPresentation, heroItemIds: ['product-pair'], supportingItemIds: [],
      requiredVisibleItems: selected, optionalVisibleItems: [], presentationScope: 'single_item_detail',
    },
    visibilityIntent: {
      ...brief.visibilityIntent, requiredVisibleItems: selected, optionalVisibleItems: [],
      heroItemIds: ['product-pair'], pairPolicy: 'preserve_pair', mode: 'subset',
    },
  };
  validateCreativeDirectorV3Output([
    ...(await createDeterministicCreativeDirectorV3Model().generate(input)).slice(0, 2),
    subset,
    (await createDeterministicCreativeDirectorV3Model().generate(input))[3],
  ], input);
  const prompt = compileCreativeDirectorV3ImagePrompt({
    brief: subset, productIdentity: input.productIdentity,
    productSemantics: input.productSemantics, userIntent: input.userIntent,
  });
  assert.match(prompt, /SOURCE-OBSERVED STRUCTURAL FEATURES/);
  assert.match(prompt, /product-pair: visible fastening element=source-observed connector/);
  assert.doesNotMatch(prompt, /other-product: surface color/);
  assert.doesNotMatch(prompt, /plain continuation|concealed support/);
});

test('Editorial diferencia detalhe selecionado de apresentação do conjunto completo', async () => {
  const normalized = validateExperimentalV3Request(request());
  const second = {
    id: 'second-product', functionalType: { state: 'known', value: 'second product category' },
    quantity: { state: 'known', value: 1 }, observationCompleteness: 'complete',
    observedFeatures: [], ambiguousFeatures: [],
  };
  const input = validateCreativeDirectorV3Input(buildCreativeDirectorV3Input({
    analysis: { ...analysis, items: [...analysis.items, second] }, request: normalized,
  }));
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
  const selected = [{ itemId: 'second-product', quantity: 1 }];
  const editorial = {
    ...briefs[2],
    productPresentation: {
      ...briefs[2].productPresentation, heroItemIds: ['second-product'], supportingItemIds: [],
      requiredVisibleItems: selected, optionalVisibleItems: [], presentationScope: 'single_item_detail',
    },
    visibilityIntent: {
      ...briefs[2].visibilityIntent, requiredVisibleItems: selected, optionalVisibleItems: [],
      heroItemIds: ['second-product'], pairPolicy: 'not_selected', mode: 'subset',
    },
  };
  assert.doesNotThrow(() => validateCreativeDirectorV3Output([
    briefs[0], briefs[1], editorial, briefs[3],
  ], input));
  const inconsistent = {
    ...editorial,
    productPresentation: { ...editorial.productPresentation, presentationScope: 'complete_set' },
  };
  assert.throws(() => validateCreativeDirectorV3Output([
    briefs[0], briefs[1], inconsistent, briefs[3],
  ], input), /complete-set presentation cannot omit/);
});

test('telemetria sanitizada mostra inventário e contagens sem prompt ou valores de features', async () => {
  const events = [];
  const deterministic = createDeterministicCreativeDirectorV3Model();
  const instance = createExperimentalV3GenerationService({
    assetStore: { readImage: async () => ({ bytes: sourceBytes, mimeType: 'image/jpeg', metadata: {} }) },
    productIdentityAnalyzer: { analyze: async () => analysis },
    creativeDirectorAdapterFactory: () => ({ name: 'mock-director', generate: (input) => deterministic.generate(input) }),
    imageProvider: { generate: async () => ({ imageBase64: 'aW1hZ2U=' }) },
    logger: { info: (event) => events.push(event) },
  });
  await generateAfterAnalysis(instance, request({ category: 'jewelry' }));
  const canonical = events.find(({ component }) => component === 'ExperimentalV3CanonicalInventory');
  assert.equal(canonical.analysisState, 'known');
  assert.equal(canonical.validationState, 'locally_validated');
  assert.equal(canonical.canonicalItemCount, 1);
  assert.deepEqual(canonical.items, [{
    itemId: 'product-pair', functionalType: 'wearable product', canonicalQuantity: 2,
    functionalTypeState: 'known', quantityState: 'known', observationCompleteness: 'partial',
    observedFeatureCount: 2, ambiguousFeatureCount: 1, structuralComponentCount: 1,
    relationships: [{ type: 'pair', itemIds: ['product-pair'] }], relativeScale: [],
  }]);
  const proposals = events.filter(({ component }) => component === 'ExperimentalV3ProposalInventory');
  assert.equal(proposals.length, 4);
  assert.equal(proposals[0].proposalId, 1);
  assert.deepEqual(proposals[0].selectedCanonicalItemIds, ['product-pair']);
  assert.deepEqual(proposals[0].canonicalQuantities, { 'product-pair': 2 });
  assert.deepEqual(proposals[0].structuralFeatureCountByItem, { 'product-pair': 1 });
  assert.deepEqual(proposals[0].hasStructuralComponentsByItem, { 'product-pair': true });
  assert.equal(proposals[0].schemaValid, true);
  assert.equal(proposals[0].diversityValid, true);
  const allowed = new Set([
    'component', 'proposalId', 'campaignRole', 'selectedCanonicalItemIds', 'items', 'canonicalQuantities',
    'humanAllocatedUnits', 'maxSceneAllocatedUnits', 'structuralFeatureCountByItem',
    'hasStructuralComponentsByItem', 'editorialScope', 'editorialDetailPurposeValid',
    'schemaValid', 'diversityValid',
  ]);
  assert.equal(proposals.every((event) => Object.keys(event).every((key) => allowed.has(key))), true);
  const selection = events.find(({ component }) => component === 'ExperimentalV3DeterministicRoleSelection');
  assert.equal(selection.selectionDeterministic, true);
  assert.deepEqual(selection.editorialSelectedIds, ['product-pair']);
  assert.deepEqual(selection.conceptualSelectedIds, ['product-pair']);
  assert.deepEqual(Object.keys(selection.selectionStrategy).sort(), ['conceptual', 'editorial']);
  assert.doesNotMatch(JSON.stringify(selection), /prompt|base64|authorization|api[_-]?key/i);
  const lifestylePolicy = events.find(({ component }) => component === 'ExperimentalV3LifestylePolicy');
  assert.deepEqual(lifestylePolicy, {
    component: 'ExperimentalV3LifestylePolicy', requestedCategory: 'jewelry',
    effectiveAffordances: ['wearable'], affordanceSource: 'combined',
    lifestyleHumanRequired: true, humanAllocatedUnitCount: 1,
  });
  const preProvider = events.filter(({ component }) => component === 'ExperimentalV3PreProviderContract');
  assert.equal(preProvider.length, 4);
  assert.equal(preProvider[0].canonicalItemCount, 1);
  assert.equal(preProvider[0].selectedItemCount, 1);
  assert.equal(preProvider[0].intentionallyOmittedItemCount, 0);
  assert.deepEqual(preProvider[0].items[0], proposals[0].items[0]);
  assert.deepEqual(proposals[0].items[0], {
    itemId: 'product-pair', functionalType: 'wearable product', canonicalQuantity: 2,
    visibility: 'required', requestedQuantity: 2, humanAllocatedUnits: 0,
    sceneAllocatedUnits: null, occludedOrOutOfFrameUnits: null, maxSceneAllocatedUnits: 2,
    requestedVisibleUnits: 2,
    pairPolicy: 'preserve_pair', placement: null, observedFeatureCount: 2,
    structuralComponentCount: 1,
  });
  const lifestyleItem = proposals.find(({ campaignRole }) =>
    campaignRole === 'contextual_lifestyle').items[0];
  assert.equal(lifestyleItem.visibility, 'required');
  assert.equal(lifestyleItem.humanAllocatedUnits, 1);
  assert.equal(lifestyleItem.sceneAllocatedUnits, 0);
  assert.equal(lifestyleItem.occludedOrOutOfFrameUnits, 1);
  assert.equal(lifestyleItem.requestedVisibleUnits, 1);
  assert.deepEqual(lifestyleItem.placement, {
    interactionMode: 'functionally valid human use',
    anatomicalAnchor: 'functionally valid body anchor established by the product semantics',
    orientation: 'preserve the product native functional orientation',
  });
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /prompt|source-observed|plausibleHypotheses|Base64|data:image|Authorization|api[_-]?key/i);
});

test('telemetria observacional não altera prompt, seleção, resposta ou chamada visual', async () => {
  const baseline = service();
  const baselineResult = await generateAfterAnalysis(baseline.instance, request());
  const events = [];
  const deterministic = createDeterministicCreativeDirectorV3Model();
  const visualCalls = [];
  const instrumented = createExperimentalV3GenerationService({
    assetStore: { readImage: async () => ({ bytes: sourceBytes, mimeType: 'image/jpeg', metadata: { hash: 'safe-hash' } }) },
    productIdentityAnalyzer: { analyze: async () => analysis },
    creativeDirectorAdapterFactory: () => ({ name: 'mock-director', generate: (input) => deterministic.generate(input) }),
    imageProvider: {
      async generate(input) {
        visualCalls.push(input);
        const role = /Campaign role: ([a-z_]+)/.exec(input.prompt)?.[1];
        return { imageBase64: Buffer.from(role).toString('base64') };
      },
    },
    logger: { info: (event) => events.push(event) },
  });
  const instrumentedResult = await generateAfterAnalysis(instrumented, request());
  assert.deepEqual(instrumentedResult, baselineResult);
  assert.equal(visualCalls.length, baseline.visualCalls.length);
  assert.deepEqual(visualCalls, baseline.visualCalls);
  assert.equal(events.filter(({ component }) => component === 'ExperimentalV3CanonicalInventory').length, 1);
  assert.equal(events.filter(({ component }) => component === 'ExperimentalV3PreProviderContract').length, 4);
});

test('uma direção lógica produz quatro briefs, quatro prompts e quatro chamadas visuais', async () => {
  const current = service();
  const batch = await generateAfterAnalysis(current.instance, request({ quality: 'high' }));
  assert.equal(current.directorCalls(), 1);
  assert.equal(current.visualCalls.length, 4);
  assert.equal(new Set(current.visualCalls.map(({ prompt }) => prompt)).size, 4);
  assert.equal(current.visualCalls.every(({ parameters }) => parameters.provider.quality === 'high'), true);
  assert.equal(batch.status, 'completed');
  assert.equal(batch.results.length, 4);
  assert.equal(batch.results.every(({ status }) => status === 'completed'), true);
  assert.equal(JSON.stringify(batch).includes('Authorization'), false);
});

test('erro individual preserva três sucessos e não repete chamada visual', async () => {
  const current = service({ failRole: 'editorial_craft_detail' });
  const batch = await generateAfterAnalysis(current.instance, request());
  assert.equal(current.directorCalls(), 1);
  assert.equal(current.visualCalls.length, 4);
  assert.equal(batch.status, 'partial');
  assert.equal(batch.results.filter(({ status }) => status === 'completed').length, 3);
  assert.deepEqual(batch.results.find(({ status }) => status === 'error'), {
    campaignRole: 'editorial_craft_detail', status: 'error', errorCode: 'UPSTREAM_TIMEOUT',
  });
});

test('mapeia proporções para os três tamanhos oficiais do GPT Image', () => {
  assert.deepEqual(experimentalOutputDimensions('1:1'), { width: 1024, height: 1024 });
  assert.deepEqual(experimentalOutputDimensions('4:5'), { width: 1024, height: 1536 });
  assert.deepEqual(experimentalOutputDimensions('9:16'), { width: 1024, height: 1536 });
  assert.deepEqual(experimentalOutputDimensions('16:9'), { width: 1536, height: 1024 });
});

test('identidade ausente falha antes de Creative Director ou imagem', async () => {
  const instance = createExperimentalV3GenerationService({
    assetStore: { readImage: async () => ({ bytes: sourceBytes, mimeType: 'image/jpeg', metadata: {} }) },
    productIdentityAnalyzer: { analyze: async () => ({ state: 'unknown', items: [], relationships: [] }) },
    creativeDirectorAdapterFactory: () => { throw new Error('must not run'); },
    imageProvider: { generate: async () => { throw new Error('must not run'); } },
  });
  await assert.rejects(() => instance.analyze(request()), { code: 'PRODUCT_ANALYSIS_REQUIRED', status: 503 });
});

test('timeout do Analyzer encerra o V3 sem fallback ou chamada visual', async () => {
  let analyzerCalls = 0;
  let directorCalls = 0;
  let visualCalls = 0;
  const timeoutError = Object.assign(new Error('Product identity provider timed out.'), {
    code: 'GEMINI_TIMEOUT', attempt: 1, retryUsed: false,
  });
  const instance = createExperimentalV3GenerationService({
    assetStore: { readImage: async () => ({ bytes: sourceBytes, mimeType: 'image/jpeg', metadata: {} }) },
    productIdentityAnalyzer: {
      async analyze() {
        analyzerCalls += 1;
        throw timeoutError;
      },
    },
    creativeDirectorAdapterFactory: () => {
      directorCalls += 1;
      return createDeterministicCreativeDirectorV3Model();
    },
    imageProvider: {
      async generate() {
        visualCalls += 1;
        return { imageBase64: 'must-not-run' };
      },
    },
  });

  await assert.rejects(() => instance.analyze(request()), (error) =>
    error === timeoutError && error.code === 'GEMINI_TIMEOUT');
  assert.equal(analyzerCalls, 1);
  assert.equal(directorCalls, 0);
  assert.equal(visualCalls, 0);
});

test('referências canônicas bloqueiam full_set contaminado e roteiam somente IDs selecionados', async () => {
  const sourceId = assetId;
  const isolatedA = '00000000-0000-4000-8000-00000000000a';
  const isolatedB = '00000000-0000-4000-8000-00000000000b';
  const hashes = { [sourceId]: '1'.repeat(64), [isolatedA]: 'a'.repeat(64), [isolatedB]: 'b'.repeat(64) };
  const assets = new Map(Object.keys(hashes).map((id) => [id, {
    bytes: Buffer.from(id), mimeType: 'image/png',
    metadata: { id, hash: hashes[id], width: 640, height: 640 },
  }]));
  const multiAnalysis = {
    state: 'known',
    items: [
      {
        id: 'canonical-a', functionalType: { state: 'known', value: 'wearable device' },
        quantity: { state: 'known', value: 1 }, observationCompleteness: 'complete',
        observedFeatures: [
          { id: 'a-1', name: 'visible structure', value: 'distinct body' },
          { id: 'a-2', name: 'visible connector', value: 'confirmed attachment' },
        ], ambiguousFeatures: [],
      },
      {
        id: 'canonical-b', functionalType: { state: 'known', value: 'paired wearable accessory' },
        quantity: { state: 'known', value: 2 }, observationCompleteness: 'complete',
        observedFeatures: [{ id: 'b-1', name: 'visible structure', value: 'matching pair' }],
        ambiguousFeatures: [],
      },
    ],
    relationships: [{ type: 'pair', memberIds: ['canonical-b'], state: 'known' }],
  };
  const calls = [];
  const create = () => createExperimentalV3GenerationService({
    assetStore: { readImage: async (id) => assets.get(id) },
    productIdentityAnalyzer: { analyze: async () => multiAnalysis },
    creativeDirectorAdapterFactory: () => createDeterministicCreativeDirectorV3Model(),
    imageProvider: { generate: async (input) => {
      calls.push(input);
      return { imageBase64: 'aW1hZ2U=' };
    } },
  });
  const missingInstance = create();
  await assert.rejects(generateAfterAnalysis(missingInstance, request()), (error) =>
    error.code === 'CANONICAL_REFERENCE_REQUIRED' &&
    Array.isArray(error.details?.missingCanonicalItemIds));
  assert.equal(calls.length, 0);

  const binding = (canonicalItemId, id) => ({
    canonicalItemId, assetId: id, sourceKind: 'isolated_item', isolationState: 'isolated',
    isolationConfidence: 1, userConfirmed: true, mimeType: 'image/png',
    width: 640, height: 640, sha256: hashes[id],
  });
  const validInstance = create();
  const batch = await generateAfterAnalysis(validInstance, request({ canonicalVisualAssets: [
    binding('canonical-a', isolatedA), binding('canonical-b', isolatedB),
  ] }));
  assert.equal(batch.status, 'completed');
  assert.equal(calls.length, 4);
  const byRole = Object.fromEntries(calls.map((call) => [
    /Campaign role: ([a-z_]+)/.exec(call.prompt)?.[1],
    call.inputs.map(({ metadata }) => metadata.id),
  ]));
  assert.deepEqual(byRole.hero_commercial, [sourceId]);
  assert.deepEqual(byRole.editorial_craft_detail, [isolatedA]);
  assert.deepEqual(byRole.concept_campaign, [isolatedB]);
  assert.ok(byRole.contextual_lifestyle.every((id) => [isolatedA, isolatedB].includes(id)));
  assert.equal(Object.values(byRole).slice(1).flat().includes(sourceId), false);
});

test('referência canônica duplicada ou com SHA divergente falha antes do provider', async () => {
  const secondAssetId = '00000000-0000-4000-8000-00000000000c';
  const multiAnalysis = {
    state: 'known',
    items: [
      { ...analysis.items[0], id: 'generic-a', quantity: { state: 'known', value: 1 } },
      {
        ...analysis.items[0], id: 'generic-b', quantity: { state: 'known', value: 1 },
        observedFeatures: analysis.items[0].observedFeatures.map((feature) => ({
          ...feature, id: `${feature.id}-b`,
        })),
      },
    ], relationships: [],
  };
  let visualCalls = 0;
  const instance = createExperimentalV3GenerationService({
    assetStore: { readImage: async (id) => ({
      bytes: sourceBytes, mimeType: 'image/jpeg',
      metadata: { id, hash: 'a'.repeat(64), width: 100, height: 100 },
    }) },
    productIdentityAnalyzer: { analyze: async () => multiAnalysis },
    creativeDirectorAdapterFactory: () => createDeterministicCreativeDirectorV3Model(),
    imageProvider: { generate: async () => { visualCalls += 1; return { imageBase64: 'x' }; } },
  });
  const make = (canonicalItemId, asset = secondAssetId, sha256 = 'a'.repeat(64)) => ({
    canonicalItemId, assetId: asset, sourceKind: 'isolated_item', isolationState: 'isolated',
    isolationConfidence: 1, userConfirmed: true, mimeType: 'image/jpeg',
    width: 100, height: 100, sha256,
  });
  const analyzed = await instance.analyze(request());
  await assert.rejects(instance.generate(request({ analysisId: analyzed.analysisId,
    idempotencyKey: 'duplicate-binding-1', canonicalVisualAssets: [
    make('generic-a'), make('generic-b'),
  ] })), { code: 'INVALID_CANONICAL_VISUAL_ASSET' });
  await assert.rejects(instance.generate(request({ analysisId: analyzed.analysisId,
    idempotencyKey: 'duplicate-binding-2', canonicalVisualAssets: [
    make('generic-a'), make('generic-b', '00000000-0000-4000-8000-00000000000d', 'b'.repeat(64)),
  ] })), { code: 'INVALID_CANONICAL_VISUAL_ASSET' });
  assert.equal(visualCalls, 0);
});

test('Human Presence exige contexto humano somente no Lifestyle de vestíveis', async () => {
  const cases = [
    ['jewelry', 'jewelry set', 'wearable'],
    ['clothing', 'garment', 'wearable'],
    ['accessories', 'wristwatch', 'wearable'],
  ];
  for (const [category, functionalType, affordance] of cases) {
    const briefs = await createDeterministicCreativeDirectorV3Model().generate(
      humanPresenceInput({ category, functionalType, affordance }),
    );
    assert.deepEqual(briefs.map(({ humanInteraction }) => humanInteraction.presence), [
      'none', 'required', 'none', 'none',
    ]);
    assert.equal(briefs[1].humanInteraction.mode, 'required');
    assert.ok(briefs[1].humanInteraction.unitAllocation.some(({ humanAllocatedUnits }) => humanAllocatedUnits > 0));
    assert.ok(briefs[1].humanInteraction.physicalPlacement.length > 0);
    assert.match(briefs[1].humanInteraction.usageDescription, /gender-neutral/);
  }
});

test('Human Presence não força pessoas em perfume, eletrônico, alimento ou categoria ambígua', async () => {
  const cases = [
    ['cosmetics', 'perfume bottle', 'handheld', 'optional'],
    ['electronics', 'electronic device', 'digital_or_screen_based', 'optional'],
    ['food', 'prepared food', 'consumable', 'optional'],
    ['unknown', 'ambiguous product', 'unknown_safe_context', 'none'],
  ];
  for (const [category, functionalType, affordance, lifestylePresence] of cases) {
    const briefs = await createDeterministicCreativeDirectorV3Model().generate(
      humanPresenceInput({ category, functionalType, affordance }),
    );
    assert.deepEqual(briefs.map(({ humanInteraction }) => humanInteraction.presence), [
      'none', lifestylePresence, 'none', 'none',
    ]);
    for (const placement of briefs[1].humanInteraction.physicalPlacement) {
      assert.equal(placement.anatomicalAnchor, null);
    }
  }
});

test('pedido explícito pode tornar uso humano obrigatório sem afetar as outras propostas', async () => {
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(humanPresenceInput({
    category: 'clothing', functionalType: 'garment', affordance: 'wearable',
    objective: 'Show the garment being worn in its correct use',
  }));
  assert.equal(briefs[1].humanInteraction.presence, 'required');
  assert.equal(briefs[1].humanInteraction.mode, 'required');
  assert.equal(briefs.filter(({ humanInteraction }) => humanInteraction.presence !== 'none').length, 1);
});

test('fidelidade on-body protege vestíveis generalistas somente na proposta humana', async () => {
  const cases = [
    ['jewelry', 'earrings'],
    ['accessories', 'wristwatch'],
    ['eyewear', 'eyeglasses'],
    ['clothing', 'garment'],
  ];
  for (const [category, functionalType] of cases) {
    const input = humanPresenceInput({ category, functionalType, affordance: 'wearable' });
    const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
    const prompts = briefs.map((brief) => compileCreativeDirectorV3ImagePrompt({
      brief, productIdentity: input.productIdentity,
      productSemantics: input.productSemantics, userIntent: input.userIntent,
    }));
    assert.match(prompts[1], /ON-BODY WEARABLE PRODUCT IDENTITY LOCK/);
    assert.match(prompts[1], /source reference remains the authoritative visual identity/);
    assert.match(prompts[1], /Adapt anatomy, pose, camera and physically plausible placement around the unchanged product/);
    assert.match(prompts[1], /HUMAN–PRODUCT INTERACTION FIDELITY/);
    assert.match(prompts[1], /preserve their plausible relative physical scale/);
    assert.equal(prompts.filter((prompt) => prompt.includes('ON-BODY WEARABLE PRODUCT IDENTITY LOCK')).length, 1);
    assert.equal(prompts.filter((prompt) => prompt.includes('HUMAN–PRODUCT INTERACTION FIDELITY')).length, 1);
  }
});

test('produto não vestível sem presença humana não recebe lock on-body', async () => {
  const input = humanPresenceInput({
    category: 'electronics', functionalType: 'electronic device',
    affordance: 'installed_environmental',
  });
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
  for (const brief of briefs) {
    const prompt = compileCreativeDirectorV3ImagePrompt({
      brief, productIdentity: input.productIdentity,
      productSemantics: input.productSemantics, userIntent: input.userIntent,
    });
    assert.doesNotMatch(prompt, /ON-BODY WEARABLE PRODUCT IDENTITY LOCK/);
    assert.doesNotMatch(prompt, /HUMAN–PRODUCT INTERACTION FIDELITY/);
  }
});

test('interação humana não depende de joias nem de affordance wearable', async () => {
  const input = humanPresenceInput({
    category: 'cosmetics', functionalType: 'cosmetic container', affordance: 'handheld',
  });
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
  const prompts = briefs.map((brief) => compileCreativeDirectorV3ImagePrompt({
    brief, productIdentity: input.productIdentity,
    productSemantics: input.productSemantics, userIntent: input.userIntent,
  }));
  assert.equal(briefs[1].humanInteraction.presence, 'optional');
  assert.match(prompts[1], /HUMAN–PRODUCT INTERACTION FIDELITY/);
  assert.match(prompts[1], /component structure, material\/color placement/);
  assert.match(prompts[1], /pose, scene, lighting, camera and composition creatively free/);
  assert.doesNotMatch(prompts[1], /\b(?:earrings?|rings?|gemstones?|turquoise)\b/i);
  assert.equal(prompts.filter((prompt) => prompt.includes('HUMAN–PRODUCT INTERACTION FIDELITY')).length, 1);
});

test('fidelidade por componente preserva associações observáveis sem endurecer ambiguidades ou cena', async () => {
  const input = validateCreativeDirectorV3Input({
    productIdentity: {
      category: 'general',
      items: [{ id: 'product-1', functionalType: 'generic manufactured product', quantity: 1 }],
      relationships: [],
      observedFeatures: [
        'product-1: upper-region finish=matte neutral finish',
        'product-1: lower-region material=brushed metallic material',
      ],
      ambiguousFeatures: ['product-1: hidden-internal-component is hidden'],
    },
    productSemantics: {
      functionalType: 'generic manufactured product',
      affordances: ['installed_environmental'],
      validContexts: ['commercial context'],
      invalidContexts: ['physically implausible use'],
    },
    userIntent: {
      objective: 'Create a premium campaign', aspectRatio: '1:1',
      requestedStyle: null, additionalInstructions: null,
    },
    generationPolicy: { proposalCount: 4, targetQuality: 'standard', creativeFreedom: 'high' },
  });
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
  const prompts = briefs.map((brief) => compileCreativeDirectorV3ImagePrompt({
    brief, productIdentity: input.productIdentity,
    productSemantics: input.productSemantics, userIntent: input.userIntent,
  }));

  for (let index = 0; index < prompts.length; index += 1) {
    const prompt = prompts[index];
    assert.match(prompt, /OBSERVED COMPONENT-ATTRIBUTE BINDING/);
    assert.match(prompt, /Do not migrate, copy, swap or spread an observed attribute/);
    assert.match(prompt, /upper-region finish=matte neutral finish/);
    assert.match(prompt, /lower-region material=brushed metallic material/);
    assert.match(prompt, /Do not count indeterminate micro-details, invent hidden components/);
    assert.doesNotMatch(prompt, /hidden-internal-component/);
    assert.match(prompt, new RegExp(briefs[index].scene.environment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(prompt, new RegExp(briefs[index].photography.lighting.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(prompt, /\b(?:earrings?|rings?|gemstones?|turquoise)\b/i);
    assert.ok(prompt.length < 14_000, `prompt grew unexpectedly: ${prompt.length}`);
  }
});

test('escala relativa confiável chega condicionalmente ao prompt sem depender da categoria', async () => {
  const analyzed = {
    state: 'known',
    items: [
      {
        id: 'product-a', functionalType: { state: 'known', value: 'generic product A' },
        quantity: { state: 'known', value: 1 }, observationCompleteness: 'complete',
        observedFeatures: [], ambiguousFeatures: [],
      },
      {
        id: 'product-b', functionalType: { state: 'known', value: 'generic product B' },
        quantity: { state: 'known', value: 1 }, observationCompleteness: 'complete',
        observedFeatures: [], ambiguousFeatures: [],
      },
    ],
    relationships: [],
    relativeScale: [
      { subjectId: 'product-a', referenceId: 'product-b', relation: 'slightly_larger', confidence: 'high' },
    ],
  };
  const normalized = validateExperimentalV3Request(request({ category: 'general' }));
  const input = validateCreativeDirectorV3Input(buildCreativeDirectorV3Input({
    analysis: analyzed, request: normalized,
  }));
  assert.deepEqual(input.productIdentity.relativeScale, [{
    subjectId: 'product-a', referenceId: 'product-b',
    relation: 'slightly_larger', confidence: 'high',
  }]);
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
  const prompt = compileCreativeDirectorV3ImagePrompt({
    brief: briefs[0], productIdentity: input.productIdentity,
    productSemantics: input.productSemantics, userIntent: input.userIntent,
  });
  assert.match(prompt, /SOURCE-OBSERVED RELATIVE SCALE/);
  assert.match(prompt, /product-a is slightly larger than product-b/);
  assert.match(prompt, /approximately the same depth/);
  assert.doesNotMatch(prompt, /\b(?:earrings?|rings?|jewelry)\b/i);
});

test('escala incerta, ausente ou produto único não altera o prompt', async () => {
  const single = humanPresenceInput({
    category: 'general', functionalType: 'generic product', affordance: 'unknown_safe_context',
  });
  const singleBrief = (await createDeterministicCreativeDirectorV3Model().generate(single))[0];
  const singlePrompt = compileCreativeDirectorV3ImagePrompt({
    brief: singleBrief, productIdentity: single.productIdentity,
    productSemantics: single.productSemantics, userIntent: single.userIntent,
  });
  assert.doesNotMatch(singlePrompt, /SOURCE-OBSERVED RELATIVE SCALE/);

  const uncertain = validateCreativeDirectorV3Input({
    ...single,
    productIdentity: {
      ...single.productIdentity,
      items: [
        { id: 'product-a', functionalType: 'generic product A', quantity: 1 },
        { id: 'product-b', functionalType: 'generic product B', quantity: 1 },
      ],
      relativeScale: [{
        subjectId: 'product-a', referenceId: 'product-b',
        relation: 'approximately_same', confidence: 'low',
      }],
    },
  });
  const uncertainBrief = (await createDeterministicCreativeDirectorV3Model().generate(uncertain))[0];
  const uncertainPrompt = compileCreativeDirectorV3ImagePrompt({
    brief: uncertainBrief, productIdentity: uncertain.productIdentity,
    productSemantics: uncertain.productSemantics, userIntent: uncertain.userIntent,
  });
  assert.doesNotMatch(uncertainPrompt, /SOURCE-OBSERVED RELATIVE SCALE/);
});

test('prompt limita relativeScale a quatro relações visíveis de alta confiança', async () => {
  const items = Array.from({ length: 6 }, (_, index) => ({
    id: `product-${index + 1}`, functionalType: `generic product ${index + 1}`, quantity: 1,
  }));
  const input = validateCreativeDirectorV3Input({
    productIdentity: {
      category: 'general', items, relationships: [], observedFeatures: [], ambiguousFeatures: [],
      relativeScale: [
        ...items.slice(1).map((item, index) => ({
          subjectId: 'product-1', referenceId: item.id,
          relation: index % 2 ? 'clearly_larger' : 'slightly_larger', confidence: 'high',
        })),
        { subjectId: 'product-2', referenceId: 'product-3', relation: 'approximately_same', confidence: 'low' },
      ],
    },
    productSemantics: {
      functionalType: 'generic product collection', affordances: ['unknown_safe_context'],
      validContexts: ['commercial context'], invalidContexts: ['physically implausible use'],
    },
    userIntent: {
      objective: 'Create a premium campaign', aspectRatio: '1:1',
      requestedStyle: null, additionalInstructions: null,
    },
    generationPolicy: { proposalCount: 4, targetQuality: 'standard', creativeFreedom: 'high' },
  });
  const brief = (await createDeterministicCreativeDirectorV3Model().generate(input))[0];
  const prompt = compileCreativeDirectorV3ImagePrompt({
    brief, productIdentity: input.productIdentity,
    productSemantics: input.productSemantics, userIntent: input.userIntent,
  });
  const scaleSection = prompt.split('C3. SOURCE-OBSERVED RELATIVE SCALE')[1]
    .split('C5. CANONICAL PRODUCT INDEPENDENCE')[0];
  assert.equal((scaleSection.match(/^- product-/gm) ?? []).length, 4);
  assert.doesNotMatch(scaleSection, /product-6/);
  assert.doesNotMatch(scaleSection, /approximately the same visible size/);
});

test('Lifestyle wearable prioriza âncora anatômica e oclusão natural sem exigir exposição simultânea', async () => {
  const input = validateCreativeDirectorV3Input({
    productIdentity: {
      category: 'wearable collection',
      items: [
        { id: 'paired-wearable', functionalType: 'paired wearable accessory', quantity: 2 },
        { id: 'single-wearable', functionalType: 'single wearable accessory', quantity: 1 },
      ],
      relationships: [{ type: 'pair', itemIds: ['paired-wearable'] }],
      relativeScale: [{
        subjectId: 'single-wearable', referenceId: 'paired-wearable',
        relation: 'slightly_larger', confidence: 'high',
      }],
      observedFeatures: [], ambiguousFeatures: [],
    },
    productSemantics: {
      functionalType: 'wearable product set', affordances: ['wearable'],
      validContexts: ['natural use at the functionally valid body placement'],
      invalidContexts: ['invalid anatomical placement'],
    },
    userIntent: {
      objective: 'Create a premium campaign', aspectRatio: '1:1',
      requestedStyle: null, additionalInstructions: null,
    },
    generationPolicy: { proposalCount: 4, targetQuality: 'standard', creativeFreedom: 'high' },
  });
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
  const prompts = briefs.map((brief) => compileCreativeDirectorV3ImagePrompt({
    brief, productIdentity: input.productIdentity,
    productSemantics: input.productSemantics, userIntent: input.userIntent,
  }));
  const lifestyle = prompts[1];
  assert.match(lifestyle, /HUMAN–WEARABLE PLACEMENT/);
  assert.match(lifestyle, /Physical plausibility takes priority/);
  assert.match(lifestyle, /valid anatomical anchor/);
  assert.match(lifestyle, /natural occlusion/);
  assert.match(lifestyle, /only one valid anatomical anchor is visible/);
  assert.match(lifestyle, /do not invent a second placement/);
  assert.match(lifestyle, /Other wearable items may appear only when their own valid anchor is naturally visible/);
  assert.match(lifestyle, /single-wearable is slightly larger than paired-wearable/);
  assert.match(lifestyle, /paired-wearable: exactly 2 units/);
  assert.match(lifestyle, /CANONICAL \/ EXISTING INVENTORY SELECTED FOR THIS PROPOSAL/);
  assert.match(lifestyle, /not a minimum clearly-visible count/);
  assert.match(lifestyle, /without changing canonical quantity, pair integrity or Product Identity/);
  assert.match(lifestyle, /Atomic relationship pair/);
  assert.match(lifestyle, /canonical relationship consists of exactly 2 matched units/);
  assert.doesNotMatch(lifestyle, /VISIBLE IN THIS IMAGE — REQUIRED/);
  assert.doesNotMatch(lifestyle, /exactly 2 (?:clearly )?visible/i);
  assert.doesNotMatch(lifestyle, /\b(?:earrings?|rings?|jewelry)\b/i);
  assert.equal(prompts.filter((prompt) => prompt.includes('HUMAN–WEARABLE PLACEMENT')).length, 1);
});

test('camada de placement não afeta não vestíveis nem propostas não Lifestyle', async () => {
  const wearable = humanPresenceInput({
    category: 'general wearable', functionalType: 'body-worn product', affordance: 'wearable',
  });
  const wearableBriefs = await createDeterministicCreativeDirectorV3Model().generate(wearable);
  const wearablePrompts = wearableBriefs.map((brief) => compileCreativeDirectorV3ImagePrompt({
    brief, productIdentity: wearable.productIdentity,
    productSemantics: wearable.productSemantics, userIntent: wearable.userIntent,
  }));
  assert.doesNotMatch(wearablePrompts[0], /HUMAN–WEARABLE PLACEMENT/);
  assert.doesNotMatch(wearablePrompts[2], /HUMAN–WEARABLE PLACEMENT/);
  assert.doesNotMatch(wearablePrompts[3], /HUMAN–WEARABLE PLACEMENT/);
  assert.match(wearablePrompts[0], /VISIBLE IN THIS IMAGE — REQUIRED/);
  assert.match(wearablePrompts[2], /VISIBLE IN THIS IMAGE — REQUIRED/);
  assert.match(wearablePrompts[3], /VISIBLE IN THIS IMAGE — REQUIRED/);

  const nonWearable = humanPresenceInput({
    category: 'electronics', functionalType: 'electronic device', affordance: 'handheld',
  });
  const nonWearableBriefs = await createDeterministicCreativeDirectorV3Model().generate(nonWearable);
  for (const brief of nonWearableBriefs) {
    const prompt = compileCreativeDirectorV3ImagePrompt({
      brief, productIdentity: nonWearable.productIdentity,
      productSemantics: nonWearable.productSemantics, userIntent: nonWearable.userIntent,
    });
    assert.doesNotMatch(prompt, /HUMAN–WEARABLE PLACEMENT/);
  }
});

test('unit allocation estruturada é fonte de verdade e não muda com usageDescription', async () => {
  const input = validateCreativeDirectorV3Input({
    productIdentity: {
      category: 'multi-unit wearable',
      items: [{ id: 'paired-product', functionalType: 'paired wearable product', quantity: 2 }],
      relationships: [{ type: 'pair', itemIds: ['paired-product'] }],
      observedFeatures: [], ambiguousFeatures: [],
    },
    productSemantics: {
      functionalType: 'paired wearable product', affordances: ['wearable'],
      validContexts: ['physically plausible human use'], invalidContexts: ['invalid placement'],
    },
    userIntent: {
      objective: 'Create a premium campaign', aspectRatio: '1:1',
      requestedStyle: null, additionalInstructions: null,
    },
    generationPolicy: { proposalCount: 4, targetQuality: 'standard', creativeFreedom: 'high' },
  });
  const lifestyle = (await createDeterministicCreativeDirectorV3Model().generate(input))[1];
  const oneOnHuman = {
    ...lifestyle,
    humanInteraction: {
      ...lifestyle.humanInteraction,
      usageDescription: 'One paired-product unit is naturally used by the person; the other may be occluded or out of frame.',
    },
  };
  const one = deriveProposalUnitAllocation({ brief: oneOnHuman, productIdentity: input.productIdentity });
  assert.deepEqual(one, [{
    itemId: 'paired-product', canonicalQuantity: 2, humanAllocated: 1,
    sceneAllocated: 0, occludedOrOutOfFrame: 1, maxSceneAllocated: 0,
  }]);
  const both = deriveProposalUnitAllocation({
    brief: {
      ...oneOnHuman,
      humanInteraction: { ...oneOnHuman.humanInteraction, usageDescription: 'Both paired-product units are used by the person.' },
    },
    productIdentity: input.productIdentity,
  });
  assert.equal(both[0].humanAllocated, 1);
  assert.equal(both[0].occludedOrOutOfFrame, 1);
  for (const allocation of [...one, ...both]) {
    assert.ok(allocation.humanAllocated + allocation.sceneAllocated +
      allocation.occludedOrOutOfFrame <= allocation.canonicalQuantity);
  }
  const prompt = compileCreativeDirectorV3ImagePrompt({
    brief: oneOnHuman, productIdentity: input.productIdentity,
    productSemantics: input.productSemantics, userIntent: input.userIntent,
  });
  assert.match(prompt, /TOTAL CANONICAL QUANTITY FOR THIS PROPOSAL: 2/);
  assert.match(prompt, /ALLOCATED TO HUMAN: 1/);
  assert.match(prompt, /ALLOCATED TO SCENE: 0/);
  assert.match(prompt, /NATURALLY OCCLUDED OR OUT OF FRAME: 1/);
  assert.match(prompt, /never authorizes an additional pair/);
  assert.match(prompt, /Occluded or out-of-frame units do not create additional inventory/);
});

test('Editorial determinístico exige finalidade real de detalhe para um único produto', async () => {
  const normalized = validateExperimentalV3Request(request());
  const second = {
    id: 'second-product', functionalType: { state: 'known', value: 'independent product' },
    quantity: { state: 'known', value: 1 }, observationCompleteness: 'complete',
    observedFeatures: [], ambiguousFeatures: [],
  };
  const input = validateCreativeDirectorV3Input(buildCreativeDirectorV3Input({
    analysis: { ...analysis, items: [...analysis.items, second] }, request: normalized,
  }));
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
  const editorial = briefs[2];
  const multiPrompt = compileCreativeDirectorV3ImagePrompt({
    brief: editorial, productIdentity: input.productIdentity,
    productSemantics: input.productSemantics, userIntent: input.userIntent,
  });
  assert.equal(editorial.productPresentation.requiredVisibleItems.length, 1);
  assert.doesNotMatch(multiPrompt, /EDITORIAL PRODUCT SEPARATION/);
  assert.match(multiPrompt, /NOT VISIBLE IN THIS IMAGE/);

  const selected = [{ itemId: 'second-product', quantity: 1 }];
  const validDetail = {
    ...editorial,
    productPresentation: {
      ...editorial.productPresentation, heroItemIds: ['second-product'], supportingItemIds: [],
      requiredVisibleItems: selected, optionalVisibleItems: [], presentationScope: 'single_item_detail',
    },
    visibilityIntent: {
      ...editorial.visibilityIntent, heroItemIds: ['second-product'],
      requiredVisibleItems: selected, optionalVisibleItems: [], pairPolicy: 'not_selected', mode: 'subset',
    },
  };
  assert.doesNotThrow(() => validateCreativeDirectorV3Output([
    briefs[0], briefs[1], validDetail, briefs[3],
  ], input));
  const singlePrompt = compileCreativeDirectorV3ImagePrompt({
    brief: validDetail, productIdentity: input.productIdentity,
    productSemantics: input.productSemantics, userIntent: input.userIntent,
  });
  assert.doesNotMatch(singlePrompt, /EDITORIAL PRODUCT SEPARATION/);

  const genericStillLife = {
    ...validDetail,
    campaignIdea: 'A conventional studio arrangement',
    commercialObjective: 'Present the product in a conventional arrangement',
    visualStory: 'The product rests on a plain table in a standard composition',
    productPresentation: { ...validDetail.productPresentation, presentationMode: 'ordinary still life' },
    photography: {
      shotType: 'standard shot', cameraAngle: 'ordinary angle', framing: 'standard framing',
      lensLanguage: 'normal lens', depthOfField: 'general focus', lighting: 'basic studio light',
      contrast: 'medium contrast',
    },
  };
  assert.throws(() => validateCreativeDirectorV3Output([
    briefs[0], briefs[1], genericStillLife, briefs[3],
  ], input), /genuine craft or detail purpose/);
});

test('componentes estruturais observados são críticos sem promover evidência ambígua', () => {
  const normalized = validateExperimentalV3Request(request({ category: 'general' }));
  const componentAnalysis = {
    state: 'known',
    items: [{
      id: 'product-1', functionalType: { state: 'known', value: 'portable product' },
      quantity: { state: 'known', value: 1 }, observationCompleteness: 'partial',
      observedFeatures: [
        { id: 'strap-1', name: 'visible carrying strap', value: 'attached by a visible buckle' },
        { id: 'finish-1', name: 'surface finish', value: 'matte' },
      ],
      ambiguousFeatures: [{
        id: 'hidden-hook', name: 'possible hidden hook', visibility: 'hidden',
        observedConstraint: null, plausibleHypotheses: ['concealed hook'],
      }],
    }],
    relationships: [],
  };
  const input = buildCreativeDirectorV3Input({ analysis: componentAnalysis, request: normalized });
  assert.deepEqual(input.productIdentity.criticalFeatures.map(({ featureId }) => featureId), ['strap-1']);
  assert.deepEqual(input.productIdentity.structuralComponents.map(({ componentId, parentItemId }) =>
    ({ componentId, parentItemId })), [{ componentId: 'strap-1', parentItemId: 'product-1' }]);
  assert.equal(input.productIdentity.criticalFeatures.some(({ featureId }) => featureId === 'hidden-hook'), false);
  assert.equal(input.productIdentity.structuralComponents.some(({ componentId }) => componentId === 'hidden-hook'), false);
});

test('componente estrutural exige evidência observada correspondente e item pai conhecido', () => {
  const base = humanPresenceInput({ category: 'electronics', functionalType: 'portable electronic device', affordance: 'handheld' });
  const structural = {
    ...base,
    productIdentity: {
      ...base.productIdentity,
      criticalFeatures: [{
        itemId: 'product-1', featureId: 'hinge-1', name: 'visible hinge',
        value: 'source-observed folding joint', evidence: 'observed',
      }],
      structuralComponents: [{
        componentId: 'hinge-1', parentItemId: 'product-1', name: 'visible hinge',
        value: 'source-observed folding joint', evidence: 'observed', requiredWhenParentVisible: true,
      }],
    },
  };
  assert.doesNotThrow(() => validateCreativeDirectorV3Input(structural));
  assert.throws(() => validateCreativeDirectorV3Input({
    ...structural,
    productIdentity: {
      ...structural.productIdentity,
      structuralComponents: [{ ...structural.productIdentity.structuralComponents[0], componentId: 'invented-part' }],
    },
  }), /lacks matching explicit observed evidence/);
});

test('alocação validada impede duplicação e exige placement somente para interação humana', async () => {
  const categories = [
    ['clothing', 'wearable garment', 'wearable'],
    ['electronics', 'portable electronic device', 'handheld'],
    ['cosmetics', 'cosmetic container', 'handheld'],
    ['food', 'packaged food product', 'consumable'],
  ];
  for (const [category, functionalType, affordance] of categories) {
    const input = humanPresenceInput({ category, functionalType, affordance });
    const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
    assert.doesNotThrow(() => validateCreativeDirectorV3Output(briefs, input), category);
    const lifestyle = briefs[1];
    assert.equal(lifestyle.humanInteraction.unitAllocation.length, 1, category);
    const expectedPlacements = affordance === 'wearable' ? 1 : 0;
    assert.equal(lifestyle.humanInteraction.physicalPlacement.length, expectedPlacements, category);
    if (expectedPlacements) {
      assert.equal(lifestyle.humanInteraction.physicalPlacement[0].itemId, 'product-1', category);
      assert.ok(lifestyle.humanInteraction.physicalPlacement[0].interactionMode.length > 1, category);
    }
  }

  const input = humanPresenceInput({ category: 'clothing', functionalType: 'wearable product', affordance: 'wearable' });
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
  const invalidLifestyle = {
    ...briefs[1],
    humanInteraction: {
      ...briefs[1].humanInteraction,
      unitAllocation: [{
        itemId: 'product-1', canonicalQuantity: 1, humanAllocatedUnits: 1,
        sceneAllocatedUnits: 1, occludedOrOutOfFrameUnits: 0,
      }],
    },
  };
  assert.throws(() => validateCreativeDirectorV3Output([
    briefs[0], invalidLifestyle, briefs[2], briefs[3],
  ], input), /partition the complete canonical quantity/);
});

test('requiredVisible exige apresentação mínima sem restaurar opcionais ou omitidos', async () => {
  const input = validateCreativeDirectorV3Input({
    productIdentity: {
      category: 'wearable collection',
      items: [
        { id: 'neck-item', functionalType: 'neck-worn product', quantity: 1 },
        { id: 'paired-item', functionalType: 'paired body-worn product', quantity: 2 },
        { id: 'hand-item', functionalType: 'finger-worn product', quantity: 1 },
        { id: 'wrist-item', functionalType: 'wrist-worn product', quantity: 1 },
      ],
      relationships: [{ type: 'pair', itemIds: ['paired-item'] }],
      observedFeatures: [], ambiguousFeatures: [],
    },
    productSemantics: {
      functionalType: 'wearable product collection', affordances: ['wearable'],
      validContexts: ['physically plausible human use'], invalidContexts: ['invalid placement'],
    },
    userIntent: {
      objective: 'Create a general premium wearable campaign', aspectRatio: '1:1',
      requestedStyle: null, additionalInstructions: null,
    },
    generationPolicy: { proposalCount: 4, targetQuality: 'standard', creativeFreedom: 'high' },
  });
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
  const lifestyle = briefs[1];
  assert.doesNotThrow(() => validateCreativeDirectorV3Output(briefs, input));
  for (const required of lifestyle.productPresentation.requiredVisibleItems) {
    const allocation = lifestyle.humanInteraction.unitAllocation
      .find(({ itemId }) => itemId === required.itemId);
    assert.ok(allocation.humanAllocatedUnits + allocation.sceneAllocatedUnits >= 1);
    assert.ok(allocation.humanAllocatedUnits + allocation.sceneAllocatedUnits +
      allocation.occludedOrOutOfFrameUnits <= allocation.canonicalQuantity);
  }

  const replaceLifestyle = (humanInteraction, productPresentation = lifestyle.productPresentation,
    visibilityIntent = lifestyle.visibilityIntent) => [
    briefs[0], { ...lifestyle, humanInteraction, productPresentation, visibilityIntent },
    briefs[2], briefs[3],
  ];
  const hiddenRequired = {
    ...lifestyle.humanInteraction,
    unitAllocation: lifestyle.humanInteraction.unitAllocation.map((entry) =>
      entry.itemId === 'hand-item' ? {
        ...entry, humanAllocatedUnits: 0, sceneAllocatedUnits: 0,
        occludedOrOutOfFrameUnits: entry.canonicalQuantity,
      } : entry),
    physicalPlacement: lifestyle.humanInteraction.physicalPlacement
      .filter(({ itemId }) => itemId !== 'hand-item'),
  };
  assert.throws(() => validateCreativeDirectorV3Output(
    replaceLifestyle(hiddenRequired), input,
  ), /required visible item must have at least one unit presented/);

  const pairedPresented = {
    ...lifestyle.humanInteraction,
    unitAllocation: lifestyle.humanInteraction.unitAllocation.map((entry) =>
      entry.itemId === 'paired-item' ? {
        ...entry, humanAllocatedUnits: 1, sceneAllocatedUnits: 0,
        occludedOrOutOfFrameUnits: 1,
      } : entry),
    physicalPlacement: [
      ...lifestyle.humanInteraction.physicalPlacement,
      { itemId: 'paired-item', interactionMode: 'functionally valid human use',
        anatomicalAnchor: null, orientation: 'native functional orientation' },
    ],
  };
  assert.doesNotThrow(() => validateCreativeDirectorV3Output(
    replaceLifestyle(pairedPresented), input,
  ));

  const scenePresented = {
    ...lifestyle.humanInteraction,
    unitAllocation: lifestyle.humanInteraction.unitAllocation.map((entry) =>
      entry.itemId === 'hand-item' ? {
        ...entry, humanAllocatedUnits: 0, sceneAllocatedUnits: 1,
        occludedOrOutOfFrameUnits: 0,
      } : entry),
    physicalPlacement: lifestyle.humanInteraction.physicalPlacement
      .filter(({ itemId }) => itemId !== 'hand-item'),
  };
  assert.doesNotThrow(() => validateCreativeDirectorV3Output(
    replaceLifestyle(scenePresented), input,
  ));

  const required = lifestyle.productPresentation.requiredVisibleItems
    .filter(({ itemId }) => itemId !== 'wrist-item');
  const optional = [{ itemId: 'wrist-item', quantity: 1 }];
  const optionalHidden = {
    ...lifestyle.humanInteraction,
    unitAllocation: lifestyle.humanInteraction.unitAllocation.map((entry) =>
      entry.itemId === 'wrist-item' ? {
        ...entry, humanAllocatedUnits: 0, sceneAllocatedUnits: 0,
        occludedOrOutOfFrameUnits: 1,
      } : entry),
    physicalPlacement: lifestyle.humanInteraction.physicalPlacement
      .filter(({ itemId }) => itemId !== 'wrist-item'),
  };
  const optionalPresentation = {
    ...lifestyle.productPresentation, requiredVisibleItems: required, optionalVisibleItems: optional,
  };
  const optionalIntent = {
    ...lifestyle.visibilityIntent, requiredVisibleItems: required, optionalVisibleItems: optional,
  };
  assert.doesNotThrow(() => validateCreativeDirectorV3Output(
    replaceLifestyle(optionalHidden, optionalPresentation, optionalIntent), input,
  ));

  const subset = required.filter(({ itemId }) => itemId === 'hand-item');
  const subsetLifestyle = {
    ...lifestyle,
    productPresentation: {
      ...lifestyle.productPresentation, heroItemIds: ['hand-item'], supportingItemIds: [],
      requiredVisibleItems: subset, optionalVisibleItems: [], presentationScope: 'single_item_detail',
    },
    visibilityIntent: {
      ...lifestyle.visibilityIntent, heroItemIds: ['hand-item'], requiredVisibleItems: subset,
      optionalVisibleItems: [], pairPolicy: 'not_selected', mode: 'subset',
    },
    humanInteraction: {
      ...lifestyle.humanInteraction,
      unitAllocation: [{ itemId: 'hand-item', canonicalQuantity: 1,
        humanAllocatedUnits: 1, sceneAllocatedUnits: 0, occludedOrOutOfFrameUnits: 0 }],
      physicalPlacement: [{
        itemId: 'hand-item', interactionMode: 'functionally valid human use',
        anatomicalAnchor: 'functionally valid body anchor established by the product semantics',
        orientation: 'preserve the product native functional orientation',
      }],
    },
  };
  assert.doesNotThrow(() => validateCreativeDirectorV3Output([
    briefs[0], subsetLifestyle, briefs[2], briefs[3],
  ], input));
});

test('produto sem componente e briefing legado permanecem compatíveis', async () => {
  const input = humanPresenceInput({ category: 'food', functionalType: 'packaged food', affordance: 'consumable' });
  assert.deepEqual(input.productIdentity.structuralComponents, []);
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
  const legacy = briefs.map((brief) => ({
    ...brief,
    humanInteraction: {
      presence: brief.humanInteraction.presence,
      mode: brief.humanInteraction.mode,
      usageDescription: brief.humanInteraction.usageDescription,
    },
  }));
  assert.doesNotThrow(() => validateCreativeDirectorV3Output(legacy, input));
  const prompt = compileCreativeDirectorV3ImagePrompt({
    brief: legacy[0], productIdentity: input.productIdentity,
    productSemantics: input.productSemantics, userIntent: input.userIntent,
  });
  assert.doesNotMatch(prompt, /PARENT-BOUND STRUCTURAL COMPONENTS/);
});

test('conjunto misto preserva independência física e pair sem obrigar inventário no Editorial', async () => {
  const normalized = validateExperimentalV3Request(request());
  const mixed = validateCreativeDirectorV3Input(buildCreativeDirectorV3Input({
    analysis: {
      state: 'known',
      items: [
        analysis.items[0],
        {
          id: 'device-1', functionalType: { state: 'known', value: 'electronic device' },
          quantity: { state: 'known', value: 1 }, observationCompleteness: 'complete',
          observedFeatures: [], ambiguousFeatures: [],
        },
      ],
      relationships: analysis.relationships,
    },
    request: normalized,
  }));
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(mixed);
  const heroPrompt = compileCreativeDirectorV3ImagePrompt({
    brief: briefs[0], productIdentity: mixed.productIdentity,
    productSemantics: mixed.productSemantics, userIntent: mixed.userIntent,
  });
  assert.match(heroPrompt, /CANONICAL PRODUCT INDEPENDENCE/);
  assert.match(heroPrompt, /never fuse their geometry/);

  const editorial = {
    ...briefs[2],
    productPresentation: {
      ...briefs[2].productPresentation,
      heroItemIds: ['device-1'], supportingItemIds: [],
      requiredVisibleItems: [{ itemId: 'device-1', quantity: 1 }], optionalVisibleItems: [],
      presentationScope: 'single_item_detail',
    },
    visibilityIntent: {
      ...briefs[2].visibilityIntent,
      heroItemIds: ['device-1'], requiredVisibleItems: [{ itemId: 'device-1', quantity: 1 }],
      optionalVisibleItems: [], pairPolicy: 'not_selected', mode: 'subset',
    },
  };
  assert.doesNotThrow(() => validateCreativeDirectorV3Output([
    briefs[0], briefs[1], editorial, briefs[3],
  ], mixed));
});

test('Lifestyle wearable usa âncora semântica, não duplica worn units e preserva oclusão de par', async () => {
  const cases = [
    ['ear-compatible wearable', /ear or earlobe/],
    ['neck-compatible wearable', /neck or upper chest/],
    ['finger-compatible wearable', /finger compatible/],
    ['wrist-compatible wearable', /wrist compatible/],
    ['face-compatible eyewear', /face compatible/],
    ['protective footwear', /foot compatible/],
  ];
  for (const [functionalType, expectedAnchor] of cases) {
    const input = humanPresenceInput({ category: 'general', functionalType, affordance: 'wearable' });
    const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
    assert.match(briefs[1].humanInteraction.physicalPlacement[0].anatomicalAnchor, expectedAnchor);
    assert.deepEqual(briefs.filter(({ humanInteraction }) => humanInteraction.presence !== 'none')
      .map(({ campaignRole }) => campaignRole), ['contextual_lifestyle']);
  }

  const pairInput = validateCreativeDirectorV3Input({
    productIdentity: {
      category: 'wearable set',
      items: [{ id: 'pair-product', functionalType: 'ear-compatible wearable', quantity: 2 }],
      relationships: [{ type: 'pair', itemIds: ['pair-product'] }],
      observedFeatures: [], ambiguousFeatures: [],
    },
    productSemantics: {
      functionalType: 'ear-compatible wearable', affordances: ['wearable'],
      validContexts: ['realistic human use'], invalidContexts: ['invalid placement'],
    },
    userIntent: { objective: 'Natural premium campaign', aspectRatio: '1:1' },
    generationPolicy: { proposalCount: 4, targetQuality: 'standard', creativeFreedom: 'high' },
  });
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(pairInput);
  const allocation = briefs[1].humanInteraction.unitAllocation[0];
  assert.deepEqual(allocation, {
    itemId: 'pair-product', canonicalQuantity: 2, humanAllocatedUnits: 1,
    sceneAllocatedUnits: 0, occludedOrOutOfFrameUnits: 1,
  });
  assert.equal(allocation.humanAllocatedUnits + allocation.sceneAllocatedUnits +
    allocation.occludedOrOutOfFrameUnits, allocation.canonicalQuantity);
  assert.doesNotThrow(() => validateCreativeDirectorV3Output(briefs, pairInput));
  const lifestylePrompt = compileCreativeDirectorV3ImagePrompt({
    brief: briefs[1], productIdentity: pairInput.productIdentity,
    productSemantics: pairInput.productSemantics, userIntent: pairInput.userIntent,
  });
  assert.match(lifestylePrompt, /natural or ambient motivated light/);
  assert.match(lifestylePrompt, /Never repeat a human-worn, held, applied/);
  assert.match(lifestylePrompt, /only the naturally anchored unit may be clearly visible/);
});

test('assemblies terminais explicitamente observados permanecem ligados ao pai em Hero e Concept', async () => {
  const normalized = validateExperimentalV3Request(request({ category: 'general' }));
  const input = validateCreativeDirectorV3Input(buildCreativeDirectorV3Input({
    analysis: {
      state: 'known',
      items: [{
        id: 'parent-product', functionalType: { state: 'known', value: 'wearable product' },
        quantity: { state: 'known', value: 1 }, observationCompleteness: 'partial',
        observedFeatures: [{
          id: 'terminal-assembly', name: 'source-visible terminal assembly',
          value: 'observed closure and extension connector',
        }],
        ambiguousFeatures: [{
          id: 'hidden-mechanism', name: 'internal mechanism', visibility: 'hidden',
          observedConstraint: null, plausibleHypotheses: ['concealed mechanism'],
        }],
      }],
      relationships: [],
    },
    request: normalized,
  }));
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
  for (const index of [0, 3]) {
    const prompt = compileCreativeDirectorV3ImagePrompt({
      brief: briefs[index], productIdentity: input.productIdentity,
      productSemantics: input.productSemantics, userIntent: input.userIntent,
    });
    assert.match(prompt, /SOURCE-VISIBLE TERMINAL \/ CLOSURE ASSEMBLIES/);
    assert.match(prompt, /terminal-assembly with its canonical parent parent-product/);
    assert.match(prompt, /Do not omit, detach, transfer, duplicate, simplify/);
    assert.match(prompt, /Do not infer a hidden mechanism/);
    assert.doesNotMatch(prompt, /concealed mechanism/);
  }
});

test('alocação física particiona toda quantidade canônica uma única vez', async () => {
  const input = validateCreativeDirectorV3Input({
    productIdentity: {
      category: 'paired wearable',
      items: [{ id: 'paired-product', functionalType: 'paired wearable product', quantity: 2 }],
      relationships: [{ type: 'pair', itemIds: ['paired-product'] }],
      observedFeatures: [], ambiguousFeatures: [],
    },
    productSemantics: {
      functionalType: 'paired wearable product', affordances: ['wearable'],
      validContexts: ['valid human use'], invalidContexts: ['invalid placement'],
    },
    userIntent: { objective: 'Premium campaign', aspectRatio: '1:1' },
    generationPolicy: { proposalCount: 4, targetQuality: 'standard', creativeFreedom: 'high' },
  });
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
  const lifestyle = briefs[1];
  const validAllocation = [{
    itemId: 'paired-product', canonicalQuantity: 2, humanAllocatedUnits: 1,
    sceneAllocatedUnits: 0, occludedOrOutOfFrameUnits: 1,
  }];
  const validLifestyle = {
    ...lifestyle,
    humanInteraction: { ...lifestyle.humanInteraction, unitAllocation: validAllocation },
  };
  assert.doesNotThrow(() => validateCreativeDirectorV3Output([
    briefs[0], validLifestyle, briefs[2], briefs[3],
  ], input));
  const prompt = compileCreativeDirectorV3ImagePrompt({
    brief: validLifestyle, productIdentity: input.productIdentity,
    productSemantics: input.productSemantics, userIntent: input.userIntent,
  });
  assert.match(prompt, /must sum exactly to its canonical quantity/);
  assert.match(prompt, /Never repeat a human-worn, held, applied/);
  assert.throws(() => validateCreativeDirectorV3Output([
    briefs[0], {
      ...validLifestyle,
      humanInteraction: {
        ...validLifestyle.humanInteraction,
        unitAllocation: [{ ...validAllocation[0], occludedOrOutOfFrameUnits: 0 }],
      },
    }, briefs[2], briefs[3],
  ], input), /partition the complete canonical quantity/);
});

test('quatro campanhas recebem diversidade visual determinística sem recolorir o produto', async () => {
  const input = humanPresenceInput({
    category: 'electronics', functionalType: 'portable electronic device', affordance: 'handheld',
  });
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
  const prompts = briefs.map((brief) => compileCreativeDirectorV3ImagePrompt({
    brief, productIdentity: input.productIdentity,
    productSemantics: input.productSemantics, userIntent: input.userIntent,
  }));
  assert.match(prompts[0], /predominantly light, high-key/);
  assert.match(prompts[1], /natural or ambient motivated light/);
  assert.match(prompts[2], /clearly editorial material palette/);
  assert.match(prompts[3], /only campaign role that may be predominantly dark/);
  assert.equal(prompts.filter((prompt) => /only campaign role that may be predominantly dark/.test(prompt)).length, 1);
  for (const prompt of prompts) assert.match(prompt, /intrinsic (?:product )?colors/);
});

test('Campanha Conceitual isola um item ou uma relação atômica sem duplicação, fusão ou imitação', async () => {
  const input = validateCreativeDirectorV3Input({
    productIdentity: {
      category: 'mixed product set',
      items: [
        { id: 'main-product', functionalType: 'neck-compatible wearable', quantity: 1 },
        { id: 'paired-product', functionalType: 'ear-compatible wearable', quantity: 2 },
        { id: 'independent-product', functionalType: 'finger-compatible wearable', quantity: 1 },
      ],
      relationships: [{ type: 'pair', itemIds: ['paired-product'] }],
      observedFeatures: [], ambiguousFeatures: [],
    },
    productSemantics: {
      functionalType: 'wearable product set', affordances: ['wearable'],
      validContexts: ['premium campaign'], invalidContexts: ['hybrid products'],
    },
    userIntent: { objective: 'Premium mixed-set campaign', aspectRatio: '1:1' },
    generationPolicy: { proposalCount: 4, targetQuality: 'standard', creativeFreedom: 'high' },
  });
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
  const [hero, lifestyle, editorial, concept] = briefs;
  assert.deepEqual(hero.productPresentation.requiredVisibleItems.map(({ itemId }) => itemId),
    ['main-product', 'paired-product', 'independent-product']);
  assert.equal(lifestyle.humanInteraction.presence, 'required');
  assert.equal(editorial.productPresentation.presentationScope, 'single_item_detail');
  assert.equal(editorial.productPresentation.requiredVisibleItems.length, 1);
  assert.deepEqual(concept.productPresentation.requiredVisibleItems,
    [{ itemId: 'paired-product', quantity: 2 }]);
  assert.equal(concept.productPresentation.presentationScope, 'selected_subset');
  assert.equal(concept.visibilityIntent.pairPolicy, 'preserve_pair');
  assert.doesNotThrow(() => validateCreativeDirectorV3Output(briefs, input));

  const prompt = compileCreativeDirectorV3ImagePrompt({
    brief: concept, productIdentity: input.productIdentity,
    productSemantics: input.productSemantics, userIntent: input.userIntent,
  });
  assert.match(prompt, /Selected canonical IDs only: paired-product/);
  assert.match(prompt, /Exact selected visible quantity: 2 physical unit/);
  assert.match(prompt, /Explicitly omitted canonical IDs: main-product, independent-product/);
  assert.match(prompt, /Never add a third unit to a pair/);
  assert.match(prompt, /No prop, decoration, reflection, shadow, sculptural motif or environmental object may imitate/);
  assert.match(prompt, /Do not migrate any component, chain, terminal, stone, loop, rim, band/);

  const mixedConcept = {
    ...concept,
    productPresentation: {
      ...concept.productPresentation,
      heroItemIds: ['paired-product'], supportingItemIds: ['independent-product'],
      requiredVisibleItems: [
        { itemId: 'paired-product', quantity: 2 },
        { itemId: 'independent-product', quantity: 1 },
      ],
    },
    visibilityIntent: {
      ...concept.visibilityIntent,
      heroItemIds: ['paired-product'], requiredVisibleItems: [
        { itemId: 'paired-product', quantity: 2 },
        { itemId: 'independent-product', quantity: 1 },
      ],
    },
  };
  assert.doesNotThrow(() => validateCreativeDirectorV3Output([
    hero, lifestyle, editorial, mixedConcept,
  ], input));
});

test('Campanha Conceitual sem relação atômica seleciona duas unidades independentes', async () => {
  const input = validateCreativeDirectorV3Input({
    productIdentity: {
      category: 'independent products',
      items: [
        { id: 'product-a', functionalType: 'portable electronic device', quantity: 1 },
        { id: 'product-b', functionalType: 'cosmetic container', quantity: 1 },
      ],
      relationships: [], observedFeatures: [], ambiguousFeatures: [],
    },
    productSemantics: {
      functionalType: 'independent product set', affordances: ['surface_supported'],
      validContexts: ['commercial set'], invalidContexts: ['hybrid object'],
    },
    userIntent: { objective: 'Concept campaign', aspectRatio: '1:1' },
    generationPolicy: { proposalCount: 4, targetQuality: 'standard', creativeFreedom: 'high' },
  });
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
  assert.deepEqual(briefs[3].productPresentation.requiredVisibleItems,
    [{ itemId: 'product-b', quantity: 1 }, { itemId: 'product-a', quantity: 1 }]);
  assert.equal(briefs[3].productPresentation.presentationScope, 'selected_subset');
  assert.equal(briefs[3].visibilityIntent.pairPolicy, 'not_selected');
  assert.doesNotThrow(() => validateCreativeDirectorV3Output(briefs, input));
});

test('Product Identity wearable prevalece sobre category general sem inferência ambígua', async () => {
  for (const functionalType of ['neck-compatible wearable', 'ear-compatible wearable']) {
    const input = validateCreativeDirectorV3Input(buildCreativeDirectorV3Input({
      analysis: {
        state: 'known',
        items: [{
          id: 'wearable-item', functionalType: { state: 'known', value: functionalType },
          quantity: { state: 'known', value: functionalType.startsWith('ear') ? 2 : 1 },
          observationCompleteness: 'complete', observedFeatures: [], ambiguousFeatures: [],
        }],
        relationships: functionalType.startsWith('ear')
          ? [{ type: 'pair', memberIds: ['wearable-item'], state: 'known' }] : [],
      },
      request: validateExperimentalV3Request(request({ category: 'general' })),
    }));
    assert.deepEqual(input.productSemantics.affordances, ['wearable']);
    assert.deepEqual(input.productSemantics.wearableItemIds, ['wearable-item']);
    assert.equal(input.productSemantics.affordanceSource, 'product_identity');
    const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
    assert.equal(briefs[1].humanInteraction.presence, 'required');
    assert.ok(briefs[1].humanInteraction.unitAllocation
      .some(({ itemId, humanAllocatedUnits }) => itemId === 'wearable-item' && humanAllocatedUnits > 0));
  }

  const nonWearable = validateCreativeDirectorV3Input(buildCreativeDirectorV3Input({
    analysis: {
      state: 'known',
      items: [{
        id: 'device', functionalType: { state: 'known', value: 'portable electronic device' },
        quantity: { state: 'known', value: 1 }, observationCompleteness: 'complete',
        observedFeatures: [], ambiguousFeatures: [],
      }], relationships: [],
    },
    request: validateExperimentalV3Request(request({ category: 'general' })),
  }));
  assert.deepEqual(nonWearable.productSemantics.affordances, ['surface_supported']);
  assert.deepEqual(nonWearable.productSemantics.wearableItemIds, []);
  assert.equal(nonWearable.productSemantics.affordanceSource, 'category');
  const nonWearableBriefs = await createDeterministicCreativeDirectorV3Model().generate(nonWearable);
  assert.equal(nonWearableBriefs[1].humanInteraction.presence, 'none');
  assert.deepEqual(nonWearableBriefs[1].humanInteraction.physicalPlacement, []);
});

test('inventário misto aloca ao corpo somente item confirmado como wearable', async () => {
  const input = validateCreativeDirectorV3Input(buildCreativeDirectorV3Input({
    analysis: {
      state: 'known',
      items: [
        {
          id: 'device', functionalType: { state: 'known', value: 'portable electronic device' },
          quantity: { state: 'known', value: 1 }, observationCompleteness: 'complete',
          observedFeatures: [], ambiguousFeatures: [],
        },
        {
          id: 'wrist-item', functionalType: { state: 'known', value: 'wrist-compatible wearable' },
          quantity: { state: 'known', value: 1 }, observationCompleteness: 'complete',
          observedFeatures: [], ambiguousFeatures: [],
        },
      ], relationships: [],
    },
    request: validateExperimentalV3Request(request({ category: 'general' })),
  }));
  assert.deepEqual(input.productSemantics.wearableItemIds, ['wrist-item']);
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
  const lifestyle = briefs[1];
  assert.deepEqual(lifestyle.humanInteraction.physicalPlacement.map(({ itemId }) => itemId), ['wrist-item']);
  assert.equal(lifestyle.humanInteraction.unitAllocation.find(({ itemId }) => itemId === 'device').humanAllocatedUnits, 0);
  assert.equal(lifestyle.humanInteraction.unitAllocation.find(({ itemId }) => itemId === 'wrist-item').humanAllocatedUnits, 1);
  assert.doesNotThrow(() => validateCreativeDirectorV3Output(briefs, input));

  const prompt = compileCreativeDirectorV3ImagePrompt({
    brief: lifestyle, productIdentity: input.productIdentity,
    productSemantics: input.productSemantics, userIntent: input.userIntent,
  });
  assert.ok(prompt.startsWith('LIFESTYLE HUMAN PRESENCE — EXECUTION PRIORITY\nA realistic human person is mandatory'));
  assert.ok(prompt.endsWith('Final Lifestyle validation: a realistic human must be visibly present and using at least one allocated wearable unit. A product-only still life is invalid.'));
  const scene = prompt.match(/G\. SCENE\n([\s\S]*?)\n\nH\. ART DIRECTION/)?.[1] ?? '';
  assert.match(scene, /realistic human visibly wearing/);
  assert.doesNotMatch(scene, /complete required product identity on stable|tabletop|product-only/i);
  assert.match(prompt, /natural or ambient motivated light/);
});

test('seleção por role é determinística, usa riqueza observada e desempata por canonical ID', () => {
  const identity = validateCreativeDirectorV3Input({
    productIdentity: {
      category: 'general product set',
      items: [
        { id: 'item-z', functionalType: 'portable product', quantity: 1 },
        { id: 'item-b', functionalType: 'portable product', quantity: 1 },
        { id: 'item-a', functionalType: 'portable product', quantity: 1 },
      ],
      relationships: [], observedFeatures: [], ambiguousFeatures: [],
      observedFeatureEvidence: [
        { itemId: 'item-z', name: 'surface', value: 'observed finish' },
        { itemId: 'item-z', name: 'geometry', value: 'observed geometry' },
        { itemId: 'item-b', featureId: 'feature-b', name: 'connector', value: 'observed connector' },
      ],
      criticalFeatures: [
        { itemId: 'item-b', featureId: 'feature-b', name: 'connector', value: 'observed connector', evidence: 'observed' },
      ],
      structuralComponents: [{
        componentId: 'feature-b', parentItemId: 'item-b', name: 'connector',
        value: 'observed connector', evidence: 'observed', requiredWhenParentVisible: true,
      }],
    },
    productSemantics: {
      functionalType: 'portable products', affordances: ['surface_supported'],
      validContexts: ['commercial display'], invalidContexts: ['hybrid object'],
    },
    userIntent: { objective: 'Campaign', aspectRatio: '1:1' },
    generationPolicy: { proposalCount: 4, targetQuality: 'standard', creativeFreedom: 'high' },
  }).productIdentity;
  const first = selectDeterministicV3RoleItems(identity);
  const second = selectDeterministicV3RoleItems(identity);
  assert.deepEqual(first, second);
  assert.deepEqual(first.editorialSelectedIds, ['item-b']);
  assert.deepEqual(first.conceptualSelectedIds, ['item-a', 'item-z']);

  const structuralWins = selectDeterministicV3RoleItems({
    ...identity,
    criticalFeatures: [],
  });
  assert.deepEqual(structuralWins.editorialSelectedIds, ['item-b']);

  const observedWins = selectDeterministicV3RoleItems({
    ...identity,
    criticalFeatures: [], structuralComponents: [],
  });
  assert.deepEqual(observedWins.editorialSelectedIds, ['item-z']);

  const tie = selectDeterministicV3RoleItems({
    ...identity,
    items: identity.items.filter(({ id }) => ['item-a', 'item-z'].includes(id)),
    observedFeatureEvidence: [], criticalFeatures: [], structuralComponents: [],
  });
  assert.deepEqual(tie.editorialSelectedIds, ['item-a']);
});

test('Conceitual prefere relação atômica completa e evita repetir Editorial quando possível', () => {
  const selection = selectDeterministicV3RoleItems({
    category: 'general set',
    items: [
      { id: 'detail-rich', functionalType: 'product', quantity: 1 },
      { id: 'pair-member-a', functionalType: 'matching product', quantity: 1 },
      { id: 'pair-member-b', functionalType: 'matching product', quantity: 1 },
    ],
    relationships: [{ type: 'pair', itemIds: ['pair-member-a', 'pair-member-b'] }],
    observedFeatures: [], ambiguousFeatures: [], observedFeatureEvidence: [],
    criticalFeatures: [{
      itemId: 'detail-rich', featureId: 'detail-1', name: 'construction',
      value: 'observed construction', evidence: 'observed',
    }],
    structuralComponents: [],
  });
  assert.deepEqual(selection.editorialSelectedIds, ['detail-rich']);
  assert.deepEqual(selection.conceptualSelectedIds, ['pair-member-a', 'pair-member-b']);
  assert.equal(selection.selectionStrategy.conceptual, 'complete_atomic_relationship');
});

test('seleção local substitui seleção criativa do LLM sem alterar Hero ou Lifestyle', async () => {
  const input = validateCreativeDirectorV3Input({
    productIdentity: {
      category: 'wearable set',
      items: [
        { id: 'wearable-a', functionalType: 'wrist-compatible wearable', quantity: 1 },
        { id: 'product-b', functionalType: 'surface-supported accessory', quantity: 1 },
        { id: 'product-c', functionalType: 'surface-supported accessory', quantity: 1 },
      ],
      relationships: [], observedFeatures: [], ambiguousFeatures: [],
    },
    productSemantics: {
      functionalType: 'wearable set', affordances: ['wearable'], wearableItemIds: ['wearable-a'],
      validContexts: ['commercial context'], invalidContexts: ['invalid use'],
    },
    userIntent: { objective: 'Campaign', aspectRatio: '1:1' },
    generationPolicy: { proposalCount: 4, targetQuality: 'standard', creativeFreedom: 'high' },
  });
  const base = await createDeterministicCreativeDirectorV3Model().generate(input);
  const rogue = base.map((brief) => brief.campaignRole === 'editorial_craft_detail' || brief.campaignRole === 'concept_campaign'
    ? {
      ...brief,
      productPresentation: {
        ...brief.productPresentation, heroItemIds: ['wearable-a'], supportingItemIds: [],
        requiredVisibleItems: [{ itemId: 'wearable-a', quantity: 1 }], optionalVisibleItems: [],
        presentationScope: 'single_item_detail',
      },
      visibilityIntent: {
        ...brief.visibilityIntent, heroItemIds: ['wearable-a'],
        requiredVisibleItems: [{ itemId: 'wearable-a', quantity: 1 }], optionalVisibleItems: [], pairPolicy: 'not_selected',
      },
    } : brief);
  const result = await runCreativeDirectorV3({
    input,
    modelAdapter: { name: 'rogue-selection-adapter', generate: async () => rogue },
  });
  assert.deepEqual(result.briefs[0].productPresentation.requiredVisibleItems.map(({ itemId }) => itemId),
    ['wearable-a', 'product-b', 'product-c']);
  assert.equal(result.briefs[1].humanInteraction.presence, 'required');
  assert.deepEqual(result.editorialSelectedIds, ['product-b']);
  assert.deepEqual(result.conceptualSelectedIds, ['product-c', 'wearable-a']);
  assert.deepEqual(result.briefs[2].productPresentation.requiredVisibleItems.map(({ itemId }) => itemId), ['product-b']);
  assert.deepEqual(result.briefs[3].productPresentation.requiredVisibleItems.map(({ itemId }) => itemId), ['product-c', 'wearable-a']);
});

test('prompt Editorial contém somente fatos do item selecionado e IDs omitidos', async () => {
  const input = validateCreativeDirectorV3Input({
    productIdentity: {
      category: 'general set',
      items: [
        { id: 'selected-item', functionalType: 'precision product', quantity: 1 },
        { id: 'omitted-item', functionalType: 'different omitted type', quantity: 1 },
      ],
      relationships: [], observedFeatures: [], ambiguousFeatures: [],
      observedFeatureEvidence: [
        { itemId: 'selected-item', featureId: 'selected-feature', name: 'precision joint', value: 'selected construction' },
        { itemId: 'omitted-item', name: 'secret omitted ornament', value: 'must never migrate' },
      ],
      criticalFeatures: [{
        itemId: 'selected-item', featureId: 'selected-feature', name: 'precision joint',
        value: 'selected construction', evidence: 'observed',
      }],
      structuralComponents: [{
        componentId: 'selected-feature', parentItemId: 'selected-item', name: 'precision joint',
        value: 'selected construction', evidence: 'observed', requiredWhenParentVisible: true,
      }],
    },
    productSemantics: {
      functionalType: 'product set', affordances: ['surface_supported'],
      validContexts: ['commercial display'], invalidContexts: ['fusion'],
    },
    userIntent: { objective: 'Editorial detail', aspectRatio: '1:1' },
    generationPolicy: { proposalCount: 4, targetQuality: 'standard', creativeFreedom: 'high' },
  });
  const result = await runCreativeDirectorV3({
    input,
    modelAdapter: createDeterministicCreativeDirectorV3Model(),
  });
  const editorial = result.briefs.find(({ campaignRole }) => campaignRole === 'editorial_craft_detail');
  const prompt = compileCreativeDirectorV3ImagePrompt({
    brief: editorial, productIdentity: input.productIdentity,
    productSemantics: input.productSemantics, userIntent: input.userIntent,
  });
  assert.match(prompt, /selected-item: canonical functional type precision product; global locked quantity 1/);
  assert.match(prompt, /selected-feature belongs physically to selected-item/);
  assert.match(prompt, /NOT VISIBLE IN THIS IMAGE:\n- omitted-item/);
  assert.doesNotMatch(prompt, /different omitted type|secret omitted ornament|must never migrate/);
  assert.match(prompt, /Do not add, imply, substitute or transform another item into this omitted item/);
});

test('snapshot imutável faz generate usar zero chamadas ao Analyzer', async () => {
  let analyzerCalls = 0;
  let visualCalls = 0;
  const sha256 = '1'.repeat(64);
  const instance = createExperimentalV3GenerationService({
    assetStore: { readImage: async () => ({
      bytes: sourceBytes, mimeType: 'image/jpeg',
      metadata: { hash: sha256, width: 100, height: 100 },
    }) },
    productIdentityAnalyzer: { analyze: async () => { analyzerCalls += 1; return analysis; } },
    creativeDirectorAdapterFactory: () => createDeterministicCreativeDirectorV3Model(),
    imageProvider: { capabilities: testProviderCapabilities, generate: async () => {
      visualCalls += 1; return { imageBase64: 'aW1hZ2U=' };
    } },
  });
  const inventory = await instance.analyze(request());
  const batch = await instance.generate({
    ...request(), analysisId: inventory.analysisId, idempotencyKey: 'snapshot-generation',
  });
  assert.equal(analyzerCalls, 1);
  assert.equal(visualCalls, 4);
  assert.equal(batch.results.length, 4);
});

test('sessão expirada e source SHA divergente bloqueiam diretor e provider', async () => {
  let current = 1_000;
  let directorCalls = 0;
  let visualCalls = 0;
  let sourceHash = '1'.repeat(64);
  const sessions = createAnalysisSessionStore({ ttlMs: 10, now: () => current });
  const instance = createExperimentalV3GenerationService({
    analysisSessionStore: sessions,
    assetStore: { readImage: async () => ({
      bytes: sourceBytes, mimeType: 'image/jpeg', metadata: { hash: sourceHash, width: 1, height: 1 },
    }) },
    productIdentityAnalyzer: { analyze: async () => analysis },
    creativeDirectorAdapterFactory: () => { directorCalls += 1; return createDeterministicCreativeDirectorV3Model(); },
    imageProvider: { capabilities: testProviderCapabilities, generate: async () => {
      visualCalls += 1; return { imageBase64: 'x' };
    } },
  });
  const first = await instance.analyze(request());
  sourceHash = '2'.repeat(64);
  await assert.rejects(instance.generate({
    ...request(), analysisId: first.analysisId, idempotencyKey: 'source-mismatch',
  }), { code: 'ANALYSIS_SOURCE_MISMATCH' });
  sourceHash = '1'.repeat(64);
  const second = await instance.analyze(request());
  current += 11;
  await assert.rejects(instance.generate({
    ...request(), analysisId: second.analysisId, idempotencyKey: 'expired-session',
  }), { code: 'ANALYSIS_SESSION_EXPIRED' });
  assert.equal(directorCalls, 0);
  assert.equal(visualCalls, 0);
});

test('idempotência compartilha in-flight, conserva resultado e rejeita conflito', async () => {
  let directorCalls = 0;
  let visualCalls = 0;
  const instance = createExperimentalV3GenerationService({
    assetStore: { readImage: async () => ({
      bytes: sourceBytes, mimeType: 'image/jpeg',
      metadata: { hash: '3'.repeat(64), width: 100, height: 100 },
    }) },
    productIdentityAnalyzer: { analyze: async () => analysis },
    creativeDirectorAdapterFactory: () => ({
      name: 'mock-director',
      async generate(input) {
        directorCalls += 1;
        await Promise.resolve();
        return createDeterministicCreativeDirectorV3Model().generate(input);
      },
    }),
    imageProvider: { capabilities: testProviderCapabilities, generate: async () => {
      visualCalls += 1; return { imageBase64: 'aW1hZ2U=' };
    } },
  });
  const inventory = await instance.analyze(request());
  const payload = { ...request(), analysisId: inventory.analysisId, idempotencyKey: 'same-action-key' };
  const [first, second] = await Promise.all([instance.generate(payload), instance.generate(payload)]);
  assert.deepEqual(first, second);
  assert.equal(directorCalls, 1);
  assert.equal(visualCalls, 4);
  assert.deepEqual(await instance.generate(payload), first);
  assert.equal(visualCalls, 4);
  await assert.rejects(instance.generate({ ...payload, objective: 'Outro objetivo' }), {
    code: 'IDEMPOTENCY_CONFLICT',
  });
  await instance.generate({ ...payload, idempotencyKey: 'new-action-key' });
  assert.equal(directorCalls, 2);
  assert.equal(visualCalls, 8);
});

test('preflight global bloqueia limite da quarta campanha antes de qualquer imagem', async () => {
  let visualCalls = 0;
  const second = {
    ...analysis.items[0], id: 'second-item',
    quantity: { state: 'known', value: 1 },
    observedFeatures: analysis.items[0].observedFeatures.map((feature) => ({
      ...feature, id: `${feature.id}-second`,
    })),
  };
  const multi = { ...analysis, items: [{ ...analysis.items[0], quantity: { state: 'known', value: 1 } }, second], relationships: [] };
  const sourceHash = '4'.repeat(64);
  const isolatedIds = {
    'product-pair': '00000000-0000-4000-8000-000000000041',
    'second-item': '00000000-0000-4000-8000-000000000042',
  };
  const hashes = { 'product-pair': '5'.repeat(64), 'second-item': '6'.repeat(64) };
  const assets = new Map([
    [assetId, { bytes: sourceBytes, mimeType: 'image/jpeg', metadata: { hash: sourceHash, width: 10, height: 10 } }],
    ...Object.entries(isolatedIds).map(([itemId, id]) => [id, {
      bytes: Buffer.from(itemId), mimeType: 'image/png',
      metadata: { hash: hashes[itemId], width: 10, height: 10 },
    }]),
  ]);
  const deterministic = createDeterministicCreativeDirectorV3Model();
  const instance = createExperimentalV3GenerationService({
    assetStore: { readImage: async (id) => assets.get(id) },
    productIdentityAnalyzer: { analyze: async () => multi },
    runCreativeDirector: async ({ input }) => {
      const briefs = [...await deterministic.generate(input)];
      const lifestyle = briefs[1];
      const one = [{ itemId: 'product-pair', quantity: 1 }];
      briefs[1] = {
        ...lifestyle,
        productPresentation: { ...lifestyle.productPresentation, requiredVisibleItems: one, optionalVisibleItems: [] },
        humanInteraction: {
          ...lifestyle.humanInteraction,
          unitAllocation: [{ itemId: 'product-pair', canonicalQuantity: 1,
            humanAllocatedUnits: 1, sceneAllocatedUnits: 0, occludedOrOutOfFrameUnits: 0 }],
        },
      };
      return { briefs, schemaValid: true, diversityValid: true };
    },
    providerCapabilities: { ...testProviderCapabilities, maxInputImages: 1 },
    imageProvider: { generate: async () => { visualCalls += 1; return { imageBase64: 'x' }; } },
  });
  const inventory = await instance.analyze(request());
  const bindings = Object.entries(isolatedIds).map(([canonicalItemId, id]) => ({
    canonicalItemId, assetId: id, sourceKind: 'isolated_item', isolationState: 'isolated',
    isolationConfidence: 1, userConfirmed: true, mimeType: 'image/png', width: 10, height: 10,
    sha256: hashes[canonicalItemId],
  }));
  await assert.rejects(instance.generate({
    ...request(), analysisId: inventory.analysisId, idempotencyKey: 'reference-preflight',
    canonicalVisualAssets: bindings,
  }), (error) => error.code === 'PROVIDER_REFERENCE_LIMIT_EXCEEDED' &&
    error.details.referenceCount === 2 && error.details.maxInputImages === 1);
  assert.equal(visualCalls, 0);
});

test('boundary V3 preserva múltiplas referências como image[] no FormData real', async () => {
  const second = {
    ...analysis.items[0], id: 'second-item', functionalType: { state: 'known', value: 'independent product' },
    quantity: { state: 'known', value: 1 },
    observedFeatures: analysis.items[0].observedFeatures.map((feature) => ({
      ...feature, id: `${feature.id}-second`,
    })),
  };
  const multi = { ...analysis, items: [{ ...analysis.items[0], quantity: { state: 'known', value: 1 } }, second], relationships: [] };
  const sourceHash = '7'.repeat(64);
  const isolatedA = '00000000-0000-4000-8000-000000000071';
  const isolatedB = '00000000-0000-4000-8000-000000000072';
  const bytesA = Buffer.from('isolated-a');
  const bytesB = Buffer.from('isolated-b');
  const assets = new Map([
    [assetId, { bytes: sourceBytes, mimeType: 'image/jpeg', metadata: { hash: sourceHash, width: 10, height: 10 } }],
    [isolatedA, { bytes: bytesA, mimeType: 'image/png', metadata: { hash: '8'.repeat(64), width: 10, height: 10 } }],
    [isolatedB, { bytes: bytesB, mimeType: 'image/png', metadata: { hash: '9'.repeat(64), width: 10, height: 10 } }],
  ]);
  const forms = [];
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const provider = createOpenAIGPTImageBenchmarkProvider({
    apiKey: 'test-key-safe', logger: { warn() {} },
    fetchImpl: async (_url, options) => {
      forms.push(options.body);
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });
  const instance = createExperimentalV3GenerationService({
    assetStore: { readImage: async (id) => assets.get(id) },
    productIdentityAnalyzer: { analyze: async () => multi },
    creativeDirectorAdapterFactory: () => createDeterministicCreativeDirectorV3Model(),
    imageProvider: provider,
  });
  const inventory = await instance.analyze(request());
  await instance.generate({
    ...request(), analysisId: inventory.analysisId, idempotencyKey: 'real-form-data',
    canonicalVisualAssets: [
      { canonicalItemId: 'product-pair', assetId: isolatedA, sourceKind: 'isolated_item',
        isolationState: 'isolated', isolationConfidence: 1, userConfirmed: true,
        mimeType: 'image/png', width: 10, height: 10, sha256: '8'.repeat(64) },
      { canonicalItemId: 'second-item', assetId: isolatedB, sourceKind: 'isolated_item',
        isolationState: 'isolated', isolationConfidence: 1, userConfirmed: true,
        mimeType: 'image/png', width: 10, height: 10, sha256: '9'.repeat(64) },
    ],
  });
  assert.equal(forms.length, 4);
  const records = forms.map((form) => ({
    role: /Campaign role: ([a-z_]+)/.exec(form.get('prompt'))?.[1],
    selectedIds: /Selected canonical IDs(?: only)?: ([^\n.]+)/.exec(form.get('prompt'))?.[1]
      .split(',').map((value) => value.trim()),
    files: form.getAll('image[]'),
  }));
  const byRole = Object.fromEntries(records.map(({ role, files }) => [role, files]));
  assert.equal(byRole.hero_commercial.length, 1);
  assert.equal(byRole.editorial_craft_detail.length, 1);
  assert.equal(byRole.contextual_lifestyle.length, 2);
  const lifestyleBytes = await Promise.all(byRole.contextual_lifestyle.map(async (file) =>
    Buffer.from(await file.arrayBuffer())));
  assert.deepEqual(lifestyleBytes, [bytesA, bytesB]);
  assert.deepEqual(byRole.contextual_lifestyle.map(({ type }) => type), ['image/png', 'image/png']);
  const bytesById = new Map([['product-pair', bytesA], ['second-item', bytesB]]);
  for (const { role, selectedIds, files } of records.filter(({ selectedIds }) => selectedIds != null)) {
    const actual = await Promise.all(files.map(async (file) => Buffer.from(await file.arrayBuffer())));
    assert.deepEqual(actual, selectedIds.map((id) => bytesById.get(id)), `${role} must preserve selected ID order`);
  }
});
