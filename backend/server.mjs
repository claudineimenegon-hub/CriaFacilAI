import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createImageProvider } from './providers/index.mjs';
import { ImageProviderError } from './providers/provider-error.mjs';

const MAX_BODY_BYTES = 20_000;
const MAX_IMAGE_COUNT = 4;
const GENERATION_CONCURRENCY = 2;

const variationDirections = [
  'Explore uma composição geométrica equilibrada e memorável.',
  'Explore uma composição distinta com uso refinado de espaço negativo.',
  'Explore uma interpretação marcante com formas simples e fortes.',
  'Explore um emblema abstrato elegante com proporções diferenciadas.',
];

function variationPrompt(prompt, index, count) {
  if (count === 1) return prompt;
  const direction = [
    variationDirections[index],
    'Crie uma alternativa visual genuinamente diferente das demais.',
    'Não inclua instruções, números de variação ou textos explicativos na imagem.',
  ].join(' ');
  const availablePromptLength = 2048 - direction.length - 1;
  return `${prompt.slice(0, availablePromptLength)} ${direction}`;
}

async function generateImages(provider, prompt, count) {
  const images = [];
  for (let start = 0; start < count; start += GENERATION_CONCURRENCY) {
    const batchSize = Math.min(GENERATION_CONCURRENCY, count - start);
    const batch = Array.from({ length: batchSize }, (_, offset) => {
      const index = start + offset;
      return provider.generate(variationPrompt(prompt, index, count));
    });
    images.push(...await Promise.all(batch));
  }
  return images;
}

function sendJson(response, status, payload, allowedOrigin) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'X-Content-Type-Options': 'nosniff',
  };
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  response.writeHead(status, headers);
  response.end(status === 204 ? undefined : JSON.stringify(payload));
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      const error = new Error('PAYLOAD_TOO_LARGE');
      error.code = 'PAYLOAD_TOO_LARGE';
      throw error;
    }
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    const error = new Error('INVALID_JSON');
    error.code = 'INVALID_JSON';
    throw error;
  }
}

function selectAllowedOrigin(requestOrigin, configuredOrigin) {
  if (!requestOrigin) return undefined;
  if (configuredOrigin === '*') return '*';
  return requestOrigin === configuredOrigin ? requestOrigin : undefined;
}

export function createServer({
  allowedOrigin = process.env.ALLOWED_ORIGIN,
  imageProvider = createImageProvider(),
} = {}) {
  return http.createServer(async (request, response) => {
    const origin = request.headers.origin;
    const corsOrigin = selectAllowedOrigin(origin, allowedOrigin);

    if (origin && !corsOrigin) {
      return sendJson(response, 403, { error: 'Origem não permitida.' });
    }
    if (request.method === 'OPTIONS') return sendJson(response, 204, {}, corsOrigin);
    if (request.method === 'GET' && request.url === '/health') {
      return sendJson(response, 200, { status: 'ok' }, corsOrigin);
    }
    if (request.method !== 'POST' || request.url !== '/v1/images/generate') {
      return sendJson(response, 404, { error: 'Rota não encontrada.' }, corsOrigin);
    }
    if (!imageProvider.isConfigured) {
      return sendJson(response, 503, { error: 'Servidor ainda não configurado.' }, corsOrigin);
    }
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      return sendJson(response, 415, { error: 'Envie o conteúdo como JSON.' }, corsOrigin);
    }

    try {
      const { prompt, count = 1 } = await readJson(request);
      if (typeof prompt !== 'string' || prompt.trim().length < 3) {
        return sendJson(response, 400, { error: 'Descreva melhor a imagem.' }, corsOrigin);
      }
      if (prompt.length > 2000) {
        return sendJson(response, 400, { error: 'A descrição é muito longa.' }, corsOrigin);
      }
      if (!Number.isInteger(count) || count < 1 || count > MAX_IMAGE_COUNT) {
        return sendJson(response, 400, { error: 'A quantidade deve ser um inteiro entre 1 e 4.' }, corsOrigin);
      }

      const imagesBase64 = await generateImages(imageProvider, prompt.trim(), count);
      return sendJson(response, 200, {
        imageBase64: imagesBase64[0],
        imagesBase64,
      }, corsOrigin);
    } catch (error) {
      if (error?.code === 'PAYLOAD_TOO_LARGE') {
        return sendJson(response, 413, { error: 'A solicitação é muito grande.' }, corsOrigin);
      }
      if (error?.code === 'INVALID_JSON') {
        return sendJson(response, 400, { error: 'JSON inválido.' }, corsOrigin);
      }
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        return sendJson(response, 504, { error: 'O provedor demorou para responder.' }, corsOrigin);
      }
      if (error instanceof ImageProviderError) {
        console.error('Image provider request failed', error.provider, error.status, error.code);
        const status = error.code === 'PROVIDER_NOT_CONFIGURED'
          ? 503
          : error.status === 429 ? 429 : 502;
        return sendJson(response, status, { error: 'O provedor não conseguiu gerar esta imagem.' }, corsOrigin);
      }
      console.error('Image generation request failed', error?.name ?? 'UnknownError');
      return sendJson(response, 500, { error: 'Não foi possível processar a solicitação.' }, corsOrigin);
    }
  });
}

export function startServer({ port = Number(process.env.PORT ?? 8080) } = {}) {
  const imageProvider = createImageProvider();
  if (!imageProvider.isConfigured) console.warn(`${imageProvider.name} não configurado; a geração responderá 503.`);
  if (!process.env.ALLOWED_ORIGIN) {
    console.warn('ALLOWED_ORIGIN não configurada; requisições de navegador com Origin serão bloqueadas.');
  }
  const server = createServer({ imageProvider });
  server.listen(port, '0.0.0.0', () => {
    console.log(`LogoFácil API disponível na porta ${port} usando ${imageProvider.name}/${imageProvider.model}.`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
