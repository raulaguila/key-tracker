const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateAction, validateConfig, defaultConfig, effectiveShortcut } = require('../app/config.cjs');
const { prepareAction, previewAction, executeAction, actionErrorMessage } = require('../app/actions.cjs');
const { Engine } = require('../app/engine.cjs');
const { historySnapshot } = require('../app/desktop-actions.cjs');

const flow = () => ({ type: 'macro', startDelayMs: 0, steps: [
  { kind: 'click', x: -200, y: 100, button: 'left', clicks: 1 },
  { kind: 'text', text: 'Olá {{layer}}!' }, { kind: 'key', key: 'ctrl+shift+a', delayBeforeMs: 50 },
  { kind: 'wait', ms: 100 }
] });
const context = { key: 'A', layer: 'Trabalho' };

test('fluxo portátil normaliza atalhos, preserva coordenadas negativas e rejeita entrada sem limites', () => {
  for (const platform of ['linux', 'win32', 'darwin']) {
    const action = validateAction(flow(), platform);
    assert.equal(action.steps[0].x, -200);
    assert.equal(action.steps[2].key, 'Control+Shift+A');
    assert.equal(validateAction({ ...flow(), startDelayMs: undefined }, platform).startDelayMs, 3000);
  }
  for (const action of [
    { ...flow(), steps: [] }, { ...flow(), steps: Array(201).fill({ kind: 'wait', ms: 0 }) },
    { ...flow(), startDelayMs: -1 }, { ...flow(), startDelayMs: 60001 },
    { ...flow(), steps: [{ kind: 'click', x: Infinity, y: 0, button: 'left', clicks: 1 }] },
    { ...flow(), steps: [{ kind: 'click', x: 0, y: 0, button: 'back', clicks: 1 }] },
    { ...flow(), steps: [{ kind: 'click', x: 0, y: 0, button: 'left', clicks: 3 }] },
    { ...flow(), steps: [{ kind: 'key', key: 'Control+bad' }] },
    { ...flow(), steps: [{ kind: 'wait', ms: '10' }] },
    { ...flow(), steps: [{ kind: 'text', text: 'x'.repeat(64001) }] },
    { ...flow(), steps: [{ kind: 'text', text: 'texto', delayBeforeMs: 0.5 }] },
    { ...flow(), steps: [flow()] }
  ]) assert.throws(() => validateAction(action));
  const config = defaultConfig();
  config.layers[0].bindings[0].action = { type: 'sequence', steps: [flow()] };
  assert.equal(validateConfig(config).layers[0].bindings[0].action.steps[0].type, 'macro');
});

