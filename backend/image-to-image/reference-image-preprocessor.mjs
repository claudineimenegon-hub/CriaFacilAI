import sharp from 'sharp';

export const MAX_FLUX_REFERENCE_DIMENSION = 511;

export async function prepareFluxReferenceImage(input) {
  const { data, info } = await sharp(input, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({
      width: MAX_FLUX_REFERENCE_DIMENSION,
      height: MAX_FLUX_REFERENCE_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  if (!info.width || !info.height ||
      info.width > MAX_FLUX_REFERENCE_DIMENSION ||
      info.height > MAX_FLUX_REFERENCE_DIMENSION) {
    throw new Error('REFERENCE_PREPROCESSING_FAILED');
  }
  return { bytes: data, mimeType: 'image/png', width: info.width, height: info.height };
}
