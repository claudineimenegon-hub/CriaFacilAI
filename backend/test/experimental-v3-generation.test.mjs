import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeterministicCreativeDirectorV3Model } from '../benchmark/creative-director-v3.mjs';
import {
  buildCreativeDirectorV3Input,
  createExperimentalV3GenerationService,
  experimentalOutputDimensions,
  validateExperimentalV3Request,
} from '../experimental-v3/experimental-v3-generation-service.mjs';

const assetId = '00000000-0000-4000-8000-000000000001';
const sourceBytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const analysis = {
  state: 'known',
  items: [
    {
      id: 'product-pair', functionalType: { state: 'known', value: 'wearable product' },
      quantity: { state: 'known', value: 2 }, observationCompleteness: 'partial',
      observedFeatures: [{ name: 'color', value: 'source-observed blue' }],
      ambiguousFeatures: [{ name: 'hidden-back', visibility: 'hidden', observedConstraint: null, plausibleHypotheses: [] }],
    },
  ],
  relationships: [{ type: 'pair', memberIds: ['product-pair'], state: 'known' }],
};

function request(overrides = {}) {
  return {
    inputAssetId: assetId, category: 'general', objective: 'Campanha premium',
    description: 'Apresentação sofisticada', aspectRatio: '1:1', ...overrides,
  };
}

function service({ failRole } = {}) {
  let directorCalls = 0;
  const visualCalls = [];
  const deterministic = createDeterministicCreativeDirectorV3Model();
  const instance = createExperimentalV3GenerationService({
    assetStore: { readImage: async () => ({ bytes: sourceBytes, mimeType: 'image/jpeg', metadata: { hash: 'safe-hash' } }) },
    productIdentityAnalyzer: { analyze: async () => analysis },
    creativeDirectorAdapterFactory: () => ({
      name: 'mock-director',
      async generate(input) { directorCalls += 1; return deterministic.generate(input); },
    }),
    imageProvider: {
      async generate(input) {
        visualCalls.push(input);
        const role = /Campaign role: ([a-z_]+)/.exec(input.prompt)?.[1];
        if (role === failRole) throw Object.assign(new Error('private'), { code: 'UPSTREAM_TIMEOUT' });
        return { imageBase64: Buffer.from(role).toString('base64') };
      },
    },
  });
  return { instance, visualCalls, directorCalls: () => directorCalls };
}

test('request usa medium por padrão e rejeita valores técnicos inválidos', () => {
  assert.equal(validateExperimentalV3Request(request()).quality, 'medium');
  assert.throws(() => validateExperimentalV3Request(request({ quality: 'ultra' })), /Qualidade/);
  assert.throws(() => validateExperimentalV3Request(request({ inputAssetId: 'fixture' })), /referência/);
});

test('ponte constrói Product Identity V3 real sem fixture e preserva pair e evidência', () => {
  const normalized = validateExperimentalV3Request(request());
  const input = buildCreativeDirectorV3Input({ analysis, request: normalized });
  assert.deepEqual(input.productIdentity.items, [{ id: 'product-pair', functionalType: 'wearable product', quantity: 2 }]);
  assert.deepEqual(input.productIdentity.relationships, [{ type: 'pair', itemIds: ['product-pair'] }]);
  assert.match(input.productIdentity.observedFeatures[0], /source-observed blue/);
  assert.equal(JSON.stringify(input).includes('fixture'), false);
});

test('uma direção lógica produz quatro briefs, quatro prompts e quatro chamadas visuais', async () => {
  const current = service();
  const batch = await current.instance.generate(request({ quality: 'high' }));
  assert.equal(current.directorCalls(), 1);
  assert.equal(current.visualCalls.length, 4);
  assert.equal(new Set(current.visualCalls.map(({ prompt }) => prompt)).size, 4);
  assert.equal(current.visualCalls.every(({ parameters }) => parameters.provider.quality === 'high'), true);
  assert.equal(batch.status, 'completed');
  assert.equal(batch.results.length, 4);
  assert.equal(batch.results.every(({ status }) => status === 'completed'), true);
  assert.equal(JSON.stringify(batch).includes('Authorization'), false);
});

test('erro individual preserva três sucessos e não repete chamada visual', async () => {
  const current = service({ failRole: 'editorial_craft_detail' });
  const batch = await current.instance.generate(request());
  assert.equal(current.directorCalls(), 1);
  assert.equal(current.visualCalls.length, 4);
  assert.equal(batch.status, 'partial');
  assert.equal(batch.results.filter(({ status }) => status === 'completed').length, 3);
  assert.deepEqual(batch.results.find(({ status }) => status === 'error'), {
    campaignRole: 'editorial_craft_detail', status: 'error', errorCode: 'UPSTREAM_TIMEOUT',
  });
});

test('mapeia proporções para os três tamanhos oficiais do GPT Image', () => {
  assert.deepEqual(experimentalOutputDimensions('1:1'), { width: 1024, height: 1024 });
  assert.deepEqual(experimentalOutputDimensions('4:5'), { width: 1024, height: 1536 });
  assert.deepEqual(experimentalOutputDimensions('9:16'), { width: 1024, height: 1536 });
  assert.deepEqual(experimentalOutputDimensions('16:9'), { width: 1536, height: 1024 });
});

test('identidade ausente falha antes de Creative Director ou imagem', async () => {
  const instance = createExperimentalV3GenerationService({
    assetStore: { readImage: async () => ({ bytes: sourceBytes, mimeType: 'image/jpeg', metadata: {} }) },
    productIdentityAnalyzer: { analyze: async () => ({ state: 'unknown', items: [], relationships: [] }) },
    creativeDirectorAdapterFactory: () => { throw new Error('must not run'); },
    imageProvider: { generate: async () => { throw new Error('must not run'); } },
  });
  await assert.rejects(() => instance.generate(request()), { code: 'PRODUCT_ANALYSIS_REQUIRED', status: 503 });
});
