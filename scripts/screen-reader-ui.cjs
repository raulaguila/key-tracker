const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
module.exports = async function screenReader({ cdp, evaluate, click, fill, press, until, nativeState, nativeEvaluate }) {
  assert.ok(process.env.DOBRA_ORCA_LOG, 'Run with npm run test:orca');
  const dir = path.resolve('artifacts/screen-reader'), cases = [];
  let passed = false;
  const probe = path.join(__dirname, 'orca-atspi.py');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const nativeKey = (...keys) => exec('/usr/bin/python3', [probe, ...keys], { timeout: 5000 });
  const snapshot = async () => JSON.parse((await exec('/usr/bin/python3', [probe], { timeout: 10000, maxBuffer: 2 * 1024 * 1024 })).stdout);
  const log = () => fs.readFile(process.env.DOBRA_ORCA_LOG, 'utf8');
  const state = await nativeState(), config = structuredClone(state.config), layer = config.layers[0];
  layer.bindings = [{ id: 'orca-action', name: 'Texto para revisão Orca', key: 'Control+Alt+A', action: { type: 'sequence', stepDelayMs: 0, steps: [{ type: 'log', message: 'orca-one' }, { type: 'log', message: 'orca-two' }] } }];
  async function capture(name, task, expected) {
    const start = (await log()).length; await task();
    let speech = [], text = ''; const deadline = Date.now() + 6000;
    do {
      await pause(100); speech = (await log()).slice(start).split('\n').filter(line => line.includes('SPEECH OUTPUT:')); text = speech.join('\n');
      if (expected.test(text)) { await pause(250); break; }
    } while (Date.now() < deadline);
    speech = (await log()).slice(start).split('\n').filter(line => line.includes('SPEECH OUTPUT:')); text = speech.join('\n');
    const tree = await snapshot(); cases.push({ name, speech, focused: tree.filter(node => node.focused) });
    await fs.writeFile(path.join(dir, name + '.json'), JSON.stringify(tree, null, 2));
    assert.match(text, expected, 'Actual Orca speech: ' + name); return tree;
  }
  async function activate(selector) { await evaluate('document.querySelector(' + JSON.stringify(selector) + ').focus()'); await press('Enter', 'Enter', 13); }
  try {
    await pause(1500);
    await nativeEvaluate('process.mainModule.require("electron").BrowserWindow.getAllWindows()[0].focus()');
    await nativeKey('Tab'); await pause(700);
    for (const theme of ['light', 'dark']) {
      await evaluate('window.dobraAppearance.set(' + JSON.stringify(theme) + ')');
      for (const [view, title] of [['tracking', 'Rastreio do teclado'], ['history', 'Histórico de execução'], ['settings', 'Configurações'], ['layers', layer.name]]) {
        const tree = await capture(theme + '-' + view, () => activate('#navigation [data-view=' + view + ']'), new RegExp(title));
        assert.ok(tree.some(n => n.focused && n.role === 'heading' && n.name === title), 'Native focus reaches heading: ' + view);
      }
      let tree = await capture(theme + '-editor', () => activate('[data-focus=new-binding]'), /Nome da ação/);
      assert.ok(tree.some(n => n.role === 'dialog' && n.name === 'Nova ação'), 'Named editor');
      await press('Tab', 'Tab', 9); await press('Tab', 'Tab', 9, 8);
      assert.equal(await evaluate('return document.activeElement.id'), 'field-name', 'Dialog retains tab focus');
      await fill('#field-name', 'Teste de leitura'); await evaluate('document.querySelector("#editor-drawer form").noValidate=true');
      tree = await capture(theme + '-error', () => evaluate('document.querySelector("#editor-drawer form").requestSubmit()'), /Digite ou capture uma tecla/);
      const invalid = tree.find(n => n.focused && n.attributes.id === 'field-key');
      assert.ok(invalid?.description.includes('Digite ou capture uma tecla'), 'Native description includes error');
      assert.ok(invalid.description.includes('Capture no seu teclado'), 'Original hint preserved');
      await capture(theme + '-error-refocus', async () => { await evaluate('document.querySelector("#field-name").focus()'); await pause(300); await evaluate('document.querySelector("#field-key").focus()'); }, /Digite ou capture uma tecla/);
      await fill('#field-key', 'Control+Alt+B');
      assert.equal(await evaluate('return document.querySelector("#field-key").hasAttribute("aria-invalid")'), false);
      assert.equal(await evaluate('return document.querySelector("#field-key").getAttribute("aria-describedby")'), 'field-key-hint');
      await press('Escape', 'Escape', 27); await until('document.querySelector("#confirm-dialog").open', 'Discard confirmation');
      await capture(theme + '-discard', () => click('#confirm-dialog .danger-solid'), /Nova ação/);
      await until('!document.querySelector("#editor-drawer")', 'Editor closed');
      assert.equal(await evaluate('return document.activeElement.dataset.focus'), 'new-binding');
      tree = await capture(theme + '-library', () => activate('[data-focus=model-library]'), /Biblioteca de modelos/);
      assert.ok(tree.some(n => n.role === 'dialog' && n.name === 'Biblioteca de modelos' && n.description.includes('Revise as camadas')), 'Library description');
      await until('document.querySelectorAll(".template-row").length===3 && !document.querySelector(".productivity-content").inert', 'Library ready');
      await evaluate('window.__dialogIds=[];window.__dialogObserver=new MutationObserver(()=>{const ids=[...document.querySelectorAll("[id]")].map(n=>n.id);window.__dialogIds.push(ids.length===new Set(ids).size);});window.__dialogObserver.observe(document.body,{childList:true,subtree:true});');
      tree = await capture(theme + '-import', () => activate('.template-row button'), /Adicionar camadas/);
      assert.ok(tree.some(n => n.role === 'dialog' && n.name === 'Adicionar camadas' && n.description.includes('conflitos')), 'Import owns its title/description');
      assert.equal(await evaluate('window.__dialogObserver.disconnect();return window.__dialogIds.length>0&&window.__dialogIds.every(Boolean)'), true, 'Unique IDs during dialog transitions');
      await capture(theme + '-import-close', () => press('Escape', 'Escape', 27), /Modelos e importação/);
      assert.equal(await evaluate('return document.activeElement.dataset.focus'), 'model-library', 'Dialog chain returns to original trigger');
      await capture(theme + '-search', () => press('k', 'KeyK', 75, 2), /Buscar comandos/);
      await capture(theme + '-search-result', () => press('ArrowDown', 'ArrowDown', 40), /Biblioteca de modelos/);
      await press('Escape', 'Escape', 27);
      await activate('#navigation [data-view=history]'); await evaluate('await window.dobra.setEnabled(false);await window.dobra.saveConfig(' + JSON.stringify(config) + ');await window.dobra.setLayer(' + JSON.stringify(layer.id) + ');await window.dobra.runBinding(' + JSON.stringify(layer.id) + ',"orca-action")');
      await until('Boolean(document.querySelector(".execution-steps summary"))', 'History details');
      await capture(theme + '-history-details', () => activate('.execution-steps summary'), /Etapas/);
      await evaluate('window.__orcaSummary=document.activeElement;await window.dobra.runBinding(' + JSON.stringify(layer.id) + ',"orca-action")');
      assert.equal(await evaluate('return window.__orcaSummary===document.activeElement&&window.__orcaSummary.parentElement.open'), true, 'History preserves reading position');
    }
    await activate('#navigation [data-view=tracking]'); await pause(1000);
    // Keep structural navigation enabled when a focused form control follows a heading.
    await capture('native-browse-mode', () => nativeKey('Insert+a', 'Insert+a', 'Insert+a'), /Browse mode is sticky/);
    await capture('native-next-heading', () => nativeKey('h'), /Pressionadas agora|Rastreio do teclado/);
    await capture('native-landmark', () => nativeKey('m'), /Teclas pressionadas|Teclado visual|content/);
    passed = true;
    console.log('Orca passed: native AT-SPI and speech; both themes, headings, dialogs, field errors/re-reading, search, history and X11 browse navigation.');
  } finally {
    await fs.writeFile(path.join(dir, 'results.json'), JSON.stringify({ passed, reader: 'Installed Orca', transport: 'Native AT-SPI + X11', speech: 'Text generated by Orca; no human listening assessment', cases }, null, 2));
  }
};
