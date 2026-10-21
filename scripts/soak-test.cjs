// Bounded engine/storage/HTTP stability probe; does not certify native input or hours of uptime.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { setImmediate: yieldLoop } = require('node:timers/promises');
const { Engine } = require('../app/engine.cjs');
const { Storage } = require('../app/storage.cjs');
const { defaultConfig } = require('../app/config.cjs');
const { createDiagnostics } = require('../app/diagnostics.cjs');

async function main() {
  const args = process.argv.slice(2);
  let durationSeconds;
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--duration-seconds' || !/^[0-9]+$/.test(args[1]) || Number(args[1]) < 1 || Number(args[1]) > 3600) {
      throw new Error('Uso: node scripts/soak-test.cjs [--duration-seconds N], com N inteiro entre 1 e 3600.');
    }
    durationSeconds = Number(args[1]);
  }
  const watchdogMs = durationSeconds === undefined ? 60000 : durationSeconds * 1000 + 30000;
  const watchdog = setTimeout(() => { console.error('A sonda excedeu o limite de tempo de execução e limpeza.'); process.exit(1); }, watchdogMs);
  watchdog.unref();
  const started = performance.now();
  const heapBefore = process.memoryUsage().heapUsed;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dobra-soak-'));
  const server = http.createServer((request, response) => { response.writeHead(204); response.end(); });
  let engine;
  let completed = 0, cancelled = 0, saves = 0, batches = 0;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const config = defaultConfig();
    config.layers[0].bindings = [...'ABCD'].map(key => ({ id: 'soak-' + key, name: 'Soak', key, action: { type: 'sequence', stepDelayMs: 0, steps: [
      { type: 'file', directory, filename: 'effects.txt', content: 'effect\n', mode: 'append' },
      { type: 'http', method: 'GET', url: `http://127.0.0.1:${server.address().port}/`, headers: {}, query: {}, body: '' },
      ...Array.from({ length: 8 }, () => ({ type: 'log', message: 'bounded probe' }))
    ] } }));
    const storage = new Storage(directory);
    await storage.save(config);
    engine = new Engine({ config, storage, documents: directory, shortcuts: {
      register: () => { throw new Error('Native registration is outside this probe.'); }, unregister: () => {}, unregisterAll: () => {}
    } });
    let peak = 0;
    engine.on('state', state => { peak = Math.max(peak, state.running.length); assert.ok(state.running.length <= 4); });
    const runStarted = performance.now();
    while (durationSeconds === undefined ? batches < 75 : performance.now() - runStarted < durationSeconds * 1000) {
      const cancelBatch = batches % 5 === 0;
      if (batches % 5 === 0 || batches % 5 === 1) {
        const update = engine.state().config;
        for (const binding of update.layers[0].bindings) binding.action.stepDelayMs = cancelBatch ? 60000 : 0;
        await engine.saveConfig(update);
        saves++;
      }
      let cancellationIssued = false;
      const cancelOnGap = state => {
        if (cancelBatch && !cancellationIssued && state.running.some(entry => entry.phase === 'waiting')) {
          cancellationIssued = true;
          engine.cancelAllExecutions();
        }
      };
      engine.on('state', cancelOnGap);
      const layer = engine.activeLayer;
      await Promise.all(layer.bindings.map(binding => engine.runBinding(layer.id, binding.id)));
      engine.off('state', cancelOnGap);
      const events = engine.events.filter(event => event.kind === 'action').slice(0, 4);
      assert.equal(events.length, 4);
      assert.ok(events.every(event => event.status === (cancelBatch ? 'cancelled' : 'success')));
      completed += events.filter(event => event.status === 'success').length;
      cancelled += events.filter(event => event.status === 'cancelled').length;
      assert.equal(engine.inFlight.size, 0);
      assert.equal(engine.executions.size, 0);
      assert.ok(engine.events.length <= 100);
      assert.equal(engine.previews.size, 0);
      batches++;
      await yieldLoop();
    }
    assert.equal(completed + cancelled, batches * 4);
    if (durationSeconds === undefined) assert.equal(completed + cancelled, 300);
    assert.equal(peak, 4);
    assert.deepEqual(await storage.load(), engine.state().config);
    console.log(JSON.stringify({ probe: 'bounded-engine-storage-http', mode: durationSeconds === undefined ? 'fixed-executions' : 'duration', requestedDurationSeconds: durationSeconds ?? null,
      batches, executions: completed + cancelled, completed, cancelled, saves, peakRunning: peak,
      stepsPerSequence: 10, runElapsedMs: Math.round(performance.now() - runStarted), elapsedMs: Math.round(performance.now() - started), heapBeforeBytes: heapBefore, heapAfterBytes: process.memoryUsage().heapUsed,
      diagnostics: createDiagnostics({ state: engine.state(), versions: { app: require('../package.json').version, node: process.versions.node }, platform: process.platform, arch: process.arch }) }, null, 2));
  } finally {
    engine?.dispose();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
    clearTimeout(watchdog);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
