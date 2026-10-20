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
      return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } } };
    }
  });
  return { api, ipc };
}
const state = (stateRevision, configRevision, config) => ({ stateRevision, configRevision, enabled: false, events: [], ...(config ? { config } : {}) });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('preload recompõe respostas e eventos sem configuração, sem expor patches ao cliente', async () => {
  const config = { layers: [{ id: 'layer-1' }] };
  const { api, ipc } = fixture(async channel => channel === 'tracker:get-state' ? state(1, 0, config) : state(2, 0));
  assert.equal((await api.getState()).config, config);
  assert.equal((await api.setEditing(true)).config, config);
  const events = [];
  const stop = api.onState(value => events.push(value));
  ipc.emit('tracker:state', {}, state(3, 0));
  await tick();
  assert.equal(events.length, 1);
  assert.equal(events[0].config, config);
  stop(); ipc.emit('tracker:state', {}, state(4, 0)); await tick();
  assert.equal(events.length, 1);
});

test('preload hidrata uma revisão ausente uma vez e descarta respostas atrasadas', async () => {
  let resolveHydration, resolveEditing;
  let reads = 0;
  const { api, ipc } = fixture(channel => {
    if (channel === 'tracker:get-state') { reads++; return new Promise(resolve => { resolveHydration = resolve; }); }
    return new Promise(resolve => { resolveEditing = resolve; });
  });
  const editing = api.setEditing(true);
  const seen = [];
  api.onState(value => seen.push(value));
  ipc.emit('tracker:state', {}, state(3, 1));
  ipc.emit('tracker:state', {}, state(4, 1));
  assert.equal(reads, 1);
  const config = { layers: [{ id: 'new' }] };
  resolveHydration(state(4, 1, config));
  await tick();
  resolveEditing(state(1, 0, { layers: [{ id: 'old' }] }));
  assert.equal((await editing).config.layers[0].id, 'new');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].stateRevision, 4);
  ipc.emit('tracker:state', {}, state(2, 0, { layers: [] })); await tick();
  assert.equal(seen.length, 1);
});

test('preload propaga rejeições de gravação e nunca converte erros em estado antigo', async () => {
  const { api } = fixture(async () => { throw new Error('Disco sem espaço'); });
  await assert.rejects(api.saveConfig({}), /Disco sem espaço/);
});
