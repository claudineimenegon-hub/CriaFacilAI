import { createCloudflareFlux2KleinImageToImageProvider } from './cloudflare-flux2-klein-provider.mjs';
import { createFalFlux2ProImageToImageProvider } from './fal-flux2-pro-provider.mjs';

export function createImageToImageProvider({
  providerName = process.env.IMAGE_TO_IMAGE_PROVIDER ?? 'cloudflare-flux2-klein',
  fetchImpl = globalThis.fetch,
} = {}) {
  if (providerName === 'cloudflare-flux2-klein') {
    return createCloudflareFlux2KleinImageToImageProvider({ fetchImpl });
  }
  if (providerName === 'fal' || providerName === 'fal-flux2-pro') {
    return createFalFlux2ProImageToImageProvider({ fetchImpl });
  }
  throw new Error(`IMAGE_TO_IMAGE_PROVIDER inválido: ${providerName}`);
}

export { createCloudflareFlux2KleinImageToImageProvider };
export { createFalFlux2ProImageToImageProvider };
export { ProductPhotoConceptPlanner } from './product-photo-concept-planner.mjs';
