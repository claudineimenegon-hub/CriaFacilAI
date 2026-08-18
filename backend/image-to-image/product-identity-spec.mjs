const evidenceStates = new Set(['known', 'uncertain', 'unknown']);

function evidenceValue(value, state = value == null ? 'unknown' : 'known') {
  const normalizedState = evidenceStates.has(state) ? state : 'unknown';
  return Object.freeze({
    state: normalizedState,
    value: normalizedState === 'unknown' ? null : value,
  });
}

function safeToken(value, maxLength = 80) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().slice(0, maxLength);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return [];
  return Object.entries(attributes).slice(0, 12).map(([name, evidence]) => {
    const safeName = safeToken(name, 40);
    if (!safeName) return undefined;
    if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
      return Object.freeze({
        name: safeName,
        ...evidenceValue(safeToken(evidence.value), evidence.state),
        commerciallyImportant: evidence.commerciallyImportant === true,
      });
    }
    return Object.freeze({
      name: safeName,
      ...evidenceValue(safeToken(evidence)),
      commerciallyImportant: false,
    });
  }).filter(Boolean);
}

function normalizeObservedFeatures(features) {
  if (!Array.isArray(features)) return [];
  return features.slice(0, 16).map((feature, index) => {
    if (!feature || typeof feature !== 'object' || Array.isArray(feature)) return undefined;
    const name = safeToken(feature.name, 40) ?? `observed-feature-${index + 1}`;
    const value = safeToken(feature.value, 120);
    if (!value) return undefined;
    return Object.freeze({
      id: safeToken(feature.id, 40) ?? name,
      name,
      value,
      evidence: 'observed',
      immutable: true,
    });
  }).filter(Boolean);
}

function normalizeAmbiguousFeatures(features) {
  if (!Array.isArray(features)) return [];
  return features.slice(0, 12).map((feature, index) => {
    if (!feature || typeof feature !== 'object' || Array.isArray(feature)) return undefined;
    const name = safeToken(feature.name, 40) ?? `hidden-feature-${index + 1}`;
    const candidates = Array.isArray(feature.plausibleHypotheses)
      ? feature.plausibleHypotheses.map((value) => safeToken(value, 120)).filter(Boolean).slice(0, 4)
      : [];
    const suppliedHypothesis = safeToken(feature.canonicalHypothesis, 120);
    const canonicalValue = suppliedHypothesis ?? candidates[0] ??
      'minimal continuous completion consistent with all observed evidence';
    return Object.freeze({
      id: safeToken(feature.id, 40) ?? name,
      name,
      visibility: feature.visibility === 'partial' ? 'partial' : 'hidden',
      observedConstraint: safeToken(feature.observedConstraint, 100) ?? null,
      evidence: 'ambiguous',
      canonicalHypothesis: Object.freeze({
        value: canonicalValue,
        confidence: 'uncertain',
        provenance: suppliedHypothesis ? 'supplied_hypothesis'
          : candidates.length > 0 ? 'deterministic_candidate_selection' : 'conservative_default',
      }),
    });
  }).filter(Boolean);
}

function normalizeItem(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  const id = safeToken(item.id, 40) ?? `source-item-${index + 1}`;
  const suppliedType = item.functionalType && typeof item.functionalType === 'object'
    ? item.functionalType : undefined;
  const type = safeToken(suppliedType?.value ?? item.functionalType ?? item.type);
  const typeState = type
    ? (evidenceStates.has(suppliedType?.state ?? item.typeState)
      ? (suppliedType?.state ?? item.typeState) : 'known')
    : 'unknown';
  const suppliedQuantity = item.quantity && typeof item.quantity === 'object'
    ? item.quantity : undefined;
  const quantityValue = suppliedQuantity?.value ?? item.quantity;
  const quantity = Number.isInteger(quantityValue) && quantityValue > 0
    ? quantityValue
    : null;
  const quantityState = quantity == null
    ? 'unknown'
    : evidenceStates.has(suppliedQuantity?.state ?? item.quantityState)
      ? (suppliedQuantity?.state ?? item.quantityState) : 'known';
  return Object.freeze({
    id,
    functionalType: evidenceValue(type, typeState),
    quantity: evidenceValue(quantity, quantityState),
    attributes: Object.freeze(normalizeAttributes(item.attributes)),
    observationCompleteness: ['complete', 'partial', 'unknown'].includes(item.observationCompleteness)
      ? item.observationCompleteness : 'unknown',
    observedFeatures: Object.freeze(normalizeObservedFeatures(item.observedFeatures)),
    ambiguousFeatures: Object.freeze(item.observationCompleteness === 'complete'
      ? []
      : normalizeAmbiguousFeatures(item.ambiguousFeatures)),
  });
}

