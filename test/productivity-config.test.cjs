const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultConfig, validateConfig, validateAction, normalizeShortcut, effectiveShortcut, encodeConfig, decodeConfig } = require('../app/config.cjs');
const http = (resultName = 'reply') => ({ type: 'http', method: 'GET', url: 'https://example.test', headers: {}, query: {}, body: '', resultName });

test('configuração opcional de produtividade preserva ausência e valida controles e dispositivo', () => {
  const config = defaultConfig();
  const before = encodeConfig(config);
  assert.doesNotMatch(before, /momentary|panelShortcut|inputDeviceId/);
  config.settings.momentaryShortcut = 'Control+F9';
  assert.throws(() => validateConfig(config), /Camada temporária/);
  config.settings.momentaryLayerId = config.layers[1].id;
  config.settings.panelShortcut = 'Control+Shift+Space';
  config.settings.inputDeviceId = 'device-123';
  assert.deepEqual(decodeConfig(encodeConfig(config)).settings, config.settings);
  for (const value of ['', null, 10, 'x'.repeat(161), 'bad\0id']) {
    config.settings.inputDeviceId = value;
    assert.throws(() => validateConfig(config), /Teclado|teclado/);
  }
  delete config.settings.inputDeviceId;
  config.settings.momentaryLayerId = 'missing';
  assert.throws(() => validateConfig(config), /temporária não existe/);
  config.settings.momentaryLayerId = config.layers[1].id;
  config.settings.momentaryShortcut = config.settings.pauseShortcut;
  assert.throws(() => validateConfig(config), /diferentes/);
  for (const platform of ['linux', 'win32', 'darwin']) {
    const legacy = defaultConfig();
    legacy.layers[0].bindings[0].key = platform === 'darwin' ? 'Command+Shift+Space' : 'Control+Shift+Space';
    assert.throws(() => validateConfig(legacy, platform), /reservado/);
  }
});

test('Numpad normaliza aliases e mantém posição física distinta da fileira numérica', () => {
  assert.equal(normalizeShortcut('ctrl+num1'), 'Control+Numpad1');
  assert.equal(normalizeShortcut('numadd'), 'NumpadAdd');
  assert.equal(effectiveShortcut('CommandOrControl+NumpadEnter', 'darwin'), 'Command+NumpadEnter');
  for (const key of ['Numpad0', 'Numpad9', 'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal', 'NumpadEnter', 'NumpadEqual', 'NumpadComma']) {
    const config = defaultConfig();
    Object.assign(config.layers[0].bindings[0], { key, keyCode: key, trigger: 'hold' });
    assert.equal(validateConfig(config).layers[0].bindings[0].keyCode, key);
  }
});

test('sequência aceita metadados opcionais somente com referências anteriores seguras', () => {
  const valid = { type: 'sequence', steps: [http(), { type: 'clipboard', text: '{{steps.reply.json.items.0.name}}', delayBeforeMs: 0,
    condition: { path: 'steps.reply.status', operator: 'equals', value: '200' } }] };
  assert.deepEqual(validateAction(valid), valid);
  const sequence = () => structuredClone(valid);
  for (const value of [-1, 60001, 1.1, null, '10']) {
    const action = sequence(); action.steps[1].delayBeforeMs = value;
    assert.throws(() => validateAction(action), /Delay da etapa/);
  }
  const limit = sequence(); limit.steps[1].delayBeforeMs = 60000;
  assert.equal(validateAction(limit).steps[1].delayBeforeMs, 60000);
  for (const name of ['constructor', '__proto__', 'prototype', '9bad', 'a'.repeat(33), 'bad-name']) {
    const action = sequence(); action.steps[0].resultName = name;
    assert.throws(() => validateAction(action), /Nome de resultado/);
  }
  for (const reference of ['steps.future.body', 'steps.reply.json.__proto__.x', 'steps.reply.json.constructor', 'steps.reply.json.a.b.c.d.e.f.g.h.i', 'steps.reply.status.extra']) {
    const action = sequence(); action.steps[1].text = '{{' + reference + '}}';
    assert.throws(() => validateAction(action), /Referência|anteriores/);
  }
  const duplicate = sequence(); duplicate.steps.push(http());
  assert.throws(() => validateAction(duplicate), /únicos/);
  const wrongType = sequence(); wrongType.steps[1].resultName = 'notHttp';
  assert.throws(() => validateAction(wrongType), /HTTP/);
  const forward = sequence(); forward.steps.reverse();
  assert.throws(() => validateAction(forward), /anteriores/);
  const self = sequence(); self.steps[0].url = '{{steps.reply.body}}';
  assert.throws(() => validateAction(self), /anteriores/);
  const log = sequence(); log.steps[1] = { type: 'log', message: '{{steps.reply.body}}' };
  assert.throws(() => validateAction(log), /histórico/);
  assert.throws(() => validateAction({ type: 'clipboard', text: '{{steps.reply.body}}' }), /sequências/);
  const config = defaultConfig(); config.layers[0].bindings[0].action = valid;
  assert.deepEqual(decodeConfig(encodeConfig(config)).layers[0].bindings[0].action, valid);
});
