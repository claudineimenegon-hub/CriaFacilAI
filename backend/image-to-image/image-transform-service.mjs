import { randomUUID } from 'node:crypto';
import { ProductPhotoPromptBuilder } from './product-photo-prompt-builder.mjs';
import { ProductPhotoConceptPlanner } from './product-photo-concept-planner.mjs';
import { createProductIdentitySpecification } from './product-identity-spec.mjs';
import { createProductFidelityPolicy } from './product-fidelity-policy.mjs';
import {
  UnknownProductIdentityAnalyzer,
  unknownProductIdentityAnalysis,
  validateProductIdentityAnalysis,
} from './product-identity-analyzer.mjs';

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
  productIdentityAnalyzer = new UnknownProductIdentityAnalyzer(),
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
  const planningInput = {
    prompt: request.prompt,
    productCategory: request.parameters?.common?.productCategory,
    artisticDirection: request.parameters?.common?.artisticDirection,
    preservation: request.preservation,
  };
  const understanding = conceptPlanner.understand(planningInput);
  let analyzedSourceInventory;
  try {
    const analyzerInputs = Object.freeze(inputs.map((input) => Object.freeze({
      ...input,
      bytes: Buffer.from(input.bytes),
    })));
    analyzedSourceInventory = validateProductIdentityAnalysis(
      await productIdentityAnalyzer.analyze({
        inputs: analyzerInputs,
        declaredCategory: understanding.category,
        userBrief: request.prompt,
        cacheKey: inputs.map(({ metadata }, index) =>
          metadata?.hash ?? request.inputAssetIds[index]).join(':'),
      }),
    );
  } catch (error) {
    analyzedSourceInventory = unknownProductIdentityAnalysis();
    if (!error?.diagnosticLogged) {
      const knownCodes = new Set([
        'GEMINI_NOT_CONFIGURED', 'GEMINI_TIMEOUT', 'GEMINI_NETWORK_ERROR',
        'GEMINI_HTTP_ERROR', 'GEMINI_RESPONSE_TOO_LARGE', 'GEMINI_INVALID_JSON',
        'INVALID_PRODUCT_IDENTITY_ANALYSIS', 'INVALID_ANALYZER_INPUT',
      ]);
      creativeDirectorLogger?.warn?.(
        `[ProductIdentityAnalyzer] ${JSON.stringify({
          provider: error?.provider ?? 'unknown',
          model: error?.model ?? productIdentityAnalyzer?.model ?? 'unknown',
          errorCode: knownCodes.has(error?.code) ? error.code : 'UNEXPECTED_ANALYZER_ERROR',
          statusHttp: Number.isInteger(error?.statusHttp) ? error.statusHttp : null,
          latencyMs: Number.isInteger(error?.latencyMs) ? error.latencyMs : null,
          inputCount: inputs.length,
          state: 'unknown',
          items: 0,
          relationships: 0,
          fallback: true,
        })}`,
      );
    }
  }
  const identitySpecification = createProductIdentitySpecification({
    category: understanding.category,
    sourceInventory: analyzedSourceInventory,
    preservation: request.preservation,
  });
  const plan = conceptPlanner.plan({
    ...planningInput,
    canonicalIdentity: identitySpecification,
  });
  if (plan.concepts.length !== EXPECTED_COUNT) {
    throw new Error('INCOMPLETE_CONCEPT_PLAN');
  }
  if (plan.concepts.some((concept) =>
    Object.hasOwn(concept, 'productIdentity') || Object.hasOwn(concept, 'canonicalIdentity'))) {
    throw new Error('CONCEPT_MUST_NOT_OVERRIDE_CANONICAL_IDENTITY');
  }
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
      `canonicalIdentityVersion: ${identitySpecification.version}`,
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
