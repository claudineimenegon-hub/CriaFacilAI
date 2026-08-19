const materialAppearancePattern = /\b(material|metal|finish|polish|polished|matte|gloss|glossy|texture|reflect|reflection|reflective|specular|transparen|translucen|facet|faceted|optical|highlight|brilho|acabamento|polid|fosco|textura|reflex|especular|transpar|transl[uú]cid|faceta|[oó]ptic)\b/i;

function evidence(value) {
  const state = ['known', 'uncertain', 'unknown'].includes(value?.state)
    ? value.state : 'unknown';
  return Object.freeze({ state, value: state === 'unknown' ? null : value?.value ?? null });
}

function knownCount(itemLocks, memberItemIds) {
  const members = memberItemIds.map((id) => itemLocks.find((item) => item.itemId === id));
  if (members.some((item) => !item || item.sourceCount.state !== 'known')) return null;
  return members.reduce((total, item) => total + item.sourceCount.value, 0);
}

export function compileProductFidelityConstraints(identitySpecification) {
  const inventory = identitySpecification?.sourceInventory ?? { items: [], relationships: [] };
  const itemLocks = Object.freeze(inventory.items.map((item) => Object.freeze({
    itemId: item.id,
    functionalType: evidence(item.functionalType),
    sourceCount: evidence(item.quantity),
    observedFeatureIds: Object.freeze(item.observedFeatures.map((feature) => feature.id)),
  })));
  const materialAppearance = Object.freeze(inventory.items.flatMap((item) =>
    item.observedFeatures
      .filter((feature) => materialAppearancePattern.test(`${feature.name} ${feature.value}`))
      .map((feature) => Object.freeze({
        itemId: item.id,
        featureId: feature.id,
        name: feature.name,
        value: feature.value,
        evidence: 'observed',
      }))));
  const relationshipLocks = Object.freeze(inventory.relationships.map((relationship) => {
    const count = knownCount(itemLocks, relationship.memberIds);
    const normalizedType = relationship.type.trim().toLowerCase();
    const isPair = normalizedType === 'pair';
    const consistentPair = isPair && count === 2;
    return Object.freeze({
      type: relationship.type,
      memberItemIds: relationship.memberIds,
      requiredCount: consistentPair ? 2 : isPair ? null : count,
      state: relationship.state === 'known' && (!isPair || consistentPair)
        ? 'known' : 'uncertain',
    });
  }));
  return Object.freeze({
    itemLocks,
    relationshipLocks,
    globalLocks: Object.freeze({
      crossItemMutationForbidden: true,
      contextualScaleMustRemainPlausible: true,
    }),
    materialAppearance,
  });
}

function selectedQuantity(lock, { singleInstance = false } = {}) {
  if (lock.sourceCount.state === 'known') {
    return singleInstance ? 1 : lock.sourceCount.value;
  }
  return null;
}

function selectedItem(lock, options) {
  return Object.freeze({
    itemId: lock.itemId,
    quantity: selectedQuantity(lock, options),
    quantityState: lock.sourceCount.state,
  });
}

export function quantitativeVisibilityIntent(baseIntent, constraints) {
  const locks = constraints?.itemLocks ?? [];
  if (locks.length === 0) {
    return Object.freeze({ ...baseIntent, selectedItems: Object.freeze([]), pairPolicy: 'not_applicable' });
  }
  const fullInventory = baseIntent.mode === 'full_set' || baseIntent.mode === 'contextual_use';
  const singleDetail = baseIntent.mode === 'macro_detail';
  const candidates = fullInventory ? locks : locks.slice(0, 1);
  const selectedItems = Object.freeze(candidates.map((lock) =>
    selectedItem(lock, { singleInstance: singleDetail })));
  const pairLocks = (constraints.relationshipLocks ?? [])
    .filter((relationship) => relationship.type.toLowerCase() === 'pair' && relationship.state === 'known');
  const selectedKnownPair = pairLocks.find((relationship) => relationship.memberItemIds.some((id) =>
    selectedItems.some((item) => item.itemId === id)));
  let pairPolicy = 'not_applicable';
  if (selectedKnownPair) {
    const visiblePairCount = selectedItems
      .filter((item) => selectedKnownPair.memberItemIds.includes(item.itemId))
      .reduce((total, item) => total + (item.quantity ?? 0), 0);
    pairPolicy = visiblePairCount === selectedKnownPair.requiredCount
      ? 'preserve_pair' : 'explicit_single_instance';
  }
  return Object.freeze({ ...baseIntent, selectedItems, pairPolicy });
}

export function summarizeProductFidelityConstraints(constraints, visibilityIntent, { contextual = false } = {}) {
  const items = constraints.itemLocks.map((lock) => {
    const type = lock.functionalType.state === 'known'
      ? lock.functionalType.value : `type-${lock.functionalType.state}`;
    const count = lock.sourceCount.state === 'known'
      ? `${lock.sourceCount.value}x` : `count-${lock.sourceCount.state}`;
    return `${lock.itemId}=${count}${type}`;
  }).join('; ');
  const selected = visibilityIntent.selectedItems.length > 0
    ? visibilityIntent.selectedItems.map((item) =>
      `${item.itemId} x${item.quantity ?? item.quantityState}`).join(', ')
    : 'follow only evidenced reference visibility';
  const knownPairs = constraints.relationshipLocks
    .filter((lock) => lock.type.toLowerCase() === 'pair' && lock.state === 'known')
    .map((lock) => `${lock.memberItemIds.join('+')} must remain a complete pair of ${lock.requiredCount}`);
  const sections = [
    `ITEM LOCKS: ${items || 'unknown inventory; invent no type/count'}. Keep each type/structure; no merge, conversion, substitution, duplication, or cross-item feature transfer.`,
    `VISIBILITY INTENT/LOCK (${visibilityIntent.mode}): ${selected}. ${visibilityIntent.pairPolicy === 'explicit_single_instance'
      ? 'Single pair unit explicitly selected.'
      : knownPairs.length > 0 ? knownPairs.join('; ') + '.' : 'No implicit unit loss.'}`,
    `SCALE LOCK: plausible real size${contextual
      ? ' relative to body/context' : ' in context'}; prominence via framing, depth, contrast, and light—never enlargement. Proportions stay separate.`,
  ];
  if (constraints.relationshipLocks.length > 0) {
    sections.splice(1, 0, `RELATIONSHIP LOCKS: ${constraints.relationshipLocks.map((lock) =>
      `${lock.type}(${lock.memberItemIds.join('+')})=${lock.requiredCount ?? 'count-uncertain'}:${lock.state}`
    ).join('; ')}.`);
  }
  if (constraints.materialAppearance.length > 0) {
    sections.push(`OBSERVED MATERIAL APPEARANCE: ${constraints.materialAppearance.map((feature) =>
      `${feature.itemId}.${feature.name}=${feature.value}`).join('; ')}. Preserve these observed finish/optical traits; invent none.`);
  }
  return Object.freeze(sections);
}
