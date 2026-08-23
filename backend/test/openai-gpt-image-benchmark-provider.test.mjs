import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createOpenAIGPTImageBenchmarkProvider,
  OPENAI_BENCHMARK_IMAGE_ENDPOINT,
  OPENAI_BENCHMARK_IMAGE_MODEL,
  OPENAI_BENCHMARK_TIMEOUT_MS,
  sanitizeOpenAIImageUsage,
} from '../benchmark/openai-gpt-image-benchmark-provider.mjs';
import { createBenchmarkAdapterRegistry } from '../benchmark/benchmark-adapters.mjs';
import { runVisualBenchmark } from '../benchmark/benchmark-runner.mjs';
import { createCreativeDirectorV2Briefings } from '../benchmark/creative-director-v2.mjs';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const source = { bytes: Buffer.from([0xff, 0xd8, 0xff]), mimeType: 'image/jpeg' };

function request(overrides = {}) {
  return {
    prompt: 'Master brief\nCONCEPT DIRECTION: premium lifestyle/editorial',
    inputs: [source],
    parameters: { common: {}, provider: {} },
    preservation: {},
    output: { width: 1024, height: 1024, count: 1 },
    ...overrides,
  };
}

function successResponse(extra = {}) {
  return new Response(JSON.stringify({
    data: [{ b64_json: png.toString('base64') }],
    ...extra,
  }), { headers: { 'content-type': 'application/json' } });
}

test('fica indisponível sem credencial e --list pode refletir configuration_required', async () => {
  const provider = createOpenAIGPTImageBenchmarkProvider({ apiKey: '' });
  assert.equal(provider.isConfigured, false);
  await assert.rejects(provider.generate(request()), { code: 'PROVIDER_NOT_CONFIGURED' });
  const registry = createBenchmarkAdapterRegistry({ gptImageProvider: provider });
  const adapter = registry.get('openai-gpt-image');
  assert.equal(adapter.ready, false);
  assert.equal(adapter.provider, 'openai-gpt-image');
  assert.equal(adapter.model, 'gpt-image-2');
});

test('medium e high são enviados diretamente no campo quality', async () => {
  for (const quality of ['medium', 'high']) {
    let form;
    let calls = 0;
    const provider = createOpenAIGPTImageBenchmarkProvider({
      apiKey: 'test',
      fetchImpl: async (_url, options) => {
        calls += 1;
        form = options.body;
        return successResponse();
      },
    });
    const result = await provider.generate(request({
      parameters: { common: {}, provider: { quality } },
    }));
    assert.equal(form.get('quality'), quality);
    assert.equal(form.get('size'), '1024x1024');
    assert.equal(result.technicalMetadata.quality, quality);
    assert.equal(calls, 1);
  }
});

test('quality inválida é rejeitada antes de qualquer chamada', async () => {
  let calls = 0;
  const provider = createOpenAIGPTImageBenchmarkProvider({
    apiKey: 'test',
    fetchImpl: async () => { calls += 1; return successResponse(); },
  });
  await assert.rejects(provider.generate(request({
    parameters: { common: {}, provider: { quality: 'ultra' } },
  })), { code: 'INVALID_BENCHMARK_QUALITY' });
  assert.equal(calls, 0);
});

test('envia multipart oficial com imagem-fonte, prompt e somente campos documentados', async () => {
  const apiKey = 'test-key-not-real';
  let captured;
  const provider = createOpenAIGPTImageBenchmarkProvider({
    apiKey,
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return successResponse();
    },
  });
  const result = await provider.generate(request());
  const form = captured.options.body;
  const fieldNames = [...new Set([...form.keys()])].sort();

  assert.equal(captured.url, OPENAI_BENCHMARK_IMAGE_ENDPOINT);
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers.Authorization, `Bearer ${apiKey}`);
  assert.equal(Object.hasOwn(captured.options.headers, 'Content-Type'), false);
  assert.deepEqual(fieldNames, [
    'image[]', 'model', 'output_format', 'prompt', 'quality', 'size',
  ]);
  assert.equal(form.get('model'), OPENAI_BENCHMARK_IMAGE_MODEL);
  assert.equal(form.get('prompt'), request().prompt);
  assert.equal(form.get('size'), '1024x1024');
  assert.equal(form.get('quality'), 'high');
  assert.equal(form.get('output_format'), 'png');
  assert.equal(form.has('input_fidelity'), false);
  assert.equal(form.has('seed'), false);
  const image = form.getAll('image[]')[0];
  assert.equal(image.type, 'image/jpeg');
  assert.equal(Buffer.from(await image.arrayBuffer()).equals(source.bytes), true);
  assert.equal(result.imageBase64, png.toString('base64'));
  assert.equal(result.technicalMetadata.seed, null);
});

