const MODELS_ENDPOINT = 'https://api.openai.com/v1/models';
const DIAGNOSTIC_TIMEOUT_MS = 15_000;

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'EAI_NODATA']);
const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);
const CONNECTION_CODES = new Set([
  'ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETDOWN',
  'ENETUNREACH', 'ENOTCONN', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_ABORTED',
  'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CLOSED', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_DESTROYED', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET',
]);

function safeToken(value) {
  if (typeof value !== 'string') return undefined;
  const token = value.trim().slice(0, 64);
  return /^[A-Za-z0-9_.-]+$/.test(token) ? token : undefined;
}
function errorCodes(error) {
  const values = [error?.code, error?.cause?.code];
  if (Array.isArray(error?.cause?.errors)) {
    values.push(...error.cause.errors.slice(0, 8).map((item) => item?.code));
  }
  return values.map((value) => safeToken(value)?.toUpperCase()).filter(Boolean);
}

function classify(error) {
  const codes = errorCodes(error);
  if (codes.some((code) => DNS_CODES.has(code))) return 'DNS_ERROR';
  if (codes.some((code) => TLS_CODES.has(code) || code.startsWith('ERR_TLS_') || code.startsWith('ERR_SSL_'))) return 'TLS_ERROR';
  if (codes.some((code) => CONNECTION_CODES.has(code) || code.startsWith('UND_ERR_'))) return 'CONNECTION_ERROR';
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'TIMEOUT';
  if (typeof globalThis.fetch !== 'function') return 'FETCH_UNAVAILABLE';
  return 'UNKNOWN_TRANSPORT_ERROR';
}

function runtimeApis() {
  return Object.freeze({
    fetch: typeof globalThis.fetch === 'function',
    FormData: typeof globalThis.FormData === 'function',
    File: typeof globalThis.File === 'function',
    Blob: typeof globalThis.Blob === 'function',
    AbortSignalTimeout: typeof globalThis.AbortSignal?.timeout === 'function',
  });
}

function multipartConstruction() {
  let stage = 'FORM_DATA_CREATION';
  try {
    const form = new FormData();
    stage = 'FILE_CREATION';
    const file = new File([Buffer.from([0xff, 0xd8, 0xff])], 'diagnostic.jpg', { type: 'image/jpeg' });
    stage = 'FORM_DATA_APPEND';
    form.append('model', 'gpt-image-2');
    form.append('image[]', file);
    form.append('prompt', 'diagnostic');
    form.append('size', '1024x1024');
    form.append('quality', 'medium');
    form.append('output_format', 'png');
    return Object.freeze({ success: true, stage: 'COMPLETE' });
  } catch {
    return Object.freeze({ success: false, stage });
  }
}

export function createOpenAIConnectivityDiagnostic({
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = globalThis.fetch,
  timeoutSignalFactory = (milliseconds) => AbortSignal.timeout(milliseconds),
} = {}) {
  return Object.freeze({
    async run() {
      const startedAt = performance.now();
      let simpleFetch;
      try {
        if (!apiKey || typeof fetchImpl !== 'function') throw new TypeError('Connectivity check unavailable.');
        const response = await fetchImpl(MODELS_ENDPOINT, {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: timeoutSignalFactory(DIAGNOSTIC_TIMEOUT_MS),
        });
        simpleFetch = {
          success: true,
          statusHttp: response.status,
          elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
        };
      } catch (error) {
        simpleFetch = {
          success: false,
          statusHttp: null,
          ...(safeToken(error?.name) ? { errorName: safeToken(error.name) } : {}),
          ...(safeToken(error?.code) ? { errorCode: safeToken(error.code) } : {}),
          ...(safeToken(error?.cause?.code) ? { causeCode: safeToken(error.cause.code) } : {}),
          transportFailureCause: classify(error),
          elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
        };
      }
      return Object.freeze({
        runtimeApis: runtimeApis(),
        simpleFetch: Object.freeze(simpleFetch),
        multipartConstruction: multipartConstruction(),
      });
    },
  });
}
