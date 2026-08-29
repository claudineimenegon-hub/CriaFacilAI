import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';

import {
  DEFAULT_GEMINI_PRODUCT_IDENTITY_MODEL,
  GEMINI_GENERATE_CONTENT_BASE_URL,
  GEMINI_PRODUCT_IDENTITY_TIMEOUT_MS,
  GEMINI_PRODUCT_IDENTITY_RESPONSE_SCHEMA,
  GeminiProductIdentityAnalyzer,
  GeminiProductIdentityAnalyzerError,
} from '../image-to-image/gemini-product-identity-analyzer.mjs';
import {
  createProductIdentityAnalyzer,
} from '../image-to-image/product-identity-analyzer-factory.mjs';
import {
  canonicalizeProductIdentityEnum,
  PRODUCT_IDENTITY_ENUMS,
  UnknownProductIdentityAnalyzer,
} from '../image-to-image/product-identity-analyzer.mjs';
import { generateProductPhotoBatch } from '../image-to-image/image-transform-service.mjs';
import { ProductPhotoPromptBuilder } from '../image-to-image/product-photo-prompt-builder.mjs';

const apiKey = 'test-key-must-never-leak';
const assetId = '00000000-0000-4000-8000-000000000001';
const imageBytes = await sharp({
  create: { width: 1200, height: 900, channels: 3, background: '#808080' },
}).jpeg().toBuffer();

test('runtime V3 usa timeout padrão de 60 segundos para Product Identity', () => {
  const analyzer = new GeminiProductIdentityAnalyzer({ apiKey });
  assert.equal(GEMINI_PRODUCT_IDENTITY_TIMEOUT_MS, 60_000);
  assert.equal(analyzer.timeoutMs, 60_000);
  assert.ok(analyzer.timeoutMs > 20_000);
});

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

function semanticPropertyPaths(schema, prefix = '') {
  const paths = [];
  for (const [name, property] of Object.entries(schema?.properties ?? {})) {
    const path = prefix ? `${prefix}.${name}` : name;
    paths.push(path);
    if (property.type === 'object') paths.push(...semanticPropertyPaths(property, path));
    if (property.type === 'array' && property.items?.type === 'object') {
      paths.push(...semanticPropertyPaths(property.items, `${path}[]`));
    }
  }
  return paths.sort();
}

function collectRestrictionKeys(value, path = '$') {
  if (!value || typeof value !== 'object') return [];
  const restrictions = [];
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (['maxItems', 'minItems', 'minLength', 'maxLength', 'minimum', 'maximum',
      'additionalProperties', 'enum']
      .includes(key)) restrictions.push(entryPath);
    restrictions.push(...collectRestrictionKeys(entry, entryPath));
  }
  return restrictions;
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
  assert.equal(DEFAULT_GEMINI_PRODUCT_IDENTITY_MODEL, 'gemini-3.5-flash-lite');
  assert.equal(gemini.model, 'gemini-3.5-flash-lite');
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
  assert.match(instruction.text, /small structural or functional components/);
  assert.match(instruction.text, /clasps, extenders, connectors/);
  assert.match(instruction.text, /Do not invent hidden components/);
  assert.doesNotMatch(instruction.text, /jewel|ring|earring|gemstone/i);
  assert.deepEqual(image.inlineData, {
    mimeType: 'image/jpeg', data: imageBytes.toString('base64'),
  });
  assert.equal(body.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON');
  assert.deepEqual(body.generationConfig.responseFormat.text.schema,
    GEMINI_PRODUCT_IDENTITY_RESPONSE_SCHEMA);
  assert.equal(body.generationConfig.temperature, undefined);
  assert.equal(body.generationConfig.top_p, undefined);
  assert.equal(body.generationConfig.top_k, undefined);
  assert.equal(body.generationConfig.candidate_count, undefined);
  assert.equal(body.generationConfig.topP, undefined);
  assert.equal(body.generationConfig.topK, undefined);
  assert.equal(body.generationConfig.candidateCount, undefined);
  assert.deepEqual(Object.keys(body.generationConfig), ['responseFormat']);
});

