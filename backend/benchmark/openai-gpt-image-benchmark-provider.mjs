export const OPENAI_BENCHMARK_IMAGE_MODEL = 'gpt-image-2';
export const OPENAI_BENCHMARK_IMAGE_ENDPOINT = 'https://api.openai.com/v1/images/edits';
export const OPENAI_BENCHMARK_TIMEOUT_MS = 300_000;
const PROVIDER_NAME = 'openai-gpt-image';
export const OPENAI_BENCHMARK_QUALITIES = Object.freeze(['medium', 'high']);
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const OPENAI_GPT_IMAGE_CAPABILITIES = Object.freeze({
  maxInputImages: 4,
  acceptedMimeTypes: Object.freeze(['image/jpeg', 'image/png']),
  maxBytesPerInput: MAX_INPUT_BYTES,
  supportsMultipleInputs: true,
});
const MAX_RESULT_BASE64_LENGTH = 40 * 1024 * 1024;
const defaultLogger = process.env.NODE_TEST_CONTEXT ? undefined : console;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

class OpenAIBenchmarkProviderError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.name = 'OpenAIBenchmarkProviderError';
    this.code = code;
    this.status = status;
  }
}

function providerError(message, fields) {
  return new OpenAIBenchmarkProviderError(message, fields);
}

function normalizeApiKey(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && !CONTROL_CHARACTERS.test(normalized) ? normalized : '';
}

function safeToken(value) {
  if (typeof value !== 'string') return undefined;
  const token = value.trim().slice(0, 64);
  return /^[A-Za-z0-9_.-]+$/.test(token) ? token : undefined;
}

function safeRequestId(value) {
  if (typeof value !== 'string') return undefined;
  const requestId = value.trim().slice(0, 128);
  return /^[A-Za-z0-9_.:-]+$/.test(requestId) ? requestId : undefined;
}

const DNS_ERROR_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'EAI_NODATA']);
const TLS_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_SSL_PROTOCOL_ERROR',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED',
  'ERR_TLS_DH_PARAM_SIZE', 'ERR_TLS_HANDSHAKE_TIMEOUT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);
const CONNECTION_ERROR_CODES = new Set([
  'ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETDOWN',
  'ENETUNREACH', 'ENOTCONN', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_ABORTED',
  'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CLOSED', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_DESTROYED', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET',
]);

function safeErrorToken(value) {
  return safeToken(value);
}

function nestedTransportErrors(error) {
  const pending = [error?.cause];
  const visited = new Set();
  const errors = [];
  while (pending.length > 0 && errors.length < 8) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    errors.push(current);
    if (current.cause) pending.push(current.cause);
    if (Array.isArray(current.errors)) pending.push(...current.errors.slice(0, 8));
  }
  return errors;
}

function transportErrorCodes(error) {
  return [error, ...nestedTransportErrors(error)]
    .map((item) => safeErrorToken(item?.code)?.toUpperCase())
    .filter(Boolean)
    .slice(0, 8);
}

function sanitizedTransportError(error) {
  const nested = nestedTransportErrors(error);
  const nestedCauseCodes = [...new Set(nested.map((item) => safeErrorToken(item?.code)).filter(Boolean))].slice(0, 8);
  const nestedCauseNames = [...new Set(nested.map((item) => safeErrorToken(item?.name)).filter(Boolean))].slice(0, 8);
  return Object.freeze({
    ...(safeErrorToken(error?.name) ? { errorName: safeErrorToken(error.name) } : {}),
    ...(safeErrorToken(error?.code) ? { errorCode: safeErrorToken(error.code) } : {}),
    ...(safeErrorToken(error?.cause?.code) ? { causeCode: safeErrorToken(error.cause.code) } : {}),
    ...(safeErrorToken(error?.cause?.name) ? { causeName: safeErrorToken(error.cause.name) } : {}),
    ...(nestedCauseCodes.length ? { nestedCauseCodes } : {}),
    ...(nestedCauseNames.length ? { nestedCauseNames } : {}),
  });
}

function classifyTransportFailure(error, { fetchImpl, timeoutMs }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) return 'INVALID_TIMEOUT';
  if (typeof fetchImpl !== 'function') return 'FETCH_UNAVAILABLE';
  const codes = transportErrorCodes(error);
  if (codes.some((code) => DNS_ERROR_CODES.has(code))) return 'DNS_ERROR';
  if (codes.some((code) => TLS_ERROR_CODES.has(code) || code.startsWith('ERR_TLS_') || code.startsWith('ERR_SSL_'))) return 'TLS_ERROR';
  if (codes.some((code) => CONNECTION_ERROR_CODES.has(code) || code.startsWith('UND_ERR_'))) return 'CONNECTION_ERROR';
  return 'UNKNOWN_TRANSPORT_ERROR';
}

