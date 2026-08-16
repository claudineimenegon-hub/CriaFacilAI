import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  CLOUDFLARE_FLUX2_KLEIN_MODEL,
  createCloudflareFlux2KleinImageToImageProvider,
} from '../image-to-image/cloudflare-flux2-klein-provider.mjs';
import { ImageToImageProviderError } from '../image-to-image/image-to-image-provider.mjs';
import {
  MAX_FLUX_REFERENCE_DIMENSION,
  prepareFluxReferenceImage,
} from '../image-to-image/reference-image-preprocessor.mjs';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function request(overrides = {}) {
  return {
    prompt: 'Premium product advertising image',
    inputs: [{ bytes: png, mimeType: 'image/png' }],
    parameters: { common: { aspectRatio: '1:1' } },
    preservation: { preserveProduct: true },
    output: { width: 1024, height: 1024, count: 4 },
    ...overrides,
  };
}

test('ImageToImageProvider declara capability Standard sem substituir ImageProvider', () => {
  const provider = createCloudflareFlux2KleinImageToImageProvider({
    apiToken: 'test-token',
    accountId: 'test-account',
  });
  assert.equal(provider.model, CLOUDFLARE_FLUX2_KLEIN_MODEL);
  assert.deepEqual(provider.capabilities.operations, ['imageToImage']);
  assert.deepEqual(provider.capabilities.qualities, ['standard']);
  assert.equal(provider.capabilities.maxInputs, 4);
  assert.equal(provider.capabilities.preservation, 'best_effort');
});

test('adaptador envia multipart com prompt e input_image_0 sem steps', async () => {
  let captured;
  const provider = createCloudflareFlux2KleinImageToImageProvider({
    apiToken: 'test-token',
    accountId: 'test-account',
    prepareImage: async (bytes) => ({
      bytes,
      mimeType: 'image/png',
      width: 1,
      height: 1,
    }),
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return Response.json({ success: true, result: { image: png.toString('base64') } });
    },
  });

  const result = await provider.generate(request());

  assert.match(captured.url, /flux-2-klein-4b$/);
  assert.equal(captured.options.headers.Authorization, 'Bearer test-token');
  assert.equal(Object.hasOwn(captured.options.headers, 'Content-Type'), false);
  assert.ok(captured.options.body instanceof FormData);
  assert.equal(captured.options.body.get('prompt'), 'Premium product advertising image');
  assert.equal(captured.options.body.get('width'), '1024');
  assert.equal(captured.options.body.get('height'), '1024');
  assert.ok(captured.options.body.get('input_image_0') instanceof Blob);
  assert.equal(captured.options.body.has('steps'), false);
  assert.equal(result.imageBase64, png.toString('base64'));
});

test('adaptador prepara até quatro referências com nomes indexados', async () => {
  let form;
  const provider = createCloudflareFlux2KleinImageToImageProvider({
    apiToken: 'test-token',
    accountId: 'test-account',
    prepareImage: async (bytes) => ({ bytes, mimeType: 'image/png', width: 1, height: 1 }),
    fetchImpl: async (_, options) => {
      form = options.body;
      return Response.json({ result: { image: png.toString('base64') } });
    },
  });
  await provider.generate(request({ inputs: Array.from({ length: 4 }, () => ({ bytes: png })) }));

  for (let index = 0; index < 4; index++) {
    assert.ok(form.get(`input_image_${index}`) instanceof Blob);
  }
  assert.equal(form.has('input_image_4'), false);
});

test('pré-processamento respeita limite oficial menor que 512x512', async () => {
  const largeInput = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: 'red' },
  }).png().toBuffer();
  const prepared = await prepareFluxReferenceImage(largeInput);

  assert.ok(prepared.width <= MAX_FLUX_REFERENCE_DIMENSION);
  assert.ok(prepared.height <= MAX_FLUX_REFERENCE_DIMENSION);
  assert.deepEqual(
    await sharp(prepared.bytes).metadata().then(({ width, height }) => ({ width, height })),
    { width: prepared.width, height: prepared.height },
  );
});

test('timeout Cloudflare é convertido em erro sanitizável', async () => {
  const timeout = new Error('secret timeout detail');
  timeout.name = 'TimeoutError';
  const provider = createCloudflareFlux2KleinImageToImageProvider({
    apiToken: 'test-token',
    accountId: 'test-account',
    prepareImage: async (bytes) => ({ bytes, mimeType: 'image/png', width: 1, height: 1 }),
    fetchImpl: async () => { throw timeout; },
  });

  await assert.rejects(
    provider.generate(request()),
    (error) => error instanceof ImageToImageProviderError && error.code === 'UPSTREAM_TIMEOUT',
  );
});

test('rejeita Content-Type inesperado e imagem inválida', async () => {
  const common = {
    apiToken: 'test-token',
    accountId: 'test-account',
    prepareImage: async (bytes) => ({ bytes, mimeType: 'image/png', width: 1, height: 1 }),
  };
  const invalidType = createCloudflareFlux2KleinImageToImageProvider({
    ...common,
    fetchImpl: async () => new Response('not-json', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    }),
  });
  await assert.rejects(invalidType.generate(request()), { code: 'INVALID_CONTENT_TYPE' });

  const invalidImage = createCloudflareFlux2KleinImageToImageProvider({
    ...common,
    fetchImpl: async () => Response.json({ result: { image: Buffer.from('not-image').toString('base64') } }),
  });
  await assert.rejects(invalidImage.generate(request()), { code: 'INVALID_IMAGE' });
});
