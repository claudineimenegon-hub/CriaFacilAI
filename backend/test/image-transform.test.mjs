import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generateProductPhotoBatch,
  ImageTransformBatchError,
  ImageTransformValidationError,
  outputDimensions,
  PRODUCT_PHOTO_GUIDANCE,
  PRODUCT_PHOTO_SEEDS,
} from '../image-to-image/image-transform-service.mjs';
import { ImageToImageProviderError } from '../image-to-image/image-to-image-provider.mjs';
import { ProductPhotoPromptBuilder } from '../image-to-image/product-photo-prompt-builder.mjs';
import { ProductPhotoConceptPlanner } from '../image-to-image/product-photo-concept-planner.mjs';

const assetId = '00000000-0000-4000-8000-000000000001';
const imageBase64 = Buffer.from('image').toString('base64');

function request(overrides = {}) {
  return {
    operation: 'imageToImage',
    prompt: 'Create a premium beverage campaign.',
    inputAssetIds: [assetId],
    count: 4,
    quality: 'standard',
    aspectRatio: '4:5',
    preservation: {
      preserveProduct: true,
      preservePackaging: true,
      preserveLabel: true,
      preservePrintedText: true,
      preserveLogo: true,
      preserveColors: true,
      preserveProportions: true,
    },
    parameters: {
      common: {
        artisticDirection: 'Estúdio Premium',
        productCategory: 'beverages',
      },
    },
    ...overrides,
  };
}

function assetStore(overrides = {}) {
  return {
    readImage: async () => ({
      bytes: Buffer.from('input-image'),
      mimeType: 'image/png',
      metadata: { id: assetId },
    }),
    ...overrides,
  };
}

test('planejamento de bebidas produz quatro prompts independentes e hierárquicos', () => {
  const builder = new ProductPhotoPromptBuilder();
  const plan = new ProductPhotoConceptPlanner().plan({
    prompt: 'Premium bottle campaign',
    productCategory: 'beverages',
  });
  const prompts = plan.concepts.map((concept) => builder.build({
    prompt: 'Premium bottle campaign',
    artisticDirection: 'Luxo',
    preservation: request().preservation,
    plan,
    concept,
  }));

  assert.equal(new Set(prompts).size, 4);
  assert.deepEqual(plan.concepts.map(({ name }) => name), [
    'PRODUCT HERO', 'EXTREME MACRO', 'SERVING / CONSUMPTION CONTEXT',
    'LIFESTYLE / HELD OR APPLIED',
  ]);
  for (const prompt of prompts) {
    assert.ok(prompt.indexOf('REFERENCE:') < prompt.indexOf('CONCEPT:'));
    assert.match(prompt, /printed text/);
    assert.match(prompt, /no redesign/i);
    assert.match(prompt, /no washed-out/);
    assert.match(prompt, /One ad photo/);
    assert.match(prompt, /No typography/);
    assert.doesNotMatch(prompt, /variation\s*[1-4]/i);
  }
});

test('regras de joias são especializadas e não vazam para outras categorias', () => {
  const builder = new ProductPhotoPromptBuilder();
  const jewelryPlan = new ProductPhotoConceptPlanner().plan({
    productCategory: 'jewelry',
    prompt: 'Jewelry campaign',
  });
  const electronicsPlan = new ProductPhotoConceptPlanner().plan({
    productCategory: 'electronics',
    prompt: 'Electronics campaign',
  });
  const jewelryLifestyle = builder.build({
    prompt: 'Jewelry campaign', plan: jewelryPlan,
    concept: jewelryPlan.concepts[0],
    preservation: { preserveProduct: true },
  });
  const jewelryMacro = builder.build({
    prompt: 'Jewelry campaign', plan: jewelryPlan,
    concept: jewelryPlan.concepts[2],
    preservation: { preserveProduct: true },
  });
  const electronicsMacro = builder.build({
    prompt: 'Electronics campaign', plan: electronicsPlan,
    concept: electronicsPlan.concepts[1],
    preservation: { preserveProduct: true },
  });

  assert.match(jewelryLifestyle, /wear at correct anatomy/);
  assert.match(jewelryLifestyle, /gem color\/position/);
  assert.match(jewelryMacro, /gem color\/position/);
  assert.match(jewelryMacro, /symmetry\/facets/);
  assert.doesNotMatch(electronicsMacro, /gemstone|visible stone|jewelry/);
  assert.match(electronicsMacro, /controls, ports/);
});

