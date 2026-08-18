import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createServer } from '../server.mjs';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function start(options = {}) {
  const server = createServer(options);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

function provider(overrides = {}) {
  return {
    name: 'test',
    model: 'test-model',
    isConfigured: true,
    generate: async () => 'imagem-base64',
    ...overrides,
  };
}

function transformProvider(overrides = {}) {
  return {
    name: 'transform-test',
    model: 'transform-test-model',
    isConfigured: true,
    generate: async () => ({ imageBase64: 'imagem-transformada' }),
    ...overrides,
  };
}

const transformAssetId = '00000000-0000-4000-8000-000000000001';
const transformPayload = {
  operation: 'imageToImage',
  prompt: 'Campanha premium para produto',
  inputAssetIds: [transformAssetId],
  count: 4,
  quality: 'standard',
  aspectRatio: '4:5',
  preservation: { preserveProduct: true, preserveColors: true },
  parameters: { common: { artisticDirection: 'Estúdio Premium' } },
};

function transformAssetStore(overrides = {}) {
  return {
    maxImageBytes: 100,
    saveImage: async () => {},
    readImage: async () => ({
      bytes: Buffer.from('reference-image'),
      mimeType: 'image/png',
      metadata: { id: transformAssetId },
    }),
    ...overrides,
  };
}

test('GET /health informa que o serviço está disponível', async () => {
  const baseUrl = await start();
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('rota desconhecida responde 404', async () => {
  const baseUrl = await start();
  const response = await fetch(`${baseUrl}/desconhecida`);
  assert.equal(response.status, 404);
});

test('geração responde 503 sem chave e não chama o provedor', async () => {
  let called = false;
  const baseUrl = await start({
    imageProvider: provider({ isConfigured: false, generate: async () => { called = true; } }),
  });
  const response = await fetch(`${baseUrl}/v1/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"prompt":"logo azul"}',
  });
  assert.equal(response.status, 503);
  assert.equal(called, false);
});

test('valida Content-Type, JSON e prompt', async () => {
  const baseUrl = await start({ imageProvider: provider() });
  const unsupported = await fetch(`${baseUrl}/v1/images/generate`, { method: 'POST', body: '{}' });
  assert.equal(unsupported.status, 415);
  const invalid = await fetch(`${baseUrl}/v1/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(invalid.status, 400);
  const short = await fetch(`${baseUrl}/v1/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"prompt":"a"}',
  });
  assert.equal(short.status, 400);
});

test('bloqueia origem diferente da configurada', async () => {
  const baseUrl = await start({ imageProvider: provider(), allowedOrigin: 'https://app.example' });
  const response = await fetch(`${baseUrl}/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('preflight da transformação permite POST JSON para a origem configurada', async () => {
  let providerCalled = false;
  const baseUrl = await start({
    allowedOrigin: 'http://localhost:57216',
    imageProvider: provider(),
    imageToImageProvider: transformProvider({
      generate: async () => {
        providerCalled = true;
        return { imageBase64: 'imagem' };
      },
    }),
  });
  const response = await fetch(`${baseUrl}/v1/images/transform`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:57216',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:57216');
  assert.match(response.headers.get('access-control-allow-methods'), /POST/);
  assert.match(response.headers.get('access-control-allow-headers'), /Content-Type/i);
  assert.equal(providerCalled, false);
});

test('POST /v1/assets/images recebe binário e retorna AssetReference', async () => {
  let received;
  const assetStore = {
    maxImageBytes: 100,
    readImage: async () => undefined,
    saveImage: async (input) => {
      received = input;
      return {
        id: '00000000-0000-4000-8000-000000000001',
        mediaType: 'image',
        mimeType: input.mimeType,
        role: 'product',
        width: 1,
        height: 1,
        temporaryUrl: '/v1/assets/images/00000000-0000-4000-8000-000000000001',
        retentionPolicy: 'temporary',
        expiresAt: '2026-08-15T13:00:00.000Z',
      };
    },
  };
  const baseUrl = await start({ imageProvider: provider(), assetStore });
  const response = await fetch(`${baseUrl}/v1/assets/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: Buffer.from([1, 2, 3]),
  });
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(received.bytes, Buffer.from([1, 2, 3]));
  assert.equal(received.mimeType, 'image/png');
  assert.equal(payload.asset.mediaType, 'image');
  assert.equal(Object.hasOwn(payload.asset, 'path'), false);
});

test('POST /v1/images/transform retorna lote completo de quatro imagens', async () => {
  let calls = 0;
  let analyzerCalls = 0;
  const requestEvents = [];
  const baseUrl = await start({
    imageProvider: provider(),
    imageToImageProvider: transformProvider({
      generate: async () => ({ imageBase64: `imagem-${++calls}` }),
    }),
    assetStore: transformAssetStore(),
    productIdentityAnalyzer: {
      analyze: async () => {
        analyzerCalls += 1;
        return { state: 'unknown', items: [], relationships: [] };
      },
    },
    imageToImageTelemetry: {
      recordRequest: (event) => requestEvents.push(event),
      recordError: () => {},
    },
  });
  const response = await fetch(`${baseUrl}/v1/images/transform`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(transformPayload),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.batch.expectedCount, 4);
  assert.equal(payload.batch.status, 'completed');
  assert.equal(payload.batch.imagesBase64.length, 4);
  assert.equal(calls, 4);
  assert.equal(analyzerCalls, 1);
  assert.deepEqual(requestEvents.map((event) => event.phase), [
    'request_started',
    'provider_started',
    'completed',
  ]);
  assert.equal(requestEvents.at(-1).status, 200);
});

test('transform rejeita ID inválido e asset expirado', async () => {
  const invalidBaseUrl = await start({
    imageProvider: provider(),
    imageToImageProvider: transformProvider(),
    assetStore: transformAssetStore(),
  });
  const invalid = await fetch(`${invalidBaseUrl}/v1/images/transform`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...transformPayload, inputAssetIds: ['../../secret'] }),
  });
  assert.equal(invalid.status, 400);

  const expiredBaseUrl = await start({
    imageProvider: provider(),
    imageToImageProvider: transformProvider(),
    assetStore: transformAssetStore({ readImage: async () => undefined }),
  });
  const expired = await fetch(`${expiredBaseUrl}/v1/images/transform`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(transformPayload),
  });
  assert.equal(expired.status, 404);
});

test('transform sanitiza erro e timeout do Cloudflare', async () => {
  const { ImageToImageProviderError } =
    await import('../image-to-image/image-to-image-provider.mjs');
  for (const [code, expectedStatus] of [
    ['upstream_secret_failure', 502],
    ['UPSTREAM_TIMEOUT', 504],
  ]) {
    const baseUrl = await start({
      imageProvider: provider(),
      imageToImageProvider: transformProvider({
        generate: async () => {
          throw new ImageToImageProviderError('secret provider detail', {
            provider: 'cloudflare-flux2-klein',
            status: 401,
            code,
          });
        },
      }),
      assetStore: transformAssetStore(),
    });
    const response = await fetch(`${baseUrl}/v1/images/transform`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transformPayload),
    });
    const payload = await response.json();
    assert.equal(response.status, expectedStatus);
    assert.deepEqual(payload, {
      error: 'O provedor não conseguiu transformar esta imagem.',
    });
    assert.equal(JSON.stringify(payload).includes('secret'), false);
  }
});

test('transform registra telemetria sanitizada por categoria sem alterar resposta HTTP', async () => {
  const { ImageToImageProviderError } =
    await import('../image-to-image/image-to-image-provider.mjs');
  const cases = [
    { code: '3030', providerStatus: 400, responseStatus: 502, category: 'content_moderation' },
    { code: '3036', providerStatus: 429, responseStatus: 429, category: 'rate_limit' },
    { code: 'UPSTREAM_TIMEOUT', providerStatus: 408, responseStatus: 504, category: 'timeout' },
    { code: '3040', providerStatus: 429, responseStatus: 429, category: 'provider_unavailable' },
    { code: '5004', providerStatus: 400, responseStatus: 502, category: 'invalid_input' },
    { code: 'untrusted-secret-detail', providerStatus: 500, responseStatus: 502, category: 'internal_provider_error' },
  ];

  for (const current of cases) {
    const events = [];
    const baseUrl = await start({
      imageProvider: provider(),
      imageToImageProvider: transformProvider({
        generate: async () => {
          throw new ImageToImageProviderError('provider prompt image token account secret', {
            provider: 'cloudflare-flux2-klein',
            status: current.providerStatus,
            code: current.code,
          });
        },
      }),
      imageToImageTelemetry: { recordError: (event) => events.push(event) },
      assetStore: transformAssetStore(),
    });
    const response = await fetch(`${baseUrl}/v1/images/transform`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transformPayload),
    });
    const payload = await response.json();

    assert.equal(response.status, current.responseStatus);
    assert.deepEqual(payload, { error: 'O provedor não conseguiu transformar esta imagem.' });
    assert.equal(events.length, 1);
    assert.equal(events[0].category, current.category);
    assert.equal(events[0].code,
      current.code === 'untrusted-secret-detail' ? 'UNKNOWN_PROVIDER_ERROR' : current.code);
    assert.match(events[0].requestId, /^[0-9a-f-]{36}$/);
    assert.equal(events[0].provider, 'transform-test');
    assert.equal(events[0].model, 'transform-test-model');
    assert.equal(JSON.stringify(events[0]).includes(transformPayload.prompt), false);
    assert.equal(JSON.stringify(events[0]).includes('provider prompt image token account secret'), false);
  }
});

test('transform registra entrada inválida sem incluir payload', async () => {
  const events = [];
  const baseUrl = await start({
    imageProvider: provider(),
    imageToImageProvider: transformProvider(),
    imageToImageTelemetry: { recordError: (event) => events.push(event) },
    assetStore: transformAssetStore(),
  });
  const response = await fetch(`${baseUrl}/v1/images/transform`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...transformPayload, prompt: 'sensitive prompt', count: 3 }),
  });

  assert.equal(response.status, 400);
  assert.equal(events.length, 1);
  assert.equal(events[0].category, 'invalid_input');
  assert.equal(events[0].code, 'INVALID_COUNT');
  assert.equal(JSON.stringify(events[0]).includes('sensitive prompt'), false);
});

test('count padrão gera uma imagem e preserva imageBase64', async () => {
  let receivedPrompt;
  const baseUrl = await start({
    allowedOrigin: 'https://app.example',
    imageProvider: provider({ generate: async (prompt) => {
      receivedPrompt = prompt;
      return 'imagem-base64';
    } }),
  });
  const response = await fetch(`${baseUrl}/v1/images/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://app.example' },
    body: JSON.stringify({ prompt: '  símbolo azul minimalista  ' }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example');
  assert.deepEqual(await response.json(), {
    imageBase64: 'imagem-base64',
    imagesBase64: ['imagem-base64'],
  });
  assert.equal(receivedPrompt, 'símbolo azul minimalista');
});

test('count=4 gera quatro variações com concorrência máxima de duas', async () => {
  let active = 0;
  let maxActive = 0;
  const prompts = [];
  const baseUrl = await start({
    imageProvider: provider({
      generate: async (prompt) => {
        prompts.push(prompt);
        const imageNumber = prompts.length;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return `imagem-${imageNumber}`;
      },
    }),
  });
  const response = await fetch(`${baseUrl}/v1/images/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'marca moderna', count: 4 }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.imageBase64, payload.imagesBase64[0]);
  assert.equal(payload.imagesBase64.length, 4);
  assert.equal(new Set(payload.imagesBase64).size, 4);
  assert.equal(new Set(prompts).size, 4);
  assert.equal(maxActive, 2);
  assert.ok(prompts.every((prompt) => !/Variation [1-4]/i.test(prompt)));
});

test('rejeita count fora do intervalo suportado', async () => {
  const baseUrl = await start({ imageProvider: provider() });
  for (const count of [0, 5, 1.5, '4']) {
    const response = await fetch(`${baseUrl}/v1/images/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'logo válido', count }),
    });
    assert.equal(response.status, 400);
  }
});

test('não repassa detalhes de erro do provedor ao cliente', async () => {
  const baseUrl = await start({
    imageProvider: provider({ generate: async () => {
      const { ImageProviderError } = await import('../providers/provider-error.mjs');
      throw new ImageProviderError('secret detail', {
        provider: 'test', status: 401, code: 'invalid_api_key',
      });
    } }),
  });
  const response = await fetch(`${baseUrl}/v1/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"prompt":"logo seguro"}',
  });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'O provedor não conseguiu gerar esta imagem.' });
});
