import {
  UnknownProductIdentityAnalyzer,
} from './product-identity-analyzer.mjs';
import {
  GeminiProductIdentityAnalyzer,
} from './gemini-product-identity-analyzer.mjs';

const defaultLogger = process.env.NODE_TEST_CONTEXT ? undefined : Object.freeze({
  info(event) {
    console.info(`[ProductIdentityAnalyzer] ${JSON.stringify(event)}`);
  },
});

export function createProductIdentityAnalyzer({
  analyzerName = process.env.PRODUCT_IDENTITY_ANALYZER ?? 'unknown',
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.PRODUCT_IDENTITY_ANALYZER_MODEL,
  fetchImpl = globalThis.fetch,
  logger = defaultLogger,
} = {}) {
  if (analyzerName === 'unknown') return new UnknownProductIdentityAnalyzer();
  if (analyzerName === 'gemini') {
    return new GeminiProductIdentityAnalyzer({
      apiKey,
      ...(model == null ? {} : { model }),
      fetchImpl,
      logger,
    });
  }
  throw new Error(`PRODUCT_IDENTITY_ANALYZER inválido: ${analyzerName}`);
}
