const instructions = Object.freeze({
  type_mismatch: 'Restore the canonical functional type for the affected product.',
  count_mismatch: 'Render exactly the canonical visible quantity defined for this proposal.',
  relationship_violation: 'Restore every canonical relationship required by this proposal, including complete pairs or sets.',
  unexpected_item: 'Remove every product-like object not present in the canonical inventory.',
  structural_mutation: 'Restore the canonical item structure and prevent geometry or features from transferring between products.',
  contextual_scale: 'Restore plausible real-world product scale relative to the visible body or environment.',
  material_appearance: 'Restore only the observed canonical material appearance of the affected item.',
});
const priority = [
  'unexpected_item', 'type_mismatch', 'structural_mutation', 'count_mismatch',
  'relationship_violation', 'contextual_scale', 'material_appearance',
];

export function buildProductFidelityRepairBlock(guardResult) {
  const highCodes = new Set((guardResult?.violations ?? [])
    .filter(({ confidence }) => confidence === 'high')
    .map(({ code }) => code));
  const selected = priority.filter((code) => highCodes.has(code));
  if (selected.length === 0) return '';
  return [
    'FIDELITY REPAIR (preserve the same creative concept):',
    ...selected.map((code) => instructions[code]),
  ].join('\n');
}

export const PRODUCT_FIDELITY_REPAIR_INSTRUCTIONS = instructions;
export const PRODUCT_FIDELITY_REPAIR_PRIORITY = Object.freeze(priority);
