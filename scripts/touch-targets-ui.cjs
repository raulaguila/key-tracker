const assert = require('node:assert/strict');

// Use the real renderer and touch dispatch: the bottom of an enlarged target
// must activate its control, including areas outside the old compact bounds.
module.exports = async function touchTargets({ cdp, evaluate, click, select, press, until, check, shot, evidence }) {
  evidence.touchControls = [];
  async function measure(theme, width, view) {
    const result = await evaluate(`
      const root=document.querySelector('dialog[open]')||document.querySelector('main');
      const controls=[...root.querySelectorAll('summary,.input-with-button .button:not(:disabled)')].filter(n=>n.getClientRects().length).map(node=>{const r=node.getBoundingClientRect();return {name:node.textContent.trim(),tag:node.tagName,width:r.width,height:r.height};});
      return {coarse:matchMedia('(pointer:coarse)').matches,count:controls.length,minHeight:Math.min(...controls.map(r=>r.height)),undersized:controls.filter(r=>r.width<43.99||r.height<43.99),pageOverflow:document.documentElement.scrollWidth>innerWidth};
    `);
    evidence.touchControls.push({ theme, width, view, ...result });
    assert.ok(result.coarse && result.count > 0, 'Touch controls rendered: ' + view);
    assert.deepEqual(result.undersized, [], '44px capture/expand controls: ' + JSON.stringify({ theme, width, view, ...result }));
    assert.equal(result.pageOverflow, false, 'Enlarged controls fit the window');
  }
  async function tapBottom(selector) {
    const point = await evaluate('const node=document.querySelector(' + JSON.stringify(selector) + ');node.scrollIntoView({block:"center",inline:"nearest"});const r=node.getBoundingClientRect();const point={x:r.left+Math.min(60,r.width/2),y:r.bottom-3};return {...point,hits:node.contains(document.elementFromPoint(point.x,point.y))};');
    assert.ok(point.hits, 'Bottom of target is unobstructed: ' + selector);
    const { x, y } = point;
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  for (const theme of ['light', 'dark']) {
    await evaluate('window.dobraAppearance.set(' + JSON.stringify(theme) + ')');
    for (const width of [760, 390]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: true });
      for (const view of ['layers', 'tracking', 'history', 'settings']) {
        await click('[data-view=' + view + ']');
        if (view === 'settings') await evaluate('document.querySelectorAll("main details").forEach(node=>node.open=true)');
        await measure(theme, width, view);
        if (view === 'history') {
          await evaluate('document.querySelector(".execution-steps").open=false');
          await tapBottom('.execution-steps summary');
          await until('document.querySelector(".execution-steps").open', 'Touch opens execution details');
        }
        if (view === 'settings') {
          const capture = '#field-layerShortcut + .button';
          await tapBottom(capture);
          assert.equal(await evaluate('return document.querySelector(' + JSON.stringify(capture) + ').getAttribute("aria-pressed")'), 'true', 'Touch starts shortcut capture');
          await press('Escape', 'Escape', 27);
          assert.equal(await evaluate('return document.querySelector(' + JSON.stringify(capture) + ').getAttribute("aria-pressed")'), 'false', 'Escape cancels capture');
          await tapBottom('.support-details > summary');
          await until('!document.querySelector(".support-details").open', 'Touch closes permission details');
          await tapBottom('.support-details > summary');
          await until('document.querySelector(".support-details").open', 'Touch reopens permission details');
          await shot('touch-controls-settings-' + theme + '-' + width);
        }
        await check('touch-controls/' + theme + '/' + width + '/' + view);
      }
      await click('[data-view=layers]'); await click('[data-focus=new-binding]');
      await until('document.querySelector("#editor-drawer[open]") && !document.querySelector(".form-fields").inert', 'Touch editor ready');
      for (const type of ['clipboard', 'sequence']) {
        await select('#field-type', type);
        await measure(theme, width, 'editor-' + type);
        await check('touch-controls/' + theme + '/' + width + '/editor-' + type);
      }
      await tapBottom('#field-key + .button');
      assert.equal(await evaluate('return document.querySelector("#field-key + .button").getAttribute("aria-pressed")'), 'true');
      await press('Escape', 'Escape', 27);
      assert.equal(await evaluate('return document.querySelector("#editor-drawer").open'), true, 'Cancelling capture retains the editor');
      await click('[data-drawer-close]');
      await until('document.querySelector("#confirm-dialog").open', 'Discard changed action type');
      await click('#confirm-dialog .danger-solid');
      await until('!document.querySelector("#editor-drawer")', 'Touch draft discarded');
    }
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 760, height: 580, deviceScaleFactor: 1, mobile: true });
};
