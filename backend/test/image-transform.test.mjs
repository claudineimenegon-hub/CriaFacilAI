import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generateProductPhotoBatch,
  ImageTransformValidationError,
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
    parameters: { common: { artisticDirection: 'Estúdio Premium' } },
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

test('prompt builder expressa preservação e direção sem numeração visível', () => {
  const prompt = new ProductPhotoPromptBuilder().build({
    prompt: 'Premium bottle campaign',
    artisticDirection: 'Luxo',
    preservation: request().preservation,
    variationIndex: 2,
  });

  assert.match(prompt, /Preserve the exact identity/);
  assert.match(prompt, /Preserve all printed text exactly/);
  assert.match(prompt, /Preserve the original logo/);
  assert.match(prompt, /do not redesign/i);
  assert.doesNotMatch(prompt, /variation\s*[1-4]/i);
});

test('count=4 usa concorrência máxima de duas e quatro prompts distintos', async () => {
  let active = 0;
  let maxActive = 0;
  const prompts = [];
  const provider = {
    generate: async ({ prompt }) => {
      prompts.push(prompt);
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
  assert.equal(batch.preservationSupport, 'best_effort');
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
