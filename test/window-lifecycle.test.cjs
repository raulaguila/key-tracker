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
  const lifecycle = new WindowLifecycle({ window, shouldHide: () => tray,
    requestConfirmation: request => calls.push(request),
    beforeHide: () => calls.push('resume'), quit: () => calls.push('quit') });
  return { lifecycle, window, calls };
}

test('fechamento espera confirmação e cancelar preserva janela', () => {
  const { lifecycle, window, calls } = fixture();
  window.close();
  assert.ok(calls.includes('prevent'));
  assert.deepEqual(lifecycle.pending, { toTray: false });
  lifecycle.cancel(); lifecycle.confirm();
  assert.equal(lifecycle.allowClose, false);
  window.close(); lifecycle.confirm();
  assert.equal(lifecycle.allowClose, true);
  assert.equal(calls.filter(value => value === 'prevent').length, 2);
});

test('bandeja só oculta após confirmação e retoma edição; sair sempre fecha', () => {
  const { lifecycle, window, calls } = fixture(true);
  window.close();
  assert.ok(!calls.includes('hide'));
  lifecycle.confirm();
  assert.deepEqual(calls.slice(-2), ['resume', 'hide']);
  assert.equal(lifecycle.allowClose, false);
  lifecycle.request(true); lifecycle.confirm();
  assert.equal(lifecycle.allowClose, true);
  assert.equal(calls.at(-1), 'close');
});

test('solicitação repetida não duplica confirmação; falha do renderer libera saída', () => {
  const { lifecycle, calls } = fixture();
  lifecycle.request(); lifecycle.request();
  assert.equal(calls.filter(value => typeof value === 'object').length, 1);
  lifecycle.forceQuit();
  assert.equal(lifecycle.allowClose, true);
  assert.equal(calls.at(-1), 'quit');
});

test('Sair tem prioridade sobre ocultação já aguardando confirmação', () => {
  const { lifecycle, calls } = fixture(true);
  lifecycle.request(); lifecycle.request(true); lifecycle.confirm();
  assert.equal(lifecycle.allowClose, true);
  assert.ok(!calls.includes('hide'));
  assert.equal(calls.at(-1), 'close');
});
