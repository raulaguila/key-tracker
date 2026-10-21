const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { Engine } = require('../app/engine.cjs');
const { defaultConfig } = require('../app/config.cjs');
const event = (direction, code, flags = {}) => ({ direction, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...flags });
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(t, options = {}) {
  const config = defaultConfig();
  config.settings.momentaryShortcut = 'F9';
  config.settings.momentaryLayerId = config.layers[1].id;
  const writes = [];
  const calls = [];
  const engine = new Engine({ config, documents: '/documents', platform: 'linux', storage: { save: async value => writes.push(structuredClone(value)), appendLog: async () => {} },
    execute: async (action, context) => { calls.push(context); return 'OK'; }, ...options });
  t.after(() => engine.dispose());
  const input = (direction, code, flags) => engine.handleInput(event(direction, code, flags));
  const activate = () => { engine.setEnabled(true); engine.updateInput({ mode: 'global' }); };
  return { engine, input, activate, calls, writes };
}

test('segurar camada temporária usa ações da camada e restaura origem sem alterar escolha manual', async t => {
  const { engine, input, activate, calls } = fixture(t);
  const original = engine.activeLayerId;
  activate(); input('down', 'F9');
  assert.equal(engine.activeLayerId, engine.config.layers[1].id);
  assert.equal(engine.manualLayerId, original);
  input('down', 'ControlLeft', { ctrlKey: true });
  assert.equal(engine.activeLayerId, engine.config.layers[1].id, 'modificador extra não encerra camada temporária');
  input('up', 'ControlLeft');
  input('down', 'KeyA'); input('up', 'KeyA'); await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].layer, engine.config.layers[1].name);
  input('down', 'F9'); // native repeat
  input('up', 'F9');
  assert.equal(engine.activeLayerId, original);
  assert.equal(engine.manualLayerId, original);
});

test('interrupções restauram temporária sem release artificial nem reativação por repeat', async t => {
  for (const interruption of ['pause', 'editing', 'input', 'manual', 'application', 'save', 'modifier']) {
    const { engine, input, activate, calls } = fixture(t);
    const config = engine.state().config;
    config.settings.autoSwitchLayers = true;
    if (interruption === 'modifier') config.settings.momentaryShortcut = 'Control+F9';
    config.layers[1].bindings = [{ id: 'release', key: 'A', keyCode: 'KeyA', trigger: 'release', name: 'Release', action: { type: 'clipboard', text: 'x' } }];
    await engine.saveConfig(config);
    const original = engine.activeLayerId;
    activate();
    input('down', 'F9', interruption === 'modifier' ? { ctrlKey: true } : {});
    input('down', 'KeyA', interruption === 'modifier' ? { ctrlKey: true } : {});
    if (interruption === 'pause') engine.setEnabled(false);
    if (interruption === 'editing') engine.setEditing(true);
    if (interruption === 'input') engine.updateInput({ mode: 'unavailable' });
    if (interruption === 'manual') engine.setLayer(original);
    if (interruption === 'application') engine.updateApplication({ status: 'ready', current: { name: 'another', path: '/another' } });
    if (interruption === 'save') await engine.saveConfig(engine.state().config);
    if (interruption === 'modifier') input('up', 'ControlLeft');
    assert.equal(engine.momentary, null, interruption);
    assert.equal(engine.activeLayerId, original, interruption);
    if (!engine.enabled) engine.setEnabled(true);
    if (engine.editing) engine.setEditing(false);
    engine.updateInput({ mode: 'global' });
    input('down', 'F9'); input('up', 'F9'); input('up', 'KeyA');
    await tick();
    assert.equal(calls.length, 0, interruption);
  }
});

test('painel é controle passivo independente de ações e edição, também após Rastreio', t => {
  const { engine, input, activate, calls } = fixture(t);
  let shown = 0;
  engine.on('quick-panel', () => shown++);
  const pressPanel = () => { input('down', 'Space', { ctrlKey: true, shiftKey: true }); input('up', 'Space'); };
  engine.updateInput({ mode: 'global' }); pressPanel();
  assert.equal(shown, 0);
  engine.tracking.enabled = true;
  engine.updateInput({ mode: 'global' });
  engine.tracking.enabled = false;
  assert.equal(engine.needsInput(), true);
  pressPanel();
  assert.equal(shown, 1);
  assert.equal(engine.enabled, false);
  activate(); engine.setEditing(true); pressPanel();
  assert.equal(shown, 2);
  assert.equal(calls.length, 0);
});