test('usa timeout isolado de 300 segundos e faz somente uma tentativa', async () => {
  let configuredTimeout;
  let calls = 0;
  const provider = createOpenAIGPTImageBenchmarkProvider({
    apiKey: 'test',
    timeoutSignalFactory: (milliseconds) => {
      configuredTimeout = milliseconds;
      return new AbortController().signal;
    },
    fetchImpl: async () => {
      calls += 1;
      return successResponse();
    },
  });
  await provider.generate(request());
  assert.equal(configuredTimeout, OPENAI_BENCHMARK_TIMEOUT_MS);
  assert.equal(configuredTimeout, 300_000);
  assert.equal(calls, 1);
});

test('valida timeout e classifica falhas de transporte sem dados sensíveis', async () => {
  const cases = [
    { expected: 'INVALID_TIMEOUT', timeoutMs: Number.NaN, fetchImpl: async () => successResponse() },
    { expected: 'FETCH_UNAVAILABLE', timeoutMs: 300_000, fetchImpl: null },
    { expected: 'DNS_ERROR', timeoutMs: 300_000, causeCode: 'ENOTFOUND', fetchImpl: async () => { throw Object.assign(new TypeError('secret dns'), { cause: { name: 'Error', code: 'ENOTFOUND' } }); } },
    { expected: 'TLS_ERROR', timeoutMs: 300_000, causeCode: 'ERR_TLS_CERT_ALTNAME_INVALID', fetchImpl: async () => { throw Object.assign(new TypeError('secret tls'), { cause: { name: 'Error', code: 'ERR_TLS_CERT_ALTNAME_INVALID' } }); } },
    { expected: 'CONNECTION_ERROR', timeoutMs: 300_000, causeCode: 'UND_ERR_CONNECT_TIMEOUT', fetchImpl: async () => { throw Object.assign(new TypeError('secret connection'), { cause: { name: 'ConnectTimeoutError', code: 'UND_ERR_CONNECT_TIMEOUT' } }); } },
    { expected: 'UNKNOWN_TRANSPORT_ERROR', timeoutMs: 300_000, fetchImpl: async () => { throw new Error('secret unknown'); } },
  ];

  for (const item of cases) {
    const logs = [];
    const provider = createOpenAIGPTImageBenchmarkProvider({
      apiKey: 'secret-key-never-log',
      timeoutMs: item.timeoutMs,
      fetchImpl: item.fetchImpl,
      logger: { warn: (event) => logs.push(event) },
    });
    await assert.rejects(provider.generate(request()), { code: 'PROVIDER_UNAVAILABLE' });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].transportFailureCause, item.expected);
    assert.match(logs[0].errorName, /^(Error|TypeError)$/);
    if (item.causeCode) assert.equal(logs[0].causeCode, item.causeCode);
    assert.equal(Object.hasOwn(logs[0], 'stack'), false);
    assert.doesNotMatch(JSON.stringify(logs), /secret|base64|data:image|authorization|prompt|stack/i);
  }
});

test('registra error.code e cause.name somente como tokens sanitizados', async () => {
  const logs = [];
  const provider = createOpenAIGPTImageBenchmarkProvider({
    apiKey: 'test',
    logger: { warn: (event) => logs.push(event) },
    fetchImpl: async () => {
      throw Object.assign(new TypeError('private upstream message'), {
        code: 'UND_ERR_SOCKET',
        cause: { name: 'SocketError', code: 'UND_ERR_SOCKET' },
      });
    },
  });
  await assert.rejects(provider.generate(request()), { code: 'PROVIDER_UNAVAILABLE' });
  assert.equal(logs[0].transportFailureCause, 'CONNECTION_ERROR');
  assert.equal(logs[0].errorName, 'TypeError');
  assert.equal(logs[0].errorCode, 'UND_ERR_SOCKET');
  assert.equal(logs[0].causeCode, 'UND_ERR_SOCKET');
  assert.equal(logs[0].causeName, 'SocketError');
  assert.doesNotMatch(JSON.stringify(logs), /private|message|stack|prompt|base64|authorization/i);
});

