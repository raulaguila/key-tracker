// Audit controller: real Electron/native APIs, temporary profiles, no app mocks.
// Linux: xvfb-run -a node scripts/platform-audit.cjs
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { validateConfig, encodeConfig } = require('../app/config.cjs');
const { readConfigFile } = require('../app/storage.cjs');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: values.length, median: sorted[Math.ceil(sorted.length / 2) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1), mean: values.reduce((a, b) => a + b, 0) / values.length };
};
async function port() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
async function cdp(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const result = JSON.parse(event.data);
    const task = pending.get(result.id);
    if (!task) return;
    pending.delete(result.id); clearTimeout(task.timer);
    result.error ? task.reject(new Error(result.error.message)) : task.resolve(result.result);
  });
  ws.addEventListener('close', () => { for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('CDP disconnected')); } pending.clear(); });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('CDP timeout: ' + method)); }, 20000);
    pending.set(requestId, { resolve, reject, timer }); ws.send(JSON.stringify({ id: requestId, method, params }));
  });
  return { call, close: () => ws.close(), evaluate: async source => {
    const result = await call('Runtime.evaluate', { expression: '(async()=>{' + source + '})()', awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  } };
}
async function launch(profile) {
  const debugPort = await port();
  const flags = ['--inspect=127.0.0.1:0', '--disable-gpu', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + debugPort];
  if (process.platform === 'linux') flags.push('--ozone-platform=x11');
  if (process.env.KEY_TRACKER_UI_NO_SANDBOX === '1') flags.push('--no-sandbox');
  const started = performance.now();
  const child = spawn(require('electron'), [root, ...flags], { cwd: root, env: { ...process.env, KEYBOARD_TRACKER_DATA_DIR: profile, XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: '', DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + path.join(profile, 'no-desktop-bus') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let tail = '', inspector, spawnError, page, native;
  child.stdout.resume();
  child.once('error', error => { spawnError = error; });
  child.stderr.on('data', data => { const text = tail + data; inspector ??= text.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1]; tail = text.slice(-5000); });
  const waitForExit = milliseconds => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return Promise.resolve(true);
    return new Promise(resolve => {
      const exited = () => { clearTimeout(timer); resolve(true); };
      const timer = setTimeout(() => { child.off('exit', exited); resolve(false); }, milliseconds);
      child.once('exit', exited);
    });
  };
  const stop = async () => {
    const started = performance.now();
    if (native && child.exitCode === null && child.signalCode === null) {
      await native.evaluate('setTimeout(()=>process.mainModule.require("electron").app.quit(),25);return true;').catch(() => {});
    }
    page?.close(); native?.close();
    const graceful = Boolean(native) && await waitForExit(3000) && child.exitCode === 0;
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      child.kill();
      if (!await waitForExit(1500)) { child.kill('SIGKILL'); await waitForExit(1000); }
    }
    return { graceful, elapsedMs: performance.now() - started, exitCode: child.exitCode, signal: child.signalCode };
  };
  try {
    for (let attempt = 0; attempt < 500; attempt++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error('Electron exited: ' + tail);
      try {
        const targets = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
        const target = targets.find(item => item.type === 'page' && item.url.includes('index.html'));
        if (target) { page = await cdp(target.webSocketDebuggerUrl); break; }
      } catch {}
      await delay(50);
    }
    if (!page) throw new Error('Renderer did not start: ' + tail);
    let ready = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await page.evaluate('return Boolean(document.querySelector("[data-focus=new-layer]"));')) { ready = true; break; }
      await delay(25);
    }
    if (!ready || !inspector) throw new Error('Initial UI or main inspector unavailable');
    const startupMs = performance.now() - started;
    native = await cdp(inspector);
    const state = await page.evaluate('return await window.keyboardTracker.getState();');
    const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    if (normalize(state.paths.data) !== normalize(profile)) throw new Error('Profile isolation failed');
    return { page, native, state, startupMs, stop };
  } catch (error) { await stop(); throw error; }
}
function largeFixture() {
  const bases = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', ...Array.from({ length: 24 }, (_, i) => 'F' + (i + 1))].filter(key => key !== 'F8');
  const keys = [...bases, ...bases.map(key => 'Control+' + key)].slice(0, 100);
  return validateConfig({ version: 1, settings: { layerShortcut: 'F8', pauseShortcut: 'CommandOrControl+Shift+F12', cooldownMs: 400 }, layers: Array.from({ length: 25 }, (_, i) => ({ id: 'L' + i, name: 'Camada ' + i, bindings: keys.map((key, j) => ({ id: 'B' + i + '-' + j, key, name: 'Ação ' + j, action: { type: 'log', message: 'x' } })) })) });
}
async function inspectPackage() {
  const asar = require('@electron/asar');
  const folders = await fs.readdir(path.join(root, 'dist'));
  let archive;
  for (const folder of folders) {
    const candidate = process.platform === 'darwin'
      ? path.join(root, 'dist', folder, 'Keyboard Tracker.app', 'Contents', 'Resources', 'app.asar')
      : path.join(root, 'dist', folder, 'resources', 'app.asar');
    try { await fs.access(candidate); archive = candidate; break; } catch {}
  }
  if (!archive) throw new Error('Run npm run pack before the platform audit');
  const matches = {};
  for (const file of ['app/main.cjs', 'app/preload.cjs', 'app/config.cjs', 'app/storage.cjs', 'app/engine.cjs', 'app/key-gestures.cjs', 'app/tracking.cjs', 'app/tracker-worker.cjs', 'app/actions.cjs', 'app/desktop-actions.cjs', 'app/safe-export.cjs', 'app/application-monitor.cjs', 'app/application-reader.cjs', 'app/native-process-scope.cjs', 'app/desktop-tray.cjs', 'app/window-lifecycle.cjs', 'app/renderer/app.js', 'app/renderer/action-editor.js', 'app/renderer/key-moments.js', 'app/renderer/binding-table.js', 'app/renderer/styles.css']) matches[file] = (await fs.readFile(path.join(root, file))).equals(asar.extractFile(archive, file.split('/').join(path.sep)));
  const files = asar.listPackage(archive);
  return { archive: path.relative(root, archive), sourceMatches: matches, nativeFiles: files.filter(file => /uiohook.*\.node$|get-windows.*(?:\.node|\/main)$/.test(file)), note: 'Package inspected; runtime below uses the same source in Electron development mode with an isolated profile.' };
}
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'keyboard-platform-audit-'));
  const result = { version: 1, date: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), environment: { platform: process.platform, arch: process.arch, release: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.availableParallelism(), ramGiB: os.totalmem() / 2 ** 30, node: process.version, electron: require('electron/package.json').version, ci: process.env.GITHUB_ACTIONS === 'true', gpu: 'disabled' }, notes: ['Runtime is real Electron loading production source, not the packaged executable.', 'CI machines differ; values are not a controlled OS-to-OS comparison.', 'Startup includes CDP connection and readiness checks; OS caches are not flushed.', 'Key registration is tested; physical-key delivery and user permissions are not certified.'], probes: {}, startupsMs: [], shutdowns: [] };
  let instance, originalClipboard;
  try {
    result.package = await inspectPackage();
    for (let i = 0; i < 3; i++) {
      instance = await launch(path.join(directory, 'profile-' + i));
      result.startupsMs.push(instance.startupMs);
      if (i < 2) { result.shutdowns.push(await instance.stop()); instance = null; }
    }
    result.startup = stats(result.startupsMs);
    const { page, native, state } = instance;
    await page.call('Runtime.enable');
    const original = state.config;
    originalClipboard = await native.evaluate('return process.mainModule.require("electron").clipboard.readText();');
    result.probes.initialPaused = !state.enabled && !state.tracking.enabled;
    result.probes.preload = await page.evaluate('return ["getState","saveConfig","previewBinding","runBinding","chooseActionTarget","exportHistory"].every(key=>typeof window.keyboardTracker[key]==="function");');
    const fixture = structuredClone(original);
    fixture.layers[0].bindings = [{ id: 'audit-copy', key: 'A', name: 'Copiar auditoria', action: { type: 'clipboard', text: 'keyboard-platform-audit-{{key}}' } }];
    await page.evaluate('await window.keyboardTracker.saveConfig(' + JSON.stringify(fixture) + ');');
    const configFile = JSON.parse(await fs.readFile(path.join(state.paths.data, 'config.json'), 'utf8'));
    result.probes.persistence = configFile.layers[0].bindings[0].action.type === 'clipboard';
    const run = async bindingId => page.evaluate('const api=window.keyboardTracker;const state=await api.getState();const layer=state.config.layers[0];const preview=await api.previewBinding(layer.id,' + JSON.stringify(bindingId) + ');const next=await api.runBinding(layer.id,' + JSON.stringify(bindingId) + ',preview.previewId);return next.events.find(e=>e.bindingId===' + JSON.stringify(bindingId) + ');');
    const copied = await run('audit-copy');
    result.probes.clipboard = { status: copied.status, ...(await native.evaluate('const value=await process.mainModule.require("electron").clipboard.readText();return {matched:value==="keyboard-platform-audit-A",length:value.length,expectedLength:25};')) };
    fixture.layers[0].bindings.push({ id: 'audit-sequence', key: 'D', name: 'Intervalo de auditoria', action: { type: 'sequence', stepDelayMs: 80, steps: [
      { type: 'clipboard', text: 'keyboard-platform-audit-first' },
      { type: 'clipboard', text: 'keyboard-platform-audit-last' }
    ] } });
    await page.evaluate('await window.keyboardTracker.saveConfig(' + JSON.stringify(fixture) + ');');
    const sequenceConfig = await readConfigFile(path.join(state.paths.data, 'config.json'));
    const sequencePreview = await page.evaluate('const api=window.keyboardTracker;const state=await api.getState();return await api.previewBinding(state.config.layers[0].id,"audit-sequence");');
    const sequenced = await run('audit-sequence');
    result.probes.sequenceDelay = {
      schemaPersisted: sequenceConfig.layers[0].bindings.find(binding => binding.id === 'audit-sequence').action.stepDelayMs === 80,
      previewed: sequencePreview.action.stepDelayMs === 80,
      status: sequenced.status, stepDelayMs: sequenced.stepDelayMs, durationMs: sequenced.durationMs,
      steps: sequenced.steps.map(step => ({ index: step.index, status: step.status })),
      finalClipboard: await native.evaluate('return (await process.mainModule.require("electron").clipboard.readText())==="keyboard-platform-audit-last";')
    };
    result.probes.sequenceDelay.passed = result.probes.sequenceDelay.schemaPersisted && result.probes.sequenceDelay.previewed && sequenced.status === 'success' && sequenced.stepDelayMs === 80 && sequenced.durationMs >= 70 && sequenced.steps.length === 2 && sequenced.steps.every(step => step.status === 'success') && result.probes.sequenceDelay.finalClipboard;
    fixture.layers[0].bindings.push({ id: 'audit-app', key: 'B', name: 'Aplicativo de auditoria', action: { type: 'open', kind: 'application', target: process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe') : '/usr/bin/true' } });
    fixture.layers[0].bindings.push({ id: 'audit-notification', key: 'C', name: 'Notificação de auditoria', action: { type: 'notification', title: 'Keyboard Tracker audit', message: 'Temporary CI integration probe' } });
    await page.evaluate('await window.keyboardTracker.saveConfig(' + JSON.stringify(fixture) + ');');
    const opened = await run('audit-app'); result.probes.applicationLaunch = { status: opened.status, message: opened.message };
    const notified = await run('audit-notification'); result.probes.notification = { status: notified.status, message: notified.message, note: 'A show event confirms native API acknowledgement, not that a person saw it.' };
    const activated = await page.evaluate('return await window.keyboardTracker.setEnabled(true);');
    result.probes.globalShortcuts = { enabled: activated.enabled, registered: activated.shortcuts.registered, failed: activated.shortcuts.failed };
    await page.evaluate('await window.keyboardTracker.setEnabled(false);');
    result.probes.accessibilityTrusted = process.platform === 'darwin' ? await native.evaluate('return process.mainModule.require("electron").systemPreferences.isTrustedAccessibilityClient(false);') : null;
    if (process.platform !== 'darwin' || result.probes.accessibilityTrusted) {
      await page.evaluate('await window.keyboardTracker.setTracking(true);');
      for (let i = 0; i < 120; i++) { const tracking = await page.evaluate('return (await window.keyboardTracker.getState()).tracking;'); if (tracking.mode !== 'starting') { result.probes.tracking = tracking; break; } await delay(50); }
      await page.evaluate('await window.keyboardTracker.setTracking(false);');
    } else result.probes.tracking = { mode: 'not_attempted', message: 'macOS Accessibility not authorized; avoid triggering an OS permission prompt.' };
    fixture.settings.autoSwitchLayers = true;
    await page.evaluate('await window.keyboardTracker.saveConfig(' + JSON.stringify(fixture) + ');'); await delay(3200);
    result.probes.applicationMonitor = await page.evaluate('const app=(await window.keyboardTracker.getState()).application;return {status:app.status,message:app.message,identified:Boolean(app.current)};');
    result.probes.tray = await page.evaluate('return (await window.keyboardTracker.getState()).desktop;');
    await page.evaluate('await window.keyboardTracker.saveConfig(' + JSON.stringify(original) + ');');
    if (process.platform === 'darwin' && !result.probes.accessibilityTrusted) {
      result.probes.keyMoments = { attempted: false, reason: 'Accessibility not authorized; no OS permission prompt triggered by the audit.' };
    } else {
      const moments = structuredClone(original);
      moments.layers[0].bindings = [
        { id: 'phase-press', key: 'A', name: 'Press', action: { type: 'log', message: 'phase press' } },
        { id: 'phase-hold', key: 'A', name: 'Hold', trigger: 'hold', repeatMs: 125, holdDelayMs: 500, keyCode: 'KeyA', action: { type: 'log', message: 'phase hold' } },
        { id: 'phase-release', key: 'A', name: 'Release', trigger: 'release', keyCode: 'KeyA', action: { type: 'log', message: 'phase release' } }
      ];
      await page.evaluate('await window.keyboardTracker.saveConfig(' + JSON.stringify(moments) + ');await window.keyboardTracker.setEnabled(true);');
      let phaseState;
      for (let i = 0; i < 150; i++) {
        phaseState = await page.evaluate('return await window.keyboardTracker.getState();');
        if (phaseState.input.mode !== 'starting') break;
        await delay(50);
      }
      const shared = await page.evaluate('const api=window.keyboardTracker;const on=await api.setTracking(true);const off=await api.setTracking(false);const paused=await api.setEnabled(false);return {shared:on.tracking.mode==="global"&&on.input.mode==="global",visualOff:!off.tracking.enabled&&off.input.mode==="global",pausedObserves:!paused.enabled&&paused.input.mode==="global"};');
      const persisted = await readConfigFile(path.join(state.paths.data, 'config.json'));
      result.probes.keyMoments = { attempted: true, mode: phaseState.input.mode, registered: phaseState.shortcuts.registered.includes('A'),
        schemaPersisted: persisted.layers[0].bindings.length === 3 && persisted.layers[0].bindings[1].trigger === 'hold' && persisted.layers[0].bindings[1].repeatMs === 125 && persisted.layers[0].bindings[1].holdDelayMs === 500 && persisted.layers[0].bindings[2].keyCode === 'KeyA', ...shared,
        note: 'Real worker availability, global registration and shared lifecycle; physical press/hold/release delivery is a separate Linux XTest probe.' };
      result.probes.keyMoments.passed = result.probes.keyMoments.mode === 'global' && result.probes.keyMoments.registered && result.probes.keyMoments.schemaPersisted && Object.values(shared).every(Boolean);
      await page.evaluate('await window.keyboardTracker.saveConfig(' + JSON.stringify(original) + ');');
    }
    const metrics = () => native.evaluate('return process.mainModule.require("electron").app.getAppMetrics().map(p=>({type:p.type,cpu:p.cpu.percentCPUUsage,rssKiB:p.memory.workingSetSize}));');
    await metrics(); const samples = [];
    for (let i = 0; i < 5; i++) { await delay(1000); samples.push(await metrics()); }
    result.idle = { seconds: 5, cpuReported: stats(samples.map(sample=>sample.reduce((n,p)=>n+p.cpu,0))), summedRssMiB: stats(samples.map(sample=>sample.reduce((n,p)=>n+p.rssKiB,0)/1024)), note: 'RSS is a sum of Electron-listed processes and includes shared pages more than once.' };
    result.configuration = {};
    for (const [name, config] of [['default', original], ['large', largeFixture()]]) {
      await page.evaluate('await window.keyboardTracker.saveConfig(' + JSON.stringify(config) + ');');
      const values = await page.evaluate('const edit=[],save=[];const api=window.keyboardTracker;const config=(await api.getState()).config;for(let i=0;i<20;i++){const t=performance.now();await api.setEditing(i%2===0);edit.push(performance.now()-t);}for(let i=0;i<4;i++){const t=performance.now();await api.saveConfig(config);save.push(performance.now()-t);}return {edit,save};');
      result.configuration[name] = { actions: config.layers.reduce((n,l)=>n+l.bindings.length,0), editingIpcMs: stats(values.edit), saveIpcMs: stats(values.save) };
    }
    const large = largeFixture();
    const stored = await fs.readFile(path.join(state.paths.data, 'config.json'), 'utf8');
    const legacy = path.join(directory, 'legacy-pretty.json');
    await fs.writeFile(legacy, JSON.stringify(large, null, 2) + '\n');
    result.probes.canonicalPersistence = {
      bytes: Buffer.byteLength(stored), legacyBytes: (await fs.stat(legacy)).size,
      canonicalMatches: stored === encodeConfig(large),
      legacyReadable: encodeConfig(await readConfigFile(legacy)) === encodeConfig(large)
    };
    // Reload the real renderer and rehydrate the preload cache from persisted data.
    await page.call('Page.reload');
    let reloaded;
    for (let i = 0; i < 200; i++) {
      try { if (await page.evaluate('return Boolean(document.querySelector("[data-focus=new-layer]"));')) { reloaded = await page.evaluate('return await window.keyboardTracker.getState();'); break; } } catch {}
      await delay(25);
    }
    result.probes.canonicalPersistence.rendererReloaded = Boolean(reloaded && encodeConfig(reloaded.config) === stored);
    result.probes.stateTransport = await page.evaluate('const api=window.keyboardTracker;const a=await api.getState();const b=await api.setEditing(true);const c=await api.setEditing(false);return {complete:Boolean(a.config&&b.config&&c.config),sameConfigRevision:a.configRevision===c.configRevision,ordered:a.stateRevision<=b.stateRevision&&b.stateRevision<=c.stateRevision};');
    await page.evaluate('await window.keyboardTracker.saveConfig(' + JSON.stringify(original) + ');');
    result.complete = true;
    result.corePassed = result.probes.initialPaused && result.probes.preload && result.probes.persistence && result.probes.clipboard.matched && result.probes.sequenceDelay.passed && result.probes.applicationLaunch.status === 'success' && Object.values(result.package.sourceMatches).every(Boolean) && result.probes.canonicalPersistence.canonicalMatches && result.probes.canonicalPersistence.legacyReadable && result.probes.canonicalPersistence.rendererReloaded && Object.values(result.probes.stateTransport).every(Boolean) && (!result.probes.keyMoments.attempted || result.probes.keyMoments.passed);
    if (!result.corePassed) process.exitCode = 1;
  } catch (error) {
    result.complete = false; result.error = error.message; process.exitCode = 1;
  } finally {
    if (instance && originalClipboard !== undefined) await instance.native.evaluate('await process.mainModule.require("electron").clipboard.writeText(' + JSON.stringify(originalClipboard) + ');').catch(()=>{});
    if (instance) result.shutdowns.push(await instance.stop());
    if (result.shutdowns.some(shutdown => !shutdown.graceful)) { result.corePassed = false; process.exitCode = 1; }
    await fs.rm(directory, { recursive: true, force: true });
    const output = path.join(root, 'artifacts', 'os-audit', 'platform-' + process.platform + '-' + process.arch + '.json');
    await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ platform: process.platform, arch: process.arch, complete: result.complete, corePassed: result.corePassed, startup: result.startup, probes: result.probes, error: result.error }, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
