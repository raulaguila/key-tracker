const { test } = require('node:test');
const assert = require('node:assert/strict');
test('recuperação distingue autorização, instalação, sessão e dispositivo sem interpretar mensagens', async () => {
  const { inputRecovery } = await import('../app/renderer/input-recovery.mjs');
  const state = { platform: 'linux', input: { mode: 'unavailable' }, linuxInput: { supported: true, enabled: false } };
  for (const status of ['disabled', 'denied', 'session-suspended', 'delayed', 'unavailable', 'busy']) assert.equal(inputRecovery({ ...state, linuxInput: { ...state.linuxInput, status } }).kind, 'linux');
  for (const status of ['not-installed', 'runtime-missing', 'version-mismatch']) assert.equal(inputRecovery({ ...state, linuxInput: { ...state.linuxInput, status } }).kind, 'install');
  for (const status of ['missing', 'waiting']) assert.equal(inputRecovery({ ...state, inputDevices: { status } }).kind, 'device');
  assert.equal(inputRecovery({ ...state, linuxInput: { supported: true, status: 'authorizing' } }).kind, 'pending');
  assert.equal(inputRecovery({ platform: 'darwin', input: { mode: 'unavailable', message: 'PRIVATE' } }).kind, 'mac');
  assert.equal(inputRecovery({ platform: 'win32', input: { mode: 'unavailable' } }).kind, 'retry');
  assert.equal(inputRecovery({ input: { mode: 'global' } }), null);
  assert.equal(inputRecovery({ input: { mode: 'off' } }), null);
  assert.doesNotMatch(JSON.stringify(inputRecovery({ ...state, inputDevices: { status: 'missing', message: 'PRIVATE' } })), /PRIVATE/);
});
