import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFalSam3SegmentationProvider,
  FAL_SAM3_ENDPOINT,
  FAL_SAM3_MODEL,
} from '../experimental-v3/fal-sam3-segmentation-provider.mjs';

test('SAM3 envia prompt semântico e prompts geométricos opcionais sem reconstrução generativa', async () => {
  const calls = [];
  const mask = Buffer.from('mask-png');
  const provider = createFalSam3SegmentationProvider({ apiKey: 'secret-key', fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, async json() { return {
      masks: [{ url: `data:image/png;base64,${mask.toString('base64')}` }], scores: [0.97], boxes: [[1, 2, 3, 4]],
    }; } };
  } });
  const result = await provider.segment({
    sourceBytes: Buffer.from('source'), mimeType: 'image/png', width: 100, height: 200,
    prompt: 'Segment only the complete canonical wearable product.',
    localization: {
      normalizedBoundingBox: { xMin: 0.1, yMin: 0.2, xMax: 0.8, yMax: 0.9 },
      positivePoints: [{ x: 0.2, y: 0.3 }], optionalNegativePoints: [{ x: 0.9, y: 0.5 }],
    },
  });
  assert.equal(FAL_SAM3_MODEL, 'fal-ai/sam-3/image');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, FAL_SAM3_ENDPOINT);
  const payload = JSON.parse(calls[0].init.body);
  assert.deepEqual(payload.box_prompts, [{ x_min: 10, y_min: 40, x_max: 80, y_max: 180, object_id: 1 }]);
  assert.deepEqual(payload.point_prompts, [
    { x: 20, y: 60, label: 1, object_id: 1 },
    { x: 90, y: 100, label: 0, object_id: 1 },
  ]);
  assert.equal(payload.apply_mask, false);
  assert.equal(payload.prompt, 'Segment only the complete canonical wearable product.');
  assert.equal(payload.text_prompt, undefined);
  assert.equal(calls[0].init.body.includes('secret-key'), false);
  assert.deepEqual(result.maskBytes, mask);
  assert.equal(result.confidence, 0.97);
});

test('SAM3 omite box e points quando a localização espacial não existe', async () => {
  let payload;
  const mask = Buffer.from('mask-png');
  const provider = createFalSam3SegmentationProvider({
    apiKey: 'secret-key',
    fetchImpl: async (_url, init) => {
      payload = JSON.parse(init.body);
      return { ok: true, status: 200, async json() { return {
        masks: [{ url: `data:image/png;base64,${mask.toString('base64')}` }],
        scores: [0.98], boxes: [[0.5, 0.5, 1, 1]],
      }; } };
    },
  });
  await provider.segment({
    sourceBytes: Buffer.from('source'), mimeType: 'image/png', width: 100, height: 200,
    prompt: 'Segment only the complete canonical product.',
  });
  assert.equal(payload.box_prompts, undefined);
  assert.equal(payload.point_prompts, undefined);
  assert.equal(payload.prompt, 'Segment only the complete canonical product.');
});

test('SAM3 mantém mask, score, box e metadata alinhados pelo mesmo índice', async () => {
  const masks = [Buffer.from('mask-a'), Buffer.from('mask-b')];
  const provider = createFalSam3SegmentationProvider({
    apiKey: 'secret-key',
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return {
      masks: masks.map((value) => ({ url: `data:image/png;base64,${value.toString('base64')}` })),
      scores: [0.4, 0.95], boxes: [[1, 1, 1, 1], [2, 2, 2, 2]],
      metadata: [{ score: 0.4 }, { score: 0.95 }],
    }; } }),
  });
  const result = await provider.segment({ sourceBytes: Buffer.from('source'), mimeType: 'image/png',
    width: 10, height: 10, prompt: 'canonical product' });
  assert.deepEqual(result.maskBytes, masks[1]);
  assert.equal(result.selectedMaskIndex, 1);
  assert.equal(result.maskCount, 2);
  assert.equal(result.confidence, 0.95);
  assert.deepEqual(result.providerBox, [2, 2, 2, 2]);
});

test('SAM3 sem chave falha antes de fetch', async () => {
  let calls = 0;
  const provider = createFalSam3SegmentationProvider({ apiKey: '', fetchImpl: async () => { calls += 1; } });
  await assert.rejects(provider.segment({}), (error) => error.code === 'SEGMENTATION_PROVIDER_NOT_CONFIGURED');
  assert.equal(calls, 0);
});
