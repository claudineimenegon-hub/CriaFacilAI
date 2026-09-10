import { ImageProviderError } from './provider-error.mjs';

export const CLOUDFLARE_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

const dimensionsByAspectRatio = Object.freeze({
  '1:1': [1024, 1024],
  '4:5': [1024, 1280],
  '9:16': [1024, 1820],
  '16:9': [1820, 1024],
});

function createRequestBody(model, prompt, aspectRatio) {
  if (model.includes('/flux-2-')) {
    const [width, height] = dimensionsByAspectRatio[aspectRatio] ?? dimensionsByAspectRatio['1:1'];
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('width', String(width));
    form.append('height', String(height));
    return { body: form, contentType: undefined };
  }
  return {
    body: JSON.stringify({ prompt, steps: 4 }),
    contentType: 'application/json',
  };
}

export function createCloudflareImageProvider({
  apiToken = process.env.CLOUDFLARE_API_TOKEN,
  accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(process.env.IMAGE_PROVIDER_TIMEOUT_MS ?? 30_000),
  model = process.env.CLOUDFLARE_IMAGE_MODEL ?? CLOUDFLARE_IMAGE_MODEL,
} = {}) {
  return {
    name: 'cloudflare',
    model,
    isConfigured: Boolean(apiToken && accountId),
    async generate(prompt, { aspectRatio = '1:1' } = {}) {
      if (!apiToken || !accountId) {
        throw new ImageProviderError('Cloudflare não configurado.', {
          provider: 'cloudflare',
          code: 'PROVIDER_NOT_CONFIGURED',
        });
      }

      const requestBody = createRequestBody(model, prompt, aspectRatio);
      const response = await fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            ...(requestBody.contentType
              ? { 'Content-Type': requestBody.contentType }
              : {}),
          },
          body: requestBody.body,
          signal: AbortSignal.timeout(timeoutMs),
        },
      );

      const contentType = response.headers.get('content-type') ?? '';
      if (response.ok && contentType.startsWith('image/')) {
        return Buffer.from(await response.arrayBuffer()).toString('base64');
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }

      if (!response.ok || payload?.success === false) {
        throw new ImageProviderError('Falha no Workers AI.', {
          provider: 'cloudflare',
          status: response.status,
          code: payload?.errors?.[0]?.code ?? 'UPSTREAM_ERROR',
        });
      }

      const imageBase64 = payload?.result?.image ?? payload?.image;
      if (!imageBase64) {
        throw new ImageProviderError('Workers AI não retornou uma imagem.', {
          provider: 'cloudflare',
          status: response.status,
          code: 'MISSING_IMAGE',
        });
      }
      return imageBase64;
    },
  };
}
