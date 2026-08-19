import assert from 'node:assert/strict';
import test from 'node:test';
import {
  categorizeFalUpstreamError,
  createFalFlux2ProImageToImageProvider as createFalProviderImplementation,
  FAL_FLUX2_PRO_EDIT_MODEL,
} from '../image-to-image/fal-flux2-pro-provider.mjs';
import { createImageToImageProvider } from '../image-to-image/index.mjs';
import { generateProductPhotoBatch } from '../image-to-image/image-transform-service.mjs';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const imageDataUri = `data:image/png;base64,${png.toString('base64')}`;

function request(overrides = {}) {
  return {
    prompt: 'Create a premium product advertisement',
    inputs: [{ bytes: Buffer.from([0xff, 0xd8, 0xff]), mimeType: 'image/jpeg' }],
    parameters: { provider: { seed: 123 } },
    preservation: { preserveProduct: true },
    output: { width: 1024, height: 1280, count: 4 },
    ...overrides,
  };
}

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const testPrepareInputs = async (inputs) => inputs.map((input) => ({
  ...input,
  width: 640,
  height: 480,
  originalWidth: 640,
  originalHeight: 480,
  resized: false,
}));

function createFalFlux2ProImageToImageProvider(options = {}) {
  return createFalProviderImplementation({ prepareInputs: testPrepareInputs, ...options });
}

test('provider fal.ai expõe modelo e configuração sem chave', async () => {
  const provider = createFalFlux2ProImageToImageProvider({ apiKey: '' });
  assert.equal(provider.model, FAL_FLUX2_PRO_EDIT_MODEL);
  assert.equal(provider.isConfigured, false);
  await assert.rejects(provider.generate(request()), { code: 'PROVIDER_NOT_CONFIGURED' });
});

test('envia autenticação e contrato oficial sem expor chave no resultado', async () => {
  const secret = 'test-secret-not-real';
  let captured;
  const provider = createFalFlux2ProImageToImageProvider({
    apiKey: secret,
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return jsonResponse({ images: [{ url: imageDataUri, width: 1024, height: 1280 }], seed: 123 });
    },
  });
  const result = await provider.generate(request());
  const body = JSON.parse(captured.options.body);

  assert.equal(captured.url, 'https://fal.run/fal-ai/flux-2-pro/edit');
  assert.equal(captured.options.headers.Authorization, `Key ${secret}`);
  assert.equal(body.prompt, request().prompt);
  assert.deepEqual(body.image_size, { width: 1024, height: 1280 });
  assert.equal(body.output_format, 'png');
  assert.equal(body.sync_mode, true);
  assert.equal(body.enable_safety_checker, true);
  assert.equal(body.seed, 123);
  assert.equal(body.image_urls.length, 1);
  assert.match(body.image_urls[0], /^data:image\/jpeg;base64,/);
  assert.equal(result.imageBase64, png.toString('base64'));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test('envia até quatro referências como image_urls', async () => {
  let body;
  const provider = createFalFlux2ProImageToImageProvider({
    apiKey: 'test',
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return jsonResponse({ images: [{ url: imageDataUri }] });
    },
  });
  const inputs = Array.from({ length: 4 }, () => ({
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    mimeType: 'image/png',
  }));
  await provider.generate(request({ inputs }));
  assert.equal(body.image_urls.length, 4);
  assert.ok(body.image_urls.every((url) => url.startsWith('data:image/png;base64,')));
});

test('baixa URL HTTPS, valida imagem e converte para base64', async () => {
  const calls = [];
  const provider = createFalFlux2ProImageToImageProvider({
    apiKey: 'test',
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return jsonResponse({ images: [{ url: 'https://cdn.example.test/result.png' }] });
      }
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    },
  });
  const result = await provider.generate(request());
  assert.equal(calls.length, 2);
  assert.equal(result.imageBase64, png.toString('base64'));
  assert.equal(result.mimeType, 'image/png');
});

test('converte timeout e erro de rede em erros controlados', async () => {
  const timeout = new Error('secret transport detail');
  timeout.name = 'TimeoutError';
  await assert.rejects(
    createFalFlux2ProImageToImageProvider({ apiKey: 'test', fetchImpl: async () => { throw timeout; } })
      .generate(request()),
    { code: 'UPSTREAM_TIMEOUT' },
  );
  await assert.rejects(
    createFalFlux2ProImageToImageProvider({ apiKey: 'test', fetchImpl: async () => { throw new Error('dns'); } })
      .generate(request()),
    { code: 'PROVIDER_UNAVAILABLE' },
  );
});

