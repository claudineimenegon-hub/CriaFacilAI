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

function normalizeItem(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  const id = safeToken(item.id, 40) ?? `source-item-${index + 1}`;
  const type = safeToken(item.functionalType ?? item.type);
  const typeState = type ? (evidenceStates.has(item.typeState) ? item.typeState : 'known') : 'unknown';
  const quantity = Number.isInteger(item.quantity) && item.quantity > 0
    ? item.quantity
    : null;
  const quantityState = quantity == null
    ? 'unknown'
    : evidenceStates.has(item.quantityState) ? item.quantityState : 'known';
  return Object.freeze({
    id,
    functionalType: evidenceValue(type, typeState),
    quantity: evidenceValue(quantity, quantityState),
    attributes: Object.freeze(normalizeAttributes(item.attributes)),
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
    version: 1,
    sourceInventory: Object.freeze({
      state: inventoryState,
      items: Object.freeze(items),
      relationships: Object.freeze(relationships),
      observationRequired: inventoryState !== 'known',
    }),
    productIdentity: Object.freeze({
      category: evidenceValue(categoryValue === 'general' ? null : categoryValue, categoryState),
      stableAcrossScenes: true,
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
  const relationships = inventory.relationships.length > 0
    ? ` Relations: ${inventory.relationships.map(({ type, memberIds }) =>
      `${type}(${memberIds.join('+')})`).join(', ')}.`
    : '';
  return `SOURCE INVENTORY (${inventory.state}): ${items}.${relationships}`;
}

export const PRODUCT_IDENTITY_EVIDENCE_STATES = Object.freeze([...evidenceStates]);
