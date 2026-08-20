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

function fail(message, validationReason = 'invalid_result_shape') {
  const error = new ProductFidelityGuardValidationError(message);
  error.validationReason = validationReason;
  throw error;
}

function assertPlainObject(value, path, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${path} must be an object.`, 'invalid_result_shape');
  }
  const unexpected = Object.keys(value).find((key) => !keys.includes(key));
  if (unexpected) fail(`${path}.${unexpected} is not allowed.`, 'extra_property');
}

function assertApplicableViolation(violation, context, path) {
  if (!context) return;
  const constraints = context.fidelityConstraints ?? {};
  const expectation = context.visibilityExpectation ?? {};
  const itemLock = (constraints.itemLocks ?? []).find(({ itemId }) => itemId === violation.itemId);
  const requiredItem = (expectation.requiredVisibleItems ?? [])
    .find(({ itemId }) => itemId === violation.itemId);
  if (violation.code === 'type_mismatch' && itemLock?.functionalType?.state !== 'known') {
    fail(`${path}.code is not applicable without a known type.`, 'violation_not_applicable');
  }
  if (violation.code === 'count_mismatch' &&
      (!requiredItem || requiredItem.quantityState !== 'known' || !Number.isInteger(requiredItem.quantity))) {
    fail(`${path}.code is not applicable without a known required quantity.`, 'violation_not_applicable');
  }
  if (violation.code === 'relationship_violation' &&
      (expectation.relationshipRequirements ?? []).length === 0) {
    fail(`${path}.code is not applicable without a known required relationship.`, 'violation_not_applicable');
  }
  if (violation.code === 'unexpected_item' && expectation.forbiddenNonCanonicalItems !== true) {
    fail(`${path}.code is not applicable to unknown inventory.`, 'violation_not_applicable');
  }
  if (violation.code === 'structural_mutation' &&
      constraints.globalLocks?.crossItemMutationForbidden !== true) {
    fail(`${path}.code is not applicable without a structural lock.`, 'violation_not_applicable');
  }
  if (violation.code === 'contextual_scale' && expectation.visibilityStrictness !== 'contextual') {
    fail(`${path}.code is not applicable without contextual scale evidence.`, 'violation_not_applicable');
  }
  if (violation.code === 'material_appearance' &&
      !(constraints.materialAppearance ?? []).some(({ itemId }) => itemId === violation.itemId)) {
    fail(`${path}.code is not applicable without observed material evidence.`, 'violation_not_applicable');
  }
}

function normalizedEnum(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

function verifiedResult(verdict, violations) {
  return Object.freeze({
    verdict,
    violations,
    fallback: false,
    fallbackReason: null,
    validationReason: null,
    verificationStatus: verdict === 'uncertain' ? 'model_uncertain' : 'verified',
  });
}

export function validateProductFidelityGuardResult(value, canonicalIdentity, context) {
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    fail('Guard result must be JSON serializable.');
  }
  if (bytes > MAX_RESULT_BYTES) fail('Guard result exceeds the safe limit.', 'response_size_limit');
  assertPlainObject(value, 'guardResult', ['verdict', 'violations']);
  const verdict = normalizedEnum(value.verdict);
  if (!verdicts.has(verdict)) fail('guardResult.verdict is invalid.', 'invalid_verdict');
  if (!Array.isArray(value.violations) || value.violations.length > MAX_VIOLATIONS) {
    fail('guardResult.violations is invalid.', 'invalid_result_shape');
  }
  const itemIds = new Set((canonicalIdentity?.sourceInventory?.items ?? []).map(({ id }) => id));
  const violations = Object.freeze(value.violations.map((violation, index) => {
    const path = `guardResult.violations[${index}]`;
    assertPlainObject(violation, path, ['code', 'itemId', 'confidence']);
    const code = normalizedEnum(violation.code);
    const confidence = normalizedEnum(violation.confidence);
    const itemId = typeof violation.itemId === 'string' ? violation.itemId.trim() : violation.itemId;
    if (!violationCodes.has(code)) fail(`${path}.code is invalid.`, 'invalid_violation_code');
    if (!confidenceValues.has(confidence)) fail(`${path}.confidence is invalid.`, 'invalid_confidence');
    if (itemId === null && code !== 'unexpected_item') {
      fail(`${path}.itemId cannot be null for this violation.`, 'null_item_id_not_allowed');
    }
    if (itemId !== null && (typeof itemId !== 'string' || !itemIds.has(itemId))) {
      fail(`${path}.itemId is invalid.`, 'invalid_item_id');
    }
    const normalized = Object.freeze({
      code,
      itemId,
      confidence,
    });
    assertApplicableViolation(normalized, context, path);
    return normalized;
  }));
  const hasHigh = violations.some(({ confidence }) => confidence === 'high');
  if (verdict === 'pass' && violations.length > 0) {
    fail('PASS cannot contain violations.', 'invalid_verdict_violation_combination');
  }
  if (verdict === 'fail' && !hasHigh) {
    fail('FAIL requires a high-confidence violation.', 'invalid_confidence_combination');
  }
  if (verdict === 'uncertain' && hasHigh) {
    fail('UNCERTAIN cannot contain high-confidence violations.', 'invalid_confidence_combination');
  }
  return verifiedResult(verdict, violations);
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

export function uncertainProductFidelityResult({
  fallback = false,
  fallbackReason = null,
  validationReason = null,
  verificationStatus = fallback ? 'technical_fallback' : 'model_uncertain',
} = {}) {
  return Object.freeze({
    verdict: 'uncertain',
    violations: Object.freeze([]),
    fallback,
    fallbackReason,
    validationReason,
    verificationStatus,
  });
}

export async function inspectProductFidelitySafely(guard, input) {
  try {
    const visibilityExpectation = compileVisibilityExpectation(input);
    const inspected = await guard.inspect(input);
    const validated = validateProductFidelityGuardResult({
      verdict: inspected?.verdict,
      violations: inspected?.violations,
    }, input.canonicalIdentity, {
      fidelityConstraints: input.fidelityConstraints,
      visibilityExpectation,
    });
    if (inspected?.fallback === true) {
      return uncertainProductFidelityResult({
        fallback: true,
        fallbackReason: inspected.fallbackReason ?? 'unexpected_error',
        validationReason: inspected.validationReason ?? null,
        verificationStatus: input.inspectionRetryAttempt === 1
          ? 'unverified' : 'technical_fallback',
      });
    }
    return validated;
  } catch (error) {
    return uncertainProductFidelityResult({
      fallback: true,
      fallbackReason: 'invalid_guard_result',
      validationReason: error?.validationReason ?? null,
    });
  }
}

export class ProductFidelityGuard {
  async inspect() {
    throw new Error('PRODUCT_FIDELITY_GUARD_NOT_IMPLEMENTED');
  }
}

export class UnknownProductFidelityGuard extends ProductFidelityGuard {
  async inspect() {
    return uncertainProductFidelityResult({ fallback: true, fallbackReason: 'not_configured' });
  }
}

export const PRODUCT_FIDELITY_GUARD_LIMITS = Object.freeze({
  violations: MAX_VIOLATIONS,
  resultBytes: MAX_RESULT_BYTES,
});
