import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  AssetValidationError,
  createTemporaryAssetStore,
} from './assets/temporary-asset-store.mjs';
import { createImageToImageProvider } from './image-to-image/index.mjs';
import { createProductIdentityAnalyzer } from './image-to-image/product-identity-analyzer-factory.mjs';
import { createProductFidelityGuard } from './image-to-image/product-fidelity-guard-factory.mjs';
import { ImageToImageProviderError } from './image-to-image/image-to-image-provider.mjs';
import {
  categorizeImageToImageError,
  createSanitizedImageToImageTelemetry,
  sanitizeLocalErrorType,
  sanitizeLocalFailureStage,
  sanitizeProviderErrorCode,
} from './image-to-image/sanitized-error-telemetry.mjs';
import {
  generateProductPhotoBatch,
  ImageTransformBatchError,
  ImageTransformValidationError,
} from './image-to-image/image-transform-service.mjs';
import { createImageProvider } from './providers/index.mjs';
import { ImageProviderError } from './providers/provider-error.mjs';
import {
  createExperimentalV3GenerationService,
  ExperimentalV3ValidationError,
} from './experimental-v3/experimental-v3-generation-service.mjs';
import { createOpenAIConnectivityDiagnostic } from './experimental-v3/openai-connectivity-diagnostic.mjs';

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

async function readBinary(request, maxBytes) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBytes) {
      throw new AssetValidationError('A imagem excede o tamanho permitido.', {
        code: 'IMAGE_TOO_LARGE',
        status: 413,
      });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

function selectAllowedOrigin(requestOrigin, configuredOrigin) {
  if (!requestOrigin) return undefined;
  if (configuredOrigin === '*') return '*';
  return requestOrigin === configuredOrigin ? requestOrigin : undefined;
}

const preservationKeys = [
  'preserveProduct', 'preservePackaging', 'preserveLabel',
  'preservePrintedText', 'preserveLogo', 'preserveColors',
  'preserveProportions', 'preserveFace', 'preserveClothing',
  'changeBackgroundOnly', 'changeLightingOnly', 'changeSceneOnly',
];

function validateTransformRequest(payload) {
  const {
    operation,
    prompt,
    inputAssetIds,
    count,
    quality,
    aspectRatio,
    preservation = {},
    parameters = {},
  } = payload;
  if (operation !== 'imageToImage') {
    throw new ImageTransformValidationError('Operação não suportada.', { code: 'INVALID_OPERATION' });
  }
  if (typeof prompt !== 'string' || prompt.trim().length < 3 || prompt.length > 4000) {
    throw new ImageTransformValidationError('Descreva melhor a transformação.', { code: 'INVALID_PROMPT' });
  }
  if (!Array.isArray(inputAssetIds) || inputAssetIds.length < 1 || inputAssetIds.length > 4 ||
      inputAssetIds.some((id) => typeof id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id))) {
    throw new ImageTransformValidationError('Referência de imagem inválida.', { code: 'INVALID_ASSET_ID' });
  }
  if (count !== 4) {
    throw new ImageTransformValidationError('Foto Publicitária requer exatamente 4 propostas.', {
      code: 'INVALID_COUNT',
    });
  }
  if (quality !== 'standard') {
    throw new ImageTransformValidationError('Qualidade ainda não disponível.', { code: 'INVALID_QUALITY' });
  }
  if (!['1:1', '4:5', '9:16', '16:9'].includes(aspectRatio)) {
    throw new ImageTransformValidationError('Proporção não suportada.', { code: 'INVALID_ASPECT_RATIO' });
  }
  if (!preservation || typeof preservation !== 'object' || Array.isArray(preservation) ||
      preservationKeys.some((key) => preservation[key] != null && typeof preservation[key] !== 'boolean')) {
    throw new ImageTransformValidationError('Opções de preservação inválidas.', {
      code: 'INVALID_PRESERVATION',
    });
  }
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new ImageTransformValidationError('Parâmetros de geração inválidos.', {
      code: 'INVALID_PARAMETERS',
    });
  }
  return {
    operation,
    prompt: prompt.trim(),
    inputAssetIds: [...new Set(inputAssetIds)],
    count,
    quality,
    aspectRatio,
    preservation,
    parameters,
  };
}

