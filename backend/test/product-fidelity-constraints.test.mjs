import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compileProductFidelityConstraints,
  quantitativeVisibilityIntent,
} from '../image-to-image/product-fidelity-constraints.mjs';
import { createProductIdentitySpecification } from '../image-to-image/product-identity-spec.mjs';
import { ProductPhotoConceptPlanner } from '../image-to-image/product-photo-concept-planner.mjs';
import { ProductPhotoPromptBuilder } from '../image-to-image/product-photo-prompt-builder.mjs';
import { generateProductPhotoBatch } from '../image-to-image/image-transform-service.mjs';
import { DeterministicProductIdentityAnalyzer } from './support/deterministic-product-identity-analyzer.mjs';

function item({ id, type, typeState = 'known', quantity = 1, quantityState = 'known',
  observedFeatures = [], ambiguousFeatures = [], completeness = 'complete' }) {
  return {
    id,
    functionalType: { state: typeState, value: typeState === 'unknown' ? null : type },
    quantity: { state: quantityState, value: quantityState === 'unknown' ? null : quantity },
    observationCompleteness: completeness,
    observedFeatures,
    ambiguousFeatures,
  };
}

function identity({ items, relationships = [], category = 'general' }) {
  return createProductIdentitySpecification({
    category,
    sourceInventory: { state: 'known', items, relationships },
    preservation: { preserveProduct: true, preserveProportions: true },
  });
}

function jewelrySet() {
  return identity({
    category: 'jewelry',
    items: [
      item({
        id: 'ring-1', type: 'ring', observedFeatures: [
          { id: 'ring-shape', name: 'visible geometry', value: 'round band with raised setting' },
          { id: 'ring-polish', name: 'surface finish', value: 'polished reflective metal' },
        ],
      }),
      item({
        id: 'earrings', type: 'earring', quantity: 2, observedFeatures: [
          { id: 'earring-shape', name: 'visible geometry', value: 'matching drop silhouette' },
          { id: 'earring-optics', name: 'gemstone appearance', value: 'faceted transparent stones with crisp optical highlights' },
        ],
      }),
    ],
    relationships: [
      { type: 'pair', memberIds: ['earrings'], state: 'known' },
      { type: 'set', memberIds: ['ring-1', 'earrings'], state: 'known' },
    ],
  });
}

test('compila type/count locks e mantém features vinculadas ao item', () => {
  const constraints = compileProductFidelityConstraints(jewelrySet());
  assert.deepEqual(constraints.itemLocks.map(({ itemId, functionalType, sourceCount }) => ({
    itemId, functionalType, sourceCount,
  })), [
    {
      itemId: 'ring-1', functionalType: { state: 'known', value: 'ring' },
      sourceCount: { state: 'known', value: 1 },
    },
    {
      itemId: 'earrings', functionalType: { state: 'known', value: 'earring' },
      sourceCount: { state: 'known', value: 2 },
    },
  ]);
  assert.deepEqual(constraints.itemLocks[0].observedFeatureIds, ['ring-shape', 'ring-polish']);
  assert.deepEqual(constraints.itemLocks[1].observedFeatureIds, ['earring-shape', 'earring-optics']);
  assert.equal(constraints.globalLocks.crossItemMutationForbidden, true);
});

test('tipo e quantidade unknown permanecem unknown sem invenção', () => {
  const constraints = compileProductFidelityConstraints(identity({
    items: [item({
      id: 'unknown-item', typeState: 'unknown', quantityState: 'unknown', completeness: 'unknown',
    })],
  }));
  assert.deepEqual(constraints.itemLocks[0].functionalType, { state: 'unknown', value: null });
  assert.deepEqual(constraints.itemLocks[0].sourceCount, { state: 'unknown', value: null });
  assert.deepEqual(constraints.materialAppearance, []);
});

test('pair conhecido com duas unidades gera requiredCount 2', () => {
  const constraints = compileProductFidelityConstraints(jewelrySet());
  const pair = constraints.relationshipLocks.find(({ type }) => type === 'pair');
  assert.deepEqual(pair, {
    type: 'pair', memberItemIds: ['earrings'], requiredCount: 2, state: 'known',
  });
});