function normalizeRelationship(relationship) {
  if (!relationship || typeof relationship !== 'object' || Array.isArray(relationship)) {
    return undefined;
  }
  const type = safeToken(relationship.type, 40);
  const memberIds = Array.isArray(relationship.memberIds)
    ? relationship.memberIds.map((id) => safeToken(id, 40)).filter(Boolean).slice(0, 8)
    : [];
  if (!type || memberIds.length < 1) return undefined;
  return Object.freeze({
    type,
    memberIds: Object.freeze(memberIds),
    state: evidenceStates.has(relationship.state) ? relationship.state : 'known',
  });
}

export function createProductIdentitySpecification({
  category = 'general',
  sourceInventory,
  preservation = {},
} = {}) {
  const suppliedInventory = sourceInventory && typeof sourceInventory === 'object' &&
    !Array.isArray(sourceInventory) ? sourceInventory : {};
  const items = Array.isArray(suppliedInventory.items)
    ? suppliedInventory.items.map(normalizeItem).filter(Boolean).slice(0, 16)
    : [];
  const relationships = Array.isArray(suppliedInventory.relationships)
    ? suppliedInventory.relationships.map(normalizeRelationship).filter(Boolean).slice(0, 16)
    : [];
  const categoryValue = safeToken(category, 40);
  const categoryState = categoryValue && categoryValue !== 'general' ? 'uncertain' : 'unknown';
  const inventoryState = items.length === 0
    ? 'unknown'
    : evidenceStates.has(suppliedInventory.state) ? suppliedInventory.state : 'uncertain';
  const protectedAttributes = Object.entries(preservation)
    .filter(([key, value]) => key.startsWith('preserve') && value === true)
    .map(([key]) => key)
    .sort();

  return Object.freeze({
    version: 2,
    sourceInventory: Object.freeze({
      state: inventoryState,
      items: Object.freeze(items),
      relationships: Object.freeze(relationships),
      observationRequired: inventoryState !== 'known',
    }),
    productIdentity: Object.freeze({
      category: evidenceValue(categoryValue === 'general' ? null : categoryValue, categoryState),
      stableAcrossScenes: true,
      canonicalForGeneration: true,
      observedEvidenceImmutable: true,
      protectedAttributes: Object.freeze(protectedAttributes),
    }),
  });
}

export function summarizeProductIdentitySpecification(specification) {
  const inventory = specification.sourceInventory;
  if (inventory.items.length === 0) {
    return [
      `SOURCE INVENTORY: ${inventory.state.toUpperCase()}.`,
      'Observe the reference; do not invent type, count, relations, or attributes.',
    ].join(' ');
  }
  const items = inventory.items.map((item) => {
    const type = item.functionalType.value ?? 'unknown-type';
    const quantity = item.quantity.value == null ? 'quantity-unknown' : `qty-${item.quantity.value}`;
    return `${item.id}:${type}:${quantity}`;
  }).join(', ');
  const observed = inventory.items.flatMap((item) => item.observedFeatures
    .map((feature) => `${item.id}.${feature.name}=${feature.value}`));
  const hypotheses = inventory.items.flatMap((item) => item.ambiguousFeatures
    .map((feature) => `${item.id}.${feature.name}=${feature.canonicalHypothesis.value}`));
  const relationships = inventory.relationships.length > 0
    ? ` Relations: ${inventory.relationships.map(({ type, memberIds }) =>
      `${type}(${memberIds.join('+')})`).join(', ')}.`
    : '';
  return [
    `SOURCE INVENTORY (${inventory.state}): ${items}.${relationships}`,
    observed.length > 0 ? `OBSERVED IMMUTABLE: ${observed.join(', ')}.` : null,
    hypotheses.length > 0
      ? `CANONICAL HIDDEN HYPOTHESES (UNCERTAIN; SHARED BY ALL PROPOSALS): ${hypotheses.join(', ')}. Do not reinterpret independently.`
      : null,
  ].filter(Boolean).join(' ');
}

export const PRODUCT_IDENTITY_EVIDENCE_STATES = Object.freeze([...evidenceStates]);
