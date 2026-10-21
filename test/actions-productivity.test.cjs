const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { executeAction, prepareAction, previewAction, freezePreparedAction } = require('../app/actions.cjs');
const { validateAction, defaultConfig } = require('../app/config.cjs');
const { Engine } = require('../app/engine.cjs');
const { Storage } = require('../app/storage.cjs');
const { createDiagnostics } = require('../app/diagnostics.cjs');
const context = { key: 'A', layer: 'Origem' };

async function server(t, handler) {
  const instance = http.createServer(handler);
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => { instance.closeAllConnections(); return new Promise(resolve => instance.close(resolve)); });
  return 'http://127.0.0.1:' + instance.address().port;
}
const request = (url, resultName) => ({ type: 'http', url, method: 'GET', query: {}, headers: {}, body: '', ...(resultName ? { resultName } : {}) });

test('HTTP real alimenta etapas futuras, prévia congela templates e resultados não saem do motor', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dobra-results-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let requests = 0, received;
  const url = await server(t, async (incoming, response) => {
    requests++;
    if (incoming.url === '/source') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ secret: 'RESPONSE_PRIVATE', file: 'safe.txt', literal: '{{key}}' })); }
    else { let body = ''; for await (const chunk of incoming) body += chunk; received = { url: incoming.url, token: incoming.headers['x-token'], body }; response.writeHead(201); response.end('ok'); }
  });
  const config = defaultConfig();
  config.layers[0].bindings[0].action = { type: 'sequence', steps: [
    request(url + '/source', 'reply'),
    { type: 'clipboard', text: '{{steps.reply.json.secret}}/{{steps.reply.json.literal}}/{{timestamp}}', condition: { path: 'steps.reply.status', operator: 'equals', value: '200' } },
    { type: 'file', directory, filename: '{{steps.reply.json.file}}', content: '{{steps.reply.body}}', mode: 'create', delayBeforeMs: 20 },
    { type: 'http', url: url + '/next?token={{steps.reply.json.secret}}', method: 'POST', headers: { 'X-Token': '{{steps.reply.json.secret}}' }, query: { copied: '{{steps.reply.status}}' }, body: '{{steps.reply.json.literal}}', resultName: 'next' },
    { type: 'clipboard', text: 'não executar', delayBeforeMs: 60000, condition: { path: 'steps.next.body', operator: 'contains', value: 'no' } },
    { type: 'clipboard', text: 'fim', condition: { path: 'steps.next.json.missing', operator: 'exists' } }
  ] };
  const effects = [], writes = [];
  const engine = new Engine({ config, documents: directory, now: () => Date.parse('2026-10-21T12:00:00Z'), desktopActions: { clipboard: text => effects.push(text) }, storage: { appendLog: async event => writes.push(event) } });
  t.after(() => engine.dispose());
  const layer = engine.activeLayer, binding = layer.bindings[0];
  const preview = await engine.previewBinding(layer.id, binding.id);
  assert.equal(requests, 0);
  assert.equal(preview.action.steps[1].dynamic, true);
  assert.ok(preview.action.steps[1].dynamicPaths.includes('steps.reply.json.secret'));
  assert.equal(preview.action.steps[3].headers['X-Token'], '••••••');
  preview.action.steps[1].text = 'alterado';
  const state = await engine.runBinding(layer.id, binding.id, preview.previewId);
  const event = state.events.find(event => event.kind === 'action');
  assert.equal(event.status, 'success');
  assert.equal(requests, 2);
  assert.deepEqual(effects, ['RESPONSE_PRIVATE/{{key}}/2026-10-21T12-00-00-000Z']);
  assert.equal(received.token, 'RESPONSE_PRIVATE');
  assert.equal(received.body, '{{key}}');
  assert.match(received.url, /token=RESPONSE_PRIVATE/);
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'safe.txt'), 'utf8')).secret, 'RESPONSE_PRIVATE');
  assert.deepEqual(event.steps.map(step => step.status), ['success', 'success', 'success', 'success', 'skipped', 'skipped']);
  assert.equal(event.steps[3].message, 'HTTP 201.');
  assert.doesNotMatch(JSON.stringify({ writes, state, diagnostics: createDiagnostics({ state }) }), /RESPONSE_PRIVATE/);
  assert.equal(engine.previews.size, 0);
});

