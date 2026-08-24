export const V3_CAMPAIGN_ROLES = Object.freeze([
  'hero_commercial',
  'contextual_lifestyle',
  'editorial_craft_detail',
  'concept_campaign',
]);

export const V3_AFFORDANCES = Object.freeze([
  'wearable', 'handheld', 'surface_supported', 'installed_environmental',
  'consumable', 'vehicle_or_mobility', 'architectural',
  'digital_or_screen_based', 'unknown_safe_context',
]);

export const V3_COLOR_STRATEGIES = Object.freeze([
  'complementary_contrast', 'analogous_harmony', 'monochromatic_luxury',
  'dark_dramatic', 'high_key_editorial', 'warm_neutral', 'cool_modern',
  'botanical_natural', 'bold_chromatic', 'brand_aligned',
]);

export const V3_HUMAN_PRESENCE = Object.freeze(['none', 'optional', 'recommended', 'required']);

const ROLE_DIRECTIONS = Object.freeze([
  Object.freeze({
    campaignRole: 'hero_commercial', presentationMode: 'architectural_hero',
    environment: 'a purpose-built architectural campaign set with stepped planes and a precise physical support',
    surface: 'a monolithic matte platform selected to contrast with the observed product materials',
    visualLanguage: 'monumental geometric commercial minimalism', colorStrategy: 'complementary_contrast',
    shotType: 'three-quarter hero shot', cameraAngle: 'low product-level angle',
    lighting: 'sculpted directional key with controlled edge light and deep shaped shadows',
    humanMode: 'forbidden',
  }),
  Object.freeze({
    campaignRole: 'contextual_lifestyle', presentationMode: 'plausible_contextual_use',
    environment: 'a refined real-world setting selected from the product valid contexts, with credible scale and signs of purposeful use',
    surface: 'a functionally appropriate support integrated into the lived environment',
    visualLanguage: 'observational premium lifestyle editorial', colorStrategy: 'warm_neutral',
    shotType: 'environmental medium shot', cameraAngle: 'natural human-scale viewpoint',
    lighting: 'motivated window light with natural falloff, tactile highlights and restrained fill',
    humanMode: 'semantic',
  }),
  Object.freeze({
    campaignRole: 'editorial_craft_detail', presentationMode: 'material_detail_tableau',
    environment: 'a meticulously constructed studio still-life revealing craft, silhouette and material transitions',
    surface: 'layered tactile surfaces with controlled reflection and stable physical contact',
    visualLanguage: 'precision design-magazine still life', colorStrategy: 'monochromatic_luxury',
    shotType: 'close editorial detail shot', cameraAngle: 'elevated oblique detail angle',
    lighting: 'narrow soft key with flags and reflection control to preserve micro-detail',
    humanMode: 'forbidden',
  }),
  Object.freeze({
    campaignRole: 'concept_campaign', presentationMode: 'conceptual_campaign_metaphor',
    environment: 'one coherent conceptual world built around a product-relevant physical metaphor, without montage or duplicate products',
    surface: 'a physically credible sculptural support within the conceptual world',
    visualLanguage: 'bold cinematic campaign surrealism grounded in physical photography', colorStrategy: 'bold_chromatic',
    shotType: 'wide conceptual key visual', cameraAngle: 'decisive high or low perspective justified by the metaphor',
    lighting: 'dramatic motivated beams with atmospheric separation and legible product surfaces',
    humanMode: 'forbidden',
  }),
]);

function fail(code, message) {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function text(value, field, { optional = false } = {}) {
  if (value == null && optional) return null;
  if (typeof value !== 'string' || value.trim().length < 2) fail('INVALID_V3_INPUT', `${field} must be a meaningful string.`);
  return value.trim();
}

function strings(value, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    fail('INVALID_V3_INPUT', `${field} must be an array of non-empty strings.`);
  }
  return Object.freeze(value.map((item) => item.trim()));
}

