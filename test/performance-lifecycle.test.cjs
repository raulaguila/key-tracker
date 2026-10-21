const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Engine } = require('../app/engine.cjs');
const { Storage } = require('../app/storage.cjs');
const { defaultConfig } = require('../app/config.cjs');
const { drainServices, waitForShutdown } = require('../app/shutdown.cjs');
const { StateDelivery } = require('../app/state-delivery.cjs');
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function storageFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dobra-lifecycle-unit-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return new Storage(directory);
}
function engineFixture(storage, execute = async () => 'OK') {
  return new Engine({ config: defaultConfig(), storage, execute, documents: os.tmpdir(), shortcuts: { register: () => true, unregister() {}, unregisterAll() {} } });
}

test('progresso reutiliza configuração imutável por revisão; leituras explícitas são independentes', async () => {
  const engine = engineFixture({ appendLog: async () => {}, save: async () => {} });
  const first = engine.publish(), second = engine.publish();
  assert.equal(first.config, second.config);
  assert.ok(Object.isFrozen(first.config.layers[0].bindings[0].action));
  assert.notEqual(engine.state().config, first.config);
  const updated = engine.state().config; updated.layers[0].name = 'Alterada';
  await engine.saveConfig(updated);
  const third = engine.publish();
  assert.notEqual(third.config, first.config);
  assert.notEqual(first.config.layers[0].name, 'Alterada');
  engine.dispose();
});

test('parar todas bloqueia reativação até o efeito e o histórico terminarem', async () => {
  const effect = defer(), log = defer();
  const engine = engineFixture({ appendLog: () => log.promise }, () => effect.promise);
  const layer = engine.activeLayer;
  const run = engine.runBinding(layer.id, layer.bindings[0].id);
  assert.equal(engine.requestStop().stopping, true);
  assert.throws(() => engine.setEnabled(true), /parada/);
  await assert.rejects(engine.runBinding(layer.id, layer.bindings[0].id), /parada/);
  effect.resolve('OK'); await tick();
  assert.equal(engine.stopping, true);
  log.resolve(); await run; await engine.stopPromise;
  assert.equal(engine.state().stopping, false);
  assert.equal(engine.inFlight.size, 0);
  assert.equal(engine.events[0].status, 'cancelled');
  engine.dispose();
});

test('shutdown aguarda configuração aceita e log criado depois do cancelamento; deadline não declara sucesso', async t => {
  const storage = await storageFixture(t), effect = defer(), accepted = defer(), log = defer();
  const append = storage.appendLog.bind(storage);
  storage.appendLog = async event => { await log.promise; return append(event); };
  const engine = engineFixture(storage, () => effect.promise);
  const saved = defaultConfig();
  const layer = engine.activeLayer;
  const run = engine.runBinding(layer.id, layer.bindings[0].id);
  let monitorStopped = false;
  const drain = drainServices({ engine, storage, configuration: accepted.promise.then(() => storage.save(saved)), monitor: { dispose: async () => { monitorStopped = true; } } });
  assert.equal(engine.disposed, true);
  assert.equal(await waitForShutdown(drain, 15), false);
  assert.equal(monitorStopped, true);
  effect.resolve('OK'); accepted.resolve(); await tick();
  assert.equal(await waitForShutdown(drain, 15), false);
  log.resolve();
  assert.equal(await waitForShutdown(drain, 1000), true);
  await run;
  assert.deepEqual(await storage.load(), saved);
  assert.equal(JSON.parse((await fs.readFile(storage.logPath, 'utf8')).trim()).status, 'cancelled');
});

test('backup diferido não bloqueia a configuração principal; flush espera sua verificação', async t => {
  const storage = await storageFixture(t), backup = defer();
  await storage.save(defaultConfig());
  const read = storage._read.bind(storage);
  storage._read = file => file === storage.backupPath ? backup.promise : read(file);
  const config = await storage.load({ deferBackup: true });
  assert.equal(config.layers.length, 2);
  assert.equal(storage.status().backupChecking, true);
  const refreshing = storage.refreshBackup();
  assert.equal(await waitForShutdown(storage.flush(), 15), false);
  backup.resolve({ config: defaultConfig(), mode: 'plain' }); await refreshing;
  assert.equal(storage.status().backupChecking, false);
  assert.equal(storage.status().backupAvailable, true);
});

test('salvamento idêntico preserva inode e backup; mudanças reais ainda são atômicas', async t => {
  const storage = await storageFixture(t), config = defaultConfig();
  await storage.save(config);
  config.layers[0].name = 'Nova'; await storage.save(config);
  const before = await fs.stat(storage.configPath, { bigint: true });
  const backup = await fs.readFile(storage.backupPath);
  let writes = 0;
  const atomic = storage._atomic.bind(storage); storage._atomic = (...args) => { writes++; return atomic(...args); };
  await storage.save(structuredClone(config));
  assert.equal(writes, 0);
  assert.equal((await fs.stat(storage.configPath, { bigint: true })).ino, before.ino);
  assert.deepEqual(await fs.readFile(storage.backupPath), backup);
  config.layers[0].name = 'Outra'; await storage.save(config);
  assert.equal(writes, 2);
  assert.equal((await storage.readBackup()).layers[0].name, 'Nova');
});

test('transporte agrupa progresso, mantém controles imediatos e retém só o último estado oculto', async () => {
  const sent = []; let visible = true;
  const delivery = new StateDelivery({ send: value => sent.push(value), visible: () => visible, intervalMs: 20 });
  const state = { configRevision: 0, enabled: true, running: [{ bindingId: 'A' }], events: [] };
  delivery.push({ ...state, stateRevision: 1 });
  for (let i = 2; i <= 30; i++) delivery.push({ ...state, stateRevision: i });
  assert.equal(sent.length, 1);
  delivery.push({ ...state, enabled: false, stateRevision: 31 });
  assert.equal(sent.at(-1).stateRevision, 31);
  visible = false;
  for (let i = 32; i <= 100; i++) delivery.push({ ...state, stateRevision: i });
  assert.equal(sent.length, 2);
  visible = true; delivery.flush();
  assert.equal(sent.at(-1).stateRevision, 100);
  delivery.dispose(); delivery.push(state);
  assert.equal(sent.length, 3);
});
