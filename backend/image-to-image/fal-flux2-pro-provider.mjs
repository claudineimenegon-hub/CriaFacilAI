import {
  assertImageToImageRequest,
  ImageToImageProviderError,
} from './image-to-image-provider.mjs';
import { randomUUID } from 'node:crypto';
import { prepareFalReferenceImages } from './fal-reference-preprocessor.mjs';

export const FAL_FLUX2_PRO_EDIT_MODEL = 'fal-ai/flux-2-pro/edit';
const FAL_PROVIDER_NAME = 'fal-flux2-pro';
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RESULT_BYTES = 20 * 1024 * 1024;
const defaultLogger = process.env.NODE_TEST_CONTEXT ? undefined : console;
const safeErrorFields = new Set([
  'body', 'input', 'prompt', 'image_urls', 'image_size', 'width', 'height',
  'seed', 'output_format', 'sync_mode', 'enable_safety_checker',
  'safety_tolerance',
]);

function providerError(message, fields) {
  return new ImageToImageProviderError(message, {
    provider: FAL_PROVIDER_NAME,
    ...fields,
  });
}

function dataUriFor(input) {
  if (!['image/png', 'image/jpeg'].includes(input.mimeType) ||
      !Buffer.isBuffer(input.bytes) || input.bytes.length === 0) {
    throw providerError('Referência inválida para fal.ai.', {
      code: 'INVALID_INPUT_IMAGE',
    });
  }
  return `data:${input.mimeType};base64,${input.bytes.toString('base64')}`;
}

function decodeDataUri(value) {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/i.exec(value);
  if (!match) return undefined;
  return { mimeType: match[1].toLowerCase(), bytes: Buffer.from(match[2], 'base64') };
}

function detectImage(bytes) {
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  const isJpeg = bytes.length >= 3 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return isPng ? 'image/png' : isJpeg ? 'image/jpeg' : undefined;
}

async function readLimitedImage(response, maxBytes) {
  const contentType = (response.headers.get('content-type') ?? '')
    .split(';')[0].trim().toLowerCase();
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw providerError('fal.ai retornou imagem muito grande.', {
      status: response.status,
      code: 'RESULT_TOO_LARGE',
    });
  }
  if (!contentType.startsWith('image/')) {
    throw providerError('fal.ai retornou conteúdo que não é imagem.', {
      status: response.status,
      code: 'INVALID_IMAGE_CONTENT_TYPE',
    });
  }
  if (!response.ok) {
    throw providerError('Falha ao baixar imagem da fal.ai.', {
      status: response.status,
      code: 'IMAGE_DOWNLOAD_ERROR',
    });
  }

  const chunks = [];
  let length = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw providerError('fal.ai retornou imagem muito grande.', {
          status: response.status,
          code: 'RESULT_TOO_LARGE',
        });
      }
      chunks.push(Buffer.from(value));
    }
  } else {
    const bytes = Buffer.from(await response.arrayBuffer());
    length = bytes.length;
    chunks.push(bytes);
  }
  const bytes = Buffer.concat(chunks, length);
  if (bytes.length > maxBytes) {
    throw providerError('fal.ai retornou imagem muito grande.', {
      status: response.status,
      code: 'RESULT_TOO_LARGE',
    });
  }
  return bytes;
}

function validateResult(bytes, status) {
  if (bytes.length === 0 || bytes.length > MAX_RESULT_BYTES) {
    throw providerError('fal.ai retornou imagem vazia ou muito grande.', {
      status,
      code: bytes.length > MAX_RESULT_BYTES ? 'RESULT_TOO_LARGE' : 'INVALID_IMAGE',
    });
  }
  const mimeType = detectImage(bytes);
  if (!mimeType) {
    throw providerError('fal.ai retornou imagem inválida.', {
      status,
      code: 'INVALID_IMAGE',
    });
  }
  return mimeType;
}

