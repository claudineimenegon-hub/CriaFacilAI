const categoryAliases = new Map([
  ['jewelry', 'jewelry'], ['jewellery', 'jewelry'], ['accessories', 'accessory'],
  ['clothing', 'clothing'], ['apparel', 'clothing'], ['footwear', 'footwear'],
  ['food', 'food'], ['beverages', 'beverage'], ['beverage', 'beverage'],
  ['cosmetics', 'cosmetic'], ['perfume', 'perfume'],
  ['electronics', 'electronics'], ['appliance', 'appliance'],
  ['furniture', 'furniture'], ['decor', 'decor'], ['automotive', 'automotive'],
  ['tools', 'tool'], ['toys', 'toy'], ['person', 'person'],
  ['environment', 'environment'], ['packaging', 'packaging'],
]);

const keywordCategories = [
  ['jewelry', /\b(jewel|jewelry|jewellery|ring|necklace|earring|bracelet|gemstone|diamond|joia|anel|colar|brinco|pulseira)\b/i],
  ['footwear', /\b(shoe|sneaker|boot|sandals?|sapato|t[eê]nis|bota|sand[aá]lia)\b/i],
  ['clothing', /\b(shirt|dress|jacket|clothing|apparel|camisa|vestido|jaqueta|roupa)\b/i],
  ['perfume', /\b(perfume|fragrance|eau de parfum)\b/i],
  ['cosmetic', /\b(cosmetic|lipstick|cream|skincare|maquiagem|batom|cosm[eé]tico)\b/i],
  ['beverage', /\b(beverage|drink|bottle|wine|coffee|juice|bebida|garrafa|vinho|caf[eé]|suco)\b/i],
  ['food', /\b(food|fruit|pineapple|meal|snack|alimento|fruta|abacaxi|comida)\b/i],
  ['electronics', /\b(phone|smartphone|laptop|headphone|camera|electronic|celular|notebook|fone|eletr[oô]nico)\b/i],
  ['furniture', /\b(sofa|chair|table|furniture|sof[aá]|cadeira|mesa|m[oó]vel)\b/i],
  ['automotive', /\b(car|vehicle|motorcycle|automotive|carro|ve[ií]culo|moto)\b/i],
];

const materialDirections = {
  jewelry: 'Polished metal: shaped specular highlights and dark reflections. Gems: exact hue, optical depth, crisp facets, plausible reflection/refraction, no clipped sparkle.',
  clothing: 'Show real weave, stitching, seams, folds, drape, thickness, and textile finish.',
  footwear: 'Show real upper, stitching, sole, edges, grain/weave, and correct leather or textile sheen.',
  food: 'Show natural texture, freshness, appropriate moisture, dense realistic color, no plastic gloss.',
  beverage: 'Show visible glass/liquid/metal/paper/plastic faithfully; keep transparency, label edges, liquid color, and reflections.',
  cosmetic: 'Show actual packaging finish, glass/plastic edges, visible product texture, and controlled reflections.',
  perfume: 'Show glass refraction, liquid color, bottle edges, cap, label placement, and controlled reflections.',
  electronics: 'Show precise seams, controls, ports, glass, metal/plastic, screen edges, and manufacturing finish.',
  furniture: 'Show authentic fabric/leather, wood grain, metal, joinery, stitching, cushions, and finish.',
  decor: 'Show authentic ceramic, glass, wood, textile, stone, or metal behavior.',
  automotive: 'Show bodywork, paint, glass, trim, tires, lights, panel gaps, and controlled reflections.',
  general: 'Show real material behavior: texture, finish, edges, reflectivity, transparency, and color.',
};

function concept(name, objective, cameraDistance, angle, lens, composition, environment, lighting, depthOfField, humanPresent, interaction) {
  return Object.freeze({ name, objective, cameraDistance, angle, lens, composition, environment, lighting, depthOfField, humanPresent, interaction });
}

