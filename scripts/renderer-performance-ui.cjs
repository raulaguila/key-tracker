// Focused real-renderer regression: fixed 100-row fixture, native IPC/events,
// and DOM identity/mutation checks. No wall-clock pass/fail threshold.
const assert = require('node:assert/strict');
const http = require('node:http');

module.exports = async function rendererPerformanceUI({ evaluate, click, fill, until, nativeState }) {
  const before = await nativeState();
  const server = http.createServer((_req, res) => { res.writeHead(503); res.end('fixture unavailable'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = 'http://127.0.0.1:' + server.address().port + '/fixture';
  const layerId = 'renderer-performance-layer';
  const keys = ['', 'Control+', 'Alt+', 'Shift+'].flatMap(prefix => [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(key => prefix + key));
  const fixture = { ...structuredClone(before.config), settings: { ...before.config.settings, autoSwitchLayers: false }, layers: [{
    id: layerId, name: 'Renderer QA', description: '', applications: [], bindings: Array.from({ length: 100 }, (_, index) => ({
      id: 'renderer-performance-' + index, name: 'Ação ' + String(index).padStart(3, '0'), key: keys[index], enabled: true,
      action: index === 1 ? { type: 'http', method: 'GET', url: endpoint, headers: {}, query: {}, body: '' } : { type: 'log', message: 'Renderer QA' }
    }))
  }] };
  try {
    await evaluate('document.activeElement.blur();await window.keyboardTracker.setEnabled(false);await window.keyboardTracker.saveConfig(' + JSON.stringify(fixture) + ');await window.keyboardTracker.setLayer(' + JSON.stringify(layerId) + ');');
    await click('[data-view="layers"]');
    await click('[data-focus="view-table"]');
    await until('document.querySelectorAll(".binding-row").length === 100', '100-row fixture rendered');
    assert.equal(await evaluate('return [...document.querySelectorAll("#bindings [popover]")].reduce((sum,node)=>sum+node.children.length,0)'), 0, 'Closed menus have no controls');
    await evaluate('window.rendererFirstRow=document.querySelector("[data-binding-id=renderer-performance-0]");');
    const search = await evaluate(`
      const root=document.querySelector('#bindings');
      const mutations=new MutationObserver(()=>{});mutations.observe(root,{childList:true,subtree:true});
      const input=document.querySelector('#field-action-search');const durations=[];let additions=0;
      for(let i=0;i<40;i++) { const start=performance.now();input.value=i%2?'':'Ação 0';input.dispatchEvent(new Event('input',{bubbles:true}));void root.offsetHeight;durations.push(performance.now()-start);for(const record of mutations.takeRecords()) additions+=record.addedNodes.length; }
      mutations.disconnect();durations.sort((a,b)=>a-b);
      return {medianMs:durations[20],p95Ms:durations[38],addedNodes:additions,documentElements:document.querySelectorAll('*').length};
    `);
    assert.equal(search.addedNodes, 0, 'Matching searches reuse rows without adding DOM nodes');
    await fill('#field-action-search', 'Ação 009');
    assert.equal(await evaluate('return document.querySelectorAll(".binding-row:not([hidden])").length'), 1, 'Search hides non-matching rows');
    await fill('#field-action-search', '');
    assert.equal(await evaluate('return window.rendererFirstRow === document.querySelector("[data-binding-id=renderer-performance-0]")'), true, 'Clearing search preserves row identity');
    await click('[data-focus="more-renderer-performance-0"]');
    assert.equal(await evaluate('return document.querySelector("#menu-renderer-performance-0").children.length'), 3, 'Opening one menu builds its controls');
    const revision = (await nativeState()).configRevision;
    await evaluate('await window.keyboardTracker.setEditing(true);await window.keyboardTracker.setEditing(false);');
    assert.equal((await nativeState()).configRevision, revision, 'Editing state keeps configuration revision unchanged');
    assert.equal(await evaluate('return window.rendererFirstRow === document.querySelector("[data-binding-id=renderer-performance-0]") && document.querySelector("#menu-renderer-performance-0").matches(":popover-open")'), true, 'State changes retain the row and open menu');
    await evaluate('document.querySelector("#menu-renderer-performance-0").hidePopover();');
    await until('document.querySelector("#menu-renderer-performance-0").children.length === 0', 'Closing menu releases its controls');
    await evaluate('await window.keyboardTracker.runBinding(' + JSON.stringify(layerId) + ',"renderer-performance-0");');
    await until('Boolean(document.querySelector("[data-binding-id=renderer-performance-0] .binding-result.success"))', 'Successful result is shown');
    await evaluate('window.rendererFirstResult=document.querySelector("[data-binding-id=renderer-performance-0] .binding-result");');
    await evaluate('await window.keyboardTracker.runBinding(' + JSON.stringify(layerId) + ',"renderer-performance-1");');
    await until('Boolean(document.querySelector("[data-binding-id=renderer-performance-1] .binding-result.error"))', 'HTTP failure updates its own row');
    assert.equal(await evaluate('return window.rendererFirstRow === document.querySelector("[data-binding-id=renderer-performance-0]") && window.rendererFirstResult === document.querySelector("[data-binding-id=renderer-performance-0] .binding-result")'), true, 'A different result preserves existing row and feedback identities');
    const renamed = structuredClone(fixture);
    renamed.layers[0].bindings[0].name = 'Renomeada QA';
    renamed.layers[0].bindings[0].action.message = 'Modelo atualizado';
    await evaluate('document.activeElement.blur();await window.keyboardTracker.saveConfig(' + JSON.stringify(renamed) + ');');
    await until('document.querySelector("[data-binding-id=renderer-performance-0] strong").textContent === "Renomeada QA"', 'Revision updates row content');
    assert.ok((await nativeState()).configRevision > revision, 'Saving advances configuration revision');
    assert.equal(await evaluate('return window.rendererFirstRow === document.querySelector("[data-binding-id=renderer-performance-0]")'), true, 'Configuration edit keeps keyed row identity');
    await click('[data-focus="more-renderer-performance-0"]');
    await click('[data-focus="duplicate-renderer-performance-0"]');
    assert.equal(await evaluate('return document.querySelector("#field-name").value'), 'Renomeada QA · cópia');
    assert.equal(await evaluate('return document.querySelector("#field-message").value'), 'Modelo atualizado', 'Lazy handlers use the current binding model');
    await click('[data-drawer-close]');
    await click('[data-focus="view-keyboard"]');
    await evaluate('window.rendererVisualRow=document.querySelector(".visual-binding-item");window.rendererVisualKey=document.querySelector("[data-focus=visual-key-KeyA]");');
    await fill('#field-action-search', 'Ação 009');
    assert.equal(await evaluate('return document.querySelectorAll(".visual-binding-item:not([hidden])").length'), 1, 'Keyboard list filters matching actions');
    await fill('#field-action-search', '');
    assert.equal(await evaluate('return window.rendererVisualRow === document.querySelector(".visual-binding-item") && window.rendererVisualKey === document.querySelector("[data-focus=visual-key-KeyA]")'), true, 'Keyboard search preserves key and list node identities');
    assert.equal(await evaluate('return [...document.querySelectorAll("#bindings [popover]")].reduce((sum,node)=>sum+node.children.length,0)'), 0, 'Keyboard menus also stay lazy');
    console.log('Renderer optimization UI passed: revision changes, 100 keyed rows, search reuse, lazy menu lifecycle, targeted success/error feedback, fresh action handlers and keyboard reuse. ' + JSON.stringify(search));
  } finally {
    await evaluate('window.rendererFirstRow=null;window.rendererFirstResult=null;window.rendererVisualRow=null;window.rendererVisualKey=null;document.activeElement.blur();await window.keyboardTracker.setEditing(false);await window.keyboardTracker.saveConfig(' + JSON.stringify(before.config) + ');await window.keyboardTracker.setLayer(' + JSON.stringify(before.activeLayerId) + ');').catch(() => {});
    await click('[data-focus="view-table"]').catch(() => {});
    await new Promise(resolve => server.close(resolve));
  }
};
