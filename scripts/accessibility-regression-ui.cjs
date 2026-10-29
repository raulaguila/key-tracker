const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

// Regression coverage for the Impeccable audit. Real windows, IPC and execution
// results, using only the smoke harness's disposable profile and local log action.
module.exports = async function accessibilityRegression({ cdp, evaluate, click, select, press, until, nativeState, nativeEvaluate }) {
  const before = await nativeState();
  const preferences = await evaluate('return {theme:window.dobraAppearance.preference,values:Object.fromEntries(["dobra.first-automation","dobra.binding-view","dobra.keyboard-preview"].map(key=>[key,localStorage.getItem(key)]))};');
  const dir = path.resolve('artifacts/impeccable-revalidation');
  await fs.mkdir(dir, { recursive: true });
  const evidence = { history: [], touch: [], panel: [], mainZoom: [], axeStates: 0 };
  const config = structuredClone(before.config), layer = config.layers[0];
  layer.name = 'Auditoria · automações';
  layer.bindings = [{ id: 'accessibility-probe', name: 'Conferir detalhes da sequência', key: 'Control+Alt+S', action: { type: 'sequence', stepDelayMs: 0, steps: [{ type: 'log', message: 'audit-one' }, { type: 'log', message: 'audit-two' }] } }];
  const electron = 'process.mainModule.require("electron")';
  const mainWindow = electron + '.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes("index.html"))';
  const zoom = value => nativeEvaluate(mainWindow + '.webContents.setZoomFactor(' + value + ')');
  const settle = () => evaluate('await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));');
  const run = () => evaluate('await window.dobra.runBinding(' + JSON.stringify(layer.id) + ',"accessibility-probe");');
  const axe = await fs.readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
  const axeCheck = `axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})))`;
  async function check(name) {
    await evaluate('await Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));');
    assert.deepEqual(await evaluate('return await ' + axeCheck), [], 'Accessibility regression: ' + name);
    evidence.axeStates++;
  }
  async function shot(name) {
    const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await fs.writeFile(path.join(dir, name + '.png'), Buffer.from(data, 'base64'));
  }
  let panel;
  try {
    await evaluate('document.activeElement.blur();await window.dobra.setEnabled(false);await window.dobra.saveConfig(' + JSON.stringify(config) + ');await window.dobra.setLayer(' + JSON.stringify(layer.id) + ');localStorage.setItem("dobra.first-automation",JSON.stringify({version:2,dismissed:true}));localStorage.setItem("dobra.binding-view","table");window.__regressionReload=true;');
    await cdp('Page.reload');
    await until('!window.__regressionReload && Boolean(document.querySelector("[data-focus=new-binding]"))', 'Accessibility regression ready');
    await cdp('Runtime.evaluate', { expression: axe });
    await run();
    await click('[data-view=history]');
    for (const theme of ['light', 'dark']) {
      await evaluate('window.dobraAppearance.set(' + JSON.stringify(theme) + ');const summary=document.querySelector(".execution-steps summary");summary.parentElement.open=true;summary.focus();window.__historyProbe={summary,row:summary.closest("tr"),body:summary.closest("tbody")};');
      const count = await evaluate('return document.querySelectorAll("#events tbody tr").length');
      await run();
      await until('document.querySelectorAll("#events tbody tr").length>' + count, 'New result rendered');
      const result = await evaluate('const p=window.__historyProbe;return {theme:document.documentElement.dataset.theme,focused:document.activeElement===p.summary,connected:p.summary.isConnected,expanded:p.summary.parentElement.open,sameTable:p.body===document.querySelector("#events tbody"),sameRow:p.row===p.summary.closest("tr")};');
      assert.ok(result.focused && result.connected && result.expanded && result.sameTable && result.sameRow, 'Live history preserves focus, open details and row identity: ' + JSON.stringify(result));
      evidence.history.push(result);
      await check('history/' + theme); await shot('history-focus-' + theme);
    }
    // Eviction at the 100-event session limit must leave a usable focus target.
    await evaluate('[...document.querySelectorAll("#events summary")].at(-1).focus();window.__evictedSummary=document.activeElement;');
    for (let index = 0; index < 101; index++) await run();
    await until('!window.__evictedSummary.isConnected', 'Focused event evicted at session limit');
    assert.equal(await evaluate('return document.activeElement.id'), 'field-history-search', 'Eviction returns focus to history search');
    assert.equal(await evaluate('return document.querySelectorAll("#events tbody tr").length'), 100, 'History stays bounded');
    evidence.historyEviction = { boundedRows: 100, focus: 'field-history-search' };
    await evaluate('const input=document.querySelector("#field-history-search");input.value="sem resultado de auditoria";input.dispatchEvent(new Event("input",{bubbles:true}));');
    assert.equal(await evaluate('return document.querySelectorAll("#events tbody tr").length'), 0, 'Search transitions to empty state');
    await evaluate('const input=document.querySelector("#field-history-search");input.value="";input.dispatchEvent(new Event("input",{bubbles:true}));');
    assert.equal(await evaluate('return document.querySelectorAll("#events tbody tr").length'), 100, 'Clearing search rebuilds valid results');

    await zoom(2);
    for (const theme of ['light', 'dark']) {
      await evaluate('window.dobraAppearance.set(' + JSON.stringify(theme) + ')');
      for (const view of ['layers', 'tracking', 'history', 'settings']) {
        await click('[data-view=' + view + ']'); await settle();
        const result = await evaluate('return {width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth};');
        assert.ok(result.pageWidth <= result.width, 'No page overflow at 200%: ' + view);
        evidence.mainZoom.push({ theme, view, ...result });
        await check('zoom200/' + theme + '/' + view);
      }
    }
    await zoom(1);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 760, height: 580, deviceScaleFactor: 1, mobile: true });
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await require('./touch-targets-ui.cjs')({ cdp, evaluate, click, select, press, until, check, shot, evidence });
    for (const layout of ['br', 'us', 'pt', 'fr', 'de']) {
      await click('[data-view=tracking]'); await select('#field-keyboard-layout', layout);
      for (const size of ['full', 'tkl', 'compact']) {
        await click('[data-view=tracking]'); await select('#field-keyboard-size', size);
        await click('[data-view=layers]'); await click('[data-focus=view-keyboard]');
        for (const theme of ['light', 'dark']) {
          await evaluate('window.dobraAppearance.set(' + JSON.stringify(theme) + ')'); await settle();
          const result = await evaluate(`const keys=[...document.querySelectorAll('.keyboard-interactive button:not(:disabled)')].map(node=>{const r=node.getBoundingClientRect();return {code:node.dataset.code,width:r.width,height:r.height};});return {coarse:matchMedia('(pointer:coarse)').matches,count:keys.length,undersized:keys.filter(r=>r.width<43.99||r.height<43.99),minWidth:Math.min(...keys.map(r=>r.width)),minHeight:Math.min(...keys.map(r=>r.height)),pageOverflow:document.documentElement.scrollWidth>innerWidth};`);
          assert.ok(result.coarse && result.count > 0, 'Touch input emulated');
          assert.deepEqual(result.undersized, [], '44px touch keys: ' + layout + '/' + size + '/' + theme);
          assert.equal(result.pageOverflow, false, 'Keyboard scroll stays in its region');
          evidence.touch.push({ layout, size, theme, ...result });
          if (layout === 'br' && size === 'full') { await check('touch/' + theme); await shot('touch-keyboard-' + theme); }
        }
      }
    }
    // Exercise the enlarged ISO Enter's lower arm using an actual touch event.
    await click('[data-view=tracking]'); await select('#field-keyboard-layout', 'br'); await select('#field-keyboard-size', 'full');
    await click('[data-view=layers]'); await click('[data-focus=view-keyboard]');
    const point = await evaluate('const key=document.querySelector(".keyboard-interactive button[data-code=Enter]");key.scrollIntoView({block:"center",inline:"center"});const r=key.getBoundingClientRect();return {x:r.right-10,y:r.top+70};');
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, radiusX: 1, radiusY: 1, force: 1, id: 1 }] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await until('Boolean(document.querySelector("#editor-drawer[open]"))', 'ISO Enter touch opens action editor');
    assert.equal(await evaluate('return document.querySelector("#field-key").value'), 'Enter', 'ISO Enter lower arm selects the correct key');
    await click('[data-drawer-close]');
    await until('!document.querySelector("#editor-drawer")', 'Untouched action drawer closed');
    await evaluate('document.querySelector(".keyboard-interactive button[data-code=KeyA]").focus();');
    await press('ArrowRight', 'ArrowRight', 39);
    assert.notEqual(await evaluate('return document.activeElement.dataset.code'), 'KeyA', 'Spatial keyboard navigation works at touch size');
    evidence.touchInteraction = { isoEnter: true, arrowNavigation: true };
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
    await cdp('Emulation.clearDeviceMetricsOverride');

    await evaluate('await window.dobra.showQuickPanel();');
    await nativeEvaluate('new Promise((resolve,reject)=>{let n=0;const check=()=>{const w=' + electron + '.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes("quick-panel.html"));if(w?.isVisible()){globalThis.__accessibilityPanel=w;resolve(true);}else if(n++>100)reject(new Error("Panel unavailable"));else setTimeout(check,20);};check();})');
    panel = true;
    const panelEvaluate = code => nativeEvaluate('globalThis.__accessibilityPanel.webContents.executeJavaScript(' + JSON.stringify(code) + ')');
    await panelEvaluate(axe);
    for (const theme of ['light', 'dark']) {
      await evaluate('window.dobraAppearance.set(' + JSON.stringify(theme) + ')');
      for (const [width, height] of [[380, 500], [300, 240]]) {
        for (const factor of [1, 2]) {
          await nativeEvaluate('globalThis.__accessibilityPanel.setSize(' + width + ',' + height + ');globalThis.__accessibilityPanel.webContents.setZoomFactor(' + factor + ');');
          await panelEvaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
          const result = await panelEvaluate(`(()=>{const list=document.querySelector('.quick-bindings');list.focus();list.firstElementChild.scrollIntoView({block:'center'});const r=list.firstElementChild.getBoundingClientRect();return {viewport:{width:innerWidth,height:innerHeight},listHeight:list.clientHeight,itemVisible:r.bottom>0&&r.top<innerHeight,pageOverflow:document.documentElement.scrollWidth>innerWidth,focused:document.activeElement===list};})()`);
          assert.ok(result.listHeight > 0 && result.itemVisible && result.focused && !result.pageOverflow, 'Quick panel shortcuts remain readable: ' + JSON.stringify({ theme, width, height, factor, ...result }));
          assert.deepEqual(await panelEvaluate(axeCheck), [], 'Quick panel accessibility at ' + factor * 100 + '%');
          evidence.axeStates++;
          const footerVisible = await panelEvaluate(`(()=>{const button=document.querySelector('.quick-footer button');button.focus();button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()`);
          assert.ok(footerVisible, 'Open Dobra remains reachable at ' + factor * 100 + '%');
          if (factor === 1 && width === 380) assert.equal(await panelEvaluate('document.documentElement.scrollHeight<=innerHeight+1'), true, 'Default panel keeps its compact layout');
          evidence.panel.push({ theme, width, height, zoom: factor, footerVisible, ...result });
          if (factor === 2) {
            await panelEvaluate('document.querySelector(".quick-bindings").scrollIntoView({block:"center"})');
            const image = await nativeEvaluate('(async()=> (await globalThis.__accessibilityPanel.webContents.capturePage()).toPNG().toString("base64"))()');
            await fs.writeFile(path.join(dir, 'panel200-' + theme + '-' + width + '.png'), Buffer.from(image, 'base64'));
          }
        }
      }
    }
    console.log('Accessibility audit regressions passed: history focus/open details/reused rows/session eviction/search, 30 touch keyboard cases, ' + evidence.touchControls.length + ' capture/expand touch cases with bottom-edge interaction, ISO Enter touch, arrow navigation, 8 main zoom states, 8 panel size/zoom/theme cases, ' + evidence.axeStates + ' axe states.');
  } finally {
    await fs.writeFile(path.join(dir, 'runtime.json'), JSON.stringify(evidence, null, 2));
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
    await cdp('Emulation.clearDeviceMetricsOverride');
    await zoom(1);
    if (panel) { await nativeEvaluate('globalThis.__accessibilityPanel.webContents.setZoomFactor(1);delete globalThis.__accessibilityPanel;'); await evaluate('await window.dobra.hideQuickPanel();'); }
    await evaluate('document.querySelectorAll("form[data-draft]").forEach(form=>form.removeAttribute("data-draft"));document.querySelector("#editor-drawer")?.close();document.querySelector("#confirm-dialog")?.close();document.activeElement.blur();await window.dobra.setEnabled(false);await window.dobra.saveConfig(' + JSON.stringify(before.config) + ');await window.dobra.setLayer(' + JSON.stringify(before.activeLayerId) + ');window.dobraAppearance.set(' + JSON.stringify(preferences.theme) + ');for(const [key,value] of Object.entries(' + JSON.stringify(preferences.values) + ')){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}window.__regressionReload=true;');
    await cdp('Page.reload');
    await until('!window.__regressionReload && Boolean(document.querySelector("[data-focus=new-layer]"))', 'Original profile restored');
  }
};
