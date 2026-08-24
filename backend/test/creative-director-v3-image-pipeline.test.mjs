import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCreativeDirectorV3Fixture } from '../benchmark/creative-director-v3-fixtures.mjs';
import { createDeterministicCreativeDirectorV3Model, validateCreativeDirectorV3Output } from '../benchmark/creative-director-v3.mjs';
import { compileCreativeDirectorV3ImagePrompt } from '../benchmark/creative-director-v3-image-prompt-compiler.mjs';
import { runCreativeDirectorV3ImagePipeline } from '../benchmark/creative-director-v3-image-pipeline.mjs';

const source = { bytes: Buffer.from([0xff, 0xd8, 0xff, 0x00]), mimeType: 'image/jpeg' };
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function context(name = 'jewelry') {
  const input = createCreativeDirectorV3Fixture(name);
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
  return { input, briefs };
}

function select(brief, required, { pairPolicy = 'not_selected', humanInteraction } = {}) {
  const ids = required.map(({ itemId }) => itemId);
  return { ...brief,
    productPresentation: { ...brief.productPresentation, heroItemIds: [ids[0]], supportingItemIds: ids.slice(1), requiredVisibleItems: required, optionalVisibleItems: [] },
    visibilityIntent: { ...brief.visibilityIntent, mode: 'subset', heroItemIds: [ids[0]], requiredVisibleItems: required, optionalVisibleItems: [], pairPolicy },
    ...(humanInteraction ? { humanInteraction } : {}),
  };
}

