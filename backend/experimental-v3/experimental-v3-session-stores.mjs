import { randomUUID } from 'node:crypto';

export const ANALYSIS_SESSION_TTL_MS = 15 * 60_000;
export const ANALYSIS_SESSION_MAX_ENTRIES = 100;
export const GENERATION_IDEMPOTENCY_TTL_MS = 15 * 60_000;
export const GENERATION_IDEMPOTENCY_MAX_ENTRIES = 100;
export const ANALYSIS_POLICY_VERSION = 'product-identity-v3-policy-1';

function copy(value) { return structuredClone(value); }
function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}
function safeCopy(value) { return freezeDeep(copy(value)); }
function evictOldest(map, limit) {
  while (map.size > limit) map.delete(map.keys().next().value);
}

export function createAnalysisSessionStore({
  ttlMs = ANALYSIS_SESSION_TTL_MS, maxEntries = ANALYSIS_SESSION_MAX_ENTRIES,
  now = Date.now, createId = randomUUID,
} = {}) {
  const sessions = new Map();
  return Object.freeze({
    save(snapshot) {
      const analysisId = createId();
      const createdAt = now();
      sessions.set(analysisId, {
        snapshot: safeCopy({ ...snapshot, analysisId, createdAt, expiresAt: createdAt + ttlMs }),
        expiresAt: createdAt + ttlMs,
      });
      evictOldest(sessions, maxEntries);
      return safeCopy(sessions.get(analysisId).snapshot);
    },
    read(analysisId) {
      const entry = sessions.get(analysisId);
      if (!entry) return Object.freeze({ state: 'missing' });
      if (entry.expiresAt <= now()) {
        sessions.delete(analysisId);
        return Object.freeze({ state: 'expired' });
      }
      return Object.freeze({ state: 'active', snapshot: safeCopy(entry.snapshot) });
    },
  });
}

export function createGenerationIdempotencyStore({
  ttlMs = GENERATION_IDEMPOTENCY_TTL_MS, maxEntries = GENERATION_IDEMPOTENCY_MAX_ENTRIES,
  now = Date.now,
} = {}) {
  const entries = new Map();
  const cleanup = () => {
    for (const [key, entry] of entries) {
      if (!entry.inFlight && entry.expiresAt <= now()) entries.delete(key);
    }
  };
  return Object.freeze({
    execute({ key, fingerprint, operation, conflictError }) {
      cleanup();
      const existing = entries.get(key);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw conflictError();
        if (existing.result !== undefined) return Promise.resolve(safeCopy(existing.result));
        return existing.promise;
      }
      const entry = { fingerprint, inFlight: true, expiresAt: now() + ttlMs };
      entry.promise = Promise.resolve().then(operation).then((result) => {
        entry.inFlight = false;
        entry.result = safeCopy(result);
        entry.expiresAt = now() + ttlMs;
        evictOldest(entries, maxEntries);
        return safeCopy(entry.result);
      }).catch((error) => {
        entries.delete(key);
        throw error;
      });
      entries.set(key, entry);
      evictOldest(entries, maxEntries);
      return entry.promise;
    },
  });
}