const archetypes = {
  hero: concept('PRODUCT HERO', 'conversion-focused principal campaign image', 'medium product shot', 'slightly low three-quarter angle', '70–100 mm product-photography perspective', 'dominant product with deliberate negative space', 'studio or restrained campaign set', 'directional key shaped for the material, controlled fill, precise rim separation', 'deep focus across the product', false, 'No human interaction.'),
  heroSet: concept('HERO SET / PREMIUM STILL LIFE', 'present the complete observed set as one sophisticated campaign image', 'complete set medium shot', 'considered three-quarter showcase angle', '70–100 mm low-distortion still-life perspective', 'all observed items simultaneously visible, individually identifiable, and hierarchically composed', 'dynamic category-appropriate premium surface or open presentation, selected by the Creative Director', 'sculpted key, controlled fill, precise material accents, and clear separation for every item', 'all items critically legible with dimensional set depth', false, 'No human interaction; preserve observed quantity and relationships.'),
  cleanCatalog: concept('CLEAN CATALOG', 'accurate e-commerce listing and product evaluation', 'complete product shot', 'neutral front or three-quarter angle', '85–120 mm low-distortion perspective', 'centered, legible silhouette with clean margins', 'seamless neutral catalog background', 'large controlled key, even but dimensional fill, natural contact shadow', 'complete-product sharpness', false, 'No human interaction.'),
  macro: concept('EXTREME MACRO', 'communicate craftsmanship and authentic detail', 'extreme close-up', 'detail-specific grazing angle', '90–120 mm macro perspective', 'one meaningful real detail fills the frame while preserving recognizable context', 'minimal non-distracting surface or background', 'raking key light, restrained fill, accent positioned to reveal material structure', 'selective depth of field with the defining detail critically sharp', false, 'No human interaction.'),
  lifestyleWear: concept('LIFESTYLE / WORN IN USE', 'show aspiration, scale, fit, and natural use', 'medium contextual shot', 'eye-level three-quarter angle', '50–85 mm editorial perspective', 'product is the focal point on the wearer', 'credible category-specific editorial setting', 'directional key, controlled fill, separation light', 'product/placement sharp; environment separated', true, 'A person wears it only in its intended position, with plausible scale/contact.'),
  lifestyleHeld: concept('LIFESTYLE / HELD OR APPLIED', 'demonstrate credible handling or use', 'close contextual shot', 'natural hand-level three-quarter angle', '50–85 mm commercial perspective', 'product remains unobstructed and dominant during interaction', 'credible use environment appropriate to the category', 'motivated key light with controlled skin and product highlights', 'product sharp, hand or relevant interaction plane legible', true, 'A person may hold or apply the product only in a physically plausible manner; never obscure essential product details.'),
  functionalUse: concept('FUNCTIONAL USE CONTEXT', 'show how the product supports a real activity', 'medium environmental shot', 'natural user or workstation viewpoint', '35–65 mm environmental-commercial perspective', 'product anchors a believable functional scene', 'realistic workspace, home, workshop, or use context', 'environmental key with localized product accent and balanced fill', 'product and active interface or functional area sharp', false, 'Include a person only if necessary to explain operation; never depict wearing an object not designed to be worn.'),
  luxuryDisplay: concept('LUXURY DISPLAY', 'increase perceived value through refined presentation', 'medium close product shot', 'low or three-quarter showcase angle', '70–100 mm product-photography perspective', 'asymmetric premium display with disciplined negative space', 'restrained pedestal, display, boutique surface, glass, stone, wood, or textile suited to the category', 'sculpted key, negative fill for form, narrow accent highlights without clipping', 'product sharp with layered background depth', false, 'No human interaction.'),
  packaging: concept('GIFT / NEUTRAL PACKAGING PRESENTATION', 'communicate gifting and elevated presentation', 'medium close shot', 'elevated three-quarter angle', '70–100 mm still-life perspective', 'product and neutral box form a clear hierarchy', 'category-appropriate unbranded, text-free box/display', 'soft directional key, controlled fill, material accent', 'product and package opening sharp', false, 'No human interaction; packaging stays neutral and text-free.'),
  foodHero: concept('FOOD HERO', 'create appetite appeal while advertising the exact product', 'close hero shot', 'table-level three-quarter angle', '60–100 mm food-photography perspective', 'product is abundant and legible without becoming a different prepared item', 'refined culinary surface with restrained authentic props', 'directional side or back key, controlled bounce fill, natural highlights', 'defining texture critically sharp with dimensional falloff', false, 'No person wears or uses the food as an object.'),
  serving: concept('SERVING / CONSUMPTION CONTEXT', 'show a plausible serving occasion without falsifying the advertised product', 'medium close contextual shot', 'natural diner or serving viewpoint', '50–85 mm editorial food perspective', 'original product remains identifiable beside or within a plausible serving context', 'credible table, bar, kitchen, or dining environment', 'motivated side key, controlled fill, practical highlights and natural shadows', 'product and relevant serving plane sharp', false, 'Hands may serve or cut only when physically plausible; never depict a person wearing the product.'),
  environmental: concept('ENVIRONMENTAL CONTEXT', 'demonstrate fit, scale, and desirability in a real setting', 'wide-to-medium environmental shot', 'architectural eye-level or considered three-quarter angle', '28–50 mm corrected environmental perspective', 'product anchors the scene and retains accurate scale', 'fully realized setting appropriate to category and function', 'motivated environmental key, balanced practical fill, controlled product accent', 'product sharp with readable layered environment', false, 'A person may appear only for natural scale or interaction, never as a forced lifestyle device.'),
  technical: concept('TECHNICAL DETAIL', 'communicate construction, engineering, controls, or material quality', 'close technical shot', 'precise angle revealing functional construction', '70–120 mm low-distortion detail perspective', 'controls, seams, connections, joints, or authentic construction are clearly organized', 'clean technical studio or restrained functional surface', 'raking key for edge definition, controlled fill, precise accents', 'critical functional details sharp', false, 'No human interaction unless a hand is essential to demonstrate scale or operation.'),
  motion: concept('MOTION / ACTION', 'communicate performance and energy in a natural operating context', 'dynamic environmental shot', 'low tracking or three-quarter action angle', '35–70 mm action-commercial perspective', 'clear product silhouette with directional movement and intentional negative space', 'credible category-specific operating environment', 'directional key and rim separation with controlled motion cues', 'product identity sharp; motion limited to environment or naturally moving components', false, 'Action must match the product function and preserve its geometry.'),
  editorial: concept('EDITORIAL STILL LIFE', 'create a distinctive aspirational campaign image', 'medium close still life', 'bold but physically plausible graphic angle', '50–100 mm editorial perspective', 'layered art-directed composition with strong hierarchy', 'category-appropriate materials, restrained color story, and no invented branding', 'sculpted directional key, deliberate negative fill, precise accents', 'product critically sharp with intentional depth separation', false, 'No forced human interaction.'),
  conceptCampaign: concept('CONCEPT CAMPAIGN', 'deliver a memorable final campaign key visual', 'wide-to-medium cinematic shot', 'bold category-appropriate hero angle', '35–70 mm cinematic-commercial perspective', 'single coherent scene with dramatic product hierarchy and campaign-scale negative space', 'distinct conceptual set built around the product function and category', 'cinematic directional key, deliberate shadow design, controlled accent color and rim separation', 'product critically sharp with cinematic layered depth', false, 'Human presence is optional only when physically useful; never overlay or float the product on a body.'),
};

