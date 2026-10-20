const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultConfig } = require('../app/config.cjs');
const { Engine } = require('../app/engine.cjs');

function fixture(options = {}) {
  const registrations = new Map();
  const calls = [];
  const shortcuts = { register: (key, callback) => { if (options.fail === key) return false; registrations.set(key, callback); return true; }, unregister: key => registrations.delete(key), unregisterAll: () => registrations.clear() };
  const storage = { directory: '/data', logPath: '/data/log', save: async () => {}, appendLog: async () => {} };
  const engine = new Engine({ config: defaultConfig(), shortcuts, storage, documents: '/documents', execute: async (action, context) => { calls.push({ action, context }); return 'OK'; }, ...options });
  return { engine, registrations, calls };
}

test('inicia pausado e A muda de log para arquivo ao alternar camada pelo F8', async () => {
  const { engine, registrations, calls } = fixture();
  assert.equal(engine.state().enabled, false);
  assert.equal(registrations.size, 0);
  engine.setEnabled(true);
  registrations.get('A')();
  await new Promise(resolve => setImmediate(resolve));
  registrations.get('F8')();
  registrations.get('A')();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.map(call => call.action.type), ['log', 'file']);
  assert.equal(engine.events.filter(event => event.kind === 'action').length, 2);
  engine.dispose();
  assert.equal(registrations.size, 0);
});

test('edição suspende teclas; pausa mantém somente o controle para retomar', () => {
  const { engine, registrations } = fixture();
  engine.setEnabled(true);
  engine.setEditing(true);
  assert.deepEqual([...registrations.keys()], ['CommandOrControl+Shift+F12']);
  engine.setEditing(false);
  assert.ok(registrations.has('A'));
  registrations.get('CommandOrControl+Shift+F12')();
  assert.equal(engine.enabled, false);
  assert.deepEqual([...registrations.keys()], ['CommandOrControl+Shift+F12']);
  engine.lastRun.clear();
  registrations.get('CommandOrControl+Shift+F12')();
  assert.equal(engine.enabled, true);
  assert.ok(registrations.has('A'));
});

test('conflito do atalho de emergência impede ativação', () => {
  const { engine, registrations } = fixture({ fail: 'CommandOrControl+Shift+F12' });
  const state = engine.setEnabled(true);
  assert.equal(state.enabled, false);
  assert.equal(registrations.size, 0);
  assert.equal(state.shortcuts.failed.length, 1);
});

test('conflito de uma ação aparece no estado, preservando pausa e demais teclas', () => {
  const { engine, registrations } = fixture({ fail: 'A' });
  engine.setEnabled(true);
  assert.equal(engine.enabled, true);
  assert.equal(engine.state().shortcuts.failed[0].key, 'A');
  assert.ok(registrations.has('F8'));
});

test('cooldown impede chamadas em sequência; ação em voo não é duplicada', async () => {
  let release;
  let count = 0;
  const { engine, registrations } = fixture({ execute: () => { count++; return new Promise(resolve => { release = resolve; }); } });
  engine.setEnabled(true);
  registrations.get('A')();
  registrations.get('A')();
  assert.equal(count, 1);
  const layer = engine.activeLayer;
  await assert.rejects(engine.runBinding(layer.id, layer.bindings[0].id), /ainda está/);
  release('OK');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.inFlight.size, 0);
});

test('teste manual executa ação com atalhos pausados e erro aparece no histórico', async () => {
  const { engine } = fixture({ execute: async () => { throw new Error('Arquivo já existe.'); } });
  const layer = engine.activeLayer;
  const state = await engine.runBinding(layer.id, layer.bindings[0].id);
  assert.equal(state.enabled, false);
  assert.equal(state.events[0].status, 'error');
  assert.match(state.events[0].message, /já existe/);
});

test('falha ao salvar preserva configuração anterior e registros existentes', async () => {
  const { engine, registrations } = fixture();
  engine.setEnabled(true);
  const before = engine.state().config;
  engine.storage.save = async () => { throw new Error('disco indisponível'); };
  const config = structuredClone(before);
  config.layers[0].bindings[0].key = 'B';
  await assert.rejects(engine.saveConfig(config), /disco/);
  assert.deepEqual(engine.config, before);
  assert.ok(registrations.has('A'));
  assert.equal(registrations.has('B'), false);
});

test('remover camada ativa seleciona uma existente e atualiza registros', async () => {
  const { engine } = fixture();
  engine.setEnabled(true);
  const config = engine.state().config;
  config.layers.shift();
  await engine.saveConfig(config);
  assert.equal(engine.activeLayerId, config.layers[0].id);
});

test('histórico em memória é limitado e estado retornado não altera o motor', () => {
  const { engine } = fixture();
  for (let i = 0; i < 140; i++) engine.record('info', String(i));
  assert.equal(engine.state().events.length, 100);
  const state = engine.state();
  state.config.layers.length = 0;
  assert.equal(engine.config.layers.length, 2);
});