export function createServer({
  allowedOrigin = process.env.ALLOWED_ORIGIN,
  imageProvider = createImageProvider(),
  imageToImageProvider = createImageToImageProvider(),
  assetStore = createTemporaryAssetStore(),
  imageToImageTelemetry = createSanitizedImageToImageTelemetry(),
  productIdentityAnalyzer = createProductIdentityAnalyzer(),
  productFidelityGuard = createProductFidelityGuard(),
  experimentalV3Service,
  experimentalV3ProductIdentityAnalyzer,
  openAIConnectivityDiagnostic = createOpenAIConnectivityDiagnostic(),
} = {}) {
  const v3Service = experimentalV3Service ?? createExperimentalV3GenerationService({
    assetStore,
    productIdentityAnalyzer: experimentalV3ProductIdentityAnalyzer ?? createProductIdentityAnalyzer({
      analyzerName: process.env.GEMINI_API_KEY ? 'gemini' : 'unknown',
    }),
  });
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
    if (request.method === 'GET' && request.url === '/api/experimental/openai-connectivity-check') {
      const diagnostic = await openAIConnectivityDiagnostic.run();
      return sendJson(response, 200, diagnostic, corsOrigin);
    }
    if (request.method === 'GET' && request.url?.startsWith('/v1/assets/images/')) {
      const id = request.url.slice('/v1/assets/images/'.length);
      const asset = await assetStore.readImage(id);
      if (!asset) return sendJson(response, 404, { error: 'Imagem não encontrada.' }, corsOrigin);
      const headers = {
        'Content-Type': asset.mimeType,
        'Cache-Control': 'private, max-age=60',
        'X-Content-Type-Options': 'nosniff',
      };
      if (corsOrigin) headers['Access-Control-Allow-Origin'] = corsOrigin;
      response.writeHead(200, headers);
      return response.end(asset.bytes);
    }
    if (request.method === 'POST' && request.url === '/v1/assets/images') {
      const mimeType = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
      try {
        const bytes = await readBinary(request, assetStore.maxImageBytes);
        const asset = await assetStore.saveImage({ bytes, mimeType });
        return sendJson(response, 201, { asset }, corsOrigin);
      } catch (error) {
        if (error instanceof AssetValidationError) {
          return sendJson(response, error.status, { error: error.message }, corsOrigin);
        }
        console.error('Temporary image upload failed', error?.name ?? 'UnknownError');
        return sendJson(response, 500, { error: 'Não foi possível armazenar a imagem.' }, corsOrigin);
      }
    }
    if (request.method === 'POST' && request.url === '/v1/images/transform') {
      const requestId = randomUUID();
      const startedAt = performance.now();
      const recordTransformPhase = (phase, status) =>
        imageToImageTelemetry.recordRequest?.({
          requestId,
          phase,
          provider: imageToImageProvider.name,
          model: imageToImageProvider.model,
          status,
          startedAt,
        });
      const recordTransformError = ({
        status, code, validation = false, category, providerErrorType,
        invalidFields, upstreamMessage, upstreamRequestId, proposalIndex, retryAttempt,
        errorOrigin, failurePhase, localErrorType, localFailureStage, upstreamStatusHttp,
      }) => {
        const sanitizedCode = validation
          ? String(code ?? 'INVALID_INPUT').slice(0, 64)
          : sanitizeProviderErrorCode(code);
        imageToImageTelemetry.recordError({
          requestId,
          provider: imageToImageProvider.name,
          model: imageToImageProvider.model,
          status,
          code: sanitizedCode,
          category: category ?? categorizeImageToImageError({
            code: sanitizedCode,
            status,
            validation,
            errorOrigin,
            upstreamStatusHttp,
          }),
          providerErrorType,
          invalidFields,
          upstreamMessage,
          upstreamRequestId,
          proposalIndex,
          retryAttempt,
          errorOrigin,
          failurePhase,
          localErrorType,
          localFailureStage,
          upstreamStatusHttp,
          startedAt,
        });
      };
      recordTransformPhase('request_started');
      if (!imageToImageProvider.isConfigured) {
        recordTransformError({ status: 503, code: 'PROVIDER_NOT_CONFIGURED' });
        return sendJson(response, 503, { error: 'Transformação de imagem ainda não configurada.' }, corsOrigin);
      }
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        recordTransformError({ status: 415, code: 'INVALID_CONTENT_TYPE', validation: true });
        return sendJson(response, 415, { error: 'Envie o conteúdo como JSON.' }, corsOrigin);
      }
      try {
        const transformRequest = validateTransformRequest(await readJson(request));
        recordTransformPhase('provider_started');
        const batch = await generateProductPhotoBatch({
          provider: imageToImageProvider,
          assetStore,
          request: transformRequest,
          productIdentityAnalyzer,
          productFidelityGuard,
        });
        recordTransformPhase('completed', 200);
        return sendJson(response, 200, { batch }, corsOrigin);
      } catch (error) {
        if (error?.code === 'PAYLOAD_TOO_LARGE') {
          recordTransformError({ status: 413, code: error.code, validation: true });
          return sendJson(response, 413, { error: 'A solicitação é muito grande.' }, corsOrigin);
        }
        if (error?.code === 'INVALID_JSON') {
          recordTransformError({ status: 400, code: error.code, validation: true });
          return sendJson(response, 400, { error: 'JSON inválido.' }, corsOrigin);
        }
        if (error instanceof ImageTransformValidationError) {
          recordTransformError({ status: error.status, code: error.code, validation: true });
          return sendJson(response, error.status, { error: error.message }, corsOrigin);
        }
        if (error instanceof ImageTransformBatchError) {
          const firstFailure = error.failures[0];
          const providerFailure = firstFailure?.error;
          const responseStatus = providerFailure?.code === 'PROVIDER_NOT_CONFIGURED'
            ? 503
            : providerFailure?.code === 'UPSTREAM_TIMEOUT'
              ? 504
              : ['3036', '3040', 'RATE_LIMITED'].includes(providerFailure?.code)
                ? 429
                : 502;
          for (const failure of error.failures) {
            const current = failure.error;
            recordTransformError({
              status: responseStatus,
              code: current?.code ?? error.code,
              category: current?.category,
              providerErrorType: current?.providerErrorType,
              invalidFields: current?.invalidFields,
              upstreamMessage: current?.upstreamMessage,
              upstreamRequestId: current?.upstreamRequestId,
              proposalIndex: failure.proposalIndex,
              retryAttempt: current?.retryAttempt,
              errorOrigin: current?.errorOrigin,
              failurePhase: current?.failurePhase,
              upstreamStatusHttp: current?.upstreamStatusHttp,
            });
          }
          return sendJson(response, responseStatus, {
            error: 'O provedor não conseguiu transformar esta imagem.',
          }, corsOrigin);
        }
        if (error instanceof ImageToImageProviderError) {
          const status = error.code === 'PROVIDER_NOT_CONFIGURED'
            ? 503
            : error.code === 'UPSTREAM_TIMEOUT'
              ? 504
              : error.status === 429 ? 429 : 502;
          recordTransformError({
            status,
            code: error.code,
            category: error.category,
            providerErrorType: error.providerErrorType,
            invalidFields: error.invalidFields,
            upstreamMessage: error.upstreamMessage,
            upstreamRequestId: error.upstreamRequestId,
            proposalIndex: error.proposalIndex,
            retryAttempt: error.retryAttempt,
            errorOrigin: error.errorOrigin,
            failurePhase: error.failurePhase,
            upstreamStatusHttp: error.upstreamStatusHttp,
          });
          return sendJson(response, status, {
            error: 'O provedor não conseguiu transformar esta imagem.',
          }, corsOrigin);
        }
        recordTransformError({
          status: 500,
          code: 'UPSTREAM_ERROR',
          errorOrigin: 'local_pipeline',
          failurePhase: 'local_pipeline',
          localErrorType: sanitizeLocalErrorType(error),
          localFailureStage: sanitizeLocalFailureStage(error?.localFailureStage),
          upstreamStatusHttp: null,
        });
        return sendJson(response, 500, { error: 'Não foi possível transformar a imagem.' }, corsOrigin);
      }
    }
    if (request.method === 'POST' &&
        ['/api/experimental/v3/analyze', '/api/experimental/v3/isolate', '/api/experimental/v3/generate'].includes(request.url)) {
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        return sendJson(response, 415, { error: 'Envie o conteúdo como JSON.' }, corsOrigin);
      }
      try {
        const payload = await readJson(request);
        if (request.url === '/api/experimental/v3/analyze') {
          const inventory = await v3Service.analyze(payload);
          return sendJson(response, 200, { inventory }, corsOrigin);
        }
        if (request.url === '/api/experimental/v3/isolate') {
          const isolation = await v3Service.isolate(payload);
          return sendJson(response, 200, { isolation }, corsOrigin);
        }
        const batch = await v3Service.generate(payload);
        return sendJson(response, 200, { batch }, corsOrigin);
      } catch (error) {
        if (error?.code === 'PAYLOAD_TOO_LARGE') {
          return sendJson(response, 413, { error: 'A solicitação é muito grande.' }, corsOrigin);
        }
        if (error?.code === 'INVALID_JSON') {
          return sendJson(response, 400, { error: 'JSON inválido.' }, corsOrigin);
        }
        if (error instanceof ExperimentalV3ValidationError) {
          return sendJson(response, error.status, {
            error: error.message,
            code: error.code,
            ...(error.details ? { details: error.details } : {}),
          }, corsOrigin);
        }
        console.error('Experimental V3 request failed', error?.code ?? error?.name ?? 'UnknownError');
        return sendJson(response, 500, { error: 'Não foi possível concluir o teste experimental.' }, corsOrigin);
      }
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
  const imageToImageProvider = createImageToImageProvider();
  if (!imageProvider.isConfigured) console.warn(`${imageProvider.name} não configurado; a geração responderá 503.`);
  if (!process.env.ALLOWED_ORIGIN) {
    console.warn('ALLOWED_ORIGIN não configurada; requisições de navegador com Origin serão bloqueadas.');
  }
  const server = createServer({ imageProvider, imageToImageProvider });
  server.listen(port, '0.0.0.0', () => {
    console.log(`CriaFácilAI API disponível na porta ${port} usando ${imageProvider.name}/${imageProvider.model}.`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
