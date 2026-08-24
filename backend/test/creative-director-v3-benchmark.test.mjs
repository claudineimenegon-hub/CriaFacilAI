import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { CREATIVE_DIRECTOR_V3_FIXTURE_NAMES, createCreativeDirectorV3Fixture } from '../benchmark/creative-director-v3-fixtures.mjs';
import { createDeterministicCreativeDirectorV3Model, runCreativeDirectorV3, validateCreativeDirectorV3Output } from '../benchmark/creative-director-v3.mjs';

const execFileAsync = promisify(execFile);
const backendDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');

async function generated(name = 'unknown') {
  const input = createCreativeDirectorV3Fixture(name);
  const result = await runCreativeDirectorV3({ input, modelAdapter: createDeterministicCreativeDirectorV3Model() });
  return { input, result };
}

test('15 categorias generalistas produzem quatro briefs válidos, distintos e fiéis', async () => {
  assert.equal(CREATIVE_DIRECTOR_V3_FIXTURE_NAMES.length, 15);
  for (const name of CREATIVE_DIRECTOR_V3_FIXTURE_NAMES) {
    const { input, result } = await generated(name);
    assert.equal(result.briefs.length, 4, name);
    assert.deepEqual(result.briefs.map(({ campaignRole }) => campaignRole), [
      'hero_commercial', 'contextual_lifestyle', 'editorial_craft_detail', 'concept_campaign',
    ]);
    assert.equal(new Set(result.briefs.map(({ differentiationKeys }) => differentiationKeys.join('|'))).size, 4, name);
    for (const brief of result.briefs) {
      assert.equal(brief.creativeFreedom.productTransformation, 'forbidden', name);
      assert.deepEqual(brief.productPresentation.requiredVisibleItems,
        input.productIdentity.items.map(({ id, quantity }) => ({ itemId: id, quantity })), name);
    }
  }
});

test('vaso e produto desconhecido nunca recebem uso corporal absurdo', async () => {
  for (const name of ['vase', 'unknown']) {
    const { result } = await generated(name);
    const serialized = JSON.stringify(result.briefs);
    assert.ok(result.briefs.every(({ humanInteraction }) => humanInteraction.mode === 'forbidden'));
    assert.doesNotMatch(serialized, /earlobe|finger|worn on|body attachment/i);
  }
});

test('conjunto de joias preserva IDs, quantidades e o par conhecido', async () => {
  const { result } = await generated('jewelry');
  for (const brief of result.briefs) {
    assert.deepEqual(brief.productPresentation.requiredVisibleItems, [
      { itemId: 'ring-1', quantity: 1 }, { itemId: 'earring-pair', quantity: 2 },
    ]);
    assert.equal(brief.visibilityIntent.pairPolicy, 'preserve_pair');
  }
});

test('visibility seletiva aceita inventário completo, subconjunto canônico e pair completo', async () => {
  const input = createCreativeDirectorV3Fixture('jewelry');
  const model = createDeterministicCreativeDirectorV3Model();
  const valid = await model.generate(input);
  const subset = valid.map((brief, index) => {
    if (index === 0) return brief;
    if (index === 1) {
      const items = [{ itemId: 'earring-pair', quantity: 2 }];
      return { ...brief,
        productPresentation: { ...brief.productPresentation, heroItemIds: ['earring-pair'], supportingItemIds: [], requiredVisibleItems: items, optionalVisibleItems: [], presentationScope: 'single_item_detail' },
        visibilityIntent: { ...brief.visibilityIntent, requiredVisibleItems: items, optionalVisibleItems: [], heroItemIds: ['earring-pair'], pairPolicy: 'preserve_pair' },
      };
    }
    const items = [{ itemId: 'ring-1', quantity: 1 }];
    return { ...brief,
      productPresentation: { ...brief.productPresentation, heroItemIds: ['ring-1'], supportingItemIds: [], requiredVisibleItems: items, optionalVisibleItems: [], presentationScope: 'single_item_detail' },
      visibilityIntent: { ...brief.visibilityIntent, requiredVisibleItems: items, optionalVisibleItems: [], heroItemIds: ['ring-1'], pairPolicy: 'not_selected' },
    };
  });
  assert.equal(validateCreativeDirectorV3Output(subset, input).length, 4);
  assert.equal(input.productIdentity.items.length, 2);
});

