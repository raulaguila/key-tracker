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

test('configurações legadas recebem defaults sem mudar a versão e booleanos são estritos', () => {
  const legacy = defaultConfig();
  delete legacy.settings.autoSwitchLayers;
  delete legacy.settings.closeToTray;
  for (const layer of legacy.layers) {
    delete layer.applications;
    for (const binding of layer.bindings) delete binding.enabled;
  }
  const normalized = validateConfig(legacy);
  assert.equal(normalized.version, 1);
  assert.equal(normalized.settings.autoSwitchLayers, false);
  assert.equal(normalized.settings.closeToTray, false);
  assert.deepEqual(normalized.layers[0].applications, []);
  assert.equal(normalized.layers[0].bindings[0].enabled, true);
  for (const field of ['autoSwitchLayers', 'closeToTray']) {
    const invalid = structuredClone(normalized);
    invalid.settings[field] = 'true';
    assert.throws(() => validateConfig(invalid), /verdadeiro ou falso/);
  }
  normalized.layers[0].bindings[0].enabled = 1;
  assert.throws(() => validateConfig(normalized), /verdadeiro ou falso/);
});

test('associações exatas rejeitam conflitos e limites; caixa segue o sistema', () => {
  const config = defaultConfig();
  config.layers[0].applications = ['  Editor.exe  ', '/opt/editor', 'com.example.editor'];
  config.layers[1].applications = ['editor.exe'];
  assert.throws(() => validateConfig(config, 'win32'), /mais de uma camada/);
  assert.throws(() => validateConfig(config, 'darwin'), /mais de uma camada/);
  assert.equal(validateConfig(config, 'linux').layers[0].applications[0], 'Editor.exe');
  config.layers[1].applications = ['/opt/editor'];
  assert.throws(() => validateConfig(config, 'linux'), /mais de uma camada/);
  config.layers[1].applications = ['Editor\nWindow'];
  assert.throws(() => validateConfig(config), /inválido/);
  config.layers[1].applications = Array.from({ length: 31 }, (_, i) => 'app' + i);
  assert.throws(() => validateConfig(config), /30 aplicativos/);
});

test('caminhos equivalentes não permitem associações conflitantes no Windows', () => {
  const config = defaultConfig();
  config.layers[0].applications = ['C:\\Apps\\Editor.exe'];
  config.layers[1].applications = ['c:/Apps/Editor.exe/'];
  assert.throws(() => validateConfig(config, 'win32'), /mais de uma camada/);
});
