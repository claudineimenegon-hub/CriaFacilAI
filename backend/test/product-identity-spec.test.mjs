import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createProductIdentitySpecification,
  summarizeProductIdentitySpecification,
} from '../image-to-image/product-identity-spec.mjs';
import {
  createProductFidelityPolicy,
  GLOBAL_PRODUCT_FIDELITY_RULES,
} from '../image-to-image/product-fidelity-policy.mjs';
import { ProductPhotoConceptPlanner } from '../image-to-image/product-photo-concept-planner.mjs';
import { ProductPhotoPromptBuilder } from '../image-to-image/product-photo-prompt-builder.mjs';
import { generateProductPhotoBatch } from '../image-to-image/image-transform-service.mjs';
import { DeterministicProductIdentityAnalyzer } from './support/deterministic-product-identity-analyzer.mjs';

const sourceInventory = {
  state: 'known',
  items: [
    {
      id: 'product-a',
      functionalType: { state: 'known', value: 'wearable product' },
      quantity: { state: 'known', value: 1 },
      observationCompleteness: 'partial',
      observedFeatures: [
        { name: 'front geometry', value: 'oval face with two aligned controls' },
        { name: 'material', value: 'brushed silver metal' },
      ],
      ambiguousFeatures: [
        {
          name: 'hidden rear structure',
          visibility: 'hidden',
          observedConstraint: 'must join the two visible side anchors',
          plausibleHypotheses: [
            'single continuous curved support joining both visible side anchors',
            'two-piece hinged support',
          ],
        },
      ],
    },
  ],
  relationships: [],
};

test('ausência de evidência permanece unknown sem inventar inventário', () => {
  const specification = createProductIdentitySpecification({
    category: 'jewelry',
    preservation: { preserveProduct: true },
  });

  assert.equal(specification.sourceInventory.state, 'unknown');
  assert.equal(specification.sourceInventory.items.length, 0);
  assert.equal(specification.sourceInventory.relationships.length, 0);
  assert.equal(specification.sourceInventory.observationRequired, true);
  assert.equal(specification.productIdentity.category.state, 'uncertain');
  assert.match(summarizeProductIdentitySpecification(specification), /do not invent type, count, relations, or attributes/i);
});

test('inventário explícito preserva tipos, quantidades e relação sem completar lacunas', () => {
  const specification = createProductIdentitySpecification({
    category: 'jewelry',
    sourceInventory: {
      state: 'known',
      items: [
        { id: 'ring-1', functionalType: 'ring', quantity: 1 },
        { id: 'earrings', functionalType: 'earring', quantity: 2 },
        { id: 'unclassified', typeState: 'unknown', quantityState: 'unknown' },
      ],
      relationships: [
        { type: 'pair', memberIds: ['earrings'], state: 'known' },
      ],
    },
  });

  assert.equal(specification.sourceInventory.state, 'known');
  assert.equal(specification.sourceInventory.items[0].functionalType.value, 'ring');
  assert.equal(specification.sourceInventory.items[1].quantity.value, 2);
  assert.equal(specification.sourceInventory.items[2].functionalType.state, 'unknown');
  assert.equal(specification.sourceInventory.items[2].quantity.value, null);
  assert.deepEqual(specification.sourceInventory.relationships[0].memberIds, ['earrings']);
});

test('identidade é estável e visibilityIntent pertence a cada proposta', () => {
  const identity = createProductIdentitySpecification({ category: 'perfume' });
  const plan = new ProductPhotoConceptPlanner().plan({
    productCategory: 'perfume',
    prompt: 'Premium perfume campaign with detail and contextual use',
  });

  assert.equal(identity.productIdentity.stableAcrossScenes, true);
  assert.equal(plan.concepts.length, 4);
  assert.ok(plan.concepts.every(({ visibilityIntent }) => visibilityIntent?.mode));
  assert.ok(new Set(plan.concepts.map(({ visibilityIntent }) => visibilityIntent.mode)).size >= 3);
  assert.equal(Object.hasOwn(identity, 'visibilityIntent'), false);
});

