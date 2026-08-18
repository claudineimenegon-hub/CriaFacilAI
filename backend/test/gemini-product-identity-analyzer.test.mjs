import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_GEMINI_PRODUCT_IDENTITY_MODEL,
  GEMINI_GENERATE_CONTENT_BASE_URL,
  GeminiProductIdentityAnalyzer,
  GeminiProductIdentityAnalyzerError,
} from '../image-to-image/gemini-product-identity-analyzer.mjs';
import {
  createProductIdentityAnalyzer,
} from '../image-to-image/product-identity-analyzer-factory.mjs';
import {
  UnknownProductIdentityAnalyzer,
} from '../image-to-image/product-identity-analyzer.mjs';
import { generateProductPhotoBatch } from '../image-to-image/image-transform-service.mjs';
import { ProductPhotoPromptBuilder } from '../image-to-image/product-photo-prompt-builder.mjs';

const apiKey = 'test-key-must-never-leak';
const assetId = '00000000-0000-4000-8000-000000000001';
const imageBytes = Buffer.from('mock-image-bytes');

function genericItem({
  id = 'item-1', typeState = 'known', type = 'generic product',
  quantityState = 'known', quantity = 1, completeness = 'complete',
  observedFeatures = [], ambiguousFeatures = [],
} = {}) {
  return {
    id,
    functionalType: { state: typeState, value: typeState === 'unknown' ? null : type },
    quantity: { state: quantityState, value: quantityState === 'unknown' ? null : quantity },
    observationCompleteness: completeness,
    observedFeatures,
    ambiguousFeatures,
  };
}

function unknownAnalysis() {
  return { state: 'unknown', items: [], relationships: [] };
}

function geminiResponse(analysis, { status = 200, rawText } = {}) {
  const body = rawText ?? JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(analysis) }] } }],
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => String(Buffer.byteLength(body)) },
    text: async () => body,
  };
}

function analyzerInput() {
  return {
    inputs: [{
      bytes: imageBytes, mimeType: 'image/jpeg',
      metadata: { width: 1200, height: 900 },
    }],
    declaredCategory: 'accessory',
    userBrief: 'Create a premium campaign for the complete collection.',
    cacheKey: 'asset-hash-for-future-cache',
  };
}

test('GEMINI_API_KEY ausente falha antes da rede sem expor credencial', async () => {
  let fetchCalls = 0;
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey: '', fetchImpl: async () => { fetchCalls += 1; },
  });
  await assert.rejects(analyzer.analyze(analyzerInput()), (error) => {
    assert.equal(error.code, 'GEMINI_NOT_CONFIGURED');
    assert.doesNotMatch(error.message, /key|authorization/i);
    return true;
  });
  assert.equal(fetchCalls, 0);
});

test('factory seleciona unknown por padrão e gemini somente quando solicitado', () => {
  const offline = createProductIdentityAnalyzer({ analyzerName: 'unknown' });
  const gemini = createProductIdentityAnalyzer({
    analyzerName: 'gemini', apiKey, fetchImpl: async () => geminiResponse(unknownAnalysis()),
  });
  assert.ok(offline instanceof UnknownProductIdentityAnalyzer);
  assert.ok(gemini instanceof GeminiProductIdentityAnalyzer);
  assert.equal(gemini.model, DEFAULT_GEMINI_PRODUCT_IDENTITY_MODEL);
  assert.throws(() => createProductIdentityAnalyzer({ analyzerName: 'unsupported' }),
    /PRODUCT_IDENTITY_ANALYZER inválido/);
});

test('constrói requisição multimodal estruturada com categoria, brief e imagens', async () => {
  let captured;
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return geminiResponse(unknownAnalysis());
    },
  });
  await analyzer.analyze(analyzerInput());

  const body = JSON.parse(captured.options.body);
  const [instruction, image] = body.contents[0].parts;
  assert.equal(captured.url,
    `${GEMINI_GENERATE_CONTENT_BASE_URL}/${DEFAULT_GEMINI_PRODUCT_IDENTITY_MODEL}:generateContent`);
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers['x-goog-api-key'], apiKey);
  assert.match(instruction.text, /Declared category .* accessory/);
  assert.match(instruction.text, /complete collection/);
  assert.match(instruction.text, /Never promote an inference to observed fact/);
  assert.doesNotMatch(instruction.text, /jewel|ring|earring|gemstone/i);
  assert.deepEqual(image.inlineData, {
    mimeType: 'image/jpeg', data: imageBytes.toString('base64'),
  });
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.responseJsonSchema.additionalProperties, false);
  assert.equal(body.generationConfig.temperature, 0);
});

