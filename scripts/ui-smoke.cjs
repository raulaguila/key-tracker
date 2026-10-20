// Real Electron + native IPC. No renderer mocks or external services.
// Linux: xvfb-run -a node scripts/ui-smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');

async function main() {
  if (process.platform !== 'linux' || !process.env.DISPLAY) throw new Error('Este teste de UI usa Linux/X11. Execute: xvfb-run -a npm run test:ui');
  const root = path.resolve(__dirname, '..');
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'keyboard-tracker-ui-'));
  const screenshots = path.join(root, 'artifacts', 'ui-audit');
  await fs.mkdir(screenshots, { recursive: true });
  let responseStatus = 201;
  let request;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    request = { method: req.method, url: req.url, headers: req.headers, body };
    setTimeout(() => { res.writeHead(responseStatus); res.end('OK'); }, 350);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = 'http://127.0.0.1:' + server.address().port + '/event';
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const electron = spawn(require('electron'), [root, '--ozone-platform=x11', '--disable-gpu', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port, ...(process.env.KEY_TRACKER_UI_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])], {
    cwd: root,
    env: { ...process.env, KEYBOARD_TRACKER_DATA_DIR: data, XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'qa-wayland' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  electron.stderr.on('data', chunk => { output = (output + chunk).slice(-6000); });
  let socket;
  const pending = new Map();
  const exceptions = [];
  let id = 0;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    let target;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (electron.exitCode !== null) throw new Error('Electron exited: ' + output);
      try {
        const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
        target = tabs.find(tab => tab.type === 'page' && tab.url.includes('index.html'));
        if (target) break;
      } catch {}
      await delay(100);
    }
    assert.ok(target, 'CDP target available: ' + output);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', event => {
      const value = JSON.parse(event.data);
      if (value.id) {
        const task = pending.get(value.id);
        if (task) { pending.delete(value.id); value.error ? task.reject(new Error(value.error.message)) : task.resolve(value.result); }
      } else if (value.method === 'Runtime.exceptionThrown') exceptions.push(value.params.exceptionDetails);
    });
    socket.addEventListener('close', () => {
      for (const task of pending.values()) task.reject(new Error('Electron disconnected during UI verification.'));
      pending.clear();
    });
    async function cdp(method, params = {}) {
      const requestId = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('CDP timeout: ' + method)); }, 10000);
        timer.unref();
        pending.set(requestId, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    }
    async function evaluate(expression) {
      const result = await cdp('Runtime.evaluate', { expression: '(async () => {' + expression + '})()', awaitPromise: true, returnByValue: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    }
    async function until(expression, message) {
      const end = Date.now() + 10000;
      while (Date.now() < end) { if (await evaluate('return ' + expression)) return; await delay(50); }
      throw new Error(message + '\n' + await evaluate('return document.body.innerText'));
    }
    const click = selector => evaluate('document.querySelector(' + JSON.stringify(selector) + ').click();');
    async function fill(selector, value) {
      await evaluate('const input=document.querySelector(' + JSON.stringify(selector) + ');input.value=' + JSON.stringify(value) + ';input.dispatchEvent(new Event("input",{bubbles:true}));');
    }
    async function select(selector, value) {
      await evaluate('const input=document.querySelector(' + JSON.stringify(selector) + ');input.value=' + JSON.stringify(value) + ';input.dispatchEvent(new Event("change",{bubbles:true}));');
    }
    const nativeState = () => evaluate('return await window.keyboardTracker.getState();');
    const save = () => evaluate('document.querySelector("form[data-draft]").requestSubmit();');
    async function shot(name) {
      const { data: image } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await fs.writeFile(path.join(screenshots, name + '.png'), Buffer.from(image, 'base64'));
    }

    await cdp('Runtime.enable');
    await cdp('Page.enable');
    await until('Boolean(document.querySelector("[data-focus=\\"new-layer\\"]"))', 'Initial UI');
    const initial = await nativeState();
    assert.equal(initial.enabled, false);
    assert.equal(initial.tracking.enabled, false);
    await shot('layers');
    assert.equal(await evaluate('return document.documentElement.dataset.sidebar'), 'collapsed', 'New installations use the compact rail');
    await click('#sidebar-toggle');

    // Sidebar is a visual preference: native keyboard control, reload persistence,
    // accessible labels, and no configuration/draft changes.
    await evaluate('document.querySelector("#sidebar-toggle").focus();');
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    assert.equal(await evaluate('return document.querySelector("#sidebar-toggle").getAttribute("aria-expanded")'), 'false');
    const compactWidth = await evaluate('return document.querySelector(".workspace").getBoundingClientRect().width');
    for (const name of ['layers', 'tracking', 'history', 'settings']) {
      assert.ok(await evaluate('return Boolean(document.querySelector(\'#navigation [data-view="' + name + '"]\').getAttribute("aria-label"))'));
    }
    await evaluate('window.__qaBeforeReload = true;');
    await cdp('Page.reload');
    await until('!window.__qaBeforeReload && Boolean(document.querySelector("[data-focus=\\"new-layer\\"]"))', 'Reloaded UI');
    assert.equal(await evaluate('return document.documentElement.dataset.sidebar'), 'collapsed', 'Sidebar preference survives reload');
    await evaluate('document.querySelector(\'#navigation [data-view="tracking"]\').focus();');
    assert.equal(await evaluate('return getComputedStyle(document.querySelector(\'#navigation [data-view="tracking"] .nav-label\')).visibility'), 'visible', 'Collapsed navigation has focus hints');
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    assert.equal(await evaluate('return getComputedStyle(document.querySelector(\'#navigation [data-view="tracking"] .nav-label\')).visibility'), 'hidden', 'Escape dismisses hints');
    await click('#sidebar-toggle');
    assert.ok(await evaluate('return document.querySelector(".workspace").getBoundingClientRect().width') < compactWidth, 'Collapsing frees content space');
    assert.deepEqual((await nativeState()).config, initial.config, 'Visual preference does not modify actions');

    await click('[data-focus="new-layer"]');
    await fill('#field-name', 'Camada QA');
    await fill('#field-description', 'Validação de UI com dados locais');
    await click('#sidebar-toggle');
    assert.equal(await evaluate('return document.querySelector("#field-description").value'), 'Validação de UI com dados locais', 'Collapse preserves the draft');
    await click('#sidebar-toggle');
    await save();
    await until('!document.querySelector("form[data-draft]")', 'Layer saved');
    let state = await nativeState();
    const layer = state.config.layers.find(layer => layer.name === 'Camada QA');
    assert.ok(layer);
    assert.equal(state.activeLayerId, initial.activeLayerId, 'Editing another layer never changes the active layer');
    await evaluate('Array.from(document.querySelectorAll(".detail-heading button")).find(button => button.textContent.includes("Usar esta camada")).click();');
    await until('(await window.keyboardTracker.getState()).activeLayerId === ' + JSON.stringify(layer.id), 'Explicit use changes the active layer');

    await click('[data-focus="new-binding"]');
    await fill('#field-name', 'HTTP QA');
    await fill('#field-key', 'B');
    await select('#field-type', 'http');
    await fill('#field-url', endpoint);
    await fill('#field-body', '{"key":"{{key}}"}');
    await click('.advanced-fields summary');
    await fill('[name="headers-key"]', 'Content-Type');
    await fill('[name="headers-value"]', 'application/json');
    await fill('[name="query-key"]', 'origem');
    await fill('[name="query-value"]', 'teclado {{key}}');
    await select('#field-type', 'file');
    assert.ok(await evaluate('return Boolean(document.querySelector("#field-directory"))'));
    await select('#field-type', 'http');
    assert.equal(await evaluate('return document.querySelector("[name=\\"headers-value\\"]").value'), 'application/json');
    assert.equal(await evaluate('return document.querySelector("[name=\\"query-value\\"]").value'), 'teclado {{key}}');
    await shot('http-editor');
    await save();
    await until('!document.querySelector("form[data-draft]")', 'HTTP binding saved');
    state = await nativeState();
    const binding = state.config.layers.find(item => item.id === layer.id).bindings[0];
    assert.deepEqual(binding.action.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(binding.action.query, { origem: 'teclado {{key}}' });
    assert.equal(binding.key, 'B');

    await click('[data-focus="test-' + binding.id + '"]');
    assert.equal(await evaluate('return document.querySelector("[data-focus=\\"test-' + binding.id + '\\"]").disabled'), true, 'Pending execution disables repeated test');
    await until('!document.querySelector("[data-focus=\\"test-' + binding.id + '\\"]").disabled', 'HTTP test completed');
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/event?origem=teclado+B');
    assert.equal(request.headers['content-type'], 'application/json');
    assert.equal(request.body, '{"key":"B"}');
    assert.match(await evaluate('return document.querySelector("#toast").textContent'), /HTTP 201/);

    responseStatus = 503;
    await click('[data-focus="test-' + binding.id + '"]');
    await until('Boolean(document.querySelector(".binding-result.error"))', 'Failed HTTP visible inline');
    assert.equal(await evaluate('return document.querySelector("#toast").classList.contains("error")'), true);
    await shot('execution-error');

    await click('[data-focus="edit-' + binding.id + '"]');
    await fill('#field-name', 'Alteração não salva');
    const closeAttempt = evaluate('window.close();');
    closeAttempt.catch(() => {});
    await until('document.querySelector("#confirm-dialog").open', 'Closing the desktop window protects unsaved changes');
    await click('#confirm-dialog [data-cancel]');
    await closeAttempt;
    assert.equal(await evaluate('return document.querySelector("#field-name").value'), 'Alteração não salva');
    await click('[data-view="history"]');
    assert.equal(await evaluate('return document.querySelector("#confirm-dialog").open'), true);
    await click('#confirm-dialog [data-cancel]');
    assert.equal(await evaluate('return document.querySelector("#field-name").value'), 'Alteração não salva');
    await click('[data-view="history"]');
    await click('#confirm-dialog .danger-solid');
    await until('Boolean(document.querySelector("#events"))', 'Discard permits navigation');
    assert.equal((await nativeState()).config.layers.find(item => item.id === layer.id).bindings[0].name, 'HTTP QA');
    await fill('#field-history-search', 'mensagem que não existe');
    assert.match(await evaluate('return document.querySelector("#events").textContent'), /Nenhum evento encontrado/);
    await fill('#field-history-search', '');
    await shot('history');

    await click('[data-view="settings"]');
    await fill('#field-layerShortcut', 'F9');
    await click('[data-view="tracking"]');
    assert.equal(await evaluate('return document.querySelector("#confirm-dialog").open'), true);
    await click('#confirm-dialog [data-cancel]');
    assert.equal(await evaluate('return document.querySelector("#field-layerShortcut").value'), 'F9');
    await save();
    await until('document.querySelector("#draft-status")?.textContent === "Nenhuma alteração pendente"', 'Settings saved');
    assert.equal((await nativeState()).config.settings.layerShortcut, 'F9');
    await shot('settings');
    assert.equal(await evaluate('return document.querySelector(".storage-details").open'), false);
    await click('.storage-details summary');
    assert.ok(await evaluate('return document.querySelector(".path-list").innerText.length > 0'), 'File locations remain available on demand');
    await click('.support-details summary');
    assert.ok(await evaluate('return document.querySelector(".platform-note").innerText.includes("Wayland")'), 'Platform guidance remains available');

    await click('[data-view="tracking"]');
    await click('input[role="switch"]');
    await until('Boolean(document.querySelector(".tracking-limitation"))', 'Wayland fallback visible');
    assert.equal((await nativeState()).tracking.mode, 'local');
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: '1', code: 'Numpad1', windowsVirtualKeyCode: 97 });
    assert.equal(await evaluate('return document.querySelectorAll(".keycap.pressed").length'), 2);
    assert.equal(await evaluate('return document.querySelectorAll(".pressed-chip").length'), 2, 'Pressed keys are DOM chips, not stringified elements');
    assert.ok(!await evaluate('return document.querySelector("#pressed-keys").textContent.includes("[object")'));
    await delay(180);
    await shot('tracking');
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: '1', code: 'Numpad1', windowsVirtualKeyCode: 97 });
    assert.equal(await evaluate('return document.querySelectorAll(".keycap.pressed").length'), 0);
    await click('input[role="switch"]');
    assert.equal((await nativeState()).tracking.enabled, false);

    const configBeforePreview = (await nativeState()).config;
    for (const [layout, code, label] of [['br', 'Semicolon', 'Ç'], ['us', 'Semicolon', ';'], ['pt', 'Quote', 'º'], ['fr', 'KeyQ', 'A'], ['de', 'KeyY', 'Z']]) {
      await select('#field-keyboard-layout', layout);
      assert.equal(await evaluate('return document.querySelector(\'.keycap[data-code="' + code + '"]\').textContent'), label, 'Layout legends: ' + layout);
    }
    await select('#field-keyboard-layout', 'br');
    assert.ok(await evaluate('return Boolean(document.querySelector(".iso-enter") && document.querySelector(\'.keycap[data-code="IntlRo"]\'))'), 'ABNT2 includes ISO Enter and the extra slash');
    for (const size of ['compact', 'tkl', 'full']) {
      await select('#field-keyboard-size', size);
      assert.equal(await evaluate('return Boolean(document.querySelector(".keyboard-numpad"))'), size === 'full');
      assert.equal(await evaluate('return Boolean(document.querySelector(".keyboard-navigation"))'), size !== 'compact');
    }
    await click('input[role="switch"]');
    await until('(await window.keyboardTracker.getState()).tracking.mode === "local"', 'Local capture ready for international keys');
    await evaluate('document.activeElement.blur();');
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ç', code: 'Semicolon', windowsVirtualKeyCode: 186 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: '/', code: 'IntlRo', windowsVirtualKeyCode: 193 });
    assert.equal(await evaluate('return document.querySelectorAll(".keycap.pressed").length'), 2);
    assert.ok(await evaluate('return document.querySelector("#pressed-keys").textContent.includes("ç")'));
    await delay(180);
    assert.notEqual(await evaluate('return getComputedStyle(document.querySelector(".keycap.pressed")).backgroundColor'), await evaluate('return getComputedStyle(document.querySelector(\'.keycap[data-code="KeyQ"]\')).backgroundColor'), 'Pressed keys have a distinct visible fill');
    await shot('tracking-abnt2');
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ç', code: 'Semicolon', windowsVirtualKeyCode: 186 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: '/', code: 'IntlRo', windowsVirtualKeyCode: 193 });
    await click('input[role="switch"]');
    await click('.keyboard-help summary');
    await select('#field-keyboard-geometry', 'ansi');
    assert.equal(await evaluate('return Boolean(document.querySelector(".iso-enter"))'), false, 'Physical reference can override the language layout');
    await select('#field-keyboard-size', 'compact');
    await evaluate('window.__qaBeforeReload = true;');
    await cdp('Page.reload');
    await until('!window.__qaBeforeReload && Boolean(document.querySelector("[data-focus=\\"new-layer\\"]"))', 'Preview preferences reload');
    await click('[data-view="tracking"]');
    assert.equal(await evaluate('return document.querySelector("#field-keyboard-layout").value'), 'br');
    assert.equal(await evaluate('return document.querySelector("#field-keyboard-size").value'), 'compact');
    assert.equal(await evaluate('return document.querySelector("#field-keyboard-geometry").value'), 'ansi');
    assert.deepEqual((await nativeState()).config, configBeforePreview, 'Keyboard preview preferences never modify exported action data');
    await click('.keyboard-help summary');
    await select('#field-keyboard-geometry', 'auto');
    await select('#field-keyboard-size', 'full');

    // Exercise the real Electron API first, then permission/timeout fallback and
    // a late result arriving after a manual choice. No native IPC is replaced.
    await select('#field-keyboard-layout', 'auto');
    await until('!document.querySelector("#layout-status").textContent.includes("Lendo")', 'System layout read settles');
    await evaluate('window.__qaKeyboard = navigator.keyboard; Object.defineProperty(navigator,"keyboard",{configurable:true,value:{getLayoutMap:async()=>{throw new Error("QA denied");}}});');
    await select('#field-keyboard-layout', 'us');
    await select('#field-keyboard-layout', 'auto');
    await until('document.querySelector("#layout-status").textContent.includes("indisponível")', 'Unavailable layout is explicit');
    await evaluate('Object.defineProperty(navigator,"keyboard",{configurable:true,value:{getLayoutMap:()=>new Promise(resolve=>{window.__qaResolveMap=resolve;})}});');
    await select('#field-keyboard-layout', 'us');
    await select('#field-keyboard-layout', 'auto');
    await select('#field-keyboard-layout', 'br');
    await evaluate('window.__qaResolveMap(new Map([["Semicolon","x"]])); Object.defineProperty(navigator,"keyboard",{configurable:true,value:window.__qaKeyboard});');
    assert.equal(await evaluate('return document.querySelector(\'.keycap[data-code="Semicolon"]\').textContent'), 'Ç', 'Late system responses cannot replace a manual layout');

    await click('[data-view="layers"]');
    await click('[data-focus="new-binding"]');
    await fill('#field-name', 'Log QA');
    await fill('#field-key', 'C');
    await fill('#field-message', 'Mensagem local de teste');
    await save();
    await until('!document.querySelector("form[data-draft]")', 'Log binding created');
    const logBinding = (await nativeState()).config.layers.find(item => item.id === layer.id).bindings.find(item => item.name === 'Log QA');
    await click('[data-focus="edit-' + logBinding.id + '"]');
    await fill('#field-name', 'Log QA atualizado');
    await save();
    await until('!document.querySelector("form[data-draft]")', 'Binding edit saved');
    assert.equal((await nativeState()).config.layers.find(item => item.id === layer.id).bindings.find(item => item.id === logBinding.id).name, 'Log QA atualizado');
    await click('[data-focus="remove-' + logBinding.id + '"]');
    await click('#confirm-dialog [data-cancel]');
    assert.ok((await nativeState()).config.layers.find(item => item.id === layer.id).bindings.some(item => item.id === logBinding.id));
    await click('[data-focus="remove-' + logBinding.id + '"]');
    await click('#confirm-dialog .danger-solid');
    await until('!(await window.keyboardTracker.getState()).config.layers.find(item => item.id === ' + JSON.stringify(layer.id) + ').bindings.some(item => item.id === ' + JSON.stringify(logBinding.id) + ')', 'Binding deleted only after confirmation');
    await fill('#field-action-search', 'não corresponde a nenhuma ação');
    assert.match(await evaluate('return document.querySelector("#bindings").textContent'), /Nenhuma ação encontrada/);
    await fill('#field-action-search', '');

    await click('[data-focus="new-layer"]');
    await fill('#field-name', 'Camada temporária');
    await save();
    await until('!document.querySelector("form[data-draft]")', 'Temporary layer created');
    const temporaryLayer = (await nativeState()).config.layers.find(item => item.name === 'Camada temporária');
    await click('[data-focus="edit-layer"]');
    await fill('#field-description', 'Descrição editada');
    await save();
    await until('!document.querySelector("form[data-draft]")', 'Layer edit saved');
    await click('[data-focus="edit-layer"]');
    await click('.danger-zone button');
    await click('#confirm-dialog .danger-solid');
    await until('!(await window.keyboardTracker.getState()).config.layers.some(item => item.id === ' + JSON.stringify(temporaryLayer.id) + ')', 'Layer deleted after confirmation');
    assert.equal((await nativeState()).activeLayerId, layer.id, 'Deleting an unused layer preserves the active layer');

    for (const width of [1440, 1280, 980, 800, 760, 580, 390]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      for (const collapsed of [false, true]) {
        const current = await evaluate('return document.documentElement.dataset.sidebar === "collapsed"');
        if (current !== collapsed) await click('#sidebar-toggle');
        for (const name of ['layers', 'tracking', 'history', 'settings']) {
          await click('[data-view="' + name + '"]');
          const dimensions = await evaluate('return {width:innerWidth,scroll:document.documentElement.scrollWidth}');
          assert.ok(dimensions.scroll <= dimensions.width, 'No page overflow at ' + width + 'px, ' + name + ', collapsed=' + collapsed + ': ' + JSON.stringify(dimensions));
          if ([1280, 800, 390].includes(width)) await shot(name + '-' + width + (collapsed ? '-collapsed' : '-expanded'));
        }
      }
      if ([1280, 800, 390].includes(width)) await shot('settings-' + width);
    }
    await cdp('Emulation.clearDeviceMetricsOverride');
    assert.equal(exceptions.length, 0, 'No uncaught renderer exceptions: ' + JSON.stringify(exceptions));
    const stored = JSON.parse(await fs.readFile(path.join(data, 'config.json'), 'utf8'));
    assert.equal(stored.settings.layerShortcut, 'F9');
    assert.ok(stored.layers.some(item => item.id === layer.id));
    console.log('UI smoke passed: compact table/editor, sidebar keyboard control/persistence/draft protection, five layouts + three sizes + geometry override, preview persistence, automatic layout fallback/races, international simultaneous keys, CRUD, native IPC persistence, HTTP pairs/drafts, real HTTP success/error, pending feedback, unsaved guards, settings, and 56 responsive combinations.');
    console.log('Screenshots: ' + screenshots);
  } finally {
    socket?.close();
    electron.kill();
    await new Promise(resolve => { if (electron.exitCode !== null) resolve(); else { electron.once('exit', resolve); setTimeout(() => { electron.kill('SIGKILL'); resolve(); }, 3000).unref(); } });
    await new Promise(resolve => server.close(resolve));
    await fs.rm(data, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
