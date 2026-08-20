import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileVisibilityExpectation,
  inspectProductFidelitySafely,
  PRODUCT_FIDELITY_GUARD_LIMITS,
  ProductFidelityGuardValidationError,
  validateProductFidelityGuardResult,
} from '../image-to-image/product-fidelity-guard.mjs';
import { createProductIdentitySpecification } from '../image-to-image/product-identity-spec.mjs';
import { compileProductFidelityConstraints } from '../image-to-image/product-fidelity-constraints.mjs';

function identity() {
  return createProductIdentitySpecification({
    category: 'jewelry',
    sourceInventory: {
      state: 'known',
      items: [
        { id: 'ring', functionalType: { state: 'known', value: 'ring' }, quantity: { state: 'known', value: 1 }, observationCompleteness: 'complete', observedFeatures: [{ id: 'gold', name: 'material', value: 'polished gold' }] },
        { id: 'earring-a', functionalType: { state: 'known', value: 'earring' }, quantity: { state: 'known', value: 1 }, observationCompleteness: 'complete' },
        { id: 'earring-b', functionalType: { state: 'known', value: 'earring' }, quantity: { state: 'known', value: 1 }, observationCompleteness: 'complete' },
      ],
      relationships: [{ type: 'pair', memberIds: ['earring-a', 'earring-b'], state: 'known' }],
    },
  });
}

const validViolations = [
  { code: 'unexpected_item', itemId: null, confidence: 'high' },
];

test('valida PASS, FAIL e UNCERTAIN conservadores', () => {
  const canonical = identity();
  assert.deepEqual(validateProductFidelityGuardResult({ verdict: 'pass', violations: [] }, canonical), {
    verdict: 'pass', violations: [], fallback: false, fallbackReason: null,
    validationReason: null, verificationStatus: 'verified',
  });
  assert.equal(validateProductFidelityGuardResult({
    verdict: 'fail', violations: validViolations,
  }, canonical).verdict, 'fail');
  assert.equal(validateProductFidelityGuardResult({
    verdict: 'uncertain',
    violations: [{ code: 'contextual_scale', itemId: 'ring', confidence: 'medium' }],
  }, canonical).verdict, 'uncertain');
});

test('rejeita enums, IDs, extras e invariantes inválidas', () => {
  const canonical = identity();
  for (const value of [
    { verdict: 'fail', violations: [{ code: 'beauty', itemId: null, confidence: 'high' }] },
    { verdict: 'fail', violations: [{ code: 'unexpected_item', itemId: null, confidence: 'certain' }] },
    { verdict: 'fail', violations: [{ code: 'unexpected_item', itemId: 'missing', confidence: 'high' }] },
    { verdict: 'pass', violations: validViolations },
    { verdict: 'fail', violations: [{ code: 'count_mismatch', itemId: 'ring', confidence: 'medium' }] },
    { verdict: 'uncertain', violations: validViolations },
    { verdict: 'pass', violations: [], extra: true },
    { verdict: 'fail', violations: [{ ...validViolations[0], extra: true }] },
  ]) {
    assert.throws(() => validateProductFidelityGuardResult(value, canonical),
      ProductFidelityGuardValidationError);
  }
});

test('impõe limites de violations e resposta', () => {
  const canonical = identity();
  assert.throws(() => validateProductFidelityGuardResult({
    verdict: 'fail',
    violations: Array.from({ length: PRODUCT_FIDELITY_GUARD_LIMITS.violations + 1 }, () => validViolations[0]),
  }, canonical), ProductFidelityGuardValidationError);
  assert.throws(() => validateProductFidelityGuardResult({
    verdict: 'pass', violations: [], padding: 'x'.repeat(PRODUCT_FIDELITY_GUARD_LIMITS.resultBytes),
  }, canonical), ProductFidelityGuardValidationError);
});

test('compila full set e preserve_pair como requisitos estritos', () => {
  const canonical = identity();
  const constraints = compileProductFidelityConstraints(canonical);
  const expectation = compileVisibilityExpectation({
    canonicalIdentity: canonical,
    fidelityConstraints: constraints,
    visibilityIntent: {
      mode: 'full_set', pairPolicy: 'preserve_pair',
      selectedItems: constraints.itemLocks.map((lock) => ({
        itemId: lock.itemId, quantity: lock.sourceCount.value, quantityState: lock.sourceCount.state,
      })),
    },
  });
  assert.deepEqual(expectation.requiredVisibleItems.map(({ itemId }) => itemId),
    ['ring', 'earring-a', 'earring-b']);
  assert.equal(expectation.optionalCanonicalItems.length, 0);
  assert.equal(expectation.relationshipRequirements[0].requiredCount, 2);
  assert.equal(expectation.visibilityStrictness, 'strict');
});

