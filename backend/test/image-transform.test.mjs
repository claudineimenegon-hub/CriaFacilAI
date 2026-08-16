import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generateProductPhotoBatch,
  ImageTransformValidationError,
  outputDimensions,
  PRODUCT_PHOTO_GUIDANCE,
  PRODUCT_PHOTO_SEEDS,
} from '../image-to-image/image-transform-service.mjs';
import { ProductPhotoPromptBuilder } from '../image-to-image/product-photo-prompt-builder.mjs';
import { ProductPhotoConceptPlanner } from '../image-to-image/product-photo-concept-planner.mjs';

const assetId = '00000000-0000-4000-8000-000000000001';
const imageBase64 = Buffer.from('image').toString('base64');

function request(overrides = {}) {
  return {
    operation: 'imageToImage',
    prompt: 'Create a premium beverage campaign.',
    inputAssetIds: [assetId],
    count: 4,
    quality: 'standard',
    aspectRatio: '4:5',
    preservation: {
      preserveProduct: true,
      preservePackaging: true,
      preserveLabel: true,
      preservePrintedText: true,
      preserveLogo: true,
      preserveColors: true,
      preserveProportions: true,
    },
    parameters: {
      common: {
        artisticDirection: 'Estúdio Premium',
        productCategory: 'beverages',
      },
    },
    ...overrides,
  };
}

function assetStore(overrides = {}) {
  return {
    readImage: async () => ({
      bytes: Buffer.from('input-image'),
      mimeType: 'image/png',
      metadata: { id: assetId },
    }),
    ...overrides,
  };
}

test('planejamento de bebidas produz quatro prompts independentes e hierárquicos', () => {
  const builder = new ProductPhotoPromptBuilder();
  const plan = new ProductPhotoConceptPlanner().plan({
    prompt: 'Premium bottle campaign',
    productCategory: 'beverages',
  });
  const prompts = plan.concepts.map((concept) => builder.build({
    prompt: 'Premium bottle campaign',
    artisticDirection: 'Luxo',
    preservation: request().preservation,
    plan,
    concept,
  }));

  assert.equal(new Set(prompts).size, 4);
  assert.deepEqual(plan.concepts.map(({ name }) => name), [
    'PRODUCT HERO', 'EXTREME MACRO', 'SERVING / CONSUMPTION CONTEXT',
    'LIFESTYLE / HELD OR APPLIED',
  ]);
  for (const prompt of prompts) {
    assert.ok(prompt.indexOf('REFERENCE:') < prompt.indexOf('CONCEPT:'));
    assert.match(prompt, /printed text/);
    assert.match(prompt, /no redesign/i);
    assert.match(prompt, /no washed-out/);
    assert.match(prompt, /One ad photo/);
    assert.match(prompt, /No typography/);
    assert.doesNotMatch(prompt, /variation\s*[1-4]/i);
  }
});

test('regras de joias são especializadas e não vazam para outras categorias', () => {
  const builder = new ProductPhotoPromptBuilder();
  const jewelryPlan = new ProductPhotoConceptPlanner().plan({
    productCategory: 'jewelry',
    prompt: 'Jewelry campaign',
  });
  const electronicsPlan = new ProductPhotoConceptPlanner().plan({
    productCategory: 'electronics',
    prompt: 'Electronics campaign',
  });
  const jewelryLifestyle = builder.build({
    prompt: 'Jewelry campaign', plan: jewelryPlan,
    concept: jewelryPlan.concepts[0],
    preservation: { preserveProduct: true },
  });
  const jewelryMacro = builder.build({
    prompt: 'Jewelry campaign', plan: jewelryPlan,
    concept: jewelryPlan.concepts[2],
    preservation: { preserveProduct: true },
  });
  const electronicsMacro = builder.build({
    prompt: 'Electronics campaign', plan: electronicsPlan,
    concept: electronicsPlan.concepts[1],
    preservation: { preserveProduct: true },
  });

  assert.match(jewelryLifestyle, /wear at correct anatomy/);
  assert.match(jewelryLifestyle, /gem color\/position/);
  assert.match(jewelryMacro, /gem color\/position/);
  assert.match(jewelryMacro, /symmetry\/facets/);
  assert.doesNotMatch(electronicsMacro, /gemstone|visible stone|jewelry/);
  assert.match(electronicsMacro, /controls, ports/);
});