export function validateCreativeDirectorV3Input(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_V3_INPUT', 'V3 input must be an object.');
  const identity = input.productIdentity;
  if (!identity || !Array.isArray(identity.items) || identity.items.length === 0) fail('INVALID_V3_INPUT', 'Product identity requires canonical items.');
  const ids = new Set();
  const items = identity.items.map((item) => {
    const id = text(item?.id, 'item.id');
    if (ids.has(id)) fail('INVALID_V3_INPUT', `Duplicate canonical item ID: ${id}`);
    ids.add(id);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) fail('INVALID_V3_INPUT', `Invalid canonical quantity for ${id}.`);
    return Object.freeze({ id, functionalType: text(item.functionalType, 'item.functionalType'), quantity: item.quantity });
  });
  const relationships = (identity.relationships ?? []).map((relationship) => {
    const itemIds = strings(relationship?.itemIds, 'relationship.itemIds');
    if (itemIds.some((id) => !ids.has(id))) fail('INVALID_V3_INPUT', 'Relationship references an unknown item ID.');
    return Object.freeze({ type: text(relationship.type, 'relationship.type'), itemIds });
  });
  const relativeScale = (identity.relativeScale ?? []).map((comparison) => {
    const subjectId = text(comparison?.subjectId, 'relativeScale.subjectId');
    const referenceId = text(comparison?.referenceId, 'relativeScale.referenceId');
    if (subjectId === referenceId || !ids.has(subjectId) || !ids.has(referenceId)) {
      fail('INVALID_V3_INPUT', 'Relative scale references invalid canonical item IDs.');
    }
    if (!['slightly_larger', 'approximately_same', 'clearly_larger', 'significantly_smaller']
      .includes(comparison.relation) || !['high', 'medium', 'low'].includes(comparison.confidence)) {
      fail('INVALID_V3_INPUT', 'Relative scale contains an unsupported relation or confidence.');
    }
    return Object.freeze({
      subjectId, referenceId, relation: comparison.relation, confidence: comparison.confidence,
    });
  });
  const affordances = Array.isArray(input.productSemantics?.affordances)
    ? [...new Set(input.productSemantics.affordances)] : [];
  if (!affordances.length || affordances.some((value) => !V3_AFFORDANCES.includes(value))) fail('INVALID_V3_INPUT', 'Unsupported or missing affordance.');
  const proposalCount = input.generationPolicy?.proposalCount ?? 4;
  if (proposalCount !== 4) fail('INVALID_V3_INPUT', 'Creative Director V3 requires exactly four proposals.');
  return Object.freeze({
    productIdentity: Object.freeze({
      category: text(identity.category, 'productIdentity.category'), items: Object.freeze(items),
      relationships: Object.freeze(relationships),
      relativeScale: Object.freeze(relativeScale),
      observedFeatures: strings(identity.observedFeatures ?? [], 'productIdentity.observedFeatures'),
      ambiguousFeatures: strings(identity.ambiguousFeatures ?? [], 'productIdentity.ambiguousFeatures'),
    }),
    productSemantics: Object.freeze({
      functionalType: text(input.productSemantics.functionalType, 'productSemantics.functionalType'),
      affordances: Object.freeze(affordances),
      validContexts: strings(input.productSemantics.validContexts ?? [], 'productSemantics.validContexts'),
      invalidContexts: strings(input.productSemantics.invalidContexts ?? [], 'productSemantics.invalidContexts'),
    }),
    userIntent: Object.freeze({
      objective: text(input.userIntent?.objective, 'userIntent.objective'),
      aspectRatio: text(input.userIntent?.aspectRatio ?? '1:1', 'userIntent.aspectRatio'),
      requestedStyle: text(input.userIntent?.requestedStyle, 'userIntent.requestedStyle', { optional: true }),
      additionalInstructions: text(input.userIntent?.additionalInstructions, 'userIntent.additionalInstructions', { optional: true }),
    }),
    generationPolicy: Object.freeze({
      proposalCount: 4,
      targetQuality: text(input.generationPolicy?.targetQuality ?? 'standard', 'generationPolicy.targetQuality'),
      creativeFreedom: text(input.generationPolicy?.creativeFreedom ?? 'high', 'generationPolicy.creativeFreedom'),
    }),
  });
}

