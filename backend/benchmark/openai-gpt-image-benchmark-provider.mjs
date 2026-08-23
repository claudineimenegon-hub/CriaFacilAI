export const OPENAI_BENCHMARK_IMAGE_MODEL = 'gpt-image-2';
export const OPENAI_BENCHMARK_IMAGE_ENDPOINT = 'https://api.openai.com/v1/images/edits';
export const OPENAI_BENCHMARK_TIMEOUT_MS = 300_000;
const PROVIDER_NAME = 'openai-gpt-image';
export const OPENAI_BENCHMARK_QUALITIES = Object.freeze(['medium', 'high']);
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_RESULT_BASE64_LENGTH = 40 * 1024 * 1024;
const defaultLogger = process.env.NODE_TEST_CONTEXT ? undefined : console;

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
  if (!Array.isArray(request.inputs) || request.inputs.length < 1 || request.inputs.length > 4) {
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

function logFailure(logger, startedAt, { statusHttp, code, category, requestId }) {
  logger?.warn?.({
    provider: PROVIDER_NAME,
    model: OPENAI_BENCHMARK_IMAGE_MODEL,
    statusHttp: Number.isInteger(statusHttp) ? statusHttp : null,
    providerErrorCode: code,
    category,
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
  return Object.freeze({
    name: PROVIDER_NAME,
    model: OPENAI_BENCHMARK_IMAGE_MODEL,
    isConfigured: Boolean(apiKey),
    configurationRequired: apiKey ? null : 'OPENAI_API_KEY',
    async generate(request) {
      const size = validateRequest(request);
      const quality = selectedQuality(request);
      if (!apiKey) {
        throw providerError('OpenAI benchmark is not configured.', {
          code: 'PROVIDER_NOT_CONFIGURED',
        });
      }

      const form = new FormData();
      form.append('model', OPENAI_BENCHMARK_IMAGE_MODEL);
      request.inputs.forEach((input, index) => form.append('image[]', inputFile(input, index)));
      form.append('prompt', request.prompt);
      form.append('size', size);
      form.append('quality', quality);
      form.append('output_format', 'png');

      const startedAt = performance.now();
      let response;
      try {
        response = await fetchImpl(OPENAI_BENCHMARK_IMAGE_ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
          signal: timeoutSignalFactory(timeoutMs),
        });
      } catch (error) {
        const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        const code = timeout ? 'UPSTREAM_TIMEOUT' : 'PROVIDER_UNAVAILABLE';
        logFailure(logger, startedAt, {
          statusHttp: null,
          code,
          category: timeout ? 'timeout' : 'provider_unavailable',
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
