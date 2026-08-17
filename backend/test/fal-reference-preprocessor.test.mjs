import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FAL_MAX_TOTAL_INPUT_PIXELS,
  planFalReferenceResizes,
  prepareFalReferenceImages,
} from '../image-to-image/fal-reference-preprocessor.mjs';

const jpeg = Buffer.from([0xff, 0xd8, 0xff]);

test('reduz proporcionalmente imagens de 12, 24 e 48 MP', async () => {
  const cases = [
    { input: { width: 4000, height: 3000 }, ratio: 4 / 3 },
    { input: { width: 6000, height: 4000 }, ratio: 3 / 2 },
    { input: { width: 8000, height: 6000 }, ratio: 4 / 3 },
  ];
  for (const { input, ratio } of cases) {
    const plan = planFalReferenceResizes([input]);
    const target = plan.targets[0];
    assert.ok(target.width * target.height <= FAL_MAX_TOTAL_INPUT_PIXELS);
    assert.ok(target.width < input.width && target.height < input.height);
    assert.ok(Math.abs(target.width / target.height - ratio) < 0.002);
    const [prepared] = await prepareFalReferenceImages(
      [{ bytes: jpeg, mimeType: 'image/jpeg' }],
      {
        inspect: async () => input,
        resize: async (_reference, resizeTarget) => {
          assert.deepEqual(resizeTarget, target);
          return Buffer.from('resized');
        },
      },
    );
    assert.equal(prepared.resized, true);
    assert.equal(prepared.bytes.toString(), 'resized');
  }
});

test('foto local de 3060x4080 é planejada abaixo de 8 MP', () => {
  const plan = planFalReferenceResizes([{ width: 3060, height: 4080 }]);
  assert.deepEqual(plan.targets[0], { width: 2449, height: 3265 });
  assert.ok(2449 * 3265 <= FAL_MAX_TOTAL_INPUT_PIXELS);
});

test('imagem abaixo do limite mantém bytes e dimensões sem recompressão', async () => {
  let resizeCalls = 0;
  const prepared = await prepareFalReferenceImages(
    [{ bytes: jpeg, mimeType: 'image/jpeg' }],
    {
      inspect: async () => ({ width: 1200, height: 1600 }),
      resize: async () => { resizeCalls += 1; return Buffer.from('resized'); },
    },
  );
  assert.equal(resizeCalls, 0);
  assert.equal(prepared[0].bytes, jpeg);
  assert.equal(prepared[0].resized, false);
  assert.deepEqual(
    { width: prepared[0].width, height: prepared[0].height },
    { width: 1200, height: 1600 },
  );
});

test('múltiplas referências compartilham orçamento total de 8 MP', async () => {
  const inputs = Array.from({ length: 2 }, () => ({ bytes: jpeg, mimeType: 'image/jpeg' }));
  const resizeTargets = [];
  const prepared = await prepareFalReferenceImages(inputs, {
    inspect: async () => ({ width: 4000, height: 3000 }),
    resize: async (_input, target) => {
      resizeTargets.push(target);
      return Buffer.from('resized');
    },
  });
  assert.equal(resizeTargets.length, 2);
  assert.ok(prepared.reduce((sum, item) => sum + item.width * item.height, 0) <=
    FAL_MAX_TOTAL_INPUT_PIXELS);
  assert.deepEqual(prepared[0], {
    bytes: Buffer.from('resized'),
    mimeType: 'image/jpeg',
    width: 2309,
    height: 1732,
    originalWidth: 4000,
    originalHeight: 3000,
    resized: true,
  });
});

test('valida quantidade, MIME, tamanho e dimensões locais', async () => {
  await assert.rejects(prepareFalReferenceImages([]), { code: 'INVALID_INPUT_COUNT' });
  await assert.rejects(prepareFalReferenceImages([
    { bytes: jpeg, mimeType: 'image/gif' },
  ]), { code: 'INVALID_INPUT_IMAGE' });
  assert.throws(
    () => planFalReferenceResizes([{ width: 0, height: 100 }]),
    { code: 'INVALID_INPUT_DIMENSIONS' },
  );
});
