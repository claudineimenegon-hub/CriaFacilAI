// Per-generation creative variation seed. Generic on purpose: valid for any product
// category (food, electronics, clothing, cosmetics, jewelry, etc.). No campaign role owns
// a palette or exposure; colors, supports and arrangements are drawn without replacement
// from shared pools so the four campaigns of one generation never repeat each other and
// two generations rarely repeat. The seed guides the scene only, never the product.

const COLOR_WORLDS = Object.freeze([
  'sage green with ivory accents', 'dusty blue with soft white', 'warm terracotta with peach accents',
  'deep teal with ivory accents', 'burgundy and rose', 'mustard ochre with warm grey',
  'blush pink with champagne', 'cobalt blue with pale grey', 'lilac and pearl white',
  'forest green with natural wood tones', 'coral and peach', 'midnight navy with soft silver light',
  'butter yellow with white', 'olive green with warm taupe', 'powder blue and lavender',
  'rich plum with soft pink', 'emerald green with pale stone', 'sunset orange to rose gradient',
]);

const SUPPORT_TYPES = Object.freeze([
  'natural stone', 'draped fabric or silk', 'raw wood', 'glass or acrylic', 'textured paper or cardboard',
  'ceramic', 'brushed metal', 'botanical elements such as leaves, branches or flowers',
  'velvet', 'water or wet surface with reflections', 'concrete or plaster', 'woven rattan or linen',
]);

const COMPOSITION_STYLES = Object.freeze([
  'diagonal flow across the frame', 'tight grouped cluster with one hero item forward',
  'linear row with even rhythm', 'items floating or suspended with soft shadows',
  'items draped or hung over a natural prop', 'symmetrical centered tableau',
  'asymmetrical layout with generous negative space on one side',
  'layered on stepped levels at different heights',
  'casually scattered as if just placed',
  'radial or fan arrangement', 'stacked or leaning against a vertical element',
  'resting in soft folds of fabric', 'hanging from a suspended element or branch',
  'reflected in a mirror or glossy surface', 'framed by an arch, window or doorway',
  'emerging from natural elements such as leaves, petals or shells', 'on a sculptural stand at different heights',
  'in an open hand or held naturally', 'inside or beside an open case or box',
  'caught in a beam of light with a soft shadow pattern', 'arranged in a flowing curve or spiral',
]);

const ROLES = Object.freeze([
  'hero_commercial', 'contextual_lifestyle', 'editorial_craft_detail', 'concept_campaign',
]);

function shuffled(list, random) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.min(index, Math.floor(random() * (index + 1)));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

export function createCreativeVariationSeed(random = Math.random) {
  const colors = shuffled(COLOR_WORLDS, random);
  const supports = shuffled(SUPPORT_TYPES, random);
  const compositions = shuffled(COMPOSITION_STYLES, random);
  return Object.freeze(ROLES.map((campaignRole, index) => Object.freeze({
    campaignRole,
    colorWorld: colors[index],
    supportType: supports[index],
    arrangement: compositions[index],
  })));
}

export function buildCreativeVariationBlock(random = Math.random) {
  return [
    'CREATIVE VARIATION SEED (generic starting point for any product category):',
    ...createCreativeVariationSeed(random).map(({ campaignRole, colorWorld, supportType, arrangement }) =>
      `- ${campaignRole}: color world = ${colorWorld}; main support/material = ${supportType}; arrangement geometry = ${arrangement}.`),
    'Treat each line as the starting point for its role and adapt it creatively. Deviate only when it conflicts with the physical identity, canonical quantities, relationships or physical plausibility of the product, or when another color world makes the product stand out better. The seed guides scene color, support and composition only.',
  ].join('\n');
}
