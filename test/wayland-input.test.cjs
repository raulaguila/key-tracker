const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { WaylandInput } = require('../app/wayland-input.cjs');
const { keyboardCode, linuxCode } = require('../app/linux-keycodes.cjs');
const { defaultConfig } = require('../app/config.cjs');
const { Engine } = require('../app/engine.cjs');
const { Tracker } = require('../app/tracking.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t) {
  const children = [];
  const input = new WaylandInput({ spawnClient: (...args) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.exitCode = null; child.args = args;
    child.kill = () => { queueMicrotask(() => { child.exitCode = 0; child.emit('exit', 0); }); return true; };
    child.frame = event => child.stdout.write(JSON.stringify(event.type === 'key' ? { monotonicMs: Number(process.hrtime.bigint()) / 1000000, ...event } : event) + '\n');
    children.push(child); return child;
  } });
  t.after(() => input.dispose());
  return { input, children, async connect(mode = 'idle') { const pending = input.enable(); const child = children.at(-1); child.frame({ type: 'connected' }); child.frame({ type: 'status', mode, keyboards: mode === 'global' ? 1 : 0 }); await pending; return child; } };
}

test('Wayland só solicita autorização explicitamente, com filtro físico e cliente isolado', async t => {
  const { input, children, connect } = fixture(t);
  const config = defaultConfig(); config.layers[0].bindings[0].keyCode = 'KeyQ';
  input.update({ config, observe: false, visual: false });
  assert.equal(children.length, 0);
  const child = await connect();
  const [program, args, options] = child.args;
  assert.equal(program, '/usr/bin/python3'); assert.equal(args[0], '-I');
  assert.equal(options.env.DBUS_SYSTEM_BUS_ADDRESS, 'unix:path=/run/dbus/system_bus_socket');
  const initial = JSON.parse(child.stdin.read().toString().trim());
  assert.deepEqual(initial.keys, []); assert.equal(initial.observe, false);
  input.update({ config, observe: true, visual: false });
  const next = JSON.parse(child.stdin.read().toString().trim());
  assert.ok(next.keys.includes(16)); assert.ok(next.keys.includes(66)); assert.ok(next.keys.includes(88));
  input.update({ config, observe: true, visual: false }); assert.equal(child.stdin.read(), null, 'não reenvia filtros em progresso/estado sem mudança');
});

test('falha/negação não reinicia cliente e desabilitar cancela autorização pendente', async t => {
  const { input, children } = fixture(t);
  const pending = input.enable(); const rejected = assert.rejects(pending, /cancelada|negada/);
  children[0].frame({ type: 'error', reason: 'denied' }); await rejected;
  assert.equal(input.state().enabled, false); assert.equal(input.state().status, 'denied');
  await tick(); assert.equal(children.length, 1);
  const retry = input.enable(); const cancelled = assert.rejects(retry, /desabilitada/);
  await input.disable(); await cancelled;
  assert.equal(input.state().status, 'disabled');
});

test('códigos Linux normalizam modificadores, posições internacionais e numpad', async t => {
  for (const code of ['KeyA', 'IntlRo', 'IntlYen', 'IntlBackslash', 'NumpadEnter', 'F13', 'F24', 'ArrowRight']) assert.equal(keyboardCode(linuxCode(code)), code);
  const { input, connect } = fixture(t); const child = await connect('global'); const events = [];
  input.on('key', event => events.push(event));
  child.frame({ type: 'key', code: 89, down: true, modifiers: 11 });
  assert.equal(events[0].code, 'IntlRo'); assert.equal(events[0].ctrlKey, true); assert.equal(events[0].altKey, true); assert.equal(events[0].metaKey, true); assert.equal(events[0].shiftKey, false);
  child.frame({ type: 'key', code: 89, down: false, modifiers: 0 });
  assert.equal(events[1].direction, 'up');
  await input.disable(); child.frame({ type: 'key', code: 30, down: true, modifiers: 0 });
  assert.equal(events.length, 2, 'nenhuma mensagem atrasada após revogação');
});

test('stream inválido encerra sessão e limita buffers', async t => {
  const { input, connect } = fixture(t); const child = await connect('global'); let interrupted = 0;
  input.on('interrupted', () => interrupted++);
  child.stdout.write('x'.repeat(65537));
  assert.equal(input.state().enabled, false); assert.equal(interrupted, 1);
});

test('entrada atrasada encerra sessão sem reexecutar ações da fila', async t => {
  const { input, connect } = fixture(t); const child = await connect('global'); const events = [];
  input.on('key', event => events.push(event));
  child.frame({ type: 'key', code: 30, down: true, modifiers: 0, monotonicMs: Number(process.hrtime.bigint()) / 1000000 - 1500 });
  assert.equal(events.length, 0); assert.equal(input.state().status, 'delayed'); assert.equal(input.state().enabled, false);
});

test('Tracker usa backend Wayland para ações/rastreio; reset não fabrica soltura e lock pausa', async t => {
  const { input, connect } = fixture(t);
  const config = defaultConfig(); config.settings.cooldownMs = 100;
  config.layers[0].bindings[0].keyCode = 'KeyA';
  config.layers[0].bindings.push({ ...config.layers[0].bindings[0], id: 'release', trigger: 'release' });
  const calls = [];
  const engine = new Engine({ config, platform: 'linux', session: 'wayland', documents: '/documents', storage: { directory: '/data', logPath: '/data/log', appendLog: async () => {} }, execute: async (_action, context) => { calls.push(context); return 'OK'; } });
  const tracker = new Tracker({ engine, wayland: input, fork: () => { throw new Error('Wayland não usa libuiohook'); } });
  t.after(async () => { await tracker.dispose(); engine.dispose(); });
  engine.setEnabled(true); assert.equal(engine.input.mode, 'unavailable');
  const authorization = tracker.setLinuxEnabled(true);
  const child = await connect('global'); await authorization; assert.equal(engine.input.mode, 'global');
  assert.equal(engine.enabled, false, 'autorizar entrada não retoma ações armadas antes da autorização');
  engine.setEnabled(true);
  assert.equal(engine.tracking.enabled, false);
  child.frame({ type: 'key', code: 30, down: true, modifiers: 0 }); await tick(); assert.equal(calls.length, 1);
  child.frame({ type: 'reset', held: [30] });
  child.frame({ type: 'key', code: 30, down: false, modifiers: 0 }); await tick(); assert.equal(calls.length, 1, 'reset cancela release do gesto anterior');
  tracker.set(true); assert.equal(engine.tracking.mode, 'global'); tracker.set(false); assert.equal(engine.input.mode, 'global');
  child.frame({ type: 'ended', reason: 'session-suspended' });
  assert.equal(engine.enabled, false); assert.equal(engine.input.mode, 'unavailable');
  assert.equal(engine.state().linuxInput.status, 'session-suspended');
  assert.equal(engine.needsInput(), true, 'controle armado não autoriza reconexão silenciosa');
});