test('pair incompatível com quantidade fica uncertain sem inventar cardinalidade', () => {
  const constraints = compileProductFidelityConstraints(identity({
    items: [item({ id: 'unit', type: 'generic product', quantity: 1 })],
    relationships: [{ type: 'pair', memberIds: ['unit'], state: 'known' }],
  }));
  assert.deepEqual(constraints.relationshipLocks[0], {
    type: 'pair', memberItemIds: ['unit'], requiredCount: null, state: 'uncertain',
  });
});

test('full set e subset selecionam IDs e quantidades explicitamente', () => {
  const constraints = compileProductFidelityConstraints(jewelrySet());
  const full = quantitativeVisibilityIntent({
    mode: 'full_set', selection: 'all_observed_items', allowPartialVisibility: false,
  }, constraints);
  const subset = quantitativeVisibilityIntent({
    mode: 'subset', selection: 'explicit_evidenced_selection', allowPartialVisibility: true,
  }, constraints);
  assert.deepEqual(full.selectedItems.map(({ itemId, quantity }) => ({ itemId, quantity })), [
    { itemId: 'ring-1', quantity: 1 }, { itemId: 'earrings', quantity: 2 },
  ]);
  assert.deepEqual(subset.selectedItems.map(({ itemId, quantity }) => ({ itemId, quantity })), [
    { itemId: 'ring-1', quantity: 1 },
  ]);
  assert.equal(full.pairPolicy, 'preserve_pair');
});

test('pair só perde uma unidade com seleção explicit_single_instance', () => {
  const pairOnly = compileProductFidelityConstraints(identity({
    items: [item({ id: 'paired-item', type: 'generic wearable', quantity: 2 })],
    relationships: [{ type: 'pair', memberIds: ['paired-item'], state: 'known' }],
  }));
  const subset = quantitativeVisibilityIntent({
    mode: 'subset', selection: 'explicit_evidenced_selection', allowPartialVisibility: true,
  }, pairOnly);
  const macro = quantitativeVisibilityIntent({
    mode: 'macro_detail', selection: 'reference_visible_detail', allowPartialVisibility: true,
  }, pairOnly);
  assert.equal(subset.selectedItems[0].quantity, 2);
  assert.equal(subset.pairPolicy, 'preserve_pair');
  assert.equal(macro.selectedItems[0].quantity, 1);
  assert.equal(macro.pairPolicy, 'explicit_single_instance');
});

test('planner produz Hero Set quantitativo para inventário múltiplo conhecido', () => {
  const canonicalIdentity = jewelrySet();
  const fidelityConstraints = compileProductFidelityConstraints(canonicalIdentity);
  const plan = new ProductPhotoConceptPlanner().plan({
    productCategory: 'jewelry', prompt: 'Premium campaign',
    canonicalIdentity, fidelityConstraints,
  });
  const heroSet = plan.concepts.find(({ visibilityIntent }) =>
    visibilityIntent.mode === 'full_set');
  assert.deepEqual(heroSet.visibilityIntent.selectedItems.map(({ itemId, quantity }) => ({
    itemId, quantity,
  })), [{ itemId: 'ring-1', quantity: 1 }, { itemId: 'earrings', quantity: 2 }]);
  assert.equal(heroSet.visibilityIntent.pairPolicy, 'preserve_pair');
});

