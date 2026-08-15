import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createCloudflareImageProvider,
  createImageProvider,
  createOpenAIImageProvider,
} from '../providers/index.mjs';

test('Cloudflare é o provedor padrão', () => {
  const provider = createImageProvider({ fetchImpl: async () => {} });
  assert.equal(provider.name, 'cloudflare');
});

test('adaptador Cloudflare envia credenciais e interpreta imagem base64', async () => {
  let request;
  const provider = createCloudflareImageProvider({
    apiToken: 'cf-test-token',
    accountId: 'cf-test-account',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return Response.json({ success: true, result: { image: 'cloudflare-base64' } });
    },
  });
  assert.equal(await provider.generate('logo azul'), 'cloudflare-base64');
  assert.match(request.url, /accounts\/cf-test-account\/ai\/run\/@cf\/black-forest-labs\/flux-1-schnell$/);
  assert.equal(request.options.headers.Authorization, 'Bearer cf-test-token');
  assert.deepEqual(JSON.parse(request.options.body), { prompt: 'logo azul', steps: 4 });
});

test('adaptador OpenAI permanece disponível como alternativa', async () => {
  let request;
  const provider = createOpenAIImageProvider({
    apiKey: 'openai-test-key',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return Response.json({ data: [{ b64_json: 'openai-base64' }] });
    },
  });
  assert.equal(await provider.generate('logo premium'), 'openai-base64');
  assert.equal(request.url, 'https://api.openai.com/v1/images/generations');
  assert.equal(request.options.headers.Authorization, 'Bearer openai-test-key');
  assert.equal(JSON.parse(request.options.body).model, 'gpt-image-2');
});

test('credenciais ausentes não são enviadas à rede', async () => {
  let called = false;
  const provider = createCloudflareImageProvider({
    apiToken: '',
    accountId: '',
    fetchImpl: async () => { called = true; },
  });
  await assert.rejects(provider.generate('logo'), { code: 'PROVIDER_NOT_CONFIGURED' });
  assert.equal(called, false);
});
