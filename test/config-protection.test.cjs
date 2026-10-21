const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConfigProtection } = require('../app/config-protection.cjs');

function native(backend = 'gnome_libsecret') {
  return {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => backend,
    encryptStringAsync: async text => Buffer.from('native:' + text),
    decryptStringAsync: async buffer => ({ result: buffer.toString().slice(7), shouldReEncrypt: false })
  };
}

test('safeStorage adapter uses asynchronous native API and unwraps decrypt result', async () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const protection = await createConfigProtection({ safeStorage: native(), platform });
    assert.equal(protection.available, true);
    assert.equal(await protection.decrypt(await protection.encrypt('config v1')), 'config v1');
  }
});

test('Linux basic_text/unknown, unavailable native service and initialization error refuse protection', async () => {
  for (const backend of ['basic_text', 'unknown', 'future_backend']) {
    assert.equal((await createConfigProtection({ safeStorage: native(backend), platform: 'linux' })).available, false);
  }
  assert.equal((await createConfigProtection()).available, false);
  assert.equal((await createConfigProtection({ safeStorage: { ...native(), isAsyncEncryptionAvailable: async () => false }, platform: 'win32' })).available, false);
  assert.equal((await createConfigProtection({ safeStorage: { ...native(), isAsyncEncryptionAvailable: async () => { throw new Error('private'); } }, platform: 'darwin' })).available, false);
});

test('backend downgrade and native errors never fall back to plaintext or disclose error contents', async () => {
  let backend = 'kwallet6';
  const service = { ...native(), getSelectedStorageBackend: () => backend };
  const protection = await createConfigProtection({ safeStorage: service, platform: 'linux' });
  backend = 'basic_text';
  await assert.rejects(protection.encrypt('private'), /criptografar/);
  await assert.rejects(protection.decrypt(Buffer.from('x')), /descriptografar/);
  backend = 'kwallet6';
  service.encryptStringAsync = async () => { throw new Error('private key path'); };
  await assert.rejects(protection.encrypt('private'), error => !error.message.includes('private'));
});

test('cofre sem resposta termina a descoberta e informa a indisponibilidade no estado', async t => {
  const protection = await createConfigProtection({ platform: 'linux', timeoutMs: 15,
    safeStorage: { ...native(), isAsyncEncryptionAvailable: () => new Promise(() => {}) } });
  assert.equal(protection.available, false);
  assert.match(protection.message, /não respondeu a tempo/);
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'dobra-cofre-unavailable-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { Storage } = require('../app/storage.cjs');
  const storage = new Storage(directory, { protection });
  await storage.load();
  assert.equal(storage.status().encryptionAvailable, false);
  assert.match(storage.status().message, /não respondeu a tempo/);

});

test('encrypt/decrypt com timeout rejeitam, ignoram resposta tardia e permitem nova tentativa', async () => {
  const service = native();
  const protection = await createConfigProtection({ safeStorage: service, platform: 'linux', timeoutMs: 15 });
  let resolveLate;
  service.encryptStringAsync = () => new Promise(resolve => { resolveLate = resolve; });
  await assert.rejects(protection.encrypt('secret'), /criptografar/);
  resolveLate(Buffer.from('native:late'));
  service.encryptStringAsync = native().encryptStringAsync;
  assert.equal((await protection.encrypt('retry')).toString(), 'native:retry');
  service.decryptStringAsync = () => new Promise(() => {});
  await assert.rejects(protection.decrypt(Buffer.from('native:secret')), /Arquivo preservado/);
  service.decryptStringAsync = native().decryptStringAsync;
  assert.equal(await protection.decrypt(Buffer.from('native:retry')), 'retry');
});

test('resposta nativa após downgrade do backend não é aceita', async () => {
  let backend = 'gnome_libsecret';
  const service = { ...native(), getSelectedStorageBackend: () => backend,
    encryptStringAsync: async () => { backend = 'basic_text'; return Buffer.from('unprotected'); } };
  const protection = await createConfigProtection({ safeStorage: service, platform: 'linux' });
  await assert.rejects(protection.encrypt('secret'), /Nenhum header/);
});

test('timeout ao salvar preserva bytes e libera a fila; conclusão tardia não grava', async t => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'dobra-cofre-deadline-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { Storage } = require('../app/storage.cjs');
  const { defaultConfig } = require('../app/config.cjs');
  const service = native();
  const protection = await createConfigProtection({ safeStorage: service, platform: 'linux', timeoutMs: 15 });
  const storage = new Storage(directory, { protection });
  const config = defaultConfig();
  await storage.save(config);
  const before = await fs.readFile(storage.configPath);
  config.layers[0].bindings[0].action = { type: 'http', method: 'GET', url: 'https://example.invalid', headers: { 'x-fixture': 'private' }, query: {}, body: '' };
  let release, text;
  service.encryptStringAsync = value => { text = value; return new Promise(resolve => { release = resolve; }); };
  await assert.rejects(storage.save(config), /Nenhum header/);
  release(Buffer.from('native:' + text));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await fs.readFile(storage.configPath), before);
  service.encryptStringAsync = native().encryptStringAsync;
  await storage.save(config);
  assert.deepEqual(await storage.load(), config);
  assert.equal(JSON.parse(await fs.readFile(storage.configPath, 'utf8')).format, 'dobra.safeStorage');
});
