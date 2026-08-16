import { createCloudflareFlux2KleinImageToImageProvider } from './cloudflare-flux2-klein-provider.mjs';

export function createImageToImageProvider({
  providerName = process.env.IMAGE_TO_IMAGE_PROVIDER ?? 'cloudflare-flux2-klein',
  fetchImpl = globalThis.fetch,
} = {}) {
  if (providerName === 'cloudflare-flux2-klein') {
    return createCloudflareFlux2KleinImageToImageProvider({ fetchImpl });
  }
  throw new Error(`IMAGE_TO_IMAGE_PROVIDER inválido: ${providerName}`);
}

export { createCloudflareFlux2KleinImageToImageProvider };
