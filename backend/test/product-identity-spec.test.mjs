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
