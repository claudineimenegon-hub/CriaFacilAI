// Category profiles for the Creative Director V3. A profile tells the director what kind of
// product it is working on, how people really use it, which scenes make sense for it and what
// to protect. The default profile (jewelry and every category without a profile) keeps the
// original generic scene and arrangement pools untouched.
//
// Resolution order: an explicit profile category chosen by the user wins; otherwise the
// functional types identified in the source photo decide; otherwise the default profile.

export const CATEGORY_PROFILES = Object.freeze({
  clothing: Object.freeze({
    label: 'clothing and apparel',
    usage: 'Garments are worn on a body. Show them worn by a human model or by a mannequin, with natural fit, drape, seams and fabric movement, or neatly styled flat, hung or folded as a retail display. Keep prints, patterns, buttons, zippers, labels and cut exactly as in the source photo.',
    care: 'Preserve cut, length, neckline, pattern placement, fabric texture and color. Never invent logos, text or extra garments. Show fabric honestly: how it folds, hangs and catches light.',
    scenes: [
      'a bright boutique with wooden racks, hangers and soft daylight',
      'an urban street with colorful walls, crosswalks and city life',
      'a sunlit terrace or rooftop with potted plants and a warm skyline',
      'a minimalist studio with a colored paper backdrop and a single prop',
      'a seaside promenade with sand, breeze and golden light',
      'a cozy apartment with a bed, plants, books and morning light',
      'a garden or park path with leaves, flowers and dappled sunlight',
      'a stylish cafe or terrace table with coffee, magazines and a tote bag',
      'a market or festival setting with fabrics, flowers and colorful stalls',
      'an architectural corridor with arches, shadows and a clean modern look',
    ],
    arrangements: [
      'a full-body model pose in motion', 'a relaxed seated or leaning pose', 'a walking pose with natural fabric movement',
      'a mannequin styled in a boutique window', 'a flat lay with accessories arranged around the garment',
      'the garment hung on a wooden hanger against a wall or door', 'neatly folded stacks with one piece unfolded on top',
      'a close view of fabric texture with a styled model detail', 'layered outfit styling across the frame',
    ],
  }),
  footwear: Object.freeze({
    label: 'footwear',
    usage: 'Shoes are worn on feet and walk on real ground. Show them worn by a model (feet and legs, or full body) in motion, or as a pair displayed on a surface, a shelf or a pedestal, always as a coherent pair with correct left and right.',
    care: 'Preserve shape, sole profile, stitching, materials, laces, hardware and color. Keep the pair coherent (left and right, same model), with believable proportions and ground contact. Never invent logos or text.',
    scenes: [
      'an urban street with colorful walls, curbs and morning light',
      'a clean studio with a colored backdrop and a geometric platform',
      'a park path or trail with leaves, grass and soft sunlight',
      'a sports court, track or gym with energetic color',
      'a boutique shelf wall with a neat display and warm lights',
      'a beach boardwalk with sand, wooden planks and sea light',
      'a stairway or architectural steps with strong shadows',
      'a cozy entryway with a rug, plants, a bench and natural light',
      'a rainy city street with wet reflections and neon color',
      'a market or festival setting with colorful stalls',
    ],
    arrangements: [
      'a model mid-step with the shoes in sharp focus', 'a seated model with the shoes crossed in the foreground',
      'the pair side by side, one tilted to show the sole', 'one shoe forward with the other behind in soft focus',
      'a dynamic diagonal of the pair on steps', 'the pair on a pedestal at eye level', 'a low-angle hero view with a blurred background',
      'a top-down view of the pair with props around', 'a floating pair with soft shadows',
    ],
  }),
  watches: Object.freeze({
    label: 'watches',
    usage: 'Watches are worn on the wrist, or displayed on a cushion, stand or in an open box. When a person or mannequin appears the watch is on the wrist with a natural gesture and the face clearly readable and facing the viewer.',
    care: 'Preserve case shape, dial layout, hands, indices, crown, strap or bracelet, materials and color exactly. Keep any text, brand name and numerals as in the source photo and never invent or alter them. Keep the dial sharp, readable and free of distracting reflections.',
    scenes: [
      'a modern desk with a leather notebook, pen and warm lamp light',
      'a rocky shore or cliff with sea mist and dramatic sky',
      'a luxury lounge with dark wood, leather and soft spotlights',
      'a sunlit studio with a colored backdrop and a sculptural stand',
      'a city rooftop at golden hour with a skyline',
      'a workshop table with fine tools, gears and warm light',
      'a forest trail with moss, leaves and dappled light',
      'a car interior or garage with leather and metal details',
      'a marble or stone surface with architectural shadows and greenery',
      'a gift box with velvet, ribbon and soft light',
    ],
    arrangements: [
      'a wrist in a natural gesture with the dial facing the camera', 'a hand adjusting a cuff in a close view',
      'the watch resting on a cushion or stand', 'a watch standing upright on its strap in a clean pose',
      'a diagonal hero view with strong depth of field', 'the watch half emerging from an open box',
      'a macro of the dial with a soft background', 'two angles composed in one scene with strong shadows',
    ],
  }),
  fragrance: Object.freeze({
    label: 'perfume and fragrance',
    usage: 'Perfume bottles are held in a hand, sprayed on skin, or displayed on a surface with their box and elements that evoke the scent (flowers, fruit, spices, woods). When a person appears, the bottle is held naturally or sits on a vanity near them.',
    care: 'Preserve bottle shape, glass, liquid color, cap, label, brand text, typography and proportions exactly. Never invent, change or blur the text and logo on the bottle or box. Render glass, liquid and reflections cleanly and realistically.',
    scenes: [
      'a garden of the flowers that evoke the scent with dew and soft light',
      'a vanity table with a mirror, brushes, silk and warm lamp light',
      'a water scene with ripples, petals and soft reflections',
      'a studio with a colored gradient backdrop and glass geometric shapes',
      'a luxurious bathroom or dressing room with marble, towels and candles',
      'a fruit, spice or wood still life that evokes the scent notes',
      'a sunlit window with sheer curtains, flowers and long shadows',
      'a velvet or silk drape with pearls and ribbon',
      'a seaside or desert dawn scene with mist and warm light',
      'a gift setting with the box, ribbon, tissue paper and dried flowers',
    ],
    arrangements: [
      'the bottle centered with ingredients scattered around', 'the bottle held in a hand against a soft backdrop',
      'the bottle with a mist of spray caught in light', 'two or three heights with the box behind',
      'the bottle reflected in a mirror or water', 'the bottle partly framed by flowers or leaves',
      'the bottle on a pedestal with strong side light', 'a diagonal composition with ribbon or fabric flowing',
    ],
  }),
  tools: Object.freeze({
    label: 'tools',
    usage: 'Tools are held and used with hands in realistic work: gripping, tightening, cutting or measuring on a real material. Show correct grip and a plausible task, or lay the tool out on a bench with related accessories. Show safe, believable use.',
    care: 'Preserve shape, size proportions, materials, grip, markings, brand text and color exactly. Keep mechanical parts believable and never invent extra components, text or logos. Hands must hold the tool the way it is really used.',
    scenes: [
      'a well-lit workshop bench with wood shavings, clamps and warm light',
      'a construction or renovation site with fresh materials and daylight',
      'a garage with a tool wall, metal shelves and a car in the background',
      'a clean studio with a bold colored backdrop and a geometric platform',
      'a garden or yard with wood, soil and plants for outdoor work',
      'a rustic wooden table with a leather apron, nails and sawdust',
      'a modern home project with paint, planks and a ladder',
      'a toolbox open on a workbench with tidy compartments',
      'a metalwork scene with sparks, steel plates and dramatic light',
      'a maker studio with plans, measuring tools and materials',
    ],
    arrangements: [
      'hands using the tool in a real task', 'the tool in a professional hand grip in a close view',
      'a neat knolling layout of the tool and its accessories', 'the tool leaning on a bench with the work behind',
      'a diagonal hero view with strong depth of field', 'the tool half emerging from a toolbox',
      'a before and after work scene with the tool in the center', 'a dynamic angle with materials flying in the air',
    ],
  }),
  homeware: Object.freeze({
    label: 'household utensils and homeware',
    usage: 'Household items are used at home: cookware on a stove or counter, tableware on a set table, containers and organizers in a pantry or shelf. Show them in a plausible use with food, drinks or home items that fit their function.',
    care: 'Preserve shape, size proportions, materials, finish, handles, lids, patterns and color exactly. Keep realistic scale relative to hands and surroundings. Never invent logos, text or extra parts.',
    scenes: [
      'a bright modern kitchen counter with fresh ingredients and daylight',
      'a set dining table with flowers, linen and plates for guests',
      'a cozy rustic kitchen with wooden boards, herbs and warm light',
      'a studio with a colorful backdrop and geometric platforms',
      'a pantry shelf with neatly arranged jars, baskets and plants',
      'a sunny breakfast table with fruit, bread and coffee',
      'a garden table outdoors with greenery and soft shade',
      'a farmers market style display with produce and cloth',
      'a stove top scene with steam, a pan and fresh food in preparation',
      'a minimalist home shelf with ceramics, plants and soft light',
    ],
    arrangements: [
      'the item in use with food in a real preparation moment', 'a hand holding or serving with the item',
      'a neat group of the item with matching pieces', 'the item centered with ingredients around it',
      'a diagonal flow of items across a table', 'stacked and nested pieces in a tidy arrangement',
      'a top-down view with surrounding props', 'the item at eye level on a shelf with soft background',
    ],
  }),
});