test('prévia do fluxo resolve texto sem acessar serviços nativos e execução usa valores congelados', async () => {
  const action = flow();
  let calls = 0;
  const prepared = prepareAction(action, context);
  assert.equal(previewAction(prepared).steps[1].text, 'Olá Trabalho!');
  assert.equal(calls, 0);
  let received;
  const message = await executeAction(action, { key: 'B', layer: 'Outra' }, {
    preparedAction: prepared,
    macroService: { run: async value => { calls++; received = value; } }
  });
  assert.equal(calls, 1);
  assert.equal(received.steps[1].text, 'Olá Trabalho!');
  assert.match(message, /4 etapas/);
  await assert.rejects(executeAction(action, context), { code: 'MACRO_UNAVAILABLE' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(executeAction(action, context, { signal: controller.signal, macroService: { run: () => calls++ } }), { code: 'EXECUTION_CANCELLED' });
  assert.equal(calls, 1);
});

function engineFixture(macroService, platform = process.platform) {
  const config = defaultConfig();
  config.layers[0].bindings[0].action = flow();
  const logs = [];
  const engine = new Engine({ config, platform, macroService, documents: '/documents', storage: {
    directory: '/data', logPath: '/data/history', save: async () => {}, appendLog: async event => logs.push(event)
  } });
  return { engine, logs, layer: engine.activeLayer, binding: engine.activeLayer.bindings[0] };
}

for (const platform of ['linux', 'win32', 'darwin']) test(`teclas produzidas pelo fluxo não disparam atalhos, camadas nem painel; pausa interrompe em ${platform}`, () => {
  const state = { playing: true, recording: false };
  let suspended = 0;
  const { engine } = engineFixture({ state: () => state, suspend: async () => { suspended++; } }, platform);
  const effective = shortcut => effectiveShortcut(shortcut, platform);
  assert.equal(effective(engine.config.settings.pauseShortcut), platform === 'darwin' ? 'Command+Shift+F12' : 'Control+Shift+F12');
  engine.setEnabled(true);
  engine.updateInput({ mode: 'global' });
  let panels = 0; engine.on('quick-panel', () => panels++);
  const before = engine.activeLayerId;
  engine.handleShortcut(effective(engine.config.settings.layerShortcut));
  engine.handleShortcut(effective(engine.panelShortcut));
  engine.handleShortcut(effective(engine.activeLayer.bindings[0].key));
  assert.equal(engine.activeLayerId, before);
  assert.equal(panels, 0);
  assert.equal(engine.inFlight.size, 0);
  engine.handleInput({ direction: 'down', code: 'KeyA', key: 'A', ctrlKey: platform !== 'darwin', metaKey: platform === 'darwin', altKey: true });
  assert.equal(engine.inFlight.size, 0);
  engine.handleShortcut(effective(engine.config.settings.pauseShortcut));
  assert.equal(engine.enabled, false);
  assert.equal(suspended, 1);
  engine.dispose();
});

test('cancelamento aguarda driver e impede ações concorrentes; histórico de etapas não contém texto ou teclas', async () => {
  let release;
  const state = { playing: false, recording: false };
  const service = { state: () => state, run: async (_action, { signal, onStep, onProgress }) => {
    state.playing = true;
    onProgress({ stepIndex: 2, stepCount: 4, phase: 'waiting' });
    onStep({ index: 1, type: 'click', status: 'success', message: 'Clique realizado.', durationMs: 1 });
    await new Promise(resolve => { release = resolve; signal.addEventListener('abort', resolve, { once: true }); });
    state.playing = false;
  } };
  const { engine, logs, layer, binding } = engineFixture(service);
  const pending = engine.runBinding(layer.id, binding.id);
  assert.equal(engine.state().running[0].stepCount, 4);
  assert.equal(engine.state().running[0].phase, 'waiting');
  await assert.rejects(engine.runBinding(layer.id, binding.id), /gravação\/reprodução/);
  engine.cancelExecution(binding.id);
  await pending;
  await engine.whenIdle();
  assert.equal(engine.inFlight.size, 0);
  assert.equal(logs[0].status, 'cancelled');
  assert.equal(logs[0].steps.length, 1);
  assert.doesNotMatch(JSON.stringify(logs), /Olá|shift\+a/);
  release();
  engine.dispose();
});

test('falhas nativas não expõem texto privado e exportação mantém até200 resultados sem payloads', () => {
  assert.doesNotMatch(actionErrorMessage('macro', new Error('texto privado digitado')), /privado/);
  assert.match(actionErrorMessage('macro', Object.assign(new Error('privado'), { code: 'MACRO_PERMISSION' })), /Autorize/);
  const exported = historySnapshot([{ steps: Array.from({ length: 201 }, (_, i) => ({ index: i + 1, type: 'text', text: 'segredo', key: 'Control+A', status: 'success', message: 'Texto inserido.' })) }]);
  assert.equal(exported[0].steps.length, 200);
  assert.doesNotMatch(JSON.stringify(exported), /segredo|Control\+A/);
});

test('substituir configuração aguarda também gravação e autorização que não ocupam execução do motor', async () => {
  let release;
  let persisted = false;
  const state = { recording: true, playing: false, status: 'recording' };
  const { engine } = engineFixture({ state: () => state, suspend: () => new Promise(resolve => { release = () => { state.recording = false; state.status = 'ready'; resolve(); }; }) });
  engine.storage.save = async () => { persisted = true; };
  const saving = engine.saveConfig(defaultConfig());
  assert.equal(persisted, false);
  assert.equal(engine.stopping, true);
  await assert.rejects(engine.runBinding(engine.activeLayer.id, engine.activeLayer.bindings[0].id), /parada/);
  release(); await saving;
  assert.equal(persisted, true);
  assert.equal(engine.enabled, false);
  assert.equal(engine.stopping, false);
  state.status = 'authorizing'; persisted = false;
  const second = engine.saveConfig(defaultConfig());
  assert.equal(persisted, false);
  release(); await second;
  assert.equal(persisted, true);
  engine.dispose();
});

test('atalho de parada nativo mantém status cancelado também quando o fluxo é etapa de uma sequência', async () => {
  for (const nested of [false, true]) {
    const service = { state: () => ({ playing: false, recording: false }), run: async () => { throw Object.assign(new Error('Execução cancelada.'), { code: 'EXECUTION_CANCELLED' }); } };
    const { engine, binding, layer, logs } = engineFixture(service);
    if (nested) {
      const config = structuredClone(engine.config);
      config.layers[0].bindings[0].action = { type: 'sequence', steps: [flow(), { type: 'clipboard', text: 'não executar' }] };
      await engine.saveConfig(config);
    }
    await engine.runBinding(layer.id, binding.id);
    assert.equal(logs[0].status, 'cancelled');
    if (nested) assert.equal(logs[0].steps[0].status, 'cancelled');
    engine.dispose();
  }
});
