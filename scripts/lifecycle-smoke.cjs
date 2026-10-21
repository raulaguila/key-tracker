// Real Electron lifecycle proof, disposable profiles and loopback HTTP only.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
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
async function until(operation, message) {
  const deadline = Date.now() + 15000;
  do { const value = await operation(); if (value) return value; await delay(20); } while (Date.now() < deadline);
  throw new Error(message);
}
async function launch(profile) {
  await fs.mkdir(profile, { recursive: true });
  const debugPort = await freePort(), started = performance.now();
  const flags = ['--inspect=127.0.0.1:0', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + debugPort];
  if (process.platform === 'linux') flags.push('--ozone-platform=x11', '--disable-gpu');
  if (process.env.DOBRA_UI_NO_SANDBOX === '1') flags.push('--no-sandbox');
  const child = spawn(require('electron'), [path.join(root, 'scripts/lifecycle-fixture.cjs'), ...flags], { cwd: root,
    env: { ...process.env, DOBRA_DATA_DIR: profile, XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let inspector, output = '', spawnError;
  child.on('error', error => { spawnError = error; });
  child.stdout.resume();
  child.stderr.on('data', chunk => { const text = output + chunk; inspector ??= text.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1]; output = text.slice(-4000); });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  let page, native;
  try {
    const target = await until(async () => {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error('Electron exited: ' + output);
      try { return (await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json()).find(t => t.type === 'page' && t.url.includes('index.html')); } catch { return null; }
    }, 'Janela de carregamento ausente');
    page = await cdp(target.webSocketDebuggerUrl);
    await until(() => inspector, 'Inspector ausente'); native = await cdp(inspector);
    await until(() => page.evaluate('return Boolean(window.dobra && document.querySelector(".loading-state"));'), 'Shell ausente');
    await until(() => native.evaluate('return process.mainModule.require("electron").BrowserWindow.getAllWindows()[0]?.isVisible();'), 'Shell não ficou visível');
    assert.equal(await native.evaluate('return global.lifecycleFixture.pending;'), true, 'Janela deve aparecer antes do cofre resolver');
    assert.equal(await page.evaluate('return document.querySelector("#engine-toggle").disabled && Boolean(document.querySelector(".loading-state [role=status]"));'), true);
    const shellMs = performance.now() - started;
    const stop = async () => {
      const start = performance.now();
      await native.evaluate('setTimeout(()=>process.mainModule.require("electron").app.quit(),10);return true;').catch(() => {});
      page.close(); native.close();
      let timer;
      const result = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Encerramento excedeu a espera do teste')), 12000); })]).finally(() => clearTimeout(timer));
      assert.equal(result.code, 0, JSON.stringify(result));
      return { ...result, elapsedMs: performance.now() - start };
    };
    return { page, native, shellMs, stop, child };
  } catch (error) { page?.close(); native?.close(); child.kill('SIGKILL'); await exited; throw error; }
}
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dobra-lifecycle-'));
  let instance;
  const sockets = new Set();
  let requests = 0;
  const server = http.createServer(() => { requests++; });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const evidence = { platform: process.platform, electron: require('electron/package.json').version, cases: {} };
  try {
    const early = path.join(directory, 'early');
    instance = await launch(early);
    evidence.cases.loadingClose = { shellMs: instance.shellMs, ...(await instance.stop()) }; instance = null;
    await assert.rejects(fs.access(path.join(early, 'config.json')), { code: 'ENOENT' });
    const profile = path.join(directory, 'running');
    for (let cycle = 0; cycle < 2; cycle++) {
      instance = await launch(profile);
      await instance.native.evaluate('global.lifecycleFixture.releaseVault();return true;');
      const state = await instance.page.evaluate('return await window.dobra.getState();');
      if (cycle === 0) {
        await until(() => instance.native.evaluate('return global.lifecycleFixture.engine.desktop !== global.lifecycleFixture.initialDesktop;'), 'Serviços iniciais não ficaram prontos');
        await delay(50);
        await instance.page.evaluate('window.lifecycleStates=0;window.dobra.onState(()=>window.lifecycleStates++);return true;');
        await instance.native.evaluate('process.mainModule.require("electron").BrowserWindow.getAllWindows()[0].hide();for(let i=0;i<50;i++){global.lifecycleFixture.engine.record("info","progress "+i);global.lifecycleFixture.engine.publish();}return true;');
        await delay(50);
        assert.equal(await instance.page.evaluate('return window.lifecycleStates;'), 0);
        await instance.native.evaluate('process.mainModule.require("electron").BrowserWindow.getAllWindows()[0].show();return true;');
        await until(() => instance.page.evaluate('return window.lifecycleStates===1;'), 'Estado oculto não foi sincronizado ao mostrar');
        evidence.cases.hiddenUpdates = { publications: 50, hiddenDeliveries: 0, restoredDeliveries: 1 };

        const config = structuredClone(state.config), layer = config.layers[0], binding = layer.bindings[0];
        binding.action = { type: 'sequence', steps: [
          { type: 'http', method: 'GET', url: 'http://127.0.0.1:' + server.address().port + '/pending', headers: {}, query: {}, body: '' },
          { type: 'file', directory, filename: 'MUST_NOT_EXIST.txt', mode: 'create', content: 'forbidden later effect' }
        ] };
        await instance.page.evaluate('return await window.dobra.saveConfig(' + JSON.stringify(config) + ');');
        await instance.page.evaluate('window.lifecycleRun=window.dobra.runBinding(' + JSON.stringify(layer.id) + ',' + JSON.stringify(binding.id) + ').catch(()=>null);return true;');
        await until(() => requests > 0, 'HTTP em voo ausente');
        config.layers[0].name = 'Salvamento aceito antes de sair';
        await instance.native.evaluate('global.lifecycleFixture.delayWrites=true;return true;');
        await instance.page.evaluate('window.lifecycleSave=window.dobra.saveConfig(' + JSON.stringify(config) + ').catch(()=>null);return true;');
        await until(() => instance.native.evaluate('return global.lifecycleFixture.atomicPending;'), 'Gravação pendente ausente');
        evidence.cases.busyClose = { shellMs: instance.shellMs, ...(await instance.stop()) }; instance = null;
        assert.equal(JSON.parse(await fs.readFile(path.join(profile, 'config.json'), 'utf8')).layers[0].name, config.layers[0].name);
        JSON.parse(await fs.readFile(path.join(profile, 'config.backup.json'), 'utf8'));
        const events = (await fs.readFile(path.join(profile, 'logs/activity.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        assert.equal(events.filter(event => event.kind === 'action').at(-1).status, 'cancelled');
        await assert.rejects(fs.access(path.join(directory, 'MUST_NOT_EXIST.txt')), { code: 'ENOENT' });
      } else {
        assert.equal(state.config.layers[0].name, 'Salvamento aceito antes de sair');
        evidence.cases.reopen = { shellMs: instance.shellMs, ...(await instance.stop()) }; instance = null;
      }
    }
    evidence.complete = true;
    const output = path.join(root, 'artifacts', 'lifecycle', process.platform + '-' + process.arch + '.json');
    await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    if (instance && instance.child.exitCode === null && instance.child.signalCode === null) { instance.child.kill('SIGKILL'); await new Promise(resolve => instance.child.once('exit', resolve)); }
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
