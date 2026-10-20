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

test('novos tipos preservam esquema v1 e referências de camada são validadas em toda a configuração', () => {
  const config = defaultConfig();
  assert.equal(config.layers[0].bindings[0].action.type, 'clipboard');
  const actions = [
    { type: 'clipboard', text: 'Copiar {{key}}' },
    { type: 'open', kind: 'url', target: 'https://example.test/{{key}}' },
    { type: 'notification', title: 'Título', message: '{{layer}}' },
    { type: 'layer', layerId: config.layers[1].id },
    { type: 'sequence', steps: [{ type: 'clipboard', text: 'Olá' }, { type: 'layer', layerId: config.layers[1].id }] },
    { type: 'log', message: 'Legado preservado' }
  ];
  config.layers[0].bindings = actions.map((action, i) => ({ id: 'type-' + i, key: 'Control+' + String(i), name: action.type, action }));
  const valid = validateConfig(config);
  assert.equal(valid.version, 1);
  assert.deepEqual(valid.layers[0].bindings.map(binding => binding.action), actions);
  config.layers.pop();
  assert.throws(() => validateConfig(config), /camada inexistente/);
  config.layers[0].bindings = [config.layers[0].bindings[4]];
  assert.throws(() => validateConfig(config), /antes de remover a camada/);
});

test('validação rejeita abertura perigosa, conteúdo excessivo e sequências fora dos limites', () => {
  const { validateAction } = require('../app/config.cjs');
  for (const target of ['javascript:alert(1)', 'file:///tmp/data', 'https://user:secret@example.test/', 'https://example.test/\n']) {
    assert.throws(() => validateAction({ type: 'open', kind: 'url', target }));
  }
  for (const kind of ['path', 'application']) {
    assert.throws(() => validateAction({ type: 'open', kind, target: './relative' }, 'linux'), /absoluto/);
    assert.equal(validateAction({ type: 'open', kind, target: '/opt/arquivo com espaços' }, 'linux').target, '/opt/arquivo com espaços');
    assert.equal(validateAction({ type: 'open', kind, target: 'C:\\Apps\\Programa.exe' }, 'win32').target, 'C:\\Apps\\Programa.exe');
  }
  assert.throws(() => validateAction({ type: 'open', kind: 'shell', target: '/bin/sh' }), /inválido/);
  assert.throws(() => validateAction({ type: 'clipboard', text: '' }), /Texto/);
  assert.throws(() => validateAction({ type: 'clipboard', text: 'x'.repeat(64001) }), /64000/);
  assert.throws(() => validateAction({ type: 'notification', title: '', message: 'Oi' }), /Título/);
  assert.throws(() => validateAction({ type: 'notification', title: 'Oi', message: 'x'.repeat(4001) }), /4000/);
  const simple = { type: 'clipboard', text: 'Olá' };
  assert.throws(() => validateAction({ type: 'sequence', steps: [] }), /1 e 10/);
  assert.throws(() => validateAction({ type: 'sequence', steps: Array.from({ length: 11 }, () => simple) }), /1 e 10/);
  assert.throws(() => validateAction({ type: 'sequence', steps: [{ type: 'sequence', steps: [simple] }] }), /outras sequências/);
  assert.equal(validateAction({ type: 'sequence', steps: Array.from({ length: 10 }, () => simple) }).steps.length, 10);
});

test('codec usa exatamente 256 KiB canônicos e aceita JSON legado formatado até 2 MiB', () => {
  const { encodeConfig, decodeConfig, MAX_CONFIG_BYTES, MAX_CONFIG_FILE_BYTES } = require('../app/config.cjs');
  const config = defaultConfig();
  config.layers[0].bindings[0].action = { type: 'sequence', steps: Array.from({ length: 5 }, () => ({ type: 'clipboard', text: 'x' })) };
  const normalized = validateConfig(config);
  let remaining = MAX_CONFIG_BYTES - Buffer.byteLength(JSON.stringify(normalized));
  for (const step of normalized.layers[0].bindings[0].action.steps) {
    const extra = Math.min(63999, remaining);
    step.text += 'x'.repeat(extra);
    remaining -= extra;
  }
  assert.equal(remaining, 0);
  const encoded = encodeConfig(normalized);
  assert.equal(Buffer.byteLength(encoded), MAX_CONFIG_BYTES);
  assert.equal(encoded.endsWith('\n'), false);
  assert.deepEqual(decodeConfig(encoded), normalized);
  const formatted = JSON.stringify(normalized, null, 2) + '\n';
  assert.ok(Buffer.byteLength(formatted) > MAX_CONFIG_BYTES);
  assert.deepEqual(decodeConfig(Buffer.from(formatted)), normalized);
  const padded = encoded + ' '.repeat(MAX_CONFIG_FILE_BYTES - Buffer.byteLength(encoded));
  assert.deepEqual(decodeConfig(padded), normalized);
  assert.throws(() => decodeConfig(padded + ' '), /2 MiB/);
  normalized.layers[0].bindings[0].action.steps.at(-1).text += 'x';
  assert.throws(() => encodeConfig(normalized), /256 KiB/);
});

test('limite canônico considera defaults normalizados, sem contar campos legados descartados', () => {
  const { encodeConfig, decodeConfig } = require('../app/config.cjs');
  const config = defaultConfig();
  config.legacyIgnored = 'x'.repeat(300000);
  delete config.layers[0].bindings[0].enabled;
  const encoded = encodeConfig(config);
  assert.ok(Buffer.byteLength(encoded) < 256 * 1024);
  const loaded = decodeConfig(JSON.stringify(config, null, 2));
  assert.equal(loaded.legacyIgnored, undefined);
  assert.equal(loaded.layers[0].bindings[0].enabled, true);
  assert.deepEqual(JSON.parse(encoded), loaded);
  assert.throws(() => decodeConfig('{"secret":"invalid json'), /JSON válido/);
});

