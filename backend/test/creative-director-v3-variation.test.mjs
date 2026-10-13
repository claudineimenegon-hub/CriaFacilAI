import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDeterministicCreativeDirectorV3Model,
  validateCreativeDirectorV3Input,
} from '../benchmark/creative-director-v3.mjs';
import { compileCreativeDirectorV3ImagePrompt } from '../benchmark/creative-director-v3-image-prompt-compiler.mjs';
import { createOpenAICreativeDirectorV3Adapter } from '../benchmark/creative-director-v3-openai-adapter.mjs';
import {
  buildCreativeVariationBlock,
  createCreativeVariationSeed,
} from '../benchmark/creative-director-v3-variation.mjs';

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function genericInput(category = 'food') {
  return validateCreativeDirectorV3Input({
    productIdentity: {
      category,
      items: [{ id: 'product-1', functionalType: 'product', quantity: 1 }],
      relationships: [], observedFeatures: [], ambiguousFeatures: [],
    },
    productSemantics: {
      functionalType: 'product', affordances: ['surface_supported'],
      validContexts: ['commercial context'], invalidContexts: ['physically implausible use'],
    },
    userIntent: { objective: 'Create a campaign', aspectRatio: '1:1', requestedStyle: null, additionalInstructions: null },
    generationPolicy: { proposalCount: 4, targetQuality: 'standard', creativeFreedom: 'high' },
  });
}

test('seed cobre os 4 papéis com cores, apoios e arranjos todos distintos e sem preto', () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const result = createCreativeVariationSeed(seededRandom(seed));
    assert.equal(result.length, 4);
    assert.equal(new Set(result.map(({ campaignRole }) => campaignRole)).size, 4);
    for (const key of ['colorWorld', 'supportType', 'arrangement']) {
      assert.equal(new Set(result.map((item) => item[key])).size, 4);
    }
    for (const { colorWorld } of result) assert.doesNotMatch(colorWorld, /black|charcoal|preto|beige|cream|sand/i);
  }
});

test('seed é reprodutível com o mesmo gerador e varia entre execuções diferentes', () => {
  assert.equal(buildCreativeVariationBlock(seededRandom(7)), buildCreativeVariationBlock(seededRandom(7)));
  const variants = new Set();
  for (let seed = 1; seed <= 30; seed += 1) variants.add(buildCreativeVariationBlock(seededRandom(seed)));
  assert.ok(variants.size > 10);
});

test('seed não usa vocabulário específico de joias', () => {
  const text = buildCreativeVariationBlock(seededRandom(3));
  assert.doesNotMatch(text, /jewel|joia|necklace|colar|ring|earring|bracelet/i);
});

test('adapter envia o seed e as regras de diversidade ao Creative Director', async () => {
  let body;
  const adapter = createOpenAICreativeDirectorV3Adapter({
    apiKey: 'test-key',
    random: seededRandom(11),
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ output_text: JSON.stringify({ briefs: [] }) }) };
    },
  });
  await adapter.generate(genericInput());
  const userText = body.input[0].content[0].text;
  assert.match(userText, /CREATIVE VARIATION SEED/);
  for (const role of ['hero_commercial', 'contextual_lifestyle', 'editorial_craft_detail', 'concept_campaign']) {
    assert.match(userText, new RegExp(`- ${role}: color world = `));
  }
  assert.match(body.instructions, /FREEDOM OUTSIDE THE PRODUCT/);
  assert.match(body.instructions, /COLOR DIVERSITY/);
  assert.match(body.instructions, /Never default to black/);
  assert.match(body.instructions, /COMPOSITION AND SUPPORT DIVERSITY/);
  assert.match(body.instructions, /SCENE RICHNESS/);
  assert.match(body.instructions, /USE EACH ITEM ACCORDING TO ITS OWN FUNCTION/);
  assert.match(body.instructions, /never copy the source photo background/);
  assert.doesNotMatch(body.instructions, /Avoid generic luxury filler/);
});

test('compiler declara que a foto original serve só para identidade do produto', async () => {
  const input = genericInput('electronics');
  const briefs = await createDeterministicCreativeDirectorV3Model().generate(input);
  for (const brief of briefs) {
    const prompt = compileCreativeDirectorV3ImagePrompt({
      brief, productIdentity: input.productIdentity,
      productSemantics: input.productSemantics, userIntent: input.userIntent,
    });
    assert.match(prompt, /E3\. SOURCE PHOTO SCOPE/);
    assert.match(prompt, /Do NOT reproduce the source background/);
    assert.match(prompt, /Do not default to black, charcoal or near-black/);
  }
});
