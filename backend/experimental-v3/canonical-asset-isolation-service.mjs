import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createFalSam3SegmentationProvider } from './fal-sam3-segmentation-provider.mjs';

export const DEFAULT_ISOLATION_CACHE_TTL_MS = 30 * 60_000;
export const DEFAULT_ISOLATION_CACHE_MAX_ENTRIES = 100;

export class CanonicalAssetIsolationError extends Error {
  constructor(code, { status = 400 } = {}) {
    super(code);
    this.name = 'CanonicalAssetIsolationError';
    this.code = code;
    this.status = status;
  }
}

const copy = (value) => structuredClone(value);
const stableLocalization = (value) => JSON.stringify(value ?? null);

function cacheKey({ sourceSha256, canonicalItemId, localization, prompt, provider }) {
  return createHash('sha256').update([
    sourceSha256, canonicalItemId, prompt, stableLocalization(localization), provider.model, provider.version,
  ].join('\u0000')).digest('hex');
}

function cleanToken(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 120) : '';
}

export function buildCanonicalSegmentationPrompt(productIdentity, canonicalItemId) {
  const item = productIdentity?.items?.find(({ id }) => id === canonicalItemId);
  if (!item) throw new CanonicalAssetIsolationError('CANONICAL_ITEM_NOT_FOUND', { status: 404 });
  const type = cleanToken(item.functionalType?.value) || 'canonical product';
  const quantity = Number.isSafeInteger(item.quantity?.value) && item.quantity.value > 0
    ? item.quantity.value : 1;
  const features = (item.observedFeatures ?? [])
    .map(({ name, value }) => [cleanToken(name), cleanToken(value)].filter(Boolean).join(': '))
    .filter(Boolean).sort().slice(0, 12);
  const relationships = (productIdentity.relationships ?? [])
    .filter(({ state, memberIds }) => state === 'known' && Array.isArray(memberIds) &&
      memberIds.includes(canonicalItemId))
    .map(({ type: relationshipType }) => cleanToken(relationshipType))
    .filter(Boolean).sort();
  return [
    `Segment only the complete canonical ${type} product.`,
    `Include exactly ${quantity} physical ${quantity === 1 ? 'unit' : 'units'} belonging to this canonical item in one complete mask.`,
    features.length ? `Include its observed non-ambiguous visible structure: ${features.join('; ')}.` : '',
    relationships.length
      ? `Preserve the complete known atomic relationship: ${relationships.join(', ')}.` : '',
    'Do not include nearby products, props, labels, background, or inferred hidden components.',
  ].filter(Boolean).join(' ');
}

function rawBoundingBox(raw, width, height) {
  let xMin = width; let yMin = height; let xMax = -1; let yMax = -1; let visible = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (raw[pixel] === 0) continue;
    visible += 1;
    const x = pixel % width; const y = Math.floor(pixel / width);
    xMin = Math.min(xMin, x); yMin = Math.min(yMin, y);
    xMax = Math.max(xMax, x); yMax = Math.max(yMax, y);
  }
  return { xMin, yMin, xMax, yMax, visible };
}

