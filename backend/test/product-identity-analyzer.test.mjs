import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PRODUCT_IDENTITY_ANALYSIS_LIMITS,
  ProductIdentityAnalysisValidationError,
  unknownProductIdentityAnalysis,
  validateProductIdentityAnalysis,
} from '../image-to-image/product-identity-analyzer.mjs';
import { generateProductPhotoBatch } from '../image-to-image/image-transform-service.mjs';
import { ProductPhotoConceptPlanner } from '../image-to-image/product-photo-concept-planner.mjs';
import { createProductIdentitySpecification } from '../image-to-image/product-identity-spec.mjs';
import { DeterministicProductIdentityAnalyzer } from './support/deterministic-product-identity-analyzer.mjs';

const assetId = '00000000-0000-4000-8000-000000000001';

function item({
  id = 'item-1', type = 'generic product', quantity = 1,
  completeness = 'complete', observedFeatures = [], ambiguousFeatures = [],
} = {}) {
  return {
    id,
    functionalType: { state: 'known', value: type },
    quantity: { state: 'known', value: quantity },
    observationCompleteness: completeness,
    observedFeatures,
    ambiguousFeatures,
  };
}

function request(category = 'general') {
  return {
    prompt: 'Create a generic premium product campaign.',
    inputAssetIds: [assetId], count: 4, quality: 'standard', aspectRatio: '1:1',
    preservation: { preserveProduct: true },
    parameters: { common: { productCategory: category, artisticDirection: 'Estúdio Premium' } },
  };
}

function assetStore() {
  return {
    readImage: async () => ({
      bytes: Buffer.from('opaque-image'), mimeType: 'image/jpeg',
      metadata: { hash: 'sanitized-asset-hash' },
    }),
  };
}

test('valida produto único completamente observado', () => {
  const result = validateProductIdentityAnalysis({
    state: 'known',
    items: [item({
      observedFeatures: [{ name: 'front silhouette', value: 'rectangular with rounded edges' }],
    })],
    relationships: [],
  });

  assert.equal(result.items[0].observationCompleteness, 'complete');
  assert.equal(result.items[0].observedFeatures[0].value, 'rectangular with rounded edges');
  assert.ok(Object.isFrozen(result.items[0].observedFeatures));
});

test('valida produto parcial sem transformar ambiguidade em fato', () => {
  const result = validateProductIdentityAnalysis({
    state: 'uncertain',
    items: [item({
      completeness: 'partial',
      observedFeatures: [{ name: 'visible side', value: 'two aligned attachment points' }],
      ambiguousFeatures: [{
        name: 'hidden support', visibility: 'hidden',
        observedConstraint: 'joins the visible attachment points',
        plausibleHypotheses: ['continuous curved support'],
      }],
    })],
    relationships: [],
  });
  const specification = createProductIdentitySpecification({ sourceInventory: result });

  assert.equal(result.items[0].ambiguousFeatures[0].canonicalHypothesis, undefined);
  assert.equal(specification.sourceInventory.items[0]
    .ambiguousFeatures[0].canonicalHypothesis.confidence, 'uncertain');
});

test('aceita inventário desconhecido sem inventar itens', () => {
  assert.deepEqual(validateProductIdentityAnalysis(unknownProductIdentityAnalysis()), {
    state: 'unknown', items: [], relationships: [],
  });
  assert.throws(() => validateProductIdentityAnalysis({
    state: 'unknown', items: [item()], relationships: [],
  }), ProductIdentityAnalysisValidationError);
});

test('rejeita campos livres, enums inválidos e respostas excessivas', () => {
  assert.throws(() => validateProductIdentityAnalysis({
    state: 'known', items: [], relationships: [], commentary: 'untrusted free text',
  }), /not allowed/);
  assert.throws(() => validateProductIdentityAnalysis({
    state: 'known', items: [{ ...item(), observationCompleteness: 'mostly-visible' }],
    relationships: [],
  }), /observationCompleteness/);
  assert.throws(() => validateProductIdentityAnalysis({
    state: 'known',
    items: Array.from({ length: PRODUCT_IDENTITY_ANALYSIS_LIMITS.items + 1 }, (_, index) =>
      item({ id: `item-${index}` })),
    relationships: [],
  }), /analysis.items/);
  assert.throws(() => validateProductIdentityAnalysis({
    state: 'known',
    items: [item({
      observedFeatures: Array.from(
        { length: PRODUCT_IDENTITY_ANALYSIS_LIMITS.observedFeaturesPerItem + 1 },
        (_, index) => ({ name: `feature-${index}`, value: `value-${index}` }),
      ),
    })],
    relationships: [],
  }), /observedFeatures/);
});