function inputFile(input, index) {
  if (!Buffer.isBuffer(input?.bytes) || input.bytes.length === 0 ||
      input.bytes.length > MAX_INPUT_BYTES ||
      !['image/jpeg', 'image/png'].includes(input?.mimeType)) {
    throw providerError('Invalid OpenAI benchmark image input.', {
      code: 'INVALID_INPUT_IMAGE',
    });
  }
  const extension = input.mimeType === 'image/png' ? 'png' : 'jpg';
  return new File([input.bytes], `reference-${index}.${extension}`, {
    type: input.mimeType,
  });
}

function validateRequest(request) {
  if (typeof request?.prompt !== 'string' || request.prompt.trim().length < 3) {
    throw providerError('A benchmark prompt is required.', { code: 'INVALID_PROMPT' });
  }
  if (!Array.isArray(request.inputs) || request.inputs.length < 1 ||
      request.inputs.length > OPENAI_GPT_IMAGE_CAPABILITIES.maxInputImages) {
    throw providerError('OpenAI benchmark requires one to four references.', {
      code: 'INVALID_INPUT_COUNT',
    });
  }
  const size = `${request.output?.width}x${request.output?.height}`;
  if (!['1024x1024', '1024x1536', '1536x1024'].includes(size)) {
    throw providerError('OpenAI benchmark received unsupported output dimensions.', {
      code: 'INVALID_OUTPUT_DIMENSIONS',
    });
  }
  return size;
}

function selectedQuality(request) {
  const quality = request?.parameters?.provider?.quality ?? 'high';
  if (!OPENAI_BENCHMARK_QUALITIES.includes(quality)) {
    throw providerError('Unsupported OpenAI benchmark quality.', {
      code: 'INVALID_BENCHMARK_QUALITY',
    });
  }
  return quality;
}

