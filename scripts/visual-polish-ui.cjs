const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

// Real windows/IPC in ui-smoke's temporary profile. No action is executed.
module.exports = async function visualPolish({ cdp, evaluate, click, until, nativeState, nativeEvaluate, shot }) {
  const before = await nativeState();
  const appearance = await evaluate('return window.dobraAppearance.preference');
  const preferences = await evaluate('return {guide:localStorage.getItem("dobra.first-automation"),view:localStorage.getItem("dobra.binding-view")}');
  const findings = {};
  const config = structuredClone(before.config), layer = config.layers[0];
  layer.name = 'Atalhos para revisão visual com nomes extensos e contexto de trabalho '.padEnd(80, 'Z');
  layer.description = 'Descrição da camada para conferir que textos extensos continuam legíveis. '.repeat(3).slice(0, 240);
  layer.bindings = [{ id: 'visual-polish-action', name: 'Uma ação com nome extenso para testar menus, confirmações e combinações sem perder a legibilidade'.padEnd(100, 'Z'), key: 'CommandOrControl+Alt+Shift+F11', action: { type: 'clipboard', text: 'Texto de revisão visual. Nenhuma execução necessária.' } }];
  let panel;
  const escape = async () => { await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); };
  const viewport = (width = 1280, height = 900) => cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  async function check(name) {
    const result = await evaluate(`await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));return (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));`);
    assert.deepEqual(result, [], 'Visual accessibility: ' + name);
    assert.equal(await evaluate('return document.documentElement.scrollWidth<=innerWidth'), true, 'No page overflow: ' + name);
  }
  try {
    await evaluate('await window.dobra.setEnabled(false);await window.dobra.saveConfig(' + JSON.stringify(config) + ');await window.dobra.setLayer(' + JSON.stringify(layer.id) + ');localStorage.setItem("dobra.first-automation",JSON.stringify({version:2,dismissed:true}));localStorage.setItem("dobra.binding-view","table");window.__polishReload=true;');
    await cdp('Page.reload');
    await until('!window.__polishReload && Boolean(document.querySelector("[data-focus=new-binding]"))', 'Visual review ready');
    const axe = await fs.readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
    await cdp('Runtime.evaluate', { expression: axe });
    for (const theme of ['dark', 'light']) {
      await viewport(); await click('[data-view=layers]');
      // Sample every frame of an actual theme change, rather than testing only settled colors.
      findings[theme + 'ThemeContrast'] = await evaluate(`
        const button=document.querySelector('[data-focus=new-binding]'), canvas=document.createElement('canvas');canvas.width=canvas.height=1;
        const context=canvas.getContext('2d');
        const luminance=color=>{context.fillStyle=color;context.fillRect(0,0,1,1);const rgb=[...context.getImageData(0,0,1,1).data].slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
        window.dobraAppearance.set(${JSON.stringify(theme)});const ratios=[];
        for(let index=0;index<14;index++){const style=getComputedStyle(button),a=luminance(style.color),b=luminance(style.backgroundColor);ratios.push((Math.max(a,b)+.05)/(Math.min(a,b)+.05));await new Promise(requestAnimationFrame);}
        return Math.min(...ratios);
      `);
      assert.ok(findings[theme + 'ThemeContrast'] >= 4.5, 'Theme change preserves primary button contrast: ' + theme);
      for (const view of ['layers', 'tracking', 'history', 'settings']) {
        await click('[data-view=' + view + ']');
        for (const width of [1280, 390]) { await viewport(width); await check(theme + '/' + view + '/' + width); await shot('polish-' + view + '-' + theme + '-' + width); }
      }
      await viewport(); await click('[data-view=layers]');
      await click('[data-focus=more-visual-polish-action]');
      const remove = '[data-focus=remove-visual-polish-action]';
      const point = await evaluate('const r=document.querySelector(' + JSON.stringify(remove) + ').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};');
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      findings[theme + 'DangerHover'] = await evaluate('return getComputedStyle(document.querySelector(' + JSON.stringify(remove) + ')).color===getComputedStyle(document.querySelector("#notice")).color');
      assert.equal(findings[theme + 'DangerHover'], true, 'Destructive menu item stays red on hover');
      await check(theme + '/action-menu'); await shot('polish-menu-' + theme);
      await click(remove); await until('document.querySelector("#confirm-dialog").open', 'Removal confirmation ready');
      assert.equal(await evaluate('return getComputedStyle(document.querySelector("#confirm-dialog .dialog-symbol")).color===getComputedStyle(document.querySelector("#notice")).color'), true, 'Destructive confirmation uses the error color');
      for (const width of [1280, 390]) {
        await viewport(width); await check(theme + '/confirmation/' + width); await shot('polish-confirmation-' + theme + '-' + width);
        assert.equal(await evaluate('const r=document.querySelector("#confirm-dialog").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight'), true, 'Long confirmation fits window');
      }
      await click('#confirm-dialog [data-cancel]');
      await viewport(); await click('[data-focus=model-library]'); await until('document.querySelectorAll(".template-row").length===3', 'Library ready');
      await evaluate('document.querySelector(".template-row button").click();'); await until('Boolean(document.querySelector(".import-layer-row input"))', 'Import selection ready');
      findings[theme + 'CheckboxAccent'] = await evaluate('return getComputedStyle(document.querySelector(".import-layer-row input")).accentColor');
      assert.notEqual(findings[theme + 'CheckboxAccent'], 'auto', 'Import checkbox shares the accent color');
      await check(theme + '/import'); await shot('polish-import-' + theme); await escape();
    }
    await evaluate('await window.dobra.showQuickPanel();');
    await nativeEvaluate('new Promise((resolve,reject)=>{let n=0;const check=()=>{const win=process.mainModule.require("electron").BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes("quick-panel.html"));if(win?.isVisible()){globalThis.__polishPanel=win;resolve();}else if(n++>100)reject(new Error("Panel unavailable"));else setTimeout(check,20);};check();})');
    panel = true;
    await nativeEvaluate('globalThis.__polishPanel.setSize(300,240)');
    const bounds = await nativeEvaluate('globalThis.__polishPanel.webContents.executeJavaScript(' + JSON.stringify('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{document.querySelector(".quick-footer").scrollIntoView({block:"end"});const footer=document.querySelector(".quick-footer").getBoundingClientRect();resolve({top:footer.top,bottom:footer.bottom,height:innerHeight,list:document.querySelector(".quick-bindings").clientHeight,title:document.querySelector("h1").title});})))') + ')');
    assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.height + 1 && bounds.list > 0, 'Long layer name keeps the list nonzero and footer reachable by scrolling');
    assert.equal(bounds.title, layer.name, 'Full layer name remains available');
    console.log('Visual review evidence: ' + JSON.stringify(findings));
  } finally {
    if (panel) { await evaluate('await window.dobra.hideQuickPanel();'); await nativeEvaluate('delete globalThis.__polishPanel;'); }
    await cdp('Emulation.clearDeviceMetricsOverride');
    await evaluate('document.querySelector(".productivity-dialog")?.close();document.querySelector("#confirm-dialog")?.close();await window.dobra.setEnabled(false);await window.dobra.saveConfig(' + JSON.stringify(before.config) + ');await window.dobra.setLayer(' + JSON.stringify(before.activeLayerId) + ');window.dobraAppearance.set(' + JSON.stringify(appearance) + ');const preferences=' + JSON.stringify(preferences) + ';for(const [key,value] of [["dobra.first-automation",preferences.guide],["dobra.binding-view",preferences.view]]){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}');
  }
};
