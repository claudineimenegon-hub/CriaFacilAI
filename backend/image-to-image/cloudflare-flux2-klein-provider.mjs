import {
  assertImageToImageRequest,
  ImageToImageProviderError,
} from './image-to-image-provider.mjs';
import { prepareFluxReferenceImage } from './reference-image-preprocessor.mjs';

export const CLOUDFLARE_FLUX2_KLEIN_MODEL =
  '@cf/black-forest-labs/flux-2-klein-4b';
const MAX_RESULT_BASE64_LENGTH = 30 * 1024 * 1024;

export function createCloudflareFlux2KleinImageToImageProvider({
  apiToken = process.env.CLOUDFLARE_API_TOKEN,
  accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(process.env.IMAGE_PROVIDER_TIMEOUT_MS ?? 60_000),
  model = process.env.CLOUDFLARE_IMAGE_TO_IMAGE_MODEL ??
    CLOUDFLARE_FLUX2_KLEIN_MODEL,
  prepareImage = prepareFluxReferenceImage,
} = {}) {
  return {
    name: 'cloudflare-flux2-klein',
    model,
    capabilities: Object.freeze({
      operations: ['imageToImage'],
      qualities: ['standard'],
      maxInputs: 4,
      fixedSteps: 4,
      preservation: 'best_effort',
    }),
    isConfigured: Boolean(apiToken && accountId),
    async generate(request) {
      assertImageToImageRequest(request);
      if (!apiToken || !accountId) {
        throw new ImageToImageProviderError('Cloudflare não configurado.', {
          provider: 'cloudflare-flux2-klein',
          code: 'PROVIDER_NOT_CONFIGURED',
        });
      }

      const preparedInputs = await Promise.all(
        request.inputs.map((input) => prepareImage(input.bytes)),
      );
      const form = new FormData();
      form.append('prompt', request.prompt);
      form.append('width', String(request.output.width));
      form.append('height', String(request.output.height));
      preparedInputs.forEach((input, index) => {
        form.append(
          `input_image_${index}`,
          new Blob([input.bytes], { type: input.mimeType }),
          `reference-${index}.png`,
        );
      });

      let response;
      try {
        response = await fetchImpl(
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiToken}` },
            body: form,
            signal: AbortSignal.timeout(timeoutMs),
          },
        );
      } catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
          throw new ImageToImageProviderError('Workers AI demorou para responder.', {
            provider: 'cloudflare-flux2-klein',
            code: 'UPSTREAM_TIMEOUT',
          });
        }
        throw error;
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().includes('application/json')) {
        throw new ImageToImageProviderError('Workers AI retornou formato inesperado.', {
          provider: 'cloudflare-flux2-klein',
          status: response.status,
          code: 'INVALID_CONTENT_TYPE',
        });
      }
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new ImageToImageProviderError('Workers AI retornou JSON inválido.', {
          provider: 'cloudflare-flux2-klein',
          status: response.status,
          code: 'INVALID_JSON',
        });
      }
      if (!response.ok || payload?.success === false) {
        throw new ImageToImageProviderError('Falha no Workers AI.', {
          provider: 'cloudflare-flux2-klein',
          status: response.status,
          code: payload?.errors?.[0]?.code ?? 'UPSTREAM_ERROR',
        });
      }
      const imageBase64 = payload?.result?.image ?? payload?.image;
      if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
        throw new ImageToImageProviderError('Workers AI não retornou uma imagem.', {
          provider: 'cloudflare-flux2-klein',
          status: response.status,
          code: 'MISSING_IMAGE',
        });
      }
      if (imageBase64.length > MAX_RESULT_BASE64_LENGTH) {
        throw new ImageToImageProviderError('Workers AI retornou imagem muito grande.', {
          provider: 'cloudflare-flux2-klein',
          status: response.status,
          code: 'RESULT_TOO_LARGE',
        });
      }
      const imageBytes = Buffer.from(imageBase64, 'base64');
      const isPng = imageBytes.length >= 8 &&
        imageBytes.subarray(0, 8).equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        );
      const isJpeg = imageBytes.length >= 3 &&
        imageBytes[0] === 0xff && imageBytes[1] === 0xd8 && imageBytes[2] === 0xff;
      if (!isPng && !isJpeg) {
        throw new ImageToImageProviderError('Workers AI retornou imagem inválida.', {
          provider: 'cloudflare-flux2-klein',
          status: response.status,
          code: 'INVALID_IMAGE',
        });
      }
      return {
        imageBase64,
        mimeType: isPng ? 'image/png' : 'image/jpeg',
        width: request.output.width,
        height: request.output.height,
        technicalMetadata: {
          provider: 'cloudflare-flux2-klein',
          model,
          fixedSteps: 4,
          preservation: 'best_effort',
          inputDimensions: preparedInputs.map(({ width, height }) => ({ width, height })),
        },
      };
    },
  };
}