test('prompt prioritário contém locks de tipo, par, escala e material observado', () => {
  const canonicalIdentity = jewelrySet();
  const fidelityConstraints = compileProductFidelityConstraints(canonicalIdentity);
  const planner = new ProductPhotoConceptPlanner();
  const plan = planner.plan({
    productCategory: 'jewelry', prompt: 'Premium campaign',
    canonicalIdentity, fidelityConstraints,
  });
  const lifestyle = plan.concepts.find(({ name }) => name === 'LIFESTYLE / WORN IN USE');
  const prompt = new ProductPhotoPromptBuilder().build({
    prompt: 'Premium campaign', preservation: {
      preserveProduct: true, preserveProportions: true, preserveColors: true,
    }, plan, concept: lifestyle, identitySpecification: canonicalIdentity,
    fidelityConstraints,
  });
  assert.match(prompt, /ring-1=1xring/);
  assert.match(prompt, /earrings=2xearring/);
  assert.match(prompt, /no merge, conversion, substitution, duplication, or cross-item feature transfer/i);
  assert.match(prompt, /must remain a complete pair of 2/i);
  assert.match(prompt, /SCALE LOCK: plausible real size relative to body\/context/i);
  assert.match(prompt, /prominence via framing.*never enlargement/i);
  assert.match(prompt, /Proportions stay separate/i);
  assert.match(prompt, /ring-1\.surface finish=polished reflective metal/i);
  assert.match(prompt, /earrings\.gemstone appearance=faceted transparent stones with crisp optical highlights/i);
  assert.ok(prompt.length <= 2048);
});

test('material appearance usa somente observedFeatures e não presume pela categoria', () => {
  const observed = compileProductFidelityConstraints(jewelrySet());
  assert.deepEqual(observed.materialAppearance.map(({ itemId, featureId }) => ({ itemId, featureId })), [
    { itemId: 'ring-1', featureId: 'ring-polish' },
    { itemId: 'earrings', featureId: 'earring-optics' },
  ]);
  const unknown = compileProductFidelityConstraints(identity({
    category: 'jewelry', items: [item({ id: 'jewel', type: 'wearable product' })],
  }));
  assert.deepEqual(unknown.materialAppearance, []);
});

test('constraints prioritárias sobrevivem a brief longo e quatro direções continuam distintas', () => {
  const canonicalIdentity = jewelrySet();
  const fidelityConstraints = compileProductFidelityConstraints(canonicalIdentity);
  const plan = new ProductPhotoConceptPlanner().plan({
    productCategory: 'jewelry', prompt: `Launch. ${'Secondary creative detail. '.repeat(40)}`,
    canonicalIdentity, fidelityConstraints,
  });
  const prompts = plan.concepts.map((concept) => new ProductPhotoPromptBuilder().build({
    prompt: `Launch. ${'Secondary creative detail. '.repeat(40)}`,
    preservation: { preserveProduct: true, preserveProportions: true },
    plan, concept, identitySpecification: canonicalIdentity, fidelityConstraints,
  }));
  assert.equal(new Set(prompts).size, 4);
  for (const prompt of prompts) {
    assert.match(prompt, /ITEM LOCKS: ring-1=1xring; earrings=2xearring/);
    assert.match(prompt, /OBSERVED MATERIAL APPEARANCE/);
    assert.match(prompt, /SCALE LOCK/);
    assert.ok(prompt.length <= 2048);
  }
});

test('orçamento inclui evidências inteiras por prioridade e marca omissões sem truncar', () => {
  const richItems = Array.from({ length: 3 }, (_, itemIndex) => item({
    id: `product-${itemIndex + 1}`,
    type: 'premium accessory',
    completeness: 'partial',
    observedFeatures: Array.from({ length: 12 }, (_, featureIndex) => ({
      id: `observed-${itemIndex}-${featureIndex}`,
      name: featureIndex === 0 ? 'distinctive geometry' : `secondary feature ${featureIndex}`,
      value: `COMPLETE_OBSERVED_${itemIndex}_${featureIndex} ${'visual detail '.repeat(5).trim()}`,
    })),
    ambiguousFeatures: Array.from({ length: 6 }, (_, featureIndex) => ({
      id: `ambiguous-${itemIndex}-${featureIndex}`,
      name: `hidden structure ${featureIndex}`,
      visibility: 'hidden',
      observedConstraint: null,
      plausibleHypotheses: [`COMPLETE_HYPOTHESIS_${itemIndex}_${featureIndex} ${'continuation '.repeat(4).trim()}`],
    })),
  }));
  const canonicalIdentity = identity({
    items: richItems,
    relationships: [{ type: 'set', memberIds: richItems.map(({ id }) => id), state: 'known' }],
  });
  const fidelityConstraints = compileProductFidelityConstraints(canonicalIdentity);
  const plan = new ProductPhotoConceptPlanner().plan({
    productCategory: 'general', prompt: 'Premium product campaign',
    canonicalIdentity, fidelityConstraints,
  });
  const prompts = plan.concepts.map((concept) => new ProductPhotoPromptBuilder().build({
    prompt: 'Premium product campaign', preservation: { preserveProduct: true },
    plan, concept, identitySpecification: canonicalIdentity, fidelityConstraints,
  }));

  for (const prompt of prompts) {
    assert.ok(prompt.length <= 2048);
    assert.match(prompt, /ITEM LOCKS:/);
    assert.match(prompt, /no merge, conversion, substitution, duplication/i);
    assert.ok((prompt.match(/Additional canonical evidence omitted/g) ?? []).length <= 1);
    assert.doesNotMatch(prompt, /\.\.\.|…/);
    for (const partial of prompt.matchAll(/COMPLETE_(?:OBSERVED|HYPOTHESIS)_\d+_\d+/g)) {
      assert.match(partial[0], /^COMPLETE_(?:OBSERVED|HYPOTHESIS)_\d+_\d+$/);
    }
  }
  assert.ok(prompts.some((prompt) => /Additional canonical evidence omitted/.test(prompt)));
});