test('schema remoto usa somente o subconjunto estrutural aceito pelo Gemini', () => {
  assert.deepEqual(semanticPropertyPaths(GEMINI_PRODUCT_IDENTITY_RESPONSE_SCHEMA), [
    'items',
    'items[].ambiguousFeatures',
    'items[].ambiguousFeatures[].id',
    'items[].ambiguousFeatures[].name',
    'items[].ambiguousFeatures[].observedConstraint',
    'items[].ambiguousFeatures[].plausibleHypotheses',
    'items[].ambiguousFeatures[].visibility',
    'items[].functionalType',
    'items[].functionalType.state',
    'items[].functionalType.value',
    'items[].id',
    'items[].observationCompleteness',
    'items[].observedFeatures',
    'items[].observedFeatures[].id',
    'items[].observedFeatures[].name',
    'items[].observedFeatures[].value',
    'items[].quantity',
    'items[].quantity.state',
    'items[].quantity.value',
    'relationships',
    'relationships[].memberIds',
    'relationships[].state',
    'relationships[].type',
    'relativeScale',
    'relativeScale[].confidence',
    'relativeScale[].referenceId',
    'relativeScale[].relation',
    'relativeScale[].subjectId',
    'state',
  ]);
  const item = GEMINI_PRODUCT_IDENTITY_RESPONSE_SCHEMA.properties.items.items;
  assert.deepEqual(GEMINI_PRODUCT_IDENTITY_RESPONSE_SCHEMA.required,
    ['state', 'items', 'relationships']);
  assert.deepEqual(item.required, [
    'id', 'functionalType', 'quantity', 'observationCompleteness',
    'observedFeatures', 'ambiguousFeatures',
  ]);
  assert.equal(item.properties.quantity.properties.value.type, 'integer');
  assert.equal(item.properties.quantity.properties.value.nullable, true);
  assert.equal(item.properties.functionalType.properties.value.type, 'string');
  assert.equal(item.properties.functionalType.properties.value.nullable, true);
  assert.deepEqual(collectRestrictionKeys(GEMINI_PRODUCT_IDENTITY_RESPONSE_SCHEMA), []);
  assert.doesNotMatch(JSON.stringify(GEMINI_PRODUCT_IDENTITY_RESPONSE_SCHEMA),
    /"type":\s*\[/);
});

test('aceita JSON estruturado cercado somente por code fence JSON', async () => {
  const analysis = { state: 'known', items: [genericItem()], relationships: [] };
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey,
    fetchImpl: async () => geminiResponse(null, {
      rawText: JSON.stringify({
        candidates: [{ content: { parts: [{ text: `\`\`\`json\n${JSON.stringify(analysis)}\n\`\`\`` }] } }],
      }),
    }),
  });
  assert.equal((await analyzer.analyze(analyzerInput())).items.length, 1);
});

test('normaliza wrapper e aliases estruturais seguros sem inventar conteúdo', async () => {
  const wrapped = {
    analysis: {
      state: 'known',
      products: [{
        id: 'canonical-product',
        functional_type: { state: 'known', value: 'wearable accessory' },
        quantity: { state: 'known', value: 1 },
        observation_completeness: 'partial',
        observed_features: [{ name: 'color', value: 'blue' }],
        ambiguous_features: [],
      }],
      relations: [],
    },
  };
  const events = [];
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey,
    fetchImpl: async () => geminiResponse(wrapped),
    logger: { info: (event) => events.push(event) },
  });
  const result = await analyzer.analyze(analyzerInput());
  assert.equal(result.items[0].id, 'canonical-product');
  assert.equal(result.items[0].functionalType.value, 'wearable accessory');
  assert.equal(result.items[0].quantity.value, 1);
  assert.deepEqual(result.relationships, []);
  assert.equal(events[0].normalizationApplied, true);
});

test('normaliza enum seguro de relativeScale antes da validação', async () => {
  const events = [];
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey,
    fetchImpl: async () => geminiResponse({
      state: 'known',
      items: [genericItem({ id: 'product-a' }), genericItem({ id: 'product-b' })],
      relationships: [],
      relativeScale: [{
        subject_id: 'product-a', reference_id: 'product-b',
        relation: 'slightly larger', confidence: 'HIGH',
      }],
    }),
    logger: { info: (event) => events.push(event) },
  });
  const result = await analyzer.analyze(analyzerInput());
  assert.deepEqual(result.relativeScale, [{
    subjectId: 'product-a', referenceId: 'product-b',
    relation: 'slightly_larger', confidence: 'high',
  }]);
  assert.equal(events[0].normalizationApplied, true);
});

