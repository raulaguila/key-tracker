const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Storage } = require('../app/storage.cjs');
const { Engine } = require('../app/engine.cjs');
const { defaultConfig } = require('../app/config.cjs');
const { executeAction } = require('../app/actions.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dobra-file-guard-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const storage = new Storage(path.join(root, 'profile'));
  const config = defaultConfig();
  await storage.save(config);
  await storage.save(config);
  const engine = new Engine({ config, storage, documents: root, shortcuts: { register: () => true, unregister() {}, unregisterAll() {} } });
  t.after(() => engine.dispose());
  const file = target => ({ type: 'file', directory: path.dirname(target), filename: path.basename(target), mode: 'append', content: 'MUST_NOT_WRITE' });
  return { root, storage, engine, file };
}

test('prévia e sequência recusam configuração/backup sem mudar os arquivos', async t => {
  const { storage, engine, file } = await fixture(t);
  const config = engine.state().config;
  config.layers[0].bindings[0].action = { type: 'sequence', steps: [file(storage.configPath), file(storage.backupPath)] };
  await engine.saveConfig(config);
  await storage.appendLog({ message: 'fixture' });
  const internalPaths = [storage.configPath, storage.backupPath, storage.logPath, storage.logPath + '.1'];
  for (const target of internalPaths) {
    const before = await fs.readFile(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    await assert.rejects(executeAction(file(target), { key: 'A', layer: 'Test' }, { storage }), /arquivos internos/);
    assert.deepEqual(await fs.readFile(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null; }), before);
  }
  const paths = [storage.configPath, storage.backupPath];
  const before = await Promise.all(paths.map(p => fs.readFile(p)));
  const layer = engine.activeLayer, binding = layer.bindings[0];
  await assert.rejects(engine.previewBinding(layer.id, binding.id), /arquivos internos/);
  assert.equal(engine.previews.size, 0);
  await engine.runBinding(layer.id, binding.id);
  assert.equal(engine.events[0].status, 'error');
  assert.match(engine.events[0].message, /arquivos internos/);
  assert.deepEqual(await Promise.all(paths.map(p => fs.readFile(p))), before);
  await storage.load();
  await storage.readBackup();
});

test('alias por hardlink é recusado mesmo se criado depois da prévia', async t => {
  const { root, storage, engine, file } = await fixture(t);
  const target = path.join(root, 'alias.txt');
  const config = engine.state().config;
  config.layers[0].bindings[0].action = file(target);
  await engine.saveConfig(config);
  const layer = engine.activeLayer;
  const preview = await engine.previewBinding(layer.id, layer.bindings[0].id);
  const before = await fs.readFile(storage.configPath);
  await fs.link(storage.configPath, target);
  await engine.runBinding(layer.id, layer.bindings[0].id, preview.previewId);
  assert.equal(engine.events[0].status, 'error');
  assert.deepEqual(await fs.readFile(storage.configPath), before);
});

test('pasta interna via symlink/junction é recusada inclusive para arquivo novo', async t => {
  const { root, storage, file } = await fixture(t);
  const alias = path.join(root, 'alias');
  try { await fs.symlink(storage.directory, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Sistema não permite criar o alias de diretório.'); return; } throw error; }
  const target = path.join(alias, 'new', 'note.txt');
  await assert.rejects(executeAction(file(target), { key: 'A', layer: 'Test' }, { storage }), /arquivos internos/);
  await assert.rejects(fs.access(path.join(storage.directory, 'new')), { code: 'ENOENT' });
});

test('pasta externa com prefixo parecido continua permitindo criar/acrescentar', async t => {
  const { root, storage, file } = await fixture(t);
  const target = path.join(root, 'profile-notes', 'note.txt');
  await executeAction({ ...file(target), mode: 'create', content: 'first' }, { key: 'A', layer: 'Test' }, { storage });
  await executeAction({ ...file(target), content: ' second' }, { key: 'A', layer: 'Test' }, { storage });
  assert.equal(await fs.readFile(target, 'utf8'), 'first second');
});

test('prévia pendente não publica token de uma configuração substituída', async t => {
  const { root, storage, engine, file } = await fixture(t);
  const config = engine.state().config;
  config.layers[0].bindings[0].action = file(path.join(root, 'effects.txt'));
  await engine.saveConfig(config);
  let release;
  storage.protectedPaths = () => new Promise(resolve => { release = resolve; });
  const layer = engine.activeLayer;
  const pending = engine.previewBinding(layer.id, layer.bindings[0].id);
  config.layers[0].name = 'Updated';
  await engine.saveConfig(config);
  release([]);
  await assert.rejects(pending, /configuração mudou/);
  assert.equal(engine.previews.size, 0);
});