test('visibility seletiva rejeita invenção, duplicação, excesso e pair parcial', async () => {
  const input = createCreativeDirectorV3Fixture('jewelry');
  const valid = await createDeterministicCreativeDirectorV3Model().generate(input);
  const replaceFirst = (items, pairPolicy = 'preserve_pair') => valid.map((brief, index) => index === 0 ? { ...brief,
    productPresentation: { ...brief.productPresentation, heroItemIds: [items[0].itemId], supportingItemIds: [], requiredVisibleItems: items, optionalVisibleItems: [] },
    visibilityIntent: { ...brief.visibilityIntent, requiredVisibleItems: items, optionalVisibleItems: [], heroItemIds: [items[0].itemId], pairPolicy },
  } : brief);
  for (const candidate of [
    replaceFirst([{ itemId: 'invented', quantity: 1 }]),
    replaceFirst([{ itemId: 'ring-1', quantity: 1 }, { itemId: 'ring-1', quantity: 1 }], 'not_selected'),
    replaceFirst([{ itemId: 'ring-1', quantity: 2 }], 'not_selected'),
    replaceFirst([{ itemId: 'earring-pair', quantity: 1 }]),
  ]) assert.throws(() => validateCreativeDirectorV3Output(candidate, input), { code: 'INVALID_V3_OUTPUT' });
});

test('relação set não atômica permite subset sem apagar a relação global', async () => {
  const base = createCreativeDirectorV3Fixture('perfume');
  const input = { ...base, productIdentity: { ...base.productIdentity,
    items: [...base.productIdentity.items, { id: 'box-1', functionalType: 'presentation box', quantity: 1 }],
    relationships: [{ type: 'set', itemIds: ['bottle-1', 'box-1'] }],
  } };
  const valid = await createDeterministicCreativeDirectorV3Model().generate(input);
  const subset = valid.map((brief) => {
    const items = [{ itemId: 'bottle-1', quantity: 1 }];
    return { ...brief,
      productPresentation: { ...brief.productPresentation, heroItemIds: ['bottle-1'], supportingItemIds: [], requiredVisibleItems: items, optionalVisibleItems: [], presentationScope: 'single_item_detail' },
      visibilityIntent: { ...brief.visibilityIntent, requiredVisibleItems: items, optionalVisibleItems: [], heroItemIds: ['bottle-1'], pairPolicy: 'not_applicable' },
    };
  });
  assert.equal(validateCreativeDirectorV3Output(subset, input).length, 4);
  assert.deepEqual(input.productIdentity.relationships, [{ type: 'set', itemIds: ['bottle-1', 'box-1'] }]);
});

test('selective visibility isolada não satisfaz diversidade', async () => {
  const input = createCreativeDirectorV3Fixture('jewelry');
  const valid = await createDeterministicCreativeDirectorV3Model().generate(input);
  const first = valid[0];
  const repetitive = valid.map((brief, index) => {
    const items = index % 2 === 0 ? [{ itemId: 'ring-1', quantity: 1 }] : [{ itemId: 'earring-pair', quantity: 2 }];
    return { ...brief,
      scene: { ...brief.scene, environment: first.scene.environment },
      productPresentation: { ...brief.productPresentation, heroItemIds: [items[0].itemId], supportingItemIds: [], requiredVisibleItems: items, optionalVisibleItems: [], presentationMode: first.productPresentation.presentationMode, presentationScope: 'single_item_detail' },
      visibilityIntent: { ...brief.visibilityIntent, requiredVisibleItems: items, optionalVisibleItems: [], heroItemIds: [items[0].itemId], pairPolicy: items[0].itemId === 'earring-pair' ? 'preserve_pair' : 'not_selected' },
      photography: { ...brief.photography, shotType: first.photography.shotType, cameraAngle: first.photography.cameraAngle, lighting: first.photography.lighting },
      artDirection: { ...brief.artDirection, visualLanguage: first.artDirection.visualLanguage, colorStrategy: first.artDirection.colorStrategy },
    };
  });
  assert.throws(() => validateCreativeDirectorV3Output(repetitive, input), { code: 'INSUFFICIENT_V3_DIVERSITY' });
});

test('adapter de modelo é injetável e a saída local continua autoridade final', async () => {
  const input = createCreativeDirectorV3Fixture('perfume');
  const valid = await createDeterministicCreativeDirectorV3Model().generate(input);
  const model = { name: 'future-llm-test-double', async generate(received) { assert.equal(received.productIdentity.category, 'perfume'); return valid; } };
  const result = await runCreativeDirectorV3({ input, modelAdapter: model });
  assert.equal(result.modelAdapterName, 'future-llm-test-double');
  assert.equal(result.fallback, false);
});

test('rejeita lotes com 3 ou 5 propostas, ID ou papel duplicado', async () => {
  const input = createCreativeDirectorV3Fixture('handbag');
  const valid = await createDeterministicCreativeDirectorV3Model().generate(input);
  for (const candidate of [valid.slice(0, 3), [...valid, valid[0]], valid.map((b, i) => i === 1 ? { ...b, proposalId: 1 } : b), valid.map((b, i) => i === 1 ? { ...b, campaignRole: 'hero_commercial' } : b)]) {
    assert.throws(() => validateCreativeDirectorV3Output(candidate, input), { code: 'INVALID_V3_OUTPUT' });
  }
});

