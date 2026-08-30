export const FAL_SAM3_MODEL = 'fal-ai/sam-3/image';
export const FAL_SAM3_ENDPOINT = `https://fal.run/${FAL_SAM3_MODEL}`;
export const FAL_SAM3_VERSION = 'sam-3-image-v1';

export class SegmentationProviderError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = 'SegmentationProviderError';
    this.code = code;
    this.status = status;
  }
}

function decodeDataUri(value) {
  const match = typeof value === 'string' && value.match(/^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
  return match ? Buffer.from(match[1], 'base64') : undefined;
}

async function readMask(result, fetchImpl, signal) {
  const candidate = result?.masks?.[0]?.url;
  const inline = decodeDataUri(candidate);
  if (inline) return inline;
  if (typeof candidate !== 'string' || !candidate.startsWith('https://')) {
    throw new SegmentationProviderError('INVALID_SEGMENTATION_RESPONSE');
  }
  const response = await fetchImpl(candidate, { method: 'GET', signal });
  if (!response.ok) throw new SegmentationProviderError('SEGMENTATION_MASK_DOWNLOAD_FAILED');
  return Buffer.from(await response.arrayBuffer());
}

export function createFalSam3SegmentationProvider({
  apiKey = process.env.FAL_KEY,
  fetchImpl = globalThis.fetch,
  timeoutMs = 60_000,
} = {}) {
  const normalizedKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  return Object.freeze({
    name: 'fal-sam3-segmentation', model: FAL_SAM3_MODEL, version: FAL_SAM3_VERSION,
    isConfigured: normalizedKey.length > 0,
    async segment({ sourceBytes, mimeType, width, height, localization, signal }) {
      if (!normalizedKey) throw new SegmentationProviderError('SEGMENTATION_PROVIDER_NOT_CONFIGURED', 503);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      try {
        const box = localization.normalizedBoundingBox;
        const payload = {
          image_url: `data:${mimeType};base64,${sourceBytes.toString('base64')}`,
          prompt: '',
          box_prompts: [{
            x_min: Math.round(box.xMin * width), y_min: Math.round(box.yMin * height),
            x_max: Math.round(box.xMax * width), y_max: Math.round(box.yMax * height),
            object_id: 1,
          }],
          point_prompts: [
            ...localization.positivePoints.map(({ x, y }) => ({ x: Math.round(x * width), y: Math.round(y * height), label: 1, object_id: 1 })),
            ...localization.optionalNegativePoints.map(({ x, y }) => ({ x: Math.round(x * width), y: Math.round(y * height), label: 0, object_id: 1 })),
          ],
          apply_mask: false, sync_mode: true, output_format: 'png',
          return_multiple_masks: false, max_masks: 1, include_scores: true, include_boxes: true,
        };
        const response = await fetchImpl(FAL_SAM3_ENDPOINT, {
          method: 'POST', headers: { Authorization: `Key ${normalizedKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload), signal: controller.signal,
        });
        if (!response.ok) throw new SegmentationProviderError('SEGMENTATION_UPSTREAM_ERROR', response.status);
        const result = await response.json();
        return Object.freeze({
          maskBytes: await readMask(result, fetchImpl, controller.signal),
          confidence: Number(result?.scores?.[0] ?? result?.metadata?.[0]?.score ?? 0),
          providerBox: result?.boxes?.[0] ?? result?.metadata?.[0]?.box ?? null,
        });
      } catch (error) {
        if (error?.name === 'AbortError') throw new SegmentationProviderError('SEGMENTATION_TIMEOUT', 504);
        if (error instanceof SegmentationProviderError) throw error;
        throw new SegmentationProviderError('SEGMENTATION_TRANSPORT_ERROR');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    },
  });
}
