const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultConfig } = require('../app/config.cjs');
const { Engine } = require('../app/engine.cjs');

function fixture(options = {}) {
  const registrations = new Map();
  const calls = [];
  const shortcuts = { register: (key, callback) => { if (options.fail === key) return false; registrations.set(key, callback); return true; }, unregister: key => registrations.delete(key), unregisterAll: () => registrations.clear() };
  const storage = { directory: '/data', logPath: '/data/log', save: async () => {}, appendLog: async () => {} };
  // Keep legacy coverage independent of the new-install clipboard example.
  const config = defaultConfig();
  config.layers[0].bindings[0].action = { type: 'log', message: 'Tecla {{key}} pressionada na {{layer}} em {{timestamp}}.' };
  const engine = new Engine({ config, shortcuts, storage, documents: '/documents', execute: async (action, context) => { calls.push({ action, context }); return 'OK'; }, ...options });
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
  let now = 1000;
  const { engine, registrations } = fixture({ now: () => now });
  engine.setEnabled(true);
  engine.setEditing(true);
  assert.deepEqual([...registrations.keys()], ['CommandOrControl+Shift+F12']);
  engine.setEditing(false);
  assert.ok(registrations.has('A'));
  registrations.get('CommandOrControl+Shift+F12')();
  assert.equal(engine.enabled, false);
  assert.deepEqual([...registrations.keys()], ['CommandOrControl+Shift+F12']);
  now += 400;
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

test('serviços nativos simples recebem valores resolvidos; eventos não guardam seus conteúdos', async () => {
  const { executeAction } = require('../app/actions.cjs');
  const config = defaultConfig();
  const target = config.layers[1].id;
  config.layers[0].bindings = [
    { id: 'clipboard', key: 'A', name: 'Copiar', action: { type: 'clipboard', text: 'texto privado {{key}}' } },
    { id: 'open', key: 'B', name: 'Abrir', action: { type: 'open', kind: 'url', target: 'https://example.test/privado/{{key}}' } },
    { id: 'notification', key: 'C', name: 'Avisar', action: { type: 'notification', title: 'título privado', message: 'mensagem privada {{layer}}' } },
    { id: 'layer', key: 'D', name: 'Trocar', action: { type: 'layer', layerId: target } }
  ];
  const native = [];
  const writes = [];
  const { engine } = fixture({ config, execute: executeAction, desktopActions: {
    clipboard: text => native.push(['clipboard', text]),
    open: (kind, destination) => native.push(['open', kind, destination]),
    notify: value => native.push(['notification', value])
  } });
  engine.storage.appendLog = async event => writes.push(event);
  const source = engine.activeLayer;
  for (const binding of source.bindings) {
    const preview = engine.previewBinding(source.id, binding.id);
    assert.equal(native.length, source.bindings.indexOf(binding), 'preparar não executa serviço nativo');
    await engine.runBinding(source.id, binding.id, preview.previewId);
  }
  assert.deepEqual(native, [['clipboard', 'texto privado A'], ['open', 'url', 'https://example.test/privado/B'], ['notification', { title: 'título privado', message: 'mensagem privada Camada 1' }]]);
  assert.equal(engine.activeLayerId, target);
  assert.equal(engine.manualLayerId, target);
  assert.equal(engine.enabled, false);
  assert.equal(writes.length, 4);
  assert.ok(writes.every(event => event.status === 'success'));
  assert.doesNotMatch(JSON.stringify(writes), /texto privado|título privado|mensagem privada|\/privado/);
});

test('notificação sem suporte ou rejeitada produz erro claro sem detalhes privados do sistema', async () => {
  const { executeAction } = require('../app/actions.cjs');
  const config = defaultConfig();
  config.layers[0].bindings[0].action = { type: 'notification', title: 'privado', message: 'privado' };
  for (const [code, expected] of [['NOTIFICATION_UNSUPPORTED', /não são suportadas/], ['NOTIFICATION_REJECTED', /não confirmou/]]) {
    const { engine } = fixture({ config, execute: executeAction, desktopActions: { notify: () => { throw Object.assign(new Error('detalhe privado'), { code }); } } });
    const layer = engine.activeLayer;
    const state = await engine.runBinding(layer.id, layer.bindings[0].id);
    assert.equal(state.events[0].status, 'error');
    assert.match(state.events[0].message, expected);
    assert.doesNotMatch(state.events[0].message, /detalhe privado/);
  }
});

test('sequência com HTTP real conserva prévia e origem após trocar camada; expõe falha parcial sem segredos', async t => {
  const http = require('node:http');
  const { executeAction } = require('../app/actions.cjs');
  let status = 503;
  let captured;
  let now = Date.parse('2026-10-20T12:00:00.000Z');
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    captured = { body, authorization: request.headers.authorization };
    now += 21;
    response.writeHead(status); response.end('conteúdo privado da resposta');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const config = defaultConfig();
  const sourceId = config.layers[0].id;
  const targetId = config.layers[1].id;
  const action = { type: 'sequence', steps: [
    { type: 'clipboard', text: 'texto privado {{timestamp}}' },
    { type: 'layer', layerId: targetId },
    { type: 'http', method: 'POST', url: `http://127.0.0.1:${server.address().port}/`, headers: { Authorization: 'header privado' }, query: {}, body: 'corpo privado {{layer}} {{timestamp}}' },
    { type: 'notification', title: 'título privado', message: 'mensagem privada {{layer}}' }
  ] };
  config.layers[0].bindings[0].action = action;
  const native = [];
  const writes = [];
  const { engine } = fixture({ config, execute: executeAction, now: () => now, desktopActions: {
    clipboard: text => { native.push(['clipboard', text]); now += 13; }, notify: value => native.push(['notification', value])
  } });
  engine.storage.appendLog = async event => writes.push(event);
  const binding = engine.activeLayer.bindings[0];
  const preview = engine.previewBinding(sourceId, binding.id);
  assert.equal(native.length, 0);
  assert.equal(preview.action.steps[2].headers.Authorization, '••••••');
  now += 60000;
  const failed = await engine.runBinding(sourceId, binding.id, preview.previewId);
  const event = failed.events.find(item => item.bindingId === binding.id);
  assert.equal(event.status, 'error');
  assert.match(event.message, /etapa 3 de 4: Destino respondeu HTTP 503/);
  assert.deepEqual(event.steps.map(step => [step.index, step.status]), [[1, 'success'], [2, 'success'], [3, 'error']]);
  assert.equal(event.steps[2].httpStatus, 503);
  assert.equal(event.steps[0].durationMs, 13);
  assert.equal(event.steps[2].durationMs, 21);
  assert.equal(engine.activeLayerId, targetId);
  assert.equal(engine.enabled, false);
  assert.equal(native.length, 1);
  assert.equal(captured.body, 'corpo privado Camada 1 2026-10-20T12-00-00-000Z');
  assert.equal(captured.authorization, 'header privado');
  assert.doesNotMatch(JSON.stringify(writes), /texto privado|header privado|corpo privado|título privado|mensagem privada/);
  await assert.rejects(engine.runBinding(sourceId, binding.id, preview.previewId), /Prévia inválida/);
  status = 201;
  const succeeded = await engine.runBinding(sourceId, binding.id);
  const final = succeeded.events.find(item => item.bindingId === binding.id);
  assert.equal(final.status, 'success');
  assert.equal(final.steps.length, 4);
  assert.equal(final.steps[2].httpStatus, 201);
  assert.equal(native.at(-1)[1].message, 'mensagem privada Camada 1');
});

test('sequências contam como uma execução e mantêm os limites de ação e concorrência', async () => {
  const { executeAction } = require('../app/actions.cjs');
  const config = defaultConfig();
  config.layers[0].bindings = [...'ABCDE'].map((key, index) => ({ id: 'sequence-' + index, key, name: 'Sequência ' + key, action: { type: 'sequence', steps: [{ type: 'clipboard', text: 'privado' }] } }));
  const releases = [];
  const { engine } = fixture({ config, execute: executeAction, desktopActions: { clipboard: () => new Promise(resolve => releases.push(resolve)) } });
  const layer = engine.activeLayer;
  const running = layer.bindings.slice(0, 4).map(binding => engine.runBinding(layer.id, binding.id));
  assert.equal(engine.inFlight.size, 4);
  assert.equal(releases.length, 4);
  await assert.rejects(engine.runBinding(layer.id, layer.bindings[0].id), /ainda está em execução/);
  await assert.rejects(engine.runBinding(layer.id, layer.bindings[4].id), /quatro ações/);
  releases.forEach(resolve => resolve());
  await Promise.all(running);
  assert.equal(engine.inFlight.size, 0);
  assert.equal(engine.events.filter(event => event.kind === 'action').length, 4);
});

test('token congela intervalo e histórico inclui gap somente na duração total', async () => {
  const { executeAction, prepareAction, freezePreparedAction } = require('../app/actions.cjs');
  const config = defaultConfig();
  config.layers[0].bindings[0].action = { type: 'sequence', stepDelayMs: 60, steps: [
    { type: 'clipboard', text: 'texto privado' }, { type: 'clipboard', text: 'outro texto privado' }
  ] };
  const calledAt = [];
  const logs = [];
  const { engine } = fixture({ config, execute: executeAction, desktopActions: { clipboard: () => calledAt.push(performance.now()) } });
  engine.storage.appendLog = async event => logs.push(event);
  const layer = engine.activeLayer;
  const binding = layer.bindings[0];
  const preview = engine.previewBinding(layer.id, binding.id);
  assert.equal(calledAt.length, 0);
  assert.equal(preview.action.stepDelayMs, 60);
  assert.equal(Object.isFrozen(engine.previews.get(preview.previewId).prepared), true);
  preview.action.stepDelayMs = 0; // detached presentation cannot modify the token
  binding.action.stepDelayMs = 0; // prepared execution must also ignore changes to its source
  const state = await engine.runBinding(layer.id, binding.id, preview.previewId);
  const event = state.events.find(item => item.bindingId === binding.id);
  assert.equal(event.stepDelayMs, 60);
  assert.ok(calledAt[1] - calledAt[0] >= 50);
  assert.ok(event.durationMs - event.steps.reduce((sum, step) => sum + step.durationMs, 0) >= 50);
  assert.equal(logs.at(-1).stepDelayMs, 60);
  assert.doesNotMatch(JSON.stringify(logs), /texto privado/);
  const legacy = freezePreparedAction(prepareAction({ type: 'sequence', steps: [{ type: 'clipboard', text: 'x' }] }, { key: 'A', layer: 'Origem' }));
  assert.equal(legacy.stepDelayMs, 0);
});

test('esperas de sequência mantêm quatro vagas, impedem duplicação e continuam após pausa', async () => {
  const { executeAction } = require('../app/actions.cjs');
  const config = defaultConfig();
  config.layers[0].bindings = [...'ABCDE'].map((key, index) => ({ id: 'delay-' + index, key, name: key,
    action: { type: 'sequence', stepDelayMs: 60, steps: [{ type: 'clipboard', text: key + '1' }, { type: 'clipboard', text: key + '2' }] } }));
  const effects = [];
  let firstSteps = 0, reachedGaps;
  const gaps = new Promise(resolve => { reachedGaps = resolve; });
  const { engine } = fixture({ config, execute: (action, context, options) => executeAction(action, context, { ...options, onStep: step => {
    options.onStep(step);
    if (step.index === 1 && ++firstSteps === 4) reachedGaps();
  } }), desktopActions: { clipboard: text => effects.push(text) } });
  engine.setEnabled(true);
  const layer = engine.activeLayer;
  const running = layer.bindings.slice(0, 4).map(binding => engine.runBinding(layer.id, binding.id));
  await gaps;
  engine.setEnabled(false);
  assert.equal(engine.inFlight.size, 4);
  assert.deepEqual(effects, ['A1', 'B1', 'C1', 'D1']);
  await assert.rejects(engine.runBinding(layer.id, layer.bindings[0].id), /ainda está em execução/);
  await assert.rejects(engine.runBinding(layer.id, layer.bindings[4].id), /quatro ações/);
  await Promise.all(running);
  assert.equal(engine.inFlight.size, 0);
  assert.equal(engine.enabled, false);
  assert.deepEqual(effects.slice(4), ['A2', 'B2', 'C2', 'D2']);
  assert.ok(engine.events.filter(event => event.kind === 'action').every(event => event.stepDelayMs === 60));
});

test('camada é revalidada durante execução se configuração mudar entre etapas', async () => {
  const { executeAction } = require('../app/actions.cjs');
  const config = defaultConfig();
  const target = config.layers[1].id;
  config.layers[0].bindings[0].action = { type: 'sequence', steps: [
    { type: 'clipboard', text: 'copiado' }, { type: 'layer', layerId: target }, { type: 'notification', title: 'Não executar', message: '' }
  ] };
  let release;
  let notified = false;
  const { engine } = fixture({ config, execute: executeAction, desktopActions: { clipboard: () => new Promise(resolve => { release = resolve; }), notify: () => { notified = true; } } });
  const layer = engine.activeLayer;
  const running = engine.runBinding(layer.id, layer.bindings[0].id);
  const updated = engine.state().config;
  updated.layers[0].bindings = [];
  updated.layers.pop();
  await engine.saveConfig(updated);
  release();
  const state = await running;
  const event = state.events.find(item => item.kind === 'action');
  assert.equal(event.status, 'error');
  assert.deepEqual(event.steps.map(step => step.status), ['success', 'error']);
  assert.match(event.steps[1].message, /não está mais disponível/);
  assert.equal(notified, false);
});

test('cooldown da sequência sobrevive à etapa que seleciona a própria camada', async () => {
  const { executeAction } = require('../app/actions.cjs');
  const config = defaultConfig();
  config.settings.cooldownMs = 10000;
  const layer = config.layers[0];
  layer.bindings[0].action = { type: 'sequence', steps: [{ type: 'layer', layerId: layer.id }, { type: 'clipboard', text: 'copiado' }] };
  let copies = 0;
  let now = 1000;
  const { engine, registrations } = fixture({ config, execute: executeAction, now: () => now, desktopActions: { clipboard: () => { copies++; } } });
  engine.setEnabled(true);
  registrations.get('A')();
  await new Promise(resolve => setImmediate(resolve));
  registrations.get('A')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(copies, 1);
  now += 10000;
  registrations.get('A')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(copies, 2);
});

test('cooldown pertence ao binding e à camada de origem nas trocas manuais e automáticas', async () => {
  const config = defaultConfig();
  config.settings.cooldownMs = 10000;
  config.settings.autoSwitchLayers = true;
  config.layers[0].applications = ['Editor'];
  let now = 1000;
  const { engine, registrations, calls } = fixture({ config, now: () => now });
  const [first, second] = engine.config.layers;
  engine.setEnabled(true);
  registrations.get('A')();
  await new Promise(resolve => setImmediate(resolve));
  engine.setLayer(second.id);
  registrations.get('A')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2, 'outro binding da mesma tecla pode executar na camada de destino');
  engine.setLayer(first.id);
  registrations.get('A')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2, 'retornar manualmente não apaga intervalo da origem');
  engine.setLayer(second.id);
  engine.updateApplication({ status: 'ready', current: { name: 'Editor', path: '/apps/editor' } });
  assert.equal(engine.activeLayerId, first.id);
  registrations.get('A')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2, 'retornar por aplicativo também preserva intervalo');
  now += 10000;
  registrations.get('A')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 3);
});

