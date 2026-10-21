const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { Engine } = require('../app/engine.cjs');
const { defaultConfig } = require('../app/config.cjs');
const { Storage } = require('../app/storage.cjs');

function fixture(t, action, options = {}) {
  const config = defaultConfig();
  config.layers[0].bindings[0].action = action;
  config.layers[0].bindings.length = 1;
  const engine = new Engine({ config, documents: os.tmpdir(),
    shortcuts: { register: () => true, unregister: () => {}, unregisterAll: () => {} },
    storage: { save: async () => {}, appendLog: async () => {} }, ...options });
  t.after(() => engine.dispose());
  const layerId = engine.activeLayer.id;
  const bindingId = engine.activeLayer.bindings[0].id;
  return { engine, layerId, bindingId, run: () => engine.runBinding(layerId, bindingId) };
}

function waitForState(engine, predicate) {
  if (predicate(engine.state())) return Promise.resolve(engine.state());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { engine.off('state', listener); reject(new Error('Estado esperado não publicado.')); }, 2000);
    const listener = state => { if (predicate(state)) { clearTimeout(timer); engine.off('state', listener); resolve(state); } };
    engine.on('state', listener);
  });
}

test('cancelar em espera preserva arquivo concluído, publica progresso sem ticks e libera vaga', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'keyboard-cancel-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let copied = false;
  const { engine, bindingId, run } = fixture(t, { type: 'sequence', stepDelayMs: 60000, steps: [
    { type: 'file', directory: root, filename: 'feito.txt', content: 'privado', mode: 'create' }, { type: 'clipboard', text: 'não executar' }
  ] }, { storage: new Storage(path.join(root, 'profile')), desktopActions: { clipboard: () => { copied = true; } } });
  const running = run();
  const waiting = await waitForState(engine, state => state.running[0]?.phase === 'waiting');
  assert.equal(waiting.running[0].stepIndex, 1);
  assert.equal(waiting.running[0].stepCount, 2);
  assert.ok(Number.isFinite(Date.parse(waiting.running[0].startedAt)));
  const revision = waiting.stateRevision;
  await delay(20);
  assert.equal(engine.stateRevision, revision);
  assert.throws(() => engine.cancelExecution({}), /Identificador/);
  assert.equal(engine.cancelExecution('missing').stateRevision, revision);
  const cancelled = engine.cancelExecution(bindingId);
  assert.equal(cancelled.running[0].phase, 'cancelling');
  cancelled.running[0].phase = 'externo';
  assert.equal(engine.state().running[0].phase, 'cancelling');
  const state = await running;
  assert.equal(copied, false);
  assert.equal(await fs.readFile(path.join(root, 'feito.txt'), 'utf8'), 'privado');
  assert.equal(state.running.length, 0);
  assert.equal(engine.inFlight.size, 0);
  const event = state.events.find(event => event.kind === 'action');
  assert.equal(event.status, 'cancelled');
  assert.deepEqual(event.steps.map(step => step.status), ['success']);
  assert.doesNotMatch(JSON.stringify(event), /privado|não executar|feito.txt/);
});

