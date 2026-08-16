const objectiveDirections = {
  'Estúdio Premium': 'Create a refined premium studio scene with controlled professional lighting and a polished advertising finish.',
  Lifestyle: 'Place the subject in a believable aspirational lifestyle scene with natural commercial storytelling.',
  Luxo: 'Use an understated luxury art direction, premium materials, elegant lighting, and sophisticated composition.',
  'E-commerce': 'Create a clean e-commerce presentation with accurate product visibility, balanced light, and minimal distraction.',
  Cinematográfico: 'Use cinematic lighting, dimensional depth, deliberate framing, and realistic atmosphere suitable for advertising.',
  'Social Media': 'Create an immediate, polished social-media composition with a clear focal point and premium commercial appeal.',
};

const variationDirections = [
  'Use a balanced hero composition with precise studio lighting.',
  'Use a distinct camera framing with soft directional light and refined depth.',
  'Use a different environment composition with realistic premium materials.',
  'Use a bold but credible advertising art direction with layered depth.',
];

const preservationInstructions = {
  preserveProduct: 'Preserve the exact identity of the reference product.',
  preservePackaging: 'Preserve the packaging design and physical construction.',
  preserveLabel: 'Preserve the label placement and appearance.',
  preservePrintedText: 'Preserve all printed text exactly; do not rewrite or invent text.',
  preserveLogo: 'Preserve the original logo and brand marks.',
  preserveColors: 'Preserve the exact brand and product colors.',
  preserveProportions: 'Preserve shape, geometry, dimensions, and proportions.',
  preserveFace: 'Preserve the person identity and facial characteristics.',
  preserveClothing: 'Preserve the original clothing design, color, and fit.',
  changeBackgroundOnly: 'Change only the background; leave the foreground subject unchanged.',
  changeLightingOnly: 'Change only the lighting; leave subject and scene geometry unchanged.',
  changeSceneOnly: 'Change only the surrounding scene; do not redesign the subject.',
};

export class ProductPhotoPromptBuilder {
  build({ prompt, preservation = {}, artisticDirection, variationIndex }) {
    const objective = objectiveDirections[artisticDirection] ??
      'Create a premium, realistic commercial advertising image.';
    const protections = Object.entries(preservationInstructions)
      .filter(([key]) => preservation[key] === true)
      .map(([, instruction]) => instruction);
    return [
      prompt.trim(),
      objective,
      protections.join(' '),
      'Do not redesign the subject or invent new product details.',
      'Alter only the requested environment, lighting, framing, or composition.',
      variationDirections[variationIndex],
      'Return only the finished advertising image without instructions, annotations, or explanatory text.',
    ].filter(Boolean).join(' ');
  }
}