test('Luxury Display usa linguagem comercial positiva e prompt compacto sem truncamento artificial', () => {
  const builder = new ProductPhotoPromptBuilder();
  const plan = new ProductPhotoConceptPlanner().plan({
    productCategory: 'jewelry',
    prompt: 'A'.repeat(220),
  });
  const prompt = builder.build({
    prompt: 'A'.repeat(220),
    plan,
    concept: plan.concepts[1],
    preservation: request().preservation,
  });

  assert.match(prompt, /premium commercial still life with refined studio staging/i);
  assert.doesNotMatch(prompt, /without a model|product alone|No human interaction|negative fill/i);
  assert.doesNotMatch(prompt, /…/);
});

test('count=4 usa concorrência máxima de duas e quatro prompts distintos', async () => {
  let active = 0;
  let maxActive = 0;
  const prompts = [];
  const providerParameters = [];
  const diagnosticLogs = [];
  const provider = {
    generate: async ({ prompt, parameters }) => {
      prompts.push(prompt);
      providerParameters.push(parameters.provider);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { imageBase64: `${imageBase64}${prompts.length}` };
    },
  };
  const batch = await generateProductPhotoBatch({
    provider,
    assetStore: assetStore(),
    request: request(),
    creativeDirectorLogger: { info: (entry) => diagnosticLogs.push(entry) },
  });

  assert.equal(batch.expectedCount, 4);
  assert.equal(batch.status, 'completed');
  assert.equal(batch.imagesBase64.length, 4);
  assert.equal(maxActive, 2);
  assert.equal(new Set(prompts).size, 4);
  assert.deepEqual(providerParameters.map(({ guidance }) => guidance), [
    PRODUCT_PHOTO_GUIDANCE,
    PRODUCT_PHOTO_GUIDANCE,
    PRODUCT_PHOTO_GUIDANCE,
    PRODUCT_PHOTO_GUIDANCE,
  ]);
  assert.deepEqual(providerParameters.map(({ seed }) => seed), PRODUCT_PHOTO_SEEDS);
  assert.equal(batch.preservationSupport, 'best_effort');
  assert.equal(diagnosticLogs.length, 4);
  assert.match(diagnosticLogs[0], /\[CreativeDirector\] Proposal 1/);
  assert.match(diagnosticLogs[0], /concept:|composition:|humanPresence:|productInteraction:|finalPrompt:/);
  assert.match(diagnosticLogs[3], /\[CreativeDirector\] Proposal 4/);
});

test('aspect ratios correspondem às dimensões efetivamente enviadas ao provider', () => {
  assert.deepEqual(outputDimensions('1:1'), { width: 1024, height: 1024 });
  assert.deepEqual(outputDimensions('4:5'), { width: 1024, height: 1280 });
  assert.deepEqual(outputDimensions('9:16'), { width: 1024, height: 1820 });
  assert.deepEqual(outputDimensions('16:9'), { width: 1820, height: 1024 });
});

test('falha isolada preserva internamente resultados das outras propostas', async () => {
  let calls = 0;
  const provider = {
    generate: async () => {
      calls += 1;
      if (calls === 2) throw new Error('provider failed');
      return { imageBase64 };
    },
  };
  await assert.rejects(
    generateProductPhotoBatch({ provider, assetStore: assetStore(), request: request() }),
    (error) => {
      assert.ok(error instanceof ImageTransformBatchError);
      assert.equal(error.successfulResults.length, 3);
      assert.equal(error.failures.length, 1);
      assert.equal(error.failures[0].proposalIndex, 2);
      assert.match(error.failures[0].error.message, /provider failed/);
      return true;
    },
  );
  assert.equal(calls, 4);
});

function policyError() {
  return new ImageToImageProviderError('rejected', {
    provider: 'fal-flux2-pro', status: 422, code: 'INVALID_UPSTREAM_INPUT',
    category: 'content_policy', providerErrorType: 'content_policy_violation',
    invalidFields: ['body.prompt'], upstreamRequestId: 'safe-request-id',
  });
}