test('aceita structured output com múltiplos itens, relações e evidências', async () => {
  const analysis = {
    state: 'known',
    items: [
      genericItem({
        id: 'item-a', observedFeatures: [{ name: 'visible shape', value: 'rounded front' }],
      }),
      genericItem({
        id: 'item-b', quantity: 2, completeness: 'partial',
        observedFeatures: [{ name: 'visible material', value: 'brushed metal' }],
        ambiguousFeatures: [{
          name: 'hidden rear', visibility: 'hidden', observedConstraint: 'joins visible sides',
          plausibleHypotheses: ['continuous minimal rear support'],
        }],
      }),
    ],
    relationships: [{ type: 'set', memberIds: ['item-a', 'item-b'], state: 'known' }],
  };
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey, fetchImpl: async () => geminiResponse(analysis),
  });
  const result = await analyzer.analyze(analyzerInput());

  assert.equal(result.items.length, 2);
  assert.equal(result.items[1].quantity.value, 2);
  assert.equal(result.items[0].observedFeatures[0].value, 'rounded front');
  assert.equal(result.items[1].ambiguousFeatures[0].visibility, 'hidden');
  assert.deepEqual(result.relationships[0].memberIds, ['item-a', 'item-b']);
});

test('preserva estados uncertain e unknown sem inventar valores', async () => {
  const analysis = {
    state: 'uncertain',
    items: [genericItem({
      typeState: 'uncertain', type: 'portable product',
      quantityState: 'unknown', quantity: null, completeness: 'unknown',
    })],
    relationships: [],
  };
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey, fetchImpl: async () => geminiResponse(analysis),
  });
  const result = await analyzer.analyze(analyzerInput());
  assert.equal(result.state, 'uncertain');
  assert.deepEqual(result.items[0].quantity, { state: 'unknown', value: null });
  assert.equal(result.items[0].functionalType.state, 'uncertain');
});

test('rejeita JSON inválido, schema inválido e resposta excessiva', async () => {
  const scenarios = [
    {
      response: geminiResponse(null, { rawText: '{invalid' }),
      expected: /invalid JSON/i,
    },
    {
      response: geminiResponse({ state: 'known', items: 'invalid', relationships: [] }),
      expected: /analysis.items/,
    },
    {
      response: geminiResponse(null, { rawText: 'x'.repeat(128 * 1024 + 1) }),
      expected: /safe limit/,
    },
  ];
  for (const { response, expected } of scenarios) {
    const analyzer = new GeminiProductIdentityAnalyzer({
      apiKey, fetchImpl: async () => response,
    });
    await assert.rejects(analyzer.analyze(analyzerInput()), expected);
  }
});

test('converte timeout, erro de rede e erro HTTP em erros sanitizados', async () => {
  const timeoutAnalyzer = new GeminiProductIdentityAnalyzer({
    apiKey, timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });
  await assert.rejects(timeoutAnalyzer.analyze(analyzerInput()),
    (error) => error.code === 'GEMINI_TIMEOUT');

  const networkAnalyzer = new GeminiProductIdentityAnalyzer({
    apiKey, fetchImpl: async () => { throw new Error('sensitive network details'); },
  });
  await assert.rejects(networkAnalyzer.analyze(analyzerInput()), (error) =>
    error.code === 'GEMINI_NETWORK_ERROR' && !error.message.includes('sensitive'));

  const httpAnalyzer = new GeminiProductIdentityAnalyzer({
    apiKey, fetchImpl: async () => geminiResponse(null, {
      status: 429, rawText: 'upstream response with sensitive internals',
    }),
  });
  await assert.rejects(httpAnalyzer.analyze(analyzerInput()), (error) =>
    error.code === 'GEMINI_HTTP_ERROR' && !error.message.includes('sensitive'));
});

test('logging contém somente metadados sanitizados', async () => {
  const events = [];
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey,
    fetchImpl: async () => geminiResponse(unknownAnalysis()),
    logger: { info: (event) => events.push(event) },
  });
  await analyzer.analyze(analyzerInput());

  assert.equal(events.length, 1);
  assert.deepEqual(events[0].inputs, [{
    mimeType: 'image/jpeg', bytes: imageBytes.length, width: 1200, height: 900,
  }]);
  const serialized = JSON.stringify(events[0]);
  assert.doesNotMatch(serialized, new RegExp(apiKey));
  assert.doesNotMatch(serialized, new RegExp(imageBytes.toString('base64')));
  assert.doesNotMatch(serialized, /complete collection/);
});

