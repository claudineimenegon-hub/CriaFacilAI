import { GeminiProductFidelityGuard } from './gemini-product-fidelity-guard.mjs';
import { UnknownProductFidelityGuard } from './product-fidelity-guard.mjs';

const defaultLogger = process.env.NODE_TEST_CONTEXT ? undefined : Object.freeze({
  info(event) {
    console.info(`[ProductFidelityGuard] ${JSON.stringify(event)}`);
  },
});

export function createProductFidelityGuard({
  guardName = process.env.PRODUCT_FIDELITY_GUARD ??
    (process.env.GEMINI_API_KEY ? 'gemini' : 'unknown'),
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.PRODUCT_FIDELITY_GUARD_MODEL,
  fetchImpl = globalThis.fetch,
  logger = defaultLogger,
} = {}) {
  if (guardName === 'unknown') return new UnknownProductFidelityGuard();
  if (guardName === 'gemini') {
    return new GeminiProductFidelityGuard({
      apiKey,
      ...(model == null ? {} : { model }),
      fetchImpl,
      logger,
    });
  }
  throw new Error(`PRODUCT_FIDELITY_GUARD inválido: ${guardName}`);
}