test('sanitiza erro HTTP do upstream', async () => {
  const logs = [];
  const sensitivePrompt = 'private product prompt';
  const provider = createFalFlux2ProImageToImageProvider({
    apiKey: 'test',
    logger: { warn: (event) => logs.push(event) },
    fetchImpl: async () => jsonResponse({
      detail: [{
        loc: ['body', 'image_urls', 0],
        type: 'value_error.image_too_large',
        msg: `${sensitivePrompt} data:image/jpeg;base64,SECRET`,
      }],
    }, { status: 400 }),
  });
  await assert.rejects(provider.generate(request({ prompt: sensitivePrompt })), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.code, 'INVALID_UPSTREAM_INPUT');
    return true;
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].providerErrorCode, 'INVALID_UPSTREAM_INPUT');
  assert.equal(logs[0].category, 'dimension_or_size');
  assert.equal(logs[0].statusHttp, 400);
  assert.ok(Number.isInteger(logs[0].latencyMs));
  assert.equal(logs[0].providerErrorType, 'value_error.image_too_large');
  assert.deepEqual(logs[0].invalidFields, ['body.image_urls.0']);
  assert.equal(logs[0].promptLength, sensitivePrompt.length);
  assert.equal(logs[0].totalInputMegapixels, 0.307);
  assert.deepEqual(logs[0].inputMetadata[0], {
    mimeType: 'image/jpeg',
    originalWidth: 640,
    originalHeight: 480,
    preparedWidth: 640,
    preparedHeight: 480,
    byteLength: 3,
    resized: false,
  });
  const serialized = JSON.stringify(logs);
  assert.doesNotMatch(serialized, /private product prompt|base64|SECRET|Authorization|FAL_KEY/);
});

test('preserva diagnóstico sanitizado de content policy no erro lançado', async () => {
  const logs = [];
  const provider = createFalFlux2ProImageToImageProvider({
    apiKey: 'test',
    logger: { warn: (event) => logs.push(event) },
    fetchImpl: async () => jsonResponse({
      detail: [{
        loc: ['body', 'prompt'], type: 'content_policy_violation',
        msg: 'The content was flagged by a content checker.',
      }],
    }, { status: 422, headers: { 'x-fal-request-id': 'fal-safe-id-1' } }),
  });
  await assert.rejects(provider.generate(request({
    prompt: 'private prompt', proposalIndex: 2, retryAttempt: 1,
  })), (error) => {
    assert.equal(error.status, 422);
    assert.equal(error.category, 'content_policy');
    assert.equal(error.providerErrorType, 'content_policy_violation');
    assert.deepEqual(error.invalidFields, ['body.prompt']);
    assert.equal(error.upstreamRequestId, 'fal-safe-id-1');
    assert.equal(error.proposalIndex, 2);
    assert.equal(error.retryAttempt, 1);
    return true;
  });
  assert.equal(logs[0].upstreamRequestId, 'fal-safe-id-1');
  assert.doesNotMatch(JSON.stringify(logs), /private prompt|Authorization|base64/i);
});

test('categoriza erros HTTP fal.ai sem depender de payload bruto', () => {
  assert.equal(categorizeFalUpstreamError({
    status: 422, sanitized: { providerErrorType: 'content_policy_violation' },
  }), 'content_policy');
  assert.equal(categorizeFalUpstreamError({ status: 401, sanitized: {} }), 'authentication');
  assert.equal(categorizeFalUpstreamError({ status: 429, sanitized: {} }), 'quota');
  assert.equal(categorizeFalUpstreamError({ status: 413, sanitized: {} }), 'dimension_or_size');
  assert.equal(categorizeFalUpstreamError({ status: 503, sanitized: {} }), 'upstream_unavailable');
  assert.equal(categorizeFalUpstreamError({
    status: 422, sanitized: { providerErrorType: 'schema_validation_error', invalidFields: [] },
  }), 'schema_or_payload');
  assert.equal(categorizeFalUpstreamError({ status: 400, sanitized: {} }), 'invalid_input');
});

test('preserva mensagem curta segura da fal.ai e rejeita conteúdo sensível', async (t) => {
  await t.test('mensagem segura', async () => {
    const logs = [];
    const provider = createFalFlux2ProImageToImageProvider({
      apiKey: 'test-secret',
      logger: { warn: (event) => logs.push(event) },
      fetchImpl: async () => jsonResponse({
        code: 'capacity_error', message: 'Model capacity temporarily unavailable.',
      }, { status: 503 }),
    });
    await assert.rejects(provider.generate(request()), { code: 'UPSTREAM_ERROR' });
    assert.equal(logs[0].category, 'upstream_unavailable');
    assert.equal(logs[0].providerErrorCode, 'UPSTREAM_ERROR');
    assert.equal(logs[0].upstreamMessage, 'Model capacity temporarily unavailable.');
  });

  await t.test('mensagem sensível', async () => {
    const logs = [];
    const provider = createFalFlux2ProImageToImageProvider({
      apiKey: 'test-secret',
      logger: { warn: (event) => logs.push(event) },
      fetchImpl: async () => jsonResponse({
        message: 'data:image/jpeg;base64,VERY_SECRET_IMAGE_PAYLOAD',
      }, { status: 500 }),
    });
    await assert.rejects(provider.generate(request()), { code: 'UPSTREAM_ERROR' });
    assert.equal(logs[0].upstreamMessage, undefined);
    const serialized = JSON.stringify(logs);
    assert.doesNotMatch(serialized, /test-secret|data:image|base64|VERY_SECRET|Authorization/i);
  });
});

