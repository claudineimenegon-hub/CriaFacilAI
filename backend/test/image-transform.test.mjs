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

test('quatro briefings são independentes e preservação precede direção artística', () => {
  const builder = new ProductPhotoPromptBuilder();
  const prompts = Array.from({ length: 4 }, (_, variationIndex) => builder.build({
    prompt: 'Premium bottle campaign',
    artisticDirection: 'Luxo',
    productCategory: 'beverages',
    preservation: request().preservation,
    variationIndex,
  }));

  assert.equal(new Set(prompts).size, 4);
  assert.match(prompts[0], /PRODUCT HERO \/ PREMIUM CATALOG/);
  assert.match(prompts[1], /LIFESTYLE \/ PRODUCT IN USE/);
  assert.match(prompts[1], /serving or consumption context/);
  assert.match(prompts[2], /LUXURY DISPLAY \/ PREMIUM COMMERCIAL PRESENTATION/);
  assert.match(prompts[3], /EXTREME MACRO \/ DETAIL HERO/);
  assert.match(prompts[3], /microtexture/);
  for (const prompt of prompts) {
    assert.ok(prompt.indexOf('AUTHORITATIVE PRODUCT REFERENCE') < prompt.indexOf('CONCEPT:'));
    assert.match(prompt, /Preserve printed text as faithfully as the model permits/);
    assert.match(prompt, /never replace or redesign/);
    assert.match(prompt, /washed-out appearance/);
    assert.doesNotMatch(prompt, /variation\s*[1-4]/i);
  }
});

test('regras de joias são especializadas e não vazam para outras categorias', () => {
  const builder = new ProductPhotoPromptBuilder();
  const jewelryLifestyle = builder.build({
    prompt: 'Jewelry campaign',
    productCategory: 'jewelry',
    preservation: { preserveProduct: true },
    variationIndex: 1,
  });
  const jewelryMacro = builder.build({
    prompt: 'Jewelry campaign',
    productCategory: 'jewelry',
    preservation: { preserveProduct: true },
    variationIndex: 3,
  });
  const electronicsMacro = builder.build({
    prompt: 'Electronics campaign',
    productCategory: 'electronics',
    preservation: { preserveProduct: true },
    variationIndex: 3,
  });

  assert.match(jewelryLifestyle, /jewelry being worn naturally/);
  assert.match(jewelryLifestyle, /central stone/);
  assert.match(jewelryMacro, /facets, setting, metal, secondary stones/);
  assert.doesNotMatch(electronicsMacro, /central stone|secondary stones|jewelry being worn/);
  assert.match(electronicsMacro, /authentic surface detail/);
});

test('count=4 usa concorrência máxima de duas e quatro prompts distintos', async () => {
  let active = 0;
  let maxActive = 0;
  const prompts = [];
  const providerParameters = [];
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
