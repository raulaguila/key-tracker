// Real renderer and IPC against an isolated profile; only this local HTTP fixture
// and the temporary test clipboard receive effects. No host input is observed.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
module.exports = async ({ cdp, evaluate, click, fill, select, until, nativeState, save, shot, nativeEvaluate }) => {
  if (process.env.DOBRA_UI_LINUX_INSTALL_ONLY === '1') return require('./linux-install-ui.cjs')({ cdp, evaluate, click, until, nativeState, nativeEvaluate, shot });
  if (process.env.DOBRA_UI_AUDIT_ONLY === '1') return require('./productivity-audit-ui.cjs')({ cdp, evaluate, click, until, nativeState, nativeEvaluate, shot });
  const before = await nativeState();
  const config = structuredClone(before.config);
  delete config.settings.momentaryShortcut; delete config.settings.momentaryLayerId; delete config.settings.inputDeviceId;
  config.layers = [{ id: 'expansion-main', name: 'Expansão QA', description: '', applications: [], bindings: [] }, { id: 'expansion-target', name: 'Temporária QA', description: '', applications: [], bindings: [] }];
  const clipboardExpression = 'process.mainModule.require("electron").clipboard';
  const clipboardBefore = await nativeEvaluate(clipboardExpression + '.readText()');
  let requests = 0;
  const server = http.createServer((req, res) => { requests++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ greeting: 'Resposta efêmera QA' })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = 'http://127.0.0.1:' + server.address().port + '/lookup';
  const axeSource = await fs.readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
  await cdp('Runtime.evaluate', { expression: axeSource });
  async function accessible(name) { const violations = await evaluate("await Promise.all(document.getAnimations().filter(item=>item.effect?.getTiming().iterations!==Infinity).map(item=>item.finished.catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)}));"); assert.deepEqual(violations, [], 'Productivity accessibility: ' + name); }
  const title = text => 'document.querySelector(".productivity-dialog h2")?.textContent===' + JSON.stringify(text);
  const buttonText = async text => evaluate('const node=[...document.querySelectorAll(".productivity-dialog button")].find(item=>item.textContent.trim()===' + JSON.stringify(text) + ');if(!node)throw new Error("Missing dialog button");node.click();');
  const escape = async () => { await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }); };
  async function libraryClipboard() {
    await click('[data-view="layers"]'); await click('[data-focus="model-library"]');
    await until(title('Biblioteca de modelos') + ' && document.querySelectorAll(".template-row").length===3', 'Three local models available');
    const templates = await evaluate('return await window.dobra.getTemplates()'); const name = templates.find(item => item.id === 'clipboard').name;
    await evaluate('document.querySelector(' + JSON.stringify('[aria-label="Revisar modelo: ' + name + '"]') + ').click();');
    await until(title('Adicionar camadas') + ' && Boolean(document.querySelector(".import-layer-row"))', 'Import preview shown');
  }
  async function reviewAndApply() {
    await buttonText('Revisar alterações'); await until('!document.querySelector(".import-review").hidden', 'Plan review visible');
    await buttonText('Adicionar camadas'); await until('!document.querySelector(".productivity-dialog")', 'Plan applied once');
    assert.equal((await nativeState()).enabled, false);
  }
  async function stepField(index, name, value) {
    const selector = await evaluate('const step=document.querySelectorAll("[data-sequence-step]")[' + index + '];const field=step.querySelector(' + JSON.stringify('[name$="-' + name + '"]') + ');for(let parent=field.parentElement;parent;parent=parent.parentElement)if(parent.tagName==="DETAILS")parent.open=true;return "#"+field.id;');
    const tag = await evaluate('return document.querySelector(' + JSON.stringify(selector) + ').tagName'); await (tag === 'SELECT' ? select : fill)(selector, value);
  }
  try {
    await evaluate('await window.dobra.setEnabled(false);await window.dobra.saveConfig(' + JSON.stringify(config) + ');document.activeElement.blur();');
    await click('[data-view="layers"]'); await until('document.querySelector("#layer-title")?.textContent==="Expansão QA"', 'Expansion layer visible');
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",ctrlKey:true,bubbles:true}));');
    await until(title('Buscar no Dobra'), 'Ctrl K opens global palette');
    await accessible('command palette');
    await fill('#field-command-search', 'Temporária QA');
    assert.equal(await evaluate('return document.querySelectorAll(".command-result").length'), 2);
    await evaluate('document.querySelector(".command-result").click();');
    await until('Boolean(document.querySelector("#editor-drawer"))', 'Palette opens layer editor');
    assert.equal(await evaluate('return document.querySelector("#field-name").value'), 'Temporária QA');
    assert.equal(await evaluate('return document.querySelector("[data-view=layers]").getAttribute("aria-current")'), 'page');
    await click('[data-drawer-close]');
    await libraryClipboard(); await reviewAndApply(); assert.equal((await nativeState()).config.layers.length, 3);
    assert.notEqual(await evaluate('return document.querySelector("#layer-title").textContent'), 'Expansão QA', 'Newly imported layer is selected for editing');
    await click('[data-view="settings"]'); await click('[data-history="undo"]');
    await until('(await window.dobra.getState()).config.layers.length===2', 'Undo restores previous configuration');
    await click('[data-history="redo"]'); await until('(await window.dobra.getState()).config.layers.length===3', 'Redo restores imported layer');
    await libraryClipboard();
    const targetSelector = await evaluate('return "#"+document.querySelector(".import-layer-row select").id'); await select(targetSelector, 'expansion-main'); await reviewAndApply();
    const mergedCount = (await nativeState()).config.layers.find(layer => layer.id === 'expansion-main').bindings.length; assert.ok(mergedCount > 0);
    await libraryClipboard(); await select(await evaluate('return "#"+document.querySelector(".import-layer-row select").id'), 'expansion-main');
    await buttonText('Revisar alterações'); await until('!document.querySelector(".import-review").hidden', 'Conflict plan shown');
    assert.match(await evaluate('return document.querySelector(".import-review").textContent'), /conflito/);
    assert.ok(await evaluate('return document.querySelectorAll(".import-review li").length') > 0);
    await buttonText('Adicionar camadas'); await until('!document.querySelector(".productivity-dialog")', 'Skip plan applied');
    assert.equal((await nativeState()).config.layers.find(layer => layer.id === 'expansion-main').bindings.length, mergedCount, 'Skip keeps existing actions');
    await click('[data-view="settings"]');
    await fill('#field-momentaryShortcut', 'Control+Shift+F8'); await select('#field-momentaryLayerId', 'expansion-target'); await fill('#field-panelShortcut', 'Control+Shift+F9');
    await click('[data-focus="save-settings"]'); await until('(await window.dobra.getState()).config.settings.momentaryLayerId==="expansion-target"', 'Momentary and panel settings persist');
    const current = await nativeState(); assert.equal(current.config.settings.panelShortcut, 'Control+Shift+F9');
    if (!current.inputDevices?.supported) assert.match(await evaluate('return document.querySelector("#input-device-status").textContent'), /indisponível|disponível|Wayland|componente|identifica|integração/);
    await evaluate('localStorage.removeItem("dobra.setup-progress");');
    await evaluate('[...document.querySelectorAll("button")].find(item=>item.textContent.trim()==="Verificar teclado").click();');
    await until(title('Configurar teclado'), 'Resumable setup opens'); await buttonText('Continuar');
    await until('document.querySelector(".setup-progress .current").textContent.includes("Testar")', 'Setup progress advances');
    await escape(); await until('!document.querySelector(".productivity-dialog")', 'Escape dismisses setup');
    await evaluate('[...document.querySelectorAll("button")].find(item=>item.textContent.trim()==="Verificar teclado").click();');
    await until('document.querySelector(".setup-progress .current")?.textContent.includes("Testar")', 'Setup resumes');
    assert.equal((await nativeState()).enabled, false); await buttonText('Iniciar teste de uma tecla');
    await until('(await window.dobra.getState()).tracking.enabled', 'Setup explicitly enables observation with actions paused');
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
    await until('document.querySelector("#setup-key-status").textContent.includes("Tecla detectada")', 'Setup detects a test key locally when global is unavailable');
    await accessible('setup keyboard test'); await escape();
    await until('!(await window.dobra.getState()).tracking.enabled', 'Closing setup stops its observation');
    await click('[data-view="layers"]'); await click('[data-focus="layer-expansion-main"]'); await click('[data-focus="new-binding"]');
    await fill('#field-name', 'Fluxo com resposta QA'); await fill('#field-key', 'Control+Shift+J'); await select('#field-type', 'sequence'); await fill('#field-stepDelayMs', '7');
    await stepField(0, 'type', 'http'); await stepField(0, 'url', endpoint); await stepField(0, 'method', 'GET'); await stepField(0, 'resultName', 'consulta'); await stepField(0, 'delayBeforeMs', '17');
    await click('[data-step-add]'); await stepField(1, 'text', '{{steps.consulta.json.greeting}}'); await stepField(1, 'delayBeforeMs', '19');
    await evaluate('document.querySelectorAll("[data-sequence-step]")[1].querySelector("[name$=conditionEnabled]").click();');
    await stepField(1, 'conditionPath', 'steps.consulta.status'); await stepField(1, 'conditionValue', '200');
    await click('[data-step-add]'); await stepField(2, 'text', 'NÃO COPIAR');
    await evaluate('document.querySelectorAll("[data-sequence-step]")[2].querySelector("[name$=conditionEnabled]").click();');
    await stepField(2, 'conditionPath', 'steps.consulta.status'); await stepField(2, 'conditionValue', '404');
    await accessible('advanced sequence');
    await save(); await until('!document.querySelector("#editor-drawer")', 'Advanced sequence saved');
    const binding = (await nativeState()).config.layers.find(layer => layer.id === 'expansion-main').bindings.find(binding => binding.name === 'Fluxo com resposta QA');
    assert.equal(binding.action.steps[0].resultName, 'consulta'); assert.equal(binding.action.steps[1].delayBeforeMs, 19);
    await click('[data-focus="test-' + binding.id + '"]'); await until('!document.querySelector("[data-focus=execute-preview]").disabled', 'Dynamic preview ready');
    assert.equal(requests, 0, 'Preview never performs HTTP'); assert.match(await evaluate('return document.querySelector("#test-preview-content").textContent'), /durante a execução/);
    await click('[data-focus="execute-preview"]'); await until('(await window.dobra.getState()).events.some(event=>event.bindingId===' + JSON.stringify(binding.id) + '&&event.status==="success")', 'Conditional sequence completed');
    assert.equal(requests, 1); assert.equal(await nativeEvaluate(clipboardExpression + '.readText()'), 'Resposta efêmera QA');
    const event = (await nativeState()).events.find(event => event.bindingId === binding.id && event.status === 'success'); assert.equal(event.steps.at(-1).status, 'skipped'); assert.doesNotMatch(JSON.stringify(event), /Resposta efêmera QA/);
    await click('[data-drawer-close]');
    for (const theme of ['light', 'dark']) {
      await evaluate('window.dobraAppearance.set(' + JSON.stringify(theme) + ');');
      await click('[data-focus=model-library]');
      await until('document.querySelectorAll(".template-row").length===3', 'Styled library ready');
      await accessible('library ' + theme); await shot('habbo-library-' + theme);
      for (const [width, height] of [[360, 640], [760, 580]]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        assert.equal(await evaluate('const node=document.querySelector(".productivity-dialog");return node.scrollWidth<=node.clientWidth+1;'), true, 'Library fits narrow window');
        await accessible('library ' + theme + ' ' + width); await shot('habbo-library-' + theme + '-' + width);
      }
      await cdp('Emulation.clearDeviceMetricsOverride'); await escape();
      await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",ctrlKey:true,bubbles:true}));');
      await until('Boolean(document.querySelector("#field-command-search")) && !document.querySelector(".productivity-content").inert', 'Styled search ready');
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
      assert.equal(await evaluate('return document.activeElement===document.querySelector(".command-result")'), true, 'Arrow navigation focuses the first search result');
      await accessible('search focused ' + theme); await shot('habbo-search-' + theme);
      for (const [width, height] of [[360, 640], [760, 580]]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        assert.equal(await evaluate('const node=document.querySelector(".productivity-dialog");return node.scrollWidth<=node.clientWidth+1;'), true, 'Search fits narrow window');
        await accessible('search ' + theme + ' ' + width); await shot('habbo-search-' + theme + '-' + width);
      }
      await fill('#field-command-search', 'sem-resultado-qa');
      assert.equal(await evaluate('return document.querySelectorAll(".command-result").length'), 0);
      await accessible('empty search ' + theme);
      await cdp('Emulation.clearDeviceMetricsOverride'); await escape();
      await evaluate('window.dobraAppearance.set(' + JSON.stringify(theme) + ');'); await libraryClipboard(); await accessible('import ' + theme); await shot('productivity-import-' + theme);
      for (const [width, height] of [[360, 640], [760, 580]]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        assert.equal(await evaluate('const node=document.querySelector(".productivity-dialog");const rect=node.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth+1&&rect.top>=0&&rect.bottom<=innerHeight+1&&node.scrollWidth<=node.clientWidth+1;'), true, 'Import fits ' + theme + ' ' + width);
      }
      await cdp('Emulation.clearDeviceMetricsOverride'); await escape();
    }
    await evaluate('await window.dobra.showQuickPanel();');
    await nativeEvaluate('globalThis.__productPanel=process.mainModule.require("electron").BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes("quick-panel.html"));');
    await nativeEvaluate('new Promise((resolve,reject)=>{let retries=0;const check=()=>{const panel=process.mainModule.require("electron").BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes("quick-panel.html"));if(panel?.isVisible()){globalThis.__productPanel=panel;resolve(true);}else if(++retries>100)reject(new Error("Quick panel did not show"));else setTimeout(check,25);};check();})');
    await nativeEvaluate('globalThis.__productPanel.webContents.executeJavaScript('+JSON.stringify('new Promise(resolve=>{const check=()=>document.querySelector("#quick-main[aria-busy]")?requestAnimationFrame(check):resolve();check();})')+')');
    await nativeEvaluate('globalThis.__productPanel.webContents.executeJavaScript(' + JSON.stringify(axeSource) + ')');
    for (const theme of ['light', 'dark']) {
      await evaluate('window.dobraAppearance.set(' + JSON.stringify(theme) + ');');
      await nativeEvaluate('globalThis.__productPanel.webContents.executeJavaScript(' + JSON.stringify('new Promise(resolve=>{const check=()=>document.documentElement.dataset.theme===' + JSON.stringify(theme) + '?resolve():requestAnimationFrame(check);check();})') + ')');
      for (const [width, height] of [[380, 500], [300, 240]]) {
        await nativeEvaluate('globalThis.__productPanel.setSize(' + width + ',' + height + ')');
        const bounds = await nativeEvaluate('globalThis.__productPanel.webContents.executeJavaScript(' + JSON.stringify('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const list=document.querySelector(".quick-bindings");const item=list.lastElementChild;if(item)item.scrollIntoView({block:"center"});const last=item?.getBoundingClientRect();const itemVisible=!last||last.bottom>0&&last.top<innerHeight;document.querySelector(".quick-footer").scrollIntoView({block:"end"});const footer=document.querySelector(".quick-footer").getBoundingClientRect();resolve({page:document.documentElement.scrollWidth,viewport:innerWidth,footerTop:footer.top,footerBottom:footer.bottom,height:innerHeight,listHeight:list.clientHeight,itemVisible});})))') + ')');
        assert.ok(bounds.page<=bounds.viewport && bounds.listHeight>0 && bounds.itemVisible && bounds.footerTop>=0 && bounds.footerBottom<=bounds.height+1, 'Quick panel keeps shortcuts and footer reachable, including document scrolling in short windows: ' + JSON.stringify(bounds));
        const panelViolations = await nativeEvaluate('globalThis.__productPanel.webContents.executeJavaScript(' + JSON.stringify("(async()=>{await Promise.all(document.getAnimations().filter(item=>item.effect?.getTiming().iterations!==Infinity).map(item=>item.finished.catch(()=>{})));const result=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return result.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>({target:node.target,summary:node.failureSummary}))}));})()") + ')');
        assert.deepEqual(panelViolations, [], 'Quick panel accessibility: ' + theme + ' ' + width);
        const image = await nativeEvaluate('(async()=> (await globalThis.__productPanel.webContents.capturePage()).toPNG().toString("base64"))()');
        await fs.writeFile(require('node:path').resolve(__dirname, '../artifacts/ui-audit/habbo-quick-panel-' + theme + '-' + width + '.png'), Buffer.from(image, 'base64'));
      }
    }
    await nativeEvaluate('globalThis.__productPanel.setSize(380,500)');
    const panelText = await nativeEvaluate('globalThis.__productPanel.webContents.executeJavaScript("document.body.innerText")'); assert.match(panelText, /Escape fecha/); assert.doesNotMatch(panelText, /(?:^|\n)null(?:\n|$)/); assert.doesNotMatch(panelText, /Resposta efêmera QA|127\.0\.0\.1/);
    const panelImage = await nativeEvaluate('(async()=> (await globalThis.__productPanel.webContents.capturePage()).toPNG().toString("base64"))()');
    await fs.writeFile(require('node:path').resolve(__dirname, '../artifacts/ui-audit/productivity-quick-panel.png'), Buffer.from(panelImage, 'base64'));
    await evaluate('await window.dobra.hideQuickPanel();'); await nativeEvaluate('delete globalThis.__productPanel;');
    await click('[data-focus=layer-expansion-target]'); await click('[data-focus=edit-layer]'); await click('.danger-zone .button');
    await until('document.querySelector("#confirm-dialog").open', 'Removing a momentary target requires explicit review');
    assert.match(await evaluate('return document.querySelector("#dialog-description").textContent'), /temporária/);
    await click('#confirm-dialog .danger-solid');
    await until('!(await window.dobra.getState()).config.settings.momentaryLayerId', 'Removing target clears momentary pair');
    assert.equal((await nativeState()).config.settings.momentaryShortcut, undefined);
    await require('./linux-install-ui.cjs')({ cdp, evaluate, click, until, nativeState, nativeEvaluate, shot });
    await require('./productivity-audit-ui.cjs')({ cdp, evaluate, click, until, nativeState, nativeEvaluate, shot });
    console.log('Productivity expansion UI passed: palette edit/navigation, models/import/new-layer selection, merge/conflict skip, undo/redo, momentary/panel preferences, device capability, resumable paused setup, dynamic preview without I/O, HTTP result/condition/delays, skipped step, privacy, quick panel and themes.');
  } finally {
    await evaluate('document.querySelector(".productivity-dialog")?.close();document.querySelector("#editor-drawer")?.close();await window.dobra.setTracking(false);await window.dobra.saveConfig(' + JSON.stringify(before.config) + ');window.dobraAppearance.set("light");localStorage.removeItem("dobra.setup-progress");');
    await nativeEvaluate(clipboardExpression + '.writeText(' + JSON.stringify(clipboardBefore) + ')'); server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); await click('[data-view="layers"]');
  }
};