function safeToken(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().slice(0, 64);
  return /^[A-Za-z0-9_.-]+$/.test(normalized) ? normalized : undefined;
}

function safeRequestId(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().slice(0, 128);
  return /^[A-Za-z0-9_.:-]+$/.test(normalized) ? normalized : undefined;
}

function upstreamRequestId(response, payload) {
  for (const name of ['x-fal-request-id', 'x-request-id', 'request-id']) {
    const candidate = safeRequestId(response.headers.get(name));
    if (candidate) return candidate;
  }
  return safeRequestId(payload?.request_id) ?? safeRequestId(payload?.requestId)
    ?? safeRequestId(payload?.error?.request_id) ?? safeRequestId(payload?.error?.requestId);
}

function safeUpstreamMessage(payload) {
  const details = Array.isArray(payload?.detail) ? payload.detail : [];
  const candidate = typeof payload?.detail === 'string' ? payload.detail
    : typeof payload?.message === 'string' ? payload.message
      : typeof payload?.error?.message === 'string' ? payload.error.message
        : typeof payload?.error?.detail === 'string' ? payload.error.detail
        : details.find((detail) => typeof detail?.msg === 'string')?.msg
          ?? details.find((detail) => typeof detail?.message === 'string')?.message;
  if (typeof candidate !== 'string') return undefined;
  const normalized = candidate.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized || /data:|base64|authorization|api[ _-]?key|fal_key|https?:\/\//i.test(normalized) ||
      /[A-Za-z0-9+/_=-]{40,}/.test(normalized)) return undefined;
  return normalized.slice(0, 160);
}

export function sanitizeFalUpstreamError(payload) {
  const details = Array.isArray(payload?.detail) ? payload.detail : [];
  const providerErrorTypes = [...new Set(details
    .map((detail) => safeToken(detail?.type))
    .filter(Boolean))];
  const invalidFields = [...new Set(details.map((detail) => {
    if (!Array.isArray(detail?.loc)) return undefined;
    const tokens = detail.loc.map((token) => {
      if (Number.isInteger(token) && token >= 0 && token < 10) return String(token);
      const safe = safeToken(token);
      return safeErrorFields.has(safe) ? safe : undefined;
    });
    return tokens.every(Boolean) ? tokens.join('.') : undefined;
  }).filter(Boolean))];
  const structuralCode = safeToken(payload?.error?.type) ?? safeToken(payload?.error?.code)
    ?? safeToken(payload?.type) ?? safeToken(payload?.code);
  return {
    providerErrorType: providerErrorTypes[0] ?? structuralCode ?? 'validation_error',
    invalidFields,
    upstreamMessage: safeUpstreamMessage(payload),
  };
}

export function categorizeFalUpstreamError({ status, sanitized }) {
  if (sanitized?.providerErrorType === 'content_policy_violation') return 'content_policy';
  if (status === 401 || status === 403) return 'authentication';
  if (status === 429) return 'quota';
  if (status === 413) return 'dimension_or_size';
  if (status >= 500) return 'upstream_unavailable';
  const evidence = [
    sanitized?.providerErrorType,
    sanitized?.upstreamMessage,
    ...(sanitized?.invalidFields ?? []),
  ].filter(Boolean).join(' ');
  if (/dimension|width|height|resolution|image_size|too.large|size/i.test(evidence)) {
    return 'dimension_or_size';
  }
  if (/schema|payload|json|field|required|validation|type_error/i.test(evidence)) {
    return 'schema_or_payload';
  }
  if (status === 400 || status === 422) return 'invalid_input';
  return 'other';
}

