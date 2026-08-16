import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProductPhotoConceptPlanner } from '../image-to-image/product-photo-concept-planner.mjs';
import { ProductPhotoPromptBuilder } from '../image-to-image/product-photo-prompt-builder.mjs';
import { PRODUCT_PHOTO_USER_BRIEF_BUDGET } from '../image-to-image/product-photo-prompt-builder.mjs';

const planner = new ProductPhotoConceptPlanner();
const builder = new ProductPhotoPromptBuilder();

function names(category, prompt = 'Commercial campaign') {
  return planner.plan({ productCategory: category, prompt }).concepts.map(({ name }) => name);
}

test('joia recebe lifestyle, still life, macro e concept campaign', () => {
  assert.deepEqual(names('jewelry'), [
    'LIFESTYLE / WORN IN USE', 'LUXURY DISPLAY', 'EXTREME MACRO',
    'CONCEPT CAMPAIGN',
  ]);
});

test('alimento e abacaxi nunca selecionam produto vestido', () => {
  const explicit = planner.plan({ productCategory: 'food', prompt: 'Pineapple campaign' });
  const inferred = planner.plan({ productCategory: 'general', prompt: 'Campanha para abacaxi fresco' });
  for (const plan of [explicit, inferred]) {
    assert.equal(plan.understanding.category, 'food');
    assert.ok(plan.concepts.every(({ name }) => !name.includes('WORN')));
    assert.ok(plan.concepts.every(({ interaction }) => !/wears the product/i.test(interaction)));
    assert.ok(plan.concepts.some(({ name }) => name === 'FOOD HERO'));
    assert.ok(plan.concepts.some(({ name }) => name === 'SERVING / CONSUMPTION CONTEXT'));
  }
});

test('roupa pode ser vestida e eletrônico usa contexto funcional', () => {
  assert.ok(names('clothing').includes('LIFESTYLE / WORN IN USE'));
  const electronics = names('electronics');
  assert.ok(electronics.includes('FUNCTIONAL USE CONTEXT'));
  assert.ok(electronics.includes('TECHNICAL DETAIL'));
  assert.ok(!electronics.includes('LIFESTYLE / WORN IN USE'));
});

test('móvel combina catálogo, ambiente, material e editorial', () => {
  assert.deepEqual(names('furniture'), [
    'CLEAN CATALOG', 'ENVIRONMENTAL CONTEXT', 'EXTREME MACRO',
    'EDITORIAL STILL LIFE',
  ]);
});

test('produto desconhecido usa fallback seguro sem interação humana forçada', () => {
  const plan = planner.plan({ productCategory: 'unknown', prompt: 'An unusual object' });
  assert.equal(plan.understanding.category, 'general');
  assert.equal(plan.understanding.source, 'safe_fallback');
  assert.ok(plan.concepts.every(({ humanPresent }) => humanPresent === false));
});

test('quatro briefings diferem estruturalmente em múltiplas dimensões', () => {
  for (const category of ['jewelry', 'food', 'clothing', 'electronics', 'furniture', 'general']) {
    const concepts = planner.plan({ productCategory: category }).concepts;
    assert.equal(new Set(concepts.map(({ name }) => name)).size, 4);
    for (let index = 1; index < concepts.length; index += 1) {
      const previous = concepts[index - 1];
      const current = concepts[index];
      const changed = ['cameraDistance', 'angle', 'lens', 'composition', 'environment', 'lighting', 'depthOfField', 'interaction']
        .filter((field) => previous[field] !== current[field]);
      assert.ok(changed.length >= 3, `${category} concept ${index} changed only ${changed.length} dimensions`);
    }
  }
});

test('texto e logo não são inventados e existentes são preservados best effort', () => {
  const plan = planner.plan({ productCategory: 'jewelry', prompt: 'Jewelry gift campaign' });
  const prompt = builder.build({
    prompt: 'Jewelry gift campaign', plan, concept: plan.concepts[2],
    preservation: { preservePrintedText: true, preserveLogo: true },
  });
  assert.match(prompt, /No typography, caption, logo, brand/);
  assert.match(prompt, /no redesign/i);
  assert.match(prompt, /printed text/);
  assert.match(prompt, /logo/);
  assert.match(prompt, /best effort/i);
});

test('prompt final é técnico, hierárquico, material e não promete garantia', () => {
  const plan = planner.plan({ productCategory: 'jewelry', prompt: 'Elegant jewelry campaign' });
  const prompt = builder.build({
    prompt: 'Elegant jewelry campaign', plan, concept: plan.concepts[0],
    preservation: { preserveProduct: true, preserveColors: true },
  });
  const sections = ['REFERENCE:', 'FIDELITY', 'USER BRIEF:', 'FREE RE-STAGING', 'CONCEPT:', 'INTERACTION:', 'COMPOSITION:', 'LIGHTING/DEPTH', 'MATERIAL/SET:', 'QUALITY:', 'CONSTRAINTS:'];
  for (const section of sections) assert.match(prompt, new RegExp(section));
  assert.ok(prompt.indexOf('FIDELITY') < prompt.indexOf('CONCEPT:'));
  assert.match(prompt, /metal tone/);
  assert.match(prompt, /setting\/symmetry\/facets/);
  assert.match(prompt, /best-effort|best effort/i);
  assert.doesNotMatch(prompt, /guarantee|pixel-perfect/i);
  assert.doesNotMatch(prompt, /[À-ÿ]/);
});

