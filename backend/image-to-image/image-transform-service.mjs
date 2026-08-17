import { randomUUID } from 'node:crypto';
import { ProductPhotoPromptBuilder } from './product-photo-prompt-builder.mjs';
import { ProductPhotoConceptPlanner } from './product-photo-concept-planner.mjs';
import { createProductIdentitySpecification } from './product-identity-spec.mjs';
import { createProductFidelityPolicy } from './product-fidelity-policy.mjs';

const EXPECTED_COUNT = 4;
const CONCURRENCY = 2;
export const PRODUCT_PHOTO_GUIDANCE = 4;
export const PRODUCT_PHOTO_SEEDS = Object.freeze([104729, 130363, 155921, 180503]);
const supportedMimeTypes = new Set(['image/png', 'image/jpeg']);
const defaultCreativeDirectorLogger = process.env.NODE_TEST_CONTEXT ? undefined : console;

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
    case '9:16': return { width: 1024, height: 1820 };
    case '16:9': return { width: 1820, height: 1024 };
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
  conceptPlanner = new ProductPhotoConceptPlanner(),
  creativeDirectorLogger = defaultCreativeDirectorLogger,
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
  const plan = conceptPlanner.plan({
    prompt: request.prompt,
    productCategory: request.parameters?.common?.productCategory,
    artisticDirection: request.parameters?.common?.artisticDirection,
    preservation: request.preservation,
  });
  if (plan.concepts.length !== EXPECTED_COUNT) {
    throw new Error('INCOMPLETE_CONCEPT_PLAN');
  }
  const identitySpecification = createProductIdentitySpecification({
    category: plan.understanding.category,
    sourceInventory: request.parameters?.common?.sourceInventory,
    preservation: request.preservation,
  });
  const fidelityPolicy = createProductFidelityPolicy({
    category: plan.understanding.category,
  });
  const prompts = plan.concepts.map((concept) => promptBuilder.build({
    prompt: request.prompt,
    preservation: request.preservation,
    artisticDirection: request.parameters?.common?.artisticDirection,
    plan,
    concept,
    identitySpecification,
    fidelityPolicy,
  }));
  plan.concepts.forEach((concept, index) => {
    creativeDirectorLogger?.info?.([
      `[CreativeDirector] Proposal ${index + 1}`,
      `concept: ${concept.name}`,
      `commercialIntent: ${concept.objective}`,
      `composition: ${concept.cameraDistance}; ${concept.angle}; ${concept.composition}`,
      `humanPresence: ${concept.humanPresent}`,
      `productInteraction: ${concept.interaction}`,
      `visibilityIntent: ${concept.visibilityIntent.mode}; ${concept.visibilityIntent.selection}`,
      `sourceInventoryState: ${identitySpecification.sourceInventory.state}`,
      `environment: ${concept.environment}`,
      `lighting: ${concept.lighting}`,
      `finalPrompt: ${prompts[index]}`,
    ].join('\n'));
  });
  const results = [];
  for (let start = 0; start < EXPECTED_COUNT; start += CONCURRENCY) {
    const batch = [start, start + 1].map((variationIndex) => provider.generate({
      prompt: prompts[variationIndex],
      inputs,
      parameters: {
        ...request.parameters,
        provider: {
          guidance: PRODUCT_PHOTO_GUIDANCE,
          seed: PRODUCT_PHOTO_SEEDS[variationIndex],
        },
      },
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
    variationStrategy: 'adaptive-product-photo-concept-planning-v2',
    quality: request.quality,
    preservationSupport: 'best_effort',
  };
}
