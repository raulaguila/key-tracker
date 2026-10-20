const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Tracker } = require('../app/tracking.cjs');

function fixture(session = 'x11', platform = 'linux') {
  const engine = new EventEmitter();
  Object.assign(engine, { session, platform, publish: () => engine.tracking });
  const worker = new EventEmitter();
  worker.postMessage = () => {};
  worker.kill = () => {};
  return { engine, worker, tracker: new Tracker({ engine, fork: () => worker }) };
}

test('Wayland usa rastreio local explícito sem iniciar hook nativo', () => {
  const { tracker } = fixture('wayland');
  tracker.fork = () => { throw new Error('Não deve iniciar'); };
  assert.equal(tracker.set(true).mode, 'local');
  assert.match(tracker.engine.tracking.message, /Wayland/);
  assert.equal(tracker.set(false).mode, 'off');
});

test('macOS sem permissão oferece modo local', () => {
  const { tracker } = fixture('native', 'darwin');
  tracker.accessibility = () => false;
  assert.equal(tracker.set(true).mode, 'local');
});

test('hook publica down/up, termina sem derrubar app e ignora mensagens após desligar', () => {
  const { tracker, worker, engine } = fixture();
  const keys = [];
  engine.on('key', event => keys.push(event));
  assert.equal(tracker.set(true).mode, 'starting');
  worker.emit('message', { type: 'ready' });
  assert.equal(engine.tracking.mode, 'global');
  worker.emit('message', { type: 'key', code: 'KeyA', key: 'A', direction: 'down' });
  worker.emit('message', { type: 'key', code: 'KeyA', key: 'A', direction: 'up' });
  assert.deepEqual(keys.map(key => key.direction), ['down', 'up']);
  worker.emit('exit', 1);
  assert.equal(engine.tracking.mode, 'local');
  tracker.set(false);
  worker.emit('message', { type: 'key', code: 'KeyB' });
  assert.equal(keys.length, 2);
});