function providerBoxEdges(value) {
  if (!Array.isArray(value) || value.length !== 4 ||
      !value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return undefined;
  const [cx, cy, width, height] = value;
  return { xMin: cx - width / 2, yMin: cy - height / 2, xMax: cx + width / 2, yMax: cy + height / 2 };
}

function mappedMaskBox(box, maskWidth, maskHeight, sourceWidth, sourceHeight, mode) {
  const scale = mode === 'stretch' ? undefined : mode === 'contain'
    ? Math.min(maskWidth / sourceWidth, maskHeight / sourceHeight)
    : Math.max(maskWidth / sourceWidth, maskHeight / sourceHeight);
  const scaledWidth = scale === undefined ? maskWidth : sourceWidth * scale;
  const scaledHeight = scale === undefined ? maskHeight : sourceHeight * scale;
  const offsetX = (maskWidth - scaledWidth) / 2;
  const offsetY = (maskHeight - scaledHeight) / 2;
  return {
    xMin: (box.xMin - offsetX) / scaledWidth, yMin: (box.yMin - offsetY) / scaledHeight,
    xMax: (box.xMax + 1 - offsetX) / scaledWidth, yMax: (box.yMax + 1 - offsetY) / scaledHeight,
  };
}

function alignmentError(actual, expected) {
  return ['xMin', 'yMin', 'xMax', 'yMax'].reduce((sum, key) => sum + Math.abs(actual[key] - expected[key]), 0);
}

function determineMaskAlignment({ maskBox, maskWidth, maskHeight, sourceWidth, sourceHeight, providerBox }) {
  const aspectDifference = Math.abs(maskWidth / maskHeight - sourceWidth / sourceHeight);
  if (aspectDifference < 0.001) return { mode: 'stretch', verified: true };
  const expected = providerBoxEdges(providerBox);
  if (!expected) return { mode: 'stretch', verified: false };
  const candidates = ['stretch', 'contain', 'cover'].map((mode) => ({
    mode,
    error: alignmentError(mappedMaskBox(maskBox, maskWidth, maskHeight, sourceWidth, sourceHeight, mode), expected),
  })).sort((a, b) => a.error - b.error);
  return {
    mode: candidates[0].mode,
    verified: candidates[0].error <= 0.2 && candidates[1].error - candidates[0].error >= 0.03,
  };
}

function sampleMask(raw, maskWidth, maskHeight, sourceX, sourceY, sourceWidth, sourceHeight, mode) {
  const scale = mode === 'stretch' ? undefined : mode === 'contain'
    ? Math.min(maskWidth / sourceWidth, maskHeight / sourceHeight)
    : Math.max(maskWidth / sourceWidth, maskHeight / sourceHeight);
  const mappedX = scale === undefined
    ? (sourceX + 0.5) * maskWidth / sourceWidth
    : (sourceX + 0.5) * scale + (maskWidth - sourceWidth * scale) / 2;
  const mappedY = scale === undefined
    ? (sourceY + 0.5) * maskHeight / sourceHeight
    : (sourceY + 0.5) * scale + (maskHeight - sourceHeight * scale) / 2;
  const x = Math.floor(mappedX); const y = Math.floor(mappedY);
  return x < 0 || y < 0 || x >= maskWidth || y >= maskHeight ? 0 : raw[y * maskWidth + x];
}

async function composeTransparentSource({ sourceBytes, maskBytes, providerBox }) {
  const source = sharp(sourceBytes).ensureAlpha();
  const metadata = await source.metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new CanonicalAssetIsolationError('INVALID_SOURCE_IMAGE');
  const sourceRaw = await source.raw().toBuffer();
  const mask = sharp(maskBytes).greyscale();
  const maskMetadata = await mask.metadata();
  if (!maskMetadata.width || !maskMetadata.height) throw new CanonicalAssetIsolationError('INVALID_SEGMENTATION_MASK');
  const providerMaskRaw = await mask.raw().toBuffer();
  const providerMaskBox = rawBoundingBox(providerMaskRaw, maskMetadata.width, maskMetadata.height);
  if (providerMaskBox.visible === 0) throw new CanonicalAssetIsolationError('EMPTY_SEGMENTATION_MASK');
  const alignment = determineMaskAlignment({
    maskBox: providerMaskBox, maskWidth: maskMetadata.width, maskHeight: maskMetadata.height,
    sourceWidth: width, sourceHeight: height, providerBox,
  });
  const maskRaw = Buffer.alloc(width * height);
  let visible = 0;
  let xMin = width; let yMin = height; let xMax = -1; let yMax = -1;
  const outputRaw = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const sourceOffset = pixel * 4;
    const x = pixel % width; const y = Math.floor(pixel / width);
    const alpha = sampleMask(providerMaskRaw, maskMetadata.width, maskMetadata.height,
      x, y, width, height, alignment.mode);
    maskRaw[pixel] = alpha;
    outputRaw[sourceOffset] = sourceRaw[sourceOffset];
    outputRaw[sourceOffset + 1] = sourceRaw[sourceOffset + 1];
    outputRaw[sourceOffset + 2] = sourceRaw[sourceOffset + 2];
    outputRaw[sourceOffset + 3] = alpha;
    if (alpha > 0) {
      visible += 1;
      xMin = Math.min(xMin, x); yMin = Math.min(yMin, y);
      xMax = Math.max(xMax, x); yMax = Math.max(yMax, y);
    }
  }
  if (visible === 0) throw new CanonicalAssetIsolationError('EMPTY_SEGMENTATION_MASK');
  return Object.freeze({
    pngBytes: await sharp(outputRaw, { raw: { width, height, channels: 4 } }).png().toBuffer(),
    alphaBytes: Buffer.from(maskRaw), width, height, visible,
    effectiveBoundingRegion: Object.freeze({ xMin, yMin, xMax, yMax }),
    visiblePixelIntegrity: true,
    maskAlignment: Object.freeze(alignment),
    maskWidth: maskMetadata.width,
    maskHeight: maskMetadata.height,
  });
}

