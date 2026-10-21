const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Storage, readConfigFile } = require('../app/storage.cjs');
const { defaultConfig, validateConfig, encodeConfig, MAX_CONFIG_BYTES, MAX_CONFIG_FILE_BYTES } = require('../app/config.cjs');

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'key-storage-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function largeConfig() {
  const config = defaultConfig();
  const keys = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', ...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].map(key => 'Control+' + key), ...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].map(key => 'Alt+' + key)].slice(0, 100);
  config.layers = Array.from({ length: 3 }, (_, i) => ({ id: 'layer-' + i, name: 'Camada ' + i, bindings: keys.map((key, j) => ({ id: `binding-${i}-${j}`, key, name: 'Ação ' + j, action: { type: 'sequence', steps: Array.from({ length: 10 }, () => ({ type: 'clipboard', text: 'x' })) } })) }));
  return validateConfig(config);
}

test('configuração grande com sequências salva canônica e recarrega; legado indentado é preservado até salvar', async t => {
  const directory = await temporary(t);
  const storage = new Storage(directory);
  const config = largeConfig();
  const legacy = JSON.stringify(config, null, 2) + '\n';
  assert.ok(Buffer.byteLength(legacy) > MAX_CONFIG_BYTES);
  assert.ok(Buffer.byteLength(legacy) < MAX_CONFIG_FILE_BYTES);
  await fs.writeFile(storage.configPath, legacy);
  assert.deepEqual(await storage.load(), config);
  assert.equal(await fs.readFile(storage.configPath, 'utf8'), legacy);
  const saved = await storage.save(config);
  assert.deepEqual(saved, config);
  assert.equal(await fs.readFile(storage.configPath, 'utf8'), encodeConfig(config));
  assert.ok((await fs.stat(storage.configPath)).size <= MAX_CONFIG_BYTES);
  assert.deepEqual(await new Storage(directory).load(), config);
});

test('arquivo legado acima de 2 MiB é recusado e preservado', async t => {
  const directory = await temporary(t);
  const storage = new Storage(directory);
  const content = ' '.repeat(MAX_CONFIG_FILE_BYTES + 1);
  await fs.writeFile(storage.configPath, content);
  await assert.rejects(storage.load(), /preservado.*2 MiB/);
  assert.equal((await fs.stat(storage.configPath)).size, content.length);
});

test('leitura limitada continua após short reads e fecha o handle', async t => {
  const source = Buffer.from(encodeConfig(defaultConfig()));
  let position = 0;
  let closed = false;
  t.mock.method(fs, 'open', async () => ({
    stat: async () => ({ size: source.length }),
    read: async (target, offset, length) => {
      const bytesRead = Math.min(17, length, source.length - position);
      source.copy(target, offset, position, position + bytesRead);
      position += bytesRead;
      return { bytesRead };
    },
    close: async () => { closed = true; }
  }));
  assert.deepEqual(await readConfigFile('/not-used'), JSON.parse(source.toString()));
  assert.equal(position, source.length);
  assert.equal(closed, true);
});

test('crescimento após stat não lê além do cap + 1 e fecha o handle', async t => {
  let readBytes = 0;
  let closed = false;
  t.mock.method(fs, 'open', async () => ({
    stat: async () => ({ size: 1 }),
    read: async (target, offset, length) => {
      target.fill(32, offset, offset + length);
      readBytes += length;
      return { bytesRead: length };
    },
    close: async () => { closed = true; }
  }));
  await assert.rejects(readConfigFile('/not-used'), /2 MiB/);
  assert.equal(readBytes, MAX_CONFIG_FILE_BYTES + 1);
  assert.equal(closed, true);
});

const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { exportConfigSafe } = require('../app/storage.cjs');
function secureProtection() {
  // Real AES is a test-only native-keyring substitute; production uses only safeStorage.
  const key = randomBytes(32);
  return {
    available: true,
    async encrypt(text) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    async decrypt(buffer) {
      const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
      decipher.setAuthTag(buffer.subarray(12, 28));
      return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
    }
  };
}
function withHeaders() {
  const config = defaultConfig();
  const http = { type: 'http', method: 'GET', url: 'https://example.test', headers: { Authorization: 'synthetic-private-header' } };
  config.layers[0].bindings[0].action = { type: 'sequence', stepDelayMs: 23, steps: [http, { ...http, headers: { 'X-Test': 'synthetic-step-header' } }] };
  return validateConfig(config);
}

