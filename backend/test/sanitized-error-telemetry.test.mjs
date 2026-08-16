import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  categorizeImageToImageError,
  createSanitizedImageToImageTelemetry,
  sanitizeProviderErrorCode,
} from '../image-to-image/sanitized-error-telemetry.mjs';

test('classifica categorias técnicas do fluxo image-to-image', () => {
  assert.equal(categorizeImageToImageError({ code: '3030', status: 400 }), 'content_moderation');
  assert.equal(categorizeImageToImageError({ code: '3036', status: 429 }), 'rate_limit');
  assert.equal(categorizeImageToImageError({ code: 'UPSTREAM_TIMEOUT', status: 408 }), 'timeout');
  assert.equal(categorizeImageToImageError({ code: '3040', status: 429 }), 'provider_unavailable');
  assert.equal(categorizeImageToImageError({ code: 'INVALID_JSON', status: 400, validation: true }), 'invalid_input');
  assert.equal(categorizeImageToImageError({ code: 'UPSTREAM_ERROR', status: 500 }), 'internal_provider_error');
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
    'providerErrorCode', 'category', 'latencyMs', 'timestamp',
  ]);
  assert.deepEqual(JSON.parse(lines[0]), event);
  assert.equal(lines[0].includes('must-not-appear'), false);
  assert.equal(lines[0].includes('base64-must-not-appear'), false);
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
