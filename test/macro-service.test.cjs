const test = require('node:test');
const assert = require('node:assert/strict');
const { MacroService, MAX_STEPS } = require('../app/macro-service.cjs');
const { macroError } = require('../app/macro-input/native.cjs');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function harness(extra = {}, factoryOptions = {}) {
  const calls = [], states = [], drivers = [];
  let focused = false;
  const service = new MacroService({ platform: 'linux', session: 'x11', recordPrepareMs: 0, settleMs: 1,
    clipboard: { writeText: value => calls.push(['text', value]) }, onChange: value => states.push(value), isAppFocused: () => focused,
    driverFactory(options) {
      const driver = { options, authorize: async () => ({ playback: true, recording: true }), released: async () => true,
        click: async value => calls.push(['click', value]), key: async value => calls.push(['key', value]),
        startRecording: async () => calls.push(['record-start']), stopRecording: async () => calls.push(['record-stop']), dispose: async () => calls.push(['dispose']), ...factoryOptions };
      drivers.push(driver); return driver;
    }, ...extra });
  return { service, calls, states, drivers, focus: value => { focused = value; } };
}
const flow = steps => ({ type: 'macro', startDelayMs: 0, steps });

test('macro requires authorization and reports real capabilities without changing an action', async () => {
  const { service, calls } = harness();
  assert.equal(service.state().capabilities.playback, false);
  await assert.rejects(service.run(flow([{ kind: 'key', key: 'A' }])), { code: 'MACRO_PERMISSION' });
  assert.deepEqual(calls, []);
  await service.authorize(); assert.equal(service.state().capabilities.recording, true);
  await service.dispose();
});

test('macro runs clicks, Unicode text paste, key chords and waits in order with private progress', async () => {
  const { service, calls } = harness(); const items = [], progress = [];
  await service.authorize();
  const result = await service.run(flow([{ kind: 'click', x: 12, y: 23, button: 'left', clicks: 2 }, { kind: 'text', text: 'Olá 🔐 senha' }, { kind: 'key', key: 'Control+Enter' }, { kind: 'wait', ms: 1 }]), { onStep: item => items.push(item), onProgress: item => progress.push(item) });
  assert.deepEqual(calls.slice(0, 4).map(item => item[0]), ['click', 'text', 'key', 'key']);
  assert.equal(calls[2][1], 'Control+V');
  assert.equal(result.steps, 4); assert.equal(service.state().playing, false);
  assert.deepEqual(items.map(item => item.index), [1, 2, 3, 4]);
  assert.ok(items.every(item => Number.isFinite(item.durationMs)));
  assert.ok(progress.every(item => item.stepIndex >= 1 && item.stepCount === 4));
  assert.ok(!JSON.stringify({ result, items, state: service.state() }).includes('senha'));
  await service.dispose();
});

test('macOS text inserts with Command+V', async () => {
  const { service, calls } = harness({ platform: 'darwin' }); await service.authorize();
  await service.run(flow([{ kind: 'text', text: 'á' }]));
  assert.ok(calls.some(([kind, value]) => kind === 'key' && value === 'Command+V'));
  await service.dispose();
});

test('macro refuses to inject into the editor and reports the failed step', async () => {
  const { service, calls, focus } = harness(); await service.authorize(); focus(true); const steps = [];
  await assert.rejects(service.run(flow([{ kind: 'click', x: 1, y: 1, button: 'left', clicks: 1 }]), { onStep: value => steps.push(value) }), { code: 'MACRO_FOCUSED' });
  assert.ok(!calls.some(([kind]) => kind === 'click'));
  assert.equal(steps[0].status, 'error'); assert.equal(steps[0].index, 1);
  await service.dispose();
});

test('cancelling during a wait prevents remaining effects and drains the native driver', async () => {
  let releaseDispose;
  const drained = new Promise(resolve => { releaseDispose = resolve; });
  const { service, calls } = harness({}, { dispose: () => drained }); await service.authorize();
  const controller = new AbortController(); const steps = [];
  const running = service.run(flow([{ kind: 'wait', ms: 60000 }, { kind: 'key', key: 'A' }]), { signal: controller.signal, onStep: item => steps.push(item) });
  const rejected = assert.rejects(running, { code: 'EXECUTION_CANCELLED' });
  await pause(1); controller.abort(); await pause(5);
  assert.equal(service.state().playing, true, 'keep engine guard until asynchronous native cleanup finishes');
  releaseDispose(); await rejected;
  assert.equal(service.state().playing, false); assert.ok(!calls.some(([kind]) => kind === 'key'));
  assert.equal(steps[0].status, 'cancelled'); await service.dispose();
});

