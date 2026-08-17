import sharp from 'sharp';
import { ImageToImageProviderError } from './image-to-image-provider.mjs';

export const FAL_MAX_TOTAL_INPUT_PIXELS = 8_000_000;
export const FAL_MAX_INPUT_BYTES = 10 * 1024 * 1024;

function validationError(message, code) {
  return new ImageToImageProviderError(message, {
    provider: 'fal-flux2-pro',
    code,
  });
}

function orientedDimensions(metadata) {
  const rotated = [5, 6, 7, 8].includes(metadata.orientation);
  return {
    width: rotated ? metadata.height : metadata.width,
    height: rotated ? metadata.width : metadata.height,
  };
}

export function planFalReferenceResizes(
  dimensions,
  maxTotalPixels = FAL_MAX_TOTAL_INPUT_PIXELS,
) {
  if (!Array.isArray(dimensions) || dimensions.length < 1 || dimensions.length > 4) {
    throw validationError('Quantidade de referências inválida para fal.ai.', 'INVALID_INPUT_COUNT');
  }
  if (!Number.isInteger(maxTotalPixels) || maxTotalPixels < 1 ||
      dimensions.some(({ width, height }) =>
        !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)) {
    throw validationError('Dimensões de referência inválidas para fal.ai.', 'INVALID_INPUT_DIMENSIONS');
  }
  const originalTotalPixels = dimensions.reduce(
    (total, { width, height }) => total + width * height,
    0,
  );
  const scale = originalTotalPixels > maxTotalPixels
    ? Math.sqrt(maxTotalPixels / originalTotalPixels)
    : 1;
  const targets = dimensions.map(({ width, height }) => ({
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  }));
  return { originalTotalPixels, scale, targets };
}

async function inspectImage(input) {
  try {
    const metadata = await sharp(input.bytes, { failOn: 'error' }).metadata();
    const dimensions = orientedDimensions(metadata);
    if (!dimensions.width || !dimensions.height ||
        !['jpeg', 'png'].includes(metadata.format)) {
      throw new Error('unsupported');
    }
    return dimensions;
  } catch {
    throw validationError('Referência inválida para fal.ai.', 'INVALID_INPUT_IMAGE');
  }
}

async function resizeImage(input, target) {
  let pipeline = sharp(input.bytes, { failOn: 'error' })
    .autoOrient()
    .resize(target.width, target.height, {
      fit: 'inside',
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    });
  if (input.mimeType === 'image/jpeg') {
    pipeline = pipeline.jpeg({ quality: 95, chromaSubsampling: '4:4:4' });
  } else {
    pipeline = pipeline.png({ compressionLevel: 6, palette: false });
  }
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return { bytes: data, width: info.width, height: info.height };
}

export async function prepareFalReferenceImages(inputs, {
  maxTotalPixels = FAL_MAX_TOTAL_INPUT_PIXELS,
  inspect = inspectImage,
  resize = resizeImage,
} = {}) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 4) {
    throw validationError('Quantidade de referências inválida para fal.ai.', 'INVALID_INPUT_COUNT');
  }
  for (const input of inputs) {
    if (!['image/png', 'image/jpeg'].includes(input?.mimeType) ||
        !Buffer.isBuffer(input?.bytes) || input.bytes.length === 0 ||
        input.bytes.length > FAL_MAX_INPUT_BYTES) {
      throw validationError('Referência inválida para fal.ai.', 'INVALID_INPUT_IMAGE');
    }
  }

  const dimensions = await Promise.all(inputs.map(inspect));
  const plan = planFalReferenceResizes(dimensions, maxTotalPixels);
  const prepared = await Promise.all(inputs.map(async (input, index) => {
    const original = dimensions[index];
    const target = plan.targets[index];
    const resized = target.width < original.width || target.height < original.height;
    const resizedResult = resized ? await resize(input, target) : undefined;
    const bytes = Buffer.isBuffer(resizedResult)
      ? resizedResult
      : resizedResult?.bytes ?? input.bytes;
    return {
      bytes,
      mimeType: input.mimeType,
      width: resizedResult?.width ?? target.width,
      height: resizedResult?.height ?? target.height,
      originalWidth: original.width,
      originalHeight: original.height,
      resized,
    };
  }));
  const preparedTotalPixels = prepared.reduce(
    (total, input) => total + input.width * input.height,
    0,
  );
  if (preparedTotalPixels > maxTotalPixels) {
    throw validationError('Referências excedem o limite da fal.ai.', 'INPUT_PIXELS_EXCEEDED');
  }
  return prepared;
}
