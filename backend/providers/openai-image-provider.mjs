import { ImageProviderError } from './provider-error.mjs';

export const OPENAI_IMAGE_MODEL = 'gpt-image-2';

export function createOpenAIImageProvider({
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(process.env.IMAGE_PROVIDER_TIMEOUT_MS ?? 30_000),
  model = process.env.OPENAI_IMAGE_MODEL ?? OPENAI_IMAGE_MODEL,
} = {}) {
  return {
    name: 'openai',
    model,
    isConfigured: Boolean(apiKey),
    async generate(prompt) {
      if (!apiKey) {
        throw new ImageProviderError('OpenAI não configurada.', {
          provider: 'openai',
          code: 'PROVIDER_NOT_CONFIGURED',
        });
      }

      const response = await fetchImpl('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt,
          size: '1024x1024',
          quality: 'low',
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      let payload;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      if (!response.ok) {
        throw new ImageProviderError('Falha na OpenAI.', {
          provider: 'openai',
          status: response.status,
          code: payload?.error?.code ?? 'UPSTREAM_ERROR',
        });
      }

      const imageBase64 = payload?.data?.[0]?.b64_json;
      if (!imageBase64) {
        throw new ImageProviderError('OpenAI não retornou uma imagem.', {
          provider: 'openai',
          status: response.status,
          code: 'MISSING_IMAGE',
        });
      }
      return imageBase64;
    },
  };
}