test('classifica AggregateError do Node/undici pelos códigos internos seguros', async () => {
  const cases = [
    { code: 'ENETUNREACH', expected: 'CONNECTION_ERROR' },
    { code: 'ECONNREFUSED', expected: 'CONNECTION_ERROR' },
    { code: 'EAI_AGAIN', expected: 'DNS_ERROR' },
  ];
  for (const item of cases) {
    const logs = [];
    const aggregate = Object.assign(new AggregateError([], 'private aggregate'), {
      errors: [Object.assign(new Error('private nested'), { code: item.code })],
    });
    const provider = createOpenAIGPTImageBenchmarkProvider({
      apiKey: 'test',
      logger: { warn: (event) => logs.push(event) },
      fetchImpl: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: aggregate }); },
    });
    await assert.rejects(provider.generate(request()), { code: 'PROVIDER_UNAVAILABLE' });
    assert.equal(logs[0].transportFailureCause, item.expected);
    assert.deepEqual(logs[0].nestedCauseCodes, [item.code]);
    assert.deepEqual(logs[0].nestedCauseNames, ['AggregateError', 'Error']);
    assert.doesNotMatch(JSON.stringify(logs), /private|fetch failed|message|stack|prompt|base64|authorization/i);
  }
});

test('identifica de forma sanitizada se TypeError ocorre no AbortSignal ou no fetch', async () => {
  const cases = [
    {
      expected: 'ABORT_SIGNAL_CREATION',
      timeoutSignalFactory: () => { throw new TypeError('private abort detail'); },
      fetchImpl: async () => successResponse(),
    },
    {
      expected: 'FETCH_CALL',
      timeoutSignalFactory: () => new AbortController().signal,
      fetchImpl: async () => { throw new TypeError('private fetch detail'); },
    },
  ];
  for (const item of cases) {
    const logs = [];
    const provider = createOpenAIGPTImageBenchmarkProvider({
      apiKey: 'test',
      logger: { warn: (event) => logs.push(event) },
      timeoutSignalFactory: item.timeoutSignalFactory,
      fetchImpl: item.fetchImpl,
    });
    await assert.rejects(provider.generate(request()), { code: 'PROVIDER_UNAVAILABLE' });
    assert.equal(logs[0].transportFailureStage, item.expected);
    assert.equal(logs[0].errorName, 'TypeError');
    assert.doesNotMatch(JSON.stringify(logs), /private|detail|message|stack|prompt|base64|authorization/i);
  }
});

test('envia referência estética como segunda image[]', async () => {
  let form;
  const provider = createOpenAIGPTImageBenchmarkProvider({
    apiKey: 'test',
    fetchImpl: async (_url, options) => { form = options.body; return successResponse(); },
  });
  await provider.generate(request({
    inputs: [source, { bytes: png, mimeType: 'image/png' }],
  }));
  assert.equal(form.getAll('image[]').length, 2);
  assert.deepEqual(form.getAll('image[]').map(({ type }) => type), ['image/jpeg', 'image/png']);
});

test('sanitiza erro sem chave, prompt, base64 ou resposta bruta nos logs', async () => {
  const logs = [];
  const secretKey = 'secret-key-never-log';
  const provider = createOpenAIGPTImageBenchmarkProvider({
    apiKey: secretKey,
    logger: { warn: (event) => logs.push(event) },
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        code: 'invalid_image',
        message: `private prompt data:image/png;base64,SECRET ${secretKey}`,
      },
    }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'x-request-id': 'req_safe_123' },
    }),
  });
  await assert.rejects(provider.generate(request()), { code: 'invalid_image', status: 400 });
  assert.equal(logs.length, 1);
  assert.deepEqual(Object.keys(logs[0]).sort(), [
    'category', 'elapsedMs', 'model', 'provider', 'providerErrorCode',
    'statusHttp', 'timestamp', 'upstreamRequestId',
  ]);
  const serialized = JSON.stringify(logs);
  assert.doesNotMatch(serialized, /secret-key|private prompt|base64|data:image|authorization/i);
});

