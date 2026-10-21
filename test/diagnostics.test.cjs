const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDiagnostics } = require('../app/diagnostics.cjs');

test('diagnóstico inclui somente versões, capacidades, contagens e tempos permitidos', () => {
  const privateText = 'PRIVATE_SENTINEL';
  const state = {
    config: { settings: { pauseShortcut: privateText }, layers: [{ name: privateText, applications: [privateText], bindings: [
      { name: privateText, key: privateText, enabled: false, action: { url: privateText, headers: { Authorization: privateText }, body: privateText } },
      { enabled: true }
    ] }] },
    paths: { data: privateText }, input: { mode: 'global', message: privateText }, tracking: { mode: 'global', keys: [privateText] },
    application: { status: 'ready', current: { name: privateText, path: privateText } },
    desktop: { trayAvailable: true }, storage: { encryptionAvailable: true, backupAvailable: true, protection: 'encrypted', message: privateText },
    running: [{ bindingId: privateText, name: privateText, key: privateText }], shortcuts: { registered: [privateText], failed: [{ message: privateText }] },
    events: [
      { kind: 'action', status: 'success', durationMs: 12, key: privateText, message: privateText },
      { kind: 'action', status: 'error', durationMs: 20, steps: [{ message: privateText }] },
      { kind: 'action', status: 'cancelled', durationMs: 8 }, { kind: 'system', status: 'error', durationMs: 9000, message: privateText }
    ]
  };
  const value = createDiagnostics({ state, versions: { app: '1.0.0', electron: '38.2.0', node: '22.20.0', chrome: '140.0.7339.207', extra: privateText }, platform: 'darwin', arch: 'x64' });
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE_SENTINEL|Authorization|bindings":\[|steps|message|key"|url|paths/);
  assert.deepEqual(value.versions, { app: '1.0.0', electron: '38.2.0', node: '22.20.0', chrome: '140.0.7339.207' });
  assert.deepEqual(value.host, { platform: 'darwin', arch: 'x64' });
  assert.deepEqual(value.counts, { layers: 1, bindings: 2, disabledBindings: 1, running: 1, registeredShortcuts: 1, failedShortcuts: 1, events: 4, actionSuccesses: 1, actionErrors: 1, actionCancelled: 1 });
  assert.deepEqual(value.timingMs, { samples: 3, total: 40, max: 20 });
  assert.ok(Object.values(value.capabilities).every(value => value === true || value === 'encrypted'));
  assert.ok(Number.isFinite(Date.parse(value.generatedAt)));
});

test('diagnóstico rejeita strings livres e números inválidos em campos permitidos', () => {
  const value = createDiagnostics({ state: { storage: { protection: '/home/secret' }, events: [
    { kind: 'action', durationMs: Infinity }, { kind: 'action', durationMs: -1 }, { kind: 'action', durationMs: 'secret' }
  ] }, versions: { app: '/home/secret', node: '22.0.0-private-person', electron: { secret: true } }, platform: 'secret', arch: 'secret' });
  assert.doesNotMatch(JSON.stringify(value), /secret|private-person/);
  assert.deepEqual(value.versions, { app: null, electron: null, node: null, chrome: null });
  assert.deepEqual(value.host, { platform: 'unknown', arch: 'unknown' });
  assert.deepEqual(value.timingMs, { samples: 0, total: 0, max: 0 });
  assert.equal(createDiagnostics().counts.bindings, 0);
});