const INFERENCE_PATTERNS = Object.freeze([
  ['footwear', /\b(shoes?|sneakers?|boots?|sandals?|slippers?|loafers?|heels?|footwear|cal[cç]ados?|t[eê]nis|sapatos?|botas?|chinelos?)\b/i],
  ['watches', /\b(watch|watches|timepiece|wristwatch|rel[oó]gios?)\b/i],
  ['fragrance', /\b(perfumes?|fragrances?|colognes?|eau de|parfum|deodorants?)\b/i],
  ['clothing', /\b(shirts?|t-shirts?|dress(es)?|jackets?|coats?|pants|trousers|jeans|skirts?|blouses?|sweaters?|hoodies?|garments?|apparel|clothing|camisas?|vestidos?|jaquetas?|casacos?|cal[cç]as?|saias?|blusas?|roupas?)\b/i],
  ['tools', /\b(tools?|drills?|hammers?|wrenche?s?|saws?|pliers?|screwdrivers?|ferramentas?|furadeiras?|martelos?)\b/i],
  ['homeware', /\b(cookware|pans?|pots?|kettles?|utensils?|cutlery|tableware|plates?|bowls?|mugs?|cups?|jars?|kitchen|appliances?|panelas?|frigideiras?|talheres?|pratos?|canecas?|copos?|utens[ií]lios?|cozinha)\b/i],
]);