test('compiler preserva full_set, IDs, quantidades, cena, fotografia e art direction', async () => {
  const { input, briefs } = await context();
  const brief = briefs[0];
  const prompt = compileCreativeDirectorV3ImagePrompt({ brief, productIdentity: input.productIdentity, productSemantics: input.productSemantics, userIntent: input.userIntent });
  assert.match(prompt, /ring-1: exactly 1 unit/);
  assert.match(prompt, /earring-pair: exactly 2 units/);
  assert.match(prompt, new RegExp(brief.scene.environment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(prompt, new RegExp(brief.photography.lighting.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(prompt, new RegExp(brief.artDirection.visualLanguage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(prompt, /productTransformation is forbidden/);
  assert.doesNotMatch(prompt, /NOT VISIBLE IN THIS IMAGE:\n- ring-1/);
});

test('compiler explicita subset, single item e itens omitidos sem alterar identidade global', async () => {
  const { input, briefs } = await context();
  const pair = [{ itemId: 'earring-pair', quantity: 2 }];
  const subset = select(briefs[1], pair, { pairPolicy: 'preserve_pair', humanInteraction: { mode: 'required', usageDescription: 'matched earrings worn naturally, one on each valid earlobe' } });
  const prompt = compileCreativeDirectorV3ImagePrompt({ brief: subset, productIdentity: input.productIdentity, productSemantics: input.productSemantics, userIntent: input.userIntent });
  assert.match(prompt, /CANONICAL \/ EXISTING INVENTORY SELECTED FOR THIS PROPOSAL:\n- earring-pair: exactly 2 units/);
  assert.match(prompt, /not a minimum clearly-visible count/);
  assert.match(prompt, /NOT VISIBLE IN THIS IMAGE:\n- ring-1/);
  assert.match(prompt, /Omission applies only to this proposal/);
  assert.doesNotMatch(prompt, /data:image|base64,/i);
  const ring = select(briefs[2], [{ itemId: 'ring-1', quantity: 1 }]);
  assert.match(compileCreativeDirectorV3ImagePrompt({ brief: ring, productIdentity: input.productIdentity, productSemantics: input.productSemantics }), /ring-1: exactly 1 unit/);
});

test('pair preservado compila duas unidades e proíbe terceira, fusão e conversão', async () => {
  const { input, briefs } = await context();
  const brief = select(briefs[1], [{ itemId: 'earring-pair', quantity: 2 }], { pairPolicy: 'preserve_pair' });
  const prompt = compileCreativeDirectorV3ImagePrompt({ brief, productIdentity: input.productIdentity, productSemantics: input.productSemantics });
  assert.match(prompt, /exactly 2 matched units/);
  assert.match(prompt, /Do not merge units, create an additional unit/);
  assert.match(prompt, /convert any unit into another product type/);
  const partial = select(briefs[1], [{ itemId: 'earring-pair', quantity: 1 }], { pairPolicy: 'preserve_pair' });
  assert.throws(() => compileCreativeDirectorV3ImagePrompt({ brief: partial, productIdentity: input.productIdentity, productSemantics: input.productSemantics }), /quantity/);
});

test('human interaction required e forbidden são preservadas sem placement inventado', async () => {
  const { input, briefs } = await context();
  const required = select(briefs[1], [{ itemId: 'earring-pair', quantity: 2 }], { pairPolicy: 'preserve_pair', humanInteraction: { mode: 'required', usageDescription: 'one matched unit on each valid earlobe' } });
  const requiredPrompt = compileCreativeDirectorV3ImagePrompt({ brief: required, productIdentity: input.productIdentity, productSemantics: input.productSemantics });
  assert.match(requiredPrompt, /Human interaction mode: required/);
  assert.match(requiredPrompt, /one matched unit on each valid earlobe/);
  const forbiddenPrompt = compileCreativeDirectorV3ImagePrompt({ brief: briefs[0], productIdentity: input.productIdentity, productSemantics: input.productSemantics });
  assert.match(forbiddenPrompt, /Do not show a person using, holding or wearing/);
  assert.doesNotMatch(forbiddenPrompt, /earlobe/);
});

test('compiler bloqueia características visíveis e exige o mesmo produto físico', async () => {
  const { input, briefs } = await context('perfume');
  const prompt = compileCreativeDirectorV3ImagePrompt({ brief: briefs[0], productIdentity: input.productIdentity, productSemantics: input.productSemantics, userIntent: input.userIntent });
  assert.match(prompt, /SOURCE-VISIBLE PRODUCT FIDELITY — HARD CONSTRAINT/);
  assert.match(prompt, /source image is the visual authority for every product characteristic that is actually visible and identifiable/);
  assert.match(prompt, /same physical product represented by the source reference/);
  assert.match(prompt, /silhouette and geometry, relative proportions, component shapes and construction, material identity/);
  assert.match(prompt, /visible patterns, textures, settings, attachments, distinctive details/);
  assert.match(prompt, /redesigned, simplified, embellished, substituted or reinterpreted/);
});

test('compiler permite melhoria fotográfica sem permitir redesign ou mudança cromática', async () => {
  const { input, briefs } = await context('beverage');
  const prompt = compileCreativeDirectorV3ImagePrompt({ brief: briefs[0], productIdentity: input.productIdentity, productSemantics: input.productSemantics, userIntent: input.userIntent });
  assert.match(prompt, /PHOTOGRAPHIC ENHANCEMENT IS ALLOWED AND ENCOURAGED/);
  assert.match(prompt, /lighting, exposure, dynamic range, specular highlights/);
  assert.match(prompt, /local contrast, clarity/);
  assert.match(prompt, /color vibrancy, photographic sharpness/);
  assert.match(prompt, /COLOR ENHANCEMENT MUST PRESERVE PRODUCT COLOR IDENTITY/);
  assert.match(prompt, /must not be replaced, shifted into another color family/);
  assert.match(prompt, /look better photographed, not turn it into a different product/);
});

test('compiler aplica scale lock e tratamento conservador a regiões ocultas', async () => {
  const { input, briefs } = await context('handbag');
  const prompt = compileCreativeDirectorV3ImagePrompt({ brief: briefs[0], productIdentity: input.productIdentity, productSemantics: input.productSemantics, userIntent: input.userIntent });
  assert.match(prompt, /PRODUCT SCALE LOCK/);
  assert.match(prompt, /realistic physical scale references/);
  assert.match(prompt, /not by enlarging, shrinking, stretching, compressing or reshaping/);
  assert.match(prompt, /UNSEEN FEATURES ARE NOT CREATIVE LICENSE/);
  assert.match(prompt, /most conservative visually compatible continuation/);
  assert.match(prompt, /inferred hidden feature must never override or alter a visible source feature/);
});

test('fidelity lock preserva selective visibility, omitted items, pair e transformação proibida', async () => {
  const { input, briefs } = await context();
  const subset = select(briefs[1], [{ itemId: 'earring-pair', quantity: 2 }], { pairPolicy: 'preserve_pair' });
  const prompt = compileCreativeDirectorV3ImagePrompt({ brief: subset, productIdentity: input.productIdentity, productSemantics: input.productSemantics, userIntent: input.userIntent });
  assert.match(prompt, /earring-pair: exactly 2 units/);
  assert.match(prompt, /NOT VISIBLE IN THIS IMAGE:\n- ring-1/);
  assert.match(prompt, /must not restore omitted canonical items/);
  assert.match(prompt, /exactly 2 matched units/);
  assert.match(prompt, /productTransformation is forbidden/);
});

test('compiler separa domínio bloqueado do domínio fotográfico sem regras específicas de categoria', async () => {
  for (const fixture of ['vase', 'sneaker', 'smartphone']) {
    const { input, briefs } = await context(fixture);
    const prompt = compileCreativeDirectorV3ImagePrompt({ brief: briefs[0], productIdentity: input.productIdentity, productSemantics: input.productSemantics, userIntent: input.userIntent });
    assert.match(prompt, /LOCKED PRODUCT DOMAIN/);
    assert.match(prompt, /CREATIVE PHOTOGRAPHY DOMAIN/);
    assert.match(prompt, /Creative Brief controls scene, composition, lighting, photography/);
    assert.match(prompt, /PRODUCT FIDELITY WINS OVER ART DIRECTION/);
    assert.doesNotMatch(prompt, /jewel|earring|ring-1|gemstone/i);
  }
});

test('pipeline seleciona um role, encaminha a mesma fonte e faz exatamente uma chamada medium 1024', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'criafacil-v3-image-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { input, briefs } = await context();
  const calls = [];
  const adapter = { id: 'openai-gpt-image', provider: 'openai-gpt-image', model: 'gpt-image-2', ready: true, supportsSeed: false, supportedQualities: ['medium', 'high'], defaultQuality: 'high', async generate(request) { calls.push(request); return { bytes: png, mimeType: 'image/png', width: 1024, height: 1024 }; } };
  const output = await runCreativeDirectorV3ImagePipeline({ briefs, input, campaignRole: 'contextual_lifestyle', adapter, source, quality: 'medium', outputDirectory: directory });
  assert.equal(calls.length, 1);
  assert.strictEqual(calls[0].source, source);
  assert.equal(calls[0].quality, 'medium');
  assert.deepEqual(calls[0].dimensions, { width: 1024, height: 1024 });
  assert.equal(output.brief.campaignRole, 'contextual_lifestyle');
  assert.equal(output.result.success, true);
  assert.equal(await readFile(join(output.result.directory, 'compiled-prompt.txt'), 'utf8'), `${output.prompt}\n`);
});

test('falha visual não recebe retry e telemetria não contém imagem ou Base64', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'criafacil-v3-image-error-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { input, briefs } = await context();
  let calls = 0; const events = [];
  const adapter = { id: 'openai-gpt-image', provider: 'openai-gpt-image', model: 'gpt-image-2', ready: true, supportsSeed: false, supportedQualities: ['medium'], async generate() { calls += 1; throw Object.assign(new Error('secret'), { code: 'UPSTREAM_ERROR' }); } };
  const output = await runCreativeDirectorV3ImagePipeline({ briefs, input, campaignRole: 'contextual_lifestyle', adapter, source, quality: 'medium', outputDirectory: directory, logger: { info: (event) => events.push(event) } });
  assert.equal(calls, 1);
  assert.equal(output.result.success, false);
  assert.doesNotMatch(JSON.stringify(events), /base64|data:image|secret/i);
});

test('pipeline revalida todos os briefs e rejeita campaign role desconhecido antes do provider', async () => {
  const { input, briefs } = await context();
  let calls = 0;
  const adapter = { ready: true, async generate() { calls += 1; } };
  await assert.rejects(() => runCreativeDirectorV3ImagePipeline({ briefs, input, campaignRole: 'missing', adapter, source, quality: 'medium', outputDirectory: 'unused' }), /exactly one/);
  const invalid = briefs.map((brief, index) => index === 0 ? { ...brief, creativeFreedom: { ...brief.creativeFreedom, productTransformation: 'allowed' } } : brief);
  await assert.rejects(() => runCreativeDirectorV3ImagePipeline({ briefs: invalid, input, campaignRole: 'contextual_lifestyle', adapter, source, quality: 'medium', outputDirectory: 'unused' }), /forbidden/);
  assert.equal(calls, 0);
  assert.equal(validateCreativeDirectorV3Output(briefs, input).length, 4);
});
