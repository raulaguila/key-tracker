const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { NativeMacroDriver } = require('../app/macro-input/native.cjs');

function transports(extra = {}) {
  const lines = [], messages = [], errors = [], inputs = [];
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stdin = new EventEmitter(); child.exitCode = null;
  child.stdin.write = line => {
    lines.push(line); const id = Number(line.split(' ')[0]);
    queueMicrotask(() => child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'result', id, ok: true, released: true }) + '\n'))); return true;
  };
  child.stdin.end = () => { child.exitCode = 0; queueMicrotask(() => child.emit('exit', 0)); };
  child.kill = () => child.stdin.end();
  const hook = new EventEmitter(); hook.postMessage = message => {
    messages.push(message);
    if (message === 'stop') queueMicrotask(() => hook.emit('exit', 0));
    else queueMicrotask(() => hook.emit('message', { type: 'result', id: message.id, ok: true }));
  }; hook.kill = () => hook.emit('exit', 0);
  const spawnImpl = () => { queueMicrotask(() => child.stdout.emit('data', Buffer.from('{"type":"ready"}\n'))); return child; };
  const fork = () => { queueMicrotask(() => hook.emit('message', { type: 'ready' })); return hook; };
  const driver = new NativeMacroDriver({ platform: 'linux', spawnImpl, fork, onError: error => errors.push(error), onInput: value => inputs.push(value), ...extra });
  return { driver, child, hook, lines, messages, errors, inputs };
}

test('native driver restricts the pointer protocol to validated numeric commands', async () => {
  const { driver, lines, messages } = transports(); await driver.authorize();
  await driver.click({ x: -10, y: 12, button: 'right', clicks: 2 });
  assert.match(lines[0], /^\d+ click -10 12 3 2\n$/);
  assert.equal(await driver.released(), true);
  await driver.key('Ctrl+Enter'); assert.equal(messages.find(message => message.type === 'key').key, 'Control+Enter');
  const before = lines.length;
  await assert.rejects(driver.click({ x: '1\nanything', y: 0, button: 'left', clicks: 1 }), { code: 'MACRO_COORDINATES' });
  assert.equal(lines.length, before);
  await assert.rejects(driver.key('Control+Shift+F10'), { code: 'MACRO_STOPPED' });
  await driver.dispose();
});

test('native driver sends no recorded payload while idle and ignores queued payloads after stop', async () => {
  const { driver, hook, inputs, errors } = transports(); await driver.authorize();
  const input = { type: 'input', step: { kind: 'key', key: 'A' } };
  hook.emit('message', input); assert.equal(inputs.length, 0);
  await driver.startRecording(); hook.emit('message', input); assert.equal(inputs.length, 1);
  await driver.stopRecording(); hook.emit('message', input); assert.equal(inputs.length, 1);
  assert.deepEqual(errors, []); await driver.dispose();
});

test('malformed native replies close both helper and hook with a content-free error', async () => {
  const { driver, child, messages, errors } = transports(); await driver.authorize();
  child.stdout.emit('data', Buffer.from('{"type":"unexpected","secret":"typed-content"}\n'));
  await driver.dispose();
  assert.equal(errors[0].code, 'MACRO_UNAVAILABLE');
  assert.ok(!JSON.stringify(errors).includes('typed-content'));
  assert.ok(messages.includes('stop')); assert.equal(child.exitCode, 0);
});

test('native macOS authorization denial never starts a helper or hook', async () => {
  let started = false;
  const driver = new NativeMacroDriver({ platform: 'darwin', accessibility: () => false, spawnImpl: () => { started = true; } });
  await assert.rejects(driver.authorize({ prompt: true }), { code: 'MACRO_PERMISSION' }); assert.equal(started, false);
  await driver.dispose();
});

test('stop shortcut frames from a previous shortcut or operation cannot cancel the current flow', async () => {
  const stopped = []; const { driver, hook } = transports({ onStop: event => stopped.push(event) });
  await driver.authorize(); await driver.setStopShortcut('Control+Shift+F9', { generation: 2 });
  hook.emit('message', { type: 'stop', key: 'Control+Shift+F10', generation: 1 });
  hook.emit('message', { type: 'stop', key: 'Control+Shift+F9', generation: 1 });
  assert.equal(stopped.length, 0);
  hook.emit('message', { type: 'stop', key: 'Control+Shift+F9', generation: 2 }); assert.equal(stopped.length, 1);
  driver.invalidateStop('Control+Shift+F11', 3);
  hook.emit('message', { type: 'stop', key: 'Control+Shift+F9', generation: 2 }); assert.equal(stopped.length, 1);
  await driver.dispose();
});