function explicitlyRequestsHumanUse(userIntent) {
  const intent = [userIntent.objective, userIntent.requestedStyle, userIntent.additionalInstructions]
    .filter(Boolean).join(' ').toLowerCase();
  return /\b(wear|wearing|worn|use|using|held|holding|human|person|model|vestir|vestido|usando|uso|pessoa|modelo)\b/.test(intent);
}

function humanInteraction(direction, semantics, userIntent) {
  if (direction.humanMode === 'forbidden') {
    return Object.freeze({ presence: 'none', mode: 'forbidden', usageDescription: null });
  }
  if (semantics.affordances.includes('wearable')) {
    const presence = explicitlyRequestsHumanUse(userIntent) ? 'required' : 'recommended';
    return Object.freeze({ presence, mode: presence === 'required' ? 'required' : 'allowed', usageDescription: 'Natural wearing only at the functionally valid body placement established by product semantics; keep human presentation gender-neutral unless supported by explicit evidence or user intent.' });
  }
  if (semantics.affordances.some((value) => ['handheld', 'consumable', 'vehicle_or_mobility', 'digital_or_screen_based'].includes(value))) {
    return Object.freeze({ presence: 'optional', mode: 'allowed', usageDescription: 'Natural interaction is optional and limited to the product established function and valid contexts; prefer a product-only scene whenever a person adds no demonstrative value.' });
  }
  return Object.freeze({ presence: 'none', mode: 'forbidden', usageDescription: null });
}

function visibilityFor(role, identity) {
  const requiredVisibleItems = identity.items.map(({ id, quantity }) => ({ itemId: id, quantity }));
  return Object.freeze({
    mode: role === 'contextual_lifestyle' ? 'contextual_use' : 'full_identity',
    requiredVisibleItems: Object.freeze(requiredVisibleItems), optionalVisibleItems: Object.freeze([]),
    heroItemIds: Object.freeze([identity.items[0].id]),
    pairPolicy: identity.relationships.some(({ type }) => /pair/i.test(type)) ? 'preserve_pair' : 'not_applicable',
  });
}

