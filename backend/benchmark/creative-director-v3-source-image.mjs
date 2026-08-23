import sharp from 'sharp';

export const V3_SOURCE_MAX_EDGE = 1024;
export const V3_SOURCE_MAX_BYTES = 12 * 1024 * 1024;

export async function prepareCreativeDirectorV3SourceImage(sourceImage) {
  if (sourceImage == null) return undefined;
  if (!Buffer.isBuffer(sourceImage.bytes) || sourceImage.bytes.length === 0 || sourceImage.bytes.length > V3_SOURCE_MAX_BYTES) {
    throw Object.assign(new TypeError('Invalid Creative Director V3 source image.'), { code: 'INVALID_V3_SOURCE_IMAGE' });
  }
  if (!['image/jpeg', 'image/png'].includes(sourceImage.mimeType)) {
    throw Object.assign(new TypeError('Creative Director V3 source image must be JPEG or PNG.'), { code: 'UNSUPPORTED_V3_SOURCE_IMAGE' });
  }
  let metadata;
  try { metadata = await sharp(sourceImage.bytes, { failOn: 'error' }).metadata(); } catch {
    throw Object.assign(new TypeError('Invalid Creative Director V3 source image.'), { code: 'INVALID_V3_SOURCE_IMAGE' });
  }
  const actualMime = metadata.format === 'jpeg' ? 'image/jpeg' : metadata.format === 'png' ? 'image/png' : undefined;
  if (!actualMime || actualMime !== sourceImage.mimeType || !metadata.width || !metadata.height) {
    throw Object.assign(new TypeError('Creative Director V3 source image content does not match its MIME type.'), { code: 'INVALID_V3_SOURCE_IMAGE' });
  }
  if (Math.max(metadata.width, metadata.height) <= V3_SOURCE_MAX_EDGE) {
    return Object.freeze({ bytes: sourceImage.bytes, mimeType: actualMime, width: metadata.width, height: metadata.height });
  }
  let pipeline = sharp(sourceImage.bytes, { failOn: 'error' }).rotate().resize({
    width: V3_SOURCE_MAX_EDGE, height: V3_SOURCE_MAX_EDGE, fit: 'inside', withoutEnlargement: true,
  });
  pipeline = actualMime === 'image/jpeg' ? pipeline.jpeg({ quality: 88, chromaSubsampling: '4:4:4' }) : pipeline.png({ compressionLevel: 6 });
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return Object.freeze({ bytes: data, mimeType: actualMime, width: info.width, height: info.height });
}