test('falha explicitamente quando somente o núcleo prioritário excede o limite', () => {
  const canonicalIdentity = identity({
    items: Array.from({ length: 16 }, (_, index) => item({
      id: `product-${index}-${'x'.repeat(90)}`,
      type: `functional-product-${index}-${'y'.repeat(90)}`,
    })),
  });
  const fidelityConstraints = compileProductFidelityConstraints(canonicalIdentity);
  const plan = new ProductPhotoConceptPlanner().plan({
    productCategory: 'general', prompt: '', canonicalIdentity, fidelityConstraints,
  });
  assert.throws(() => new ProductPhotoPromptBuilder().build({
    prompt: '', preservation: { preserveProduct: true }, plan, concept: plan.concepts[0],
    identitySpecification: canonicalIdentity, fidelityConstraints,
  }), /Prioritized product photo prompt exceeds maximum 2048/);
});

test('etapa local é anexada a TypeError anterior ao provider', async () => {
  let providerCalls = 0;
  await assert.rejects(generateProductPhotoBatch({
    provider: { generate: async () => { providerCalls += 1; } },
    assetStore: {
      readImage: async () => ({ bytes: Buffer.from('image'), mimeType: 'image/png', metadata: {} }),
    },
    request: {
      prompt: 'Campaign', inputAssetIds: ['asset-1'], quality: 'standard', aspectRatio: '1:1',
      preservation: { preserveProduct: true }, parameters: { common: { productCategory: 'general' } },
    },
    conceptPlanner: { understand: () => { throw new TypeError('private detail'); } },
    creativeDirectorLogger: undefined,
  }), (error) => error.name === 'TypeError' && error.localFailureStage === 'concept_planning');
  assert.equal(providerCalls, 0);
});

