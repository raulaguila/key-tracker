// Production IPC + actual XTest input in another Electron application. The
// caller must own its isolated Xvfb; no host desktop is used for this proof.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');

async function receiver() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dobra-macro-receiver-'));
  const entry = path.join(directory, 'receiver.cjs');
  const html = '<title>Macro receiver</title><style>body{margin:0}button{position:absolute;left:20px;top:20px;width:160px;height:44px}textarea{position:absolute;left:20px;top:90px;width:320px;height:100px}#finish{top:220px}</style><button id="hit" onclick="window.hits++">Clique</button><textarea id="text"></textarea><button id="finish" onclick="window.finishes++">Concluir</button><script>window.hits=0;window.finishes=0;window.keys=[];addEventListener("keydown",e=>window.keys.push(e.code));</script>';
  await fs.writeFile(entry, `const {app,BrowserWindow}=require('electron');
    app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});
    let window;
    app.whenReady().then(async()=>{
      window=new BrowserWindow({x:0,y:0,width:420,height:320,frame:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
      await window.loadURL(${JSON.stringify('data:text/html;charset=utf-8,' + encodeURIComponent(html))});
      window.show();window.focus();process.send({ready:true});
    });
    process.on('message',async m=>{try{
      if(m.focus){window.show();window.focus();}
      const data=await window.webContents.executeJavaScript('({hits:window.hits,finishes:window.finishes,text:document.querySelector("textarea").value,keys:window.keys})');
      process.send({id:m.id,data});
    }catch{process.send({id:m.id,error:true});}});`);
  const child = spawn(require('electron'), [entry, '--ozone-platform=x11', '--disable-gpu', ...(process.env.DOBRA_UI_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let errorOutput = ''; child.stderr.on('data', data => { errorOutput = (errorOutput + data).slice(-2000); });
  let id = 0;
  const pending = new Map();
  child.on('message', m => { if (m.id) { const done = pending.get(m.id); pending.delete(m.id); done?.(m); } });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await new Promise(resolve => { child.once('exit', resolve); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000).unref(); });
    }
    await fs.rm(directory, { recursive: true, force: true });
  };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Receiver did not open: ' + errorOutput)), 8000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Receiver exited: ' + errorOutput)); });
      child.on('message', m => { if (m.ready) { clearTimeout(timer); resolve(); } });
    });
    return { stop, snapshot: (focus = false) => new Promise((resolve, reject) => {
      const request = ++id;
      const timer = setTimeout(() => { pending.delete(request); reject(new Error('Receiver snapshot timeout')); }, 3000);
      pending.set(request, m => { clearTimeout(timer); m.error ? reject(new Error('Receiver error')) : resolve(m.data); });
      child.send({ id: request, focus });
    }) };
  } catch (error) { await stop(); throw error; }
}

async function xtest(events) {
  const source = [
    'import ctypes,json,time',
    "x=ctypes.CDLL('libX11.so.6');t=ctypes.CDLL('libXtst.so.6')",
    'x.XOpenDisplay.restype=ctypes.c_void_p',
    'x.XStringToKeysym.argtypes=[ctypes.c_char_p];x.XStringToKeysym.restype=ctypes.c_ulong',
    'x.XKeysymToKeycode.argtypes=[ctypes.c_void_p,ctypes.c_ulong];x.XKeysymToKeycode.restype=ctypes.c_uint',
    'x.XFlush.argtypes=[ctypes.c_void_p];x.XCloseDisplay.argtypes=[ctypes.c_void_p]',
    't.XTestFakeKeyEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]',
    't.XTestFakeMotionEvent.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_ulong]',
    't.XTestFakeButtonEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]',
    'd=x.XOpenDisplay(None)',
    'assert d',
    'for e in json.loads(' + JSON.stringify(JSON.stringify(events)) + '):',
    " if 'wait' in e: time.sleep(e['wait']/1000);continue",
    " if 'x' in e: t.XTestFakeMotionEvent(d,-1,e['x'],e['y'],0);t.XTestFakeButtonEvent(d,1,1,0);t.XTestFakeButtonEvent(d,1,0,0)",
    " else: t.XTestFakeKeyEvent(d,x.XKeysymToKeycode(d,x.XStringToKeysym(e['key'].encode())),int(e['down']),0)",
    ' x.XFlush(d);time.sleep(.05)',
    'x.XCloseDisplay(d)'
  ].join('\n');
  await promisify(execFile)('/usr/bin/python3', ['-I', '-B', '-c', source], { timeout: 5000, maxBuffer: 4096 });
}

async function ownedXvfb() {
  const display = (process.env.DISPLAY || '').split('.')[0];
  if (!display.startsWith(':')) return false;
  for (const entry of await fs.readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const directory = path.join('/proc', entry);
      if ((await fs.stat(directory)).uid !== process.getuid()) continue;
      const argv = (await fs.readFile(path.join(directory, 'cmdline'), 'utf8')).split('\0');
      if (path.basename(argv[0]) === 'Xvfb' && argv.includes(display)) return true;
    } catch { /* A process can exit while its metadata is read. */ }
  }
  return false;
}

