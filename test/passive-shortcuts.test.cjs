const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassiveShortcuts } = require('../app/passive-shortcuts.cjs');
const { Engine } = require('../app/engine.cjs');
const { defaultConfig } = require('../app/config.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = (direction, code, modifiers = {}) => ({ direction, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers });

test('assinaturas passivas observam combinações exatas uma vez por gesto sem sintetizar teclas', () => {
  for (const platform of ['linux', 'win32', 'darwin']) {
    const shortcuts = new PassiveShortcuts(platform);
    let calls = 0;
    shortcuts.register('CommandOrControl+;', () => calls++);
    const flags = platform === 'darwin' ? { metaKey: true } : { ctrlKey: true };
    shortcuts.handleInput(event('down', 'Semicolon'));
    shortcuts.handleInput(event('up', 'Semicolon'));
    shortcuts.handleInput(event('down', 'Semicolon', { ...flags, altKey: true }));
    shortcuts.handleInput(event('up', 'Semicolon'));
    assert.equal(calls, 0);
    shortcuts.handleInput(event('down', 'Semicolon', flags));
    shortcuts.handleInput(event('down', 'Semicolon', flags));
    assert.equal(calls, 1);
    shortcuts.handleInput(event('up', 'Semicolon', flags));
    shortcuts.handleInput(event('down', 'Semicolon', flags));
    assert.equal(calls, 2);
    shortcuts.unregister('CommandOrControl+Semicolon');
    shortcuts.handleInput(event('up', 'Semicolon'));
    shortcuts.handleInput(event('down', 'Semicolon', flags));
    assert.equal(calls, 2);
  }
});

test('Plus usa Shift+Equal e remoção de assinatura não permite repetição da tecla mantida', () => {
  const shortcuts = new PassiveShortcuts('linux');
  let calls = 0;
  shortcuts.register('Control+Plus', () => calls++);
  assert.equal(shortcuts.register('Control+Shift+Equal', () => calls++), false, 'aliases da mesma posição não duplicam o disparo');
  shortcuts.handleInput(event('down', 'Equal', { ctrlKey: true }));
  shortcuts.handleInput(event('up', 'Equal'));
  shortcuts.handleInput(event('down', 'Equal', { ctrlKey: true, shiftKey: true }));
  shortcuts.unregister('Control+Plus');
  shortcuts.register('Control+Plus', () => calls++);
  shortcuts.handleInput(event('down', 'Equal', { ctrlKey: true, shiftKey: true }));
  assert.equal(calls, 1);
  shortcuts.unregisterAll();
  shortcuts.handleInput(event('up', 'Equal'));
  shortcuts.handleInput(event('down', 'Equal', { ctrlKey: true, shiftKey: true }));
  assert.equal(calls, 1);
});

// Single-key gesture fixtures are independent of the new-install examples.
function singleKeyConfig() {
  const config = defaultConfig();
  for (const layer of config.layers) layer.bindings[0].key = 'A';
  return config;
}

test('exemplos iniciais e portáteis exigem Ctrl/⌘ e Alt nas duas camadas', async t => {
  for (const platform of ['linux', 'win32', 'darwin']) {
    for (const config of [defaultConfig(), require('../docs/examples/quick-start.json')]) {
      const calls = [];
      const engine = new Engine({ config, platform, documents: '/documents',
        storage: { directory: '/data', logPath: '/data/log', appendLog: async () => {} },
        execute: async (_action, context) => { calls.push(context); return 'OK'; }
      });
      t.after(() => engine.dispose());
      engine.setEnabled(true); engine.updateInput({ mode: 'global' });
      for (const [index, layer] of engine.config.layers.entries()) {
        engine.setLayer(layer.id);
        const command = platform === 'darwin' ? { metaKey: true } : { ctrlKey: true };
        for (const flags of [{}, command, { altKey: true }]) {
          engine.handleInput(event('down', 'KeyA', flags));
          engine.handleInput(event('up', 'KeyA', flags));
        }
        await tick();
        assert.equal(calls.length, index, platform + ': digitação e modificadores incompletos não executam');
        engine.handleInput(event('down', 'KeyA', { ...command, altKey: true }));
        engine.handleInput(event('up', 'KeyA', { ...command, altKey: true }));
        await tick();
        assert.equal(calls.length, index + 1, platform + ': combinação completa executa uma vez');
        assert.equal(calls[index].layer, layer.name);
      }
    }
  }
});

function fixture(t, config = singleKeyConfig()) {
  const calls = [];
  let now = 1000;
  const engine = new Engine({ config, platform: 'linux', documents: '/documents', now: () => now,
    storage: { directory: '/data', logPath: '/data/log', appendLog: async () => {}, save: async () => {} },
    execute: async (action, context, options) => { calls.push(context); if (action.type === 'layer') options.setLayer(action.layerId); return 'OK'; }
  });
  t.after(() => engine.dispose());
  const input = (direction, code, flags) => engine.handleInput(event(direction, code, flags));
  const tap = async (code, flags) => { now += 1000; input('down', code, flags); input('up', code, flags); await tick(); };
  return { engine, calls, input, tap };
}

test('configuração só de pressionar inicia observação e controla camadas/pausa sem globalShortcut', async t => {
  const { engine, calls, input, tap } = fixture(t);
  assert.equal(engine.needsInput(), false);
  engine.setEnabled(true);
  assert.equal(engine.needsInput(), true);
  input('down', 'KeyA'); input('up', 'KeyA');
  assert.equal(calls.length, 0, 'nenhuma ação antes de a entrada global estar pronta');
  engine.updateInput({ mode: 'global' });
  await tap('KeyA');
  await tap('F8');
  await tap('KeyA');
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].layer, calls[1].layer);
  await tap('F12', { ctrlKey: true, shiftKey: true });
  assert.equal(engine.enabled, false);
  await tap('KeyA');
  assert.equal(calls.length, 2);
  await tap('F12', { ctrlKey: true, shiftKey: true });
  assert.equal(engine.enabled, true);
  await tap('KeyA');
  assert.equal(calls.length, 3);
  engine.updateInput({ mode: 'unavailable' });
  await tap('KeyA');
  assert.equal(calls.length, 3);
});

