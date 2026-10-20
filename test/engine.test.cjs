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

test('desabilitar ação remove registro e impede callbacks antigos, mantendo teste manual', async () => {
  const { engine, registrations, calls } = fixture();
  engine.setEnabled(true);
  const stale = registrations.get('A');
  const config = engine.state().config;
  const layer = config.layers[0];
  layer.bindings[0].enabled = false;
  await engine.saveConfig(config);
  assert.equal(registrations.has('A'), false);
  stale();
  assert.equal(calls.length, 0);
  await engine.runBinding(layer.id, layer.bindings[0].id);
  assert.equal(calls.length, 1);
  assert.equal(engine.events[0].bindingId, layer.bindings[0].id);
  assert.equal(typeof engine.events[0].durationMs, 'number');
});

test('prévia não executa I/O; token congela variáveis e só pode executar a ação vinculada uma vez', async () => {
  let now = Date.parse('2026-10-20T12:00:00.000Z');
  const preparedValues = [];
  let writes = 0;
  const { engine } = fixture({ now: () => now, execute: async (_action, _context, options) => { preparedValues.push(options.preparedAction); return 'OK'; } });
  engine.storage.appendLog = async () => { writes++; };
  const layer = engine.activeLayer;
  const binding = layer.bindings[0];
  const preview = engine.previewBinding(layer.id, binding.id);
  assert.equal(preparedValues.length, 0);
  assert.equal(writes, 0);
  assert.equal(preview.expiresAt, '2026-10-20T12:05:00.000Z');
  assert.match(preview.action.message, /2026-10-20T12-00-00-000Z/);
  const other = engine.config.layers[1];
  await assert.rejects(engine.runBinding(other.id, other.bindings[0].id, preview.previewId), /Prévia inválida/);
  now += 60000;
  await engine.runBinding(layer.id, binding.id, preview.previewId);
  assert.equal(preparedValues[0].message, preview.action.message);
  assert.equal(Object.isFrozen(preparedValues[0]), true);
  assert.equal(writes, 1);
  await assert.rejects(engine.runBinding(layer.id, binding.id, preview.previewId), /Prévia inválida/);
  assert.equal(preparedValues.length, 1);
});

test('prévia expira, é limitada a dez e invalida após salvar com sucesso', async () => {
  let now = Date.now();
  const { engine, calls } = fixture({ now: () => now });
  const layer = engine.activeLayer;
  const binding = layer.bindings[0];
  const expired = engine.previewBinding(layer.id, binding.id);
  now += 5 * 60 * 1000;
  await assert.rejects(engine.runBinding(layer.id, binding.id, expired.previewId), /expirada/);
  const previews = Array.from({ length: 11 }, () => engine.previewBinding(layer.id, binding.id));
  assert.equal(engine.previews.size, 10);
  await assert.rejects(engine.runBinding(layer.id, binding.id, previews[0].previewId), /inválida/);
  engine.storage.save = async () => { throw new Error('disco'); };
  await assert.rejects(engine.saveConfig(engine.config), /disco/);
  await engine.runBinding(layer.id, binding.id, previews[1].previewId);
  engine.storage.save = async () => {};
  await engine.saveConfig(engine.config);
  await assert.rejects(engine.runBinding(layer.id, binding.id, previews[2].previewId), /inválida/);
  assert.equal(calls.length, 1);
});

test('resultados HTTP expõem duração e status sem persistir headers, corpo ou erro bruto', async () => {
  let now = 0;
  const config = defaultConfig();
  config.layers[0].bindings[0].action = { type: 'http', method: 'POST', url: 'https://example.test/', headers: { Authorization: 'secret-header' }, query: {}, body: 'secret-body' };
  const writes = [];
  const { engine } = fixture({ config, now: () => now, execute: async (_action, _context, options) => {
    assert.equal(options.preparedAction.headers.Authorization, 'secret-header');
    options.onHttpStatus(503);
    now += 42;
    throw Object.assign(new Error('secret-header secret-body'), { httpStatus: 503 });
  } });
  engine.storage.appendLog = async event => writes.push(event);
  const layer = engine.activeLayer;
  const preview = engine.previewBinding(layer.id, layer.bindings[0].id);
  assert.equal(preview.action.headers.Authorization, '••••••');
  const state = await engine.runBinding(layer.id, layer.bindings[0].id, preview.previewId);
  assert.equal(state.events[0].httpStatus, 503);
  assert.equal(state.events[0].durationMs, 42);
  assert.match(state.events[0].message, /HTTP 503/);
  assert.doesNotMatch(JSON.stringify(writes), /secret-header|secret-body/);
});