test('canonicaliza enums seguros de toda a análise usando uma única fonte canônica', async () => {
  const events = [];
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey,
    fetchImpl: async () => geminiResponse({
      state: 'KNOWN',
      items: [{
        ...genericItem({ completeness: 'partially-observed' }),
        functionalType: { state: 'Known', value: 'generic product' },
        quantity: { state: ' known ', value: 1 },
        ambiguousFeatures: [{
          name: 'rear connection', visibility: 'partially-visible',
          observedConstraint: null, plausibleHypotheses: [],
        }],
      }],
      relationships: [{ type: 'set', memberIds: ['item-1'], state: 'Known' }],
      relativeScale: [],
    }),
    logger: { info: (event) => events.push(event) },
  });
  const result = await analyzer.analyze(analyzerInput());
  assert.equal(result.state, 'known');
  assert.equal(result.items[0].functionalType.state, 'known');
  assert.equal(result.items[0].quantity.state, 'known');
  assert.equal(result.items[0].observationCompleteness, 'partial');
  assert.equal(result.items[0].ambiguousFeatures[0].visibility, 'partial');
  assert.equal(result.relationships[0].state, 'known');
  assert.equal(events[0].normalizationApplied, true);

  assert.equal(canonicalizeProductIdentityEnum('state', 'KNOWN'), 'known');
  assert.equal(canonicalizeProductIdentityEnum('state', 'Known'), 'known');
  assert.equal(canonicalizeProductIdentityEnum('observationCompleteness', 'fully-observed'), 'complete');
  assert.equal(canonicalizeProductIdentityEnum('ambiguousFeatureVisibility', 'not visible'), 'hidden');
  assert.equal(canonicalizeProductIdentityEnum('relativeScaleRelation', 'slightly-larger'), 'slightly_larger');
  assert.deepEqual(PRODUCT_IDENTITY_ENUMS.state, ['known', 'uncertain', 'unknown']);
});

test('enum semanticamente ambíguo é rejeitado sem retry', async () => {
  const requests = [];
  const events = [];
  const secret = 'sensitive-value-that-must-not-appear';
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey,
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return geminiResponse({
        state: 'known',
        items: [{
          ...genericItem({ completeness: 'partial' }),
          ambiguousFeatures: [{
            name: secret, visibility: 'visible', observedConstraint: null,
            plausibleHypotheses: [],
          }],
        }],
        relationships: [],
      });
    },
    logger: { info: (event) => events.push(event) },
  });
  await assert.rejects(analyzer.analyze(analyzerInput()), {
    code: 'INVALID_PRODUCT_IDENTITY_ANALYSIS',
  });
  assert.equal(requests.length, 1);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].attemptDiagnostics, [
    {
      attempt: 1,
      validationField: 'items[0].ambiguousFeatures[0].visibility',
      validationReason: 'invalid_enum', retryUsed: false,
      normalizationApplied: false, receivedEnumToken: 'visible',
    },
  ]);
  const telemetry = JSON.stringify(events[0]);
  assert.doesNotMatch(telemetry, new RegExp(secret));
  assert.doesNotMatch(telemetry, /test-key-must-never-leak|base64|data:image/i);
});

test('relativeScale desconhecido ou inválido é omitido sem abortar a identidade válida', async () => {
  const responses = [
    { relation: 'approximately_same', confidence: 'unknown' },
    { relation: 'artistically_bigger', confidence: 'high' },
  ];
  for (const comparison of responses) {
    let calls = 0;
    const analyzer = new GeminiProductIdentityAnalyzer({
      apiKey,
      fetchImpl: async () => {
        calls += 1;
        return geminiResponse({
          state: 'known',
          items: [genericItem({ id: 'product-a' }), genericItem({ id: 'product-b' })],
          relationships: [],
          relativeScale: [{
            subjectId: 'product-a', referenceId: 'product-b', ...comparison,
          }],
        });
      },
    });
    const result = await analyzer.analyze(analyzerInput());
    assert.deepEqual(result.relativeScale, []);
    assert.equal(result.items.length, 2);
    assert.equal(calls, 1);
  }
});