function numericUsage(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function tokenDetails(value) {
  if (!value || typeof value !== 'object') return undefined;
  const details = {
    image_tokens: numericUsage(value.image_tokens),
    text_tokens: numericUsage(value.text_tokens),
  };
  for (const key of Object.keys(details)) {
    if (details[key] === undefined) delete details[key];
  }
  return Object.keys(details).length ? details : undefined;
}

export function sanitizeOpenAIImageUsage(value) {
  if (!value || typeof value !== 'object') return undefined;
  const usage = {
    input_tokens: numericUsage(value.input_tokens),
    output_tokens: numericUsage(value.output_tokens),
    total_tokens: numericUsage(value.total_tokens),
    input_tokens_details: tokenDetails(value.input_tokens_details),
    output_tokens_details: tokenDetails(value.output_tokens_details),
  };
  for (const key of Object.keys(usage)) {
    if (usage[key] === undefined) delete usage[key];
  }
  return Object.keys(usage).length ? Object.freeze(usage) : undefined;
}

function imageMimeType(bytes) {
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  const jpeg = bytes.length >= 3 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return png ? 'image/png' : jpeg ? 'image/jpeg' : undefined;
}

function logFailure(logger, startedAt, {
  statusHttp, code, category, requestId, transportFailureCause, transportFailureStage,
  transportError,
}) {
  logger?.warn?.({
    provider: PROVIDER_NAME,
    model: OPENAI_BENCHMARK_IMAGE_MODEL,
    statusHttp: Number.isInteger(statusHttp) ? statusHttp : null,
    providerErrorCode: code,
    category,
    ...(transportFailureCause ? { transportFailureCause } : {}),
    ...(transportFailureStage ? { transportFailureStage } : {}),
    ...(transportError ?? {}),
    elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
    ...(requestId ? { upstreamRequestId: requestId } : {}),
    timestamp: new Date().toISOString(),
  });
}

export function createOpenAIGPTImageBenchmarkProvider({
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(process.env.OPENAI_BENCHMARK_TIMEOUT_MS ?? OPENAI_BENCHMARK_TIMEOUT_MS),
  timeoutSignalFactory = (milliseconds) => AbortSignal.timeout(milliseconds),
  logger = defaultLogger,
} = {}) {
  const normalizedApiKey = normalizeApiKey(apiKey);
  return Object.freeze({
    name: PROVIDER_NAME,
    model: OPENAI_BENCHMARK_IMAGE_MODEL,
    isConfigured: Boolean(normalizedApiKey),
    configurationRequired: normalizedApiKey ? null : 'OPENAI_API_KEY',
    capabilities: OPENAI_GPT_IMAGE_CAPABILITIES,
    async generate(request) {
      const size = validateRequest(request);
      const quality = selectedQuality(request);
      if (!normalizedApiKey) {
        throw providerError('OpenAI benchmark is not configured.', {
          code: 'PROVIDER_NOT_CONFIGURED',
        });
      }

      const startedAt = performance.now();
      let transportFailureStage = 'FORM_DATA_CREATION';
      let response;
      try {
        const form = new FormData();
        transportFailureStage = 'FORM_DATA_APPEND';
        form.append('model', OPENAI_BENCHMARK_IMAGE_MODEL);
        for (const [index, input] of request.inputs.entries()) {
          transportFailureStage = 'FILE_CREATION';
          const file = inputFile(input, index);
          transportFailureStage = 'FORM_DATA_APPEND';
          form.append('image[]', file);
        }
        form.append('prompt', request.prompt);
        form.append('size', size);
        form.append('quality', quality);
        form.append('output_format', 'png');

        transportFailureStage = 'ABORT_SIGNAL_CREATION';
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
          throw Object.assign(new Error('Invalid timeout configuration.'), { code: 'INVALID_TIMEOUT' });
        }
        if (typeof fetchImpl !== 'function') {
          throw Object.assign(new Error('Fetch is unavailable.'), { code: 'FETCH_UNAVAILABLE' });
        }
        const signal = timeoutSignalFactory(timeoutMs);
        transportFailureStage = 'FETCH_CALL';
        response = await fetchImpl(OPENAI_BENCHMARK_IMAGE_ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${normalizedApiKey}` },
          body: form,
          signal,
        });
      } catch (error) {
        if (error instanceof OpenAIBenchmarkProviderError) throw error;
        const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        const code = timeout ? 'UPSTREAM_TIMEOUT' : 'PROVIDER_UNAVAILABLE';
        const transportFailureCause = timeout
          ? undefined
          : classifyTransportFailure(error, { fetchImpl, timeoutMs });
        logFailure(logger, startedAt, {
          statusHttp: null,
          code,
          category: timeout ? 'timeout' : 'provider_unavailable',
          transportFailureCause,
          transportFailureStage,
          transportError: sanitizedTransportError(error),
        });
        throw providerError('OpenAI image edit request failed.', { code });
      }

      const contentType = response.headers.get('content-type') ?? '';
      let payload;
      if (contentType.toLowerCase().includes('application/json')) {
        try {
          payload = await response.json();
        } catch {
          payload = undefined;
        }
      }
      if (!response.ok) {
        const code = safeToken(payload?.error?.code) ?? safeToken(payload?.error?.type) ??
          (response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR');
        const requestId = safeRequestId(response.headers.get('x-request-id'));
        logFailure(logger, startedAt, {
          statusHttp: response.status,
          code,
          category: response.status === 429 ? 'rate_limit'
            : response.status >= 500 ? 'provider_unavailable' : 'invalid_input',
          requestId,
        });
        throw providerError('OpenAI image edit request was rejected.', {
          code,
          status: response.status,
        });
      }
      if (!payload) {
        throw providerError('OpenAI returned an invalid benchmark response.', {
          code: 'INVALID_JSON',
          status: response.status,
        });
      }
      const imageBase64 = payload?.data?.[0]?.b64_json;
      if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
        throw providerError('OpenAI returned no benchmark image.', {
          code: 'MISSING_IMAGE',
          status: response.status,
        });
      }
      if (imageBase64.length > MAX_RESULT_BASE64_LENGTH) {
        throw providerError('OpenAI benchmark image is too large.', {
          code: 'RESULT_TOO_LARGE',
          status: response.status,
        });
      }
      const bytes = Buffer.from(imageBase64, 'base64');
      const mimeType = imageMimeType(bytes);
      if (!mimeType) {
        throw providerError('OpenAI returned an invalid benchmark image.', {
          code: 'INVALID_IMAGE',
          status: response.status,
        });
      }
      const usage = sanitizeOpenAIImageUsage(payload.usage);
      return {
        imageBase64,
        mimeType,
        width: 1024,
        height: 1024,
        technicalMetadata: {
          provider: PROVIDER_NAME,
          model: OPENAI_BENCHMARK_IMAGE_MODEL,
          quality,
          seed: null,
          inputCount: request.inputs.length,
          ...(usage ? { usage } : {}),
        },
      };
    },
  });
}