test('headers inside sequences encrypt entire v1 configuration and previous backup; portable export strips all headers', async t => {
  const storage = new Storage(await temporary(t), { protection: secureProtection() });
  const first = withHeaders();
  await storage.save(first);
  const second = structuredClone(first);
  second.layers[0].name = 'updated';
  await storage.save(second);
  for (const file of [storage.configPath, storage.backupPath]) {
    const content = await fs.readFile(file, 'utf8');
    assert.equal(content.includes('synthetic-'), false);
    assert.equal(content.includes('https:'), false);
    assert.equal(JSON.parse(content).format, 'key-tracker.safeStorage');
  }
  assert.deepEqual(await storage.load(), second);
  assert.deepEqual(await storage.readBackup(), first);
  assert.deepEqual(storage.status(), { encryptionAvailable: true, protection: 'encrypted', backupAvailable: true, message: 'Configuração protegida pelo cofre do sistema.' });
  const portable = exportConfigSafe(first);
  assert.deepEqual(portable.layers[0].bindings[0].action.steps.map(step => step.headers), [{}, {}]);
  assert.equal(portable.layers[0].bindings[0].action.stepDelayMs, 23);
  assert.equal(first.layers[0].bindings[0].action.steps[0].headers.Authorization, 'synthetic-private-header');
});

test('no secure provider refuses new header saves and preserves legacy bytes until secure migration', async t => {
  const directory = await temporary(t);
  const storage = new Storage(directory);
  const config = withHeaders();
  await assert.rejects(storage.save(config), /Cofre seguro indisponível/);
  await assert.rejects(fs.stat(storage.configPath), { code: 'ENOENT' });
  const legacy = JSON.stringify(config, null, 2);
  await fs.writeFile(storage.configPath, legacy);
  assert.deepEqual(await storage.load(), config);
  assert.equal(storage.status().protection, 'legacy');
  await assert.rejects(storage.save(config), /Cofre seguro indisponível/);
  assert.equal(await fs.readFile(storage.configPath, 'utf8'), legacy);
  const migrated = new Storage(directory, { protection: secureProtection() });
  assert.deepEqual(await migrated.load(), config);
  assert.equal(migrated.status().protection, 'encrypted');
  assert.equal(migrated.status().backupAvailable, true);
  assert.deepEqual(await migrated.readBackup(), config);
  assert.equal((await fs.readFile(migrated.backupPath, 'utf8')).includes('synthetic-'), false);
});

test('legacy migration encryption failure preserves original data and reports legacy warning', async t => {
  const storage = new Storage(await temporary(t), { protection: { available: true, encrypt: async () => { throw new Error('private'); } } });
  const config = withHeaders();
  const legacy = encodeConfig(config);
  await fs.writeFile(storage.configPath, legacy);
  assert.deepEqual(await storage.load(), config);
  assert.equal(await fs.readFile(storage.configPath, 'utf8'), legacy);
  assert.equal(storage.status().protection, 'legacy');
  assert.match(storage.status().message, /Migração segura não concluída/);
});

test('invalid current is never silently overwritten; explicit backup recovery preserves exact invalid file', async t => {
  const storage = new Storage(await temporary(t));
  const first = await storage.load();
  const next = structuredClone(first);
  next.layers[0].name = 'next';
  await storage.save(next);
  await fs.writeFile(storage.configPath, '{ invalid original');
  await assert.rejects(storage.load(), /Arquivo preservado/);
  assert.equal(storage.status().backupAvailable, true);
  await assert.rejects(storage.save(next), /recuperação explícita/);
  assert.equal(await fs.readFile(storage.configPath, 'utf8'), '{ invalid original');
  const recovery = new Storage(storage.directory);
  assert.deepEqual(await recovery.restoreBackup(), first);
  assert.equal(recovery.status().backupAvailable, true);
  const protectedPaths = await storage.protectedPaths();
  const preserved = protectedPaths.find(file => file.includes('config.invalid-'));
  assert.ok(preserved);
  assert.equal(await fs.readFile(preserved, 'utf8'), '{ invalid original');
  assert.deepEqual(await storage.load(), first);
});

