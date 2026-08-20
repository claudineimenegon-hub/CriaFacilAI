const verdicts = new Set(['pass', 'fail', 'uncertain']);
const confidenceValues = new Set(['high', 'medium', 'low']);
export const PRODUCT_FIDELITY_VIOLATION_CODES = Object.freeze([
  'type_mismatch',
  'count_mismatch',
  'relationship_violation',
  'unexpected_item',
  'structural_mutation',
  'contextual_scale',
  'material_appearance',
]);
const violationCodes = new Set(PRODUCT_FIDELITY_VIOLATION_CODES);
const MAX_VIOLATIONS = 12;
const MAX_RESULT_BYTES = 16 * 1024;

export class ProductFidelityGuardValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProductFidelityGuardValidationError';
    this.code = 'INVALID_PRODUCT_FIDELITY_GUARD_RESULT';
  }
}

export class ProductFidelityGuardFailureError extends Error {
  constructor({ proposalIndex, result }) {
    super('PRODUCT_FIDELITY_GUARD_REJECTED');
    this.name = 'ProductFidelityGuardFailureError';
    this.code = 'PRODUCT_FIDELITY_GUARD_REJECTED';
    this.proposalIndex = proposalIndex;
    this.guardResult = result;
  }
}

function fail(message) {
  throw new ProductFidelityGuardValidationError(message);
}