test('saída estrutural inválida não recebe retry', async () => {
  let calls = 0;
  const requestBodies = [];
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey,
    fetchImpl: async (_url, options) => {
      calls += 1;
      requestBodies.push(JSON.parse(options.body));
      return geminiResponse({ state: 'known', items: 'invalid', relationships: [] });
    },
  });
  await assert.rejects(analyzer.analyze(analyzerInput()), {
    code: 'INVALID_PRODUCT_IDENTITY_ANALYSIS',
  });
  assert.equal(calls, 1);
  assert.doesNotMatch(requestBodies[0].contents[0].parts[0].text, /Technical correction/);
});

test('saída inválida não promove fallback para Product Identity', async () => {
  let calls = 0;
  const events = [];
  const fallbackAnalysis = {
    state: 'known',
    items: [genericItem({ id: 'confirmed-id', type: 'confirmed type', quantity: 2 })],
    relationships: [],
  };
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey,
    fetchImpl: async () => {
      calls += 1;
      return geminiResponse({ state: 'known', items: 'invalid', relationships: [] });
    },
    logger: { info: (event) => events.push(event) },
  });
  await assert.rejects(analyzer.analyze({ ...analyzerInput(), fallbackAnalysis }), {
    code: 'INVALID_PRODUCT_IDENTITY_ANALYSIS',
  });
  assert.equal(calls, 1);
  assert.equal(events[0].fallbackUsed, false);
  assert.equal(events[0].retryUsed, false);
  assert.equal(events[0].attempt, 1);
});

test('saída inválida e evidência insuficiente falham sem inventar identidade', async () => {
  let calls = 0;
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey,
    fetchImpl: async () => {
      calls += 1;
      return geminiResponse({ state: 'known', items: 'invalid', relationships: [] });
    },
  });
  await assert.rejects(analyzer.analyze({
    ...analyzerInput(),
    fallbackAnalysis: { state: 'unknown', items: [], relationships: [] },
  }), { code: 'INVALID_PRODUCT_IDENTITY_ANALYSIS' });
  assert.equal(calls, 1);
});

test('telemetria classifica validações locais sem incluir conteúdo da resposta', async (t) => {
  const scenarios = [
    {
      name: 'quantidade inválida',
      mutate: (analysis) => { analysis.items[0].quantity.value = 0; },
      reason: 'invalid_quantity',
    },
    {
      name: 'ID duplicado',
      mutate: (analysis) => { analysis.items.push(genericItem()); },
      reason: 'duplicate_item_id',
    },
    {
      name: 'relacionamento inválido',
      mutate: (analysis) => {
        analysis.relationships.push({ type: 'set', memberIds: ['missing'], state: 'known' });
      },
      reason: 'invalid_relationship',
    },
    {
      name: 'unknown com valor',
      mutate: (analysis) => {
        analysis.items[0].functionalType = { state: 'unknown', value: 'forbidden-value' };
      },
      reason: 'invalid_unknown_value',
    },
    {
      name: 'campo extra',
      mutate: (analysis) => { analysis.items[0].unexpected = 'private-response-content'; },
      reason: 'additional_property',
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const analysis = { state: 'known', items: [genericItem()], relationships: [] };
      scenario.mutate(analysis);
      const events = [];
      const analyzer = new GeminiProductIdentityAnalyzer({
        apiKey,
        fetchImpl: async () => geminiResponse(analysis),
        logger: { info: (event) => events.push(event) },
      });
      await assert.rejects(analyzer.analyze(analyzerInput()), {
        code: 'INVALID_PRODUCT_IDENTITY_ANALYSIS',
      });
      assert.equal(events[0].validationStage, 'schema_validation');
      assert.equal(events[0].validationReason, scenario.reason);
      assert.doesNotMatch(JSON.stringify(events[0]), /forbidden-value|private-response-content/);
    });
  }
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
  let timeoutCalls = 0;
  const timeoutEvents = [];
  const timeoutAnalyzer = new GeminiProductIdentityAnalyzer({
    apiKey, timeoutMs: 5,
    backoff: async () => {},
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      timeoutCalls += 1;
      signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
    logger: { info: (event) => timeoutEvents.push(event) },
  });
  await assert.rejects(timeoutAnalyzer.analyze(analyzerInput()),
    (error) => error.code === 'GEMINI_TIMEOUT');
  assert.equal(timeoutCalls, 2);
  assert.equal(timeoutEvents.length, 1);
  assert.equal(timeoutEvents[0].timeoutMs, 5);
  assert.equal(timeoutEvents[0].errorCode, 'GEMINI_TIMEOUT');
  assert.equal(timeoutEvents[0].attempt, 2);
  assert.equal(timeoutEvents[0].retryUsed, true);
  assert.equal(timeoutEvents[0].items, 0);

  const networkAnalyzer = new GeminiProductIdentityAnalyzer({
    apiKey, fetchImpl: async () => { throw new Error('sensitive network details'); },
  });
  await assert.rejects(networkAnalyzer.analyze(analyzerInput()), (error) =>
    error.code === 'GEMINI_NETWORK_ERROR' && !error.message.includes('sensitive'));

  let httpCalls = 0;
  const httpAnalyzer = new GeminiProductIdentityAnalyzer({
    apiKey, fetchImpl: async () => {
      httpCalls += 1;
      return geminiResponse(null, {
        status: 400, rawText: 'upstream response with sensitive internals',
      });
    },
  });
  await assert.rejects(httpAnalyzer.analyze(analyzerInput()), (error) =>
    error.code === 'GEMINI_HTTP_ERROR' && !error.message.includes('sensitive'));
  assert.equal(httpCalls, 1);
});