test('restrições globais bloqueiam anatomia impossível, colagem, texto e duplicação', () => {
  const plan = planner.plan({ productCategory: 'jewelry', prompt: 'Jewelry campaign' });
  const prompt = builder.build({
    prompt: 'Jewelry campaign', plan, concept: plan.concepts[0],
    preservation: { preserveProduct: true },
  });
  assert.match(prompt, /correct anatomy/);
  assert.match(prompt, /no impossible\/floating placement/);
  assert.match(prompt, /One ad photo/);
  assert.match(prompt, /no moodboard\/contact sheet\/split screen\/grid\/collage/);
  assert.match(prompt, /No typography, caption, logo/);
  assert.match(prompt, /no redesign/);
  assert.match(prompt, /Product primary; model supports it/);
  assert.match(prompt, /never overlay\/float on face\/eyes\/body/);
});

test('pedidos explícitos liberam somente colagem ou texto solicitados', () => {
  const collagePlan = planner.plan({ productCategory: 'general', prompt: 'Create a collage campaign' });
  const collagePrompt = builder.build({
    prompt: 'Create a collage campaign', plan: collagePlan,
    concept: collagePlan.concepts[0],
  });
  assert.match(collagePrompt, /coherent multi-image layout explicitly requested/);

  const textPlan = planner.plan({ productCategory: 'general', prompt: 'Include title Summer Sale' });
  const textPrompt = builder.build({
    prompt: 'Include title Summer Sale', plan: textPlan,
    concept: textPlan.concepts[0],
  });
  assert.match(textPrompt, /Use exact requested text only/);
  assert.match(textPrompt, /invent no other typography\/branding/);
});

test('UTF-8 válido seleciona direções Estúdio Premium e Cinematográfico', () => {
  const plan = planner.plan({ productCategory: 'general', prompt: 'Campaign' });
  const premium = builder.build({
    prompt: 'Campaign', artisticDirection: 'Estúdio Premium', plan,
    concept: plan.concepts[0],
  });
  const cinematic = builder.build({
    prompt: 'Campaign', artisticDirection: 'Cinematográfico', plan,
    concept: plan.concepts[0],
  });
  assert.match(premium, /disciplined premium studio campaign treatment/);
  assert.match(cinematic, /dimensional cinematic atmosphere/);
  assert.doesNotMatch(premium, /realistic, commercially useful advertising treatment/);
});

test('brief longo mantém intenção reservada mesmo com todas as proteções', () => {
  const distinctiveIntent = 'Create a launch campaign for autumn with copper reflections and dramatic side light';
  const userBrief = `${distinctiveIntent}. ${'Additional commercial context. '.repeat(30)}`;
  const plan = planner.plan({ productCategory: 'jewelry', prompt: userBrief });
  const prompt = builder.build({
    prompt: userBrief, artisticDirection: 'Estúdio Premium', plan,
    concept: plan.concepts[3],
    preservation: {
      preserveProduct: true, preservePackaging: true, preserveLabel: true,
      preservePrintedText: true, preserveLogo: true, preserveColors: true,
      preserveProportions: true,
    },
  });
  assert.match(prompt, new RegExp(distinctiveIntent));
  const preservedBrief = prompt.split('USER BRIEF: ')[1].split('\n')[0];
  assert.ok(preservedBrief.length >= PRODUCT_PHOTO_USER_BRIEF_BUDGET - 1);
  assert.ok(prompt.length <= 2048);
});

test('modo livre exige nova direção visual em múltiplas dimensões', () => {
  const plan = planner.plan({ productCategory: 'jewelry', prompt: 'Jewelry campaign' });
  const prompt = builder.build({ prompt: 'Jewelry campaign', plan, concept: plan.concepts[0] });
  assert.match(prompt, /FREE RE-STAGING/);
  assert.match(prompt, /Change composition, background, camera\/framing, lighting, perspective/);
  assert.match(prompt, /Never return a cleaned-up reference copy/);
});

test('modos restritivos não recebem reencenação incompatível', () => {
  const plan = planner.plan({ productCategory: 'general', prompt: 'Controlled edit' });
  const modes = [
    ['changeBackgroundOnly', /BACKGROUND ONLY: change only the background/],
    ['changeLightingOnly', /LIGHTING ONLY: change only lighting/],
    ['changeSceneOnly', /SCENE ONLY: change only the surroundings/],
  ];
  for (const [key, expected] of modes) {
    const prompt = builder.build({
      prompt: 'Controlled edit', plan, concept: plan.concepts[0],
      preservation: { [key]: true },
    });
    assert.match(prompt, expected);
    assert.doesNotMatch(prompt, /FREE RE-STAGING|Change composition, background/);
  }
});

test('quatro prompts de joias possuem instruções operacionais distintas', () => {
  const plan = planner.plan({ productCategory: 'jewelry', prompt: 'Jewelry campaign' });
  const prompts = plan.concepts.map((concept) => builder.build({
    prompt: 'Jewelry campaign', plan, concept,
  }));
  assert.match(prompts[0], /new editorial ad with a person wearing the product correctly/);
  assert.match(prompts[1], /fully re-staged luxury still life without a model/);
  assert.match(prompts[2], /significantly closer commercial macro/);
  assert.match(prompts[3], /campaign key visual with a unique composition/);
  assert.equal(new Set(prompts).size, 4);
});

test('todos os prompts permanecem dentro do limite do endpoint', () => {
  const preservation = {
    preserveProduct: true, preservePackaging: true, preserveLabel: true,
    preservePrintedText: true, preserveLogo: true, preserveColors: true,
    preserveProportions: true,
  };
  for (const category of ['jewelry', 'food', 'clothing', 'electronics', 'furniture', 'general']) {
    const plan = planner.plan({ productCategory: category, prompt: 'Commercial campaign' });
    for (const concept of plan.concepts) {
      const prompt = builder.build({
        prompt: 'Commercial campaign', preservation, artisticDirection: 'Luxo',
        plan, concept,
      });
      assert.ok(prompt.length <= 2048, `${category}/${concept.name}: ${prompt.length}`);
    }
  }
});
