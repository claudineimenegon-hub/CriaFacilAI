import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProductFidelityRepairBlock,
  PRODUCT_FIDELITY_REPAIR_INSTRUCTIONS,
  PRODUCT_FIDELITY_REPAIR_PRIORITY,
} from '../image-to-image/product-fidelity-repair.mjs';

test('repair é determinístico, priorizado, deduplicado e não contém prompt original', () => {
  const block = buildProductFidelityRepairBlock({
    verdict: 'fail',
    violations: [
      { code: 'material_appearance', confidence: 'high' },
      { code: 'unexpected_item', confidence: 'high' },
      { code: 'unexpected_item', confidence: 'high' },
      { code: 'count_mismatch', confidence: 'medium' },
      { code: 'structural_mutation', confidence: 'high' },
    ],
  });
  assert.ok(block.indexOf(PRODUCT_FIDELITY_REPAIR_INSTRUCTIONS.unexpected_item) <
    block.indexOf(PRODUCT_FIDELITY_REPAIR_INSTRUCTIONS.structural_mutation));
  assert.ok(block.indexOf(PRODUCT_FIDELITY_REPAIR_INSTRUCTIONS.structural_mutation) <
    block.indexOf(PRODUCT_FIDELITY_REPAIR_INSTRUCTIONS.material_appearance));
  assert.equal(block.match(/Remove every product-like/g).length, 1);
  assert.doesNotMatch(block, /private original prompt/);
  assert.deepEqual(PRODUCT_FIDELITY_REPAIR_PRIORITY, [
    'unexpected_item', 'type_mismatch', 'structural_mutation', 'count_mismatch',
    'relationship_violation', 'contextual_scale', 'material_appearance',
  ]);
});