test('destino dinâmico é revalidado contra arquivos internos e nomes com traversal', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dobra-result-files-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let filename = 'config.json';
  const url = await server(t, (_request, response) => response.end(JSON.stringify({ filename })));
  const storage = new Storage(directory);
  const config = defaultConfig();
  await storage.save(config);
  const original = await fs.readFile(storage.configPath, 'utf8');
  const action = validateAction({ type: 'sequence', steps: [request(url, 'reply'), { type: 'file', directory, filename: '{{steps.reply.json.filename}}', content: 'do not write', mode: 'append' }] });
  const prepared = freezePreparedAction(prepareAction(action, context, { documents: directory }));
  assert.equal(previewAction(prepared).steps[1].dynamic, true);
  await assert.rejects(executeAction(action, context, { storage, documents: directory, preparedAction: prepared }), /arquivos internos/);
  assert.equal(await fs.readFile(storage.configPath, 'utf8'), original);
  for (filename of ['../outside.txt', '..\\outside.txt', 'CON', 'bad?.txt']) {
    await assert.rejects(executeAction(action, context, { storage, documents: directory, preparedAction: prepared }), /etapa 2/);
  }
  assert.deepEqual((await fs.readdir(directory)).filter(name => name.endsWith('.txt')), []);
});

test('delay próprio soma ao intervalo global, pula condições falsas e não espera depois da última', async t => {
  const url = await server(t, (_request, response) => response.end('{"ready":true}'));
  const calls = [], steps = [];
  let finishedLast;
  const last = new Promise(resolve => { finishedLast = resolve; });
  const action = validateAction({ type: 'sequence', stepDelayMs: 35, steps: [
    request(url, 'reply'),
    { type: 'clipboard', text: 'primeiro', delayBeforeMs: 35 },
    { type: 'clipboard', text: 'segundo', delayBeforeMs: 35 },
    { type: 'clipboard', text: 'ignorado', delayBeforeMs: 60000, condition: { path: 'steps.reply.json.ready', operator: 'notEquals', value: 'true' } }
  ] });
  const running = executeAction(action, context, { desktopActions: { clipboard: text => calls.push({ text, at: performance.now() }) },
    onStep: step => { steps.push({ ...step, at: performance.now() }); if (step.index === 4) finishedLast(); } });
  await last;
  assert.equal(await Promise.race([running.then(() => true), delay(10).then(() => false)]), true);
  assert.ok(calls[0].at - steps[0].at >= 60);
  assert.ok(calls[1].at - steps[1].at >= 60);
  assert.deepEqual(calls.map(call => call.text), ['primeiro', 'segundo']);
  assert.equal(steps[3].status, 'skipped');
  assert.ok(steps[1].durationMs < 35);
});

test('resposta capturada respeita 64 KiB e não segue executando após excesso', async t => {
  let payload = '🟢'.repeat(16384); // exactly 65536 bytes, fewer than 64000 JS characters
  const url = await server(t, (_request, response) => response.end(payload));
  const effects = [];
  const action = validateAction({ type: 'sequence', steps: [request(url, 'reply'), { type: 'clipboard', text: '{{steps.reply.body}}' }] });
  await executeAction(action, context, { desktopActions: { clipboard: text => effects.push(text) } });
  assert.equal(Buffer.byteLength(effects[0]), 65536);
  payload += 'x';
  const steps = [];
  await assert.rejects(executeAction(action, context, { onStep: step => steps.push(step), desktopActions: { clipboard: text => effects.push(text) } }), /64 KiB/);
  assert.equal(effects.length, 1);
  assert.deepEqual(steps.map(step => step.status), ['error']);
  assert.equal(steps[0].httpStatus, 200);
  assert.doesNotMatch(JSON.stringify(steps), /🟢/);
});

test('cancelamento durante leitura HTTP interrompe corpo e etapas futuras', async t => {
  let headersArrived;
  const arrived = new Promise(resolve => { headersArrived = resolve; });
  const url = await server(t, (_request, response) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{"secret":"'); });
  const controller = new AbortController();
  const action = validateAction({ type: 'sequence', steps: [request(url, 'reply'), { type: 'clipboard', text: '{{steps.reply.body}}' }] });
  const steps = [];
  let effects = 0;
  const running = executeAction(action, context, { signal: controller.signal, onStep: step => steps.push(step), desktopActions: { clipboard: () => effects++ },
    fetchImpl: async (...args) => { const response = await fetch(...args); headersArrived(); return response; } });
  const rejected = assert.rejects(running, /Execução cancelada/);
  await arrived; await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await rejected;
  assert.equal(effects, 0);
  assert.deepEqual(steps.map(step => step.status), ['cancelled']);
});

test('prazo HTTP de 10 s cobre leitura parada após receber headers', { timeout: 14000 }, async t => {
  const url = await server(t, (_request, response) => { response.writeHead(200); response.write('response-private'); });
  const action = validateAction({ type: 'sequence', steps: [request(url, 'reply')] });
  const started = performance.now();
  const steps = [];
  await assert.rejects(executeAction(action, context, { onStep: step => steps.push(step) }), /10 segundos/);
  assert.ok(performance.now() - started >= 9500);
  assert.doesNotMatch(JSON.stringify(steps), /response-private/);
  assert.equal(steps[0].status, 'error');
});