const plans = {
  jewelry: ['lifestyleWear', 'luxuryDisplay', 'macro', 'conceptCampaign'],
  accessory: ['lifestyleWear', 'luxuryDisplay', 'macro', 'conceptCampaign'],
  clothing: ['lifestyleWear', 'luxuryDisplay', 'macro', 'conceptCampaign'],
  footwear: ['lifestyleWear', 'luxuryDisplay', 'technical', 'conceptCampaign'],
  food: ['foodHero', 'macro', 'serving', 'editorial'],
  beverage: ['hero', 'macro', 'serving', 'lifestyleHeld'],
  cosmetic: ['lifestyleHeld', 'luxuryDisplay', 'macro', 'conceptCampaign'],
  perfume: ['lifestyleHeld', 'luxuryDisplay', 'macro', 'conceptCampaign'],
  electronics: ['hero', 'technical', 'functionalUse', 'cleanCatalog'],
  appliance: ['cleanCatalog', 'technical', 'functionalUse', 'environmental'],
  furniture: ['cleanCatalog', 'environmental', 'macro', 'editorial'],
  decor: ['hero', 'environmental', 'macro', 'editorial'],
  automotive: ['hero', 'technical', 'motion', 'environmental'],
  tool: ['cleanCatalog', 'technical', 'functionalUse', 'hero'],
  toy: ['hero', 'macro', 'functionalUse', 'editorial'],
  packaging: ['cleanCatalog', 'macro', 'hero', 'editorial'],
  person: ['editorial', 'environmental', 'macro', 'hero'],
  environment: ['environmental', 'editorial', 'technical', 'hero'],
  general: ['hero', 'cleanCatalog', 'macro', 'editorial'],
};