test('serialized concurrent saves retain previous version and partial rename failure preserves main', async t => {
  const storage = new Storage(await temporary(t));
  const first = await storage.load();
  const second = structuredClone(first); second.layers[0].name = 'second';
  const third = structuredClone(first); third.layers[0].name = 'third';
  await Promise.all([storage.save(second), storage.save(third)]);
  assert.deepEqual(await storage.load(), third);
  assert.deepEqual(await storage.readBackup(), second);
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (source, destination) => {
    if (destination === storage.configPath) throw new Error('simulated filesystem failure');
    return rename(source, destination);
  });
  await assert.rejects(storage.save(first), /simulated filesystem failure/);
  assert.deepEqual(await storage.load(), third);
  assert.deepEqual(await storage.readBackup(), third);
  assert.equal((await fs.readdir(storage.directory)).some(name => name.endsWith('.tmp')), false);
});

test('unavailable/wrong key preserves encrypted current and explicit import recovery archives original', async t => {
  const directory = await temporary(t);
  const secure = new Storage(directory, { protection: secureProtection() });
  await secure.save(withHeaders());
  const ciphertext = await fs.readFile(secure.configPath);
  const unavailable = new Storage(directory);
  await assert.rejects(unavailable.load(), /cofre indisponível/);
  assert.equal(unavailable.status().protection, 'unavailable');
  await assert.rejects(unavailable.save(defaultConfig()), /recuperação explícita/);
  assert.deepEqual(await fs.readFile(secure.configPath), ciphertext);
  const wrongKey = new Storage(directory, { protection: secureProtection() });
  await assert.rejects(wrongKey.load(), /cofre indisponível/);
  const replacement = defaultConfig();
  await unavailable.recover(replacement);
  const archived = (await unavailable.protectedPaths()).find(file => file.includes('config.invalid-'));
  assert.deepEqual(await fs.readFile(archived), ciphertext);
  assert.deepEqual(await unavailable.load(), replacement);
});

test('corrupt/missing backup is never treated as restorable and status clone cannot mutate storage', async t => {
  const storage = new Storage(await temporary(t));
  assert.equal(await storage.readBackup(), null);
  const copy = storage.status(); copy.backupAvailable = true;
  assert.equal(storage.status().backupAvailable, false);
  await fs.writeFile(storage.backupPath, '{ corrupt');
  await assert.rejects(storage.readBackup(), /Backup inválido/);
  assert.equal(storage.status().backupAvailable, false);
  await assert.rejects(storage.restoreBackup());
  await assert.rejects(fs.stat(storage.configPath), { code: 'ENOENT' });
});

test('backup failure aborts replacement and queue can save again after failure', async t => {
  const storage = new Storage(await temporary(t));
  const first = await storage.load();
  const next = structuredClone(first); next.layers[0].name = 'next';
  const rename = fs.rename;
  const patch = t.mock.method(fs, 'rename', async (source, destination) => {
    if (destination === storage.backupPath) throw new Error('backup write blocked');
    return rename(source, destination);
  });
  await assert.rejects(storage.save(next), /backup write blocked/);
  assert.deepEqual(await storage.load(), first);
  assert.equal((await fs.readdir(storage.directory)).some(name => name.endsWith('.tmp')), false);
  patch.mock.restore();
  await storage.save(next);
  assert.deepEqual(await storage.load(), next);
  assert.deepEqual(await storage.readBackup(), first);
});

test('redacted export also removes direct HTTP headers while preserving triggers and delay metadata', () => {
  const config = withHeaders();
  const binding = config.layers[0].bindings[0];
  binding.action = binding.action.steps[0];
  binding.trigger = 'hold'; binding.keyCode = 'KeyA'; binding.repeatMs = 251; binding.holdDelayMs = 0;
  const safe = exportConfigSafe(config);
  assert.deepEqual(safe.layers[0].bindings[0].action.headers, {});
  assert.equal(safe.layers[0].bindings[0].repeatMs, 251);
  assert.equal(safe.layers[0].bindings[0].holdDelayMs, 0);
  assert.equal(safe.layers[0].bindings[0].trigger, 'hold');
});
