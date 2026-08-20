import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GEMINI_PRODUCT_FIDELITY_GUARD_SCHEMA,
  GeminiProductFidelityGuard,
} from '../image-to-image/gemini-product-fidelity-guard.mjs';
import { createProductIdentitySpecification } from '../image-to-image/product-identity-spec.mjs';
import { compileProductFidelityConstraints } from '../image-to-image/product-fidelity-constraints.mjs';
import { createProductFidelityGuard } from '../image-to-image/product-fidelity-guard-factory.mjs';

const source = { bytes: Buffer.from('source'), mimeType: 'image/png' };
const generatedImage = { imageBase64: Buffer.from('generated').toString('base64'), mimeType: 'image/png' };

function canonicalIdentity({ material = true } = {}) {
  return createProductIdentitySpecification({
    sourceInventory: {
      state: 'known',
      items: [
        {
          id: 'item-1', functionalType: { state: 'known', value: 'product' },
          quantity: { state: 'known', value: 1 }, observationCompleteness: 'complete',
          observedFeatures: material ? [{ id: 'mat', name: 'material', value: 'brushed metal' }] : [],
        },
        {
          id: 'item-2', functionalType: { state: 'known', value: 'product' },
          quantity: { state: 'known', value: 1 }, observationCompleteness: 'complete',
          observedFeatures: [],
        },
      ],
      relationships: [{ type: 'pair', memberIds: ['item-1', 'item-2'], state: 'known' }],
    },
  });
}

function geminiResponse(result, status = 200) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }],
  }), { status, headers: { 'content-type': 'application/json' } });
}

function input(identity = canonicalIdentity()) {
  const constraints = compileProductFidelityConstraints(identity);
  return {
    sourceInputs: [source], generatedImage, canonicalIdentity: identity,
    fidelityConstraints: constraints,
    visibilityIntent: {
      mode: 'contextual_use', pairPolicy: 'preserve_pair',
      selectedItems: [
        { itemId: 'item-1', quantity: 1, quantityState: 'known' },
        { itemId: 'item-2', quantity: 1, quantityState: 'known' },
      ],
    },
    proposalIndex: 1, guardAttempt: 0, repairAttempt: 0,
  };
}

test('Gemini Guard envia duas classes de imagem e schema simples sem prompt criativo', async () => {
  let body;
  const logs = [];
  const guard = new GeminiProductFidelityGuard({
    apiKey: 'test-secret',
    prepareInputs: async (images) => images,
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return geminiResponse({ verdict: 'pass', violations: [] });
    },
    logger: { info: (event) => logs.push(event) },
  });
  const result = await guard.inspect(input());
  const parts = body.contents[0].parts;

  assert.equal(result.verdict, 'pass');
  assert.deepEqual(body.generationConfig.responseFormat.text.schema,
    GEMINI_PRODUCT_FIDELITY_GUARD_SCHEMA);
  assert.equal(parts.filter((part) => part.inlineData).length, 2);
  assert.match(parts[0].text, /Canonical identity is fact|FIDELITY FACTS/);
  assert.doesNotMatch(parts[0].text, /finalPrompt|private creative prompt/);
  assert.deepEqual(logs[0].violationCodes, []);
  assert.equal(logs[0].fallback, false);
  assert.doesNotMatch(JSON.stringify(logs), /test-secret|base64|data:image|inlineData|prompt/i);
});

test('aceita somente violações objetivas simuladas e preserva high confidence', async () => {
  for (const code of [
    'type_mismatch', 'count_mismatch', 'relationship_violation', 'unexpected_item',
    'structural_mutation', 'contextual_scale', 'material_appearance',
  ]) {
    const guard = new GeminiProductFidelityGuard({
      apiKey: 'test', prepareInputs: async (images) => images,
      fetchImpl: async () => geminiResponse({
        verdict: 'fail', violations: [{ code, itemId: code === 'unexpected_item' ? null : 'item-1', confidence: 'high' }],
      }),
    });
    const result = await guard.inspect(input());
    assert.equal(result.verdict, 'fail');
    assert.equal(result.violations[0].code, code);
  }
});

test('macro/baixa evidência e falha técnica retornam uncertain sem lançar', async (t) => {
  await t.test('macro sem escala verificável', async () => {
    const guard = new GeminiProductFidelityGuard({
      apiKey: 'test', prepareInputs: async (images) => images,
      fetchImpl: async () => geminiResponse({
        verdict: 'uncertain',
        violations: [{ code: 'contextual_scale', itemId: 'item-1', confidence: 'low' }],
      }),
    });
    assert.equal((await guard.inspect({
      ...input(), visibilityIntent: { ...input().visibilityIntent, mode: 'macro_detail' },
    })).verdict, 'uncertain');
  });
  await t.test('falha técnica', async () => {
    const logs = [];
    const guard = new GeminiProductFidelityGuard({
      apiKey: 'test', prepareInputs: async (images) => images,
      fetchImpl: async () => { throw new Error('network FAL_KEY data:image;base64'); },
      logger: { info: (event) => logs.push(event) },
    });
    assert.equal((await guard.inspect(input())).verdict, 'uncertain');
    assert.equal(logs[0].fallback, true);
    assert.doesNotMatch(JSON.stringify(logs), /FAL_KEY|data:image|base64/);
  });
});

test('material sem evidência observed não é incluído nos fatos aplicáveis', async () => {
  let body;
  const identity = canonicalIdentity({ material: false });
  const guard = new GeminiProductFidelityGuard({
    apiKey: 'test', prepareInputs: async (images) => images,
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return geminiResponse({ verdict: 'pass', violations: [] });
    },
  });
  await guard.inspect(input(identity));
  const factsText = body.contents[0].parts[0].text;
  assert.match(factsText, /"materialAppearance":\[\]/);
});

test('factory usa unknown sem chave e Gemini quando configurado', () => {
  assert.equal(createProductFidelityGuard({ guardName: 'unknown' }).constructor.name,
    'UnknownProductFidelityGuard');
  assert.equal(createProductFidelityGuard({ guardName: 'gemini', apiKey: 'test' }).constructor.name,
    'GeminiProductFidelityGuard');
});
