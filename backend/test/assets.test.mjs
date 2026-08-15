import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import {
  AssetValidationError,
  createTemporaryAssetStore,
} from '../assets/temporary-asset-store.mjs';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

async function store(options = {}) {
  const baseDirectory = await mkdtemp(join(tmpdir(), 'logofacil-assets-test-'));
  directories.push(baseDirectory);
  return createTemporaryAssetStore({ baseDirectory, ...options });
}

test('upload gera ID seguro, metadados e expiração sem expor caminho físico', async () => {
  const assetStore = await store();
  const asset = await assetStore.saveImage({ bytes: png, mimeType: 'image/png' });

  assert.match(asset.id, /^[0-9a-f-]{36}$/i);
  assert.equal(asset.mediaType, 'image');
  assert.equal(asset.width, 1);
  assert.equal(asset.height, 1);
  assert.equal(asset.retentionPolicy, 'temporary');
  assert.match(asset.hash, /^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(asset, 'path'), false);
  assert.equal(Object.hasOwn(asset, 'filename'), false);
  assert.ok(new Date(asset.expiresAt) > new Date());
});

test('rejeita MIME não suportado e conteúdo incompatível', async () => {
  const assetStore = await store();
  await assert.rejects(
    assetStore.saveImage({ bytes: png, mimeType: 'application/x-msdownload' }),
    (error) => error instanceof AssetValidationError && error.code === 'UNSUPPORTED_IMAGE_TYPE',
  );
  await assert.rejects(
    assetStore.saveImage({ bytes: Buffer.from('not an image'), mimeType: 'image/png' }),
    (error) => error instanceof AssetValidationError && error.code === 'INVALID_IMAGE_CONTENT',
  );
});

test('rejeita imagem acima do limite', async () => {
  const assetStore = await store({ maxImageBytes: png.length - 1 });
  await assert.rejects(
    assetStore.saveImage({ bytes: png, mimeType: 'image/png' }),
    (error) => error instanceof AssetValidationError && error.code === 'IMAGE_TOO_LARGE',
  );
});

test('ignora nome malicioso e grava somente nome derivado do ID', async () => {
  const assetStore = await store();
  const asset = await assetStore.saveImage({
    bytes: png,
    mimeType: 'image/png',
    originalName: '../../server.mjs',
  });
  const filenames = await assetStore.listStoredFilenames();

  assert.deepEqual(filenames, [`${asset.id}.png`]);
  assert.equal(filenames.some((name) => name.includes('..')), false);
});

test('remove asset expirado e deixa de retorná-lo', async () => {
  let current = new Date('2026-08-15T12:00:00Z');
  const assetStore = await store({ retentionMs: 1_000, now: () => current });
  const asset = await assetStore.saveImage({ bytes: png, mimeType: 'image/png' });
  current = new Date('2026-08-15T12:00:02Z');

  assert.equal(await assetStore.cleanupExpired(), 1);
  assert.equal(await assetStore.readImage(asset.id), undefined);
  assert.deepEqual(await assetStore.listStoredFilenames(), []);
});
