import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { CanonicalAssetIsolationError, createCanonicalAssetIsolationService } from '../experimental-v3/canonical-asset-isolation-service.mjs';

const localization = (xMin, xMax, confidence = 1) => ({
  normalizedBoundingBox: { xMin, yMin: 0, xMax, yMax: 1 },
  positivePoints: [{ x: (xMin + xMax) / 2, y: 0.5 }], optionalNegativePoints: [],
  localizationConfidence: confidence, evidenceSource: 'multimodal_analysis',
});

async function fixture() {
  const width = 4; const height = 2;
  const raw = Buffer.from([10,20,30, 40,50,60, 70,80,90, 100,110,120, 11,21,31, 41,51,61, 71,81,91, 101,111,121]);
  return {
    width, height, raw,
    sourceBytes: await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer(),
    maskBytes: await sharp(Buffer.from([255,255,0,0, 255,255,0,0]),
      { raw: { width, height, channels: 1 } }).png().toBuffer(),
  };
}

const identity = () => ({ items: [
  { id: 'item-a', visualLocalization: localization(0, 0.49) },
  { id: 'item-b', visualLocalization: localization(0.51, 1) },
] });

test('isolamento preserva RGB, alpha e componentes finos sem pós-processamento', async () => {
  const data = await fixture(); let calls = 0;
  const service = createCanonicalAssetIsolationService({ provider: {
    name: 'mock', model: 'mock-mask', version: '1',
    async segment() { calls += 1; return { maskBytes: data.maskBytes, confidence: 0.99 }; },
  } });
  const result = await service.isolate({ sourceAsset: { bytes: data.sourceBytes, mimeType: 'image/png', metadata: data },
    sourceSha256: 'a'.repeat(64), productIdentity: identity(), canonicalItemId: 'item-a' });
  const output = await sharp(result.transparentPng).raw().toBuffer({ resolveWithObject: true });
  for (let pixel = 0; pixel < data.width * data.height; pixel += 1) {
    if (output.data[pixel * 4 + 3] === 0) continue;
    assert.deepEqual([...output.data.subarray(pixel * 4, pixel * 4 + 3)], [...data.raw.subarray(pixel * 3, pixel * 3 + 3)]);
  }
  assert.equal(result.visiblePixelIntegrity, true);
  assert.equal(result.confirmable, true);
  assert.equal(result.mask.nonZeroPixels, 4);
  assert.equal(calls, 1);
});

test('máscara vazia é rejeitada e falha não entra no cache', async () => {
  const data = await fixture(); let calls = 0;
  const empty = await sharp(Buffer.alloc(8), { raw: { width: 4, height: 2, channels: 1 } }).png().toBuffer();
  const service = createCanonicalAssetIsolationService({ provider: { name: 'mock', model: 'mock-mask', version: '1',
    async segment() { calls += 1; return { maskBytes: empty, confidence: 1 }; } } });
  const input = { sourceAsset: { bytes: data.sourceBytes, mimeType: 'image/png', metadata: data },
    sourceSha256: 'b'.repeat(64), productIdentity: identity(), canonicalItemId: 'item-a' };
  await assert.rejects(service.isolate(input), (error) => error instanceof CanonicalAssetIsolationError && error.code === 'EMPTY_SEGMENTATION_MASK');
  await assert.rejects(service.isolate(input));
  assert.equal(calls, 2);
});

test('máscara ambígua fica unconfirmed e região de outro item fica contaminated', async () => {
  const data = await fixture();
  const ambiguousService = createCanonicalAssetIsolationService({ provider: { name: 'mock', model: 'mock', version: '1',
    async segment() { return { maskBytes: data.maskBytes, confidence: 0.5 }; } } });
  const common = { sourceAsset: { bytes: data.sourceBytes, mimeType: 'image/png', metadata: data },
    sourceSha256: 'c'.repeat(64), productIdentity: identity(), canonicalItemId: 'item-a' };
  const ambiguous = await ambiguousService.isolate(common);
  assert.equal(ambiguous.isolationState, 'unconfirmed');
  assert.equal(ambiguous.confirmable, false);
  const full = await sharp(Buffer.alloc(8, 255), { raw: { width: 4, height: 2, channels: 1 } }).png().toBuffer();
  const contaminatedService = createCanonicalAssetIsolationService({ provider: { name: 'mock', model: 'mock', version: '1',
    async segment() { return { maskBytes: full, confidence: 1 }; } } });
  const contaminated = await contaminatedService.isolate({ ...common, sourceSha256: 'd'.repeat(64) });
  assert.equal(contaminated.isolationState, 'contaminated');
  assert.equal(contaminated.confirmable, false);
});

test('cache e in-flight evitam segunda segmentação bem-sucedida', async () => {
  const data = await fixture(); let calls = 0; let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const service = createCanonicalAssetIsolationService({ provider: { name: 'mock', model: 'mock', version: '1',
    async segment() { calls += 1; await gate; return { maskBytes: data.maskBytes, confidence: 1 }; } } });
  const input = { sourceAsset: { bytes: data.sourceBytes, mimeType: 'image/png', metadata: data },
    sourceSha256: 'e'.repeat(64), productIdentity: identity(), canonicalItemId: 'item-a' };
  const first = service.isolate(input); const second = service.isolate(input); release();
  const results = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(results.some(({ inFlightShared }) => inFlightShared), true);
  assert.equal((await service.isolate(input)).cacheHit, true);
  assert.equal(calls, 1);
});

