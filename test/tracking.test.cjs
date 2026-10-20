const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Tracker } = require('../app/tracking.cjs');

function fixture({ session = 'x11', platform = 'linux', demand = false, accessibility, startupMs } = {}) {
  const engine = new EventEmitter();
  const workers = [];
  const inputs = [];
  let resets = 0;
  let publishes = 0;
  Object.assign(engine, { session, platform, demand, enabled: false, editing: false,
    tracking: { enabled: false, mode: 'off', message: '' }, input: { mode: 'off', message: '' },
    state: () => ({ tracking: engine.tracking, input: engine.input, enabled: engine.enabled, editing: engine.editing }),
    publish: () => { publishes++; engine.emit('state', engine.state()); return engine.state(); },
    needsInput: () => engine.demand, handleInput: event => inputs.push(event), resetInput: () => { resets++; },
    updateInput: input => { if (JSON.stringify(input) === JSON.stringify(engine.input)) return engine.state(); engine.input = input; if (input.mode !== 'global') engine.resetInput(); return engine.publish(); }
  });
  const tracker = new Tracker({ engine, accessibility, startupMs, fork: () => {
    const worker = new EventEmitter();
    worker.messages = [];
    worker.killed = 0;
    worker.postMessage = value => worker.messages.push(value);
    worker.kill = () => { worker.killed++; worker.emit('exit', 0); };
    workers.push(worker);
    return worker;
  } });
  return { engine, workers, inputs, tracker, resets: () => resets, publishes: () => publishes,
    demand: value => { engine.demand = value; engine.publish(); } };
}

const ready = worker => worker.emit('message', { type: 'ready' });
const key = (worker, direction, extra = {}) => worker.emit('message', { type: 'key', code: 'KeyA', key: 'A', direction, ...extra });

test('inicia sem hook e visualização não ativa os gatilhos das ações', t => {
  const { tracker, engine, workers } = fixture();
  t.after(() => tracker.dispose());
  assert.equal(workers.length, 0);
  assert.equal(engine.input.mode, 'off');
  assert.equal(tracker.set(true).tracking.mode, 'starting');
  assert.equal(workers.length, 1);
  ready(workers[0]);
  assert.equal(engine.tracking.mode, 'global');
  assert.equal(engine.input.mode, 'off');
  assert.equal(engine.enabled, false);
});

test('Wayland mantém rastreio local explícito e ações hold/release indisponíveis', t => {
  const { tracker, engine, workers, demand, inputs } = fixture({ session: 'wayland' });
  t.after(() => tracker.dispose());
  assert.equal(tracker.set(true).tracking.mode, 'local');
  assert.match(engine.tracking.message, /Wayland/);
  demand(true);
  assert.equal(engine.input.mode, 'unavailable');
  assert.match(engine.input.message, /Wayland/);
  assert.equal(workers.length, 0);
  assert.equal(inputs.length, 0);
  tracker.set(false);
  assert.equal(engine.tracking.mode, 'off');
  assert.equal(engine.input.mode, 'unavailable');
});

test('macOS sem permissão oferece só visual local e não finge entrada para ações', t => {
  const { tracker, engine, workers, demand } = fixture({ session: 'native', platform: 'darwin', accessibility: () => false });
  t.after(() => tracker.dispose());
  assert.equal(tracker.set(true).tracking.mode, 'local');
  demand(true);
  assert.equal(engine.input.mode, 'unavailable');
  assert.match(engine.input.message, /Acessibilidade/);
  assert.equal(workers.length, 0);
});

test('um worker atende entrada e visualização; desligar rastreio preserva ações', t => {
  const { tracker, engine, workers, inputs } = fixture({ demand: true });
  t.after(() => tracker.dispose());
  const visual = [];
  engine.on('key', event => visual.push(event));
  assert.equal(engine.input.mode, 'starting');
  assert.equal(engine.tracking.mode, 'off');
  ready(workers[0]);
  assert.equal(engine.input.mode, 'global');
  key(workers[0], 'down', { ctrlKey: true, shiftKey: true });
  assert.equal(inputs.length, 1);
  assert.equal(visual.length, 0);
  assert.deepEqual(inputs[0], { code: 'KeyA', key: 'A', direction: 'down', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, source: 'global' });
  tracker.set(true);
  assert.equal(workers.length, 1);
  assert.equal(engine.tracking.mode, 'global');
  key(workers[0], 'up');
  assert.equal(visual.length, 1);
  tracker.set(false);
  assert.equal(workers[0].messages.length, 0);
  assert.equal(engine.input.mode, 'global');
  key(workers[0], 'down'); key(workers[0], 'up');
  assert.equal(inputs.length, 4);
  assert.equal(visual.length, 1);
});

