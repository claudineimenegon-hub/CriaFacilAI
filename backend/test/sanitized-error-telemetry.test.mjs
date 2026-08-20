import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  categorizeImageToImageError,
  createSanitizedImageToImageTelemetry,
  sanitizeLocalErrorType,
  sanitizeLocalFailureStage,
  sanitizeProviderErrorCode,
} from '../image-to-image/sanitized-error-telemetry.mjs';

test('classifica categorias técnicas do fluxo image-to-image', () => {
  assert.equal(categorizeImageToImageError({ code: '3030', status: 400 }), 'content_moderation');
  assert.equal(categorizeImageToImageError({ code: '3036', status: 429 }), 'rate_limit');
  assert.equal(categorizeImageToImageError({ code: 'UPSTREAM_TIMEOUT', status: 408 }), 'timeout');
  assert.equal(categorizeImageToImageError({ code: '3040', status: 429 }), 'provider_unavailable');
  assert.equal(categorizeImageToImageError({ code: 'INVALID_JSON', status: 400, validation: true }), 'invalid_input');
  assert.equal(categorizeImageToImageError({ code: 'UPSTREAM_ERROR', status: 500 }), 'internal_provider_error');
  assert.equal(categorizeImageToImageError({
    code: 'UPSTREAM_ERROR', status: 502, errorOrigin: 'upstream_http', upstreamStatusHttp: 500,
  }), 'upstream_unavailable');
  assert.equal(categorizeImageToImageError({
    code: 'UPSTREAM_ERROR', status: 500, errorOrigin: 'local_pipeline', upstreamStatusHttp: null,
  }), 'internal_provider_error');
});

test('telemetria local usa somente tipo e estágio allowlisted', () => {
  assert.equal(sanitizeLocalErrorType(new RangeError('sensitive prompt contents')), 'range_error');
  assert.equal(sanitizeLocalErrorType(new TypeError('sensitive value')), 'type_error');
  assert.equal(sanitizeLocalFailureStage('prompt_build'), 'prompt_build');
  assert.equal(sanitizeLocalFailureStage('secret-stage'), undefined);

  const lines = [];
  const telemetry = createSanitizedImageToImageTelemetry({ write: (line) => lines.push(line) });
  const event = telemetry.recordError({
    requestId: 'local-id', provider: 'provider', model: 'model', status: 500,
    code: 'UPSTREAM_ERROR', category: 'internal_provider_error',
    errorOrigin: 'local_pipeline', failurePhase: 'local_pipeline',
    localErrorType: 'range_error', localFailureStage: 'prompt_build',
    startedAt: performance.now(), message: 'sensitive prompt contents',
    stack: 'sensitive stack', prompt: 'sensitive prompt',
  });

  assert.equal(event.localErrorType, 'range_error');
  assert.equal(event.localFailureStage, 'prompt_build');
  assert.doesNotMatch(lines[0], /sensitive|stack|prompt contents/i);
});

test('código desconhecido não é registrado literalmente', () => {
  assert.equal(sanitizeProviderErrorCode('detail-with-secret-value'), 'UNKNOWN_PROVIDER_ERROR');
});

test('evento contém somente campos sanitizados permitidos', () => {
  const lines = [];
  const telemetry = createSanitizedImageToImageTelemetry({ write: (line) => lines.push(line) });
  const event = telemetry.recordError({
    requestId: 'request-id',
    provider: 'provider-name',
    model: 'model-name',
    status: 400,
    code: '3030',
    category: 'content_moderation',
    startedAt: performance.now(),
    timestamp: new Date('2026-08-15T12:00:00.000Z'),
    prompt: 'must-not-appear',
    token: 'must-not-appear',
    accountId: 'must-not-appear',
    image: Buffer.from('must-not-appear'),
    imagesBase64: ['base64-must-not-appear'],
  });

  assert.deepEqual(Object.keys(event), [
    'requestId', 'operation', 'provider', 'model', 'statusHttp',
    'providerErrorCode', 'category', 'invalidFields', 'upstreamStatusHttp', 'latencyMs', 'timestamp',
  ]);
  assert.deepEqual(JSON.parse(lines[0]), event);
  assert.equal(lines[0].includes('must-not-appear'), false);
  assert.equal(lines[0].includes('base64-must-not-appear'), false);
});

test('telemetria preserva diagnóstico seguro por proposta e retry sem prompt', () => {
  const lines = [];
  const telemetry = createSanitizedImageToImageTelemetry({ write: (line) => lines.push(line) });
  const event = telemetry.recordError({
    requestId: 'local-id', provider: 'fal-flux2-pro', model: 'fal-ai/flux-2-pro/edit',
    status: 422, code: 'INVALID_UPSTREAM_INPUT', category: 'content_policy',
    providerErrorType: 'content_policy_violation', invalidFields: ['body.prompt'],
    upstreamMessage: 'The content was flagged by a content checker.',
    upstreamRequestId: 'fal-safe-id', proposalIndex: 2, retryAttempt: 1,
    errorOrigin: 'upstream_http', failurePhase: 'upstream_http', upstreamStatusHttp: 422,
    startedAt: performance.now(), prompt: 'must-not-appear',
  });

  assert.equal(event.statusHttp, 422);
  assert.equal(event.category, 'content_policy');
  assert.deepEqual(event.invalidFields, ['body.prompt']);
  assert.equal(event.upstreamRequestId, 'fal-safe-id');
  assert.equal(event.proposalIndex, 2);
  assert.equal(event.retryAttempt, 1);
  assert.equal(event.errorOrigin, 'upstream_http');
  assert.equal(event.failurePhase, 'upstream_http');
  assert.equal(event.upstreamStatusHttp, 422);
  assert.doesNotMatch(lines[0], /must-not-appear|base64|Authorization|FAL_KEY/i);
});

test('ciclo da requisição registra somente metadados sanitizados', () => {
  const lines = [];
  const telemetry = createSanitizedImageToImageTelemetry({ write: (line) => lines.push(line) });
  const event = telemetry.recordRequest({
    requestId: 'request-id',
    phase: 'provider_started',
    provider: 'provider-name',
    model: 'model-name',
    status: null,
    startedAt: performance.now(),
    timestamp: new Date('2026-08-15T12:00:00.000Z'),
    prompt: 'must-not-appear',
    token: 'must-not-appear',
    accountId: 'must-not-appear',
    image: Buffer.from('must-not-appear'),
  });

  assert.deepEqual(Object.keys(event), [
    'requestId', 'route', 'operation', 'phase', 'provider', 'model',
    'statusHttp', 'latencyMs', 'timestamp',
  ]);
  assert.deepEqual(JSON.parse(lines[0]), event);
  assert.equal(lines[0].includes('must-not-appear'), false);
});