test('subset altera visibilidade sem permitir conversão semântica', () => {
  const planner = new ProductPhotoConceptPlanner();
  const builder = new ProductPhotoPromptBuilder();
  const plan = planner.plan({ productCategory: 'jewelry', prompt: 'Premium selected pieces campaign' });
  const subset = plan.concepts.find(({ visibilityIntent }) => visibilityIntent.mode === 'subset');
  assert.ok(subset);
  const prompt = builder.build({
    prompt: 'Premium selected pieces campaign',
    preservation: { preserveProduct: true },
    plan,
    concept: subset,
  });

  assert.match(prompt, /VISIBILITY INTENT: subset/);
  assert.match(prompt, /justified subset/i);
  assert.match(prompt, /never changes source inventory or product identity/i);
  assert.match(prompt, /no semantic conversion/i);
  assert.doesNotMatch(prompt, /must show every|show all source/i);
});

test('política global é genérica e regras de categoria são condicionais', () => {
  const globalText = GLOBAL_PRODUCT_FIDELITY_RULES.join(' ');
  assert.match(globalText, /functional type/);
  assert.match(globalText, /Never convert one object or product into another/);
  assert.match(globalText, /Never invent or arbitrarily duplicate/);
  assert.doesNotMatch(globalText, /jewel|ring|earring|gem|stone|joia|anel|brinco/i);

  const jewelry = createProductFidelityPolicy({ category: 'jewelry' });
  const perfume = createProductFidelityPolicy({ category: 'perfume' });
  const electronics = createProductFidelityPolicy({ category: 'electronics' });
  const food = createProductFidelityPolicy({ category: 'food' });
  const general = createProductFidelityPolicy({ category: 'general' });
  assert.match(jewelry.categoryRules.join(' '), /gem color\/position/);
  assert.doesNotMatch(perfume.categoryRules.join(' '), /gem|jewelry/i);
  assert.match(perfume.categoryRules.join(' '), /bottle geometry/);
  assert.match(electronics.categoryRules.join(' '), /camera count/);
  assert.match(food.categoryRules.join(' '), /food identity/);
  assert.equal(general.categoryRules.length, 0);
});

test('intenção do usuário influencia visibilidade sem forçar uso incompatível', () => {
  const planner = new ProductPhotoConceptPlanner();
  const perfume = planner.plan({
    productCategory: 'perfume',
    prompt: 'Modelo segurando o perfume com foco em detalhes',
  });
  assert.deepEqual(perfume.understanding.requestedVisibilityModes, [
    'macro_detail', 'contextual_use',
  ]);
  assert.ok(perfume.concepts.some(({ visibilityIntent }) => visibilityIntent.mode === 'contextual_use'));

  const food = planner.plan({
    productCategory: 'food',
    prompt: 'Campanha com detalhes do alimento e serviço natural',
  });
  assert.ok(food.concepts.every(({ name }) => !name.includes('WORN')));
});

test('observed features são evidência imutável da identidade canônica', () => {
  const identity = createProductIdentitySpecification({
    category: 'accessory',
    sourceInventory,
  });
  const observed = identity.sourceInventory.items[0].observedFeatures[0];

  assert.deepEqual(observed, {
    id: 'front geometry',
    name: 'front geometry',
    value: 'oval face with two aligned controls',
    evidence: 'observed',
    immutable: true,
  });
  assert.throws(() => { observed.value = 'different geometry'; }, TypeError);
  assert.equal(identity.productIdentity.observedEvidenceImmutable, true);
});

test('feature oculta recebe uma única hipótese canônica explicitamente incerta', () => {
  const identity = createProductIdentitySpecification({
    category: 'accessory',
    sourceInventory,
  });
  const hidden = identity.sourceInventory.items[0].ambiguousFeatures[0];

  assert.equal(hidden.evidence, 'ambiguous');
  assert.equal(hidden.canonicalHypothesis.confidence, 'uncertain');
  assert.equal(hidden.canonicalHypothesis.provenance, 'deterministic_candidate_selection');
  assert.equal(hidden.canonicalHypothesis.value,
    'single continuous curved support joining both visible side anchors');
});