export function createDeterministicCreativeDirectorV3Model() {
  return Object.freeze({
    name: 'deterministic-v3-dry-run-adapter',
    async generate(input) {
      const { productIdentity: identity, productSemantics: semantics, userIntent } = input;
      return ROLE_DIRECTIONS.map((direction, index) => {
        const visibilityIntent = visibilityFor(direction.campaignRole, identity);
        const human = humanInteraction(direction, semantics, userIntent);
        const context = semantics.validContexts[0] ?? 'a conservative, physically credible commercial setting';
        return {
          proposalId: index + 1,
          campaignRole: direction.campaignRole,
          campaignIdea: `${direction.visualLanguage} that turns ${context} into a concrete campaign world while the canonical product remains unchanged.`,
          commercialObjective: `${userIntent.objective}; make the product immediately legible and commercially desirable through the ${direction.campaignRole} role.`,
          visualStory: `The intact product anchors ${direction.environment}; spatial layers and physical materials create a single readable advertising narrative rather than a background replacement.`,
          productPresentation: {
            heroItemIds: visibilityIntent.heroItemIds,
            supportingItemIds: Object.freeze(identity.items.slice(1).map(({ id }) => id)),
            requiredVisibleItems: visibilityIntent.requiredVisibleItems,
            optionalVisibleItems: visibilityIntent.optionalVisibleItems,
            presentationMode: direction.presentationMode,
          },
          visibilityIntent,
          humanInteraction: human,
          scene: {
            environment: direction.environment, surface: direction.surface,
            foreground: `a restrained framing cue appropriate to ${context}`,
            midground: 'the complete required product identity on stable, credible support',
            background: `controlled depth that locates the scene in ${context}`,
            props: Object.freeze(['one semantically relevant material accent', 'one scale-consistent contextual cue']),
          },
          artDirection: {
            visualLanguage: direction.visualLanguage, colorStrategy: direction.colorStrategy,
            palette: Object.freeze(['observed product colors unchanged', 'environmental neutrals', 'one controlled accent']),
            materials: Object.freeze(['physically rendered support material', 'context-appropriate tactile material']),
            styling: `purposeful ${direction.campaignRole} styling with no arbitrary body use or decorative duplication`,
            atmosphere: index === 0 ? 'commanding and polished' : index === 1 ? 'credible and aspirational' : index === 2 ? 'tactile and collectible' : 'surprising, coherent and memorable',
          },
          photography: {
            shotType: direction.shotType, cameraAngle: direction.cameraAngle,
            framing: index % 2 === 0 ? 'asymmetric product-led framing' : 'layered environmental framing',
            lensLanguage: index === 2 ? 'macro-informed optical precision' : 'premium commercial perspective with controlled distortion',
            depthOfField: index === 1 ? 'context-legible moderate depth' : 'selective depth retaining every required item legibly',
            lighting: direction.lighting, contrast: index === 1 ? 'natural medium contrast' : 'intentional sculpted contrast',
          },
          creativeFreedom: { sceneTransformation: 'high', productTransformation: 'forbidden' },
          luxuryCues: Object.freeze(['material authenticity', 'controlled highlights', 'intentional negative space']),
          differentiationKeys: Object.freeze([direction.presentationMode, direction.shotType, direction.colorStrategy, direction.visualLanguage]),
          fidelityRequirements: Object.freeze([
            'Preserve every canonical item ID, functional type and locked quantity.',
            'Preserve distinctive structure, observed materials, colors and known relationships.',
            'Do not duplicate, fuse, redesign, recolor or convert the product into another object.',
          ]),
        };
      });
    },
  });
}

function validateVisibleItems(items, identity, field) {
  if (!Array.isArray(items)) fail('INVALID_V3_OUTPUT', `${field} must be an array.`);
  const canonical = new Map(identity.items.map((item) => [item.id, item.quantity]));
  const seen = new Set();
  for (const item of items) {
    if (!canonical.has(item?.itemId) || seen.has(item.itemId)) fail('INVALID_V3_OUTPUT', `${field} contains an unknown or duplicate item ID.`);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity !== canonical.get(item.itemId)) {
      fail('INVALID_V3_OUTPUT', `${field} violates a canonical quantity lock.`);
    }
    seen.add(item.itemId);
  }
}

function selectedItems(brief, identity) {
  const required = brief.productPresentation.requiredVisibleItems;
  const optional = brief.productPresentation.optionalVisibleItems;
  const combined = [...required, ...optional];
  if (new Set(combined.map(({ itemId }) => itemId)).size !== combined.length) {
    fail('INVALID_V3_OUTPUT', 'An item cannot be both required and optional in one proposal.');
  }
  const selected = new Set(combined.map(({ itemId }) => itemId));
  const canonicalIds = new Set(identity.items.map(({ id }) => id));
  for (const id of [...brief.productPresentation.heroItemIds, ...brief.productPresentation.supportingItemIds]) {
    if (!canonicalIds.has(id)) fail('INVALID_V3_OUTPUT', 'Product presentation contains an unknown item ID.');
    if (!selected.has(id)) fail('INVALID_V3_OUTPUT', 'Hero and supporting items must belong to proposal visibility.');
  }
  const intent = brief.visibilityIntent;
  validateVisibleItems(intent.requiredVisibleItems, identity, 'visibilityIntent.requiredVisibleItems');
  validateVisibleItems(intent.optionalVisibleItems, identity, 'visibilityIntent.optionalVisibleItems');
  if (JSON.stringify(intent.requiredVisibleItems) !== JSON.stringify(required) ||
      JSON.stringify(intent.optionalVisibleItems) !== JSON.stringify(optional) ||
      JSON.stringify(intent.heroItemIds) !== JSON.stringify(brief.productPresentation.heroItemIds)) {
    fail('INVALID_V3_OUTPUT', 'Visibility Intent must match product presentation selection.');
  }
  return selected;
}