test('count=4 usa concorrência máxima de duas e quatro prompts distintos', async () => {
  let active = 0;
  let maxActive = 0;
  const prompts = [];
  const providerParameters = [];
  const diagnosticLogs = [];
  const provider = {
    generate: async ({ prompt, parameters }) => {
      prompts.push(prompt);
      providerParameters.push(parameters.provider);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { imageBase64: `${imageBase64}${prompts.length}` };
    },
  };
  const batch = await generateProductPhotoBatch({
    provider,
    assetStore: assetStore(),
    request: request(),
    creativeDirectorLogger: { info: (entry) => diagnosticLogs.push(entry) },
  });

  assert.equal(batch.expectedCount, 4);
  assert.equal(batch.status, 'completed');
  assert.equal(batch.imagesBase64.length, 4);
  assert.equal(maxActive, 2);
  assert.equal(new Set(prompts).size, 4);
  assert.deepEqual(providerParameters.map(({ guidance }) => guidance), [
    PRODUCT_PHOTO_GUIDANCE,
    PRODUCT_PHOTO_GUIDANCE,
    PRODUCT_PHOTO_GUIDANCE,
    PRODUCT_PHOTO_GUIDANCE,
  ]);
  assert.deepEqual(providerParameters.map(({ seed }) => seed), PRODUCT_PHOTO_SEEDS);
  assert.equal(batch.preservationSupport, 'best_effort');
  assert.equal(diagnosticLogs.length, 4);
  assert.match(diagnosticLogs[0], /\[CreativeDirector\] Proposal 1/);
  assert.match(diagnosticLogs[0], /concept:|composition:|humanPresence:|productInteraction:|finalPrompt:/);
  assert.match(diagnosticLogs[3], /\[CreativeDirector\] Proposal 4/);
});

test('aspect ratios correspondem às dimensões efetivamente enviadas ao provider', () => {
  assert.deepEqual(outputDimensions('1:1'), { width: 1024, height: 1024 });
  assert.deepEqual(outputDimensions('4:5'), { width: 1024, height: 1280 });
  assert.deepEqual(outputDimensions('9:16'), { width: 1024, height: 1820 });
  assert.deepEqual(outputDimensions('16:9'), { width: 1820, height: 1024 });
});

test('falha em uma geração mantém atomicidade e não produz lote', async () => {
  let calls = 0;
  const provider = {
    generate: async () => {
      calls += 1;
      if (calls === 2) throw new Error('provider failed');
      return { imageBase64 };
    },
  };
  await assert.rejects(
    generateProductPhotoBatch({ provider, assetStore: assetStore(), request: request() }),
    /provider failed/,
  );
  assert.equal(calls, 2);
});

test('asset inválido ou expirado é rejeitado', async () => {
  await assert.rejects(
    generateProductPhotoBatch({
      provider: { generate: async () => ({ imageBase64 }) },
      assetStore: assetStore({ readImage: async () => undefined }),
      request: request(),
    }),
    (error) => error instanceof ImageTransformValidationError &&
      error.code === 'ASSET_NOT_FOUND' && error.status === 404,
  );
});

test('MIME armazenado inválido é rejeitado antes do provedor', async () => {
  let called = false;
  await assert.rejects(
    generateProductPhotoBatch({
      provider: { generate: async () => { called = true; } },
      assetStore: assetStore({
        readImage: async () => ({ bytes: Buffer.from('x'), mimeType: 'application/pdf' }),
      }),
      request: request(),
    }),
    (error) => error instanceof ImageTransformValidationError &&
      error.code === 'INVALID_ASSET_MIME' && error.status === 415,
  );
  assert.equal(called, false);
});
