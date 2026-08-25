import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeterministicCreativeDirectorV3Model, validateCreativeDirectorV3Input, validateCreativeDirectorV3Output } from '../benchmark/creative-director-v3.mjs';
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
  await instance.generate(request({ category: 'jewelry' }));
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
    interactionMode: 'functionally valid human use', anatomicalAnchor: null,
    orientation: 'preserve the product native functional orientation',
  });
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /prompt|source-observed|plausibleHypotheses|Base64|data:image|Authorization|api[_-]?key/i);
});

test('telemetria observacional não altera prompt, seleção, resposta ou chamada visual', async () => {
  const baseline = service();
  const baselineResult = await baseline.instance.generate(request());
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
  const instrumentedResult = await instrumented.generate(request());
  assert.deepEqual(instrumentedResult, baselineResult);
  assert.equal(visualCalls.length, baseline.visualCalls.length);
  assert.deepEqual(visualCalls, baseline.visualCalls);
  assert.equal(events.filter(({ component }) => component === 'ExperimentalV3CanonicalInventory').length, 1);
  assert.equal(events.filter(({ component }) => component === 'ExperimentalV3PreProviderContract').length, 4);
});

test('uma direção lógica produz quatro briefs, quatro prompts e quatro chamadas visuais', async () => {
  const current = service();
  const batch = await current.instance.generate(request({ quality: 'high' }));
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
  const batch = await current.instance.generate(request());
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
  await assert.rejects(() => instance.generate(request()), { code: 'PRODUCT_ANALYSIS_REQUIRED', status: 503 });
});

test('Human Presence recomenda contexto humano somente no Lifestyle de vestíveis', async () => {
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
      'none', 'recommended', 'none', 'none',
    ]);
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

test('Editorial subset exige finalidade real de detalhe e separa múltiplos produtos', async () => {
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
  assert.match(multiPrompt, /EDITORIAL PRODUCT SEPARATION/);
  assert.match(multiPrompt, /independent physical object/);

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
    assert.equal(lifestyle.humanInteraction.physicalPlacement.length, 1, category);
    assert.equal(lifestyle.humanInteraction.physicalPlacement[0].itemId, 'product-1', category);
    assert.ok(lifestyle.humanInteraction.physicalPlacement[0].interactionMode.length > 1, category);
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
  ], input), /exceeds canonical quantity/);
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
        humanAllocatedUnits: 0, sceneAllocatedUnits: 1, occludedOrOutOfFrameUnits: 0 }],
      physicalPlacement: [],
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