test('aceita tamanhos oficiais e rejeita dimensões não suportadas antes da rede', async () => {
  let calls = 0;
  const forms = [];
  const provider = createOpenAIGPTImageBenchmarkProvider({
    apiKey: 'test', fetchImpl: async (_, { body }) => { calls += 1; forms.push(body); return successResponse(); },
  });
  await provider.generate(request({ output: { width: 1024, height: 1536, count: 1 } }));
  await provider.generate(request({ output: { width: 1536, height: 1024, count: 1 } }));
  await assert.rejects(provider.generate(request({
    output: { width: 1024, height: 1280, count: 1 },
  })), { code: 'INVALID_OUTPUT_DIMENSIONS' });
  assert.equal(calls, 2);
  assert.deepEqual(forms.map((form) => form.get('size')), ['1024x1536', '1536x1024']);
});

test('briefing V2, fonte e size permanecem idênticos em medium', async () => {
  const briefing = createCreativeDirectorV2Briefings({
    functionalType: 'jewelry set: one ring and one pair of earrings',
    quantity: 'one ring and two earrings forming one pair',
    affordance: 'wearable',
    bodyPlacement: 'earlobes for earrings; finger for ring',
  }).find(({ id }) => id === 'editorial-still-life');
  let form;
  const provider = createOpenAIGPTImageBenchmarkProvider({
    apiKey: 'test',
    fetchImpl: async (_url, options) => { form = options.body; return successResponse(); },
  });
  await provider.generate(request({
    prompt: briefing.prompt,
    parameters: { common: {}, provider: { quality: 'medium' } },
  }));
  assert.equal(form.get('prompt'), briefing.prompt);
  assert.equal(form.get('quality'), 'medium');
  assert.equal(form.get('size'), '1024x1024');
  assert.equal(
    Buffer.from(await form.get('image[]').arrayBuffer()).equals(source.bytes),
    true,
  );
});

test('usage numérico documentado é sanitizado e persistido sem conteúdo sensível', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'criafacil-openai-usage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const rawUsage = {
    input_tokens: 120,
    output_tokens: 900,
    total_tokens: 1020,
    input_tokens_details: { image_tokens: 100, text_tokens: 20, secret: 'ignore' },
    output_tokens_details: { image_tokens: 900, text_tokens: 0 },
    prompt: 'private prompt',
    image: 'data:image/png;base64,SECRET',
  };
  const expectedUsage = {
    input_tokens: 120,
    output_tokens: 900,
    total_tokens: 1020,
    input_tokens_details: { image_tokens: 100, text_tokens: 20 },
    output_tokens_details: { image_tokens: 900, text_tokens: 0 },
  };
  assert.deepEqual(sanitizeOpenAIImageUsage(rawUsage), expectedUsage);
  const provider = createOpenAIGPTImageBenchmarkProvider({
    apiKey: 'test',
    fetchImpl: async () => successResponse({ usage: rawUsage }),
  });
  const adapter = createBenchmarkAdapterRegistry({ gptImageProvider: provider })
    .get('openai-gpt-image');
  const briefing = createCreativeDirectorV2Briefings({
    functionalType: 'jewelry set', affordance: 'wearable',
    bodyPlacement: 'earlobes for earrings; finger for ring',
  }).find(({ id }) => id === 'editorial-still-life');
  const [result] = await runVisualBenchmark({
    adapters: [adapter],
    source,
    quality: 'medium',
    concepts: [briefing],
    promptBuilder: (item) => item.prompt,
    outputDirectory: directory,
  });
  const metadata = JSON.parse(await readFile(result.metadataPath, 'utf8'));
  assert.equal(metadata.provider, 'openai-gpt-image');
  assert.equal(metadata.model, 'gpt-image-2');
  assert.equal(metadata.concept, 'editorial-still-life');
  assert.equal(metadata.quality, 'medium');
  assert.equal(metadata.width, 1024);
  assert.equal(metadata.height, 1024);
  assert.equal(metadata.referenceCount, 1);
  assert.deepEqual(metadata.usage, expectedUsage);
  assert.doesNotMatch(
    JSON.stringify(metadata),
    /private prompt|data:image|base64|authorization|api.?key|SECRET/i,
  );
});
