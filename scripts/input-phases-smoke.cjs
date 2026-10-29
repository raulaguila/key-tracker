// Real Linux/X11 proof. The controller creates its own Xvfb and temporary profile.
// Usage: node scripts/input-phases-smoke.cjs [evidence.json]
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');

async function ownedXvfb() {
  const display = (process.env.DISPLAY || '').split('.')[0];
  if (!display.startsWith(':')) return false;
  for (const item of await fs.readdir('/proc')) {
    if (!/^\d+$/.test(item)) continue;
    try {
      const directory = path.join('/proc', item);
      if ((await fs.stat(directory)).uid !== process.getuid()) continue;
      const argv = (await fs.readFile(path.join(directory, 'cmdline'), 'utf8')).split('\0');
      if (path.basename(argv[0]) === 'Xvfb' && argv.includes(display)) return true;
    } catch { /* Process may have exited. */ }
  }
  return false;
}

async function run() {
  if (process.platform !== 'linux') throw new Error('Esta prova requer Linux/X11; não certifica eventos físicos nos outros sistemas.');
  if (!process.argv.includes('--isolated')) {
    const child = spawn('xvfb-run', ['-a', process.execPath, __filename, '--isolated', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, DOBRA_INPUT_PROOF: '1' } });
    process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
    return;
  }
  if (process.env.DOBRA_INPUT_PROOF !== '1' || !await ownedXvfb()) throw new Error('A prova exige um display Xvfb local próprio.');
  const output = path.resolve(process.argv.filter(value => value !== '--isolated')[2] || path.join(root, 'artifacts', 'input-phases', 'native-linux.json'));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'keyboard-input-proof-'));
  let child;
  try {
    const profile = path.join(directory, 'profile');
    await fs.mkdir(profile);
    const entry = path.join(directory, 'main.cjs');
    const script = String.raw`
const { app, BrowserWindow, globalShortcut, utilityProcess } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const assert = require('node:assert/strict');
const root = ROOT;
const profile = PROFILE;
const output = OUTPUT;
const { Engine } = require(path.join(root, 'app/engine.cjs'));
const { Tracker } = require(path.join(root, 'app/tracking.cjs'));
const { Storage } = require(path.join(root, 'app/storage.cjs'));
const { defaultConfig } = require(path.join(root, 'app/config.cjs'));
app.setPath('userData', profile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let engine, tracker, window, receiver;
let receiverRequest = 0;
const receiverReplies = new Map();
async function receiverSnapshot() {
  const id = ++receiverRequest;
  const reply = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { receiverReplies.delete(id); reject(new Error('External receiver did not respond')); }, 3000);
    receiverReplies.set(id, value => { clearTimeout(timer); resolve(value); });
  });
  receiver.send({ id });
  return reply;
}
async function startReceiver() {
  const entry = path.join(profile, 'receiver.cjs');
  // A different application process owns focus throughout the input proof.
  const source = [
    "const {app,BrowserWindow}=require('electron');",
    "app.setPath('userData'," + JSON.stringify(path.join(profile, 'receiver-profile')) + ");",
    'let window; const events=[];',
    'app.whenReady().then(async()=>{',
    'window=new BrowserWindow({width:420,height:240,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});',
    "window.webContents.on('before-input-event',(_,input)=>{if(['keyDown','keyUp'].includes(input.type))events.push({type:input.type,code:input.code,control:input.control,shift:input.shift});});",
    "await window.loadURL('data:text/html,<title>Independent input receiver</title><textarea id=receiver autofocus></textarea>');",
    "window.show();window.focus();await window.webContents.executeJavaScript('document.querySelector(\"textarea\").focus()');process.send({ready:true});",
    '});',
    "process.on('message',async message=>{if(message.stop){app.exit(0);return;}const text=await window.webContents.executeJavaScript('document.querySelector(\"textarea\").value');process.send({id:message.id,characters:text.length,onlyAs:/^a*$/.test(text),events});});"
  ].join('\n');
  await fs.writeFile(entry, source);
  receiver = spawn(process.execPath, [entry, '--ozone-platform=x11', '--disable-gpu', ...(process.env.DOBRA_UI_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  receiver.on('message', message => { if (message.id) { receiverReplies.get(message.id)?.(message); receiverReplies.delete(message.id); } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('External receiver did not open')), 5000);
    receiver.once('error', reject);
    receiver.on('message', message => { if (message.ready) { clearTimeout(timer); resolve(); } });
    receiver.once('exit', code => { if (code) reject(new Error('External receiver exited: ' + code)); });
  });
}
let forks = 0;
const observed = [];
const evidence = { platform: process.platform, electron: process.versions.electron, nativeHook: true, isolatedXvfb: true, scope: 'Synthetic XTest events in an owned display; no physical keyboard or Windows/macOS certification.' };
const counts = () => Object.fromEntries(['press', 'hold', 'release', 'combo-press', 'combo-hold', 'combo-release'].map(id => [id, engine.events.filter(event => event.kind === 'action' && event.bindingId === id).length]));
async function until(predicate, message) {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await delay(10);
  assert.ok(predicate(), message);
}
async function keys(steps) {
  const python = [
    'import ctypes,time,json',
    "x=ctypes.CDLL('libX11.so.6'); t=ctypes.CDLL('libXtst.so.6')",
    'x.XOpenDisplay.restype=ctypes.c_void_p',
    'x.XKeysymToKeycode.argtypes=[ctypes.c_void_p,ctypes.c_ulong];x.XKeysymToKeycode.restype=ctypes.c_uint',
    'x.XStringToKeysym.argtypes=[ctypes.c_char_p];x.XStringToKeysym.restype=ctypes.c_ulong',
    'x.XFlush.argtypes=[ctypes.c_void_p];x.XCloseDisplay.argtypes=[ctypes.c_void_p]',
    't.XTestFakeKeyEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]',
    'd=x.XOpenDisplay(None)',
    'steps=json.loads(' + JSON.stringify(JSON.stringify(steps)) + ')',
    'for step in steps:',
    " if 'wait' in step: time.sleep(step['wait']/1000)",
    ' else:',
    "  symbol=x.XStringToKeysym(step['key'].encode()); code=x.XKeysymToKeycode(d,symbol)",
    "  t.XTestFakeKeyEvent(d,code,1 if step['down'] else 0,0);x.XFlush(d)",
    'time.sleep(.04)',
    'x.XCloseDisplay(d)'
  ].join('\n');
  await promisify(execFile)('python3', ['-c', python], { timeout: 5000, maxBuffer: 4096 });
  await delay(30);
}
const tap = () => keys([{ key: 'a', down: true }, { wait: 30 }, { key: 'a', down: false }]);
async function main() {
  window = new BrowserWindow({ show: true, width: 320, height: 220, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.focus();
  const config = defaultConfig();
  config.settings.cooldownMs = 100;
  const action = message => ({ type: 'log', message });
  config.layers = [{ id: 'proof', name: 'Input proof', bindings: [
    { id: 'press', name: 'Press', key: 'A', keyCode: 'KeyA', trigger: 'press', action: action('press fixture') },
    { id: 'hold', name: 'Hold', key: 'A', keyCode: 'KeyA', trigger: 'hold', repeatMs: 100, action: action('hold fixture') },
    { id: 'release', name: 'Release', key: 'A', keyCode: 'KeyA', trigger: 'release', action: action('release fixture') },
    { id: 'combo-press', name: 'Combo press', key: 'Control+B', keyCode: 'KeyB', trigger: 'press', action: action('combo press fixture') },
    { id: 'combo-hold', name: 'Combo hold', key: 'Control+B', keyCode: 'KeyB', trigger: 'hold', repeatMs: 100, action: action('combo hold fixture') },
    { id: 'combo-release', name: 'Combo release', key: 'Control+B', keyCode: 'KeyB', trigger: 'release', action: action('combo release fixture') }
  ] }];
  const storage = new Storage(path.join(profile, 'data'));
  const initialConfig = defaultConfig();
  initialConfig.layers.forEach(layer => layer.bindings.forEach(binding => { binding.key = 'A'; binding.action = action('cold press-only fixture'); }));
  engine = new Engine({ config: initialConfig, storage, documents: profile, session: 'x11', isAppFocused: () => BrowserWindow.getAllWindows().some(win => win.isFocused()) });
  tracker = new Tracker({ engine, fork: (...args) => { forks++; return utilityProcess.fork(...args); } });
  engine.on('key', event => observed.push(event));
  assert.equal(forks, 0, 'o hook não deve iniciar antes de ativação explícita');
  engine.setEnabled(true);
  await until(() => engine.input.mode === 'global', 'hook global precisa ficar pronto');
  assert.equal(engine.tracking.enabled, false);
  for (const key of ['A', 'Control+B', 'F8', 'CommandOrControl+Shift+F12']) assert.equal(globalShortcut.isRegistered(key), false, key + ' não deve ser reservado no sistema');
  await startReceiver();
  evidence.passiveObservation = { noExclusiveRegistrations: true, externalReceiverProcess: receiver.pid !== process.pid };
  await tap();
  await until(() => engine.events.some(event => event.kind === 'action' && event.status === 'success'), 'press-only deve iniciar o hook e disparar fora do Dobra');
  assert.equal(engine.events.filter(event => event.kind === 'action').length, 1);
  assert.equal(engine.events.find(event => event.kind === 'action').origin, 'shortcut');
  assert.equal(engine.events.find(event => event.kind === 'action').outsideApp, true);
  evidence.passiveObservation.externalOriginVerified = true;
  assert.equal((await receiverSnapshot()).characters, 1, 'uma tecla produz um único caractere no outro aplicativo');
  evidence.passiveObservation.coldPressOnly = true;
  await engine.saveConfig(config);
  await keys([{ key: 'a', down: true }, { wait: 1100 }, { key: 'a', down: false }]);
  await until(() => counts().release === 1 && engine.inFlight.size === 0, 'keyup real deve executar release');
  const first = counts();
  assert.equal(first.press, 1, 'autorepeat nativo não deve repetir press');
  assert.ok(first.hold >= 3, 'hold deve executar mais de uma vez');
  assert.equal(first.release, 1);
  assert.equal(observed.length, 0, 'ações não devem ligar rastreio visual');
  await delay(250);
  assert.deepEqual(counts(), first, 'keyup encerra repetição');
  evidence.firstGesture = first;
  const received = await receiverSnapshot();
  assert.ok(received.characters >= 1 && received.onlyAs, 'o campo de texto de outro aplicativo deve receber A normalmente');
  assert.ok(received.events.some(event => event.code === 'KeyA' && event.type === 'keyDown'));
  assert.ok(received.events.some(event => event.code === 'KeyA' && event.type === 'keyUp'));
  evidence.passiveObservation.externalTextReceived = true;
  evidence.passiveObservation.externalKeyupReceived = true;
  tracker.set(true);
  assert.equal(forks, 1, 'rastreio deve reutilizar o mesmo worker');
  await delay(120); await tap();
  await until(() => counts().release === 2, 'novo gesto deve executar release');
  assert.deepEqual(observed.filter(event => event.code === 'KeyA').map(event => event.direction), ['down', 'up']);
  tracker.set(false);
  assert.equal(engine.input.mode, 'global');
  assert.equal(forks, 1);
  evidence.visualTrackingReusedWorker = true;
  await delay(120);
  await keys([{ key: 'a', down: true }]);
  engine.setEditing(true);
  await delay(850);
  const editing = counts();
  engine.setEditing(false);
  await delay(300);
  await keys([{ key: 'a', down: false }]);
  await delay(150);
  assert.deepEqual(counts(), editing, 'retomar edição com tecla segurada não reinicia gesto nem cria release');
  evidence.editingCancelledHeldGesture = true;
  await delay(120); await keys([{ key: 'a', down: true }]);
  engine.setEnabled(false);
  await until(() => engine.inFlight.size === 0, 'ação iniciada antes da pausa pode terminar');
  const paused = counts();
  assert.equal(engine.input.mode, 'global', 'hook armado continua observando solturas durante pausa');
  await delay(850);
  engine.setEnabled(true);
  await delay(300); await keys([{ key: 'a', down: false }]); await delay(120);
  assert.deepEqual(counts(), paused, 'retomar com tecla segurada não deve iniciar outro gesto');
  assert.equal(forks, 1);
  evidence.pauseResumeCancelledHeldGesture = true;
  tracker.set(true);
  await keys([{ key: 'Control_L', down: true }, { key: 'b', down: true }, { wait: 280 }, { key: 'Control_L', down: false }, { wait: 120 }, { key: 'b', down: false }]);
  await until(() => engine.inFlight.size === 0, 'etapas de combo devem terminar');
  const combo = counts();
  assert.equal(combo['combo-press'], 1);
  assert.ok(combo['combo-hold'] >= 1);
  assert.equal(combo['combo-release'], 0, 'soltar modificador cancela o gesto antes do keyup da tecla');
  assert.equal(observed.find(event => event.code === 'KeyB' && event.direction === 'down')?.ctrlKey, true);
  evidence.modifierCancellation = { press: combo['combo-press'], hold: combo['combo-hold'], release: combo['combo-release'], nativeCtrlFlag: true };
  const comboReceiver = await receiverSnapshot();
  assert.ok(comboReceiver.events.some(event => event.code === 'KeyB' && event.type === 'keyDown' && event.control));
  evidence.passiveObservation.externalModifiedKeyReceived = true;
  tracker.set(false);
  await delay(120); await keys([{ key: 'a', down: true }, { wait: 150 }]);
  tracker.worker.kill();
  await until(() => engine.input.mode === 'unavailable' && engine.inFlight.size === 0, 'perda real do hook deve cancelar gestos');
  const crashed = counts();
  await delay(250);
  assert.deepEqual(counts(), crashed, 'crash não deve deixar repetição em background');
  await keys([{ key: 'a', down: false }]);
  assert.equal(counts().release, editing.release, 'perda do hook não cria soltura artificial');
  assert.equal(forks, 1, 'falha não deve reiniciar worker em loop');
  evidence.workerCrashCancelledGesture = true;
  engine.setEnabled(false); engine.setEnabled(true);
  await until(() => engine.input.mode === 'global', 'reativação explícita deve iniciar novo hook');
  await keys([{ key: 'a', down: true }, { wait: 150 }]);
  engine.requestStop(); await engine.stopPromise;
  const stopped = counts();
  await delay(200); await keys([{ key: 'a', down: false }]); await delay(100);
  assert.deepEqual(counts(), stopped, 'parar todas com tecla mantida não deixa hold nem release tardio');
  evidence.stopAllCancelledHeldGesture = true;
  // Legacy press-only configurations also use the observer, including controls.
  const pressOnly = defaultConfig();
  pressOnly.settings.cooldownMs = 100;
  pressOnly.layers.forEach(layer => layer.bindings.forEach(binding => { binding.key = 'A'; binding.action = action('legacy press fixture'); }));
  await engine.saveConfig(pressOnly);
  engine.setEnabled(true);
  const prior = engine.events.filter(event => event.kind === 'action').length;
  const beforeText = (await receiverSnapshot()).characters;
  await tap();
  await until(() => engine.events.filter(event => event.kind === 'action').length === prior + 1, 'press legado deve disparar fora do Dobra');
  assert.ok((await receiverSnapshot()).characters > beforeText);
  await keys([{ key: 'F8', down: true }, { key: 'F8', down: false }]);
  assert.equal(engine.activeLayerId, pressOnly.layers[1].id);
  const pause = () => keys([{ key: 'Control_L', down: true }, { key: 'Shift_L', down: true }, { key: 'F12', down: true }, { key: 'F12', down: false }, { key: 'Shift_L', down: false }, { key: 'Control_L', down: false }]);
  await pause();
  assert.equal(engine.enabled, false);
  const pausedCount = engine.events.filter(event => event.kind === 'action').length;
  await tap();
  assert.equal(engine.events.filter(event => event.kind === 'action').length, pausedCount);
  await delay(450); await pause();
  assert.equal(engine.enabled, true);
  const controlReceiver = await receiverSnapshot();
  assert.ok(controlReceiver.events.some(event => event.code === 'F8' && event.type === 'keyDown'));
  assert.ok(controlReceiver.events.some(event => event.code === 'F12' && event.type === 'keyDown' && event.control && event.shift));
  evidence.passiveObservation.pressOnlyOutsideApp = true;
  evidence.passiveObservation.layerAndPauseControlsPassedThrough = true;
  await engine.saveConfig(config);
  engine.setLayer('proof');
  engine.setEnabled(true);
  await keys([{ key: 'a', down: true }, { wait: 150 }]);
  const workerExit = new Promise(resolve => tracker.worker.once('exit', resolve));
  await require(path.join(root, 'app/shutdown.cjs')).drainServices({ engine, tracker, storage });
  await Promise.race([workerExit, delay(1500).then(() => { throw new Error('Hook permaneceu vivo após shutdown'); })]);
  const closed = counts();
  await keys([{ key: 'a', down: false }]); await delay(100);
  assert.deepEqual(counts(), closed);
  assert.equal(engine.inFlight.size, 0);
  evidence.shutdownCancelledHeldGesture = true;

  evidence.forks = forks;
  evidence.passed = true;
}
app.whenReady().then(main).catch(error => { evidence.passed = false; evidence.error = error.stack; process.exitCode = 1; }).finally(async () => {
  receiver?.kill();
  tracker?.dispose(); engine?.dispose();
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
  app.exit(evidence.passed ? 0 : 1);
});
setTimeout(() => { receiver?.kill(); tracker?.dispose(); engine?.dispose(); app.exit(2); }, 30000).unref();
`;
    const source = script.replace('const root = ROOT;', 'const root = ' + JSON.stringify(root) + ';')
      .replace('const profile = PROFILE;', 'const profile = ' + JSON.stringify(profile) + ';')
      .replace('const output = OUTPUT;', 'const output = ' + JSON.stringify(output) + ';');
    await fs.writeFile(entry, source);
    const flags = [entry, '--ozone-platform=x11', '--disable-gpu'];
    if (process.env.DOBRA_UI_NO_SANDBOX === '1') flags.push('--no-sandbox');
    child = spawn(require('electron'), flags, { cwd: root, env: { ...process.env, XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: '', DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + path.join(directory, 'no-bus') }, stdio: 'inherit' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 35000);
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', value => resolve(value ?? 1)); });
    clearTimeout(timer);
    process.exitCode = code;
  } finally {
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await fs.rm(directory, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
