const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultConfig, validateConfig, normalizeShortcut, electronShortcut } = require('../app/config.cjs');

test('normaliza combinações e símbolos para aceleradores nativos', () => {
  assert.equal(normalizeShortcut('shift+ctrl+a'), 'Control+Shift+A');
  assert.equal(normalizeShortcut('cmdorctrl+F8'), 'CommandOrControl+F8');
  assert.equal(electronShortcut('Control+Slash'), 'Control+/');
  assert.equal(electronShortcut('Control+='), 'Control+=');
  assert.throws(() => normalizeShortcut('Control+Control+A'), /Modificadores/);
  assert.throws(() => normalizeShortcut('NotAKey'), /Tecla inválida/);
});

test('mesma tecla em camadas diferentes é válida; duplicada na mesma camada não', () => {
  const config = defaultConfig();
  assert.equal(validateConfig(config).layers.length, 2);
  config.layers[0].bindings.push({ ...structuredClone(config.layers[0].bindings[0]), id: 'another' });
  assert.throws(() => validateConfig(config), /duplicado/);
});

test('reservas detectam aliases e atalhos equivalentes da plataforma', () => {
  const config = defaultConfig();
  config.layers[0].bindings[0].key = 'Control+Shift+F12';
  assert.throws(() => validateConfig(config, 'win32'), /reservado/);
  config.layers[0].bindings[0].key = 'Command+Shift+F12';
  assert.throws(() => validateConfig(config, 'darwin'), /reservado/);
});

test('rejeita IDs duplicados, configuração vazia, excessos e nomes de arquivos perigosos', () => {
  const config = defaultConfig();
  config.layers[1].id = config.layers[0].id;
  assert.throws(() => validateConfig(config), /IDs duplicados/);
  assert.throws(() => validateConfig({ ...defaultConfig(), layers: [] }), /camadas/);
  for (const filename of ['../secret', 'a\\b', 'CON.txt', 'bad?.txt', '..']) {
    const invalid = defaultConfig();
    invalid.layers[1].bindings[0].action.filename = filename;
    assert.throws(() => validateConfig(invalid), /arquivo/);
  }
});

test('HTTP valida protocolo, parâmetros, método, headers e corpo', () => {
  const config = defaultConfig();
  const binding = config.layers[0].bindings[0];
  binding.action = { type: 'http', method: 'POST', url: 'https://localhost/endpoint', headers: { 'Content-Type': 'application/json' }, query: { id: '1' }, body: '{"id":1}' };
  assert.equal(validateConfig(config).layers[0].bindings[0].action.method, 'POST');
  binding.action.url = 'file:///etc/passwd';
  assert.throws(() => validateConfig(config), /HTTP\/HTTPS/);
  binding.action.url = 'http://localhost/';
  binding.action.method = 'GET';
  assert.throws(() => validateConfig(config), /não aceitam corpo/);
});