test('pausar é imediato após retomar ou executar ação, independente do intervalo configurado', async () => {
  const config = defaultConfig();
  config.settings.cooldownMs = 10000;
  let now = 1000;
  const { engine, registrations, calls } = fixture({ config, now: () => now });
  engine.setEnabled(true);
  registrations.get('A')();
  await new Promise(resolve => setImmediate(resolve));
  const pause = registrations.get('CommandOrControl+Shift+F12');
  pause();
  assert.equal(engine.enabled, false);
  pause();
  assert.equal(engine.enabled, false, 'repetição imediata não retoma após pausar');
  now += 399;
  pause();
  assert.equal(engine.enabled, false, 'debounce de retomada independe dos dez segundos das ações');
  now += 1;
  pause();
  assert.equal(engine.enabled, true);
  pause();
  assert.equal(engine.enabled, false);
  assert.equal(calls.length, 1);
});

test('alternância global de camada mantém seu intervalo após trocar e salvar preserva apenas bindings existentes', async () => {
  let now = 1000;
  const { engine, registrations } = fixture({ now: () => now });
  const [first, second] = engine.config.layers;
  engine.setEnabled(true);
  registrations.get('A')();
  await new Promise(resolve => setImmediate(resolve));
  registrations.get('F8')();
  assert.equal(engine.activeLayerId, second.id);
  registrations.get('F8')();
  assert.equal(engine.activeLayerId, second.id);
  now += engine.config.settings.cooldownMs;
  registrations.get('F8')();
  assert.equal(engine.activeLayerId, first.id);
  const key = JSON.stringify([first.id, first.bindings[0].id]);
  const previous = engine.lastRun.get(key);
  const same = engine.state().config;
  same.layers[0].bindings[0].name = 'Renomeada';
  await engine.saveConfig(same);
  assert.equal(engine.lastRun.get(key), previous);
  same.layers[0].bindings = [];
  await engine.saveConfig(same);
  assert.equal(engine.lastRun.has(key), false);
});