test('pipeline rico compacta quatro prompts e entrega a identidade completa ao Guard', async () => {
  const richObserved = (itemIndex) => Array.from({ length: 12 }, (_, featureIndex) => ({
    name: featureIndex === 0 ? 'observed material appearance' : `visible structure ${featureIndex}`,
    value: `COMPLETE_PIPELINE_OBSERVED_${itemIndex}_${featureIndex} ${'stable detail '.repeat(4).trim()}`,
  }));
  const richAmbiguous = (itemIndex) => Array.from({ length: 6 }, (_, featureIndex) => ({
    name: `hidden geometry ${featureIndex}`,
    visibility: 'hidden',
    observedConstraint: null,
    plausibleHypotheses: [`COMPLETE_PIPELINE_HYPOTHESIS_${itemIndex}_${featureIndex}`],
  }));
  const analysis = {
    state: 'known',
    items: [
      item({ id: 'product-a', type: 'generic product', quantity: 1,
        completeness: 'partial', observedFeatures: richObserved(0), ambiguousFeatures: richAmbiguous(0) }),
      item({ id: 'product-b', type: 'generic accessory', quantity: 2,
        completeness: 'partial', observedFeatures: richObserved(1), ambiguousFeatures: richAmbiguous(1) }),
      item({ id: 'product-c', type: 'generic container', quantity: 1,
        completeness: 'partial', observedFeatures: richObserved(2), ambiguousFeatures: richAmbiguous(2) }),
    ],
    relationships: [{ type: 'set', memberIds: ['product-a', 'product-b', 'product-c'], state: 'known' }],
  };
  const prompts = [];
  const guardIdentities = [];
  await generateProductPhotoBatch({
    provider: {
      generate: async ({ prompt }) => {
        prompts.push(prompt);
        return { imageBase64: Buffer.from('result').toString('base64') };
      },
    },
    assetStore: {
      readImage: async () => ({ bytes: Buffer.from('image'), mimeType: 'image/png', metadata: {} }),
    },
    request: {
      prompt: 'Generic campaign', inputAssetIds: ['asset-1'], count: 4,
      quality: 'standard', aspectRatio: '1:1', preservation: { preserveProduct: true },
      parameters: { common: { productCategory: 'general' } },
    },
    productIdentityAnalyzer: new DeterministicProductIdentityAnalyzer({ result: analysis }),
    productFidelityGuard: { inspect: async ({ canonicalIdentity }) => {
      guardIdentities.push(canonicalIdentity);
      return { verdict: 'pass', violations: [] };
    } },
    creativeDirectorLogger: undefined,
  });
  assert.equal(prompts.length, 4);
  assert.equal(guardIdentities.length, 4);
  assert.ok(guardIdentities.every((entry) => entry === guardIdentities[0]));
  assert.equal(guardIdentities[0].sourceInventory.items.length, 3);
  assert.equal(guardIdentities[0].sourceInventory.items[0].observedFeatures.length, 12);
  assert.equal(guardIdentities[0].sourceInventory.items[0].ambiguousFeatures.length, 6);
  const itemLockLines = prompts.map((prompt) =>
    prompt.split('\n').find((line) => line.startsWith('ITEM LOCKS:')));
  assert.equal(new Set(itemLockLines).size, 1);
  assert.match(itemLockLines[0], /product-a=1xgeneric product; product-b=2xgeneric accessory; product-c=1xgeneric container/);
  for (const prompt of prompts) {
    assert.ok(prompt.length <= 2048);
    assert.match(prompt, /RELATIONSHIP LOCKS: set\(product-a\+product-b\+product-c\)/);
    assert.match(prompt, /VISIBILITY INTENT\/LOCK/);
    assert.match(prompt, /SCALE LOCK:/);
    assert.match(prompt, /OBSERVED MATERIAL APPEARANCE:/);
  }
});

test('arquitetura global preserva tipos genéricos sem regras de joias', () => {
  for (const [type, feature] of [
    ['shoe', 'stitched upper and continuous sole'],
    ['bag', 'main structural shoulder strap'],
    ['watch', 'round case with side crown'],
    ['bottle', 'tall narrow container proportions'],
  ]) {
    const constraints = compileProductFidelityConstraints(identity({
      items: [item({
        id: `${type}-item`, type, quantity: type === 'bottle' ? 2 : 1,
        observedFeatures: [{ id: `${type}-structure`, name: 'visible structure', value: feature }],
      })],
    }));
    assert.equal(constraints.itemLocks[0].functionalType.value, type);
    assert.equal(constraints.itemLocks[0].sourceCount.value, type === 'bottle' ? 2 : 1);
    assert.deepEqual(constraints.itemLocks[0].observedFeatureIds, [`${type}-structure`]);
  }
});

test('núcleo de constraints não contém tipos ou categorias hardcoded', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) =>
    readFile(new URL('../image-to-image/product-fidelity-constraints.mjs', import.meta.url), 'utf8'));
  assert.doesNotMatch(source, /\b(jewelry|jewel|ring|earring|shoe|bag|watch|bottle)\b/i);
});
