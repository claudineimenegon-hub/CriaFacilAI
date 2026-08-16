const objectiveDirections = {
  'Estúdio Premium': 'Maintain a refined premium studio sensibility.',
  Lifestyle: 'Maintain believable aspirational commercial storytelling.',
  Luxo: 'Maintain understated luxury and sophisticated material choices.',
  'E-commerce': 'Maintain clean commercial readability and accurate product visibility.',
  Cinematográfico: 'Maintain dimensional cinematic atmosphere without obscuring the product.',
  'Social Media': 'Maintain an immediate focal point suitable for a polished social campaign.',
};

const preservationInstructions = {
  preserveProduct: 'Preserve the exact identity of the product in input image 0.',
  preservePackaging: 'Preserve the packaging design and physical construction.',
  preserveLabel: 'Preserve the label placement, proportions, and appearance.',
  preservePrintedText: 'Preserve printed text as faithfully as the model permits; never rewrite or invent it.',
  preserveLogo: 'Preserve the original logo and brand marks; never replace or redesign them.',
  preserveColors: 'Preserve the product, material, and brand colors accurately.',
  preserveProportions: 'Preserve shape, geometry, dimensions, and proportions.',
  preserveFace: 'Preserve the person identity and facial characteristics.',
  preserveClothing: 'Preserve the original clothing design, color, and fit.',
  changeBackgroundOnly: 'Change only the background; keep the foreground product unchanged.',
  changeLightingOnly: 'Change only the lighting; keep product and scene geometry unchanged.',
  changeSceneOnly: 'Change only the surrounding scene; do not redesign the product.',
};

const lifestyleDirections = {
  jewelry: 'Show the jewelry being worn naturally by an appropriate model, with plausible scale, placement, perspective, and physical integration.',
  clothing: 'Show the clothing worn naturally by an appropriate model while preserving its design, color, construction, and fit.',
  cosmetics: 'Place the cosmetic in an elegant beauty-use context, using a person only when physically appropriate to the product.',
  beverages: 'Show the beverage in a believable serving or consumption context with realistic glassware, scale, and handling.',
  food: 'Show the food in a refined serving or dining context with believable presentation and scale.',
  electronics: 'Show the product in a realistic functional workspace or home context without adding a person unnecessarily.',
  automotive: 'Show the vehicle in a credible premium driving or architectural context with realistic scale and perspective.',
  person: 'Create a sophisticated editorial lifestyle portrait while preserving identity, face, clothing, and proportions when requested.',
  environment: 'Show the environment in plausible commercial use without inserting people unless they are essential for scale or function.',
  general: 'Place the product in a plausible functional context; do not insert a person unless human use is inherent to the product.',
};

const jewelryPreservation = [
  'For jewelry, preserve the number and arrangement of principal components, structural design, central stone, stone color, visible stone distribution, metal, setting, symmetry, and proportions as faithfully as the model permits.',
  'Do not add, remove, merge, or relocate visible stones or redesign the setting.',
];

const qualityDirection = [
  'Use commercial product photography, realistic materials, controlled highlights, accurate reflections, microcontrast, fine surface detail, dimensional lighting, neutral white balance, deep but detailed blacks, natural depth, and professional optical rendering.',
  'Avoid flat lighting, washed-out appearance, milky blacks, excessive bloom, plastic-looking materials, generic AI aesthetics, oversmoothing, unnecessary glow, blown highlights, and unrealistic reflections.',
].join(' ');

const conceptBriefings = [
  ({ productCategory }) => [
    'CONCEPT: PRODUCT HERO / PREMIUM CATALOG.',
    'Create a clean, highly faithful luxury catalog photograph with the complete product clearly visible, excellent product-background separation, controlled professional lighting, realistic shadows, neutral accurate color, high sharpness, and no competing elements.',
    productCategory === 'jewelry'
      ? 'If input image 0 contains a pair or set, show the complete pair or set with the same component count and arrangement.'
      : 'Keep the complete product clearly readable and commercially accurate.',
    'For this concept, product fidelity has higher priority than creativity.',
  ],
  ({ productCategory }) => [
    'CONCEPT: LIFESTYLE / PRODUCT IN USE.',
    lifestyleDirections[productCategory] ?? lifestyleDirections.general,
    'Create sophisticated editorial advertising with cinematic but controlled lighting, a background with depth, coherent perspective, plausible scale, and physically believable integration.',
    'The authoritative product must remain immediately recognizable as the same product from input image 0.',
  ],
  ({ productCategory }) => [
    'CONCEPT: LUXURY DISPLAY / PREMIUM COMMERCIAL PRESENTATION.',
    productCategory === 'jewelry'
      ? 'Present the jewelry in a premium jewelry box or refined display using velvet, glass, marble, or another restrained luxury material.'
      : 'Present the product on a premium pedestal, display, architectural surface, glass, marble, velvet, or restrained boutique setting appropriate to its category.',
    'Use a minimal commercial composition that is clearly different from the catalog and lifestyle concepts, keeps the product fully visible, and communicates high value.',
  ],
  ({ productCategory }) => [
    'CONCEPT: EXTREME MACRO / DETAIL HERO.',
    'Use an extremely close macro-lens composition focused only on real visible manufacturing details from input image 0: microtexture, materials, surfaces, controlled reflections, finish, and photographic depth of field.',
    productCategory === 'jewelry'
      ? 'Emphasize the real central stone, facets, setting, metal, secondary stones, microtexture, controlled specular reflections, and finish without inventing or changing details.'
      : 'Reveal authentic surface detail and construction without inventing features that are not visible in input image 0.',
    'Macro does not authorize redesign: every visible detail must remain coherent with input image 0.',
  ],
];

export class ProductPhotoPromptBuilder {
  build({
    prompt,
    preservation = {},
    artisticDirection,
    productCategory = 'general',
    variationIndex,
  }) {
    const concept = conceptBriefings[variationIndex];
    if (!concept) throw new RangeError('Unsupported product photo concept.');
    const protections = Object.entries(preservationInstructions)
      .filter(([key]) => preservation[key] === true)
      .map(([, instruction]) => instruction);
    const objective = objectiveDirections[artisticDirection] ??
      'Maintain a realistic premium commercial advertising finish.';
    return [
      'INPUT IMAGE 0 IS THE AUTHORITATIVE PRODUCT REFERENCE.',
      'PRIORITY ORDER: PRODUCT IDENTITY > PRODUCT GEOMETRY > MATERIALS AND COLORS > DISTINCTIVE DETAILS > ART DIRECTION > BACKGROUND.',
      ...protections,
      ...(productCategory === 'jewelry' ? jewelryPreservation : []),
      'Do not deliberately redesign the product to fit the scene. Creativity must affect mainly the environment, lighting, context, camera framing, and art direction.',
      `USER BRIEF: ${prompt.trim()}`,
      objective,
      ...concept({ productCategory }),
      qualityDirection,
      'Return only the finished advertising photograph without instructions, annotations, labels, or explanatory text.',
    ].filter(Boolean).join(' ');
  }
}