function logFalFailure(logger, diagnosticContext, startedAt, fields) {
  logger?.warn?.({
    ...diagnosticContext,
    statusHttp: Number.isInteger(fields.statusHttp) ? fields.statusHttp : null,
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    providerErrorCode: fields.providerErrorCode,
    category: fields.category,
    providerErrorType: fields.providerErrorType,
    invalidFields: fields.invalidFields ?? [],
    ...(fields.upstreamMessage ? { upstreamMessage: fields.upstreamMessage } : {}),
    ...(fields.upstreamRequestId ? { upstreamRequestId: fields.upstreamRequestId } : {}),
    errorOrigin: fields.errorOrigin,
    failurePhase: fields.failurePhase,
    upstreamStatusHttp: Number.isInteger(fields.upstreamStatusHttp)
      ? fields.upstreamStatusHttp : null,
    timestamp: new Date().toISOString(),
  });
}

function diagnosticErrorFields(diagnosticContext, fields) {
  return {
    invalidFields: [],
    proposalIndex: diagnosticContext?.proposalIndex ?? null,
    retryAttempt: diagnosticContext?.retryAttempt ?? 0,
    upstreamStatusHttp: null,
    ...fields,
  };
}

function enrichProviderError(error, diagnosticContext, fields) {
  if (!(error instanceof ImageToImageProviderError)) return error;
  const diagnostic = diagnosticErrorFields(diagnosticContext, fields);
  for (const [key, value] of Object.entries(diagnostic)) {
    if (error[key] == null || key === 'upstreamStatusHttp') error[key] = value;
  }
  return error;
}

function validateOutput(output) {
  if (!Number.isInteger(output?.width) || !Number.isInteger(output?.height) ||
      output.width < 512 || output.width > 2048 ||
      output.height < 512 || output.height > 2048) {
    throw providerError('Dimensões de saída inválidas para fal.ai.', {
      code: 'INVALID_OUTPUT_DIMENSIONS',
    });
  }
}