test('content policy repete somente a proposta rejeitada uma vez e preserva parâmetros', async () => {
  const calls = [];
  const provider = {
    generate: async (providerRequest) => {
      calls.push(providerRequest);
      if (providerRequest.proposalIndex === 2 && providerRequest.retryAttempt === 0) {
        throw policyError();
      }
      return { imageBase64: `${imageBase64}-${providerRequest.proposalIndex}` };
    },
  };
  const batch = await generateProductPhotoBatch({
    provider, assetStore: assetStore(), request: request(), creativeDirectorLogger: undefined,
  });
  const proposalTwo = calls.filter((entry) => entry.proposalIndex === 2);

  assert.equal(batch.imagesBase64.length, 4);
  assert.equal(calls.length, 5);
  assert.equal(proposalTwo.length, 2);
  assert.equal(proposalTwo[0].parameters.provider.seed, proposalTwo[1].parameters.provider.seed);
  assert.deepEqual(proposalTwo[0].output, proposalTwo[1].output);
  assert.strictEqual(proposalTwo[0].inputs, proposalTwo[1].inputs);
  assert.notEqual(proposalTwo[0].prompt, proposalTwo[1].prompt);
  assert.match(proposalTwo[1].prompt, /commercially appropriate|commercial still-life/i);
});

test('segunda rejeição de content policy não gera terceiro retry e mantém sucessos', async () => {
  const calls = [];
  const provider = {
    generate: async (providerRequest) => {
      calls.push(providerRequest);
      if (providerRequest.proposalIndex === 2) throw policyError();
      return { imageBase64: imageBase64 };
    },
  };
  await assert.rejects(
    generateProductPhotoBatch({
      provider, assetStore: assetStore(), request: request(), creativeDirectorLogger: undefined,
    }),
    (error) => error instanceof ImageTransformBatchError &&
      error.successfulResults.length === 3 && error.failures[0].proposalIndex === 2,
  );
  assert.equal(calls.filter((entry) => entry.proposalIndex === 2).length, 2);
  assert.equal(calls.length, 5);
});

test('autenticação, quota e erro 5xx não acionam retry de prompt', async (t) => {
  for (const scenario of [
    { status: 401, category: 'authentication', type: 'authentication_error' },
    { status: 429, category: 'quota', type: 'rate_limit' },
    { status: 500, category: 'upstream_unavailable', type: 'internal_error' },
  ]) {
    await t.test(String(scenario.status), async () => {
      const calls = [];
      const provider = {
        generate: async (providerRequest) => {
          calls.push(providerRequest);
          if (providerRequest.proposalIndex === 2) {
            throw new ImageToImageProviderError('failure', {
              status: scenario.status, category: scenario.category,
              providerErrorType: scenario.type, invalidFields: ['body.prompt'],
            });
          }
          return { imageBase64 };
        },
      };
      await assert.rejects(generateProductPhotoBatch({
        provider, assetStore: assetStore(), request: request(), creativeDirectorLogger: undefined,
      }), ImageTransformBatchError);
      assert.equal(calls.filter((entry) => entry.proposalIndex === 2).length, 1);
      assert.equal(calls.length, 4);
    });
  }
});

test('asset inválido ou expirado é rejeitado', async () => {
  await assert.rejects(
    generateProductPhotoBatch({
      provider: { generate: async () => ({ imageBase64 }) },
      assetStore: assetStore({ readImage: async () => undefined }),
      request: request(),
    }),
    (error) => error instanceof ImageTransformValidationError &&
      error.code === 'ASSET_NOT_FOUND' && error.status === 404,
  );
});

test('MIME armazenado inválido é rejeitado antes do provedor', async () => {
  let called = false;
  await assert.rejects(
    generateProductPhotoBatch({
      provider: { generate: async () => { called = true; } },
      assetStore: assetStore({
        readImage: async () => ({ bytes: Buffer.from('x'), mimeType: 'application/pdf' }),
      }),
      request: request(),
    }),
    (error) => error instanceof ImageTransformValidationError &&
      error.code === 'INVALID_ASSET_MIME' && error.status === 415,
  );
  assert.equal(called, false);
});
