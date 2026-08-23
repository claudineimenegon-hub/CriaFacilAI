import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAIConnectivityDiagnostic } from '../experimental-v3/openai-connectivity-diagnostic.mjs';

test('diagnóstico testa GET simples e constrói multipart sem enviar imagem', async () => {
  let calls = 0;
  const captured = [];
  const diagnostic = createOpenAIConnectivityDiagnostic({
    apiKey: '  test-secret  \r\n',
    timeoutSignalFactory: () => new AbortController().signal,
    fetchImpl: async (url, options) => {
      calls += 1;
      captured.push({ url, options });
      return new Response('{}', { status: url.includes('openai.com') && !options.headers ? 401 : 200 });
    },
    dnsLookupImpl: async () => [{ address: '192.0.2.1', family: 4 }, { address: '2001:db8::1', family: 6 }],
    httpsRequestImpl: (_options, callback) => {
      const handlers = {};
      return {
        once: (name, handler) => { handlers[name] = handler; },
        setTimeout() {},
        end: () => callback({ statusCode: 401, resume() {} }),
      };
    },
  });
  const result = await diagnostic.run();
  assert.equal(calls, 3);
  assert.equal(captured[0].url, 'https://api.openai.com/v1/models');
  assert.equal(captured[0].options.method, 'GET');
  assert.equal(Object.hasOwn(captured[0].options, 'body'), false);
  assert.equal(result.simpleFetch.success, true);
  assert.equal(result.simpleFetch.statusHttp, 200);
  assert.deepEqual(result.multipartConstruction, { success: true, stage: 'COMPLETE' });
  assert.equal(result.runtimeApis.fetch, true);
  assert.deepEqual(result.key, {
    keyPresent: true,
    keyHadOuterWhitespace: true,
    keyHasControlCharacters: true,
    authorizationHeaderConstructible: true,
  });
  assert.equal(captured[0].options.headers.Authorization, 'Bearer test-secret');
  assert.deepEqual(result.dns, { success: true, addressCount: 2, families: ['IPv4', 'IPv6'] });
  assert.equal(result.genericEgress.statusHttp, 200);
  assert.equal(result.openAIUnauthenticated.statusHttp, 401);
  assert.equal(Object.hasOwn(captured[2].options, 'headers'), false);
  assert.equal(result.nodeHttps.statusHttp, 401);
});

test('controle interno torna Authorization não construível e não chama fetch autenticado', async () => {
  const calls = [];
  const diagnostic = createOpenAIConnectivityDiagnostic({
    apiKey: 'test\nkey',
    fetchImpl: async (url) => { calls.push(url); return new Response('{}', { status: 200 }); },
    timeoutSignalFactory: () => new AbortController().signal,
    dnsLookupImpl: async () => [],
    httpsRequestImpl: (_options, callback) => ({
      once() {}, setTimeout() {}, end: () => callback({ statusCode: 401, resume() {} }),
    }),
  });
  const result = await diagnostic.run();
  assert.deepEqual(result.key, {
    keyPresent: true,
    keyHadOuterWhitespace: false,
    keyHasControlCharacters: true,
    authorizationHeaderConstructible: false,
  });
  assert.equal(result.simpleFetch.success, false);
  assert.equal(calls.length, 2);
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
    dnsLookupImpl: async () => { throw Object.assign(new Error('private dns'), { code: 'ENOTFOUND' }); },
    httpsRequestImpl: () => { throw Object.assign(new Error('private socket'), { code: 'ECONNRESET' }); },
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
  assert.doesNotMatch(JSON.stringify(result), /secret-never-log|private|base64|prompt/i);
  assert.equal(result.dns.errorCode, 'ENOTFOUND');
  assert.equal(result.nodeHttps.transportFailureCause, 'CONNECTION_ERROR');
});
