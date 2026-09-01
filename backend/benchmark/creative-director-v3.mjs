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

function featureEvidence(value, ids, field, { ambiguous = false, critical = false } = {}) {
  if (!Array.isArray(value)) fail('INVALID_V3_INPUT', `${field} must be an array.`);
  return Object.freeze(value.map((feature, index) => {
    const path = `${field}[${index}]`;
    const itemId = text(feature?.itemId, `${path}.itemId`);
    if (!ids.has(itemId)) fail('INVALID_V3_INPUT', `${path} references an unknown item ID.`);
    const base = {
      itemId,
      ...(feature.featureId == null ? {} : { featureId: text(feature.featureId, `${path}.featureId`) }),
      name: text(feature.name, `${path}.name`),
    };
    if (ambiguous) return Object.freeze({
      ...base,
      visibility: text(feature.visibility, `${path}.visibility`),
      observedConstraint: text(feature.observedConstraint, `${path}.observedConstraint`, { optional: true }),
      plausibleHypotheses: strings(feature.plausibleHypotheses ?? [], `${path}.plausibleHypotheses`),
      certainty: feature.certainty === 'ambiguous' ? 'ambiguous'
        : fail('INVALID_V3_INPUT', `${path}.certainty must remain ambiguous.`),
    });
    return Object.freeze({
      ...base, value: text(feature.value, `${path}.value`),
      ...(critical ? { evidence: feature.evidence === 'observed' ? 'observed'
        : fail('INVALID_V3_INPUT', `${path}.evidence must be observed.`) } : {}),
    });
  }));
}