function alphaAt(alphaBytes, width, height, point) {
  const x = Math.min(width - 1, Math.max(0, Math.round(point.x * (width - 1))));
  const y = Math.min(height - 1, Math.max(0, Math.round(point.y * (height - 1))));
  return alphaBytes[y * width + x];
}

export function createCanonicalAssetIsolationService({
  provider = createFalSam3SegmentationProvider(),
  now = Date.now,
  cacheTtlMs = DEFAULT_ISOLATION_CACHE_TTL_MS,
  cacheMaxEntries = DEFAULT_ISOLATION_CACHE_MAX_ENTRIES,
  minimumConfidence = 0.75,
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const execute = async (input) => {
    const item = input.productIdentity.items.find(({ id }) => id === input.canonicalItemId);
    const localization = input.visualLocalization ?? item?.visualLocalization;
    if (!item) throw new CanonicalAssetIsolationError('CANONICAL_ITEM_NOT_FOUND', { status: 404 });
    const prompt = buildCanonicalSegmentationPrompt(input.productIdentity, input.canonicalItemId);
    const segmented = await provider.segment({
      sourceBytes: input.sourceAsset.bytes, mimeType: input.sourceAsset.mimeType,
      width: input.sourceAsset.metadata.width, height: input.sourceAsset.metadata.height,
      prompt, ...(localization ? { localization } : {}), signal: input.signal,
    });
    const composed = await composeTransparentSource({
      sourceBytes: input.sourceAsset.bytes, maskBytes: segmented.maskBytes, providerBox: segmented.providerBox,
    });
    const contaminatedBy = input.productIdentity.items.filter(({ id, visualLocalization }) =>
      id !== input.canonicalItemId && visualLocalization?.positivePoints?.some((point) =>
        alphaAt(composed.alphaBytes, composed.width, composed.height, point) > 127)).map(({ id }) => id);
    const ambiguous = segmented.confidence < minimumConfidence || !composed.maskAlignment.verified;
    return Object.freeze({
      canonicalItemId: input.canonicalItemId,
      mask: Object.freeze({
        bytes: Buffer.from(composed.alphaBytes),
        width: composed.width, height: composed.height, nonZeroPixels: composed.visible,
      }),
      transparentPng: Buffer.from(composed.pngBytes),
      effectiveBoundingRegion: composed.effectiveBoundingRegion,
      maskAlignment: composed.maskAlignment,
      segmentationConfidence: segmented.confidence,
      segmentationPromptVersion: 'canonical-product-identity-v1',
      sourceSha256: input.sourceSha256,
      visiblePixelIntegrity: composed.visiblePixelIntegrity,
      isolationState: ambiguous || contaminatedBy.length > 0 ? 'uncertain' : 'awaiting_confirmation',
      confirmable: contaminatedBy.length === 0 && !ambiguous,
      errorCode: contaminatedBy.length > 0 ? 'MASK_CONTAMINATED'
        : !composed.maskAlignment.verified ? 'MASK_TRANSFORM_UNPROVEN'
          : segmented.confidence < minimumConfidence ? 'LOW_SEGMENTATION_CONFIDENCE' : null,
      maskCount: segmented.maskCount,
      selectedMaskIndex: segmented.selectedMaskIndex,
      selectedScore: segmented.confidence,
      statusHttp: segmented.statusHttp,
      maskWidth: composed.maskWidth,
      maskHeight: composed.maskHeight,
      sourceWidth: composed.width,
      sourceHeight: composed.height,
      transformCandidate: composed.maskAlignment.mode,
      alignmentValidated: composed.maskAlignment.verified,
      provider: provider.name, model: provider.model, version: provider.version,
    });
  };
  return Object.freeze({
    provider,
    async isolate(input) {
      const prompt = buildCanonicalSegmentationPrompt(input.productIdentity, input.canonicalItemId);
      const key = cacheKey({ ...input, prompt, provider });
      const cached = cache.get(key);
      if (!input.force && cached && cached.expiresAt > now()) return { ...copy(cached.value), cacheHit: true, inFlightShared: false };
      if (cached) cache.delete(key);
      if (!input.force && inFlight.has(key)) return { ...copy(await inFlight.get(key)), cacheHit: false, inFlightShared: true };
      const promise = execute(input).then((value) => {
        cache.set(key, { value, expiresAt: now() + cacheTtlMs });
        while (cache.size > cacheMaxEntries) cache.delete(cache.keys().next().value);
        return value;
      }).finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return { ...copy(await promise), cacheHit: false, inFlightShared: false };
    },
  });
}