const EXPLICIT_CATEGORIES = new Set(['clothing', 'footwear', 'watches', 'fragrance', 'tools', 'homeware']);
// Jewelry and every other category stay on the default profile, so existing behavior is unchanged.
const DEFAULT_CATEGORIES_THAT_SKIP_INFERENCE = new Set(['jewelry']);

export function resolveCategoryProfile(productIdentity) {
  const category = productIdentity?.category;
  if (EXPLICIT_CATEGORIES.has(category)) return { key: category, ...CATEGORY_PROFILES[category] };
  if (DEFAULT_CATEGORIES_THAT_SKIP_INFERENCE.has(category)) return null;
  const types = (productIdentity?.items ?? []).map(({ functionalType }) => String(functionalType ?? '')).join(' ');
  for (const [key, pattern] of INFERENCE_PATTERNS) {
    if (pattern.test(types)) return { key, ...CATEGORY_PROFILES[key] };
  }
  return null;
}

export function formatCategoryProfileBlock(profile) {
  if (!profile) return '';
  return [
    `CATEGORY PROFILE (${profile.label}): identify the product from the source photo and keep the whole campaign coherent with this kind of product.`,
    `- Real use: ${profile.usage}`,
    `- Protect: ${profile.care}`,
    '- Scenes and arrangements for this category come from the seed below; they fit this product type, so build on them.',
  ].join('\n');
}
