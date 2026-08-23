import { createDeterministicCreativeDirectorV3Model, runCreativeDirectorV3 } from './creative-director-v3.mjs';

const SAFE_REASONS = new Set([
  'OPENAI_NOT_CONFIGURED', 'OPENAI_TRANSPORT_UNAVAILABLE', 'OPENAI_HTTP_ERROR',
  'OPENAI_MALFORMED_RESPONSE', 'OPENAI_INVALID_STRUCTURED_OUTPUT', 'OPENAI_TIMEOUT',
  'OPENAI_NETWORK_ERROR', 'INVALID_V3_OUTPUT', 'INSUFFICIENT_V3_DIVERSITY',
]);

function safeReason(error) {
  return SAFE_REASONS.has(error?.code) ? error.code : 'CREATIVE_DIRECTOR_TECHNICAL_FAILURE';
}

function validationDiagnostic(error) {
  if (error?.code === 'INSUFFICIENT_V3_DIVERSITY') {
    return { validationStage: 'diversity_validation', validationReason: 'insufficient_diversity' };
  }
  if (error?.code !== 'INVALID_V3_OUTPUT') return {};
  const message = error.message;
  if (message === 'V3 output must contain exactly four proposals.') {
    return { validationStage: 'root_shape', validationReason: 'invalid_proposal_count' };
  }
  if (message === 'Proposal IDs must be unique integers from 1 to 4.' ||
      message === 'Each required campaign role must appear exactly once.' ||
      message === 'Invalid human interaction mode.' || message === 'Invalid color strategy.') {
    return { validationStage: 'schema_validation', validationReason: 'invalid_enum' };
  }
  if (/meaningful string|required structured section|must be an array/.test(message)) {
    return { validationStage: 'schema_validation', validationReason: 'missing_required_field' };
  }
  if (/unknown or duplicate item ID|contains an unknown item ID|unknown item ID/.test(message)) {
    return { validationStage: 'identity_validation', validationReason: 'invalid_item_id' };
  }
  if (message === 'requiredVisibleItems violates a canonical quantity lock.' ||
      message === 'optionalVisibleItems violates a canonical quantity lock.') {
    return { validationStage: 'identity_validation', validationReason: 'invalid_quantity' };
  }
  if (message === 'Human interaction conflicts with product affordance.') {
    return { validationStage: 'affordance_validation', validationReason: 'invalid_affordance' };
  }
  if (/relationship|Pair policy/.test(message)) {
    return { validationStage: 'relationship_validation', validationReason: 'invalid_relationship' };
  }
  if (message === 'Product transformation must be forbidden.') {
    return { validationStage: 'identity_validation', validationReason: 'invalid_creative_freedom' };
  }
  return { validationStage: 'schema_validation', validationReason: 'other_allowlisted_reason' };
}

function eventFor({ adapter, attempt, success, error, result, fallback = false }) {
  const upstream = typeof adapter.lastMetadata === 'function' ? adapter.lastMetadata() : {};
  return {
    provider: adapter.name === 'openai-creative-director-v3' ? 'openai' : 'local',
    model: upstream.model ?? adapter.name,
    latencyMs: upstream.latencyMs ?? result?.latencyMs ?? null,
    statusHttp: upstream.statusHttp ?? error?.statusHttp ?? null,
    success, attempt, fallback, ...(error ? { fallbackReason: safeReason(error), ...validationDiagnostic(error) } : {}),
    proposalCount: result?.proposalCount ?? 0,
    schemaValid: result?.schemaValid ?? false,
    diversityValid: result?.diversityValid ?? false,
    ...(upstream.usage ? { usage: upstream.usage } : {}),
  };
}

export async function runCreativeDirectorV3WithFailSafe({ input, modelAdapter, logger = { info() {} } }) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await runCreativeDirectorV3({ input, modelAdapter });
      logger.info(eventFor({ adapter: modelAdapter, attempt, success: true, result }));
      return { ...result, attempts: attempt, fallback: false, telemetry: eventFor({ adapter: modelAdapter, attempt, success: true, result }) };
    } catch (error) {
      lastError = error;
      logger.info(eventFor({ adapter: modelAdapter, attempt, success: false, error }));
    }
  }
  const fallbackAdapter = createDeterministicCreativeDirectorV3Model();
  const result = await runCreativeDirectorV3({ input, modelAdapter: fallbackAdapter });
  const telemetry = eventFor({ adapter: fallbackAdapter, attempt: 0, success: true, result, fallback: true, error: lastError });
  logger.info(telemetry);
  return { ...result, attempts: 2, fallback: true, fallbackReason: safeReason(lastError), telemetry };
}