function assertPlainObject(value, path, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object.`);
  const unexpected = Object.keys(value).find((key) => !keys.includes(key));
  if (unexpected) fail(`${path}.${unexpected} is not allowed.`);
}

function assertApplicableViolation(violation, context, path) {
  if (!context) return;
  const constraints = context.fidelityConstraints ?? {};
  const expectation = context.visibilityExpectation ?? {};
  const itemLock = (constraints.itemLocks ?? []).find(({ itemId }) => itemId === violation.itemId);
  const requiredItem = (expectation.requiredVisibleItems ?? [])
    .find(({ itemId }) => itemId === violation.itemId);
  if (violation.code === 'type_mismatch' && itemLock?.functionalType?.state !== 'known') {
    fail(`${path}.code is not applicable without a known type.`);
  }
  if (violation.code === 'count_mismatch' &&
      (!requiredItem || requiredItem.quantityState !== 'known' || !Number.isInteger(requiredItem.quantity))) {
    fail(`${path}.code is not applicable without a known required quantity.`);
  }
  if (violation.code === 'relationship_violation' &&
      (expectation.relationshipRequirements ?? []).length === 0) {
    fail(`${path}.code is not applicable without a known required relationship.`);
  }
  if (violation.code === 'unexpected_item' && expectation.forbiddenNonCanonicalItems !== true) {
    fail(`${path}.code is not applicable to unknown inventory.`);
  }
  if (violation.code === 'structural_mutation' &&
      constraints.globalLocks?.crossItemMutationForbidden !== true) {
    fail(`${path}.code is not applicable without a structural lock.`);
  }
  if (violation.code === 'contextual_scale' && expectation.visibilityStrictness !== 'contextual') {
    fail(`${path}.code is not applicable without contextual scale evidence.`);
  }
  if (violation.code === 'material_appearance' &&
      !(constraints.materialAppearance ?? []).some(({ itemId }) => itemId === violation.itemId)) {
    fail(`${path}.code is not applicable without observed material evidence.`);
  }
}

export function validateProductFidelityGuardResult(value, canonicalIdentity, context) {
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    fail('Guard result must be JSON serializable.');
  }
  if (bytes > MAX_RESULT_BYTES) fail('Guard result exceeds the safe limit.');
  assertPlainObject(value, 'guardResult', ['verdict', 'violations']);
  if (!verdicts.has(value.verdict)) fail('guardResult.verdict is invalid.');
  if (!Array.isArray(value.violations) || value.violations.length > MAX_VIOLATIONS) {
    fail('guardResult.violations is invalid.');
  }
  const itemIds = new Set((canonicalIdentity?.sourceInventory?.items ?? []).map(({ id }) => id));
  const violations = Object.freeze(value.violations.map((violation, index) => {
    const path = `guardResult.violations[${index}]`;
    assertPlainObject(violation, path, ['code', 'itemId', 'confidence']);
    if (!violationCodes.has(violation.code)) fail(`${path}.code is invalid.`);
    if (!confidenceValues.has(violation.confidence)) fail(`${path}.confidence is invalid.`);
    if (violation.itemId !== null &&
        (typeof violation.itemId !== 'string' || !itemIds.has(violation.itemId))) {
      fail(`${path}.itemId is invalid.`);
    }
    const normalized = Object.freeze({
      code: violation.code,
      itemId: violation.itemId,
      confidence: violation.confidence,
    });
    assertApplicableViolation(normalized, context, path);
    return normalized;
  }));
  const hasHigh = violations.some(({ confidence }) => confidence === 'high');
  if (value.verdict === 'pass' && violations.length > 0) fail('PASS cannot contain violations.');
  if (value.verdict === 'fail' && !hasHigh) fail('FAIL requires a high-confidence violation.');
  if (value.verdict === 'uncertain' && hasHigh) fail('UNCERTAIN cannot contain high-confidence violations.');
  return Object.freeze({ verdict: value.verdict, violations });
}

function selectedMap(visibilityIntent) {
  return new Map((visibilityIntent?.selectedItems ?? []).map((item) => [item.itemId, item]));
}

export function compileVisibilityExpectation({
  canonicalIdentity, fidelityConstraints, visibilityIntent,
} = {}) {
  const locks = fidelityConstraints?.itemLocks ?? [];
  const selected = selectedMap(visibilityIntent);
  const strictness = visibilityIntent?.mode === 'macro_detail' ? 'macro'
    : visibilityIntent?.mode === 'contextual_use' ? 'contextual' : 'strict';
  const requiredVisibleItems = locks
    .filter((lock) => selected.has(lock.itemId))
    .map((lock) => {
      const selection = selected.get(lock.itemId);
      return Object.freeze({
        itemId: lock.itemId,
        quantity: Number.isInteger(selection.quantity) ? selection.quantity : null,
        quantityState: selection.quantityState ?? lock.sourceCount.state,
      });
    });
  const optionalCanonicalItems = locks
    .filter((lock) => !selected.has(lock.itemId))
    .map((lock) => Object.freeze({
      itemId: lock.itemId,
      maxQuantity: lock.sourceCount.state === 'known' ? lock.sourceCount.value : null,
    }));
  const relationshipRequirements = (fidelityConstraints?.relationshipLocks ?? [])
    .filter((lock) => lock.state === 'known' &&
      visibilityIntent?.pairPolicy === 'preserve_pair' &&
      lock.memberItemIds.some((id) => selected.has(id)))
    .map((lock) => Object.freeze({
      type: lock.type,
      memberItemIds: lock.memberItemIds,
      requiredCount: lock.requiredCount,
    }));
  return Object.freeze({
    requiredVisibleItems: Object.freeze(requiredVisibleItems),
    optionalCanonicalItems: Object.freeze(optionalCanonicalItems),
    forbiddenNonCanonicalItems: canonicalIdentity?.sourceInventory?.state === 'known',
    pairPolicy: ['preserve_pair', 'explicit_single_instance'].includes(visibilityIntent?.pairPolicy)
      ? visibilityIntent.pairPolicy : 'not_applicable',
    visibilityStrictness: strictness,
    relationshipRequirements: Object.freeze(relationshipRequirements),
  });
}

export function uncertainProductFidelityResult() {
  return Object.freeze({ verdict: 'uncertain', violations: Object.freeze([]) });
}

export async function inspectProductFidelitySafely(guard, input) {
  try {
    const visibilityExpectation = compileVisibilityExpectation(input);
    return validateProductFidelityGuardResult(await guard.inspect(input), input.canonicalIdentity, {
      fidelityConstraints: input.fidelityConstraints,
      visibilityExpectation,
    });
  } catch {
    return uncertainProductFidelityResult();
  }
}

export class ProductFidelityGuard {
  async inspect() {
    throw new Error('PRODUCT_FIDELITY_GUARD_NOT_IMPLEMENTED');
  }
}

export class UnknownProductFidelityGuard extends ProductFidelityGuard {
  async inspect() {
    return uncertainProductFidelityResult();
  }
}

export const PRODUCT_FIDELITY_GUARD_LIMITS = Object.freeze({
  violations: MAX_VIOLATIONS,
  resultBytes: MAX_RESULT_BYTES,
});