test('localização ausente ou de baixa confiança é rejeitada antes do provider', async () => {
  const data = await fixture(); let calls = 0;
  const service = createCanonicalAssetIsolationService({ provider: { name: 'mock', model: 'mock', version: '1',
    async segment() { calls += 1; } } });
  await assert.rejects(service.isolate({ sourceAsset: { bytes: data.sourceBytes, mimeType: 'image/png', metadata: data },
    sourceSha256: 'f'.repeat(64), productIdentity: { items: [{ id: 'item-a' }] }, canonicalItemId: 'item-a' }),
  (error) => error.code === 'VISUAL_LOCALIZATION_REQUIRED');
  assert.equal(calls, 0);
});

test('máscara quadrada letterboxed é alinhada ao source vertical sem redimensionar RGB', async () => {
  const width = 6; const height = 8;
  const raw = Buffer.alloc(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    raw[pixel * 3] = pixel; raw[pixel * 3 + 1] = 100; raw[pixel * 3 + 2] = 200;
  }
  const sourceBytes = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const maskRaw = Buffer.alloc(8 * 8);
  for (let y = 2; y <= 5; y += 1) for (let x = 2; x <= 3; x += 1) maskRaw[y * 8 + x] = 255;
  const maskBytes = await sharp(maskRaw, { raw: { width: 8, height: 8, channels: 1 } }).png().toBuffer();
  const productIdentity = { items: [{ id: 'item-a', visualLocalization: {
    normalizedBoundingBox: { xMin: 1 / 6, yMin: 2 / 8, xMax: 3 / 6, yMax: 6 / 8 },
    positivePoints: [{ x: 2 / 6, y: 4 / 8 }], optionalNegativePoints: [],
    localizationConfidence: 1, evidenceSource: 'multimodal_analysis',
  } }] };
  const service = createCanonicalAssetIsolationService({ provider: { name: 'mock', model: 'mock', version: '1',
    async segment() { return { maskBytes, confidence: 1, providerBox: [1 / 3, 0.5, 1 / 3, 0.5] }; } } });
  const result = await service.isolate({ sourceAsset: { bytes: sourceBytes, mimeType: 'image/png', metadata: { width, height } },
    sourceSha256: '9'.repeat(64), productIdentity, canonicalItemId: 'item-a' });
  assert.deepEqual(result.maskAlignment, { mode: 'contain', verified: true });
  assert.equal(result.confirmable, true);
  const output = await sharp(result.transparentPng).raw().toBuffer();
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (output[pixel * 4 + 3] === 0) continue;
    assert.deepEqual([...output.subarray(pixel * 4, pixel * 4 + 3)], [...raw.subarray(pixel * 3, pixel * 3 + 3)]);
  }
});

test('transformação desconhecida em máscara de proporção diferente nunca é confirmável', async () => {
  const width = 6; const height = 8;
  const sourceBytes = await sharp({ create: { width, height, channels: 3, background: '#123456' } }).png().toBuffer();
  const maskBytes = await sharp(Buffer.alloc(64, 255), { raw: { width: 8, height: 8, channels: 1 } }).png().toBuffer();
  const productIdentity = { items: [{ id: 'item-a', visualLocalization: localization(0, 1) }] };
  const service = createCanonicalAssetIsolationService({ provider: { name: 'mock', model: 'mock', version: '1',
    async segment() { return { maskBytes, confidence: 1, providerBox: null }; } } });
  const result = await service.isolate({ sourceAsset: { bytes: sourceBytes, mimeType: 'image/png', metadata: { width, height } },
    sourceSha256: '8'.repeat(64), productIdentity, canonicalItemId: 'item-a' });
  assert.equal(result.maskAlignment.verified, false);
  assert.equal(result.confirmable, false);
  assert.equal(result.isolationState, 'unconfirmed');
});

test('quatro IDs canônicos produzem quatro ativos independentes ligados ao ID correto', async () => {
  const data = await fixture(); let calls = 0;
  const productIdentity = { items: ['a', 'b', 'c', 'd'].map((id) => ({
    id, visualLocalization: localization(0, 0.49),
  })) };
  const service = createCanonicalAssetIsolationService({ provider: { name: 'mock', model: 'mock', version: '1',
    async segment() { calls += 1; return { maskBytes: data.maskBytes, confidence: 1 }; } } });
  const results = await Promise.all(productIdentity.items.map(({ id }) => service.isolate({
    sourceAsset: { bytes: data.sourceBytes, mimeType: 'image/png', metadata: data },
    sourceSha256: '7'.repeat(64), productIdentity, canonicalItemId: id,
  })));
  assert.deepEqual(results.map(({ canonicalItemId }) => canonicalItemId), ['a', 'b', 'c', 'd']);
  assert.equal(calls, 4);
  assert.equal(new Set(results.map(({ transparentPng }) => Buffer.from(transparentPng).toString('base64'))).size, 1);
});
