import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCreativeDirectorV3Input } from '../benchmark/creative-director-v3.mjs';
import { createOpenAICreativeDirectorV3Adapter } from '../benchmark/creative-director-v3-openai-adapter.mjs';
import {
  CATEGORY_PROFILES,
  resolveCategoryProfile,
} from '../benchmark/creative-director-v3-category-profile.mjs';
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

function input(category, functionalType) {
  return validateCreativeDirectorV3Input({
    productIdentity: {
      category,
      items: [{ id: 'product-1', functionalType, quantity: 1 }],
      relationships: [], observedFeatures: [], ambiguousFeatures: [],
    },
    productSemantics: {
      functionalType, affordances: ['surface_supported'],
      validContexts: ['commercial context'], invalidContexts: ['physically implausible use'],
    },
    userIntent: { objective: 'Create a campaign', aspectRatio: '1:1', requestedStyle: null, additionalInstructions: null },
    generationPolicy: { proposalCount: 4, targetQuality: 'standard', creativeFreedom: 'high' },
  });
}

test('categoria explícita escolhe o perfil e joias/categorias sem perfil ficam no padrão', () => {
  for (const key of Object.keys(CATEGORY_PROFILES)) {
    assert.equal(resolveCategoryProfile({ category: key, items: [] })?.key, key);
  }
  assert.equal(resolveCategoryProfile({ category: 'jewelry', items: [{ functionalType: 'shoe' }] }), null);
  assert.equal(resolveCategoryProfile({ category: 'food', items: [{ functionalType: 'pineapple' }] }), null);
});

test('categoria geral é identificada pelo tipo funcional do produto da foto', () => {
  const cases = [
    ['sneaker pair', 'footwear'], ['wrist watch', 'watches'], ['eau de parfum bottle', 'fragrance'],
    ['cotton t-shirt', 'clothing'], ['cordless drill', 'tools'], ['stainless steel pan', 'homeware'],
  ];
  for (const [functionalType, expected] of cases) {
    assert.equal(resolveCategoryProfile({ category: 'general', items: [{ functionalType }] })?.key, expected);
  }
  assert.equal(resolveCategoryProfile({ category: 'general', items: [{ functionalType: 'wheel rim' }] }), null);
  assert.equal(resolveCategoryProfile({ category: 'general', items: [{ functionalType: 'japan souvenir' }] }), null);
});

test('cada perfil tem cenários e arranjos suficientes e distintos para as 4 campanhas', () => {
  for (const [key, profile] of Object.entries(CATEGORY_PROFILES)) {
    assert.ok(profile.scenes.length >= 8, key);
    assert.ok(profile.arrangements.length >= 6, key);
    assert.equal(new Set(profile.scenes).size, profile.scenes.length, key);
    const seed = createCreativeVariationSeed(seededRandom(9), profile);
    assert.equal(new Set(seed.map((item) => item.supportType)).size, 4);
    assert.equal(new Set(seed.map((item) => item.arrangement)).size, 4);
    for (const item of seed) assert.ok(profile.scenes.includes(item.supportType));
  }
});

test('sem perfil o seed é idêntico ao anterior (joias inalterada)', () => {
  assert.equal(
    buildCreativeVariationBlock(seededRandom(21)),
    buildCreativeVariationBlock(seededRandom(21), null),
  );
  assert.doesNotMatch(buildCreativeVariationBlock(seededRandom(21)), /CATEGORY PROFILE/);
});

test('adapter envia uso real e cuidados da categoria ao diretor criativo', async () => {
  const cases = [
    ['clothing', 'dress', /worn by a human model or by a mannequin/],
    ['fragrance', 'perfume bottle', /Never invent, change or blur the text and logo/],
    ['tools', 'drill', /Hands must hold the tool the way it is really used/],
  ];
  for (const [category, functionalType, pattern] of cases) {
    let body;
    const adapter = createOpenAICreativeDirectorV3Adapter({
      apiKey: 'test-key', random: seededRandom(2),
      fetchImpl: async (_url, init) => {
        body = JSON.parse(init.body);
        return { ok: true, status: 200, json: async () => ({ output_text: JSON.stringify({ briefs: [] }) }) };
      },
    });
    await adapter.generate(input(category, functionalType));
    const text = body.input[0].content[0].text;
    assert.match(text, /CATEGORY PROFILE/);
    assert.match(text, pattern);
  }
});

test('adapter para joias não envia perfil de categoria', async () => {
  let body;
  const adapter = createOpenAICreativeDirectorV3Adapter({
    apiKey: 'test-key', random: seededRandom(2),
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ output_text: JSON.stringify({ briefs: [] }) }) };
    },
  });
  await adapter.generate(input('jewelry', 'necklace'));
  assert.doesNotMatch(body.input[0].content[0].text, /CATEGORY PROFILE/);
});
