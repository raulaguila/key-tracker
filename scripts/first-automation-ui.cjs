const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function firstAutomationUI({ cdp, evaluate, click, fill, until, nativeState, nativeEvaluate, shot }) {
  const before = await nativeState();
  let external;
  const appearanceBefore = await evaluate('return window.dobraAppearance.preference');
  const clipboard = 'process.mainModule.require("electron").clipboard';
  const clipboardBefore = await nativeEvaluate(clipboard + '.readText()');
  const axeSource = await fs.readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
  await cdp('Runtime.evaluate', { expression: axeSource });
  async function accessible(name) {
    const violations = await evaluate('await Promise.all(document.getAnimations().filter(item=>item.effect?.getTiming().iterations!==Infinity).map(item=>item.finished.catch(()=>{})));return (await axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa","wcag22aa"]}})).violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)}));');
    assert.deepEqual(violations, [], 'First automation accessibility: ' + name);
  }
  async function reload() {
    await evaluate('window.__firstReload=true;'); await cdp('Page.reload');
    await until('!window.__firstReload && Boolean(document.querySelector("[data-focus=new-binding]"))', 'Onboarding reload ready');
    await cdp('Runtime.evaluate', { expression: axeSource });
  }
  try {
    await evaluate('await window.dobra.setEnabled(false);localStorage.removeItem("dobra.first-automation");'); await reload();
    for (const theme of ['light', 'dark']) {
      await evaluate('window.dobraAppearance.set(' + JSON.stringify(theme) + ');');
      await accessible('welcome ' + theme); await shot('first-automation-welcome-' + theme);
      for (const [width, height] of [[390, 700], [760, 580], [1280, 900]]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        assert.equal(await evaluate('return document.documentElement.scrollWidth<=innerWidth'), true, 'Welcome fits ' + width);
      }
      await cdp('Emulation.clearDeviceMetricsOverride');
      await click('[data-focus=view-keyboard]');
      await accessible('welcome with visual keyboard ' + theme); await shot('habbo-layers-keyboard-' + theme);
      await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 700, deviceScaleFactor: 1, mobile: false });
      assert.equal(await evaluate('return document.documentElement.scrollWidth<=innerWidth'), true, 'Guide and visual keyboard fit narrow viewport: ' + theme);
      await accessible('guide and visual keyboard narrow ' + theme); await shot('habbo-layers-keyboard-' + theme + '-narrow');
      await cdp('Emulation.clearDeviceMetricsOverride');
      await click('[data-focus=view-table]');
    }
    await click('[data-focus=first-dismiss]'); await reload();
    assert.equal(await evaluate('return document.querySelector(".first-automation").hidden'), true, 'Dismissal survives reload');
    await click('[data-view=settings]');
    await evaluate('[...document.querySelectorAll("button")].find(node=>node.textContent.trim()==="Criar uma automação guiada").click();');
    await until('Boolean(document.querySelector(".first-automation:not([hidden])"))', 'Guide can be resumed from settings');
    await click('[data-focus=first-next]');
    await until('Boolean(document.querySelector("#field-text")) && !document.querySelector(".form-fields").inert', 'Real action editor opens');
    await fill('#field-name', 'Minha primeira resposta'); await fill('#field-text', 'Texto personalizado do primeiro uso');
    await accessible('create'); await shot('first-automation-create');
    await fill('#field-key', 'T');
    await evaluate('document.querySelector("form[data-draft]").requestSubmit();');
    await until('!document.querySelector(".form-errors").hidden', 'Single-letter shortcut refused in guided flow');
    await fill('#field-key', 'Shift+T');
    await evaluate('document.querySelector("form[data-draft]").requestSubmit();');
    await until('!document.querySelector(".form-errors").hidden', 'Shift alone is ordinary typing, not a safe guided shortcut');
    await fill('#field-key', 'CommandOrControl+Alt+T');
    await nativeEvaluate(clipboard + '.writeText("before-first-test")');
    await evaluate('document.querySelector("form[data-draft]").requestSubmit();');
    await until('Boolean(document.querySelector("[data-focus=execute-preview]")) && !document.querySelector("[data-focus=execute-preview]").disabled', 'Saving opens frozen preview without executing');
    assert.equal(await nativeEvaluate(clipboard + '.readText()'), 'before-first-test');
    assert.equal((await nativeState()).enabled, false);
    assert.equal(await evaluate('return document.querySelector("[data-focus=first-activate-next]").hidden'), true);
    const desktopPath = JSON.stringify(path.resolve(__dirname, '../app/desktop-actions.cjs'));
    await nativeEvaluate(`globalThis.__firstDesktop=process.mainModule.require(${desktopPath}).DesktopActions.prototype;globalThis.__firstClipboard=globalThis.__firstDesktop.clipboard;globalThis.__firstDesktop.clipboard=async()=>{throw new Error('first-test-fixture');};`);
    await click('[data-focus=execute-preview]');
    await until('Boolean(document.querySelector("[data-test-result=error]"))', 'Execution failure stays actionable');
    assert.equal(await evaluate('return document.querySelector("[data-focus=first-activate-next]").hidden'), true, 'A failed test cannot unlock activation');
    await nativeEvaluate('globalThis.__firstDesktop.clipboard=globalThis.__firstClipboard;');
    await click('[data-focus=refresh-preview]');
    await until('!document.querySelector("[data-focus=execute-preview]").disabled', 'Failed test can be retried');
    await click('[data-focus=execute-preview]');
    await until('!document.querySelector("[data-focus=first-activate-next]").hidden', 'Only a successful real test unlocks activation');
    assert.equal(await nativeEvaluate(clipboard + '.readText()'), 'Texto personalizado do primeiro uso');
    await accessible('test success'); await shot('first-automation-test-success');
    await click('[data-focus=first-activate-next]');
    await until('!document.querySelector("[data-focus=first-next]").disabled', 'Activation waits for editor suspension to end');
    await accessible('activation');
    await evaluate('const state=await window.dobra.getState();const progress=JSON.parse(localStorage.getItem("dobra.first-automation"));state.config.layers.find(layer=>layer.id===progress.layerId).name="Camada renomeada";await window.dobra.saveConfig(state.config);');
    await until('document.querySelector(".first-automation-steps [aria-current]").textContent==="2. Testar"', 'Changing layer context invalidates the successful test');
    await reload();
    assert.equal(await evaluate('return document.querySelector(".first-automation-steps [aria-current]").textContent'), '2. Testar', 'Resume retains saved action and asks for a fresh test');
    await click('[data-focus=first-edit]');
    await until('Boolean(document.querySelector("#field-text"))', 'Can edit saved onboarding action');
    assert.equal(await evaluate('return document.querySelector("#field-text").value'), 'Texto personalizado do primeiro uso');
    await fill('#field-text', 'Texto revisado do primeiro uso');
    await evaluate('document.querySelector("form[data-draft]").requestSubmit();');
    await until('Boolean(document.querySelector("[data-focus=execute-preview]")) && !document.querySelector("[data-focus=execute-preview]").disabled', 'Edited action needs another test');
    await click('[data-focus=execute-preview]'); await until('!document.querySelector("[data-focus=first-activate-next]").hidden', 'Updated action tested');
    await click('[data-focus=first-activate-next]'); await until('!document.querySelector("[data-focus=first-next]").disabled', 'Ready to activate');
    await reload();
    await until('document.querySelector(".first-automation-steps [aria-current]")?.textContent==="3. Ativar"', 'Successful test survives reload during permission recovery');
    if (before.linuxInput?.supported) {
      const modulePath = JSON.stringify(path.resolve(__dirname, '../app/wayland-input.cjs'));
      await nativeEvaluate(`globalThis.__firstPrototype=process.mainModule.require(${modulePath}).WaylandInput.prototype;globalThis.__firstEnable=globalThis.__firstPrototype.enable;globalThis.__firstStatus='denied';globalThis.__firstPrototype.enable=async function(){
        globalThis.__firstBackend=this;
        if(globalThis.__firstStatus==='pending'){this.publish('authorizing');await new Promise(resolve=>globalThis.__firstAnswer=resolve);}
        if(['denied','not-installed'].includes(globalThis.__firstStatus)){this.connected=false;this.publish(globalThis.__firstStatus);throw new Error('permission-fixture');}
        this.connected=true;this.publish('idle');return this.state();
      };`);
      await click('[data-focus=first-next]');
      await until('document.querySelector(".first-automation-recovery h3")?.textContent.includes("negada")', 'Denied authorization has a direct retry action');
      assert.equal(await evaluate('return document.querySelector(".first-automation-steps [aria-current]").textContent'), '3. Ativar');
      await nativeEvaluate('globalThis.__firstStatus="not-installed";'); await click('[data-focus=first-next]');
      await until('Boolean(document.querySelector(".first-automation .linux-install-help:not([hidden])"))', 'Missing component offers installation in the guide');
      await accessible('missing component'); await shot('first-automation-recovery-install');
      for (const theme of ['light', 'dark']) {
        await evaluate('window.dobraAppearance.set(' + JSON.stringify(theme) + ');');
        await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 700, deviceScaleFactor: 1, mobile: false });
        assert.equal(await evaluate('return document.documentElement.scrollWidth<=innerWidth'), true, 'Recovery fits narrow viewport: ' + theme);
        await accessible('recovery narrow ' + theme); await shot('first-automation-recovery-' + theme + '-narrow');
        await cdp('Emulation.clearDeviceMetricsOverride');
      }
      const savedProgress = await evaluate('return JSON.parse(localStorage.getItem("dobra.first-automation"))');
      await reload();
      await until('document.querySelector(".first-automation-steps [aria-current]")?.textContent==="3. Ativar"', 'Installation/restart preserves the verified manual test');
      assert.equal(await evaluate('return JSON.parse(localStorage.getItem("dobra.first-automation")).bindingId'), savedProgress.bindingId);
      await nativeEvaluate('globalThis.__firstStatus="pending";'); await click('[data-focus=first-next]');
      await until('document.querySelector("[data-focus=first-next]").disabled && (await window.dobra.getState()).linuxInput.status==="authorizing"', 'Authorization waits without duplicate requests');
      await nativeEvaluate('globalThis.__firstStatus="idle";globalThis.__firstAnswer();');
      await until('(await window.dobra.getState()).linuxInput.status==="idle" && !document.querySelector("[data-focus=first-next]").disabled', 'Permission succeeds without losing progress');
      assert.equal((await nativeState()).enabled, false, 'Authorization never activates actions automatically');
      await click('[data-focus=first-next]');
      await until('(await window.dobra.getState()).enabled', 'Activation is explicit');
      await nativeEvaluate('globalThis.__firstBackend.publish("global")');
      await until('document.querySelector(".first-automation-steps [aria-current]")?.textContent==="4. Confirmar"', 'Global input moves to external confirmation, not success');
      assert.equal(await evaluate('return Boolean(document.querySelector("[data-focus=first-finish]"))'), false);
      await accessible('waiting for external shortcut'); await shot('first-automation-confirm-shortcut');
      const identity = savedProgress;
      await evaluate('await window.dobra.runBinding(' + JSON.stringify(identity.layerId) + ',' + JSON.stringify(identity.bindingId) + ');');
      assert.equal(await evaluate('return Boolean(document.querySelector("[data-focus=first-finish]"))'), false, 'Manual IPC cannot complete external confirmation');
      const dispatch = () => nativeEvaluate('globalThis.__firstBackend.emit("key",{code:"KeyT",key:"T",direction:"down",ctrlKey:true,altKey:true,shiftKey:false,metaKey:false,source:"global"});globalThis.__firstBackend.emit("key",{code:"KeyT",key:"T",direction:"up",ctrlKey:true,altKey:true,shiftKey:false,metaKey:false,source:"global"});');
      await nativeEvaluate('process.mainModule.require("electron").BrowserWindow.getAllWindows()[0].focus()');
      assert.equal(await nativeEvaluate('process.mainModule.require("electron").BrowserWindow.getAllWindows()[0].isFocused()'), true);
      await dispatch();
      await until('(await window.dobra.getState()).events.some(event=>event.origin==="shortcut"&&event.outsideApp===false)', 'Shortcut inside Dobra records its actual focus');
      assert.equal(await evaluate('return Boolean(document.querySelector("[data-focus=first-finish]"))'), false, 'A shortcut inside Dobra is not external proof');
      await evaluate('const state=await window.dobra.getState();state.config.settings.cooldownMs+=1;await window.dobra.saveConfig(state.config);');
      await until('document.querySelector(".first-automation-steps [aria-current]")?.textContent==="3. Ativar"', 'Configuration revision changes require reactivation without losing the manual test');
      await until('!document.querySelector("[data-focus=first-next]").disabled', 'Revision change can be recovered explicitly');
      await click('[data-focus=first-next]');
      await until('document.querySelector(".first-automation-steps [aria-current]")?.textContent==="4. Confirmar"', 'Reactivation arms the new configuration revision');
      // A selected device disappearing must retain the test and offer targeted recovery.
      const selectedId = 'linux:' + '1'.repeat(40);
      await evaluate('const state=await window.dobra.getState();state.config.settings.inputDeviceId=' + JSON.stringify(selectedId) + ';await window.dobra.saveConfig(state.config);');
      await nativeEvaluate('globalThis.__firstBackend.receive({type:"devices",selectedId:globalThis.__firstBackend.selectedId,devices:[]})');
      await until('Boolean(document.querySelector("[data-focus=first-device]"))', 'Missing selected device offers choosing another keyboard');
      await click('[data-focus=first-device]');
      await until('Boolean(document.querySelector("#field-inputDeviceId"))', 'Device recovery opens the exact settings control');
      assert.equal(await evaluate('return document.querySelector("#field-inputDeviceId").closest("details").open'), true);
      await evaluate('const input=document.querySelector("#field-inputDeviceId");input.value="";input.dispatchEvent(new Event("change",{bubbles:true}));document.querySelector("form[data-draft]").requestSubmit();');
      await until('!(await window.dobra.getState()).config.settings.inputDeviceId', 'Choosing a device persists explicitly');
      await nativeEvaluate('globalThis.__firstBackend.receive({type:"devices",selectedId:"",devices:[]})');
      await evaluate('[...document.querySelectorAll("button")].find(node=>node.textContent.trim()==="Criar uma automação guiada").click();');
      await until('document.querySelector(".first-automation-steps [aria-current]")?.textContent==="3. Ativar"', 'Device recovery returns to activation, not creation or manual retest');
      await until('!document.querySelector("[data-focus=first-next]").disabled', 'Activation waits for settings editing to finish');
      await click('[data-focus=first-next]'); await nativeEvaluate('globalThis.__firstBackend.publish("global")');
      await until('document.querySelector(".first-automation-steps [aria-current]")?.textContent==="4. Confirmar"', 'Explicit reactivation restores external confirmation');
      external = await require('./fixtures/external-window.cjs')();
      assert.equal(await nativeEvaluate('process.mainModule.require("electron").BrowserWindow.getAllWindows().some(window=>window.isFocused())'), false, 'An independent application owns focus');
      await new Promise(resolve=>setTimeout(resolve,450)); // Respect the real shortcut cooldown.
      await nativeEvaluate('globalThis.__firstDesktop.clipboard=async()=>{throw new Error("external-shortcut-fixture");};');
      await dispatch();
      await until('document.querySelector(".first-automation .form-errors")?.textContent.includes("ação falhou")', 'Failed external action remains in confirmation with an actionable result');
      assert.equal(await evaluate('return Boolean(document.querySelector("[data-focus=first-finish]"))'), false, 'Receiving the external shortcut without a successful effect is insufficient');
      await nativeEvaluate('globalThis.__firstDesktop.clipboard=globalThis.__firstClipboard;');
      await new Promise(resolve=>setTimeout(resolve,450));
      await nativeEvaluate(clipboard + '.writeText("before-first-shortcut")');
      await dispatch();
      await until('(await window.dobra.getState()).events.some(event=>event.origin==="shortcut"&&event.outsideApp===true&&event.status==="success")', 'External shortcut produces backend-verified proof');
      await external.stop(); external = null;
      await nativeEvaluate('process.mainModule.require("electron").BrowserWindow.getAllWindows()[0].focus()');
      await until('Boolean(document.querySelector("[data-focus=first-finish]"))', 'Guide confirms only the successful external shortcut');
      assert.equal(await evaluate('return Boolean(document.querySelector(".first-automation .form-errors"))'), false, 'Successful retry clears the previous shortcut failure');
      await accessible('completed'); await shot('first-automation-completed');
      assert.equal(await nativeEvaluate(clipboard + '.readText()'), 'Texto revisado do primeiro uso');
      await click('[data-focus=first-finish]'); await reload();
      assert.equal(await evaluate('return document.querySelector(".first-automation").hidden'), true, 'Completed guide stays out of the way on return');
      await click('[data-view=settings]');
      await evaluate('[...document.querySelectorAll("button")].find(node=>node.textContent.trim()==="Criar uma automação guiada").click();');
      assert.equal(await evaluate('return document.querySelector("[data-focus=first-next]").textContent.trim()'), 'Criar minha automação', 'Reopening a completed guide starts a new automation');
      await click('[data-focus=first-next]');
      await until('Boolean(document.querySelector("#field-key"))', 'Another guided action can be created');
      assert.equal(await evaluate('const key=document.querySelector("#field-key").value;const state=await window.dobra.getState();return state.config.layers.find(layer=>layer.id===state.activeLayerId).bindings.some(binding=>binding.key===key)'), false, 'Suggested shortcut avoids existing actions');
      await click('[data-drawer-close]');
    }
    const stored = await evaluate('return localStorage.getItem("dobra.first-automation")');
    assert.doesNotMatch(stored, /Texto personalizado|Texto revisado|Minha primeira resposta/, 'Progress does not duplicate action contents');
    console.log('First automation UI passed: welcome/dismiss/resume, real creation and safe shortcut, preview without effects, manual clipboard test, edit/retest, global-input recovery, explicit activation, native shortcut, completion, privacy, themes, accessibility and responsive viewports.');
  } finally {
    await external?.stop();
    await evaluate('document.querySelector(".setup-dialog")?.close();document.querySelector("#editor-drawer")?.close();await window.dobra.setEnabled(false);await window.dobra.setLinuxInputEnabled(false);await window.dobra.saveConfig(' + JSON.stringify(before.config) + ');window.dobraAppearance.set(' + JSON.stringify(appearanceBefore) + ');localStorage.setItem("dobra.first-automation",JSON.stringify({version:1,dismissed:true}));').catch(() => {});
    await nativeEvaluate('if(globalThis.__firstDesktop){globalThis.__firstDesktop.clipboard=globalThis.__firstClipboard;delete globalThis.__firstDesktop;delete globalThis.__firstClipboard;}if(globalThis.__firstPrototype){globalThis.__firstPrototype.enable=globalThis.__firstEnable;delete globalThis.__firstPrototype;delete globalThis.__firstEnable;delete globalThis.__firstBackend;delete globalThis.__firstStatus;delete globalThis.__firstAnswer;}' + clipboard + '.writeText(' + JSON.stringify(clipboardBefore) + ');').catch(() => {});
    await reload();
  }
};