const visibilityIntents = Object.freeze({
  hero: Object.freeze({ mode: 'hero_item', selection: 'one_or_primary_item', allowPartialVisibility: false }),
  heroSet: Object.freeze({ mode: 'full_set', selection: 'all_observed_items', allowPartialVisibility: false }),
  cleanCatalog: Object.freeze({ mode: 'full_set', selection: 'all_evidenced_items_when_physically_plausible', allowPartialVisibility: false }),
  macro: Object.freeze({ mode: 'macro_detail', selection: 'one_evidenced_detail', allowPartialVisibility: true }),
  lifestyleWear: Object.freeze({ mode: 'contextual_use', selection: 'plausibly_visible_items', allowPartialVisibility: true }),
  lifestyleHeld: Object.freeze({ mode: 'contextual_use', selection: 'plausibly_visible_items', allowPartialVisibility: true }),
  functionalUse: Object.freeze({ mode: 'contextual_use', selection: 'functionally_relevant_items', allowPartialVisibility: true }),
  serving: Object.freeze({ mode: 'contextual_use', selection: 'serving_relevant_items', allowPartialVisibility: true }),
  environmental: Object.freeze({ mode: 'contextual_use', selection: 'scene_relevant_items', allowPartialVisibility: true }),
  luxuryDisplay: Object.freeze({ mode: 'subset', selection: 'art_directed_subset', allowPartialVisibility: true }),
  packaging: Object.freeze({ mode: 'subset', selection: 'presentation_relevant_items', allowPartialVisibility: true }),
  foodHero: Object.freeze({ mode: 'hero_item', selection: 'one_or_primary_item', allowPartialVisibility: false }),
  technical: Object.freeze({ mode: 'macro_detail', selection: 'functional_detail', allowPartialVisibility: true }),
  motion: Object.freeze({ mode: 'hero_item', selection: 'one_or_primary_item', allowPartialVisibility: true }),
  editorial: Object.freeze({ mode: 'subset', selection: 'art_directed_subset', allowPartialVisibility: true }),
  conceptCampaign: Object.freeze({ mode: 'hero_item', selection: 'campaign_focal_item', allowPartialVisibility: true }),
});

function requestedVisibilityModes(prompt) {
  const modes = [];
  if (/\b(full set|complete set|all (?:items|pieces|products)|conjunto completo|todas? (?:as )?(?:pe[cç]as|unidades|produtos))\b/i.test(prompt)) {
    modes.push('full_set');
  }
  if (/\b(subset|selection|selected pieces|subconjunto|sele[cç][aã]o de pe[cç]as)\b/i.test(prompt)) {
    modes.push('subset');
  }
  if (/\b(macro|close[- ]?up|details?|detalhes?|aproxima[cç][aã]o)\b/i.test(prompt)) {
    modes.push('macro_detail');
  }
  if (/\b(model|person|wearing|worn|using|holding|applied|modelo|pessoa|usando|vestindo|segurando|aplicando)\b/i.test(prompt)) {
    modes.push('contextual_use');
  }
  if (/\b(hero|principal|destaque)\b/i.test(prompt)) modes.push('hero_item');
  return Object.freeze([...new Set(modes)]);
}

function isClearlyObservedMultiProductSet(canonicalIdentity) {
  const inventory = canonicalIdentity?.sourceInventory;
  if (inventory?.state !== 'known' || inventory.items.length === 0) return false;
  let total = 0;
  for (const item of inventory.items) {
    if (item.quantity.state !== 'known') return false;
    total += item.quantity.value;
  }
  return total > 1;
}

function hasStructuredObservedFeature(canonicalIdentity) {
  return canonicalIdentity?.sourceInventory?.items.some((item) =>
    item.observedFeatures.length > 0) === true;
}

