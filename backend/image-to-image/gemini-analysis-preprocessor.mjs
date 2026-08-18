import sharp from 'sharp';

// Gemini tokenizes large images in 768 px tiles. Four tiles on the longest edge
// retain product detail while avoiding sending full-resolution phone originals.
export const GEMINI_ANALYSIS_MAX_EDGE = 4 * 768;

export function planGeminiAnalysisResize(width, height, maxEdge = GEMINI_ANALYSIS_MAX_EDGE) {
  if (![width, height, maxEdge].every((value) => Number.isInteger(value) && value > 0)) {
    throw new TypeError('Gemini analyzer dimensions are invalid.');
  }
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    resized: scale < 1,
  };
}

function orientedDimensions(metadata) {
  const rotated = [5, 6, 7, 8].includes(metadata.orientation);
  return {
    width: rotated ? metadata.height : metadata.width,
    height: rotated ? metadata.width : metadata.height,
  };
}

export async function prepareGeminiAnalysisImages(inputs, {
  maxEdge = GEMINI_ANALYSIS_MAX_EDGE,
} = {}) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 4) {
    throw new TypeError('Gemini analyzer inputs are invalid.');
  }
  return Promise.all(inputs.map(async (input) => {
    if (!Buffer.isBuffer(input?.bytes) ||
        !['image/jpeg', 'image/png'].includes(input?.mimeType)) {
      throw new TypeError('Gemini analyzer image is invalid.');
    }
    const metadata = await sharp(input.bytes, { failOn: 'error' }).metadata();
    const original = orientedDimensions(metadata);
    if (!original.width || !original.height || !['jpeg', 'png'].includes(metadata.format)) {
      throw new TypeError('Gemini analyzer image is invalid.');
    }
    const target = planGeminiAnalysisResize(original.width, original.height, maxEdge);
    if (!target.resized) {
      return {
        ...input,
        metadata: { ...input.metadata, width: original.width, height: original.height },
      };
    }
    let pipeline = sharp(input.bytes, { failOn: 'error' })
      .autoOrient()
      .resize({
        width: target.width,
        height: target.height,
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3,
      });
    pipeline = input.mimeType === 'image/jpeg'
      ? pipeline.jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
      : pipeline.png({ compressionLevel: 6, palette: false });
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return {
      ...input,
      bytes: data,
      metadata: {
        ...input.metadata,
        width: info.width,
        height: info.height,
        originalWidth: original.width,
        originalHeight: original.height,
        analyzerResized: true,
      },
    };
  }));
}
