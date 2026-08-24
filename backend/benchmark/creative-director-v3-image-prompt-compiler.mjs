function requireText(value, field) {
  if (typeof value !== 'string' || value.trim().length < 2) throw new TypeError(`Invalid V3 compiler field: ${field}`);
  return value.trim();
}

function itemLine(item, canonical) {
  const identity = canonical.get(item.itemId);
  if (!identity) throw new TypeError('V3 compiler received an unknown canonical item ID.');
  if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity !== identity.quantity) {
    throw new TypeError('V3 compiler received a quantity that violates Product Identity.');
  }
  return `- ${identity.id}: exactly ${item.quantity} unit${item.quantity === 1 ? '' : 's'}; canonical functional type: ${identity.functionalType}.`;
}

function relationshipLines(brief, productIdentity, selectedIds) {
  const lines = [];
  for (const relationship of productIdentity.relationships) {
    const selectedMembers = relationship.itemIds.filter((id) => selectedIds.has(id));
    if (!selectedMembers.length) continue;
    if (/pair|atomic/i.test(relationship.type)) {
      if (selectedMembers.length !== relationship.itemIds.length || brief.visibilityIntent.pairPolicy !== 'preserve_pair') {
        throw new TypeError('V3 compiler refuses to compile a partial atomic relationship.');
      }
      const quantity = relationship.itemIds.reduce((sum, id) => {
        const item = productIdentity.items.find((candidate) => candidate.id === id);
        return sum + item.quantity;
      }, 0);
      lines.push(
        `- Atomic relationship ${relationship.type}: exact canonical IDs [${relationship.itemIds.join(', ')}].`,
        `  The canonical relationship consists of exactly ${quantity} matched unit${quantity === 1 ? '' : 's'}.`,
        '  Preserve the complete matched canonical design. Do not merge units, create an additional unit, split the relationship, or convert any unit into another product type.',
      );
    } else {
      lines.push(`- Known global relationship ${relationship.type}: [${relationship.itemIds.join(', ')}]. Preserve this relationship without inventing or transforming members; only the proposal-selected members are visible.`);
    }
  }
  return lines.length ? lines : ['- No selected atomic relationship requires an additional execution lock.'];
}

function section(label, values) {
  return [label, ...values].join('\n');
}

function onBodyWearableFidelity(brief, productSemantics) {
  const presence = brief.humanInteraction.presence ??
    (brief.humanInteraction.mode === 'required' ? 'required' : 'optional');
  const applies = productSemantics.affordances.includes('wearable') &&
    ['recommended', 'required'].includes(presence) &&
    brief.humanInteraction.mode !== 'forbidden';
  if (!applies) return null;
  return section('D2. ON-BODY WEARABLE PRODUCT IDENTITY LOCK', [
    'The person, pose and body placement are presentation context only. The source reference remains the authoritative visual identity of the product being worn.',
    'Preserve the exact source-visible silhouette, geometry, proportions, construction, materials, colors, components, patterns, distinctive details and canonical quantity while the product is on the body.',
    'Adapt anatomy, pose, camera and physically plausible placement around the unchanged product. Never redesign, reshape, simplify, stretch, recolor, add, remove or substitute product components to make them fit the person.',
    'Keep attachment, orientation, scale and contact physically credible without sacrificing product detail. Maintain natural human appearance, lighting and scene creativity outside the locked product identity.',
  ]);
}

function humanProductInteractionFidelity(brief) {
  const presence = brief.humanInteraction.presence ??
    (brief.humanInteraction.mode === 'required' ? 'required'
      : brief.humanInteraction.mode === 'forbidden' ? 'none' : 'optional');
  if (presence === 'none' || brief.humanInteraction.mode === 'forbidden') return null;
  return section('D3. HUMAN–PRODUCT INTERACTION FIDELITY', [
    'Human interaction may change pose, perspective, partial occlusion, physical contact and apparent lighting only; preserve the referenced product identity, geometry, component structure, material/color placement and physically plausible scale.',
    'Do not transfer decorative or structural elements between product components. When multiple referenced products appear at a comparable depth, preserve their plausible relative physical scale while keeping pose, scene, lighting, camera and composition creatively free.',
  ]);
}