test('recording is explicit, ignores Dobra clicks, retains delays and restores draft window', async () => {
  let clock = 1000; const windows = [];
  const window = { minimize: () => windows.push('minimize'), isMinimized: () => true, restore: () => windows.push('restore'), show: () => windows.push('show'), focus: () => windows.push('focus') };
  const { service, drivers, focus } = harness({ now: () => clock, getWindow: () => window }); await service.authorize(); await service.startRecording();
  const input = drivers[0].options.onInput;
  focus(true); input({ kind: 'key', key: 'X' }); focus(false); clock += 80;
  input({ kind: 'click', x: 14, y: 26, button: 'right', clicks: 1 }); clock += 40; input({ kind: 'key', key: 'Shift+A' });
  const result = await service.stopRecording();
  assert.deepEqual(result.steps, [{ kind: 'click', x: 14, y: 26, button: 'right', clicks: 1, delayBeforeMs: 80 }, { kind: 'key', key: 'Shift+A', delayBeforeMs: 40 }]);
  assert.deepEqual(windows, ['minimize', 'restore', 'show', 'focus']);
  assert.equal((await service.stopRecording()).steps.length, 0, 'retrieval consumes the buffer');
  await service.dispose();
});

test('shortcut auto-stop retains captured steps until the editor retrieves them', async () => {
  const { service, drivers } = harness(); await service.authorize(); await service.startRecording();
  drivers[0].options.onInput({ kind: 'key', key: 'A' }); drivers[0].options.onStop({ key: service.state().stopShortcut, generation: service.stopGeneration }); await pause(5);
  assert.equal(service.state().recording, false); assert.equal(service.state().count, 1);
  const result = await service.stopRecording(); assert.equal(result.reason, 'shortcut'); assert.equal(result.steps[0].key, 'A');
  assert.ok(!JSON.stringify(service.state()).includes('"key"')); await service.dispose();
});

test('recording stops at 200 steps, never persists or silently drops an overflow recording', async () => {
  const { service, drivers } = harness(); await service.authorize(); await service.startRecording();
  for (let index = 0; index < 230; index++) drivers[0].options.onInput({ kind: 'key', key: 'A' });
  const result = await service.stopRecording();
  assert.equal(result.reason, 'step-limit'); assert.equal(result.steps.length, MAX_STEPS);
  await service.dispose();
});

test('a long recorded gap at the step limit never moves the next click earlier', async () => {
  let clock = 1000;
  const { service, drivers } = harness({ now: () => clock });
  await service.authorize(); await service.startRecording();
  const input = drivers.at(-1).options.onInput;
  for (let index = 0; index < MAX_STEPS - 1; index++) input({ kind: 'key', key: 'A' });
  clock += 120001;
  input({ kind: 'click', x: 10, y: 20, button: 'left', clicks: 1 });
  const result = await service.stopRecording();
  assert.equal(result.reason, 'step-limit');
  assert.equal(result.steps.length, MAX_STEPS - 1);
  assert.equal(result.steps.some(step => step.kind === 'click'), false);
  await service.dispose();
});

test('recording time limit preserves a reviewable result and cancel discards only recording', async () => {
  const { service, drivers } = harness({ recordingMs: 5 }); await service.authorize(); await service.startRecording();
  drivers[0].options.onInput({ kind: 'key', key: 'A' }); await pause(15);
  const result = await service.stopRecording(); assert.equal(result.reason, 'time-limit'); assert.equal(result.steps.length, 1);
  await service.startRecording(); drivers.at(-1).options.onInput({ kind: 'key', key: 'B' });
  assert.deepEqual(await service.stopRecording({ cancel: true }), { steps: [], reason: 'cancelled' });
  await service.dispose();
});

test('recording and playback are mutually exclusive', async () => {
  const { service } = harness(); await service.authorize(); await service.startRecording();
  await assert.rejects(service.run(flow([{ kind: 'key', key: 'A' }])), { code: 'MACRO_BUSY' });
  await assert.rejects(service.startRecording(), { code: 'MACRO_BUSY' });
  await service.stopRecording();
  const running = service.run(flow([{ kind: 'wait', ms: 60000 }])); const rejection = assert.rejects(running, { code: 'EXECUTION_CANCELLED' });
  await assert.rejects(service.startRecording(), { code: 'MACRO_BUSY' }); await service.cancelPlayback(); await rejection;
  await service.dispose();
});

test('suspend during authorization awaits cleanup and prevents late ready state', async () => {
  let resolveAuthorization; const authorization = new Promise(resolve => { resolveAuthorization = resolve; });
  const { service, calls } = harness({}, { authorize: () => authorization });
  const pending = service.authorize(); const rejection = assert.rejects(pending, { code: 'MACRO_STOPPED' });
  let done = false; const suspended = service.suspend().then(() => { done = true; }); await pause(1);
  assert.equal(done, false); resolveAuthorization({ playback: true, recording: true }); await suspended; await rejection;
  assert.equal(service.state().capabilities.playback, false); assert.ok(calls.some(([kind]) => kind === 'dispose'));
  await service.dispose();
});

