const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { createWaylandDriver } = require('../app/macro-input/wayland.cjs');

function fixture(options = {}) {
  const children = [], frames = [], failures = [];
  const driver = createWaylandDriver({ onError: error => failures.push(error), ...options, spawnImpl(file, args, settings) {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.exitCode = null;
    child.kill = signal => { child.killed = signal; child.exitCode = 0; setImmediate(() => child.emit('exit', 0)); };
    child.stdin.on('data', chunk => frames.push(JSON.parse(chunk.toString())));
    child.stdin.on('finish', () => { if (!options.holdExit) child.kill('EOF'); });
    child.send = frame => child.stdout.write(JSON.stringify(frame) + '\n');
    children.push({ child, file, args, settings });
    return child;
  } });
  const authorize = async () => {
    const pending = driver.authorize();
    children.at(-1).child.send({ id: frames.at(-1).id, ok: true, playback: true, recording: false });
    return pending;
  };
  return { driver, children, frames, failures, authorize };
}

test('Wayland only requests a portal after explicit authorization and reports real recording capability', async () => {
  const f = fixture();
  await assert.rejects(f.driver.click({ x: 1, y: 1, button: 'left', clicks: 1 }), { code: 'MACRO_PERMISSION_REQUIRED' });
  assert.equal(f.children.length, 0);
  const capabilities = await f.authorize();
  assert.deepEqual({ playback: capabilities.playback, recording: capabilities.recording }, { playback: true, recording: false });
  assert.match(capabilities.message, /gravação passiva/);
  assert.equal(f.children[0].file, '/usr/bin/python3');
  assert.deepEqual(f.children[0].args.slice(0, 2), ['-I', '-B']);
  assert.equal(f.children[0].settings.stdio[2], 'ignore');
  assert.deepEqual(f.frames, [{ id: 1, op: 'authorize' }]);
  await f.driver.dispose();
});

test('Wayland driver sends only validated coordinates and normalized key combinations', async () => {
  const f = fixture(); await f.authorize();
  await assert.rejects(f.driver.click({ x: 1.5, y: 1, button: 'left', clicks: 1 }), { code: 'MACRO_PROTOCOL' });
  await assert.rejects(f.driver.key('Control+$(touch /tmp/private)'), { code: 'MACRO_PROTOCOL' });
  assert.equal(f.frames.length, 1);
  const click = f.driver.click({ x: -500, y: 700, button: 'right', clicks: 2, command: 'ignored' });
  assert.deepEqual(f.frames.at(-1), { id: 2, op: 'click', x: -500, y: 700, button: 'right', clicks: 2 });
  f.children[0].child.send({ id: 2, ok: true }); await click;
  const key = f.driver.key('Ctrl+Shift+a');
  assert.deepEqual(f.frames.at(-1), { id: 3, op: 'key', key: 'Control+Shift+A' });
  f.children[0].child.send({ id: 3, ok: true }); await key;
  await f.driver.dispose();
});

test('portal denial is sanitized and can be retried without a stuck process', async () => {
  const f = fixture();
  const denied = f.driver.authorize();
  f.children[0].child.send({ id: 1, ok: false, code: 'denied', message: 'private user input' });
  await assert.rejects(denied, error => error.code === 'MACRO_DENIED' && !error.message.includes('private'));
  assert.equal(f.driver.authorized, false);
  assert.equal((await f.authorize()).playback, true);
  assert.equal(f.children.length, 2);
  await f.driver.dispose();
});

test('coordinates outside the shared monitor fail while retaining the authorized session', async () => {
  const f = fixture(); await f.authorize();
  const clicked = f.driver.click({ x: 1, y: 1, button: 'left', clicks: 1 });
  f.children[0].child.send({ id: 2, ok: false, code: 'coordinates' });
  await assert.rejects(clicked, { code: 'MACRO_COORDINATES' });
  assert.equal(f.driver.authorized, true);
  assert.equal(f.failures.length, 0);
  await f.driver.dispose();
});

test('portal session revocation rejects input and notifies its owner without leaking content', async () => {
  const f = fixture(); await f.authorize();
  const key = f.driver.key('A');
  f.children[0].child.send({ type: 'closed', text: 'private' });
  await assert.rejects(key, { code: 'MACRO_REVOKED' });
  assert.equal(f.failures.length, 1);
  assert.equal(f.driver.authorized, false);
  assert.doesNotMatch(f.failures[0].message, /private/);
  await f.driver.dispose();
});

test('cancelling input retires the portal helper before later operations can be accepted', async () => {
  const f = fixture(); await f.authorize();
  const controller = new AbortController();
  const key = f.driver.key('Control+V', { signal: controller.signal });
  controller.abort();
  await assert.rejects(key, { code: 'EXECUTION_CANCELLED' });
  await assert.rejects(f.driver.key('Enter'), { code: 'MACRO_PERMISSION_REQUIRED' });
  assert.equal(f.failures.length, 0);
  assert.equal((await f.authorize()).playback, true);
  await f.driver.dispose();
  assert.equal(f.driver.retiring.size, 0);
});

test('cancellation stays pending until the native helper has actually exited', async () => {
  const f = fixture({ holdExit: true }); await f.authorize();
  const controller = new AbortController(); let settled = false;
  const key = f.driver.key('A', { signal: controller.signal }).finally(() => { settled = true; });
  const rejected = assert.rejects(key, { code: 'EXECUTION_CANCELLED' });
  controller.abort();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(f.driver.authorized, false);
  f.children[0].child.exitCode = 0; f.children[0].child.emit('exit', 0);
  await rejected; await f.driver.dispose();
  assert.equal(settled, true);
});

test('invalid portal frames terminate the session instead of accepting unproven success', async () => {
  const f = fixture();
  const authorization = f.driver.authorize();
  f.children[0].child.send({ id: 999, ok: true, playback: true, recording: false });
  await assert.rejects(authorization, { code: 'MACRO_PROTOCOL' });
  assert.equal(f.driver.authorized, false);
  await f.driver.dispose();
});

test('portal authorization has a bounded deadline and disposal cancels pending consent', async () => {
  const f = fixture({ authorizeTimeoutMs: 10 });
  const timeout = f.driver.authorize();
  await Promise.all([assert.rejects(timeout, { code: 'MACRO_TIMEOUT' }), new Promise(resolve => setTimeout(resolve, 20))]);
  const next = f.driver.authorize();
  const rejected = assert.rejects(next, { code: 'EXECUTION_CANCELLED' });
  await f.driver.dispose(); await rejected;
  assert.equal(f.driver.retiring.size, 0);
});

test('Wayland helper validates logical monitor geometry and releases injected input after failure', { skip: process.platform !== 'linux' }, () => {
  const result = execFileSync('/usr/bin/python3', ['-I', '-B', path.join(__dirname, 'wayland_macro_fixture.py')], { encoding: 'utf8', timeout: 5000 });
  assert.match(result, /8 checks passed/);
});