test('publish produz um único snapshot independente; revisões só avançam nos respectivos commits de estado', async () => {
  const { engine } = fixture();
  assert.equal(engine.state().configRevision, 0);
  assert.equal(engine.state().stateRevision, 0);
  let snapshots = 0;
  const originalState = engine.state.bind(engine);
  engine.state = () => { snapshots++; return originalState(); };
  let emitted;
  engine.on('state', state => { emitted = state; });
  const published = engine.publish();
  assert.equal(snapshots, 1);
  assert.equal(published, emitted);
  assert.equal(published.stateRevision, 1);
  assert.equal(published.configRevision, 0);
  published.config.layers[0].name = 'Alteração externa';
  published.events.push({ message: 'externo' });
  assert.notEqual(engine.config.layers[0].name, 'Alteração externa');
  assert.equal(engine.events.length, 0);
  const copy = engine.state();
  assert.notEqual(copy, published);
  assert.notEqual(copy.config, published.config);
  assert.equal(copy.stateRevision, 1, 'leituras não publicam novas revisões');
  engine.setEditing(true);
  assert.equal(emitted.stateRevision, 2);
  assert.equal(emitted.configRevision, 0);
  const before = engine.state().config;
  before.layers[0].name = 'Persistida';
  await engine.saveConfig(before);
  assert.equal(emitted.configRevision, 1);
  assert.equal(emitted.stateRevision, 3);
  engine.storage.save = async () => { throw new Error('sem espaço'); };
  const failed = engine.state().config;
  failed.layers[0].name = 'Não persistida';
  await assert.rejects(engine.saveConfig(failed), /sem espaço/);
  assert.equal(engine.state().configRevision, 1);
  assert.equal(engine.state().stateRevision, 3);
  assert.equal(engine.config.layers[0].name, 'Persistida');
  await assert.rejects(engine.saveConfig({ version: 99 }), /Versão/);
  assert.equal(engine.state().configRevision, 1);
});

