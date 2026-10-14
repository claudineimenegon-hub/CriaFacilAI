import { formatCategoryProfileBlock } from './creative-director-v3-category-profile.mjs';

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
  'deep black with warm gold highlights', 'warm cream and soft gold', 'light stone grey with pale green',
  'rich chocolate brown with amber', 'crisp white with a single bold accent color', 'charcoal with copper light',
]);

const SUPPORT_TYPES = Object.freeze([
  'moss-covered rocks with small wild flowers and ferns growing around',
  'a mannequin, bust, hand form or display figure, used only for items that are naturally worn or held that way',
  'an open gift box or branded packaging with tissue paper, ribbon and soft filler',
  'a lush garden or greenhouse scene with leaves, blossoms and dappled light',
  'draped silk or satin with fresh flowers and petals scattered around',
  'a vintage vanity or antique wooden table with a mirror, books and small curios',
  'shallow water with floating petals, wet pebbles and soft reflections',
  'a sculptural arrangement of colorful glass, acrylic or ceramic shapes',
  'a tropical or botanical scene with large leaves, palm shadows and exotic flowers',
  'a rustic wooden crate or basket with dried flowers, linen and natural fibers',
  'a velvet cushion or tray surrounded by candles, ribbons and seasonal props',
  'a seaside scene with shells, driftwood, sand ripples and sea-glass tones',
  'a colorful paper-craft or cut-out set with layered shapes and playful props',
  'a market, workshop or studio table with tools, fabrics and craft materials',
  'a window sill or balcony with potted plants, curtains and morning light',
  'a stone podium or marble plinth in an architectural setting with shadows and greenery',
  'a dark velvet display with dramatic spotlight and subtle reflections',
  'a minimalist studio set with colored paper backdrop and a single sculptural prop',
  'a cozy interior with books, ceramics, warm lamp light and textured textiles',
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

export function createCreativeVariationSeed(random = Math.random, profile = null) {
  const colors = shuffled(COLOR_WORLDS, random);
  const supports = shuffled(profile?.scenes ?? SUPPORT_TYPES, random);
  const compositions = shuffled(profile?.arrangements ?? COMPOSITION_STYLES, random);
  return Object.freeze(ROLES.map((campaignRole, index) => Object.freeze({
    campaignRole,
    colorWorld: colors[index],
    supportType: supports[index],
    arrangement: compositions[index],
  })));
}

export function formatCreativeVariationBlock(seed, profile = null) {
  return [
    ...(profile ? [formatCategoryProfileBlock(profile)] : []),
    'CREATIVE VARIATION SEED (assigned scene for any product category; each line is the default scene for its role):',
    ...seed.map(({ campaignRole, colorWorld, supportType, arrangement }) =>
      `- ${campaignRole}: color world = ${colorWorld}; scene, support and props = ${supportType}; arrangement geometry = ${arrangement}.`),
    'Build each role around the assigned scene, color world and arrangement, and enrich it with concrete props (flowers, moss, fabric, packaging, mirrors, mannequins or display forms as fitting). No scene is a default; variety is the goal. Deviate only when the assigned scene conflicts with the physical identity, canonical quantities, relationships or physical plausibility of the product. The seed guides scene, color and composition only, never the product itself.',
  ].join('\n');
}

// Deterministic enforcement: the director model may ignore the seed and drift to a repeated scene
// slab, so the assigned scene and color world are appended to each brief's props and palette.
export function applyCreativeVariationSeed(briefs, seed) {
  if (!Array.isArray(briefs)) return briefs;
  for (const brief of briefs) {
    const assigned = seed.find(({ campaignRole }) => campaignRole === brief?.campaignRole);
    if (!assigned || !Array.isArray(brief.scene?.props) || !Array.isArray(brief.artDirection?.palette)) continue;
    brief.scene.props = [`ASSIGNED SCENE (must be clearly visible): ${assigned.supportType}`, ...brief.scene.props];
    brief.artDirection.palette = [`ASSIGNED DOMINANT BACKGROUND COLOR WORLD (must be clearly visible): ${assigned.colorWorld}`, ...brief.artDirection.palette];
  }
  return briefs;
}

export function buildCreativeVariationBlock(random = Math.random, profile = null) {
  return formatCreativeVariationBlock(createCreativeVariationSeed(random, profile), profile);
}
