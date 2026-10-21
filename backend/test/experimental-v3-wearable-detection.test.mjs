import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCreativeDirectorV3Input,
  validateExperimentalV3Request,
} from '../experimental-v3/experimental-v3-generation-service.mjs';
import {
  createDeterministicCreativeDirectorV3Model,
  runCreativeDirectorV3,
} from '../benchmark/creative-director-v3.mjs';

const assetId = '00000000-0000-4000-8000-000000000001';

function analysisFor(functionalType) {
  return {
    state: 'known',
    items: [{
      id: 'item_1', functionalType: { state: 'known', value: functionalType },
      quantity: { state: 'known', value: 1 }, observationCompleteness: 'partial',
      observedFeatures: [{ id: 'f1', name: 'color', value: 'gold' }],
      ambiguousFeatures: [],
    }],
    relationships: [],
  };
}

async function plan(functionalType, category) {
  const request = validateExperimentalV3Request({
    inputAssetId: assetId, category, objective: 'Campanha premium',
    description: 'Apresentação sofisticada', aspectRatio: '4:5',
  });
  const input = buildCreativeDirectorV3Input({ analysis: analysisFor(functionalType), request });
  await runCreativeDirectorV3({ input, modelAdapter: createDeterministicCreativeDirectorV3Model() });
  return input;
}

for (const functionalType of ['wristwatch', 'smartwatch', 'watches', 'earrings', 'rings', 'bracelets']) {
  test(`"${functionalType}" é reconhecido como vestível e gera as 4 propostas`, async () => {
    const input = await plan(functionalType, 'watches');
    assert.deepEqual(input.productSemantics.wearableItemIds, ['item_1']);
  });
}

test('categoria vestível sem nome reconhecido confia na categoria em vez de falhar', async () => {
  const input = await plan('decorative piece', 'jewelry');
  assert.deepEqual(input.productSemantics.affordances, ['wearable']);
  assert.deepEqual(input.productSemantics.wearableItemIds, ['item_1']);
});