test('retry transitório é restrito a duas tentativas e registra backoff sanitizado', async () => {
  const valid = { state: 'known', items: [genericItem()], relationships: [] };
  const events = [];
  const waits = [];
  let calls = 0;
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey,
    random: () => 0.5,
    backoff: async (ms) => waits.push(ms),
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? geminiResponse(null, {
          status: 503,
          rawText: JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'high demand' } }),
        })
        : geminiResponse(valid);
    },
    logger: { info: (event) => events.push(event) },
  });
  assert.equal((await analyzer.analyze(analyzerInput())).items.length, 1);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2250]);
  assert.equal(events[0].attempt, 2);
  assert.equal(events[0].maxAttempts, 2);
  assert.equal(events[0].retryUsed, true);
  assert.equal(events[0].retryReason, 'HTTP_503');
  assert.equal(events[0].backoffMs, 2250);
  assert.equal(events[0].timeoutMs, 60_000);
  assert.equal(typeof events[0].totalLatencyMs, 'number');
});

test('timeout transitório pode obter sucesso somente na segunda tentativa', async () => {
  let calls = 0;
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey, timeoutMs: 5, backoff: async () => {}, random: () => 0,
    fetchImpl: async (_url, { signal }) => {
      calls += 1;
      if (calls === 2) {
        return geminiResponse({ state: 'known', items: [genericItem()], relationships: [] });
      }
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true }));
    },
  });
  assert.equal((await analyzer.analyze(analyzerInput())).items.length, 1);
  assert.equal(calls, 2);
});

test('HTTP não transitório e segunda falha transitória não excedem o máximo', async () => {
  let badRequestCalls = 0;
  const badRequest = new GeminiProductIdentityAnalyzer({
    apiKey, backoff: async () => {},
    fetchImpl: async () => {
      badRequestCalls += 1;
      return geminiResponse(null, { status: 400, rawText: '{}' });
    },
  });
  await assert.rejects(badRequest.analyze(analyzerInput()), { code: 'GEMINI_HTTP_ERROR' });
  assert.equal(badRequestCalls, 1);

  let unavailableCalls = 0;
  const unavailable = new GeminiProductIdentityAnalyzer({
    apiKey, backoff: async () => {},
    fetchImpl: async () => {
      unavailableCalls += 1;
      return geminiResponse(null, { status: 503, rawText: '{}' });
    },
  });
  await assert.rejects(unavailable.analyze(analyzerInput()), { code: 'GEMINI_HTTP_ERROR' });
  assert.equal(unavailableCalls, 2);
});