test('benchmark offline: uma chamada alimenta V2, Hero Set e quatro intenções distintas', async () => {
  let fetchCalls = 0;
  const identities = [];
  const concepts = [];
  const analysis = {
    state: 'known',
    items: [
      genericItem({ id: 'item-a', observedFeatures: [
        { name: 'visible shape', value: 'compact rounded body' },
      ] }),
      genericItem({ id: 'item-b', quantity: 2, completeness: 'partial',
        observedFeatures: [{ name: 'visible texture', value: 'fine linear texture' }],
        ambiguousFeatures: [{
          name: 'hidden underside', visibility: 'hidden', observedConstraint: null,
          plausibleHypotheses: ['minimal continuation of the visible body'],
        }],
      }),
    ],
    relationships: [{ type: 'set', memberIds: ['item-a', 'item-b'], state: 'known' }],
  };
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey, fetchImpl: async () => {
      fetchCalls += 1;
      return geminiResponse(analysis);
    },
  });
  const builder = new ProductPhotoPromptBuilder();
  await generateProductPhotoBatch({
    productIdentityAnalyzer: analyzer,
    assetStore: { readImage: async () => ({
      bytes: imageBytes, mimeType: 'image/jpeg', metadata: { hash: 'fixture-hash' },
    }) },
    request: {
      prompt: 'Generic premium collection campaign.', inputAssetIds: [assetId],
      count: 4, quality: 'standard', aspectRatio: '1:1',
      preservation: { preserveProduct: true },
      parameters: { common: { productCategory: 'accessories' } },
    },
    promptBuilder: { build: (input) => {
      identities.push(input.identitySpecification);
      concepts.push(input.concept);
      return builder.build(input);
    } },
    provider: { generate: async () => ({ imageBase64: 'bW9jay1pbWFnZQ==' }) },
    creativeDirectorLogger: { info() {}, warn() {} },
  });

  assert.equal(fetchCalls, 1);
  assert.ok(identities.every((identity) => identity === identities[0]));
  assert.equal(identities[0].sourceInventory.state, 'known');
  assert.ok(identities[0].sourceInventory.items[1].ambiguousFeatures[0].canonicalHypothesis);
  assert.ok(concepts.some(({ name }) => name === 'HERO SET / PREMIUM STILL LIFE'));
  assert.ok(concepts.some(({ visibilityIntent }) => visibilityIntent.mode === 'contextual_use'));
  assert.ok(concepts.some(({ visibilityIntent }) => visibilityIntent.mode === 'macro_detail'));
  assert.ok(concepts.some(({ visibilityIntent }) => visibilityIntent.allowPartialVisibility));
});

test('benchmark uncertain mantém planejamento seguro sem Hero Set', async () => {
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey,
    fetchImpl: async () => geminiResponse({
      state: 'uncertain',
      items: [genericItem({
        typeState: 'unknown', type: null, quantityState: 'unknown', quantity: null,
        completeness: 'unknown',
      })],
      relationships: [],
    }),
  });
  const concepts = [];
  await generateProductPhotoBatch({
    productIdentityAnalyzer: analyzer,
    assetStore: { readImage: async () => ({
      bytes: imageBytes, mimeType: 'image/jpeg', metadata: {},
    }) },
    request: {
      prompt: 'Generic campaign.', inputAssetIds: [assetId], count: 4,
      quality: 'standard', aspectRatio: '1:1', preservation: {}, parameters: { common: {} },
    },
    promptBuilder: { build: ({ concept }) => {
      concepts.push(concept);
      return `safe prompt ${concepts.length}`;
    } },
    provider: { generate: async () => ({ imageBase64: 'bW9jaw==' }) },
    creativeDirectorLogger: { info() {}, warn() {} },
  });
  assert.ok(concepts.every(({ name }) => name !== 'HERO SET / PREMIUM STILL LIFE'));
  const macro = concepts.find(({ name }) => name === 'EXTREME MACRO');
  assert.equal(macro.visibilityIntent.selection,
    'reference_visible_detail_or_safe_close_view');
});

