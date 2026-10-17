import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  AdCopyValidationError,
  buildAdCopyInstruction,
  createAdCopyService,
  normalizeAdCopy,
  validateAdCopyRequest,
} from '../ads/ad-copy-service.mjs';
import { createServer } from '../server.mjs';

const assetId = '00000000-0000-4000-8000-000000000001';

const basePayload = {
  product: { name: 'Brinco Gota Cristal', details: 'Banhado a ouro 18k, zircônia', price: 'R$ 89,90' },
  objective: 'venda',
  tone: 'luxo',
  platforms: ['instagram', 'whatsapp'],
  variants: 2,
  inputAssetIds: [assetId],
};

function geminiCopy(overrides = {}) {
  const variant = (angle) => ({
    angle,
    headline: 'Brilho que acompanha você',
    caption: 'Brinco gota banhado a ouro 18k com zircônia. Por R$ 89,90.',
    cta: 'Chame no WhatsApp',
    hashtags: ['#semijoias', 'brincos', '#Semijoias', 'ouro 18k'],
  });
  return {
    productReading: {
      whatItIs: 'Brinco em formato de gota',
      visibleHighlights: ['pedra central', 'acabamento dourado'],
      emotions: ['elegância'],
      idealCustomer: 'Mulheres que gostam de peças delicadas',
    },
    angles: ['presente', 'autoestima'],
    platforms: [
      { platform: 'instagram', variants: [variant('presente'), variant('autoestima')] },
      { platform: 'whatsapp', variants: [variant('presente'), variant('autoestima'), variant('extra')] },
    ],
    productDescription: {
      title: 'Brinco Gota Cristal Banhado a Ouro 18k',
      short: 'Delicado e sofisticado.',
      long: 'Descrição longa.',
      bullets: ['Banho de ouro 18k', 'Zircônia'],
    },
    imageTextIdeas: ['Brilho em cada detalhe'],
    ...overrides,
  };
}

function fakeFetch(payload, { status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const envelope = { candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] };
    return new Response(JSON.stringify(envelope), { status });
  };
  return { impl, calls };
}

const assetStore = {
  readImage: async (id) => (id === assetId
    ? { bytes: Buffer.from('img'), mimeType: 'image/png' }
    : null),
};

test('valida campos obrigatórios e limites', () => {
  assert.throws(() => validateAdCopyRequest({ ...basePayload, product: {} }), AdCopyValidationError);
  assert.throws(() => validateAdCopyRequest({ ...basePayload, tone: 'raivoso' }), /Tom/);
  assert.throws(() => validateAdCopyRequest({ ...basePayload, platforms: ['orkut'] }), /plataforma/);
  assert.throws(() => validateAdCopyRequest({ ...basePayload, variants: 9 }), /variações/);
  assert.throws(
    () => validateAdCopyRequest({ product: { name: 'Anel' }, inputAssetIds: [] }),
    /foto do produto/,
  );
  const ok = validateAdCopyRequest({ product: { name: 'Anel', details: 'dourado' } });
  assert.deepEqual(ok.platforms, ['instagram']);
  assert.equal(ok.variants, 2);
});

test('instrução proíbe inventar preço e material', () => {
  const request = validateAdCopyRequest({ product: { name: 'Anel', details: 'dourado' } });
  const instruction = buildAdCopyInstruction(request);
  assert.match(instruction, /não mencione valores/);
  assert.match(instruction, /ouro maciço/);
  assert.match(instruction, /nenhuma — não invente promoções/);
});

test('gera textos com foto, respeitando plataformas e limites', async () => {
  const { impl, calls } = fakeFetch(geminiCopy());
  const service = createAdCopyService({ apiKey: 'k', model: 'gemini-test', fetchImpl: impl, assetStore });
  const copy = await service.generate(basePayload);

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /gemini-test:generateContent$/);
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'k');
  assert.equal(calls[0].body.contents[0].parts[1].inlineData.mimeType, 'image/png');

  assert.deepEqual(copy.platforms.map((p) => p.platform), ['instagram', 'whatsapp']);
  assert.equal(copy.platforms[1].variants.length, 2, 'corta variações extras');
  assert.deepEqual(copy.platforms[0].variants[0].hashtags, ['#semijoias', '#brincos', '#ouro18k']);
  assert.deepEqual(copy.platforms[1].variants[0].hashtags, [], 'WhatsApp sem hashtags');
  assert.deepEqual(copy.review.warnings, []);
});

test('checagem aponta promessas arriscadas e preço não informado', () => {
  const request = validateAdCopyRequest({
    product: { name: 'Colar', details: 'dourado' },
    platforms: ['instagram'],
    variants: 1,
  });
  const raw = geminiCopy({
    platforms: [{
      platform: 'instagram',
      variants: [{
        angle: 'oferta',
        headline: 'Ouro maciço, a melhor do Brasil',
        caption: 'Hipoalergênica, frete grátis e últimas unidades por R$ 50',
        cta: 'Compre',
        hashtags: [],
      }],
    }],
  });
  const messages = normalizeAdCopy(raw, request).review.warnings.map((w) => w.message).join('\n');
  assert.match(messages, /ouro maciço/);
  assert.match(messages, /antialérgica/);
  assert.match(messages, /melhor do Brasil/);
  assert.match(messages, /frete grátis/);
  assert.match(messages, /últimas unidades/);
  assert.match(messages, /preço que você não informou/);
});

test('falha quando faltam textos de uma plataforma', async () => {
  const { impl } = fakeFetch(geminiCopy({ platforms: [] }));
  const service = createAdCopyService({ apiKey: 'k', fetchImpl: impl, assetStore });
  await assert.rejects(service.generate(basePayload), /todas as plataformas/);
});

test('foto expirada vira 404 amigável', async () => {
  const { impl } = fakeFetch(geminiCopy());
  const service = createAdCopyService({ apiKey: 'k', fetchImpl: impl, assetStore: { readImage: async () => null } });
  await assert.rejects(service.generate(basePayload), (error) => error.status === 404);
});

// ---------- rota HTTP ----------
const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function start(options) {
  const server = createServer({
    imageProvider: { name: 't', model: 't', isConfigured: false },
    imageToImageProvider: { name: 't', model: 't', isConfigured: false },
    ...options,
  });
  servers.push(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${server.address().port}`;
}

test('POST /v1/ads/copy devolve textos', async () => {
  const { impl } = fakeFetch(geminiCopy());
  const url = await start({
    assetStore,
    adCopyService: createAdCopyService({ apiKey: 'k', fetchImpl: impl, assetStore }),
  });
  const res = await fetch(`${url}/v1/ads/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(basePayload),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.copy.platforms.length, 2);
});

test('POST /v1/ads/copy sem chave responde 503 e entrada ruim 400', async () => {
  const url = await start({ assetStore, adCopyService: createAdCopyService({ apiKey: '', assetStore }) });
  const post = (payload) => fetch(`${url}/v1/ads/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal((await post(basePayload)).status, 503);
  assert.equal((await post({ product: {} })).status, 400);
});
