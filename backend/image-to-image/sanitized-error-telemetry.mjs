const knownProviderCodes = new Set([
  '3003', '3006', '3007', '3008', '3023', '3030', '3036', '3040', '3041',
  '3042', '5004', '5005', '5007', '5016', '5018', '5019', '5035',
  'PROVIDER_NOT_CONFIGURED', 'UPSTREAM_TIMEOUT', 'INVALID_CONTENT_TYPE',
  'INVALID_JSON', 'MISSING_IMAGE', 'RESULT_TOO_LARGE', 'INVALID_IMAGE',
  'UPSTREAM_ERROR', 'INVALID_UPSTREAM_INPUT', 'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
]);

const moderationCodes = new Set(['3030', 'CONTENT_MODERATION']);
const rateLimitCodes = new Set(['3036', 'RATE_LIMITED']);
const timeoutCodes = new Set(['3007', '3008', 'UPSTREAM_TIMEOUT']);
const unavailableCodes = new Set([
  '3023', '3040', '5018', '5035', 'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_UNAVAILABLE',
]);
const invalidInputCodes = new Set([
  '3003', '3006', '5004', 'INVALID_JSON', 'INVALID_UPSTREAM_INPUT',
]);

const knownLocalErrorTypes = new Set([
  'range_error', 'type_error', 'invalid_concept_plan', 'incomplete_concept_plan',
  'prompt_build_error', 'unexpected_local_error',
]);
const knownLocalFailureStages = new Set([
  'identity_specification', 'fidelity_constraints', 'concept_planning',
  'fidelity_policy', 'prompt_build', 'creative_director_logging',
  'provider_batch', 'batch_finalize',
]);

export function sanitizeLocalErrorType(error) {
  if (knownLocalErrorTypes.has(error?.localErrorType)) return error.localErrorType;
  if (error?.name === 'RangeError') return 'range_error';
  if (error?.name === 'TypeError') return 'type_error';
  if (error?.message === 'INCOMPLETE_CONCEPT_PLAN') return 'incomplete_concept_plan';
  if (error?.message === 'CONCEPT_MUST_NOT_OVERRIDE_CANONICAL_IDENTITY') {
    return 'invalid_concept_plan';
  }
  if (error?.localFailureStage === 'prompt_build') return 'prompt_build_error';
  return 'unexpected_local_error';
}

export function sanitizeLocalFailureStage(value) {
  return knownLocalFailureStages.has(value) ? value : undefined;
}

export function sanitizeProviderErrorCode(code) {
  const normalized = String(code ?? '').trim().toUpperCase();
  return knownProviderCodes.has(normalized) ? normalized : 'UNKNOWN_PROVIDER_ERROR';
}

export function categorizeImageToImageError({
  code, status, validation = false, errorOrigin, upstreamStatusHttp,
}) {
  if (validation) return 'invalid_input';
  if (errorOrigin === 'upstream_http' && Number.isInteger(upstreamStatusHttp)) {
    if (upstreamStatusHttp >= 500) return 'upstream_unavailable';
    if (upstreamStatusHttp === 429) return 'rate_limit';
  }
  if (errorOrigin === 'network') return code === 'UPSTREAM_TIMEOUT' ? 'timeout' : 'provider_unavailable';
  if (errorOrigin === 'local_pipeline') return 'internal_provider_error';
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
        ...(providerErrorType ? { providerErrorType } : {}),
        invalidFields: invalidFields ?? [],
        ...(upstreamMessage ? { upstreamMessage } : {}),
        ...(upstreamRequestId ? { upstreamRequestId } : {}),
        ...(Number.isInteger(proposalIndex) ? { proposalIndex } : {}),
        ...(Number.isInteger(retryAttempt) ? { retryAttempt } : {}),
        ...(errorOrigin ? { errorOrigin } : {}),
        ...(failurePhase ? { failurePhase } : {}),
        ...(knownLocalErrorTypes.has(localErrorType) ? { localErrorType } : {}),
        ...(knownLocalFailureStages.has(localFailureStage) ? { localFailureStage } : {}),
        upstreamStatusHttp: Number.isInteger(upstreamStatusHttp) ? upstreamStatusHttp : null,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        timestamp: timestamp.toISOString(),
      });
      write(JSON.stringify(event));
      return event;
    },
  };
}
