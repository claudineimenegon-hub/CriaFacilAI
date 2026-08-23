import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAIConnectivityDiagnostic } from '../experimental-v3/openai-connectivity-diagnostic.mjs';

test('diagnóstico testa GET simples e constrói multipart sem enviar imagem', async () => {
  let calls = 0;
  let captured;
  const diagnostic = createOpenAIConnectivityDiagnostic({
    apiKey: 'test-secret',
    timeoutSignalFactory: () => new AbortController().signal,
    fetchImpl: async (url, options) => {
      calls += 1;
      captured = { url, options };
      return new Response('{}', { status: 200 });
    },
  });
  const result = await diagnostic.run();
  assert.equal(calls, 1);
  assert.equal(captured.url, 'https://api.openai.com/v1/models');
  assert.equal(captured.options.method, 'GET');
  assert.equal(Object.hasOwn(captured.options, 'body'), false);
  assert.equal(result.simpleFetch.success, true);
  assert.equal(result.simpleFetch.statusHttp, 200);
  assert.deepEqual(result.multipartConstruction, { success: true, stage: 'COMPLETE' });
  assert.equal(result.runtimeApis.fetch, true);
});
test('falha de transporte retorna somente diagnóstico sanitizado', async () => {
  const secret = 'secret-never-log';
  const diagnostic = createOpenAIConnectivityDiagnostic({
    apiKey: secret,
    timeoutSignalFactory: () => new AbortController().signal,
    fetchImpl: async () => {
      throw Object.assign(new TypeError(`private ${secret}`), {
        cause: { code: 'ENOTFOUND', message: `private ${secret}` },
      });
    },
  });
  const result = await diagnostic.run();
  assert.deepEqual(result.simpleFetch, {
    success: false,
    statusHttp: null,
    errorName: 'TypeError',
    causeCode: 'ENOTFOUND',
    transportFailureCause: 'DNS_ERROR',
    elapsedMs: result.simpleFetch.elapsedMs,
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|private|authorization|base64|prompt/i);
});