function visibilityIntentFor(key, canonicalIdentity) {
  const intent = visibilityIntents[key] ?? visibilityIntents.hero;
  if ((key === 'macro' || key === 'technical') &&
      !hasStructuredObservedFeature(canonicalIdentity)) {
    return Object.freeze({
      ...intent,
      selection: 'reference_visible_detail_or_safe_close_view',
    });
  }
  return intent;
}

function adaptiveConceptKeys(category, understanding, canonicalIdentity) {
  const selected = [...(plans[category] ?? plans.general)];
  if (understanding.requestedVisibilityModes.includes('contextual_use') &&
      !selected.some((key) => ['lifestyleWear', 'lifestyleHeld', 'functionalUse', 'serving', 'environmental'].includes(key))) {
    const safelyWearable = ['jewelry', 'accessory', 'clothing', 'footwear'].includes(category);
    const safelyHeld = ['perfume', 'cosmetic', 'beverage'].includes(category);
    selected[3] = safelyWearable ? 'lifestyleWear' : safelyHeld ? 'lifestyleHeld' : 'functionalUse';
  }
  if (understanding.requestedVisibilityModes.includes('macro_detail') && !selected.includes('macro')) {
    selected[2] = 'macro';
  }
  if (isClearlyObservedMultiProductSet(canonicalIdentity) && !selected.includes('heroSet')) {
    const replaceable = selected.findIndex((key) =>
      ['luxuryDisplay', 'cleanCatalog', 'hero', 'editorial', 'conceptCampaign'].includes(key));
    selected[replaceable >= 0 ? replaceable : 0] = 'heroSet';
  }
  return selected;
}

export class ProductPhotoConceptPlanner {
  understand({ productCategory, prompt = '' }) {
    const declared = categoryAliases.get(String(productCategory ?? '').toLowerCase());
    const inferred = keywordCategories.find(([, pattern]) => pattern.test(prompt))?.[0];
    const category = declared && declared !== 'general' ? declared : inferred ?? declared ?? 'general';
    return Object.freeze({
      category,
      source: declared && declared !== 'general' ? 'declared_category' : inferred ? 'brief_inference' : 'safe_fallback',
      materialDirection: materialDirections[category] ?? materialDirections.general,
      preservation: category === 'jewelry' ? 'jewelry_specific_best_effort' : 'category_best_effort',
      allowCollage: /\b(collage|moodboard|contact sheet|split[ -]?screen|image grid|multi[ -]?panel|colagem|painel de refer[eê]ncias|tela dividida)\b/i.test(prompt),
      allowText: /\b(add|include|write|insert|adicionar|incluir|escrever|inserir)\b.{0,40}\b(text|title|headline|caption|slogan|lettering|texto|t[ií]tulo|legenda)\b/i.test(prompt),
      requestedVisibilityModes: requestedVisibilityModes(prompt),
    });
  }

  plan(input) {
    const understanding = this.understand(input);
    const selected = adaptiveConceptKeys(
      understanding.category,
      understanding,
      input.canonicalIdentity,
    );
    const concepts = Object.freeze(selected.map((key) => Object.freeze({
      ...archetypes[key],
      visibilityIntent: visibilityIntentFor(key, input.canonicalIdentity),
    })));
    assertConceptDiversity(concepts);
    return Object.freeze({
      understanding,
      concepts,
    });
  }
}

export function assertConceptDiversity(concepts) {
  if (!Array.isArray(concepts) || concepts.length !== 4 ||
      new Set(concepts.map(({ name }) => name)).size !== 4) {
    throw new Error('INVALID_CREATIVE_DIRECTION_MATRIX');
  }
  const dimensions = [
    'objective', 'cameraDistance', 'composition', 'environment', 'lighting',
    'humanPresent', 'interaction',
  ];
  for (let left = 0; left < concepts.length; left += 1) {
    for (let right = left + 1; right < concepts.length; right += 1) {
      const changes = dimensions.filter((field) => concepts[left][field] !== concepts[right][field]);
      if (changes.length < 5) throw new Error('INSUFFICIENT_CREATIVE_DIVERSITY');
    }
  }
}
