const knownProviderCodes = new Set([
  '3003', '3006', '3007', '3008', '3023', '3030', '3036', '3040', '3041',
  '3042', '5004', '5005', '5007', '5016', '5018', '5019', '5035',
  'PROVIDER_NOT_CONFIGURED', 'UPSTREAM_TIMEOUT', 'INVALID_CONTENT_TYPE',
  'INVALID_JSON', 'MISSING_IMAGE', 'RESULT_TOO_LARGE', 'INVALID_IMAGE',
  'UPSTREAM_ERROR',
]);

const moderationCodes = new Set(['3030', 'CONTENT_MODERATION']);
const rateLimitCodes = new Set(['3036', 'RATE_LIMITED']);
const timeoutCodes = new Set(['3007', '3008', 'UPSTREAM_TIMEOUT']);
const unavailableCodes = new Set([
  '3023', '3040', '5018', '5035', 'PROVIDER_NOT_CONFIGURED',
]);
const invalidInputCodes = new Set(['3003', '3006', '5004', 'INVALID_JSON']);

export function sanitizeProviderErrorCode(code) {
  const normalized = String(code ?? '').trim().toUpperCase();
  return knownProviderCodes.has(normalized) ? normalized : 'UNKNOWN_PROVIDER_ERROR';
}

export function categorizeImageToImageError({ code, status, validation = false }) {
  if (validation) return 'invalid_input';
  const sanitizedCode = sanitizeProviderErrorCode(code);
  if (moderationCodes.has(sanitizedCode)) return 'content_moderation';
  if (timeoutCodes.has(sanitizedCode) || status === 408 || status === 504) return 'timeout';
  if (unavailableCodes.has(sanitizedCode) || status === 503) return 'provider_unavailable';
  if (rateLimitCodes.has(sanitizedCode) || status === 429) return 'rate_limit';
  if (invalidInputCodes.has(sanitizedCode) || status === 400 || status === 413 || status === 415) {
    return 'invalid_input';
  }
  return 'internal_provider_error';
}

export function createSanitizedImageToImageTelemetry({ write = console.error } = {}) {
  return {
    recordRequest({
      requestId,
      phase,
      provider,
      model,
      status,
      startedAt,
      timestamp = new Date(),
    }) {
      const event = Object.freeze({
        requestId,
        route: '/v1/images/transform',
        operation: 'imageToImage',
        phase,
        provider: provider || 'unresolved',
        model: model || 'unresolved',
        statusHttp: Number.isInteger(status) ? status : null,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        timestamp: timestamp.toISOString(),
      });
      write(JSON.stringify(event));
      return event;
    },
    recordError({
      requestId,
      provider,
      model,
      status,
      code,
      category,
      startedAt,
      timestamp = new Date(),
    }) {
      const event = Object.freeze({
        requestId,
        operation: 'imageToImage',
        provider: provider || 'unresolved',
        model: model || 'unresolved',
        statusHttp: Number.isInteger(status) ? status : 500,
        providerErrorCode: code,
        category,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        timestamp: timestamp.toISOString(),
      });
      write(JSON.stringify(event));
      return event;
    },
  };
}