function applicationFixture() {
  const config = defaultConfig();
  config.settings.autoSwitchLayers = true;
  config.layers[1].applications = ['Editor', '/opt/code', 'com.example.editor'];
  return fixture({ config, platform: 'linux' });
}

test('contexto escolhe associação exata e retorna à última camada manual, sem ativar ações', () => {
  const { engine } = applicationFixture();
  const [manual, associated] = engine.config.layers;
  engine.updateApplication({ status: 'ready', current: { name: 'Editor Extra', path: '/opt/other' } });
  assert.equal(engine.activeLayerId, manual.id);
  engine.updateApplication({ status: 'ready', current: { name: 'Editor', path: '/opt/editor', title: 'Conteúdo privado' } });
  assert.equal(engine.activeLayerId, associated.id);
  assert.deepEqual(engine.state().application.current, { name: 'Editor', path: '/opt/editor' });
  assert.equal(engine.enabled, false);
  engine.setLayer(manual.id);
  engine.updateApplication({ status: 'ready', current: { name: 'Editor', path: '/opt/editor' } });
  assert.equal(engine.activeLayerId, manual.id, 'mesmo aplicativo não desfaz escolha manual');
  engine.updateApplication({ status: 'ready', current: { name: 'Code', path: '/opt/code' } });
  assert.equal(engine.activeLayerId, associated.id);
  engine.updateApplication({ status: 'ready', current: { name: 'Navegador', path: '/opt/browser' } });
  assert.equal(engine.activeLayerId, manual.id);
  engine.updateApplication({ status: 'ready', current: { name: 'App', path: '/opt/app', bundleId: 'com.example.editor' } });
  assert.equal(engine.activeLayerId, associated.id);
});

test('edição adia contexto até terminar; salvar ação mantém override manual, falha retorna controle manual', async () => {
  const { engine, registrations } = applicationFixture();
  const [manual, associated] = engine.config.layers;
  engine.setEnabled(true);
  engine.setEditing(true);
  engine.updateApplication({ status: 'ready', current: { name: 'Editor', path: '/opt/editor' } });
  assert.equal(engine.activeLayerId, manual.id);
  assert.equal(registrations.has('A'), false);
  engine.setEditing(false);
  assert.equal(engine.activeLayerId, associated.id);
  assert.equal(registrations.has('A'), true);
  engine.setLayer(manual.id);
  const config = engine.state().config;
  config.layers[0].bindings[0].name = 'Editada';
  await engine.saveConfig(config);
  assert.equal(engine.activeLayerId, manual.id);
  engine.updateApplication({ status: 'ready', current: { name: 'Code', path: '/opt/code' } });
  assert.equal(engine.activeLayerId, associated.id);
  engine.updateApplication({ status: 'error', message: 'Sem permissão' });
  assert.equal(engine.activeLayerId, manual.id);
  assert.equal(engine.state().application.status, 'error');
  assert.equal(engine.enabled, true);
  const off = engine.state().config;
  off.settings.autoSwitchLayers = false;
  await engine.saveConfig(off);
  engine.updateApplication({ status: 'ready', current: { name: 'Editor', path: '/opt/editor' } });
  assert.equal(engine.activeLayerId, manual.id);
  assert.equal(engine.application.status, 'off');
});

test('perfil reconhece executável exato no Windows e raiz .app no macOS', () => {
  const windows = defaultConfig();
  windows.settings.autoSwitchLayers = true;
  windows.layers[1].applications = ['chrome.exe'];
  const { engine: win } = fixture({ config: windows, platform: 'win32' });
  win.updateApplication({ status: 'ready', current: { name: 'Google Chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\CHROME.EXE' } });
  assert.equal(win.activeLayerId, windows.layers[1].id);
  win.updateApplication({ status: 'ready', current: { name: 'Google Chrome', path: 'C:\\Apps\\chrome-beta.exe' } });
  assert.equal(win.activeLayerId, windows.layers[0].id);
  const mac = defaultConfig();
  mac.settings.autoSwitchLayers = true;
  mac.layers[1].applications = ['/Applications/Editor.app'];
  const { engine } = fixture({ config: mac, platform: 'darwin' });
  engine.updateApplication({ status: 'ready', current: { name: 'Editor', path: '/Applications/Editor.app/Contents/MacOS/editor' } });
  assert.equal(engine.activeLayerId, mac.layers[1].id);
  engine.updateApplication({ status: 'ready', current: { name: 'Editor', path: '/Applications/Editor Beta.app/Contents/MacOS/editor' } });
  assert.equal(engine.activeLayerId, mac.layers[0].id);
});