function structuralComponents(value, ids) {
  if (!Array.isArray(value)) fail('INVALID_V3_INPUT', 'productIdentity.structuralComponents must be an array.');
  const componentIds = new Set();
  return Object.freeze(value.map((component, index) => {
    const path = `productIdentity.structuralComponents[${index}]`;
    const componentId = text(component?.componentId, `${path}.componentId`);
    const parentItemId = text(component?.parentItemId, `${path}.parentItemId`);
    if (componentIds.has(componentId)) fail('INVALID_V3_INPUT', `${path}.componentId must be unique.`);
    if (!ids.has(parentItemId)) fail('INVALID_V3_INPUT', `${path}.parentItemId references an unknown item ID.`);
    if (component.evidence !== 'observed' || component.requiredWhenParentVisible !== true) {
      fail('INVALID_V3_INPUT', `${path} must remain explicitly observed and parent-bound.`);
    }
    componentIds.add(componentId);
    return Object.freeze({
      componentId,
      parentItemId,
      name: text(component.name, `${path}.name`),
      value: text(component.value, `${path}.value`),
      evidence: 'observed',
      requiredWhenParentVisible: true,
    });
  }));
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
  const observedFeatureEvidence = featureEvidence(
    identity.observedFeatureEvidence ?? [], ids, 'productIdentity.observedFeatureEvidence',
  );
  const ambiguousFeatureEvidence = featureEvidence(
    identity.ambiguousFeatureEvidence ?? [], ids, 'productIdentity.ambiguousFeatureEvidence',
    { ambiguous: true },
  );
  const criticalFeatures = featureEvidence(
    identity.criticalFeatures ?? [], ids, 'productIdentity.criticalFeatures', { critical: true },
  );
  const confirmedStructuralComponents = structuralComponents(identity.structuralComponents ?? [], ids);
  for (const component of confirmedStructuralComponents) {
    const supported = criticalFeatures.some((feature) =>
      feature.featureId === component.componentId && feature.itemId === component.parentItemId &&
      feature.name === component.name && feature.value === component.value);
    if (!supported) fail('INVALID_V3_INPUT', 'Structural component lacks matching explicit observed evidence.');
  }
  const affordances = Array.isArray(input.productSemantics?.affordances)
    ? [...new Set(input.productSemantics.affordances)] : [];
  if (!affordances.length || affordances.some((value) => !V3_AFFORDANCES.includes(value))) fail('INVALID_V3_INPUT', 'Unsupported or missing affordance.');
  const suppliedWearableItemIds = input.productSemantics?.wearableItemIds;
  const wearableItemIds = suppliedWearableItemIds === undefined
    ? (affordances.includes('wearable') ? items.map(({ id }) => id) : [])
    : strings(suppliedWearableItemIds, 'productSemantics.wearableItemIds');
  if (wearableItemIds.some((id) => !ids.has(id)) || new Set(wearableItemIds).size !== wearableItemIds.length) {
    fail('INVALID_V3_INPUT', 'Wearable item IDs must be unique canonical item IDs.');
  }
  const proposalCount = input.generationPolicy?.proposalCount ?? 4;
  if (proposalCount !== 4) fail('INVALID_V3_INPUT', 'Creative Director V3 requires exactly four proposals.');
  return Object.freeze({
    productIdentity: Object.freeze({
      category: text(identity.category, 'productIdentity.category'), items: Object.freeze(items),
      relationships: Object.freeze(relationships),
      relativeScale: Object.freeze(relativeScale),
      observedFeatures: strings(identity.observedFeatures ?? [], 'productIdentity.observedFeatures'),
      ambiguousFeatures: strings(identity.ambiguousFeatures ?? [], 'productIdentity.ambiguousFeatures'),
      observedFeatureEvidence,
      ambiguousFeatureEvidence,
      criticalFeatures,
      structuralComponents: confirmedStructuralComponents,
    }),
    productSemantics: Object.freeze({
      functionalType: text(input.productSemantics.functionalType, 'productSemantics.functionalType'),
      affordances: Object.freeze(affordances),
      wearableItemIds: Object.freeze(wearableItemIds),
      affordanceSource: text(input.productSemantics.affordanceSource, 'productSemantics.affordanceSource', { optional: true }),
      requestedCategory: text(input.productSemantics.requestedCategory, 'productSemantics.requestedCategory', { optional: true }),
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

function humanInteraction(direction, semantics) {
  if (direction.humanMode === 'forbidden') {
    return Object.freeze({ presence: 'none', mode: 'forbidden', usageDescription: null });
  }
  if (semantics.affordances.includes('wearable')) {
    return Object.freeze({ presence: 'required', mode: 'required', usageDescription: 'Include one realistic human using at least one wearable unit at the functionally valid body placement established by product semantics; keep human presentation gender-neutral unless supported by explicit evidence or user intent.' });
  }
  if (semantics.affordances.some((value) => ['handheld', 'consumable', 'vehicle_or_mobility', 'digital_or_screen_based'].includes(value))) {
    return Object.freeze({ presence: 'optional', mode: 'allowed', usageDescription: 'Natural interaction is optional and limited to the product established function and valid contexts; prefer a product-only scene whenever a person adds no demonstrative value.' });
  }
  return Object.freeze({ presence: 'none', mode: 'forbidden', usageDescription: null });
}

function stableIdCompare(left, right) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function evidenceCountByItem(entries, field = 'itemId') {
  const counts = new Map();
  for (const entry of entries ?? []) {
    const itemId = entry?.[field];
    if (typeof itemId === 'string') counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }
  return counts;
}

export function selectDeterministicV3RoleItems(productIdentity) {
  const critical = evidenceCountByItem(productIdentity.criticalFeatures);
  const components = evidenceCountByItem(productIdentity.structuralComponents, 'parentItemId');
  const observedEvidence = evidenceCountByItem(productIdentity.observedFeatureEvidence);
  const observedStrings = new Map(productIdentity.items.map(({ id }) => [id,
    (productIdentity.observedFeatures ?? []).filter((feature) =>
      typeof feature === 'string' && feature.startsWith(`${id}:`)).length]));
  const ranked = [...productIdentity.items].sort((left, right) =>
    (critical.get(right.id) ?? 0) - (critical.get(left.id) ?? 0) ||
    (components.get(right.id) ?? 0) - (components.get(left.id) ?? 0) ||
    ((observedEvidence.get(right.id) ?? observedStrings.get(right.id) ?? 0) -
      (observedEvidence.get(left.id) ?? observedStrings.get(left.id) ?? 0)) ||
    stableIdCompare(left, right));
  const editorialSelectedIds = Object.freeze([ranked[0].id]);
  const editorialId = editorialSelectedIds[0];
  const atomic = productIdentity.relationships
    .filter(({ type, itemIds }) => /pair|atomic/i.test(type) && itemIds.length > 0)
    .map((relationship) => ({
      ...relationship,
      stableKey: [...relationship.itemIds].sort().join('|'),
      overlapsEditorial: relationship.itemIds.includes(editorialId),
    }))
    .sort((left, right) => Number(left.overlapsEditorial) - Number(right.overlapsEditorial) ||
      (left.stableKey < right.stableKey ? -1 : left.stableKey > right.stableKey ? 1 : 0));
  let conceptualSelectedIds;
  let conceptualStrategy;
  if (atomic.length > 0) {
    conceptualSelectedIds = [...atomic[0].itemIds];
    conceptualStrategy = 'complete_atomic_relationship';
  } else {
    const alternativesFirst = [...productIdentity.items].sort((left, right) =>
      Number(left.id === editorialId) - Number(right.id === editorialId) || stableIdCompare(left, right));
    const totalUnits = productIdentity.items.reduce((sum, { quantity }) => sum + quantity, 0);
    conceptualSelectedIds = alternativesFirst.length >= 2
      ? alternativesFirst.slice(0, 2).map(({ id }) => id)
      : [alternativesFirst[0].id];
    conceptualStrategy = totalUnits === 1 ? 'single_global_unit' : 'independent_canonical_units';
  }
  return Object.freeze({
    editorialSelectedIds,
    conceptualSelectedIds: Object.freeze(conceptualSelectedIds),
    selectionStrategy: Object.freeze({
      editorial: 'critical_features_then_structural_components_then_observed_features_then_canonical_id',
      conceptual: conceptualStrategy,
    }),
    selectionDeterministic: true,
  });
}

function pairPolicyForSelection(productIdentity, selectedIds) {
  const selected = new Set(selectedIds);
  return productIdentity.relationships.some(({ type, itemIds }) =>
    /pair|atomic/i.test(type) && itemIds.length === selected.size && itemIds.every((id) => selected.has(id)))
    ? 'preserve_pair' : 'not_selected';
}

function applySelectionToBrief(brief, productIdentity, selectedIds, role) {
  const canonical = new Map(productIdentity.items.map((item) => [item.id, item]));
  const requiredVisibleItems = selectedIds.map((id) => ({ itemId: id, quantity: canonical.get(id).quantity }));
  const heroItemIds = [requiredVisibleItems[0].itemId];
  const supportingItemIds = requiredVisibleItems.slice(1).map(({ itemId }) => itemId);
  const pairPolicy = pairPolicyForSelection(productIdentity, selectedIds);
  const presentationScope = role === 'editorial_craft_detail'
    ? 'single_item_detail'
    : requiredVisibleItems.length === 1 && requiredVisibleItems[0].quantity === 1
      ? 'single_item_detail' : 'selected_subset';
  return {
    ...brief,
    productPresentation: {
      ...brief.productPresentation,
      heroItemIds,
      supportingItemIds,
      requiredVisibleItems,
      optionalVisibleItems: [],
      presentationScope,
    },
    visibilityIntent: {
      ...brief.visibilityIntent,
      mode: role === 'editorial_craft_detail' ? 'single_item_detail' : 'selective_concept',
      heroItemIds,
      requiredVisibleItems,
      optionalVisibleItems: [],
      pairPolicy,
    },
  };
}

function applyLifestyleDeterministicAllocation(brief, productIdentity) {
  if (brief.campaignRole !== 'contextual_lifestyle' ||
      !Array.isArray(brief.humanInteraction?.unitAllocation)) return brief;
  const canonicalQuantity = new Map(productIdentity.items.map(({ id, quantity }) => [id, quantity]));
  const singleIdAtomicPairs = new Set(productIdentity.relationships
    .filter(({ type, itemIds }) => /pair|atomic/i.test(type) && itemIds.length === 1 &&
      (canonicalQuantity.get(itemIds[0]) ?? 0) > 1)
    .map(({ itemIds }) => itemIds[0]));
  const singleUnitHumanIds = brief.humanInteraction.unitAllocation
    .filter(({ itemId, canonicalQuantity, humanAllocatedUnits }) =>
      canonicalQuantity === 1 && humanAllocatedUnits > 0 && !singleIdAtomicPairs.has(itemId))
    .map(({ itemId }) => itemId);
  const preferredHumanId = brief.productPresentation.heroItemIds
    .find((itemId) => singleUnitHumanIds.includes(itemId)) ?? singleUnitHumanIds[0];
  let changed = false;
  const unitAllocation = brief.humanInteraction.unitAllocation.map((allocation) => {
    if (singleIdAtomicPairs.has(allocation.itemId) && allocation.humanAllocatedUnits > 0 &&
        allocation.sceneAllocatedUnits > 0) {
      changed = true;
      return {
        ...allocation,
        sceneAllocatedUnits: 0,
        occludedOrOutOfFrameUnits: allocation.canonicalQuantity - allocation.humanAllocatedUnits,
      };
    }
    if (allocation.canonicalQuantity === 1 && allocation.humanAllocatedUnits > 0 &&
        allocation.itemId !== preferredHumanId) {
      changed = true;
      return {
        ...allocation,
        humanAllocatedUnits: 0,
        sceneAllocatedUnits: 1,
        occludedOrOutOfFrameUnits: 0,
      };
    }
    return allocation;
  });
  const humanAllocatedIds = new Set(unitAllocation
    .filter(({ humanAllocatedUnits }) => humanAllocatedUnits > 0)
    .map(({ itemId }) => itemId));
  return changed ? {
    ...brief,
    humanInteraction: {
      ...brief.humanInteraction,
      unitAllocation,
      physicalPlacement: brief.humanInteraction.physicalPlacement
        .filter(({ itemId }) => humanAllocatedIds.has(itemId)),
    },
  } : brief;
}

export function applyDeterministicV3RoleSelection(rawBriefs, productIdentity) {
  const selection = selectDeterministicV3RoleItems(productIdentity);
  const briefs = rawBriefs.map((brief) => {
    if (brief.campaignRole === 'editorial_craft_detail') {
      return applySelectionToBrief(brief, productIdentity, selection.editorialSelectedIds, brief.campaignRole);
    }
    if (brief.campaignRole === 'concept_campaign') {
      return applySelectionToBrief(brief, productIdentity, selection.conceptualSelectedIds, brief.campaignRole);
    }
    if (brief.campaignRole === 'contextual_lifestyle') {
      return applyLifestyleDeterministicAllocation(brief, productIdentity);
    }
    return brief;
  });
  return Object.freeze({ briefs, ...selection });
}

function semanticAnatomicalAnchor(item) {
  const type = item.functionalType.toLowerCase();
  const anchors = [
    [/\b(?:ear|earring|auricular)\b/, 'ear or earlobe compatible with the product function'],
    [/\b(?:neck|necklace|collar|pendant)\b/, 'neck or upper chest compatible with the product function'],
    [/\b(?:finger|ring)\b/, 'finger compatible with the product function'],
    [/\b(?:wrist|watch|bracelet|bangle)\b/, 'wrist compatible with the product function'],
    [/\b(?:face|eyewear|glasses|spectacles)\b/, 'face compatible with the product function'],
    [/\b(?:foot|footwear|shoe|boot|sneaker)\b/, 'foot compatible with the product function'],
    [/\b(?:garment|clothing|apparel|dress|shirt|trouser|jacket)\b/, 'body region naturally covered by this garment type'],
    [/\b(?:bag|handbag|purse)\b/, 'hand or shoulder compatible with the product function'],
  ];
  return anchors.find(([pattern]) => pattern.test(type))?.[1] ??
    'functionally valid body anchor established by the product semantics';
}

function visibilityFor(role, identity) {
  const deterministic = selectDeterministicV3RoleItems(identity);
  const roleSelectedIds = role === 'editorial_craft_detail'
    ? deterministic.editorialSelectedIds
    : role === 'concept_campaign' ? deterministic.conceptualSelectedIds : null;
  const canonical = new Map(identity.items.map((item) => [item.id, item]));
  const requiredVisibleItems = roleSelectedIds == null
    ? identity.items.map(({ id, quantity }) => ({ itemId: id, quantity }))
    : roleSelectedIds.map((id) => ({ itemId: id, quantity: canonical.get(id).quantity }));
  return Object.freeze({
    mode: role === 'contextual_lifestyle' ? 'contextual_use'
      : role === 'concept_campaign' ? 'selective_concept' : 'full_identity',
    requiredVisibleItems: Object.freeze(requiredVisibleItems), optionalVisibleItems: Object.freeze([]),
    heroItemIds: Object.freeze([requiredVisibleItems[0].itemId]),
    pairPolicy: ['editorial_craft_detail', 'concept_campaign'].includes(role)
      ? pairPolicyForSelection(identity, roleSelectedIds)
      : identity.relationships.some(({ type }) => /pair/i.test(type)) ? 'preserve_pair' : 'not_applicable',
  });
}

function structuredHumanPlan(human, identity, visibilityIntent, semantics) {
  if (human.mode === 'forbidden') {
    return Object.freeze({ unitAllocation: Object.freeze([]), physicalPlacement: Object.freeze([]) });
  }
  const wearableIds = new Set(semantics.wearableItemIds ?? []);
  const humanTargetId = visibilityIntent.heroItemIds.find((id) => wearableIds.has(id)) ??
    visibilityIntent.requiredVisibleItems.find(({ itemId }) => wearableIds.has(itemId))?.itemId;
  const representativeMultiUnitTargetId = visibilityIntent.requiredVisibleItems
    .find(({ itemId, quantity }) => itemId !== humanTargetId && wearableIds.has(itemId) && quantity > 1)?.itemId;
  const humanTargetIds = new Set([humanTargetId, representativeMultiUnitTargetId].filter(Boolean));
  const allocations = visibilityIntent.requiredVisibleItems.map(({ itemId, quantity }) => {
    const humanAllocatedUnits = humanTargetIds.has(itemId) ? Math.min(1, quantity) : 0;
    const sceneAllocatedUnits = humanAllocatedUnits === 0 ? Math.min(1, quantity) : 0;
    return Object.freeze({
      itemId,
      canonicalQuantity: quantity,
      humanAllocatedUnits,
      sceneAllocatedUnits,
      occludedOrOutOfFrameUnits: quantity - humanAllocatedUnits - sceneAllocatedUnits,
    });
  });
  const physicalPlacement = allocations
    .filter(({ humanAllocatedUnits }) => humanAllocatedUnits > 0)
    .map(({ itemId }) => Object.freeze({
      itemId,
      interactionMode: 'functionally valid human use',
      anatomicalAnchor: wearableIds.has(itemId)
        ? semanticAnatomicalAnchor(identity.items.find(({ id }) => id === itemId)) : null,
      orientation: 'preserve the product native functional orientation',
    }));
  return Object.freeze({ unitAllocation: Object.freeze(allocations), physicalPlacement: Object.freeze(physicalPlacement) });
}

export function createDeterministicCreativeDirectorV3Model() {
  return Object.freeze({
    name: 'deterministic-v3-dry-run-adapter',
    async generate(input) {
      const { productIdentity: identity, productSemantics: semantics, userIntent } = input;
      return ROLE_DIRECTIONS.map((direction, index) => {
        const visibilityIntent = visibilityFor(direction.campaignRole, identity);
        const human = humanInteraction(direction, semantics);
        const humanPlan = structuredHumanPlan(human, identity, visibilityIntent, semantics);
        const context = semantics.validContexts[0] ?? 'a conservative, physically credible commercial setting';
        const wearableLifestyle = direction.campaignRole === 'contextual_lifestyle' &&
          semantics.affordances.includes('wearable');
        return {
          proposalId: index + 1,
          campaignRole: direction.campaignRole,
          campaignIdea: wearableLifestyle
            ? `${direction.visualLanguage} with one realistic human visibly wearing a canonical wearable at its valid body anchor in ${context}.`
            : `${direction.visualLanguage} that turns ${context} into a concrete campaign world while the canonical product remains unchanged.`,
          commercialObjective: `${userIntent.objective}; make the product immediately legible and commercially desirable through the ${direction.campaignRole} role.`,
          visualStory: wearableLifestyle
            ? 'A realistic human visibly demonstrates the allocated wearable in natural use; remaining selected units stay secondary, independently accounted for and physically plausible.'
            : `The intact product anchors ${direction.environment}; spatial layers and physical materials create a single readable advertising narrative rather than a background replacement.`,
          productPresentation: {
            heroItemIds: visibilityIntent.heroItemIds,
            supportingItemIds: Object.freeze(visibilityIntent.requiredVisibleItems
              .slice(1).map(({ itemId }) => itemId)),
            requiredVisibleItems: visibilityIntent.requiredVisibleItems,
            optionalVisibleItems: visibilityIntent.optionalVisibleItems,
            presentationMode: direction.presentationMode,
            presentationScope: direction.campaignRole === 'editorial_craft_detail'
              ? 'single_item_detail'
              : direction.campaignRole === 'concept_campaign'
                ? (visibilityIntent.requiredVisibleItems.length === 1 &&
                    visibilityIntent.requiredVisibleItems[0].quantity === 1
                    ? 'single_item_detail' : 'selected_subset')
                : 'complete_set',
          },
          visibilityIntent,
          humanInteraction: Object.freeze({ ...human, ...humanPlan }),
          scene: {
            environment: wearableLifestyle
              ? `a light, refined real-world human lifestyle environment within ${context}` : direction.environment,
            surface: wearableLifestyle
              ? 'a secondary contextual support that never replaces the visible human use' : direction.surface,
            foreground: `a restrained framing cue appropriate to ${context}`,
            midground: wearableLifestyle
              ? 'one realistic human visibly wearing the allocated canonical unit at its valid body anchor'
              : 'the complete required product identity on stable, credible support',
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

const DETAIL_PHOTOGRAPHY_PATTERN = /\b(?:macro|close(?:-?up)?|detail(?:ed)?|magnified|tight framing|shallow depth|precision)\b/i;
const DETAIL_SUBJECT_PATTERN = /\b(?:craft(?:smanship)?|material|texture|construction|finish|geometry|component|microstructure|surface transition|setting detail|structural detail|precision)\b/i;

export function editorialDetailPurposeValid(brief) {
  if (brief?.campaignRole !== 'editorial_craft_detail') return true;
  const scope = brief.productPresentation?.presentationScope;
  if (scope === 'complete_set') return true;
  const photography = Object.values(brief.photography ?? {}).filter((value) => typeof value === 'string').join(' ');
  const purpose = [
    brief.campaignIdea, brief.visualStory, brief.commercialObjective,
    brief.productPresentation?.presentationMode,
  ].filter((value) => typeof value === 'string').join(' ');
  return DETAIL_PHOTOGRAPHY_PATTERN.test(photography) &&
    DETAIL_SUBJECT_PATTERN.test(`${purpose} ${photography}`);
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

function validateConceptSelection(brief, identity, selected) {
  if (brief.campaignRole !== 'concept_campaign') return;
  const exactAtomicMatches = identity.relationships.filter(({ type, itemIds }) =>
    /pair|atomic/i.test(type) && itemIds.length === selected.size &&
    itemIds.every((itemId) => selected.has(itemId)));
  const globalUnits = identity.items.reduce((sum, { quantity }) => sum + quantity, 0);
  const selectedUnits = identity.items.filter(({ id }) => selected.has(id))
    .reduce((sum, { quantity }) => sum + quantity, 0);
  if (exactAtomicMatches.length === 0 && globalUnits > 1 && selectedUnits < 2) {
    fail('INVALID_V3_OUTPUT', 'Concept campaign must select an atomic relationship or at least two canonical units when available.');
  }
  if (globalUnits === 1 && selectedUnits !== 1) {
    fail('INVALID_V3_OUTPUT', 'Single-unit inventory must remain exactly one conceptual unit.');
  }
}

function validateHumanPlan(brief, identity, selected) {
  const interaction = brief.humanInteraction;
  const hasAllocation = interaction.unitAllocation !== undefined;
  const hasPlacement = interaction.physicalPlacement !== undefined;
  if (!hasAllocation && !hasPlacement) return;
  if (!Array.isArray(interaction.unitAllocation) || !Array.isArray(interaction.physicalPlacement)) {
    fail('INVALID_V3_OUTPUT', 'Human unit allocation and physical placement must both be arrays.');
  }
  const canonical = new Map(identity.items.map(({ id, quantity }) => [id, quantity]));
  const required = new Set(brief.productPresentation.requiredVisibleItems.map(({ itemId }) => itemId));
  const allocated = new Set();
  for (const allocation of interaction.unitAllocation) {
    const itemId = allocation?.itemId;
    if (!selected.has(itemId) || allocated.has(itemId)) fail('INVALID_V3_OUTPUT', 'Human unit allocation contains an unknown, omitted or duplicate item ID.');
    const expected = canonical.get(itemId);
    const values = [allocation.canonicalQuantity, allocation.humanAllocatedUnits,
      allocation.sceneAllocatedUnits, allocation.occludedOrOutOfFrameUnits];
    if (values.some((value) => !Number.isSafeInteger(value) || value < 0) || allocation.canonicalQuantity !== expected) {
      fail('INVALID_V3_OUTPUT', 'Human unit allocation violates a canonical quantity lock.');
    }
    if (allocation.humanAllocatedUnits + allocation.sceneAllocatedUnits +
        allocation.occludedOrOutOfFrameUnits !== expected) {
      fail('INVALID_V3_OUTPUT', 'Human unit allocation must partition the complete canonical quantity exactly once.');
    }
    if (required.has(itemId) && allocation.humanAllocatedUnits + allocation.sceneAllocatedUnits < 1) {
      fail('INVALID_V3_OUTPUT', 'A required visible item must have at least one unit presented to the human or scene.');
    }
    allocated.add(itemId);
  }
  if (interaction.mode !== 'forbidden' && [...selected].some((itemId) => !allocated.has(itemId))) {
    fail('INVALID_V3_OUTPUT', 'Human unit allocation must account for every selected item.');
  }
  if (interaction.mode === 'forbidden' && (interaction.unitAllocation.length || interaction.physicalPlacement.length)) {
    fail('INVALID_V3_OUTPUT', 'Forbidden human interaction cannot contain allocation or placement.');
  }
  const placed = new Set();
  for (const placement of interaction.physicalPlacement) {
    const itemId = placement?.itemId;
    const allocation = interaction.unitAllocation.find((entry) => entry.itemId === itemId);
    if (!allocation || allocation.humanAllocatedUnits < 1 || placed.has(itemId)) {
      fail('INVALID_V3_OUTPUT', 'Physical placement must reference one unique human-allocated canonical item.');
    }
    text(placement.interactionMode, 'physicalPlacement.interactionMode');
    text(placement.anatomicalAnchor, 'physicalPlacement.anatomicalAnchor', { optional: true });
    text(placement.orientation, 'physicalPlacement.orientation', { optional: true });
    placed.add(itemId);
  }
  for (const allocation of interaction.unitAllocation) {
    if (allocation.humanAllocatedUnits > 0 && !placed.has(allocation.itemId)) {
      fail('INVALID_V3_OUTPUT', 'Every human-allocated item requires one physical placement plan.');
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
    const inferredScope = selected.size === input.productIdentity.items.length
      ? 'complete_set' : selected.size === 1 ? 'single_item_detail' : 'selected_subset';
    const presentationScope = brief.productPresentation.presentationScope ?? inferredScope;
    if (!['complete_set', 'selected_subset', 'single_item_detail'].includes(presentationScope)) {
      fail('INVALID_V3_OUTPUT', 'Invalid product presentation scope.');
    }
    if (brief.campaignRole === 'editorial_craft_detail') {
      if (presentationScope === 'complete_set' && selected.size !== input.productIdentity.items.length) {
        fail('INVALID_V3_OUTPUT', 'Editorial complete-set presentation cannot omit canonical items.');
      }
      if (presentationScope === 'single_item_detail' && selected.size !== 1) {
        fail('INVALID_V3_OUTPUT', 'Editorial single-item detail must select exactly one canonical item.');
      }
      if (presentationScope !== 'complete_set' && !editorialDetailPurposeValid(brief)) {
        fail('INVALID_V3_OUTPUT', 'Editorial subset requires a genuine craft or detail purpose.');
      }
    }
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
    validateHumanPlan(brief, input.productIdentity, selected);
    if (brief.campaignRole === 'contextual_lifestyle' &&
        input.productSemantics.affordances.includes('wearable')) {
      const wearableIds = new Set(input.productSemantics.wearableItemIds);
      if (presence !== 'required' || brief.humanInteraction.mode !== 'required' ||
          !brief.humanInteraction.unitAllocation?.some(({ itemId, humanAllocatedUnits }) =>
            wearableIds.has(itemId) && humanAllocatedUnits > 0)) {
        fail('INVALID_V3_OUTPUT', 'Wearable contextual lifestyle requires realistic human presence with at least one body-worn canonical unit.');
      }
      if (brief.humanInteraction.unitAllocation.some(({ itemId, humanAllocatedUnits }) =>
        humanAllocatedUnits > 0 && !wearableIds.has(itemId))) {
        fail('INVALID_V3_OUTPUT', 'Only confirmed wearable canonical items may receive body-worn allocation.');
      }
      const humanScene = [brief.campaignIdea, brief.visualStory, brief.scene.environment,
        brief.scene.foreground, brief.scene.midground, brief.scene.background].join(' ');
      if (!/\b(?:human|person|model|wearing|worn|on-body|body-worn)\b/i.test(humanScene)) {
        fail('INVALID_V3_OUTPUT', 'Wearable contextual lifestyle scene must visibly include the required human use.');
      }
    }
    if (!V3_COLOR_STRATEGIES.includes(brief.artDirection.colorStrategy)) fail('INVALID_V3_OUTPUT', 'Invalid color strategy.');
    if (brief.creativeFreedom?.productTransformation !== 'forbidden') fail('INVALID_V3_OUTPUT', 'Product transformation must be forbidden.');
    validateConceptSelection(brief, input.productIdentity, selected);
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
  const selection = applyDeterministicV3RoleSelection(rawBriefs, normalizedInput.productIdentity);
  const briefs = validateCreativeDirectorV3Output(selection.briefs, normalizedInput);
  return Object.freeze({
    creativeDirectorVersion: 'v3-experimental', modelAdapterName: text(modelAdapter.name, 'modelAdapter.name'),
    latencyMs: Date.now() - startedAt, proposalCount: briefs.length,
    schemaValid: true, diversityValid: true, fallback: modelAdapter.name.includes('deterministic'), briefs,
    editorialSelectedIds: selection.editorialSelectedIds,
    conceptualSelectedIds: selection.conceptualSelectedIds,
    selectionStrategy: selection.selectionStrategy,
    selectionDeterministic: true,
  });
}
