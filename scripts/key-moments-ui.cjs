// Focused regression checks in ui-smoke's real, isolated Electron window.
const assert = require('node:assert/strict');

module.exports = async function keyMomentsUI({ cdp, evaluate, click, fill, select, until, nativeState, save, shot, nativeEvaluate }) {
  const before = await nativeState();
  const config = { ...structuredClone(before.config), layers: [{ id: 'moments-ui', name: 'Momentos QA', bindings: [] }] };
  async function capture(key = 'a', code = 'KeyA') {
    await click('[data-edit-trigger]');
    await click('#editor-drawer .input-with-button button');
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) });
  }
  const close = () => click('[data-drawer-close]');
  const binding = async trigger => (await nativeState()).config.layers[0].bindings.find(item => (item.trigger || 'press') === trigger);
  async function edit(trigger) { await click('[data-focus="edit-' + (await binding(trigger)).id + '"]'); }
  async function stepField(index, name, value) {
    const selector = await evaluate(`return '#'+document.querySelectorAll('[data-sequence-step]')[${index}].querySelector('[name$="-${name}"]').id;`);
    const tag = await evaluate('return document.querySelector(' + JSON.stringify(selector) + ').tagName');
    await (tag === 'SELECT' ? select : fill)(selector, value);
  }
  try {
    await evaluate('await window.keyboardTracker.setEnabled(false);await window.keyboardTracker.saveConfig(' + JSON.stringify(config) + ');await window.keyboardTracker.setLayer("moments-ui");localStorage.setItem("keyboard-tracker.binding-view","table");window.__momentsReload=true;');
    await cdp('Page.reload');
    await until('!window.__momentsReload && Boolean(document.querySelector("[data-focus=new-binding]"))', 'Moments fixture ready');
    for (const trigger of ['press', 'hold', 'release']) {
      await click('[data-focus="new-binding"]');
      await fill('#field-name', 'QA ' + trigger);
      await select('#field-trigger', trigger);
      await capture();
      if (trigger === 'hold') await fill('#field-repeatMs', '250');
      await fill('#field-text', trigger);
      await save();
      await until('!document.querySelector("#editor-drawer")', 'Saved moment ' + trigger);
      const item = await binding(trigger);
      assert.equal(item.key, 'A'); assert.equal(item.keyCode, 'KeyA');
      if (trigger === 'hold') assert.equal(item.repeatMs, 250);
    }
    assert.equal((await nativeState()).config.layers[0].bindings.length, 3, 'One shortcut keeps all three moments');
    assert.equal(await evaluate('return document.querySelectorAll(".binding-trigger-label").length'), 3);
    await edit('hold');
    assert.equal(await evaluate('return document.querySelector("#field-repeatMs").value'), '250');
    assert.equal(await evaluate('return document.querySelector("#field-keyCode").value'), 'KeyA');
    await fill('#field-key', 'A');
    assert.equal(await evaluate('return document.querySelector("#field-keyCode").value'), '', 'Manual shortcut edit invalidates physical capture');
    await save();
    await until('document.querySelector(".form-errors").textContent.includes("Capturar tecla")', 'Physical capture required for hold');
    await capture('a', 'KeyQ');
    assert.equal(await evaluate('return document.querySelector(".form-errors").hidden'), true, 'Capturing corrects the related validation error');
    assert.equal(await evaluate('return document.querySelector("#field-key").value'), 'A', 'Capture uses logical layout label');
    assert.equal(await evaluate('return document.querySelector("#field-keyCode").value'), 'KeyQ', 'Capture separately stores physical position');
    await capture(); await fill('#field-repeatMs', '300'); await save();
    await until('!document.querySelector("#editor-drawer")', 'Updated hold');
    await click('[data-focus="view-keyboard"]');
    for (const trigger of ['press', 'hold', 'release']) {
      await select('#field-keyboard-trigger', trigger);
      const expected = (await binding(trigger)).id;
      assert.equal(await evaluate('return document.querySelector("[data-code=KeyA]").dataset.bindingId'), expected, 'Visual key selects ' + trigger);
      await click('[data-code="KeyA"]');
      assert.equal(await evaluate('return document.querySelector("#field-trigger").value'), trigger, 'Editing visual key opens selected moment');
      await close();
    }
    await click('[data-focus="view-table"]');
    await click('[data-focus="test-' + (await binding('hold')).id + '"]');
    await until('Boolean(document.querySelector(".preview-values"))', 'Moment preview ready');
    assert.match(await evaluate('return document.querySelector(".editor-heading").textContent'), /Enquanto pressionada · 300 ms/);
    assert.match(await evaluate('return document.querySelector(".editor-heading").textContent'), /uma execução/);
    await close();
    await evaluate('document.activeElement.blur();await window.keyboardTracker.setEnabled(true);');
    await until('document.querySelector("#input-status").dataset.mode === "unavailable"', 'Wayland reports unavailable global input');
    assert.match(await evaluate('return document.querySelector("#input-status").textContent'), /Wayland|indispon|suport/i);
    await evaluate('await window.keyboardTracker.setEnabled(false);');
    await edit('release');
    await select('#field-type', 'sequence');
    await stepField(0, 'text', 'draft secret text');
    assert.equal(await evaluate('return document.querySelector(".form-errors").hidden'), true, 'Editing the invalid step clears obsolete feedback');
    await click('[data-step-add]');
    await stepField(1, 'type', 'http');
    await stepField(1, 'url', 'https://example.com/task?secret=hide-me');
    await click('[data-step-add]');
    await stepField(2, 'type', 'notification');
    await stepField(2, 'title', 'Notificação QA');
    assert.equal(await evaluate('return document.querySelectorAll("[data-sequence-step][open]").length'), 1, 'Only one sequence step opens');
    assert.doesNotMatch(await evaluate('return Array.from(document.querySelectorAll(".sequence-step > summary")).map(item=>item.textContent).join(" ")'), /draft secret text|hide-me/, 'Summaries omit secret content/query');
    await click('[data-sequence-step]:nth-child(3) [data-step-up]');
    assert.equal(await evaluate(`return document.querySelectorAll('[data-sequence-step]')[1].querySelector('[name$="-title"]').value`), 'Notificação QA', 'Reorder retains drafts');
    await click('[data-sequence-step]:nth-child(2) [data-step-remove]');
    assert.equal(await evaluate('return document.querySelectorAll("[data-sequence-step]").length'), 2);
    assert.equal(await evaluate(`return document.querySelectorAll('[data-sequence-step]')[1].querySelector('[name$="-url"]').value`), 'https://example.com/task?secret=hide-me');
    await stepField(0, 'text', '');
    await save();
    await until('document.activeElement.name.endsWith("-text")', 'Validation focuses first invalid collapsed step');
    assert.equal(await evaluate('return document.querySelectorAll("[data-sequence-step][open]").length'), 1);
    assert.equal(await evaluate('return document.activeElement.closest("[data-sequence-step]").dataset.stepIndex'), '1');
    await stepField(0, 'text', 'draft secret text');
    for (const theme of ['light', 'dark']) {
      await evaluate('window.keyboardAppearance.set(' + JSON.stringify(theme) + ');');
      await nativeEvaluate('process.mainModule.require("electron").BrowserWindow.getAllWindows()[0].setSize(760,580)');
      for (const zoom of [1, 1.25]) {
        await nativeEvaluate('process.mainModule.require("electron").BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(' + zoom + ')');
        await evaluate('await Promise.all(document.querySelector("#editor-drawer").getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));');
        const bounds = await evaluate('const drawer=document.querySelector("#editor-drawer"),header=drawer.querySelector(".editor-heading").getBoundingClientRect(),footer=drawer.querySelector(".form-footer").getBoundingClientRect();return {width:innerWidth,scroll:drawer.scrollWidth,client:drawer.clientWidth,top:header.top,bottom:footer.bottom,height:innerHeight};');
        assert.ok(bounds.scroll <= bounds.client, 'Compact drawer has no horizontal overflow ' + JSON.stringify(bounds));
        assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.height + 1, 'Trigger and save footer remain visible ' + JSON.stringify(bounds));
        assert.doesNotMatch(await evaluate('return document.querySelector(".trigger-summary").textContent'), /null|undefined/);
        await evaluate('document.querySelector("[data-sequence-step][open]").scrollIntoView({block:"start"});');
        await shot('key-moments-sequence-' + theme + '-' + zoom);
      }
    }
    await save(); await until('!document.querySelector("#editor-drawer")', 'Sequence saved with release trigger');
    assert.equal((await binding('release')).action.steps.length, 2);
    await evaluate('window.__momentsReload=true;');
    await cdp('Page.reload');
    await until('!window.__momentsReload && Boolean(document.querySelector("[data-focus=new-binding]"))', 'Moment persistence reload');
    assert.equal((await binding('hold')).repeatMs, 300);
    assert.equal((await binding('release')).keyCode, 'KeyA');
    const held = await binding('hold');
    await click('[data-focus="more-' + held.id + '"]');
    await click('[data-focus="duplicate-' + held.id + '"]');
    assert.equal(await evaluate('return document.querySelector("#field-key").value'), '', 'Duplicated action asks for a new shortcut');
    assert.equal(await evaluate('return document.querySelector("#field-keyCode").value'), 'KeyA', 'Duplication preserves captured metadata until shortcut changes');
    assert.equal(await evaluate('return document.querySelector("#field-trigger").value'), 'hold');
    assert.equal(await evaluate('return document.querySelector("#field-repeatMs").value'), '300');
    await close();
    if (await evaluate('return document.querySelector("#confirm-dialog").open')) await click('#confirm-dialog .danger-solid');
    const pressed = await binding('press');
    await click('[data-focus="more-' + pressed.id + '"]');
    await click('[data-focus="remove-' + pressed.id + '"]');
    await click('#confirm-dialog .danger-solid');
    await until('document.querySelectorAll(".binding-trigger-label").length === 2', 'Removing press preserves other moments');
    assert.equal((await binding('hold')).id, held.id);
    assert.equal((await nativeState()).config.layers[0].bindings.length, 2);
    console.log('Key moments UI passed: three moments on one shortcut, physical/logical capture, manual invalidation, hold interval/edit/persistence, visual moment selection, explicit preview, unavailable input feedback, one-open sequence/draft/reorder/remove/validation, compact light/dark 760×580 at 100/125% zoom.');
  } finally {
    await nativeEvaluate('process.mainModule.require("electron").BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1);process.mainModule.require("electron").BrowserWindow.getAllWindows()[0].setSize(1280,900)');
    await evaluate('const form=document.querySelector("form[data-draft]");if(form){for(const input of form.querySelectorAll("input,textarea,select"))input.removeAttribute("required");}');
    if (await evaluate('return Boolean(document.querySelector("#editor-drawer"))')) { await close(); if (await evaluate('return document.querySelector("#confirm-dialog").open')) await click('#confirm-dialog .danger-solid'); }
    await evaluate('await window.keyboardTracker.setEnabled(false);await window.keyboardTracker.saveConfig(' + JSON.stringify(before.config) + ');await window.keyboardTracker.setLayer(' + JSON.stringify(before.activeLayerId) + ');');
  }
};