test('save idêntico persiste e publica sem avançar revisão de conteúdo ou preservar prévias antigas', async () => {
  const { engine } = fixture();
  const writes = [];
  engine.storage.save = async config => { writes.push(structuredClone(config)); };
  const initial = engine.state();
  const layer = initial.config.layers[0];
  const preview = engine.previewBinding(layer.id, layer.bindings[0].id);
  const identical = { ...initial.config, discardedLegacyField: 'ignorado pela normalização' };
  const saved = await engine.saveConfig(identical);
  assert.equal(writes.length, 1);
  assert.equal(saved.configRevision, 0);
  assert.equal(saved.stateRevision, 1);
  assert.deepEqual(saved.config, initial.config);
  await assert.rejects(engine.runBinding(layer.id, layer.bindings[0].id, preview.previewId), /Prévia inválida/);
  const changed = structuredClone(saved.config);
  changed.layers[0].name = 'Conteúdo alterado';
  const updated = await engine.saveConfig(changed);
  assert.equal(updated.configRevision, 1);
  assert.equal(updated.stateRevision, 2);
  const repeated = await engine.saveConfig(structuredClone(changed));
  assert.equal(writes.length, 3);
  assert.equal(repeated.configRevision, 1);
  assert.equal(repeated.stateRevision, 3);
  const failed = structuredClone(changed);
  failed.layers[0].name = 'Alteração após falha';
  engine.storage.save = async () => { throw new Error('disco'); };
  await assert.rejects(engine.saveConfig(failed), /disco/);
  assert.equal(engine.state().configRevision, 1);
  engine.storage.save = async () => {};
  const retried = await engine.saveConfig(failed);
  assert.equal(retried.configRevision, 2);
  assert.equal(retried.stateRevision, 4);
});