test('cache de sucesso respeita hit, TTL, limite e não armazena falhas', async () => {
  let now = 1_000;
  let calls = 0;
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey, cacheTtlMs: 10, cacheMaxEntries: 2, now: () => now,
    backoff: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return geminiResponse({ state: 'known', items: [genericItem()], relationships: [] });
    },
  });
  const withHash = (character) => ({ ...analyzerInput(), cacheKey: character.repeat(64) });
  await analyzer.analyze(withHash('a'));
  const cached = await analyzer.analyze(withHash('a'));
  assert.equal(calls, 1);
  assert.throws(() => { cached.items.push(genericItem()); }, TypeError);
  now += 11;
  await analyzer.analyze(withHash('a'));
  assert.equal(calls, 2);
  await analyzer.analyze(withHash('b'));
  await analyzer.analyze(withHash('c'));
  await analyzer.analyze(withHash('a'));
  assert.equal(calls, 5);

  let failedCalls = 0;
  const failed = new GeminiProductIdentityAnalyzer({
    apiKey, backoff: async () => {},
    fetchImpl: async () => {
      failedCalls += 1;
      return failedCalls <= 2
        ? geminiResponse(null, { status: 503, rawText: '{}' })
        : geminiResponse({ state: 'known', items: [genericItem()], relationships: [] });
    },
  });
  await assert.rejects(failed.analyze(withHash('d')), { code: 'GEMINI_HTTP_ERROR' });
  await failed.analyze(withHash('d'));
  assert.equal(failedCalls, 3);
});

test('requisições simultâneas do mesmo hash compartilham in-flight', async () => {
  let calls = 0;
  let release;
  const responseReady = new Promise((resolve) => { release = resolve; });
  const events = [];
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey,
    fetchImpl: async () => {
      calls += 1;
      await responseReady;
      return geminiResponse({ state: 'known', items: [genericItem()], relationships: [] });
    },
    logger: { info: (event) => events.push(event) },
  });
  const input = { ...analyzerInput(), cacheKey: 'e'.repeat(64) };
  const first = analyzer.analyze(input);
  const second = analyzer.analyze(input);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  assert.ok(events.some(({ inFlightShared }) => inFlightShared === true));
});

test('cancelamento durante backoff impede segunda chamada', async () => {
  const controller = new AbortController();
  let calls = 0;
  const analyzer = new GeminiProductIdentityAnalyzer({
    apiKey,
    fetchImpl: async () => {
      calls += 1;
      return geminiResponse(null, { status: 503, rawText: '{}' });
    },
    backoff: async (_ms, { signal }) => {
      controller.abort();
      assert.equal(signal.aborted, true);
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    },
  });
  await assert.rejects(analyzer.analyze({ ...analyzerInput(), signal: controller.signal }), {
    code: 'GEMINI_TIMEOUT',
  });
  assert.equal(calls, 1);
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
  assert.equal(events[0].errorCode, null);
  assert.equal(events[0].statusHttp, 200);
  assert.equal(events[0].timeoutMs, GEMINI_PRODUCT_IDENTITY_TIMEOUT_MS);
  assert.equal(events[0].inputCount, 1);
  assert.equal(events[0].state, 'unknown');
  assert.equal(events[0].items, 0);
  assert.equal(events[0].relationships, 0);
  assert.equal(events[0].fallback, false);
  const serialized = JSON.stringify(events[0]);
  assert.doesNotMatch(serialized, new RegExp(apiKey));
  assert.doesNotMatch(serialized, new RegExp(imageBytes.toString('base64')));
  assert.doesNotMatch(serialized, /complete collection/);
});