test('a mesma identidade e hipótese canônica são compartilhadas pelos quatro prompts', async () => {
  const receivedIdentities = [];
  const delegate = new ProductPhotoPromptBuilder();
  const promptBuilder = {
    build: (input) => {
      receivedIdentities.push(input.identitySpecification);
      return delegate.build(input);
    },
  };
  const request = {
    prompt: 'Generic premium product campaign',
    inputAssetIds: ['asset-1'],
    aspectRatio: '1:1',
    quality: 'standard',
    preservation: { preserveProduct: true },
    parameters: { common: { productCategory: 'accessories', sourceInventory } },
  };
  await generateProductPhotoBatch({
    provider: { generate: async () => ({ imageBase64: 'aW1hZ2U=' }) },
    assetStore: {
      readImage: async () => ({
        bytes: Buffer.from('image'), mimeType: 'image/png', metadata: {},
      }),
    },
    request,
    promptBuilder,
    productIdentityAnalyzer: new DeterministicProductIdentityAnalyzer({ result: sourceInventory }),
    creativeDirectorLogger: undefined,
  });

  assert.equal(receivedIdentities.length, 4);
  assert.ok(receivedIdentities.every((identity) => identity === receivedIdentities[0]));
  const hypothesis = 'single continuous curved support joining both visible side anchors';
  assert.ok(receivedIdentities.every((identity) =>
    identity.sourceInventory.items[0].ambiguousFeatures[0].canonicalHypothesis.value === hypothesis));
});

test('conceitos não podem redefinir independentemente a identidade inferida', async () => {
  const basePlanner = new ProductPhotoConceptPlanner();
  const invalidPlanner = {
    understand: (input) => basePlanner.understand(input),
    plan: (input) => {
      const plan = basePlanner.plan(input);
      return {
        ...plan,
        concepts: plan.concepts.map((concept, index) => index === 0
          ? { ...concept, canonicalIdentity: { independentlyRedefined: true } }
          : concept),
      };
    },
  };
  await assert.rejects(generateProductPhotoBatch({
    provider: { generate: async () => ({ imageBase64: 'aW1hZ2U=' }) },
    assetStore: {
      readImage: async () => ({
        bytes: Buffer.from('image'), mimeType: 'image/png', metadata: {},
      }),
    },
    request: {
      prompt: 'Generic campaign', inputAssetIds: ['asset-1'], aspectRatio: '1:1',
      quality: 'standard', preservation: {}, parameters: { common: {} },
    },
    conceptPlanner: invalidPlanner,
  }), /CONCEPT_MUST_NOT_OVERRIDE_CANONICAL_IDENTITY/);
});

test('produto totalmente observável não recebe hipótese desnecessária', () => {
  const identity = createProductIdentitySpecification({
    category: 'electronics',
    sourceInventory: {
      state: 'known',
      items: [{
        functionalType: 'device', quantity: 1, observationCompleteness: 'complete',
        observedFeatures: [{ name: 'geometry', value: 'all six faces visible' }],
        ambiguousFeatures: [{ name: 'rear', plausibleHypotheses: ['invented rear'] }],
      }],
    },
  });
  assert.equal(identity.sourceInventory.items[0].ambiguousFeatures.length, 0);
  assert.doesNotMatch(summarizeProductIdentitySpecification(identity), /HIDDEN HYPOTHESES/);
});

test('fonte multi-product conhecida produz Hero Set e mantém opções de subconjunto', () => {
  const identity = createProductIdentitySpecification({
    category: 'accessory',
    sourceInventory: {
      state: 'known',
      items: [
        { id: 'item-a', functionalType: 'product', quantity: 1 },
        { id: 'item-b', functionalType: 'product', quantity: 2 },
      ],
    },
  });
  const plan = new ProductPhotoConceptPlanner().plan({
    productCategory: 'accessories',
    prompt: 'Sophisticated generic campaign',
    canonicalIdentity: identity,
  });
  const heroSet = plan.concepts.find(({ name }) => name === 'HERO SET / PREMIUM STILL LIFE');

  assert.ok(heroSet);
  assert.deepEqual(heroSet.visibilityIntent, {
    mode: 'full_set', selection: 'all_observed_items', allowPartialVisibility: false,
  });
  assert.match(heroSet.environment, /category-appropriate/);
  assert.ok(plan.concepts.some(({ visibilityIntent }) =>
    visibilityIntent.allowPartialVisibility && visibilityIntent.mode !== 'full_set'));
});

test('modelo canônico permanece genérico e não contém regra global de joias', () => {
  const implementation = [
    normalizeForGenericAssertion(createProductIdentitySpecification.toString()),
    normalizeForGenericAssertion(summarizeProductIdentitySpecification.toString()),
  ].join(' ');
  assert.doesNotMatch(implementation, /ring|earring|necklace|jewel|anel|brinco|colar/i);
});

function normalizeForGenericAssertion(value) {
  return value.replace(/\s+/g, ' ');
}