export function compileCreativeDirectorV3ImagePrompt({ brief, productIdentity, productSemantics, userIntent }) {
  if (!brief || !productIdentity || !productSemantics) throw new TypeError('Validated V3 brief and canonical context are required.');
  const canonical = new Map(productIdentity.items.map((item) => [item.id, item]));
  const required = brief.productPresentation.requiredVisibleItems;
  const optional = brief.productPresentation.optionalVisibleItems;
  const selectedIds = new Set([...required, ...optional].map(({ itemId }) => itemId));
  const omitted = productIdentity.items.filter(({ id }) => !selectedIds.has(id));
  const interactionFidelity = humanProductInteractionFidelity(brief);
  const prompt = [
    section('A. PRODUCT IDENTITY — HIGHEST PRIORITY', [
      'The supplied source photograph is the canonical visual reference for the product.',
      'Use it to preserve geometry, design, observable materials, colors, finish and distinctive details—not its original photographic composition.',
      `Canonical category: ${requireText(productIdentity.category, 'productIdentity.category')}.`,
      ...productIdentity.items.map(({ id, functionalType, quantity }) => `- ${id}: canonical functional type ${functionalType}; global locked quantity ${quantity}.`),
      ...(productIdentity.observedFeatures.length ? [`Observed identity facts: ${productIdentity.observedFeatures.join('; ')}.`] : []),
      'Preserve the identity of every selected canonical item. Never transform one canonical item into another product type, invent additional products, duplicate beyond visible quantity, fuse separate products, redesign the product, or replace it with a similar substitute.',
      'Product identity has priority over scene creativity.',
    ]),
    section('A2. SOURCE-VISIBLE PRODUCT FIDELITY — HARD CONSTRAINT', [
      'CREATIVE DIRECTION CONTROLS THE PHOTOGRAPH. THE SOURCE IMAGE CONTROLS THE PRODUCT.',
      'The source image is the visual authority for every product characteristic that is actually visible and identifiable in the reference.',
      'Faithfully preserve the source-visible silhouette and geometry, relative proportions, component shapes and construction, material identity, original color family and characteristic hues, visible patterns, textures, settings, attachments, distinctive details, and relative placement of visible components.',
      'Depict the same physical product represented by the source reference—not a similar product or a newly designed interpretation. Source-visible features must not be redesigned, simplified, embellished, substituted or reinterpreted.',
      'VISIBLE SOURCE FEATURES ARE HARD EVIDENCE. UNSEEN FEATURES ARE NOT CREATIVE LICENSE.',
      'When an unseen region must be completed for physical plausibility, use the most conservative visually compatible continuation: remain consistent with visible geometry, materials and construction, introduce no distinctive decoration, and add no functional component unless canonical Product Identity requires it.',
      'An inferred hidden feature must never override or alter a visible source feature.',
    ]),
    section('A3. OBSERVED COMPONENT-ATTRIBUTE BINDING', [
      'When the source clearly distinguishes a product component or region, keep each visibly evidenced color, material, texture, finish, pattern, decorative detail and structural detail associated with that same component or region.',
      'Do not migrate, copy, swap or spread an observed attribute from one component or region onto another. Preserve the source-visible component hierarchy without requiring pixel-perfect reconstruction.',
      'Apply this lock only to confident source-visible associations. Do not count indeterminate micro-details, invent hidden components, infer unseen geometry or promote ambiguous evidence into a hard constraint.',
      'Natural changes from lighting, reflection, exposure and color temperature remain allowed when the intrinsic material and characteristic color association stays recognizable. Scene, camera, composition and art direction remain creatively free.',
    ]),
    section('B. VISIBLE INVENTORY FOR THIS PROPOSAL', [
      'VISIBLE IN THIS IMAGE — REQUIRED:',
      ...required.map((item) => itemLine(item, canonical)),
      ...(optional.length ? ['OPTIONAL ONLY IF THE VALIDATED BRIEF REQUESTS IT:', ...optional.map((item) => itemLine(item, canonical))] : ['OPTIONAL VISIBLE ITEMS: none.']),
      'NOT VISIBLE IN THIS IMAGE:',
      ...(omitted.length ? omitted.map(({ id }) => `- ${id}. Do not add, imply, substitute or transform another item into this omitted item.`) : ['- none; the validated proposal selected the full canonical inventory.']),
      `Visibility mode: ${brief.visibilityIntent.mode}. Presentation mode: ${brief.productPresentation.presentationMode}.`,
      'Omission applies only to this proposal and does not change global Product Identity.',
      'Product fidelity applies only to the items selected by this proposal and must not restore omitted canonical items.',
    ]),
    section('C. PROTECTED RELATIONSHIPS', relationshipLines(brief, productIdentity, selectedIds)),
    section('C2. PRODUCT SCALE LOCK', [
      'Preserve credible physical scale, internal relative proportions and the source-observed size relationships between product components.',
      'When the product interacts with a person, anatomy, a hand, furniture, architecture, another familiar object or a recognizable environment, use those elements as realistic physical scale references.',
      'Keep the product physically plausible in the new scene. Create prominence through framing, camera position, focus, lighting and composition—not by enlarging, shrinking, stretching, compressing or reshaping the physical product.',
    ]),
    section('D. HUMAN INTERACTION / VALID USE', [
      `Human presence decision: ${brief.humanInteraction.presence ?? (brief.humanInteraction.mode === 'forbidden' ? 'none' : 'optional')}.`,
      `Human interaction mode: ${brief.humanInteraction.mode}.`,
      ...(brief.humanInteraction.usageDescription ? [`Required usage description: ${brief.humanInteraction.usageDescription}`] : []),
      `Applicable affordances: ${productSemantics.affordances.join(', ')}. Valid contexts: ${productSemantics.validContexts.join('; ')}.`,
      brief.humanInteraction.mode === 'required'
        ? 'Show exactly the specified real use with realistic scale, physically plausible contact and only the anatomical placement explicitly stated above. Do not invent another pose or body placement.'
        : brief.humanInteraction.mode === 'forbidden'
          ? 'Do not show a person using, holding or wearing the product.'
          : brief.humanInteraction.presence === 'recommended'
            ? 'Human presence is recommended only because it improves truthful demonstration of use, scale or commercial appeal. Keep the product dominant, use valid anatomy and placement, and do not infer gender without evidence.'
            : 'Human interaction is optional and must remain within the supplied usage description and affordances; do not invent anatomical placement or gender.',
    ]),
    onBodyWearableFidelity(brief, productSemantics),
    ...(interactionFidelity ? [interactionFidelity] : []),
    section('E. CAMPAIGN IDEA', [
      `Campaign role: ${brief.campaignRole}.`,
      `Campaign idea: ${brief.campaignIdea}`,
      `Commercial objective: ${brief.commercialObjective}`,
    ]),
    section('F. VISUAL STORY', [brief.visualStory]),
    section('G. SCENE', [
      `Environment: ${brief.scene.environment}`, `Surface: ${brief.scene.surface}`,
      `Foreground: ${brief.scene.foreground}`, `Midground: ${brief.scene.midground}`,
      `Background: ${brief.scene.background}`, `Props: ${brief.scene.props.join('; ') || 'none'}.`,
    ]),
    section('H. ART DIRECTION', [
      `Visual language: ${brief.artDirection.visualLanguage}`, `Color strategy: ${brief.artDirection.colorStrategy}`,
      `Environmental palette: ${brief.artDirection.palette.join('; ')}`, `Materials: ${brief.artDirection.materials.join('; ')}`,
      `Styling: ${brief.artDirection.styling}`, `Atmosphere: ${brief.artDirection.atmosphere}`,
      'COLOR ENHANCEMENT MUST PRESERVE PRODUCT COLOR IDENTITY.',
      'Preserve source-observed characteristic product colors and their color families. Photographically plausible vibrancy, luminosity, tonal richness, highlight quality and perceived saturation may improve, but characteristic colors must not be replaced, shifted into another color family, supplemented with invented characteristic colors or recolored to match the campaign palette.',
      'Scene colors, background colors and environmental lighting may follow the Creative Brief, but must not redefine the intrinsic colors of the product.',
    ]),
    section('I. PHOTOGRAPHY', [
      `Shot type: ${brief.photography.shotType}`, `Camera angle: ${brief.photography.cameraAngle}`,
      `Framing: ${brief.photography.framing}`, `Lens language: ${brief.photography.lensLanguage}`,
      `Depth of field: ${brief.photography.depthOfField}`, `Lighting: ${brief.photography.lighting}`,
      `Contrast: ${brief.photography.contrast}`,
    ]),
    section('J. FIDELITY REQUIREMENTS', [
      ...brief.fidelityRequirements.map((requirement) => `- ${requirement}`),
      '- productTransformation is forbidden.',
    ]),
    section('J2. PHOTOGRAPHIC ENHANCEMENT', [
      'PHOTOGRAPHIC ENHANCEMENT IS ALLOWED AND ENCOURAGED when it does not alter product identity.',
      'Improve lighting, exposure, dynamic range, specular highlights, material brilliance, reflective-surface sparkle when applicable, local contrast, clarity, perceived material richness, color vibrancy, photographic sharpness, background separation and professional advertising presentation.',
      'These enhancements must make the original product look better photographed, not turn it into a different product.',
    ]),
    section('J3. LOCKED PRODUCT DOMAIN VS. CREATIVE PHOTOGRAPHY DOMAIN', [
      'LOCKED PRODUCT DOMAIN: canonical identity, source-visible geometry and construction, visible materials, characteristic colors, distinctive details, selected quantities, protected relationships, physical scale and proportions.',
      'CREATIVE PHOTOGRAPHY DOMAIN: environment, background, props, lighting, camera, lens language, depth of field, framing, atmosphere, visual storytelling and campaign styling.',
      'Creative freedom applies strongly to the photography domain and not to the locked product domain.',
    ]),
    section('K. FINAL EXECUTION PRIORITY', [
      'Create one coherent advertising image matching this validated Creative Brief.',
      'The Creative Brief controls scene, composition, lighting, photography, use and proposal visibility.',
      'Priority order: canonical Product Identity; source-visible product fidelity; proposal visibility, quantities and relationships; physical plausibility and scale; Creative Brief; photographic enhancement.',
      'The source photograph controls canonical product identity. PRODUCT FIDELITY WINS OVER ART DIRECTION when they conflict; photographic enhancement that does not alter product identity is encouraged.',
      `Requested aspect ratio: ${userIntent?.aspectRatio ?? '1:1'}. Do not create a collage, contact sheet or multiple alternatives.`,
    ]),
  ].join('\n\n');
  if (/data:image|base64,/i.test(prompt)) throw new TypeError('V3 compiler must never include image data.');
  return prompt;
}
