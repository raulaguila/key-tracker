const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../app/engine.cjs');
const { defaultConfig } = require('../app/config.cjs');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) await delay(10);
  assert.ok(predicate(), 'a operação deve concluir dentro do prazo do teste');
}

function binding(trigger, key = 'A', keyCode = 'KeyA') {
  return { id: trigger + '-' + key, name: trigger, key, trigger, keyCode, ...(trigger === 'hold' ? { repeatMs: 100 } : {}), action: { type: 'log', message: 'teste' } };
}
function fixture(t, { bindings = ['press', 'hold', 'release'].map(trigger => binding(trigger)), execute, fail } = {}) {
  const config = defaultConfig();
  config.settings.cooldownMs = 100;
  config.layers[0].bindings = bindings;
  const calls = [];
  const registrations = new Map();
  const engine = new Engine({ config, documents: '/documents',
    shortcuts: { register: (key, callback) => { if (key === fail) return false; registrations.set(key, callback); return true; }, unregister: key => registrations.delete(key), unregisterAll: () => registrations.clear() },
    storage: { directory: '/data', logPath: '/data/log', save: async () => {}, appendLog: async () => {} },
    execute: async (action, context) => { calls.push({ action, context }); if (execute) return execute(action, context); return 'OK'; }
  });
  t.after(() => engine.dispose());
  const input = (direction, code = 'KeyA', modifiers = {}) => engine.handleInput({ code, key: code === 'KeyA' ? 'A' : code, direction, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers });
  const activate = () => { engine.setEnabled(true); engine.updateInput({ mode: 'global', message: 'Pronto' }); };
  return { engine, registrations, calls, input, activate };
}

test('press/hold/release compartilham registro único, usam hook físico e não duplicam keydown', async t => {
  const { engine, registrations, calls, input, activate } = fixture(t);
  assert.equal(engine.needsInput(), false);
  activate();
  assert.equal(engine.needsInput(), true);
  assert.deepEqual([...registrations.keys()].filter(key => key === 'A'), ['A']);
  registrations.get('A')();
  assert.equal(calls.length, 0, 'callback nativo não duplica grupo alimentado pelo hook');
  input('down'); input('down'); input('down');
  await tick();
  assert.equal(calls.length, 1);
  input('up'); input('up');
  await tick();
  assert.equal(calls.length, 2);
  assert.deepEqual(engine.events.filter(event => event.kind === 'action').map(event => event.trigger).sort(), ['press', 'release']);
  await delay(130);
  assert.equal(calls.length, 2, 'keyup cancelou a repetição antes do primeiro intervalo');
});

test('hold aguarda intervalo e conclusão anterior, sem sobrepor ou enfileirar repetições', async t => {
  const releases = [];
  let concurrent = 0;
  let peak = 0;
  const { engine, calls, input, activate } = fixture(t, { bindings: [binding('hold')], execute: () => {
    peak = Math.max(peak, ++concurrent);
    return new Promise(resolve => releases.push(() => { concurrent--; resolve('OK'); }));
  } });
  activate(); input('down');
  assert.equal(calls.length, 0);
  await until(() => calls.length === 1);
  await delay(220);
  assert.equal(calls.length, 1);
  releases.shift()();
  await until(() => calls.length === 2);
  input('up'); releases.shift()();
  await tick(); await delay(130);
  assert.equal(calls.length, 2);
  assert.equal(peak, 1);
  assert.equal(engine.inFlight.size, 0);
  const event = engine.events.find(event => event.kind === 'action');
  assert.equal(event.trigger, 'hold');
  assert.equal(event.keyCode, 'KeyA');
  assert.equal(event.repeatMs, 100);
});

test('release sem keydown e gesto com modificadores incorretos não executam; modifierup cancela', async t => {
  const bindings = [binding('hold', 'Control+A'), binding('release', 'Control+A')];
  const { calls, input, activate } = fixture(t, { bindings });
  activate(); input('up');
  input('down', 'KeyA'); input('up', 'KeyA');
  input('down', 'KeyA', { ctrlKey: true, shiftKey: true }); input('up', 'KeyA', { ctrlKey: true, shiftKey: true });
  assert.equal(calls.length, 0);
  input('down', 'ControlLeft', { ctrlKey: true }); input('down', 'KeyA', { ctrlKey: true });
  input('up', 'ControlLeft', { ctrlKey: true }); // Native flags may describe the instant before modifier release.
  input('up', 'KeyA');
  await delay(130);
  assert.equal(calls.length, 0);
  input('down', 'ControlLeft', { ctrlKey: true }); input('down', 'KeyA', { ctrlKey: true });
  input('up', 'KeyA', { ctrlKey: true });
  await tick();
  assert.equal(calls.length, 1);
});

