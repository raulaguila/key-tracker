const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

// Invoked by ui-smoke in its real Electron session and isolated configuration.
// Native recording/replay is exercised separately in macro-native-ui.cjs.
module.exports = async function macroEditorUI({ cdp, evaluate, click, fill, select, press, until, nativeState, save, shot }) {
  const before = await nativeState();
  const originalTheme = await evaluate('return window.dobraAppearance.preference');
  const config = structuredClone(before.config);
  config.layers = [{ id: 'macro-ui-layer', name: 'Fluxos QA', description: '', applications: [], bindings: [
    { id: 'macro-ui-binding', name: 'Fluxo manual QA', key: 'Control+Alt+M', enabled: true, action: { type: 'clipboard', text: 'Inicial' } }
  ] }];
  let states = 0;
  async function stepField(index, key, value) {
    const selector = await evaluate(`const step=document.querySelectorAll('[data-macro-step]')[${index}];
      const input=step.querySelector(${JSON.stringify('[name$="-' + key + '"]')});
      if(!input)throw new Error('Missing macro field: '+${JSON.stringify(key)});
      for(let parent=input.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
      return '#'+input.id;`);
    const tag = await evaluate('return document.querySelector(' + JSON.stringify(selector) + ').tagName');
    await (tag === 'SELECT' ? select : fill)(selector, value);
  }
  async function add(kind) { await select('[name="macro-newKind"]', kind); await click('[data-macro-add]'); }
  async function check(name) {
    await evaluate('await Promise.all(document.getAnimations().filter(item=>item.effect?.getTiming().iterations!==Infinity).map(item=>item.finished.catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));');
    const violations = await evaluate("return (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>({target:node.target,message:node.failureSummary}))}));");
    assert.deepEqual(violations, [], 'Macro editor accessibility: ' + name);
    assert.equal(await evaluate('const form=document.querySelector("#editor-drawer");return form.scrollWidth>form.clientWidth+1'), false, 'No drawer horizontal overflow: ' + name);
    states++;
  }
  async function closeEditor() {
    if (!await evaluate('return Boolean(document.querySelector("#editor-drawer"))')) return;
    await click('[data-drawer-close]');
    if (await evaluate('return Boolean(document.querySelector("#confirm-dialog")?.open)')) await click('#confirm-dialog .dialog-actions button:last-child');
    await until('!document.querySelector("#editor-drawer")', 'Macro editor closes');
  }
  async function focusTarget(stepIndex, control) {
    return evaluate(`const node=document.querySelectorAll('[data-macro-step]')[${stepIndex}].querySelector(${JSON.stringify(control)});
      node.focus();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const r=node.getBoundingClientRect(),clip=node.closest('.form-fields').getBoundingClientRect();
      return {top:r.top,bottom:r.bottom,clipTop:clip.top,clipBottom:clip.bottom,focused:document.activeElement===node};`);
  }
  async function fixedBars(name) {
    const bounds = await evaluate(`const drawer=document.querySelector('#editor-drawer'),header=drawer.querySelector('.editor-heading').getBoundingClientRect(),footer=drawer.querySelector('.form-footer').getBoundingClientRect(),rect=drawer.getBoundingClientRect();
      return {headerTop:header.top,drawerTop:rect.top,footerBottom:footer.bottom,drawerBottom:rect.bottom,scrollTop:drawer.scrollTop};`);
    assert.equal(bounds.scrollTop, 0, 'Only the form fields scroll: ' + name);
    assert.ok(Math.abs(bounds.headerTop-bounds.drawerTop)<1 && Math.abs(bounds.footerBottom-bounds.drawerBottom)<1, 'Header and save bar stay at the viewport edges: ' + name + ' ' + JSON.stringify(bounds));
  }
  async function tapToolbar(stepIndex, control) {
    const point = await evaluate(`const node=document.querySelectorAll('[data-macro-step]')[${stepIndex}].querySelector(${JSON.stringify(control)});
      node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();
      const x=r.left+r.width/2,y=r.bottom-3;return {x,y,hits:node.contains(document.elementFromPoint(x,y))};`);
    assert.equal(point.hits, true, 'The bottom of the step target is exposed');
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, radiusX: 1, radiusY: 1, force: 1, id: 1 }] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  try {
    await evaluate('await window.dobra.setEnabled(false);await window.dobra.saveConfig(' + JSON.stringify(config) + ');');
    await click('[data-view="layers"]');
    await until('Boolean(document.querySelector("[data-focus=edit-macro-ui-binding]"))', 'Macro UI fixture visible');
    await click('[data-focus="edit-macro-ui-binding"]');
    await select('#field-type', 'macro');
    await until('document.querySelector("[data-macro-status]")?.dataset.status!=="loading"', 'Macro native capability available');
    assert.equal(await evaluate('return document.querySelectorAll("[data-macro-step]").length'), 0, 'New macro starts with an instructional empty state');
    await save();
    await until('!document.querySelector(".form-errors").hidden', 'Empty flow rejected in editor');
    assert.match(await evaluate('return document.querySelector(".form-errors").textContent'), /pelo menos uma etapa/);
    await fill('[name="macro-startDelayMs"]', '25');
    await add('click'); await stepField(0, 'x', '-12'); await stepField(0, 'y', '65'); await stepField(0, 'button', 'right'); await stepField(0, 'clicks', '2'); await stepField(0, 'delayBeforeMs', '17');
    await add('text'); await stepField(1, 'text', 'Olá! Texto editável com acentos.');
    await add('key');
    await evaluate('document.querySelectorAll("[data-macro-step]")[2].querySelector(".input-with-button button").click();');
    await press('A', 'KeyA', 65, 10);
    assert.equal(await evaluate(`return document.querySelectorAll('[data-macro-step]')[2].querySelector('[name$="-key"]').value`), 'Control+Shift+A', 'Key step uses the existing real shortcut capture');
    await add('wait'); await stepField(3, 'ms', '50');
    await add('click');
    await evaluate('document.querySelectorAll("[data-macro-step]")[4].querySelector("[data-macro-remove]").click();');
    assert.equal(await evaluate('return document.querySelectorAll("[data-macro-step]").length'), 4, 'Remove only the selected step');
    await evaluate('document.querySelectorAll("[data-macro-step]")[3].querySelector("[data-macro-up]").click();');
    assert.equal(await evaluate(`return document.querySelectorAll('[data-macro-step]')[2].querySelector('[name$="-kind"]').value`), 'wait', 'Reorder changes the flow');
    await evaluate('document.querySelectorAll("[data-macro-step]")[2].querySelector("[data-macro-down]").click();');
    await select('#field-type', 'clipboard'); await fill('#field-text', 'Rascunho preservado'); await select('#field-type', 'macro');
    assert.equal(await evaluate('return document.querySelectorAll("[data-macro-step]")[1].querySelector("textarea").value'), 'Olá! Texto editável com acentos.', 'Type switching preserves macro draft');
    assert.equal(await evaluate('return document.querySelector("[name=macro-startDelayMs]").value'), '25');
    await click('[data-macro-authorize]');
    await until('!document.querySelector("[data-macro-authorize]").disabled', 'Native permission check returns');
    assert.equal(await evaluate('return document.querySelectorAll("[data-macro-step]")[1].querySelector("textarea").value'), 'Olá! Texto editável com acentos.', 'Native permission recovery preserves editable fields');
    await cdp('Runtime.evaluate', { expression: await fs.readFile(require.resolve('axe-core/axe.min.js'), 'utf8') });
    for (const theme of ['light', 'dark']) {
      await evaluate('window.dobraAppearance.set(' + JSON.stringify(theme) + ');document.querySelectorAll(".macro-step,.macro-step-delay").forEach(node=>node.open=true);');
      await check(theme + '/expanded');
      await shot('macro-editor-' + theme);
      await evaluate('document.querySelector("[data-macro-step]").scrollIntoView({block:"start"});');
      await fixedBars(theme + '/expanded-steps');
      await shot('macro-editor-' + theme + '-steps');
      await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
      await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      assert.equal(await evaluate("return matchMedia('(pointer:coarse)').matches"), true, 'Actual coarse pointer emulation');
      await check(theme + '/narrow-touch');
      const targets = await evaluate(`return [...document.querySelectorAll('.macro-editor button,.macro-editor summary')].filter(node=>node.getClientRects().length&&!node.disabled).map(node=>({label:node.getAttribute('aria-label')||node.textContent.trim(),w:node.getBoundingClientRect().width,h:node.getBoundingClientRect().height})).filter(item=>item.w<43.9||item.h<43.9);`);
      assert.deepEqual(targets, [], 'Macro touch targets >=44px: ' + theme);
      const focus = await focusTarget(1, '[data-macro-down]');
      assert.ok(focus.focused && focus.top >= focus.clipTop && focus.bottom <= focus.clipBottom, 'Keyboard focus reveals the entire toolbar target: ' + JSON.stringify(focus));
      await tapToolbar(1, '[data-macro-down]');
      await until(`document.querySelectorAll('[data-macro-step]')[2].querySelector('[name$="-kind"]').value==='text'`, 'Bottom-edge touch reorders the selected step');
      await tapToolbar(2, '[data-macro-up]');
      await until(`document.querySelectorAll('[data-macro-step]')[1].querySelector('[name$="-kind"]').value==='text'`, 'Bottom-edge touch restores step order');
      await evaluate('document.querySelector(".macro-recording-controls").scrollIntoView({block:"start"});');
      await shot('macro-editor-' + theme + '-narrow');
      await evaluate('document.querySelector("[data-macro-step]").scrollIntoView({block:"start"});');
      await fixedBars(theme + '/narrow-steps');
      await shot('macro-editor-' + theme + '-narrow-steps');
      await cdp('Emulation.clearDeviceMetricsOverride');
      await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
    await save(); await until('!document.querySelector("#editor-drawer")', 'Manual macro saved with real IPC');
    const saved = (await nativeState()).config.layers[0].bindings[0].action;
    assert.equal(saved.type, 'macro'); assert.equal(saved.startDelayMs, 25);
    assert.deepEqual(saved.steps, [
      { kind: 'click', x: -12, y: 65, button: 'right', clicks: 2, delayBeforeMs: 17 },
      { kind: 'text', text: 'Olá! Texto editável com acentos.', delayBeforeMs: 0 },
      { kind: 'key', key: 'Control+Shift+A', delayBeforeMs: 0 },
      { kind: 'wait', ms: 50 }
    ], 'All editable step kinds persist in order');
    await click('[data-focus="edit-macro-ui-binding"]');
    assert.equal(await evaluate('return document.querySelectorAll("[data-macro-step]").length'), 4, 'Reopening restores persisted flow');
    await closeEditor();
    console.log('Macro editor UI passed: real IPC, four step types, native key capture, order/remove, draft retention through type/permission changes; ' + states + ' axe states, light/dark, narrow touch targets >=44px.');
  } finally {
    await cdp('Emulation.clearDeviceMetricsOverride');
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
    await closeEditor();
    await evaluate('window.dobraAppearance.set(' + JSON.stringify(originalTheme) + ');await window.dobra.saveConfig(' + JSON.stringify(before.config) + ');');
  }
};
