const states = new Set(['known', 'uncertain', 'unknown']);
const completenessValues = new Set(['complete', 'partial', 'unknown']);
const visibilityValues = new Set(['partial', 'hidden']);
const relativeScaleRelations = new Set([
  'slightly_larger', 'approximately_same', 'clearly_larger', 'significantly_smaller',
]);
const confidenceValues = new Set(['high', 'medium', 'low']);

export const PRODUCT_IDENTITY_ANALYSIS_LIMITS = Object.freeze({
  encodedBytes: 32 * 1024,
  items: 16,
  relationships: 16,
  observedFeaturesPerItem: 16,
  ambiguousFeaturesPerItem: 12,
  hypothesesPerFeature: 4,
  tokenCharacters: 120,
});

export class ProductIdentityAnalysisValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProductIdentityAnalysisValidationError';
    this.code = 'INVALID_PRODUCT_IDENTITY_ANALYSIS';
  }
}

function fail(message) {
  throw new ProductIdentityAnalysisValidationError(message);
}

function assertPlainObject(value, path, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object.`);
  const unexpected = Object.keys(value).find((key) => !allowedKeys.includes(key));
  if (unexpected) fail(`${path}.${unexpected} is not allowed.`);
}

function validateToken(value, path, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string') fail(`${path} must be a string.`);
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > PRODUCT_IDENTITY_ANALYSIS_LIMITS.tokenCharacters) {
    fail(`${path} has an invalid length.`);
  }
  return normalized;
}

function validateEvidence(value, path, { quantity = false } = {}) {
  assertPlainObject(value, path, ['state', 'value']);
  if (!states.has(value.state)) fail(`${path}.state is invalid.`);
  const normalizedValue = quantity
    ? value.value
    : value.value === null ? null : validateToken(value.value, `${path}.value`);
  if (quantity && normalizedValue !== null &&
      (!Number.isInteger(normalizedValue) || normalizedValue < 1 || normalizedValue > 1000)) {
    fail(`${path}.value must be an integer between 1 and 1000.`);
  }
  if (value.state === 'unknown' && normalizedValue !== null) fail(`${path}.value must be null when unknown.`);
  if (value.state !== 'unknown' && normalizedValue === null) fail(`${path}.value is required when known or uncertain.`);
  return Object.freeze({ state: value.state, value: normalizedValue });
}

function validateObservedFeature(value, path) {
  assertPlainObject(value, path, ['id', 'name', 'value']);
  return Object.freeze({
    ...(value.id == null ? {} : { id: validateToken(value.id, `${path}.id`) }),
    name: validateToken(value.name, `${path}.name`),
    value: validateToken(value.value, `${path}.value`),
  });
}

function validateAmbiguousFeature(value, path) {
  assertPlainObject(value, path, [
    'id', 'name', 'visibility', 'observedConstraint', 'plausibleHypotheses',
  ]);
  const visibility = value.visibility ?? 'hidden';
  if (!visibilityValues.has(visibility)) fail(`${path}.visibility is invalid.`);
  const hypotheses = value.plausibleHypotheses ?? [];
  if (!Array.isArray(hypotheses) ||
      hypotheses.length > PRODUCT_IDENTITY_ANALYSIS_LIMITS.hypothesesPerFeature) {
    fail(`${path}.plausibleHypotheses is invalid.`);
  }
  return Object.freeze({
    ...(value.id == null ? {} : { id: validateToken(value.id, `${path}.id`) }),
    name: validateToken(value.name, `${path}.name`),
    visibility,
    observedConstraint: value.observedConstraint == null
      ? null : validateToken(value.observedConstraint, `${path}.observedConstraint`),
    plausibleHypotheses: Object.freeze(hypotheses.map((entry, index) =>
      validateToken(entry, `${path}.plausibleHypotheses[${index}]`))),
  });
}

function validateItem(value, index) {
  const path = `items[${index}]`;
  assertPlainObject(value, path, [
    'id', 'functionalType', 'quantity', 'observationCompleteness',
    'observedFeatures', 'ambiguousFeatures',
  ]);
  if (!completenessValues.has(value.observationCompleteness)) {
    fail(`${path}.observationCompleteness is invalid.`);
  }
  const observedFeatures = value.observedFeatures ?? [];
  const ambiguousFeatures = value.ambiguousFeatures ?? [];
  if (!Array.isArray(observedFeatures) ||
      observedFeatures.length > PRODUCT_IDENTITY_ANALYSIS_LIMITS.observedFeaturesPerItem) {
    fail(`${path}.observedFeatures is invalid.`);
  }
  if (!Array.isArray(ambiguousFeatures) ||
      ambiguousFeatures.length > PRODUCT_IDENTITY_ANALYSIS_LIMITS.ambiguousFeaturesPerItem) {
    fail(`${path}.ambiguousFeatures is invalid.`);
  }
  if (value.observationCompleteness === 'complete' && ambiguousFeatures.length > 0) {
    fail(`${path} cannot be complete and contain ambiguous features.`);
  }
  return Object.freeze({
    id: validateToken(value.id, `${path}.id`),
    functionalType: validateEvidence(value.functionalType, `${path}.functionalType`),
    quantity: validateEvidence(value.quantity, `${path}.quantity`, { quantity: true }),
    observationCompleteness: value.observationCompleteness,
    observedFeatures: Object.freeze(observedFeatures.map(validateObservedFeature)),
    ambiguousFeatures: Object.freeze(ambiguousFeatures.map(validateAmbiguousFeature)),
  });
}

function validateRelationship(value, index, itemIds) {
  const path = `relationships[${index}]`;
  assertPlainObject(value, path, ['type', 'memberIds', 'state']);
  if (!states.has(value.state)) fail(`${path}.state is invalid.`);
  if (!Array.isArray(value.memberIds) || value.memberIds.length < 1 || value.memberIds.length > 16) {
    fail(`${path}.memberIds is invalid.`);
  }
  const memberIds = value.memberIds.map((entry, memberIndex) =>
    validateToken(entry, `${path}.memberIds[${memberIndex}]`));
  if (memberIds.some((id) => !itemIds.has(id))) fail(`${path} references an unknown item.`);
  return Object.freeze({
    type: validateToken(value.type, `${path}.type`),
    memberIds: Object.freeze(memberIds),
    state: value.state,
  });
}

function validateRelativeScale(value, itemIds) {
  if (!Array.isArray(value) || value.length > 16) fail('analysis.relativeScale is invalid.');
  if (itemIds.size < 2 && value.length > 0) fail('Relative scale requires multiple canonical items.');
  const comparedPairs = new Map();
  return Object.freeze(value.map((entry, index) => {
    const path = `relativeScale[${index}]`;
    assertPlainObject(entry, path, ['subjectId', 'referenceId', 'relation', 'confidence']);
    const subjectId = validateToken(entry.subjectId, `${path}.subjectId`);
    const referenceId = validateToken(entry.referenceId, `${path}.referenceId`);
    if (subjectId === referenceId || !itemIds.has(subjectId) || !itemIds.has(referenceId)) {
      fail(`${path} references invalid canonical items.`);
    }
    if (!relativeScaleRelations.has(entry.relation)) fail(`${path}.relation is invalid.`);
    if (!confidenceValues.has(entry.confidence)) fail(`${path}.confidence is invalid.`);
    const pairKey = [subjectId, referenceId].sort().join('\u0000');
    const signature = `${subjectId}\u0000${referenceId}\u0000${entry.relation}\u0000${entry.confidence}`;
    if (comparedPairs.has(pairKey)) {
      fail(comparedPairs.get(pairKey) === signature
        ? `${path} duplicates an existing relative scale comparison.`
        : `${path} contradicts an existing relative scale comparison.`);
    }
    comparedPairs.set(pairKey, signature);
    return Object.freeze({ subjectId, referenceId, relation: entry.relation, confidence: entry.confidence });
  }));
}

export function unknownProductIdentityAnalysis() {
  return Object.freeze({
    state: 'unknown',
    items: Object.freeze([]),
    relationships: Object.freeze([]),
  });
}

export function validateProductIdentityAnalysis(value) {
  let encodedBytes;
  try {
    encodedBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    fail('Analysis must be JSON serializable.');
  }
  if (encodedBytes > PRODUCT_IDENTITY_ANALYSIS_LIMITS.encodedBytes) {
    fail('Analysis exceeds the encoded size limit.');
  }
  assertPlainObject(value, 'analysis', ['state', 'items', 'relationships', 'relativeScale']);
  if (!states.has(value.state)) fail('analysis.state is invalid.');
  if (!Array.isArray(value.items) || value.items.length > PRODUCT_IDENTITY_ANALYSIS_LIMITS.items) {
    fail('analysis.items is invalid.');
  }
  if (!Array.isArray(value.relationships) ||
      value.relationships.length > PRODUCT_IDENTITY_ANALYSIS_LIMITS.relationships) {
    fail('analysis.relationships is invalid.');
  }
  if (value.state === 'unknown' && (value.items.length > 0 || value.relationships.length > 0)) {
    fail('Unknown analysis must not contain inventory.');
  }
  const items = Object.freeze(value.items.map(validateItem));
  const itemIds = new Set(items.map(({ id }) => id));
  if (itemIds.size !== items.length) fail('Item IDs must be unique.');
  const relationships = Object.freeze(value.relationships.map((entry, index) =>
    validateRelationship(entry, index, itemIds)));
  const relativeScale = value.relativeScale === undefined
    ? undefined : validateRelativeScale(value.relativeScale, itemIds);
  return Object.freeze({
    state: value.state, items, relationships,
    ...(relativeScale === undefined ? {} : { relativeScale }),
  });
}

export class ProductIdentityAnalyzer {
  async analyze({ inputs, declaredCategory, userBrief, cacheKey } = {}) {
    void inputs;
    void declaredCategory;
    void userBrief;
    void cacheKey;
    throw new Error('PRODUCT_IDENTITY_ANALYZER_NOT_IMPLEMENTED');
  }
}

export class UnknownProductIdentityAnalyzer extends ProductIdentityAnalyzer {
  async analyze() {
    return unknownProductIdentityAnalysis();
  }
}
