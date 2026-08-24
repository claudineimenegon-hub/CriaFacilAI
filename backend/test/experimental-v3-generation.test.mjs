import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeterministicCreativeDirectorV3Model, validateCreativeDirectorV3Input } from '../benchmark/creative-director-v3.mjs';
import { compileCreativeDirectorV3ImagePrompt } from '../benchmark/creative-director-v3-image-prompt-compiler.mjs';
import {
  buildCreativeDirectorV3Input,
  createExperimentalV3GenerationService,
  experimentalOutputDimensions,
  validateExperimentalV3Request,
} from '../experimental-v3/experimental-v3-generation-service.mjs';

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
      observedFeatures: [{ name: 'color', value: 'source-observed blue' }],
      ambiguousFeatures: [{ name: 'hidden-back', visibility: 'hidden', observedConstraint: null, plausibleHypotheses: [] }],
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

test('ponte constrói Product Identity V3 real sem fixture e preserva pair e evidência', () => {
  const normalized = validateExperimentalV3Request(request());
  const input = buildCreativeDirectorV3Input({ analysis, request: normalized });
  assert.deepEqual(input.productIdentity.items, [{ id: 'product-pair', functionalType: 'wearable product', quantity: 2 }]);
  assert.deepEqual(input.productIdentity.relationships, [{ type: 'pair', itemIds: ['product-pair'] }]);
  assert.match(input.productIdentity.observedFeatures[0], /source-observed blue/);
  assert.equal(JSON.stringify(input).includes('fixture'), false);
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
    .split('D. HUMAN INTERACTION / VALID USE')[0];
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
