import { randomUUID } from 'node:crypto';
import { ProductPhotoPromptBuilder } from './product-photo-prompt-builder.mjs';

const EXPECTED_COUNT = 4;
const CONCURRENCY = 2;
const supportedMimeTypes = new Set(['image/png', 'image/jpeg']);

export class ImageTransformValidationError extends Error {
  constructor(message, { code, status = 400 } = {}) {
    super(message);
    this.name = 'ImageTransformValidationError';
    this.code = code;
    this.status = status;
  }
}

export function outputDimensions(aspectRatio) {
  return switchAspectRatio(aspectRatio);
}

function switchAspectRatio(aspectRatio) {
  switch (aspectRatio) {
    case '4:5': return { width: 1024, height: 1280 };
    case '9:16': return { width: 768, height: 1365 };
    case '16:9': return { width: 1365, height: 768 };
    case '1:1': return { width: 1024, height: 1024 };
    default:
      throw new ImageTransformValidationError('Proporção não suportada.', {
        code: 'INVALID_ASPECT_RATIO',
      });
  }
}

export async function generateProductPhotoBatch({
  provider,
  assetStore,
  request,
  promptBuilder = new ProductPhotoPromptBuilder(),
}) {
  const inputs = [];
  for (const id of request.inputAssetIds) {
    const asset = await assetStore.readImage(id);
    if (!asset) {
      throw new ImageTransformValidationError('Imagem de referência não encontrada ou expirada.', {
        code: 'ASSET_NOT_FOUND',
        status: 404,
      });
    }
    if (!supportedMimeTypes.has(asset.mimeType)) {
      throw new ImageTransformValidationError('Formato da referência não suportado.', {
        code: 'INVALID_ASSET_MIME',
        status: 415,
      });
    }
    inputs.push({ bytes: asset.bytes, mimeType: asset.mimeType, metadata: asset.metadata });
  }

  const output = { ...outputDimensions(request.aspectRatio), count: EXPECTED_COUNT };
  const results = [];
  for (let start = 0; start < EXPECTED_COUNT; start += CONCURRENCY) {
    const batch = [start, start + 1].map((variationIndex) => provider.generate({
      prompt: promptBuilder.build({
        prompt: request.prompt,
        preservation: request.preservation,
        artisticDirection: request.parameters?.common?.artisticDirection,
        variationIndex,
      }),
      inputs,
      parameters: request.parameters,
      preservation: request.preservation,
      output,
    }));
    results.push(...await Promise.all(batch));
  }
  if (results.length !== EXPECTED_COUNT || results.some((result) => !result.imageBase64)) {
    throw new Error('INCOMPLETE_IMAGE_BATCH');
  }
  return {
    id: randomUUID(),
    expectedCount: EXPECTED_COUNT,
    status: 'completed',
    imagesBase64: results.map((result) => result.imageBase64),
    variationStrategy: 'product-photo-commercial-directions-v1',
    quality: request.quality,
    preservationSupport: 'best_effort',
  };
}
