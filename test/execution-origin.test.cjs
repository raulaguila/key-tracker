const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../app/engine.cjs');
const { defaultConfig } = require('../app/config.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, { captured = false, execute = async () => 'OK', isAppFocused = () => false } = {}) {
  const config = defaultConfig();
  const layer = config.layers[0], binding = layer.bindings[0];
  if (captured) binding.keyCode = 'KeyA';
  const engine = new Engine({ config, platform: 'linux', documents: '/documents', isAppFocused, execute,
    storage: { directory: '/data', logPath: '/data/log', appendLog: async () => {}, save: async () => {} } });
  t.after(() => engine.dispose());
  const tap = (code = 'KeyA') => {
    for (const direction of ['down', 'up']) engine.handleInput({ code, direction, ctrlKey: true, altKey: true });
  };
  return { engine, layer, binding, tap, activate() { engine.setEnabled(true); engine.updateInput({ mode: 'global' }); } };
}
test('execução manual fora de foco nunca é registrada como atalho externo', async t => {
  const { engine, layer, binding } = fixture(t);
  const preview = await engine.previewBinding(layer.id, binding.id);
  await engine.runBinding(layer.id, binding.id, preview.previewId);
  const event = engine.events.find(event => event.kind === 'action');
  assert.equal(event.origin, 'manual'); assert.equal(event.outsideApp, false);
});
test('pressionar passivo e posição capturada identificam somente ações realmente executadas', async t => {
  for (const captured of [false, true]) {
    const { engine, layer, binding, tap, activate } = fixture(t, { captured });
    activate(); tap('KeyZ'); await tick();
    assert.equal(engine.events.filter(event => event.kind === 'action').length, 0, 'teclas não configuradas não entram no histórico');
    tap(); await engine.whenIdle();
    const event = engine.events.find(event => event.kind === 'action');
    assert.equal(event.origin, 'shortcut'); assert.equal(event.outsideApp, true);
    assert.equal(event.layerId, layer.id); assert.equal(event.bindingId, binding.id);
    assert.equal(event.configRevision, 0); assert.equal(event.status, 'success');
    assert.equal(event.application, undefined); assert.equal(event.windowTitle, undefined);
  }
});
test('foco é observado no início da ação, com falha conservadora', async t => {
  for (const initial of [true, false, 'unknown']) {
    let focused = initial, finish;
    const { engine, tap, activate } = fixture(t, { isAppFocused: () => focused, execute: () => new Promise(resolve => { finish = resolve; }) });
    activate(); tap(); focused = !initial;
    finish('OK'); await engine.whenIdle();
    const event = engine.events.find(event => event.kind === 'action');
    assert.equal(event.outsideApp, initial === false);
  }
  const { engine, tap, activate } = fixture(t, { isAppFocused: () => { throw new Error('no-focus'); } });
  activate(); tap(); await engine.whenIdle();
  assert.equal(engine.events.find(event => event.kind === 'action').outsideApp, false);
});
test('revisão da execução não muda quando a configuração muda antes do resultado', async t => {
  let finish;
  const { engine, layer, tap, activate } = fixture(t, { execute: () => new Promise(resolve => { finish = resolve; }) });
  activate(); tap();
  const next = engine.state().config; next.layers[0].name = 'Outro contexto'; await engine.saveConfig(next);
  finish('OK'); await engine.whenIdle();
  const event = engine.events.find(event => event.kind === 'action');
  assert.equal(event.configRevision, 0); assert.equal(engine.configRevision, 1);
  assert.equal(event.layer, layer.name);
});
test('falha e cancelamento de atalho externo permanecem resultados sem sucesso', async t => {
  const failed = fixture(t, { execute: async () => { throw new Error('effect-error'); } });
  failed.activate(); failed.tap(); await failed.engine.whenIdle();
  assert.equal(failed.engine.events.find(event => event.kind === 'action').status, 'error');
  let finish;
  const cancelled = fixture(t, { execute: () => new Promise(resolve => { finish = resolve; }) });
  cancelled.activate(); cancelled.tap(); cancelled.engine.cancelAllExecutions(); finish('OK'); await cancelled.engine.whenIdle();
  const event = cancelled.engine.events.find(event => event.kind === 'action');
  assert.equal(event.origin, 'shortcut'); assert.equal(event.outsideApp, true); assert.equal(event.status, 'cancelled');
});
