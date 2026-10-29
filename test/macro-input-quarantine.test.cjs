const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { Engine } = require('../app/engine.cjs');
const { Tracker } = require('../app/tracking.cjs');
const { NativeInput } = require('../app/input-devices.cjs');
const { WaylandInput } = require('../app/wayland-input.cjs');
const { defaultConfig } = require('../app/config.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));

function engineFixture(platform, session) {
  const calls = [], config = defaultConfig();
  config.settings.cooldownMs = 100;
  config.layers[0].bindings = [
    { id: 'physical-press', name: 'Physical press', enabled: true, key: 'A', keyCode: 'KeyA', action: { type: 'clipboard', text: 'never logged' } },
    { id: 'physical-release', name: 'Physical release', enabled: true, key: 'A', keyCode: 'KeyA', trigger: 'release', action: { type: 'clipboard', text: 'never logged' } }
  ];
  const engine = new Engine({ config, platform, session, documents: '/documents',
    storage: { directory: '/data', logPath: '/data/log', appendLog: async () => {} },
    execute: async (_action, _context, options) => { calls.push(options); return 'OK'; } });
  return { engine, calls };
}

function workerFixture() {
  const workers = [];
  const fork = () => {
    const worker = new EventEmitter(); worker.exitCode = null; worker.messages = [];
    worker.postMessage = message => worker.messages.push(message);
    worker.kill = () => { worker.exitCode = 0; worker.emit('exit', 0); };
    workers.push(worker); return worker;
  };
  const key = (worker, direction) => worker.emit('message', { type: 'key', code: 'KeyA', key: 'A', direction });
  return { workers, fork, key };
}

function nativeFixture() {
  const children = [];
  const spawnClient = () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.exitCode = null;
    child.kill = () => { child.exitCode = 0; queueMicrotask(() => child.emit('exit', 0)); };
    child.frame = frame => child.stdout.write(JSON.stringify(frame) + '\n');
    children.push(child); return child;
  };
  return { children, spawnClient };
}

test('X11 quarantine rejects delayed synthetic messages by worker generation and preserves later physical input', async t => {
  const { engine, calls } = engineFixture('linux', 'x11');
  const { workers, fork, key } = workerFixture();
  const tracker = new Tracker({ engine, fork, now: () => 1000 });
  t.after(async () => { await tracker.dispose(); engine.dispose(); });
  const visual = []; engine.on('key', event => visual.push(event));
  tracker.set(true); engine.setEnabled(true); workers[0].emit('message', { type: 'ready' });
  let playing = true; engine.macroService = { state: () => ({ playing }) };
  key(workers[0], 'down'); key(workers[0], 'up'); await tick();
  assert.equal(calls.length, 0);

  playing = false; tracker.quarantineInput();
  assert.equal(workers.length, 2, 'fresh hook process starts after the flow');
  assert.deepEqual(workers[0].messages, ['stop']);
  const framesBeforeStale = visual.length;
  // These frames may sit in the old worker/IPC queue for arbitrarily long.
  key(workers[0], 'down'); key(workers[0], 'up');
  workers[0].emit('message', { type: 'ready' }); workers[0].emit('error', new Error('retired'));
  await tick();
  assert.equal(calls.length, 0);
  assert.equal(visual.length, framesBeforeStale);
  workers[1].emit('message', { type: 'ready' });
  key(workers[1], 'up'); await tick();
  assert.equal(calls.length, 0, 'reset and an unmatched keyup cannot fabricate a release action');
  key(workers[1], 'down'); key(workers[1], 'up'); await tick();
  assert.equal(calls.length, 2, 'a fresh physical press and release still work');
});

test('X11 holds observed during playback stay blocked through autorepeat until a real release', async t => {
  const { engine, calls } = engineFixture('linux', 'x11');
  const { workers, fork, key } = workerFixture();
  const tracker = new Tracker({ engine, fork, now: () => 1000 });
  t.after(async () => { await tracker.dispose(); engine.dispose(); });
  engine.setEnabled(true); workers[0].emit('message', { type: 'ready' });
  let playing = true; engine.macroService = { state: () => ({ playing }) };
  key(workers[0], 'down');
  assert.ok(engine.shortcutsAPI.down.has('KeyA'));
  playing = false; tracker.quarantineInput(); workers[1].emit('message', { type: 'ready' });
  for (let i = 0; i < 5; i++) key(workers[1], 'down');
  await tick(); assert.equal(calls.length, 0, 'held autorepeat cannot become a new press');
  key(workers[1], 'up'); await tick();
  assert.equal(calls.length, 0, 'baseline keyup cannot manufacture a release action');
  key(workers[1], 'down'); key(workers[1], 'up'); await tick();
  assert.equal(calls.length, 2, 'release then fresh press resumes normal gestures');
});