test('analyzer executa uma vez e conjunto conhecido habilita Hero Set com identidade compartilhada', async () => {
  const analyzer = new DeterministicProductIdentityAnalyzer({
    result: {
      state: 'known',
      items: [
        item({ id: 'item-a', type: 'generic product A', observedFeatures: [
          { name: 'surface', value: 'matte dark finish' },
        ] }),
        item({ id: 'item-b', type: 'generic product B', quantity: 2, observedFeatures: [
          { name: 'surface', value: 'polished light finish' },
        ] }),
      ],
      relationships: [{ type: 'set', memberIds: ['item-a', 'item-b'], state: 'known' }],
    },
  });
  const identities = [];
  const concepts = [];
  const delegate = await import('../image-to-image/product-photo-prompt-builder.mjs');
  const builder = new delegate.ProductPhotoPromptBuilder();

  await generateProductPhotoBatch({
    provider: { generate: async () => ({ imageBase64: 'ZHJ5LXJ1bg==' }) },
    assetStore: assetStore(), request: request(), productIdentityAnalyzer: analyzer,
    promptBuilder: { build: (input) => {
      identities.push(input.identitySpecification);
      concepts.push(input.concept);
      return builder.build(input);
    } },
    creativeDirectorLogger: { info() {}, warn() {} },
  });

  assert.equal(analyzer.calls.length, 1);
  assert.equal(analyzer.calls[0].declaredCategory, 'general');
  assert.equal(analyzer.calls[0].cacheKey, 'sanitized-asset-hash');
  assert.equal(identities.length, 4);
  assert.ok(identities.every((identity) => identity === identities[0]));
  assert.equal(identities[0].sourceInventory.state, 'known');
  assert.ok(concepts.some(({ name, visibilityIntent }) =>
    name === 'HERO SET / PREMIUM STILL LIFE' && visibilityIntent.mode === 'full_set'));
});

test('falha ou saída inválida do analyzer usa fallback unknown sem inventário', async () => {
  for (const analyzer of [
    new DeterministicProductIdentityAnalyzer({ error: new Error('offline') }),
    new DeterministicProductIdentityAnalyzer({ result: { state: 'known', items: 'invalid' } }),
  ]) {
    const identities = [];
    await generateProductPhotoBatch({
      provider: { generate: async () => ({ imageBase64: 'ZHJ5LXJ1bg==' }) },
      assetStore: assetStore(), request: request(), productIdentityAnalyzer: analyzer,
      promptBuilder: { build: (input) => {
        identities.push(input.identitySpecification);
        return `safe prompt ${identities.length}`;
      } },
      creativeDirectorLogger: { info() {}, warn() {} },
    });
    assert.equal(analyzer.calls.length, 1);
    assert.equal(identities[0].sourceInventory.state, 'unknown');
    assert.equal(identities[0].sourceInventory.items.length, 0);
  }
});

test('erro inesperado do analyzer gera diagnóstico sanitizado e mantém fallback', async () => {
  const secret = 'data:image/jpeg;base64,PRIVATE_IMAGE_BYTES';
  const analyzer = new DeterministicProductIdentityAnalyzer({ error: new Error(secret) });
  const warnings = [];
  const identities = [];
  await generateProductPhotoBatch({
    provider: { generate: async () => ({ imageBase64: 'ZHJ5LXJ1bg==' }) },
    assetStore: assetStore(), request: request(), productIdentityAnalyzer: analyzer,
    promptBuilder: { build: (input) => {
      identities.push(input.identitySpecification);
      return `safe prompt ${identities.length}`;
    } },
    creativeDirectorLogger: { info() {}, warn: (event) => warnings.push(event) },
  });

  assert.equal(identities[0].sourceInventory.state, 'unknown');
  assert.equal(identities[0].sourceInventory.items.length, 0);
  assert.equal(warnings.length, 1);
  const event = JSON.parse(warnings[0].replace('[ProductIdentityAnalyzer] ', ''));
  assert.equal(event.errorCode, 'UNEXPECTED_ANALYZER_ERROR');
  assert.equal(event.fallback, true);
  assert.equal(event.state, 'unknown');
  assert.doesNotMatch(warnings[0], /data:image|base64|PRIVATE_IMAGE_BYTES/);
});

test('macro sem observedFeature usa seleção neutra e com evidência usa detalhe evidenciado', () => {
  const planner = new ProductPhotoConceptPlanner();
  const unknownPlan = planner.plan({ productCategory: 'general', prompt: 'macro detail' });
  const unknownMacro = unknownPlan.concepts.find(({ name }) => name === 'EXTREME MACRO');
  assert.equal(unknownMacro.visibilityIntent.selection,
    'reference_visible_detail_or_safe_close_view');

  const identity = createProductIdentitySpecification({
    sourceInventory: validateProductIdentityAnalysis({
      state: 'known', items: [item({ observedFeatures: [
        { name: 'visible texture', value: 'fine diagonal weave' },
      ] })], relationships: [],
    }),
  });
  const observedPlan = planner.plan({
    productCategory: 'general', prompt: 'macro detail', canonicalIdentity: identity,
  });
  const observedMacro = observedPlan.concepts.find(({ name }) => name === 'EXTREME MACRO');
  assert.equal(observedMacro.visibilityIntent.selection, 'one_evidenced_detail');
});