test('pressionar capturado respeita posição de outro layout e não dispara pelo fallback US', async t => {
  const config = singleKeyConfig();
  config.layers[0].bindings[0].keyCode = 'KeyQ';
  const { engine, calls, tap } = fixture(t, config);
  engine.setEnabled(true); engine.updateInput({ mode: 'global' });
  await tap('KeyA');
  assert.equal(calls.length, 0);
  await tap('KeyQ');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, 'A');
});

test('pressionar que muda camada não executa também a ação da camada de destino', async t => {
  for (const captured of [false, true]) {
    const config = singleKeyConfig();
    const binding = config.layers[0].bindings[0];
    binding.action = { type: 'layer', layerId: config.layers[1].id };
    if (captured) binding.keyCode = 'KeyA';
    else config.layers[1].bindings[0].keyCode = 'KeyA';
    const { engine, calls, tap } = fixture(t, config);
    engine.setEnabled(true); engine.updateInput({ mode: 'global' });
    await tap('KeyA');
    assert.equal(calls.length, 1);
    assert.equal(engine.activeLayerId, config.layers[1].id);
    await tap('KeyA');
    assert.equal(calls.length, 2);
  }
});

test('pausa e edição não rearmam uma tecla de pressionar mantida, mesmo após cooldown', async t => {
  const { engine, calls, input, tap } = fixture(t);
  engine.setEnabled(true); engine.updateInput({ mode: 'global' });
  engine.setEditing(true); input('down', 'KeyA'); engine.setEditing(false); input('down', 'KeyA');
  assert.equal(calls.length, 0);
  input('up', 'KeyA'); await tap('KeyA');
  assert.equal(calls.length, 1);
  engine.setEnabled(false); input('down', 'KeyA'); engine.setEnabled(true); input('down', 'KeyA');
  assert.equal(calls.length, 1);
  input('up', 'KeyA'); await tap('KeyA');
  assert.equal(calls.length, 2);
  engine.dispose(); await tap('KeyA');
  assert.equal(calls.length, 2);
});

test('posição física importada não consegue interceptar os controles de pausa ou camada', async t => {
  for (const pause of [false, true]) {
    const config = singleKeyConfig();
    Object.assign(config.layers[0].bindings[0], { key: pause ? 'Control+Shift+A' : 'A', keyCode: pause ? 'F12' : 'F8' });
    const { engine, calls, tap } = fixture(t, config);
    engine.setEnabled(true); engine.updateInput({ mode: 'global' });
    await tap(pause ? 'F12' : 'F8', pause ? { ctrlKey: true, shiftKey: true } : {});
    assert.equal(calls.length, 0);
    if (pause) assert.equal(engine.enabled, false);
    else assert.equal(engine.activeLayerId, config.layers[1].id);
  }
});