test('mesma combinação permite um binding por momento e legado press não infla o arquivo', () => {
  const config = defaultConfig();
  const original = structuredClone(config.layers[0].bindings[0]);
  const encoded = JSON.stringify(validateConfig(config));
  config.layers[0].bindings[0].trigger = 'press';
  assert.equal(JSON.stringify(validateConfig(config)), encoded);
  config.layers[0].bindings.push({ ...original, id: 'hold-A', trigger: 'hold', keyCode: 'KeyA', repeatMs: 250 });
  config.layers[0].bindings.push({ ...original, id: 'release-A', trigger: 'release', keyCode: 'KeyA' });
  const values = validateConfig(config).layers[0].bindings;
  assert.equal(values.length, 3);
  assert.equal(values[1].repeatMs, 250);
  assert.equal(values[2].trigger, 'release');
  config.layers[0].bindings.push({ ...original, id: 'duplicate-release', trigger: 'release', keyCode: 'KeyA' });
  assert.throws(() => validateConfig(config), /duplicado neste momento/);
});

test('gatilhos validam captura física, intervalo, consistência e reservas', () => {
  const create = () => {
    const config = defaultConfig();
    Object.assign(config.layers[0].bindings[0], { trigger: 'hold', keyCode: 'KeyA' });
    return config;
  };
  assert.equal(validateConfig(create()).layers[0].bindings[0].repeatMs, 400);
  for (const [field, values] of [['trigger', ['invalid', true]], ['repeatMs', [0, 99, 60001, 1.5, '400']], ['keyCode', ['', 'Unidentified', 'ControlLeft', {}, 'KeyAA']]]) {
    for (const value of values) {
      const config = create(); config.layers[0].bindings[0][field] = value;
      assert.throws(() => validateConfig(config));
    }
  }
  const missing = create(); delete missing.layers[0].bindings[0].keyCode;
  assert.throws(() => validateConfig(missing), /Capture a tecla/);
  const reserved = create(); reserved.layers[0].bindings[0].key = 'F8';
  assert.throws(() => validateConfig(reserved), /reservado/);
  const mismatch = create();
  mismatch.layers[0].bindings.push({ ...mismatch.layers[0].bindings[0], id: 'release', trigger: 'release', keyCode: 'KeyQ' });
  assert.throws(() => validateConfig(mismatch), /mesma posição física/);
  const collision = create();
  collision.layers[0].bindings.push({ ...collision.layers[0].bindings[0], id: 'other', key: 'Q' });
  assert.throws(() => validateConfig(collision), /combinações diferentes/);
  const meta = create(); meta.layers[0].bindings[0].key = 'Command+A';
  meta.layers[0].bindings.push({ ...meta.layers[0].bindings[0], id: 'super', key: 'Super+A', trigger: 'release' });
  assert.throws(() => validateConfig(meta, 'darwin'), /combinações diferentes/);
  const independent = create(); independent.layers[0].bindings[0].repeatMs = 100;
  independent.layers[0].bindings.push({ ...independent.layers[0].bindings[0], id: 'ctrl', key: 'Control+A', repeatMs: 60000 });
  assert.equal(validateConfig(independent).layers[0].bindings.length, 2);
});

test('holdDelayMs aceita zero e limite, preserva ausência legada e não se aplica a press/release', () => {
  const config = defaultConfig();
  const binding = config.layers[0].bindings[0];
  binding.trigger = 'hold'; binding.keyCode = 'KeyA'; binding.repeatMs = 150;
  const legacy = validateConfig(config).layers[0].bindings[0];
  assert.equal(legacy.repeatMs, 150);
  assert.equal(Object.hasOwn(legacy, 'holdDelayMs'), false);
  for (const value of [0, 60000]) {
    binding.holdDelayMs = value;
    assert.equal(validateConfig(config).layers[0].bindings[0].holdDelayMs, value);
  }
  for (const value of [-1, 60001, 0.5, '100', null]) {
    binding.holdDelayMs = value;
    assert.throws(() => validateConfig(config), /Delay inicial/);
  }
  for (const trigger of ['press', 'release']) {
    binding.trigger = trigger;
    binding.holdDelayMs = 'não utilizado';
    assert.equal(Object.hasOwn(validateConfig(config).layers[0].bindings[0], 'holdDelayMs'), false);
  }
});

test('holdDelayMs mantém zero e valor distinto do intervalo no codec e persistência', async t => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const { Storage } = require('../app/storage.cjs');
  const { encodeConfig, decodeConfig } = require('../app/config.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'keyboard-delay-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = defaultConfig();
  const binding = config.layers[0].bindings[0];
  binding.trigger = 'hold'; binding.keyCode = 'KeyA'; binding.repeatMs = 300;
  const storage = new Storage(directory);
  for (const value of [0, 850]) {
    binding.holdDelayMs = value;
    const encoded = encodeConfig(config);
    assert.equal(decodeConfig(encoded).layers[0].bindings[0].holdDelayMs, value);
    await storage.save(config);
    const loaded = await new Storage(directory).load();
    assert.equal(loaded.layers[0].bindings[0].holdDelayMs, value);
    assert.equal(loaded.layers[0].bindings[0].repeatMs, 300);
  }
  delete binding.holdDelayMs;
  await storage.save(config);
  assert.equal(Object.hasOwn((await storage.load()).layers[0].bindings[0], 'holdDelayMs'), false);
});
