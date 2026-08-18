import {
  UnknownProductIdentityAnalyzer,
} from './product-identity-analyzer.mjs';
import {
  GeminiProductIdentityAnalyzer,
} from './gemini-product-identity-analyzer.mjs';

export function createProductIdentityAnalyzer({
  analyzerName = process.env.PRODUCT_IDENTITY_ANALYZER ?? 'unknown',
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.PRODUCT_IDENTITY_ANALYZER_MODEL,
  fetchImpl = globalThis.fetch,
  logger,
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