module.exports = async function macroNativeProof({ evaluate, click, nativeState, nativeEvaluate, until, save }) {
  assert.equal(process.env.DOBRA_UI_MACRO_ONLY, '1');
  assert.ok(await ownedXvfb(), 'Native recording/playback requires an owned isolated Xvfb display');
  const external = await receiver();
  const evidence = { platform: process.platform, session: 'x11', isolatedXvfb: true, externalApplication: true, checks: [] };
  try {
    await evaluate('await window.dobra.authorizeMacros();');
    const capability = await evaluate('return await window.dobra.getMacroState();');
    assert.equal(capability.capabilities.recording, true);
    const config = (await nativeState()).config;
    config.layers = [{ id: 'macro-proof', name: 'Prova de fluxo', applications: [], bindings: [
      { id: 'flow', name: 'Fluxo externo', key: 'Control+Alt+M', action: { type: 'macro', startDelayMs: 900, steps: [
        { kind: 'click', x: 60, y: 40, button: 'left', clicks: 1 },
        { kind: 'click', x: 50, y: 120, button: 'left', clicks: 1 },
        { kind: 'text', text: 'Olá, fluxo real!' }, { kind: 'key', key: 'Tab' }, { kind: 'key', key: 'Enter' }
      ] } },
      { id: 'loop-guard', name: 'Não disparar por tecla sintetizada', key: 'Enter', action: { type: 'clipboard', text: 'ERRO DE RECURSÃO' } }
    ] }];
    await evaluate('await window.dobra.setEditing(false);await window.dobra.saveConfig(' + JSON.stringify(config) + ');');
    const before = await external.snapshot(true);
    const preview = await evaluate('return await window.dobra.previewBinding("macro-proof","flow");');
    assert.equal(preview.action.steps[2].text, 'Olá, fluxo real!');
    assert.deepEqual(await external.snapshot(), before, 'Preview must produce no native effects');
    evidence.checks.push('pure-preview');
    // A genuine globally observed shortcut starts playback while another app owns focus.
    await evaluate('await window.dobra.setEnabled(true);');
    await until('(await window.dobra.getState()).input.mode === "global"', 'Global hook for the real shortcut');
    await external.snapshot(true);
    await xtest([{ key: 'Control_L', down: true }, { key: 'Alt_L', down: true }, { key: 'm', down: true }, { key: 'm', down: false }, { key: 'Alt_L', down: false }, { key: 'Control_L', down: false }]);
    await until('(await window.dobra.getState()).events.some(e=>e.bindingId === "flow" && e.status === "success")', 'Real shortcut should complete the native flow');
    const result = await external.snapshot();
    assert.equal(result.hits, 1);
    assert.equal(result.text, 'Olá, fluxo real!');
    assert.equal(result.finishes, 1, 'Tab then Enter must activate the other app button');
    let state = await nativeState();
    assert.equal(state.events.find(e => e.bindingId === 'flow').outsideApp, true);
    assert.equal(state.events.some(e => e.bindingId === 'loop-guard'), false);
    assert.doesNotMatch(JSON.stringify(state.events.filter(e => e.bindingId === 'flow')), /Olá, fluxo real/);
    evidence.checks.push('real-shortcut-outside-app', 'native-click', 'unicode-paste', 'tab-enter', 'no-recursion', 'private-history');

    // Capture real global mouse/key events, stop with the native stop chord,
    // then consume the retained recording through the public preload methods.
    await evaluate('await window.dobra.setEnabled(false);await window.dobra.setEditing(true);await window.dobra.startMacroRecording();');
    await external.snapshot(true);
    await xtest([{ x: 70, y: 130 }, { key: 'b', down: true }, { key: 'b', down: false }, { key: 'Control_L', down: true }, { key: 'Shift_L', down: true }, { key: 'F10', down: true }, { key: 'F10', down: false }, { key: 'Shift_L', down: false }, { key: 'Control_L', down: false }]);
    await until('!(await window.dobra.getMacroState()).recording', 'Native stop chord must end recording');
    const recorded = await evaluate('return await window.dobra.stopMacroRecording();');
    assert.equal(recorded.reason, 'shortcut');
    assert.ok(recorded.steps.some(step => step.kind === 'click' && step.x === 70 && step.y === 130));
    assert.ok(recorded.steps.some(step => step.kind === 'key' && step.key === 'B'));
    assert.equal(recorded.steps.some(step => step.key === 'Control+Shift+F10'), false);
    evidence.checks.push('native-recording-click-key', 'global-stop', 'recording-not-auto-saved');
    assert.deepEqual((await nativeState()).config, require('../app/config.cjs').validateConfig(config));
    assert.equal(await nativeEvaluate('process.mainModule.require("electron").BrowserWindow.getAllWindows()[0].isVisible()'), true);
    await evaluate('await window.dobra.setEditing(false);');

    // The actual editor receives the native stop event, stages the recording,
    // preserves existing steps and saves only after an explicit review choice.
    await click('[data-focus="edit-flow"]');
    await until('Boolean(document.querySelector("[data-macro-record]")) && !document.querySelector("[data-macro-record]").disabled', 'Recording control in the real editor');
    await click('[data-macro-record]');
    await until('(await window.dobra.getMacroState()).recording', 'UI starts native recording');
    await new Promise(resolve => setTimeout(resolve, 400));
    await external.snapshot(true);
    await xtest([{ x: 90, y: 130 }, { key: 'c', down: true }, { key: 'c', down: false }, { key: 'Control_L', down: true }, { key: 'Shift_L', down: true }, { key: 'F10', down: true }, { key: 'F10', down: false }, { key: 'Shift_L', down: false }, { key: 'Control_L', down: false }]);
    await until('Boolean(document.querySelector("[data-macro-review]")) && !document.querySelector("[data-macro-review]").hidden', 'Native stop stages the recording in the editor');
    assert.deepEqual((await nativeState()).config, require('../app/config.cjs').validateConfig(config), 'Staged recording never auto-saves');
    await click('[data-macro-append]');
    await save();
    await until('!document.querySelector("#editor-drawer")', 'Save reviewed recording');
    const saved = (await nativeState()).config.layers[0].bindings.find(binding => binding.id === 'flow').action;
    assert.equal(saved.steps.length, 7);
    assert.ok(saved.steps.slice(5).some(step => step.kind === 'click' && step.x === 90));
    assert.ok(saved.steps.slice(5).some(step => step.kind === 'key' && step.key === 'C'));
    evidence.checks.push('record-review-save-ui', 'append-preserves-existing-flow');

    // Cancel during a real wait, proving the following input never occurs.
    config.layers[0].bindings[0].action = { type: 'macro', startDelayMs: 0, steps: [{ kind: 'wait', ms: 10000 }, { kind: 'text', text: 'NÃO DEVE APARECER' }] };
    await evaluate('await window.dobra.saveConfig(' + JSON.stringify(config) + ');window.__macroRun=window.dobra.runBinding("macro-proof","flow");');
    await until('(await window.dobra.getMacroState()).playing', 'Playback should start waiting');
    await evaluate('await window.dobra.cancelExecution("flow");await window.__macroRun;');
    state = await nativeState();
    assert.equal(state.running.length, 0);
    assert.equal(state.events.find(e => e.bindingId === 'flow').status, 'cancelled');
    assert.doesNotMatch((await external.snapshot()).text, /NÃO DEVE APARECER/);
    evidence.checks.push('cancel-stops-next-effects', 'native-resource-drain');
    await evaluate('window.__macroRun=window.dobra.runBinding("macro-proof","flow");');
    await until('(await window.dobra.getState()).running.some(item=>item.bindingId==="flow"&&item.phase==="waiting")', 'Native stop hook is armed before its long wait');
    await external.snapshot(true);
    await xtest([{ key: 'Control_L', down: true }, { key: 'Shift_L', down: true }, { key: 'F10', down: true }, { key: 'F10', down: false }, { key: 'Shift_L', down: false }, { key: 'Control_L', down: false }]);
    await evaluate('await window.__macroRun;');
    assert.equal((await nativeState()).events.find(e => e.bindingId === 'flow').status, 'cancelled');
    evidence.checks.push('global-stop-playback-reports-cancelled');
    config.layers[0].bindings[0].key = 'Control+Shift+F10';
    config.layers[0].bindings[0].action = { type: 'macro', startDelayMs: 350, steps: [
      { kind: 'click', x: 70, y: 130, button: 'left', clicks: 1 },
      { kind: 'key', key: 'Control+A' }, { kind: 'text', text: 'Parada sem conflito' }
    ] };
    const previous = (await nativeState()).events.find(e => e.bindingId === 'flow').id;
    await evaluate('await window.dobra.saveConfig(' + JSON.stringify(config) + ');await window.dobra.authorizeMacros();await window.dobra.setEnabled(true);');
    await until('(await window.dobra.getState()).input.mode === "global"', 'Fresh hook after cancellation');
    await external.snapshot(true);
    await xtest([{ key: 'Control_L', down: true }, { key: 'Shift_L', down: true }, { key: 'F10', down: true }, { key: 'F10', down: false }, { key: 'Shift_L', down: false }, { key: 'Control_L', down: false }]);
    await until('((await window.dobra.getState()).events.find(e=>e.bindingId==="flow")||{}).id!==' + JSON.stringify(previous) + '&&((await window.dobra.getState()).events.find(e=>e.bindingId==="flow")||{}).status==="success"', 'An existing F10 shortcut must work with a different stop chord');
    assert.equal((await external.snapshot()).text, 'Parada sem conflito');
    assert.equal((await evaluate('return await window.dobra.getMacroState();')).stopShortcut, 'Control+Shift+F9');
    evidence.checks.push('stop-shortcut-collision-free');
    const output = path.join(__dirname, '..', 'artifacts', 'macro-proof.json');
    await fs.writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
    console.log('Native macro proof: ' + evidence.checks.length + ' checks passed in another application.');
  } finally {
    await evaluate('await window.dobra.stopMacroRecording({cancel:true});await window.dobra.cancelAllExecutions();').catch(() => {});
    await external.stop();
  }
};