test('rótulo lógico preservado no contexto enquanto combinação usa keyCode físico', async t => {
  const { calls, input, activate } = fixture(t, { bindings: [binding('release', 'Control+A', 'KeyQ')] });
  activate();
  input('down', 'KeyA', { ctrlKey: true }); input('up', 'KeyA', { ctrlKey: true });
  assert.equal(calls.length, 0);
  input('down', 'KeyQ', { ctrlKey: true }); input('up', 'KeyQ', { ctrlKey: true });
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].context.key, 'Control+A');
});

test('edição e pausa continuam observando soltura; sair/retomar com tecla segurada não inicia gesto', async t => {
  const { engine, calls, input, activate } = fixture(t, { bindings: [binding('hold'), binding('release')] });
  activate(); engine.setEditing(true);
  assert.equal(engine.needsInput(), true);
  input('down'); engine.setEditing(false); input('down');
  await delay(130); input('up');
  assert.equal(calls.length, 0);
  input('down'); engine.setEnabled(false);
  assert.equal(engine.needsInput(), true, 'worker observa keyups depois de uma ativação explícita');
  engine.setEnabled(true); input('down');
  await delay(130); input('up');
  assert.equal(calls.length, 0);
  input('down'); input('up'); await tick();
  assert.equal(calls.length, 1);
});

test('cancelamentos de camada, configuração, hook e suspensão não fabricam release nem retomam por repeat', async t => {
  const { engine, calls, input, activate } = fixture(t, { bindings: [binding('hold'), binding('release')] });
  activate();
  const original = engine.activeLayerId;
  const other = engine.config.layers[1].id;
  const cancels = [
    async () => { engine.setLayer(other); engine.setLayer(original); },
    async () => { await engine.saveConfig(engine.state().config); },
    async () => { engine.updateInput({ mode: 'unavailable', message: 'Falhou' }); engine.updateInput({ mode: 'global' }); },
    async () => { engine.resetInput(); }
  ];
  for (const cancel of cancels) {
    input('down'); await cancel(); input('down');
    await delay(130); input('up');
    assert.equal(calls.length, 0);
  }
  input('down'); input('up'); await tick();
  assert.equal(calls.length, 1);
});

test('hook indisponível ou conflito impede todos os momentos do grupo, preservando press legado', async t => {
  const legacy = { id: 'legacy', name: 'Legado', key: 'B', action: { type: 'log', message: 'B' } };
  const { engine, registrations, calls, input } = fixture(t, { bindings: [binding('press'), binding('release'), legacy], fail: 'A' });
  engine.setEnabled(true); engine.updateInput({ mode: 'global' });
  input('down'); input('up');
  assert.equal(calls.length, 0);
  registrations.get('B')(); await tick();
  assert.equal(calls.length, 1);
  const unavailable = fixture(t, { bindings: [binding('press'), binding('release')] });
  unavailable.engine.setEnabled(true);
  unavailable.engine.updateInput({ mode: 'unavailable', message: 'Wayland' });
  assert.equal(unavailable.registrations.has('A'), false);
  unavailable.engine.handleShortcut('A'); unavailable.input('down'); unavailable.input('up');
  assert.equal(unavailable.calls.length, 0);
});

test('teste manual de hold executa uma vez sem agendar timer; demanda considera todas as camadas', async t => {
  const { engine, calls } = fixture(t, { bindings: [binding('hold')] });
  const layer = engine.activeLayer;
  await engine.runBinding(layer.id, layer.bindings[0].id);
  await delay(130);
  assert.equal(calls.length, 1);
  assert.equal(engine.needsInput(), false);
  engine.setEnabled(true); engine.setLayer(engine.config.layers[1].id); engine.setEnabled(false);
  assert.equal(engine.needsInput(), true);
  const config = engine.state().config;
  config.layers[0].bindings[0].enabled = false;
  await engine.saveConfig(config);
  assert.equal(engine.needsInput(), false);
});