test('pausa e edição continuam observando solturas quando existe demanda armada', t => {
  const { tracker, engine, workers, inputs } = fixture({ demand: true });
  t.after(() => tracker.dispose());
  ready(workers[0]);
  engine.enabled = false; engine.editing = true; engine.publish();
  key(workers[0], 'down'); key(workers[0], 'up');
  assert.equal(inputs.length, 2);
  assert.equal(workers.length, 1);
  assert.equal(workers[0].messages.length, 0);
  assert.equal(engine.input.mode, 'global');
});

test('retirar demanda de ações preserva worker visual e encerra ao desligar ambos', t => {
  const { tracker, engine, workers, demand, inputs } = fixture({ demand: true });
  t.after(() => tracker.dispose());
  tracker.set(true); ready(workers[0]);
  demand(false);
  assert.equal(engine.input.mode, 'off');
  assert.equal(engine.tracking.mode, 'global');
  assert.equal(workers[0].messages.length, 0);
  tracker.set(false);
  assert.deepEqual(workers[0].messages, ['stop']);
  assert.equal(engine.tracking.mode, 'off');
  key(workers[0], 'down');
  assert.equal(inputs.length, 0);
});

test('crash cancela gestos, informa erro e não reinicia em loop de publicações', t => {
  const { tracker, engine, workers, resets, demand } = fixture({ demand: true });
  t.after(() => tracker.dispose());
  tracker.set(true); ready(workers[0]);
  const before = resets();
  workers[0].emit('exit', 1);
  assert.ok(resets() > before);
  assert.equal(engine.input.mode, 'unavailable');
  assert.equal(engine.tracking.mode, 'local');
  for (let i = 0; i < 10; i++) engine.publish();
  assert.equal(workers.length, 1);
  tracker.set(true);
  assert.equal(workers.length, 2);
  ready(workers[1]);
  assert.equal(engine.input.mode, 'global');
  demand(false); demand(true);
  assert.equal(workers.length, 2);
});

test('timeout informa indisponibilidade e retry exige uma nova solicitação explícita', async t => {
  const { tracker, engine, workers, demand } = fixture({ demand: true, startupMs: 10 });
  t.after(() => tracker.dispose());
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(engine.input.mode, 'unavailable');
  assert.match(engine.input.message, /não respondeu/);
  assert.equal(engine.tracking.mode, 'off');
  engine.publish();
  assert.equal(workers.length, 1);
  demand(false); demand(true);
  assert.equal(workers.length, 2);
});

test('reativar ações permite tentar novamente com demanda armada persistente', t => {
  const { tracker, engine, workers } = fixture({ demand: true });
  t.after(() => tracker.dispose());
  engine.enabled = true; engine.publish(); ready(workers[0]);
  workers[0].emit('exit', 1);
  assert.equal(engine.input.mode, 'unavailable');
  engine.enabled = false; engine.publish();
  assert.equal(workers.length, 1);
  engine.enabled = true; engine.publish();
  assert.equal(workers.length, 2);
  ready(workers[1]);
  assert.equal(engine.input.mode, 'global');
});

test('publicações sem mudança não pedem snapshots completos adicionais', t => {
  const { tracker, engine } = fixture();
  t.after(() => tracker.dispose());
  const original = engine.state;
  let reads = 0;
  engine.state = () => { reads++; return original(); };
  tracker.configure();
  assert.equal(reads, 0);
  for (let i = 0; i < 10; i++) engine.emit('state', {});
  assert.equal(reads, 0, 'atualizações já publicadas não exigem outra cópia do estado');
});

test('dispose remove assinatura, mata workers e não religa com estados posteriores', () => {
  const { tracker, engine, workers } = fixture({ demand: true });
  ready(workers[0]);
  tracker.dispose();
  assert.equal(engine.listenerCount('state'), 0);
  assert.equal(engine.input.mode, 'off');
  assert.equal(engine.tracking.mode, 'off');
  assert.equal(workers[0].killed, 1);
  assert.equal(tracker.retiring.size, 0);
  engine.publish(); tracker.set(true); tracker.stop();
  assert.equal(workers.length, 1);
});