test('suspend during recording preparation prevents late minimize, hook start and restore', async () => {
  const windows = []; const { service, calls } = harness({ recordPrepareMs: 30, getWindow: () => ({ minimize: () => windows.push('minimize'), show: () => windows.push('show'), focus: () => windows.push('focus') }) });
  await service.authorize(); const starting = service.startRecording(); await pause(2);
  const before = windows.length; await service.suspend(); await starting;
  assert.equal(windows.length, before + 2, 'only restore once; preparation cannot minimize or record later');
  assert.ok(!calls.some(([kind]) => kind === 'record-start')); assert.equal(service.state().recording, false);
  await service.dispose();
});

test('denied authorization can be retried without losing editor data', async () => {
  let denied = true; const { service } = harness({}, { authorize: async () => { if (denied) throw macroError('MACRO_PERMISSION'); return { playback: true, recording: true }; } });
  await assert.rejects(service.authorize(), { code: 'MACRO_PERMISSION' }); assert.equal(service.state().status, 'denied');
  denied = false; await service.authorize(); assert.equal(service.state().status, 'ready'); await service.dispose();
});

test('Wayland keeps capability warning and never claims passive recording or stop shortcut', async () => {
  const { service, drivers } = harness({ session: 'wayland' }, { authorize: async () => ({ playback: true, recording: false, message: 'Gravação passiva indisponível neste compositor.' }) });
  await service.authorize(); assert.equal(service.state().stopShortcut, ''); assert.equal(service.state().capabilities.recording, false);
  assert.match(service.state().message, /Gravação passiva/);
  await assert.rejects(service.startRecording(), { code: 'MACRO_UNAVAILABLE' });
  await service.run(flow([{ kind: 'key', key: 'A' }])); await service.run(flow([{ kind: 'key', key: 'B' }]));
  assert.equal(drivers.length, 1, 'reuse authorized portal without opening another dialog from a shortcut');
  await service.suspend(); assert.equal(service.state().capabilities.playback, false);
  await assert.rejects(service.run(flow([{ kind: 'key', key: 'A' }])), { code: 'MACRO_PERMISSION' }); await service.dispose();
});

test('native interruption fails playback instead of reporting a user cancellation', async () => {
  const { service, drivers } = harness(); await service.authorize();
  const running = service.run(flow([{ kind: 'wait', ms: 60000 }])); const rejection = assert.rejects(running, { code: 'MACRO_UNAVAILABLE' });
  await pause(1); drivers[0].options.onError(macroError()); await rejection;
  assert.equal(service.state().status, 'unavailable'); assert.equal(service.state().capabilities.playback, false); await service.dispose();
});

test('stop shortcut avoids configuration controls, triggers and keys replayed by the flow', async () => {
  const { service, drivers } = harness({ getReservedShortcuts: () => ['Ctrl+Shift+F10', 'Control+Shift+F9'] });
  await service.authorize(); assert.equal(service.state().stopShortcut, 'Control+Shift+F11');
  await service.run(flow([{ kind: 'key', key: 'Control+Shift+F11' }]));
  assert.equal(service.state().stopShortcut, 'Control+Shift+F1');
  assert.equal(drivers[0].options.stopShortcut, 'Control+Shift+F11');
  await service.dispose();
});

test('screen geometry invalidation requires explicit reauthorization and retains the notice', async () => {
  const { service } = harness(); await service.authorize();
  await service.suspend({ reauthorize: true, message: 'As telas mudaram. Revise as posições.' });
  assert.equal(service.state().status, 'unauthorized'); assert.match(service.state().message, /telas mudaram/);
  assert.equal(service.state().capabilities.playback, false);
  await assert.rejects(service.run(flow([{ kind: 'key', key: 'A' }])), { code: 'MACRO_PERMISSION' });
  await service.dispose();
});

test('no new authorization, recording or playback can start while native cleanup is pending', async () => {
  let release; const drained = new Promise(resolve => { release = resolve; });
  const { service } = harness({}, { dispose: () => drained }); await service.authorize();
  const suspended = service.suspend({ reauthorize: true });
  assert.equal(service.state().capabilities.playback, false, 'revocation is immediate, before drain finishes');
  await assert.rejects(service.authorize(), { code: 'MACRO_BUSY' });
  await assert.rejects(service.startRecording(), { code: 'MACRO_BUSY' });
  await assert.rejects(service.run(flow([{ kind: 'key', key: 'A' }])), { code: 'MACRO_BUSY' });
  release(); await suspended; await service.dispose();
});