test('Numpad e fileira principal disparam ações distintas por observação passiva', async t => {
  const config = defaultConfig();
  config.layers[0].bindings = ['1', 'Numpad1', 'NumpadEnter'].map((key, index) => ({ id: 'n' + index, key, name: key, action: { type: 'clipboard', text: key } }));
  const { input, activate, calls } = fixture(t, { config });
  activate();
  for (const code of ['Numpad1', 'Digit1', 'NumpadEnter']) { input('down', code); input('up', code); await tick(); }
  assert.deepEqual(calls.map(call => call.key), ['Numpad1', '1', 'NumpadEnter']);
});

test('undo/redo persiste antes de aplicar e mantém pilhas e configuração em falha', async t => {
  const { engine, writes, activate } = fixture(t);
  const first = engine.state().config;
  const second = structuredClone(first); second.layers[0].name = 'Revisão dois';
  await engine.saveConfig(second);
  assert.deepEqual(engine.state().configHistory, { canUndo: true, canRedo: false });
  await engine.saveConfig(second);
  assert.equal(engine.undoStack.length, 1);
  activate();
  const beforeFail = engine.state();
  engine.storage.save = async () => { throw new Error('disco cheio'); };
  await assert.rejects(engine.undoConfig(), /disco cheio/);
  assert.deepEqual(engine.state().config, beforeFail.config);
  assert.deepEqual(engine.state().configHistory, beforeFail.configHistory);
  assert.equal(engine.enabled, true);
  engine.storage.save = async value => writes.push(structuredClone(value));
  const undone = await engine.undoConfig();
  assert.equal(undone.enabled, false);
  assert.deepEqual(undone.config, first);
  assert.deepEqual(writes.at(-1), first);
  assert.deepEqual(undone.configHistory, { canUndo: false, canRedo: true });
  const redone = await engine.redoConfig();
  assert.deepEqual(redone.config, second);
  assert.equal(redone.enabled, false);
  await engine.undoConfig();
  const third = engine.state().config; third.layers[0].name = 'Nova edição';
  await engine.saveConfig(third);
  assert.equal(engine.state().configHistory.canRedo, false);
  for (let index = 0; index < 12; index++) { const next = engine.state().config; next.layers[0].name = 'Rev ' + index; await engine.saveConfig(next); }
  assert.equal(engine.undoStack.length, 10);
  for (let index = 0; index < 10; index++) await engine.undoConfig();
  assert.equal(engine.state().configHistory.canUndo, false);
  assert.equal(engine.redoStack.length, 10);
});

test('undo cancela sequência em espera, preserva efeito realizado e não agenda hold', async t => {
  const { executeAction } = require('../app/actions.cjs');
  const effects = [];
  const { engine } = fixture(t, { execute: executeAction, desktopActions: { clipboard: text => effects.push(text) } });
  const next = engine.state().config;
  next.layers[0].bindings[0].action = { type: 'sequence', stepDelayMs: 60000, steps: [{ type: 'clipboard', text: 'feito' }, { type: 'clipboard', text: 'não executar' }] };
  await engine.saveConfig(next);
  const layer = engine.activeLayer;
  const pending = engine.runBinding(layer.id, layer.bindings[0].id);
  await new Promise(resolve => { const onState = state => { if (state.running[0]?.phase === 'waiting') { engine.off('state', onState); resolve(); } }; engine.on('state', onState); });
  await engine.undoConfig();
  assert.equal((await pending).events.find(event => event.kind === 'action').status, 'cancelled');
  assert.deepEqual(effects, ['feito']);
  assert.equal(engine.enabled, false);
  await delay(5);
  assert.equal(engine.gestures.active.size, 0);
});