export function createFalFlux2ProImageToImageProvider({
  apiKey = process.env.FAL_KEY,
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(process.env.IMAGE_PROVIDER_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  model = FAL_FLUX2_PRO_EDIT_MODEL,
  prepareInputs = prepareFalReferenceImages,
  logger = defaultLogger,
} = {}) {
  return {
    name: FAL_PROVIDER_NAME,
    model,
    capabilities: Object.freeze({
      operations: ['imageToImage'],
      qualities: ['standard'],
      maxInputs: 4,
      preservation: 'best_effort',
    }),
    isConfigured: Boolean(apiKey),
    async generate(request) {
      assertImageToImageRequest(request);
      validateOutput(request.output);
      if (!apiKey) {
        throw providerError('fal.ai não configurado.', {
          code: 'PROVIDER_NOT_CONFIGURED',
        });
      }

      const seed = request.parameters?.provider?.seed;
      let preparedInputs;
      try {
        preparedInputs = await prepareInputs(request.inputs);
      } catch (error) {
        if (error instanceof ImageToImageProviderError) throw error;
        throw providerError('Falha local ao preparar referências para fal.ai.', {
          code: 'UPSTREAM_ERROR',
          category: 'internal_provider_error',
          providerErrorType: 'local_provider_error',
          proposalIndex: Number.isInteger(request.proposalIndex) ? request.proposalIndex : null,
          retryAttempt: Number.isInteger(request.retryAttempt) ? request.retryAttempt : 0,
          errorOrigin: 'local_pipeline',
          failurePhase: 'local_pipeline',
          upstreamStatusHttp: null,
        });
      }
      const diagnosticContext = {
        requestId: randomUUID(),
        operation: 'imageToImage',
        provider: FAL_PROVIDER_NAME,
        model,
        promptLength: request.prompt.length,
        inputCount: preparedInputs.length,
        inputMetadata: preparedInputs.map((input) => ({
          mimeType: input.mimeType,
          originalWidth: input.originalWidth ?? input.width,
          originalHeight: input.originalHeight ?? input.height,
          preparedWidth: input.width,
          preparedHeight: input.height,
          byteLength: input.bytes.length,
          resized: Boolean(input.resized),
        })),
        totalInputMegapixels: Number((preparedInputs.reduce(
          (total, input) => total + input.width * input.height, 0,
        ) / 1_000_000).toFixed(3)),
        outputWidth: request.output.width,
        outputHeight: request.output.height,
        seedPresent: Number.isInteger(seed),
        proposalIndex: Number.isInteger(request.proposalIndex) ? request.proposalIndex : null,
        retryAttempt: Number.isInteger(request.retryAttempt) ? request.retryAttempt : 0,
      };
      const input = {
        prompt: request.prompt,
        image_urls: preparedInputs.map(dataUriFor),
        image_size: {
          width: request.output.width,
          height: request.output.height,
        },
        output_format: 'png',
        sync_mode: true,
        enable_safety_checker: true,
      };
      if (Number.isInteger(seed) && seed >= 0) input.seed = seed;

      const providerStartedAt = performance.now();
      let response;
      try {
        response = await fetchImpl(`https://fal.run/${model}`, {
          method: 'POST',
          headers: {
            Authorization: `Key ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        const failure = diagnosticErrorFields(diagnosticContext, {
          statusHttp: null,
          category: timedOut ? 'timeout' : 'upstream_unavailable',
          providerErrorCode: timedOut ? 'UPSTREAM_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
          providerErrorType: timedOut ? 'upstream_timeout' : 'network_error',
          errorOrigin: 'network',
          failurePhase: 'request',
        });
        logFalFailure(logger, diagnosticContext, providerStartedAt, failure);
        if (timedOut) {
          throw providerError('fal.ai demorou para responder.', {
            code: 'UPSTREAM_TIMEOUT',
            ...failure,
          });
        }
        throw providerError('Não foi possível acessar fal.ai.', {
          code: 'PROVIDER_UNAVAILABLE',
          ...failure,
        });
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().includes('application/json')) {
        const failure = diagnosticErrorFields(diagnosticContext, {
          statusHttp: response.status,
          category: response.status >= 500 ? 'upstream_unavailable' : 'other',
          providerErrorCode: 'INVALID_CONTENT_TYPE',
          providerErrorType: 'invalid_content_type',
          errorOrigin: 'upstream_http',
          failurePhase: 'response_content_type',
          upstreamStatusHttp: response.status,
        });
        logFalFailure(logger, diagnosticContext, providerStartedAt, failure);
        throw providerError('fal.ai retornou formato inesperado.', {
          status: response.status,
          code: 'INVALID_CONTENT_TYPE',
          ...failure,
        });
      }
      let payload;
      try {
        payload = await response.json();
      } catch {
        const failure = diagnosticErrorFields(diagnosticContext, {
          statusHttp: response.status,
          category: response.status >= 500 ? 'upstream_unavailable' : 'schema_or_payload',
          providerErrorCode: 'INVALID_JSON',
          providerErrorType: 'invalid_json',
          errorOrigin: 'upstream_http',
          failurePhase: 'response_json',
          upstreamStatusHttp: response.status,
        });
        logFalFailure(logger, diagnosticContext, providerStartedAt, failure);
        throw providerError('fal.ai retornou JSON inválido.', {
          status: response.status,
          code: 'INVALID_JSON',
          ...failure,
        });
      }
      if (!response.ok) {
        const sanitized = sanitizeFalUpstreamError(payload);
        const category = categorizeFalUpstreamError({ status: response.status, sanitized });
        const requestId = upstreamRequestId(response, payload);
        const providerErrorCode = response.status === 400 || response.status === 422
          ? 'INVALID_UPSTREAM_INPUT'
          : response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR';
        const failure = diagnosticErrorFields(diagnosticContext, {
          statusHttp: response.status,
          providerErrorCode,
          category,
          upstreamRequestId: requestId,
          errorOrigin: 'upstream_http',
          failurePhase: 'upstream_http',
          upstreamStatusHttp: response.status,
          ...sanitized,
        });
        logFalFailure(logger, diagnosticContext, providerStartedAt, failure);
        throw providerError('Falha no serviço fal.ai.', {
          status: response.status,
          code: providerErrorCode,
          ...failure,
        });
      }

      const imageUrl = payload?.images?.[0]?.url;
      if (typeof imageUrl !== 'string' || imageUrl.length === 0) {
        throw providerError('fal.ai não retornou uma imagem.', {
          status: response.status,
          code: 'MISSING_IMAGE',
          ...diagnosticErrorFields(diagnosticContext, {
            category: 'schema_or_payload', providerErrorType: 'missing_image',
            errorOrigin: 'upstream_http', failurePhase: 'result_contract',
            upstreamStatusHttp: response.status,
          }),
        });
      }

      let imageBytes;
      const inline = decodeDataUri(imageUrl);
      if (inline) {
        imageBytes = inline.bytes;
      } else {
        let parsedUrl;
        try {
          parsedUrl = new URL(imageUrl);
        } catch {
          throw providerError('fal.ai retornou URL de imagem inválida.', {
            status: response.status,
            code: 'INVALID_IMAGE_URL',
            ...diagnosticErrorFields(diagnosticContext, {
              category: 'schema_or_payload', providerErrorType: 'invalid_image_url',
              errorOrigin: 'upstream_http', failurePhase: 'result_contract',
              upstreamStatusHttp: response.status,
            }),
          });
        }
        if (parsedUrl.protocol !== 'https:') {
          throw providerError('fal.ai retornou URL de imagem não segura.', {
            status: response.status,
            code: 'INVALID_IMAGE_URL',
            ...diagnosticErrorFields(diagnosticContext, {
              category: 'schema_or_payload', providerErrorType: 'invalid_image_url',
              errorOrigin: 'upstream_http', failurePhase: 'result_contract',
              upstreamStatusHttp: response.status,
            }),
          });
        }
        let imageResponse;
        try {
          imageResponse = await fetchImpl(parsedUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
            throw providerError('Download da imagem fal.ai excedeu o tempo.', {
              code: 'UPSTREAM_TIMEOUT',
              ...diagnosticErrorFields(diagnosticContext, {
                category: 'timeout', providerErrorType: 'upstream_timeout',
                errorOrigin: 'network', failurePhase: 'request',
              }),
            });
          }
          throw providerError('Não foi possível baixar a imagem fal.ai.', {
            code: 'IMAGE_DOWNLOAD_ERROR',
            ...diagnosticErrorFields(diagnosticContext, {
              category: 'upstream_unavailable', providerErrorType: 'network_error',
              errorOrigin: 'network', failurePhase: 'request',
            }),
          });
        }
        try {
          imageBytes = await readLimitedImage(imageResponse, MAX_RESULT_BYTES);
        } catch (error) {
          throw enrichProviderError(error, diagnosticContext, {
            category: imageResponse.status >= 500 ? 'upstream_unavailable' : 'schema_or_payload',
            providerErrorType: 'invalid_image_result',
            errorOrigin: 'upstream_http',
            failurePhase: 'result_contract',
            upstreamStatusHttp: imageResponse.status,
          });
        }
      }

      let mimeType;
      try {
        mimeType = validateResult(imageBytes, response.status);
      } catch (error) {
        throw enrichProviderError(error, diagnosticContext, {
          category: 'schema_or_payload',
          providerErrorType: 'invalid_image_result',
          errorOrigin: 'upstream_http',
          failurePhase: 'result_contract',
          upstreamStatusHttp: response.status,
        });
      }
      return {
        imageBase64: imageBytes.toString('base64'),
        mimeType,
        width: payload.images[0].width ?? request.output.width,
        height: payload.images[0].height ?? request.output.height,
        technicalMetadata: {
          provider: FAL_PROVIDER_NAME,
          model,
          seed: Number.isInteger(payload.seed) ? payload.seed : seed,
          preservation: 'best_effort',
          inputCount: request.inputs.length,
        },
      };
    },
  };
}
