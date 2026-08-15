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