test('rejeita item desconhecido, quantidades inválidas, transformação e enums inválidos', async () => {
  const input = createCreativeDirectorV3Fixture('watch');
  const valid = await createDeterministicCreativeDirectorV3Model().generate(input);
  const mutate = (change) => valid.map((brief, index) => index === 0 ? change(brief) : brief);
  assert.throws(() => validateCreativeDirectorV3Output(mutate((b) => ({ ...b, productPresentation: { ...b.productPresentation, requiredVisibleItems: [{ itemId: 'ghost', quantity: 1 }] } })), input), { code: 'INVALID_V3_OUTPUT' });
  for (const quantity of [-1, 2]) assert.throws(() => validateCreativeDirectorV3Output(mutate((b) => ({ ...b, productPresentation: { ...b.productPresentation, requiredVisibleItems: [{ itemId: 'watch-1', quantity }] } })), input), { code: 'INVALID_V3_OUTPUT' });
  assert.throws(() => validateCreativeDirectorV3Output(mutate((b) => ({ ...b, creativeFreedom: { ...b.creativeFreedom, productTransformation: 'allowed' } })), input), { code: 'INVALID_V3_OUTPUT' });
  assert.throws(() => validateCreativeDirectorV3Output(mutate((b) => ({ ...b, artDirection: { ...b.artDirection, colorStrategy: 'invalid' } })), input), { code: 'INVALID_V3_OUTPUT' });
});

test('rejeita relacionamento rompido e interação corporal incompatível', async () => {
  const jewelry = createCreativeDirectorV3Fixture('jewelry');
  const jewelryBriefs = await createDeterministicCreativeDirectorV3Model().generate(jewelry);
  assert.throws(() => validateCreativeDirectorV3Output(jewelryBriefs.map((b, i) => i === 0 ? { ...b, visibilityIntent: { ...b.visibilityIntent, pairPolicy: 'not_applicable' } } : b), jewelry), { code: 'INVALID_V3_OUTPUT' });
  const vase = createCreativeDirectorV3Fixture('vase');
  const vaseBriefs = await createDeterministicCreativeDirectorV3Model().generate(vase);
  assert.throws(() => validateCreativeDirectorV3Output(vaseBriefs.map((b, i) => i === 0 ? { ...b, humanInteraction: { mode: 'allowed', usageDescription: 'worn on the earlobe' } } : b), vase), { code: 'INVALID_V3_OUTPUT' });
});

test('rejeita quatro pedestais equivalentes e aceita lote estruturalmente diverso', async () => {
  const input = createCreativeDirectorV3Fixture('cosmetic');
  const valid = await createDeterministicCreativeDirectorV3Model().generate(input);
  const first = valid[0];
  const repetitive = valid.map((brief) => ({ ...brief,
    scene: { ...brief.scene, environment: first.scene.environment },
    productPresentation: { ...brief.productPresentation, presentationMode: first.productPresentation.presentationMode },
    photography: { ...brief.photography, shotType: first.photography.shotType, cameraAngle: first.photography.cameraAngle, lighting: first.photography.lighting },
    artDirection: { ...brief.artDirection, visualLanguage: first.artDirection.visualLanguage, colorStrategy: first.artDirection.colorStrategy },
  }));
  assert.throws(() => validateCreativeDirectorV3Output(repetitive, input), { code: 'INSUFFICIENT_V3_DIVERSITY' });
  assert.equal(validateCreativeDirectorV3Output(valid, input).length, 4);
});

test('rejeita objeto malformado e generationPolicy diferente de quatro', async () => {
  const input = createCreativeDirectorV3Fixture('chair');
  const valid = await createDeterministicCreativeDirectorV3Model().generate(input);
  assert.throws(() => validateCreativeDirectorV3Output(valid.map((b, i) => i === 0 ? { proposalId: b.proposalId, campaignRole: b.campaignRole } : b), input), { code: 'INVALID_V3_OUTPUT' });
  assert.rejects(() => runCreativeDirectorV3({ input: { ...input, generationPolicy: { ...input.generationPolicy, proposalCount: 5 } }, modelAdapter: createDeterministicCreativeDirectorV3Model() }), { code: 'INVALID_V3_INPUT' });
});

test('dry-run V3 salva quatro briefs completos sem provider visual ou confirmação externa', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'criafacil-v3-dry-run-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { stdout } = await execFileAsync(process.execPath, ['benchmark/run-benchmark.mjs', '--creative-director-v3', '--dry-run', '--fixture', 'vase', '--output', directory], { cwd: backendDirectory });
  const payload = JSON.parse(stdout);
  assert.equal(payload.externalCalls, 0);
  assert.equal(payload.briefs.length, 4);
  assert.equal(payload.schemaValid, true);
  assert.equal(payload.diversityValid, true);
  const saved = JSON.parse(await readFile(payload.savedTo, 'utf8'));
  assert.equal(saved.briefs.length, 4);
  assert.doesNotMatch(JSON.stringify(saved), /api.?key|authorization|base64|data:image/i);
});