function validateRelationships(brief, input, selected) {
  for (const relationship of input.productIdentity.relationships) {
    if (!/pair|atomic/i.test(relationship.type)) continue;
    const selectedMembers = relationship.itemIds.filter((id) => selected.has(id));
    if (selectedMembers.length > 0 && selectedMembers.length !== relationship.itemIds.length) {
      fail('INVALID_V3_OUTPUT', 'Atomic relationship cannot be partially visible.');
    }
    if (selectedMembers.length > 0 && brief.visibilityIntent.pairPolicy !== 'preserve_pair') {
      fail('INVALID_V3_OUTPUT', 'Known pair relationship must be preserved when selected.');
    }
    if (selectedMembers.length === 0 && brief.visibilityIntent.pairPolicy === 'preserve_pair') {
      fail('INVALID_V3_OUTPUT', 'Pair policy cannot preserve an omitted pair.');
    }
  }
}

function diversityKey(brief) {
  return [brief.scene.environment, brief.productPresentation.presentationMode,
    brief.photography.shotType, brief.photography.cameraAngle, brief.photography.lighting,
    brief.artDirection.visualLanguage, brief.artDirection.colorStrategy].map((value) => value.toLowerCase().trim()).join('|');
}

export function validateCreativeDirectorV3Output(rawBriefs, normalizedInput) {
  const input = validateCreativeDirectorV3Input(normalizedInput);
  if (!Array.isArray(rawBriefs) || rawBriefs.length !== 4) fail('INVALID_V3_OUTPUT', 'V3 output must contain exactly four proposals.');
  const ids = new Set();
  const roles = new Set();
  for (const brief of rawBriefs) {
    if (!Number.isSafeInteger(brief?.proposalId) || brief.proposalId < 1 || brief.proposalId > 4 || ids.has(brief.proposalId)) fail('INVALID_V3_OUTPUT', 'Proposal IDs must be unique integers from 1 to 4.');
    ids.add(brief.proposalId);
    if (!V3_CAMPAIGN_ROLES.includes(brief.campaignRole) || roles.has(brief.campaignRole)) fail('INVALID_V3_OUTPUT', 'Each required campaign role must appear exactly once.');
    roles.add(brief.campaignRole);
    for (const [field, value] of [['campaignIdea', brief.campaignIdea], ['commercialObjective', brief.commercialObjective], ['visualStory', brief.visualStory]]) {
      if (typeof value !== 'string' || value.trim().length < 2) fail('INVALID_V3_OUTPUT', `${field} must be a meaningful string.`);
    }
    if (!brief.productPresentation || !brief.visibilityIntent || !brief.humanInteraction || !brief.scene || !brief.artDirection || !brief.photography) fail('INVALID_V3_OUTPUT', 'Creative brief is missing a required structured section.');
    validateVisibleItems(brief.productPresentation.requiredVisibleItems, input.productIdentity, 'requiredVisibleItems');
    validateVisibleItems(brief.productPresentation.optionalVisibleItems, input.productIdentity, 'optionalVisibleItems');
    const knownIds = new Set(input.productIdentity.items.map(({ id }) => id));
    for (const field of ['heroItemIds', 'supportingItemIds']) {
      if (!Array.isArray(brief.productPresentation[field]) || brief.productPresentation[field].some((id) => !knownIds.has(id))) fail('INVALID_V3_OUTPUT', `${field} contains an unknown item ID.`);
    }
    const selected = selectedItems(brief, input.productIdentity);
    if (!['required', 'allowed', 'forbidden'].includes(brief.humanInteraction.mode)) fail('INVALID_V3_OUTPUT', 'Invalid human interaction mode.');
    const legacyPresence = brief.humanInteraction.mode === 'required' ? 'required'
      : brief.humanInteraction.mode === 'allowed' ? 'optional' : 'none';
    const presence = brief.humanInteraction.presence ?? legacyPresence;
    if (!V3_HUMAN_PRESENCE.includes(presence)) fail('INVALID_V3_OUTPUT', 'Invalid human presence decision.');
    if ((presence === 'none') !== (brief.humanInteraction.mode === 'forbidden') ||
        (presence === 'required') !== (brief.humanInteraction.mode === 'required')) {
      fail('INVALID_V3_OUTPUT', 'Human presence conflicts with interaction mode.');
    }
    const bodilyAllowed = input.productSemantics.affordances.includes('wearable');
    if (!bodilyAllowed && /wear|ear|finger|body attachment/i.test(brief.humanInteraction.usageDescription ?? '')) fail('INVALID_V3_OUTPUT', 'Human interaction conflicts with product affordance.');
    if (!V3_COLOR_STRATEGIES.includes(brief.artDirection.colorStrategy)) fail('INVALID_V3_OUTPUT', 'Invalid color strategy.');
    if (brief.creativeFreedom?.productTransformation !== 'forbidden') fail('INVALID_V3_OUTPUT', 'Product transformation must be forbidden.');
    validateRelationships(brief, input, selected);
  }
  const activeHumanProposals = rawBriefs.filter((brief) => (brief.humanInteraction.presence ??
    (brief.humanInteraction.mode === 'forbidden' ? 'none' : 'optional')) !== 'none');
  if (activeHumanProposals.length > 1) fail('INVALID_V3_OUTPUT', 'Human presence must not dominate the four-proposal set.');
  const keys = rawBriefs.map(diversityKey);
  if (new Set(keys).size !== 4) fail('INSUFFICIENT_V3_DIVERSITY', 'Creative briefs repeat essential scene, presentation, photography and color dimensions.');
  for (let left = 0; left < rawBriefs.length; left += 1) {
    for (let right = left + 1; right < rawBriefs.length; right += 1) {
      const a = rawBriefs[left]; const b = rawBriefs[right];
      const sameEssentials = a.scene.environment === b.scene.environment &&
        a.productPresentation.presentationMode === b.productPresentation.presentationMode &&
        a.photography.shotType === b.photography.shotType &&
        a.photography.lighting === b.photography.lighting &&
        a.artDirection.visualLanguage === b.artDirection.visualLanguage &&
        a.artDirection.colorStrategy === b.artDirection.colorStrategy;
      if (sameEssentials) fail('INSUFFICIENT_V3_DIVERSITY', 'A pair of proposals is excessively similar.');
    }
  }
  return Object.freeze(rawBriefs.map((brief) => Object.freeze(brief)));
}

export async function runCreativeDirectorV3({ input, modelAdapter }) {
  if (!modelAdapter || typeof modelAdapter.generate !== 'function') fail('INVALID_V3_MODEL_ADAPTER', 'An injectable Creative Director model adapter is required.');
  const normalizedInput = validateCreativeDirectorV3Input(input);
  const startedAt = Date.now();
  const rawBriefs = await modelAdapter.generate(normalizedInput);
  const briefs = validateCreativeDirectorV3Output(rawBriefs, normalizedInput);
  return Object.freeze({
    creativeDirectorVersion: 'v3-experimental', modelAdapterName: text(modelAdapter.name, 'modelAdapter.name'),
    latencyMs: Date.now() - startedAt, proposalCount: briefs.length,
    schemaValid: true, diversityValid: true, fallback: modelAdapter.name.includes('deterministic'), briefs,
  });
}