test('cancelamento aborta HTTP real em voo sem timeout falso nem próxima etapa', async t => {
  let received;
  const requestArrived = new Promise(resolve => { received = resolve; });
  let disconnected;
  const connectionClosed = new Promise(resolve => { disconnected = resolve; });
  let complete = false;
  const server = http.createServer((request, response) => {
    if (complete) { response.writeHead(204); response.end(); return; }
    response.on('close', disconnected);
    received();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const effects = [];
  const { engine, bindingId, run } = fixture(t, { type: 'sequence', steps: [
    { type: 'clipboard', text: 'feito' },
    { type: 'http', method: 'GET', url: `http://127.0.0.1:${server.address().port}/privado`, headers: { Authorization: 'segredo' }, query: {}, body: '' },
    { type: 'clipboard', text: 'não executar' }
  ] }, { desktopActions: { clipboard: text => effects.push(text) } });
  const running = run();
  await requestArrived;
  assert.equal(engine.state().running[0].stepIndex, 2);
  engine.cancelExecution(bindingId);
  const state = await running;
  await connectionClosed;
  assert.deepEqual(effects, ['feito']);
  const event = state.events.find(event => event.kind === 'action');
  assert.equal(event.status, 'cancelled');
  assert.deepEqual(event.steps.map(step => step.status), ['success', 'cancelled']);
  assert.doesNotMatch(JSON.stringify(event), /segredo|privado|10 segundos|conectar/);
  complete = true;
  assert.equal((await run()).events[0].status, 'success');
});

test('cancelar serviço nativo não libera vaga prematuramente nem sobrepõe efeitos', async t => {
  let release;
  const effects = [];
  const { engine, bindingId, run } = fixture(t, { type: 'sequence', stepDelayMs: 0, steps: [
    { type: 'clipboard', text: 'iniciado' }, { type: 'clipboard', text: 'não executar' }
  ] }, { desktopActions: { clipboard: text => { effects.push(text); return new Promise(resolve => { release = resolve; }); } } });
  const running = run();
  engine.cancelExecution(bindingId);
  assert.equal(engine.state().running[0].phase, 'cancelling');
  assert.equal(engine.inFlight.size, 1);
  await assert.rejects(run(), /ainda está em execução/);
  release();
  const state = await running;
  assert.deepEqual(effects, ['iniciado']);
  assert.equal(state.events[0].status, 'cancelled');
  assert.deepEqual(state.events[0].steps.map(step => step.status), ['success']);
  assert.equal(engine.inFlight.size, 0);
});

test('cancelAll pausa e bloqueia hold mantido, inclusive após retomar até soltura real', async t => {
  const { engine } = fixture(t, { type: 'sequence', stepDelayMs: 60000, steps: [{ type: 'clipboard', text: 'um' }, { type: 'clipboard', text: 'dois' }] }, { desktopActions: { clipboard: () => {} } });
  const binding = engine.activeLayer.bindings[0];
  binding.trigger = 'hold'; binding.keyCode = 'KeyA'; binding.repeatMs = 100; binding.holdDelayMs = 0;
  engine.inputGroupCache.clear();
  engine.setEnabled(true); engine.updateInput({ mode: 'global' });
  const input = direction => engine.handleInput({ code: 'KeyA', direction });
  input('down');
  await waitForState(engine, state => state.running[0]?.phase === 'waiting');
  const state = engine.cancelAllExecutions();
  assert.equal(state.enabled, false);
  assert.equal(engine.gestures.active.size, 0);
  await waitForState(engine, state => !state.running.length);
  engine.setEnabled(true);
  input('down');
  await delay(130);
  assert.equal(engine.events.filter(event => event.kind === 'action').length, 1);
  input('up'); input('down');
  await waitForState(engine, state => state.running[0]?.phase === 'waiting');
  engine.cancelAllExecutions();
  await waitForState(engine, state => !state.running.length);
  assert.equal(engine.events.filter(event => event.status === 'cancelled').length, 2);
});

test('resultado já concluído não vira cancelado enquanto histórico termina de persistir', async t => {
  let finishLog, logStarted;
  const started = new Promise(resolve => { logStarted = resolve; });
  const { engine, bindingId, run } = fixture(t, { type: 'clipboard', text: 'feito' }, {
    desktopActions: { clipboard: () => {} }, storage: { appendLog: () => { logStarted(); return new Promise(resolve => { finishLog = resolve; }); } }
  });
  const pending = run();
  await started;
  assert.equal(engine.cancelExecution(bindingId).running[0].phase, 'running');
  engine.cancelAllExecutions();
  finishLog();
  assert.equal((await pending).events[0].status, 'success');
});

test('cancelar imediatamente impede primeiro efeito; dispose aborta espera e rejeita novos disparos', async t => {
  let calls = 0;
  const { engine, bindingId, run } = fixture(t, { type: 'sequence', steps: [{ type: 'clipboard', text: 'x' }] }, { desktopActions: { clipboard: () => { calls++; } } });
  const cancelOnStart = state => { if (state.running[0]?.phase === 'running') engine.cancelExecution(bindingId); };
  engine.on('state', cancelOnStart);
  assert.equal((await run()).events[0].status, 'cancelled');
  assert.equal(calls, 0);
  engine.off('state', cancelOnStart);
  const updated = engine.state().config;
  updated.layers[0].bindings[0].action = { type: 'sequence', stepDelayMs: 60000, steps: [{ type: 'clipboard', text: 'um' }, { type: 'clipboard', text: 'dois' }] };
  await engine.saveConfig(updated);
  const pending = run();
  await waitForState(engine, state => state.running[0]?.phase === 'waiting');
  engine.dispose();
  assert.equal((await pending).events[0].status, 'cancelled');
  assert.equal(calls, 1);
  assert.equal(engine.inFlight.size, 0);
  await assert.rejects(run(), /encerrando/);
});

test('State.storage preserva status do provedor e mantém fallback independente para fixtures', t => {
  const status = { encryptionAvailable: true, protection: 'encrypted', backupAvailable: true, message: 'Pronto.' };
  const { engine } = fixture(t, { type: 'clipboard', text: 'x' }, { storage: { status: () => status } });
  const state = engine.state();
  assert.deepEqual(state.storage, status);
  state.storage.protection = 'externo';
  assert.equal(status.protection, 'encrypted');
  const fallback = fixture(t, { type: 'clipboard', text: 'x' }).engine.state().storage;
  assert.equal(fallback.protection, 'unavailable');
  assert.equal(fallback.encryptionAvailable, false);
});