test('soltar/cancelar enquanto hold está em voo permite terminar efeito sem reagendar', async t => {
  let release;
  const { engine, calls, input, activate } = fixture(t, { bindings: [binding('hold')], execute: () => new Promise(resolve => { release = resolve; }) });
  activate(); input('down'); await until(() => calls.length === 1);
  engine.setEditing(true); input('up'); release('OK');
  await until(() => engine.inFlight.size === 0);
  engine.setEditing(false); await delay(140);
  assert.equal(calls.length, 1);
  assert.equal(engine.events.find(event => event.kind === 'action').status, 'success');
});

test('dispose cancela repetição e nenhuma soltura atrasada cria nova ação', async t => {
  const { engine, calls, input, activate } = fixture(t, { bindings: [binding('hold'), binding('release')] });
  activate(); input('down'); engine.dispose(); input('up');
  await delay(140);
  assert.equal(calls.length, 0);
  assert.equal(engine.needsInput(), false);
});

test('perda de entrada global libera combinação sem efeito e a recuperação exige novo keydown', async t => {
  const { engine, registrations, calls, input } = fixture(t, { bindings: [binding('release')] });
  engine.setEnabled(true);
  assert.equal(registrations.has('A'), false);
  assert.equal(engine.needsInput(), true);
  assert.equal(engine.state().shortcuts.failed.filter(item => item.key === 'A').length, 1);
  engine.updateInput({ mode: 'global' });
  assert.equal(registrations.has('A'), true);
  input('down');
  engine.updateInput({ mode: 'unavailable', message: 'Permissão retirada' });
  assert.equal(registrations.has('A'), false);
  assert.ok(registrations.has('CommandOrControl+Shift+F12'));
  engine.updateInput({ mode: 'global' }); input('down'); input('up'); await tick();
  assert.equal(calls.length, 0);
  input('down'); input('up'); await tick();
  assert.equal(calls.length, 1);
});

test('press que troca camada cancela o gesto antes de agendar hold ou release', async t => {
  let engine;
  const options = fixture(t, { execute: action => { if (action.type === 'layer') engine.setLayer(action.layerId); return 'OK'; } });
  engine = options.engine;
  const config = engine.state().config;
  config.layers[0].bindings[0].action = { type: 'layer', layerId: config.layers[1].id };
  await engine.saveConfig(config);
  options.activate(); options.input('down'); await tick();
  options.input('up'); await delay(130);
  assert.equal(options.calls.length, 1);
  assert.equal(engine.activeLayerId, config.layers[1].id);
});

test('release informa limite de execuções em vez de desaparecer; hold sob pressão não cria fila', async t => {
  const waiting = [];
  const extra = [...'BCDE'].map(key => ({ id: key, key, name: key, action: { type: 'log', message: key } }));
  const { engine, calls, input, activate } = fixture(t, { bindings: [binding('hold'), binding('release'), ...extra], execute: () => new Promise(resolve => waiting.push(resolve)) });
  activate();
  const layer = engine.activeLayer;
  const running = layer.bindings.filter(item => extra.some(value => value.id === item.id)).map(item => engine.runBinding(layer.id, item.id));
  assert.equal(calls.length, 4);
  input('down'); await delay(130);
  assert.equal(calls.length, 4);
  assert.equal(engine.events.length, 1, 'só o evento de ativação, sem spam dos ticks hold');
  input('up'); await tick();
  const rejected = engine.events.find(event => event.bindingId === 'release-A');
  assert.equal(rejected.status, 'error');
  assert.match(rejected.message, /quatro ações/);
  assert.equal(rejected.trigger, 'release');
  assert.equal(calls.length, 4);
  waiting.forEach(resolve => resolve('OK'));
  await Promise.all(running);
  assert.equal(engine.inFlight.size, 0);
});

test('soltar um lado do modificador não desfaz combinação se o outro continua pressionado', async t => {
  const { calls, input, activate } = fixture(t, { bindings: [binding('release', 'Control+A')] });
  activate();
  input('down', 'ControlLeft', { ctrlKey: true });
  input('down', 'ControlRight', { ctrlKey: true });
  input('down', 'KeyA', { ctrlKey: true });
  input('up', 'ControlLeft', { ctrlKey: true });
  input('up', 'KeyA', { ctrlKey: true });
  await tick();
  assert.equal(calls.length, 1);
});
