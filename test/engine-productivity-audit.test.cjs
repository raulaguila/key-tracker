const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../app/engine.cjs');
const { defaultConfig, validateConfig } = require('../app/config.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = (direction, code, flags = {}) => ({ direction, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...flags });

function engineFor(t, config, platform = 'linux') {
  const calls = [];
  const engine = new Engine({ config, platform, documents: '/documents', storage: { save: async () => {}, appendLog: async () => {} }, execute: async (_action, context) => { calls.push(context); return 'OK'; } });
  t.after(() => engine.dispose());
  return { engine, calls };
}

test('panelShortcut vazio desativa atalho explicitamente sem manter observador após Rastreio', t => {
  const config = defaultConfig(); config.settings.panelShortcut = '';
  assert.equal(validateConfig(config).settings.panelShortcut, '');
  const { engine } = engineFor(t, config);
  engine.tracking.enabled = true; engine.updateInput({ mode: 'global' }); engine.tracking.enabled = false;
  assert.equal(engine.needsInput(), false);
  assert.equal(engine.state().shortcuts.panelShortcut, '');
});

test('atalho padrão do painel não invalida nem intercepta binding legado ou controle existente', async t => {
  for (const platform of ['linux', 'win32', 'darwin']) {
    const config = defaultConfig();
    config.layers[0].bindings[0].key = 'CommandOrControl+Shift+Space';
    assert.equal(Object.hasOwn(validateConfig(config, platform).settings, 'panelShortcut'), false);
    const { engine, calls } = engineFor(t, config, platform);
    let panels = 0; engine.on('quick-panel', () => panels++);
    engine.setEnabled(true); engine.updateInput({ mode: 'global' });
    const flags = { shiftKey: true, ...(platform === 'darwin' ? { metaKey: true } : { ctrlKey: true }) };
    engine.handleInput(event('down', 'Space', flags)); engine.handleInput(event('up', 'Space', flags));
    await tick();
    assert.equal(calls.length, 1, platform);
    assert.equal(panels, 0);
    assert.equal(engine.state().shortcuts.panelShortcut, '');
    assert.match(engine.state().shortcuts.failed[0].message, /padrão.*conflito.*botão/);
    const controlConfig = defaultConfig(); controlConfig.settings.pauseShortcut = 'CommandOrControl+Shift+Space';
    assert.equal(validateConfig(controlConfig, platform).settings.pauseShortcut, 'CommandOrControl+Shift+Space');
  }
});

test('captura física em posição de controle fica visivelmente indisponível sem interceptar controle', async t => {
  const config = defaultConfig();
  config.settings.momentaryShortcut = 'F9'; config.settings.momentaryLayerId = config.layers[1].id;
  Object.assign(config.layers[0].bindings[0], { key: 'B', keyCode: 'F9' });
  const { engine, calls } = engineFor(t, config);
  engine.setEnabled(true); engine.updateInput({ mode: 'global' });
  const state = engine.state();
  assert.ok(state.shortcuts.failed.some(item => item.key === 'B' && /posição.*controle/.test(item.message)));
  assert.equal(state.shortcuts.registered.includes('B'), false);
  engine.handleInput(event('down', 'F9'));
  assert.equal(engine.activeLayerId, config.layers[1].id);
  engine.handleInput(event('up', 'F9'));
  await tick();
  assert.equal(calls.length, 0);
});

test('colisão física legada desliga default sem perder ação capturada em outro layout', async t => {
  const config = defaultConfig();
  Object.assign(config.layers[0].bindings[0], { key: 'Control+Shift+B', keyCode: 'Space' });
  const { engine, calls } = engineFor(t, config);
  engine.setEnabled(true); engine.updateInput({ mode: 'global' });
  assert.equal(engine.state().shortcuts.panelShortcut, '');
  engine.handleInput(event('down', 'Space', { ctrlKey: true, shiftKey: true }));
  engine.handleInput(event('up', 'Space'));
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, 'Control+Shift+B');
});

test('undo/redo durante parada não retoma ações; falha redo preserva configuração e pilhas', async t => {
  const config = defaultConfig();
  let finish;
  const engine = new Engine({ config, documents: '/documents', storage: { save: async () => {}, appendLog: async () => {} },
    execute: () => new Promise(resolve => { finish = () => resolve('OK'); }) });
  t.after(() => engine.dispose());
  const updated = engine.state().config; updated.layers[0].name = 'Editada';
  await engine.saveConfig(updated);
  engine.setEnabled(true);
  const layer = engine.activeLayer;
  const running = engine.runBinding(layer.id, layer.bindings[0].id);
  engine.requestStop();
  assert.equal(engine.stopping, true);
  const undone = await engine.undoConfig();
  assert.equal(undone.enabled, false);
  assert.equal(undone.stopping, true);
  await assert.rejects(engine.runBinding(layer.id, layer.bindings[0].id), /parada/);
  const history = engine.state().configHistory;
  engine.storage.save = async () => { throw new Error('falha de disco'); };
  await assert.rejects(engine.redoConfig(), /falha de disco/);
  assert.deepEqual(engine.state().configHistory, history);
  assert.deepEqual(engine.state().config, undone.config);
  finish();
  assert.equal((await running).events.find(event => event.kind === 'action').status, 'cancelled');
  await engine.stopPromise;
  assert.equal(engine.stopping, false);
  assert.equal(engine.enabled, false);
  engine.storage.save = async () => {};
  assert.equal((await engine.redoConfig()).config.layers[0].name, 'Editada');
  assert.equal(engine.enabled, false);
});
