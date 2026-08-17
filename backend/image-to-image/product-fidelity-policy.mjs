export const GLOBAL_PRODUCT_FIDELITY_RULES = Object.freeze([
  'Preserve product identity and functional type across every scene or frame.',
  'Never convert one object or product into another functional type to fit a composition.',
  'Never invent or arbitrarily duplicate source units.',
  'Source inventory remains stable; framing, occlusion, or selection changes only visibility.',
  'A justified subset or partial view is allowed without changing source identity.',
  'Never force impossible placement or anatomy merely to show every source item.',
]);

const categoryRules = Object.freeze({
  jewelry: Object.freeze([
    'Keep evidenced count/type/geometry, metal tone, gem color/position, setting/symmetry/facets; wear at correct anatomy, never overlay/float on face/eyes/body.',
  ]),
  perfume: Object.freeze([
    'Preserve evidenced bottle geometry, cap, liquid color, label, logo, and glass behavior.',
  ]),
  electronics: Object.freeze([
    'Preserve evidenced geometry, camera count, controls, ports, screen, connectors, and finish.',
  ]),
  food: Object.freeze([
    'Preserve the advertised food identity, natural texture, form, freshness, and serving plausibility.',
  ]),
  beverage: Object.freeze([
    'Preserve evidenced container geometry, closure, liquid color, label, logo, and material.',
  ]),
  clothing: Object.freeze([
    'Preserve evidenced garment construction, silhouette, seams, textile, color, and fit.',
  ]),
  footwear: Object.freeze([
    'Preserve evidenced footwear type, silhouette, sole, stitching, materials, color, and pair relation.',
  ]),
});

export function createProductFidelityPolicy({ category = 'general' } = {}) {
  return Object.freeze({
    globalRules: GLOBAL_PRODUCT_FIDELITY_RULES,
    category,
    categoryRules: categoryRules[category] ?? Object.freeze([]),
  });
}

export function summarizeProductFidelityPolicy(policy) {
  const global = 'preserve identity/function; no semantic conversion or invented/duplicate units; stable inventory, variable visibility; no forced placement/anatomy';
  const specific = policy.categoryRules.length > 0
    ? ` CATEGORY (${policy.category}): ${policy.categoryRules.join(' ')}`
    : '';
  return `IDENTITY POLICY: ${global}.${specific}`;
}
