const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(invoke) {
  const ipc = new EventEmitter();
  ipc.invoke = invoke;
  let api;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/preload.cjs'), 'utf8'), {
    require: name => {
      assert.equal(name, 'electron');
      return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, 'dobra'); api = value; } } };
    }
  });
  return { api, ipc };
}
const state = (stateRevision, configRevision, config) => ({ stateRevision, configRevision, enabled: false, events: [], ...(config ? { config } : {}) });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('preload recompõe respostas e eventos sem configuração, sem expor patches ao cliente', async () => {
  const config = { layers: [{ id: 'layer-1' }] };
  const { api, ipc } = fixture(async channel => channel === 'dobra:get-state' ? state(1, 0, config) : state(2, 0));
  assert.equal((await api.getState()).config, config);
  assert.equal((await api.setEditing(true)).config, config);
  const events = [];
  const stop = api.onState(value => events.push(value));
  ipc.emit('dobra:state', {}, state(3, 0));
  await tick();
  assert.equal(events.length, 1);
  assert.equal(events[0].config, config);
  stop(); ipc.emit('dobra:state', {}, state(4, 0)); await tick();
  assert.equal(events.length, 1);
});

test('preload hidrata uma revisão ausente uma vez e descarta respostas atrasadas', async () => {
  let resolveHydration, resolveEditing;
  let reads = 0;
  const { api, ipc } = fixture(channel => {
    if (channel === 'dobra:get-state') { reads++; return new Promise(resolve => { resolveHydration = resolve; }); }
    return new Promise(resolve => { resolveEditing = resolve; });
  });
  const editing = api.setEditing(true);
  const seen = [];
  api.onState(value => seen.push(value));
  ipc.emit('dobra:state', {}, state(3, 1));
  ipc.emit('dobra:state', {}, state(4, 1));
  assert.equal(reads, 1);
  const config = { layers: [{ id: 'new' }] };
  resolveHydration(state(4, 1, config));
  await tick();
  resolveEditing(state(1, 0, { layers: [{ id: 'old' }] }));
  assert.equal((await editing).config.layers[0].id, 'new');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].stateRevision, 4);
  ipc.emit('dobra:state', {}, state(2, 0, { layers: [] })); await tick();
  assert.equal(seen.length, 1);
});

test('preload propaga rejeições de gravação e nunca converte erros em estado antigo', async () => {
  const { api } = fixture(async () => { throw new Error('Disco sem espaço'); });
  await assert.rejects(api.saveConfig({}), /Disco sem espaço/);
});

test('preload não aceita origem/foco forjados ao executar e ajustes não aceitam destino arbitrário', async () => {
  const calls = [];
  const { api } = fixture(async (channel, ...args) => { calls.push([channel, ...args]); return state(1, 0, { layers: [] }); });
  await api.runBinding('layer', 'binding', undefined, { origin: 'shortcut', outsideApp: true });
  await api.openInputSettings('file:///private');
  assert.deepEqual(calls, [['dobra:run-binding', 'layer', 'binding', undefined], ['dobra:open-input-settings']]);
});

test('controles de produção reconstituem State e exportação de diagnóstico não expõe estado extra', async () => {
  const config = { layers: [{ id: 'current' }] };
  const calls = [];
  let revision = 1;
  const { api } = fixture(async (channel, ...args) => {
    calls.push([channel, ...args]);
    if (channel === 'dobra:export-diagnostics') return undefined;
    return state(revision++, 0, channel === 'dobra:get-state' ? config : undefined);
  });
  await api.getState();
  assert.equal((await api.cancelExecution('binding')).config, config);
  assert.equal((await api.cancelAllExecutions()).config, config);
  assert.equal((await api.restoreBackup()).config, config);
  assert.equal(await api.exportDiagnostics(), undefined);
  assert.deepEqual(calls.slice(1), [['dobra:cancel-execution', 'binding'], ['dobra:cancel-all-executions'], ['dobra:restore-backup'], ['dobra:export-diagnostics']]);
});


test('pedido de fechamento durante carregamento é entregue quando a interface assina', () => {
  const { api, ipc } = fixture(async () => {});
  ipc.emit('dobra:close-requested', {}, { toTray: false });
  const seen = [];
  const stop = api.onCloseRequested(value => seen.push(value));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].toTray, false);
  stop();
});
