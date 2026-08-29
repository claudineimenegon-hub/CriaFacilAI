import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAnalysisSessionStore,
  createGenerationIdempotencyStore,
} from '../experimental-v3/experimental-v3-session-stores.mjs';

test('analysis store cria snapshot imutável, expira e limita entradas', () => {
  let current = 100;
  let sequence = 0;
  const store = createAnalysisSessionStore({
    ttlMs: 10, maxEntries: 1, now: () => current,
    createId: () => `00000000-0000-4000-8000-00000000000${++sequence}`,
  });
  const source = { sourceAssetId: 'asset-1', productIdentity: { items: [{ id: 'item-1' }] } };
  const first = store.save(source);
  source.productIdentity.items[0].id = 'mutated';
  assert.equal(store.read(first.analysisId).snapshot.productIdentity.items[0].id, 'item-1');
  const second = store.save({ sourceAssetId: 'asset-2', productIdentity: { items: [] } });
  assert.equal(store.read(first.analysisId).state, 'missing');
  current += 11;
  assert.equal(store.read(second.analysisId).state, 'expired');
});

test('idempotency store remove falha e permite repetir a mesma chave', async () => {
  const store = createGenerationIdempotencyStore();
  let calls = 0;
  const execute = () => store.execute({
    key: 'same-key', fingerprint: 'same-fingerprint',
    conflictError: () => new Error('conflict'),
    operation: async () => {
      calls += 1;
      if (calls === 1) throw new Error('temporary failure');
      return { success: true };
    },
  });
  await assert.rejects(execute(), /temporary failure/);
  assert.deepEqual(await execute(), { success: true });
  assert.equal(calls, 2);
});

test('idempotency store compartilha in-flight e rejeita fingerprint diferente', async () => {
  const store = createGenerationIdempotencyStore();
  let release;
  let calls = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const run = (fingerprint) => store.execute({
    key: 'key', fingerprint, conflictError: () => Object.assign(new Error('conflict'), { code: 'IDEMPOTENCY_CONFLICT' }),
    operation: async () => { calls += 1; await gate; return { value: 1 }; },
  });
  const first = run('a');
  const second = run('a');
  assert.throws(() => run('b'), { code: 'IDEMPOTENCY_CONFLICT' });
  release();
  assert.deepEqual(await Promise.all([first, second]), [{ value: 1 }, { value: 1 }]);
  assert.equal(calls, 1);
});
