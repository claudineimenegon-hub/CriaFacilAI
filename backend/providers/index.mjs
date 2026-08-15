import { createCloudflareImageProvider } from './cloudflare-image-provider.mjs';
import { createOpenAIImageProvider } from './openai-image-provider.mjs';

export function createImageProvider({
  providerName = process.env.IMAGE_PROVIDER ?? 'cloudflare',
  fetchImpl = globalThis.fetch,
} = {}) {
  if (providerName === 'cloudflare') {
    return createCloudflareImageProvider({ fetchImpl });
  }
  if (providerName === 'openai') {
    return createOpenAIImageProvider({ fetchImpl });
  }
  throw new Error(`IMAGE_PROVIDER inválido: ${providerName}`);
}

export { createCloudflareImageProvider, createOpenAIImageProvider };