test('respeita explicit_single_instance, hero item, opcionais e macro', () => {
  const canonical = identity();
  const constraints = compileProductFidelityConstraints(canonical);
  const expectation = compileVisibilityExpectation({
    canonicalIdentity: canonical,
    fidelityConstraints: constraints,
    visibilityIntent: {
      mode: 'macro_detail', pairPolicy: 'explicit_single_instance',
      selectedItems: [{ itemId: 'earring-a', quantity: 1, quantityState: 'known' }],
    },
  });
  assert.deepEqual(expectation.requiredVisibleItems, [
    { itemId: 'earring-a', quantity: 1, quantityState: 'known' },
  ]);
  assert.deepEqual(expectation.optionalCanonicalItems.map(({ itemId }) => itemId), ['ring', 'earring-b']);
  assert.equal(expectation.relationshipRequirements.length, 0);
  assert.equal(expectation.pairPolicy, 'explicit_single_instance');
  assert.equal(expectation.visibilityStrictness, 'macro');
});

test('relação uncertain não cria cardinalidade obrigatória', () => {
  const canonical = createProductIdentitySpecification({
    sourceInventory: {
      state: 'known',
      items: [{ id: 'a', functionalType: { state: 'known', value: 'item' }, quantity: { state: 'known', value: 1 }, observationCompleteness: 'complete' }],
      relationships: [{ type: 'set', memberIds: ['a'], state: 'uncertain' }],
    },
  });
  const constraints = compileProductFidelityConstraints(canonical);
  const expectation = compileVisibilityExpectation({
    canonicalIdentity: canonical, fidelityConstraints: constraints,
    visibilityIntent: { mode: 'full_set', pairPolicy: 'preserve_pair', selectedItems: [{ itemId: 'a', quantity: 1, quantityState: 'known' }] },
  });
  assert.equal(expectation.relationshipRequirements.length, 0);
});

test('falha técnica do Guard vira UNCERTAIN sem regeneração implícita', async () => {
  const result = await inspectProductFidelitySafely({ inspect: async () => { throw new Error('technical'); } }, {
    canonicalIdentity: identity(),
  });
  assert.deepEqual(result, {
    verdict: 'uncertain', violations: [], fallback: true,
    fallbackReason: 'invalid_guard_result', validationReason: null,
    verificationStatus: 'technical_fallback',
  });
});

test('normaliza apenas caixa/espaço inequívocos e classifica rejeições locais', () => {
  const canonical = identity();
  const normalized = validateProductFidelityGuardResult({
    verdict: ' FAIL ',
    violations: [{ code: ' TYPE_MISMATCH ', itemId: ' ring ', confidence: ' HIGH ' }],
  }, canonical, {
    fidelityConstraints: compileProductFidelityConstraints(canonical),
    visibilityExpectation: { requiredVisibleItems: [{ itemId: 'ring', quantity: 1, quantityState: 'known' }] },
  });
  assert.equal(normalized.verdict, 'fail');
  assert.deepEqual(normalized.violations[0], {
    code: 'type_mismatch', itemId: 'ring', confidence: 'high',
  });
  for (const [value, reason] of [
    [{ verdict: 'fail', violations: [{ code: 'type_mismatch', itemId: 'missing', confidence: 'high' }] }, 'invalid_item_id'],
    [{ verdict: 'fail', violations: [{ code: 'type_mismatch', itemId: null, confidence: 'high' }] }, 'null_item_id_not_allowed'],
    [{ verdict: 'pass', violations: validViolations }, 'invalid_verdict_violation_combination'],
    [{ verdict: 'fail', violations: [{ code: 'count_mismatch', itemId: 'ring', confidence: 'medium' }] }, 'invalid_confidence_combination'],
  ]) {
    assert.throws(() => validateProductFidelityGuardResult(value, canonical),
      (error) => error.validationReason === reason);
  }
});

test('não aceita FAIL de material, relação ou escala sem evidência aplicável', async () => {
  const canonical = identity();
  const constraints = compileProductFidelityConstraints(canonical);
  const base = {
    canonicalIdentity: canonical,
    fidelityConstraints: { ...constraints, materialAppearance: [] },
    visibilityIntent: {
      mode: 'macro_detail', pairPolicy: 'explicit_single_instance',
      selectedItems: [{ itemId: 'earring-a', quantity: 1, quantityState: 'known' }],
    },
  };
  for (const violation of [
    { code: 'material_appearance', itemId: 'ring', confidence: 'high' },
    { code: 'relationship_violation', itemId: 'earring-a', confidence: 'high' },
    { code: 'contextual_scale', itemId: 'earring-a', confidence: 'high' },
  ]) {
    const result = await inspectProductFidelitySafely({
      inspect: async () => ({ verdict: 'fail', violations: [violation] }),
    }, base);
    assert.equal(result.verdict, 'uncertain');
  }
});
