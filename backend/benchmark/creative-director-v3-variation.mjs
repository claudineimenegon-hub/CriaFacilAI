// Per-generation creative variation seed. Generic on purpose: valid for any product
// category (food, electronics, clothing, cosmetics, jewelry, etc.). It only guides the
// scene color family and the arrangement geometry; it never changes product identity.

const BACKGROUND_FAMILIES = Object.freeze({
  hero_commercial: Object.freeze([
    'warm cream and soft sand', 'pale sage green and ivory', 'dusty blue-grey and white',
    'blush pink and champagne', 'soft terracotta and natural linen', 'light stone grey and warm white',
    'pale butter yellow and cream', 'powder lilac and pearl white',
  ]),
  contextual_lifestyle: Object.freeze([
    'warm morning daylight with natural wood and linen', 'sunlit terrace with pale stone and greenery',
    'soft interior in muted olive and cream', 'airy coastal light with sand and white',
    'golden-hour warmth with terracotta tones', 'cool overcast daylight in soft grey-blue and white',
  ]),
  editorial_craft_detail: Object.freeze([
    'rich emerald green paper and textured stone', 'deep burgundy wine with warm taupe',
    'cobalt blue with pale grey', 'mustard ochre with cream', 'warm terracotta clay with sand',
    'moss and sage tones with natural wood', 'powder pink with warm taupe',
  ]),
  concept_campaign: Object.freeze([
    'saturated cobalt blue world', 'sunset coral-to-amber gradient', 'lush forest green botanical world',
    'deep rose and burgundy world', 'electric teal with cream accents', 'violet dusk gradient',
    'warm sand dunes in monochrome tan', 'icy pale blue winter world',
  ]),
});

const COMPOSITION_STYLES = Object.freeze([
  'diagonal flow across the frame', 'tight grouped cluster with one hero item forward',
  'linear row with even rhythm', 'items floating or suspended with soft shadows',
  'items draped or hung over a natural prop', 'symmetrical centered tableau',
  'asymmetrical layout with generous negative space on one side',
  'layered on stepped blocks of natural material at different heights',
  'casually scattered as if just placed',
]);

const ROLES = Object.freeze(Object.keys(BACKGROUND_FAMILIES));

function pick(list, random) {
  const index = Math.min(list.length - 1, Math.floor(random() * list.length));
  return list[index];
}

function shuffled(list, random) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.min(index, Math.floor(random() * (index + 1)));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

export function createCreativeVariationSeed(random = Math.random) {
  const compositions = shuffled(COMPOSITION_STYLES, random);
  return Object.freeze(ROLES.map((campaignRole, index) => Object.freeze({
    campaignRole,
    backgroundFamily: pick(BACKGROUND_FAMILIES[campaignRole], random),
    arrangement: compositions[index],
  })));
}

export function buildCreativeVariationBlock(random = Math.random) {
  return [
    'CREATIVE VARIATION SEED (generic starting point for any product category):',
    ...createCreativeVariationSeed(random).map(({ campaignRole, backgroundFamily, arrangement }) =>
      `- ${campaignRole}: background color family = ${backgroundFamily}; arrangement geometry = ${arrangement}.`),
    'Use each suggestion as the default for its role unless it conflicts with product identity, canonical quantities, relationships or physical plausibility. The seed guides scene color and composition only and never changes the product.',
  ].join('\n');
}
