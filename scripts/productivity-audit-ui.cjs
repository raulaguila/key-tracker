const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { defaultConfig, validateConfig } = require('../app/config.cjs');

// The actual renderer/preload/backend are used. Delay wrappers only model an IPC
// reply arriving after dismissal or another user edit; they never read host keys.
module.exports = async function auditProductivity({ cdp, evaluate, click, until, nativeState, nativeEvaluate, shot }) {
  const before = await nativeState(); const issues = []; const metrics = {};
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dobra-ui-audit-'));
  const escape = async () => { await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); };
  async function controller(overrides = '', pause = '()=>{}') {
    await evaluate(`
      window.__auditUI?.close?.(); window.__auditUnsubscribe?.();
      const module=await import('./productivity.js');
      window.__auditState=await window.dobra.getState(); window.__auditMessages=[];
      window.__auditUnsubscribe=window.dobra.onState(next=>window.__auditState=next);
      window.__auditUI=module.createProductivity({api:{...window.dobra,${overrides}},getState:()=>window.__auditState,
        applyState:next=>window.__auditState=next,guard:callback=>callback(),
        editBinding:(layer,id)=>window.__auditSelected={layer,id},editLayer:()=>{},selectLayer:()=>{},
        onModalChange:${pause},notify:message=>window.__auditMessages.push(message)});
    `);
  }
  const panelEvaluate = code => nativeEvaluate('globalThis.__auditPanel.webContents.executeJavaScript('+JSON.stringify(code)+')');
  const buttonText = text => evaluate('const node=[...document.querySelectorAll(".productivity-dialog button")].find(item=>item.textContent.trim()===' + JSON.stringify(text) + ');if(!node)throw new Error("Missing button: '+text+'");node.click();');
  async function template() {
    await evaluate('window.__auditUI.openLibrary();'); await until('document.querySelectorAll(".template-row").length===3', 'Library loaded');
    await evaluate('document.querySelector(".template-row button").click();'); await until('Boolean(document.querySelector(".import-layer-row"))', 'Template preview loaded');
  }
  try {
    await evaluate('await window.dobra.setEnabled(false);await window.dobra.setTracking(false);');
    await controller('', '()=>window.__auditUI.active?new Promise(resolve=>window.__auditResumeEditing=resolve).then(()=>window.dobra.setEditing(true)):window.dobra.setEditing(false)');
    await evaluate('window.__auditUI.openSearch();'); await until('typeof window.__auditResumeEditing==="function"', 'Editing acknowledgement delayed');
    if (!await evaluate('return document.querySelector(".productivity-content").inert')) issues.push('dialog accepts input before editing acknowledgement');
    await evaluate('document.querySelector("#field-command-search").focus();');
    if (await evaluate('return document.activeElement===document.querySelector("#field-command-search")')) issues.push('pending dialog field is focusable');
    await evaluate('window.__auditResumeEditing();'); await until('!document.querySelector(".productivity-content").inert', 'Editing acknowledgement unlocks fields');
    assert.equal((await nativeState()).editing,true); await escape();
    await controller('setTracking:async enabled=>{if(enabled)await new Promise(resolve=>window.__auditResumeTracking=resolve);return window.dobra.setTracking(enabled)}');
    await evaluate('localStorage.setItem("dobra.setup-progress","1");window.__auditUI.openWizard();');
    await until('Boolean(document.querySelector("#setup-key-status"))', 'Wizard test ready'); await buttonText('Iniciar teste de uma tecla');
    await until('typeof window.__auditResumeTracking==="function"', 'Tracking reply held'); await escape();
    await evaluate('window.__auditResumeTracking();await new Promise(resolve=>setTimeout(resolve,100));');
    if ((await nativeState()).tracking.enabled) issues.push('wizard leaves tracking enabled when closed during its start request');
    await evaluate('await window.dobra.setTracking(false);');

    await controller('planLayerImport:async(...args)=>{await new Promise(resolve=>window.__auditResumePlan=resolve);return window.dobra.planLayerImport(...args)}');
    await template(); await buttonText('Revisar alterações'); await until('typeof window.__auditResumePlan==="function"', 'Planning reply held');
    await evaluate('const select=document.querySelector(".import-layer-row select");select.value=window.__auditState.config.layers[0].id;select.dispatchEvent(new Event("change",{bubbles:true}));window.__auditResumePlan();await new Promise(resolve=>setTimeout(resolve,100));');
    if (await evaluate('return [...document.querySelectorAll(".productivity-dialog button")].some(node=>node.textContent.trim()==="Adicionar camadas"&&!node.disabled)')) issues.push('outdated import plan becomes actionable after destination changes during planning');
    await escape();

    const legacy=defaultConfig(); legacy.layers[0].bindings=[{id:'legacy-panel',name:'Atalho antigo',key:'Control+Shift+Space',action:{type:'clipboard',text:'x'}}]; delete legacy.settings.panelShortcut;
    await evaluate('await window.dobra.saveConfig('+JSON.stringify(legacy)+');await window.dobra.setTracking(true);await window.dobra.setTracking(false);document.querySelector("[data-view=settings]").click();');
    await until('Boolean(document.querySelector("#field-panelShortcut"))','Legacy settings displayed');
    assert.equal(await evaluate('return document.querySelector("#field-panelShortcut").value'),'','Conflicting implicit panel shortcut is visibly disabled');
    assert.match(await evaluate('return document.querySelector("#shortcut-warning").textContent'),/desativado por conflito/,'Backend conflict reason is visible');
    await evaluate('const input=document.querySelector("#field-cooldownMs");input.value="401";input.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("form[data-draft]").requestSubmit();');
    await until('(await window.dobra.getState()).config.settings.cooldownMs===401','Unrelated legacy setting saves successfully');
    assert.equal((await nativeState()).config.settings.panelShortcut,'');

    // Maximum cardinality fixture within the real 256 KiB config limit.
    const large = defaultConfig(); const bindings = [];
    for (let i=0;i<20;i++) for (let j=0;j<100;j++) { const key=(j<60?'':'Control+')+(j%60<26?String.fromCharCode(65+j%60):j%60<36?String(j%60-26):'F'+(j%60-35)); if (!['F8','F9'].includes(key)) bindings.push({id:i.toString(36)+j.toString(36).padStart(2,'0'),name:'A',key,action:{type:'clipboard',text:'x'}}); }
    large.layers = Array.from({length:30},(_,index)=>({id:'l'+index,name:'Camada '+String(index+1).padStart(2,'0'),description:'',applications:[],bindings:bindings.slice(index*65,index===29?bindings.length:(index+1)*65)}));
    large.layers[0].bindings[0].action={type:'layer',layerId:'l1'};
    const canonical = validateConfig(large); metrics.fixtureBindings = bindings.length; metrics.fixtureBytes = Buffer.byteLength(JSON.stringify(canonical));
    const source = path.join(temporary,'layers.json'); await fs.writeFile(source,JSON.stringify(canonical));
    await evaluate('await window.dobra.saveConfig('+JSON.stringify(canonical)+');'); await controller();
    await evaluate('window.__auditUI.openSearch();'); await until('Boolean(document.querySelector("#field-command-search"))', 'Large palette ready');
    await evaluate('const input=document.querySelector("#field-command-search");input.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",bubbles:true}));');
    if (!await evaluate('return document.activeElement===document.querySelector(".command-results button:last-child")')) issues.push('ArrowUp from palette input selects the penultimate result');
    metrics.palette = await evaluate('const input=document.querySelector("#field-command-search");const values=[];for(const query of ["","A","Camada 2","Ctrl","nenhuma agulha"]){input.value=query;const start=performance.now();input.dispatchEvent(new Event("input",{bubbles:true}));values.push({query,ms:performance.now()-start,rendered:document.querySelectorAll(".command-result").length});}return values;'); assert.ok(metrics.palette.slice(0,-1).every(sample=>sample.rendered===40),'Common searches render at most forty matching commands'); assert.equal(metrics.palette.at(-1).rendered,0); await escape();
    await nativeEvaluate('globalThis.__auditOpen=process.mainModule.require("electron").dialog.showOpenDialog;process.mainModule.require("electron").dialog.showOpenDialog=async()=>({canceled:false,filePaths:['+JSON.stringify(source)+']});');
    await evaluate('window.__auditBeforeNodes=document.querySelectorAll("*").length;window.__auditStart=performance.now();window.__auditUI.openImport();');
    await until('document.querySelectorAll(".import-layer-row").length===30', 'Thirty real source layers render');
    metrics.import = await evaluate('return {ms:performance.now()-window.__auditStart,addedNodes:document.querySelectorAll("*").length-window.__auditBeforeNodes,shortcuts:document.querySelectorAll(".import-key-preview .shortcut").length};');
    if (metrics.import.shortcuts > 30 * 6) issues.push('import eagerly renders every shortcut across thirty layers');
    await evaluate('document.querySelector(".import-key-details").open=true;');
    await until('document.querySelector(".import-key-details").dataset.loaded==="true"', 'Remaining shortcuts load on demand');
    assert.equal(await evaluate('return document.querySelector(".import-layer-row").querySelectorAll(".shortcut").length'),canonical.layers[0].bindings.length);
    assert.match(await evaluate('return document.querySelector(".import-layer-copy").textContent'),/Também requer: Camada 02/);
    await evaluate('document.querySelectorAll(".import-layer-row").forEach((row,index)=>{const select=row.querySelector("select");select.value="l"+index;select.dispatchEvent(new Event("change",{bubbles:true}));});const dependency=document.querySelectorAll(".import-layer-row input[type=checkbox]")[1];dependency.checked=false;dependency.dispatchEvent(new Event("change",{bubbles:true}));');
    await buttonText('Revisar alterações'); await until('!document.querySelector(".productivity-dialog .form-errors").hidden', 'Missing source dependency explained');
    assert.match(await evaluate('return document.querySelector(".productivity-dialog .form-errors").textContent'),/Selecione também/);
    await evaluate('const dependency=document.querySelectorAll(".import-layer-row input[type=checkbox]")[1];dependency.checked=true;dependency.dispatchEvent(new Event("change",{bubbles:true}));');
    await buttonText('Revisar alterações'); await until('!document.querySelector(".import-review").hidden','Thirty merged layers plan ready');
    await evaluate('const config=structuredClone(window.__auditState.config);config.settings.cooldownMs++;await window.dobra.saveConfig(config);');
    await buttonText('Adicionar camadas'); await until('!document.querySelector(".productivity-dialog .form-errors").hidden','Stale token rejected');
    assert.match(await evaluate('return document.querySelector(".productivity-dialog .form-errors").textContent'),/configuração mudou/i);
    assert.equal(await evaluate('return [...document.querySelectorAll(".productivity-dialog button")].find(node=>node.textContent.trim()==="Adicionar camadas").disabled'),true);
    await escape();

    await controller('applyLayerImport:async id=>{await new Promise(resolve=>window.__auditResumeApply=resolve);return window.dobra.applyLayerImport(id)}');
    await template(); await evaluate('const select=document.querySelector(".import-layer-row select");select.value="l0";select.dispatchEvent(new Event("change",{bubbles:true}));');
    await buttonText('Revisar alterações'); await until('!document.querySelector(".import-review").hidden','Fresh merge plan ready');
    await buttonText('Adicionar camadas'); await until('typeof window.__auditResumeApply==="function"','Application request held');
    assert.equal(await evaluate('return [...document.querySelectorAll(".import-layer-row input,.import-layer-row select,#field-import-resolution")].every(node=>node.disabled)&&document.querySelector(".productivity-content").getAttribute("aria-busy")==="true"'),true,'Pending apply freezes its reviewed selections');
    await escape(); await evaluate('window.__auditResumeApply();'); await until('window.__auditMessages.some(message=>message.includes("Camadas adicionadas"))','Accepted apply settles after dismissal');
    assert.equal(await evaluate('return Boolean(document.querySelector(".productivity-dialog"))'),false);


    await evaluate('await window.dobra.showQuickPanel();');
    await nativeEvaluate('new Promise((resolve,reject)=>{let count=0;const check=()=>{const panel=process.mainModule.require("electron").BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes("quick-panel.html"));if(panel?.isVisible()){globalThis.__auditPanel=panel;resolve();}else if(++count>100)reject(new Error("Panel did not show"));else setTimeout(check,25);};check();})');
    await panelEvaluate('new Promise(resolve=>{const check=()=>document.querySelector("#quick-main[aria-busy]")?requestAnimationFrame(check):resolve();check();})');
    await panelEvaluate('window.__auditFooter=document.querySelector(".quick-footer button");window.__auditFooter.focus();window.__auditMutationCount=0;window.__auditObserver=new MutationObserver(records=>window.__auditMutationCount+=records.length);window.__auditObserver.observe(document.querySelector("#quick-main"),{subtree:true,childList:true});');
    await nativeEvaluate('(async()=>{const state=await globalThis.__auditPanel.webContents.executeJavaScript("window.dobraPanel.getState()");for(let index=0;index<25;index++)globalThis.__auditPanel.webContents.send("dobra-panel:state",state);})()');
    metrics.panel = await panelEvaluate('({mutations:window.__auditMutationCount,focused:document.activeElement===window.__auditFooter})');
    if (!metrics.panel.focused || metrics.panel.mutations) issues.push('identical quick-panel updates rebuild its DOM and lose keyboard focus');
    await evaluate('await window.dobra.setEnabled(true);await window.dobra.setEditing(true);');
    await nativeEvaluate('globalThis.__auditPanel.webContents.executeJavaScript('+JSON.stringify('new Promise((resolve,reject)=>{let attempts=0;const check=()=>document.querySelector(".quick-status").textContent.includes("suspensas")?resolve():++attempts>100?reject(new Error("Editing status missing")):setTimeout(check,10);check();})')+')');
    await nativeEvaluate('(async()=>{const state=await globalThis.__auditPanel.webContents.executeJavaScript("window.dobraPanel.getState()");globalThis.__auditPanel.webContents.send("dobra-panel:state",{...state,revision:state.revision-1,layer:{name:"ESTADO ANTIGO"}});})()');
    assert.notEqual(await panelEvaluate('document.querySelector("h1").textContent'),'ESTADO ANTIGO','Out-of-order projection ignored');
    for(const theme of ['light','dark']) { await evaluate('window.dobraAppearance.set('+JSON.stringify(theme)+');'); await nativeEvaluate('globalThis.__auditPanel.webContents.executeJavaScript('+JSON.stringify('new Promise((resolve,reject)=>{let attempts=0;const check=()=>document.documentElement.dataset.theme==='+JSON.stringify(theme)+'?resolve():++attempts>100?reject(new Error("Theme did not update")):setTimeout(check,10);check();})')+')'); }
    assert.equal(await panelEvaluate('document.activeElement===window.__auditFooter'),true,'Theme and editing updates preserve keyboard focus');
    await evaluate('await window.dobra.setEnabled(false);await window.dobra.setEditing(false);await window.dobra.hideQuickPanel();');
    console.log('Productivity UI audit evidence: '+JSON.stringify({issues,metrics}));
    assert.deepEqual(issues, [], 'Productivity audit regressions');
  } finally {
    await evaluate('document.querySelector(".productivity-dialog")?.close();window.__auditUnsubscribe?.();await window.dobra.setTracking(false);await window.dobra.hideQuickPanel();await window.dobra.saveConfig('+JSON.stringify(before.config)+');localStorage.removeItem("dobra.setup-progress");delete window.__auditUI;');
    await nativeEvaluate('if(globalThis.__auditOpen){process.mainModule.require("electron").dialog.showOpenDialog=globalThis.__auditOpen;delete globalThis.__auditOpen;}delete globalThis.__auditPanel;');
    await fs.rm(temporary,{recursive:true,force:true});
  }
};
