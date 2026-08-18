import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';

import {
  GEMINI_ANALYSIS_MAX_EDGE,
  planGeminiAnalysisResize,
  prepareGeminiAnalysisImages,
} from '../image-to-image/gemini-analysis-preprocessor.mjs';

test('planeja foto 12k x 16k para 2304 x 3072 sem alterar proporção', () => {
  assert.equal(GEMINI_ANALYSIS_MAX_EDGE, 3072);
  assert.deepEqual(planGeminiAnalysisResize(12_000, 16_000), {
    width: 2304, height: 3072, resized: true,
  });
});

test('gera cópia exclusiva para análise e preserva o buffer original', async () => {
  const originalBytes = await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: '#4488aa' },
  }).jpeg().toBuffer();
  const input = { bytes: originalBytes, mimeType: 'image/jpeg', metadata: { hash: 'safe-hash' } };
  const [prepared] = await prepareGeminiAnalysisImages([input], { maxEdge: 768 });

  assert.equal(input.bytes, originalBytes);
  assert.notEqual(prepared.bytes, originalBytes);
  assert.deepEqual(
    { width: prepared.metadata.width, height: prepared.metadata.height },
    { width: 768, height: 576 },
  );
  assert.deepEqual(
    { width: prepared.metadata.originalWidth, height: prepared.metadata.originalHeight },
    { width: 1600, height: 1200 },
  );
  assert.equal(prepared.metadata.analyzerResized, true);
});

test('imagem dentro do limite não é recomprimida', async () => {
  const bytes = await sharp({
    create: { width: 640, height: 480, channels: 3, background: '#333333' },
  }).png().toBuffer();
  const [prepared] = await prepareGeminiAnalysisImages([
    { bytes, mimeType: 'image/png', metadata: {} },
  ]);
  assert.equal(prepared.bytes, bytes);
  assert.equal(prepared.metadata.width, 640);
  assert.equal(prepared.metadata.height, 480);
  assert.equal(prepared.metadata.analyzerResized, undefined);
});