for (const platform of ['win32', 'darwin']) {
  test(`${platform} quarantine uses the intrinsic native capture time, keeps device selection and allows future physical gestures`, async t => {
    let now = 1000;
    const { engine, calls } = engineFixture(platform, 'native');
    const { children, spawnClient } = nativeFixture();
    const input = new NativeInput({ platform, spawnClient, now: () => now });
    const tracker = new Tracker({ engine, nativeInput: input, now: () => now, fork: () => { throw new Error('No fallback hook'); } });
    t.after(async () => { await tracker.dispose(); engine.dispose(); });
    tracker.set(true);
    const child = children[0];
    child.frame({ type: 'devices', devices: [{ id: 'physical-keyboard', name: 'Keyboard' }] });
    child.frame({ type: 'ready', monotonicMs: now }); engine.setEnabled(true);
    const devicesBefore = input.deviceState().devices;
    const visual = []; engine.on('key', event => visual.push(event));
    tracker.quarantineInput(); now = 1010;
    const key = (down, captureTime) => child.frame({ type: 'key', device: 'physical-keyboard', code: platform === 'win32' ? 30 : 4, down, globallyDown: down, monotonicMs: captureTime });
    key(true, 999); key(false, 1000); await tick();
    assert.equal(calls.length, 0, 'late delivery does not refresh the capture time');
    assert.deepEqual(visual.filter(event => !event.reset), []);
    assert.deepEqual(input.deviceState().devices, devicesBefore);
    assert.equal(children.length, 1, 'no reauthorization/reconnection required');
    key(false, 1001); await tick(); assert.equal(calls.length, 0);
    key(true, 1002); key(false, 1003); await tick();
    assert.equal(calls.length, 2);
    assert.deepEqual(visual.filter(event => !event.reset).map(event => event.monotonicMs), [1002, 1003]);
  });
}

test('Wayland quarantine discards old evdev frames while preserving the authorized source and future input', async t => {
  let now = 1000;
  const { engine, calls } = engineFixture('linux', 'wayland');
  const { children, spawnClient } = nativeFixture();
  const input = new WaylandInput({ spawnClient, now: () => now });
  const tracker = new Tracker({ engine, wayland: input, now: () => now, fork: () => { throw new Error('No XWayland fallback'); } });
  t.after(async () => { await tracker.dispose(); engine.dispose(); });
  tracker.set(true);
  const authorization = input.enable(); const child = children[0];
  child.frame({ type: 'connected' }); child.frame({ type: 'status', mode: 'global', keyboards: 1 }); await authorization;
  engine.setEnabled(true);
  const visual = []; engine.on('key', event => visual.push(event));
  tracker.quarantineInput(); now = 1010;
  const key = (down, captureTime) => child.frame({ type: 'key', code: 30, down, modifiers: 0, monotonicMs: captureTime });
  key(true, 999); key(false, 1000); await tick();
  assert.equal(calls.length, 0);
  assert.deepEqual(visual.filter(event => !event.reset), []);
  assert.equal(input.state().enabled, true); assert.equal(children.length, 1);
  key(false, 1001); await tick(); assert.equal(calls.length, 0);
  key(true, 1002); key(false, 1003); await tick();
  assert.equal(calls.length, 2);
  assert.deepEqual(visual.filter(event => !event.reset).map(event => event.monotonicMs), [1001, 1002, 1003]);
});

test('quarantine does not start a hook when neither actions nor visualization requested input', async t => {
  const { engine } = engineFixture('linux', 'x11'); const { workers, fork } = workerFixture();
  const tracker = new Tracker({ engine, fork });
  t.after(async () => { await tracker.dispose(); engine.dispose(); });
  tracker.quarantineInput(); assert.equal(workers.length, 0);
});
