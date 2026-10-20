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