test('envia dimensões corretas para todos os aspect ratios suportados', async () => {
  const dimensions = [
    [1024, 1024], [1024, 1280], [1024, 1820], [1820, 1024],
  ];
  for (const [width, height] of dimensions) {
    let body;
    const provider = createFalFlux2ProImageToImageProvider({
      apiKey: 'test',
      fetchImpl: async (_url, options) => {
        body = JSON.parse(options.body);
        return jsonResponse({ images: [{ url: imageDataUri }] });
      },
    });
    await provider.generate(request({ output: { width, height, count: 4 } }));
    assert.deepEqual(body.image_size, { width, height });
  }
});

test('rejeita resposta sem imagem, URL insegura e conteúdo não imagem', async (t) => {
  await t.test('sem imagem', async () => {
    const provider = createFalFlux2ProImageToImageProvider({
      apiKey: 'test', fetchImpl: async () => jsonResponse({ images: [] }),
    });
    await assert.rejects(provider.generate(request()), { code: 'MISSING_IMAGE' });
  });
  await t.test('URL insegura', async () => {
    const provider = createFalFlux2ProImageToImageProvider({
      apiKey: 'test', fetchImpl: async () => jsonResponse({ images: [{ url: 'http://example.test/x.png' }] }),
    });
    await assert.rejects(provider.generate(request()), { code: 'INVALID_IMAGE_URL' });
  });
  await t.test('conteúdo não imagem', async () => {
    let count = 0;
    const provider = createFalFlux2ProImageToImageProvider({
      apiKey: 'test',
      fetchImpl: async () => ++count === 1
        ? jsonResponse({ images: [{ url: 'https://example.test/x.png' }] })
        : new Response('html', { headers: { 'content-type': 'text/html' } }),
    });
    await assert.rejects(provider.generate(request()), { code: 'INVALID_IMAGE_CONTENT_TYPE' });
  });
});

test('rejeita imagem excessivamente grande antes do download', async () => {
  let count = 0;
  const provider = createFalFlux2ProImageToImageProvider({
    apiKey: 'test',
    fetchImpl: async () => ++count === 1
      ? jsonResponse({ images: [{ url: 'https://example.test/huge.png' }] })
      : new Response(png, {
        headers: { 'content-type': 'image/png', 'content-length': String(21 * 1024 * 1024) },
      }),
  });
  await assert.rejects(provider.generate(request()), { code: 'RESULT_TOO_LARGE' });
});

test('seleção aceita fal e preserva Cloudflare como padrão', () => {
  assert.equal(createImageToImageProvider({ providerName: 'fal' }).name, 'fal-flux2-pro');
  assert.equal(createImageToImageProvider({ providerName: 'fal-flux2-pro' }).name, 'fal-flux2-pro');
  assert.equal(createImageToImageProvider({ providerName: 'cloudflare-flux2-klein' }).name, 'cloudflare-flux2-klein');
  assert.equal(createImageToImageProvider().name, 'cloudflare-flux2-klein');
});

test('fal.ai permanece compatível com quatro prompts do Creative Director', async () => {
  const prompts = [];
  const provider = createFalFlux2ProImageToImageProvider({
    apiKey: 'test',
    fetchImpl: async (_url, options) => {
      prompts.push(JSON.parse(options.body).prompt);
      return jsonResponse({ images: [{ url: imageDataUri }] });
    },
  });
  const batch = await generateProductPhotoBatch({
    provider,
    assetStore: {
      readImage: async () => ({
        bytes: Buffer.from([0xff, 0xd8, 0xff]),
        mimeType: 'image/jpeg',
        metadata: {},
      }),
    },
    request: {
      prompt: 'Premium jewelry campaign',
      inputAssetIds: ['00000000-0000-4000-8000-000000000001'],
      count: 4,
      quality: 'standard',
      aspectRatio: '4:5',
      preservation: { preserveProduct: true, preserveColors: true },
      parameters: { common: { productCategory: 'jewelry', artisticDirection: 'Luxo' } },
    },
    creativeDirectorLogger: undefined,
  });
  assert.equal(batch.imagesBase64.length, 4);
  assert.equal(prompts.length, 4);
  assert.equal(new Set(prompts).size, 4);
});
