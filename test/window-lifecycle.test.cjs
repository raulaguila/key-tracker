const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { WindowLifecycle } = require('../app/window-lifecycle.cjs');

function fixture(tray = false) {
  const calls = [];
  const window = new EventEmitter();
  Object.assign(window, {
    isDestroyed: () => false, isMinimized: () => false,
    show: () => calls.push('show'), focus: () => calls.push('focus'),
    hide: () => calls.push('hide'), close: () => {
      const event = { preventDefault: () => calls.push('prevent') };
      window.emit('close', event); calls.push('close');
    }
  });
  const lifecycle = new WindowLifecycle({ window, shouldHide: typeof tray === 'function' ? tray : () => tray,
    requestConfirmation: request => calls.push(request),
    beforeHide: () => calls.push('resume'), quit: () => calls.push('quit') });
  return { lifecycle, window, calls };
}

test('fechamento espera confirmação e cancelar preserva janela', async () => {
  const { lifecycle, window, calls } = fixture();
  window.close();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls.includes('prevent'));
  assert.deepEqual(lifecycle.pending, { toTray: false });
  lifecycle.cancel(); await lifecycle.confirm();
  assert.equal(lifecycle.allowClose, false);
  window.close(); await new Promise(resolve => setImmediate(resolve)); await lifecycle.confirm();
  assert.equal(lifecycle.allowClose, true);
  assert.equal(calls.filter(value => value === 'prevent').length, 2);
});

test('bandeja só oculta após confirmação e retoma edição; sair sempre fecha', async () => {
  const { lifecycle, window, calls } = fixture(true);
  window.close();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!calls.includes('hide'));
  await lifecycle.confirm();
  assert.deepEqual(calls.slice(-2), ['resume', 'hide']);
  assert.equal(lifecycle.allowClose, false);
  await lifecycle.request(true); await lifecycle.confirm();
  assert.equal(lifecycle.allowClose, true);
  assert.equal(calls.at(-1), 'close');
});

test('solicitação repetida não duplica confirmação; falha do renderer libera saída', async () => {
  const { lifecycle, calls } = fixture();
  await lifecycle.request(); await lifecycle.request();
  assert.equal(calls.filter(value => typeof value === 'object').length, 1);
  lifecycle.forceQuit();
  assert.equal(lifecycle.allowClose, true);
  assert.equal(calls.at(-1), 'quit');
});

test('Sair tem prioridade sobre ocultação já aguardando confirmação', async () => {
  const { lifecycle, calls } = fixture(true);
  await lifecycle.request(); await lifecycle.request(true); await lifecycle.confirm();
  assert.equal(lifecycle.allowClose, true);
  assert.ok(!calls.includes('hide'));
  assert.equal(calls.at(-1), 'close');
});

test('revalida host após confirmação de rascunho e mantém janela ao perder bandeja', async () => {
  let available = true;
  let probes = 0;
  const { lifecycle, calls } = fixture(async () => { probes++; return available; });
  await lifecycle.request();
  assert.equal(lifecycle.pending.toTray, true);
  available = false;
  await lifecycle.confirm();
  assert.equal(probes, 2);
  assert.equal(lifecycle.allowClose, false);
  assert.ok(!calls.includes('hide'));
  assert.deepEqual(calls.slice(-2), ['show', 'focus']);
  assert.equal(lifecycle.pending, null);
});

test('cancelar ou sair durante verificação assíncrona não causa ocultação atrasada', async () => {
  let release;
  const { lifecycle, calls } = fixture(() => new Promise(resolve => { release = resolve; }));
  const checking = lifecycle.request();
  await lifecycle.confirm(); // A confirmação ainda não foi apresentada.
  assert.equal(lifecycle.allowClose, false);
  lifecycle.cancel(); release(true); await checking;
  assert.equal(calls.filter(value => typeof value === 'object').length, 0);
  const another = lifecycle.request();
  await lifecycle.request(true);
  release(true); await another;
  assert.equal(lifecycle.pending.toTray, false);
  await lifecycle.confirm();
  assert.equal(lifecycle.allowClose, true);
  assert.ok(!calls.includes('hide'));
});
