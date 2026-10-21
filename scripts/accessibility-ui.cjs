const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

// Run inside the real Electron smoke so IPC, themes and dialogs remain authentic.
module.exports = async function accessibilityUI({ cdp, evaluate, click, until }) {
  const original = await evaluate('return {theme:window.dobraAppearance.preference,view:document.querySelector("[data-view][aria-current=page]").dataset.view};');
  await cdp('Runtime.evaluate', { expression: await fs.readFile(require.resolve('axe-core/axe.min.js'), 'utf8') });
  let scenarios = 0;
  async function check(name) {
    const result = await evaluate(`
      await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const result = await axe.run(document, {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});
      return {violations:result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))};
    `);
    assert.deepEqual(result.violations, [], 'Acessibilidade: ' + name + ' ' + JSON.stringify(result.violations));
    scenarios++;
  }
  try {
    for (const theme of ['light', 'dark']) {
      await evaluate('window.dobraAppearance.set(' + JSON.stringify(theme) + ');');
      for (const view of ['layers', 'tracking', 'history', 'settings']) {
        await click('[data-view=' + view + ']');
        await check(theme + '/' + view);
      }
      await click('[data-view=layers]');
      await click('[data-focus=new-binding]');
      await until('Boolean(document.querySelector("#editor-drawer[open]"))', 'Editor de acessibilidade aberto');
      for (const type of ['clipboard', 'http', 'sequence']) {
        await evaluate('const input=document.querySelector("#field-type");input.value=' + JSON.stringify(type) + ';input.dispatchEvent(new Event("change",{bubbles:true}));');
        await check(theme + '/drawer-' + type);
      }
      await click('[data-drawer-close]');
      await until('!document.querySelector("#editor-drawer") || document.querySelector("#confirm-dialog").open', 'Fechamento do editor de acessibilidade');
      if (await evaluate('return document.querySelector("#confirm-dialog").open')) await click('#confirm-dialog .dialog-actions button:last-child');
      await until('!document.querySelector("#editor-drawer")', 'Rascunho de acessibilidade descartado');
    }
    console.log('Accessibility UI passed: axe-core ' + require('axe-core/package.json').version + ', ' + scenarios + ' states, light/dark, four views and three action drawers; zero WCAG A/AA violations.');
  } finally {
    await evaluate('window.dobraAppearance.set(' + JSON.stringify(original.theme) + ');document.querySelector("[data-view=' + original.view + ']").click();');
  }
};