test('preserva somente mensagem HTTP curta e segura do Gemini', async (t) => {
  await t.test('mensagem segura', async () => {
    const events = [];
    const analyzer = new GeminiProductIdentityAnalyzer({
      apiKey,
      logger: { info: (event) => events.push(event) },
      fetchImpl: async () => geminiResponse(null, {
        status: 404,
        rawText: JSON.stringify({ error: { message: 'Model is not available for generateContent.' } }),
      }),
    });
    await assert.rejects(analyzer.analyze(analyzerInput()), { code: 'GEMINI_HTTP_ERROR' });
    assert.equal(events[0].upstreamMessage, 'Model is not available for generateContent.');
  });

  await t.test('status e violações de campo seguras', async () => {
    const events = [];
    const analyzer = new GeminiProductIdentityAnalyzer({
      apiKey,
      logger: { info: (event) => events.push(event) },
      fetchImpl: async () => geminiResponse(null, {
        status: 400,
        rawText: JSON.stringify({ error: {
          message: 'Request contains an invalid argument.',
          status: 'INVALID_ARGUMENT',
          details: [{
            '@type': 'type.googleapis.com/google.rpc.BadRequest',
            fieldViolations: [{
              field: 'generation_config.response_format.text.schema.properties.items',
              description: 'Schema exceeded the supported complexity.',
            }],
          }],
        } }),
      }),
    });
    await assert.rejects(analyzer.analyze(analyzerInput()), { code: 'GEMINI_HTTP_ERROR' });
    assert.equal(events[0].upstreamStatus, 'INVALID_ARGUMENT');
    assert.deepEqual(events[0].fieldViolations, [{
      field: 'generation_config.response_format.text.schema.properties.items',
      description: 'Schema exceeded the supported complexity.',
    }]);
  });

  await t.test('mensagem sensível', async () => {
    const events = [];
    const analyzer = new GeminiProductIdentityAnalyzer({
      apiKey,
      logger: { info: (event) => events.push(event) },
      fetchImpl: async () => geminiResponse(null, {
        status: 400,
        rawText: JSON.stringify({ error: {
          message: 'data:image/jpeg;base64,PRIVATE_BYTES',
          status: 'invalid status',
          details: [{ fieldViolations: [{
            field: 'unsafe field with spaces',
            description: 'Authorization: secret data:image/jpeg;base64,PRIVATE_BYTES',
          }] }],
        } }),
      }),
    });
    await assert.rejects(analyzer.analyze(analyzerInput()), { code: 'GEMINI_HTTP_ERROR' });
    assert.equal(events[0].upstreamMessage, undefined);
    assert.equal(events[0].upstreamStatus, undefined);
    assert.equal(events[0].fieldViolations, undefined);
    assert.doesNotMatch(JSON.stringify(events), /data:image|base64|PRIVATE_BYTES/);
  });
});

test('telemetria distingue todas as categorias de falha Gemini', async (t) => {
  const scenarios = [
    {
      name: 'not configured', code: 'GEMINI_NOT_CONFIGURED', statusHttp: null,
      options: { apiKey: '', fetchImpl: async () => { throw new Error('must not run'); } },
    },
    {
      name: 'timeout', code: 'GEMINI_TIMEOUT', statusHttp: null,
      options: {
        apiKey, timeoutMs: 5,
        backoff: async () => {},
        fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
      },
    },
    {
      name: 'network', code: 'GEMINI_NETWORK_ERROR', statusHttp: null,
      options: { apiKey, fetchImpl: async () => { throw new Error('dns secret'); } },
    },
    {
      name: 'http', code: 'GEMINI_HTTP_ERROR', statusHttp: 400,
      options: { apiKey, fetchImpl: async () => geminiResponse(null, {
        status: 400, rawText: 'private upstream response',
      }) },
    },
    {
      name: 'too large', code: 'GEMINI_RESPONSE_TOO_LARGE', statusHttp: 200,
      options: { apiKey, fetchImpl: async () => geminiResponse(null, {
        rawText: 'x'.repeat(128 * 1024 + 1),
      }) },
    },
    {
      name: 'invalid json', code: 'GEMINI_INVALID_JSON', statusHttp: 200,
      options: { apiKey, fetchImpl: async () => geminiResponse(null, { rawText: '{invalid' }) },
    },
    {
      name: 'invalid analysis', code: 'INVALID_PRODUCT_IDENTITY_ANALYSIS', statusHttp: 200,
      options: { apiKey, fetchImpl: async () => geminiResponse({
        state: 'known', items: 'invalid', relationships: [],
      }) },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const events = [];
      const analyzer = new GeminiProductIdentityAnalyzer({
        ...scenario.options,
        logger: { info: (event) => events.push(event) },
      });
      await assert.rejects(analyzer.analyze(analyzerInput()), { code: scenario.code });
      assert.equal(events.length, 1);
      assert.equal(events[0].errorCode, scenario.code);
      assert.equal(events[0].statusHttp, scenario.statusHttp);
      assert.equal(events[0].fallback, true);
      assert.equal(events[0].state, 'unknown');
      assert.equal(events[0].items, 0);
      assert.equal(events[0].relationships, 0);
      const serialized = JSON.stringify(events[0]);
      assert.doesNotMatch(serialized, /test-key-must-never-leak|base64|data:image|dns secret|private upstream/i);
    });
  }
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
