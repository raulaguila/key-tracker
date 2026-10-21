// Production UI against real Electron IPC/storage/actions. Only native dialog
// choices are supplied at the UI boundary; every file stays in ui-smoke's profile.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');

module.exports = async function productionUI({ cdp, evaluate, click, fill, until, nativeState, shot, nativeEvaluate, data }) {
  const before = await nativeState();
  const electron = 'process.mainModule.require("electron")';
  const directory = path.join(data, 'production-ui'); await fs.mkdir(directory, { recursive: true });
  const diagPath = path.join(directory, 'diagnostics.json');
  const portablePath = path.join(directory, 'portable.json');
  const clipboardBefore = await nativeEvaluate(electron + '.clipboard.readText()');
  let httpStarted = false;
  const server = http.createServer((_req, res) => { httpStarted = true; res.on('close', () => {}); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/PRIVATE_URL_CANARY';
  const file = filename => ({ type: 'file', directory, filename, mode: 'create', content: 'PRIVATE_BODY_CANARY' });
  const sequence = { type: 'sequence', stepDelayMs: 4000, steps: [file('first.txt'), file('never.txt')] };
  const config = { ...structuredClone(before.config), layers: [{ id: 'production-ui', name: 'PRIVATE_LAYER_CANARY', bindings: [
    { id: 'production-wait', name: 'PRIVATE_ACTION_CANARY', key: 'J', action: sequence },
    { id: 'production-http', name: 'HTTP em andamento', key: 'K', action: { type: 'http', method: 'GET', url, headers: {}, query: {}, body: '' } },
    ...['a', 'b'].map((id, index) => ({ id: 'production-all-' + id, name: 'Sequência ' + id, key: index ? 'M' : 'L', action: { type: 'sequence', stepDelayMs: 4000, steps: [{ type: 'log', message: 'PRIVATE_LOG_CANARY' }, { type: 'log', message: 'Nunca executar' }] } }))
  ] }] };
  async function launch(id) {
    await click('[data-view="layers"]');
    await click('[data-focus="test-' + id + '"]');
    await until('Boolean(document.querySelector("[data-focus=execute-preview]")) && !document.querySelector("[data-focus=execute-preview]").disabled', 'Preview ready ' + id);
    await click('[data-focus="execute-preview"]');
    await until('Boolean(document.querySelector("[data-focus=execute-preview]").disabled)', 'Execution started ' + id);
    await click('[data-drawer-close]');
    await click('[data-view="history"]');
    await until('Boolean(document.querySelector(' + JSON.stringify('[data-running-id="' + id + '"]') + '))', 'Running execution visible ' + id);
  }
  async function waitFile(filename) {
    const end = Date.now() + 10000;
    while (Date.now() < end) { try { return JSON.parse(await fs.readFile(filename, 'utf8')); } catch { await new Promise(resolve => setTimeout(resolve, 50)); } }
    throw new Error('Export did not produce ' + filename);
  }
  try {
    await evaluate('await window.keyboardTracker.setEnabled(false);await window.keyboardTracker.saveConfig(' + JSON.stringify(config) + ');await window.keyboardTracker.setLayer("production-ui");localStorage.setItem("keyboard-tracker.binding-view","table");window.__productionReload=true;');
    await cdp('Page.reload');
    await until('!window.__productionReload && Boolean(document.querySelector("[data-focus=new-binding]"))', 'Production fixture ready');
    await launch('production-wait');
    await until('document.querySelector("[data-running-id=production-wait]").dataset.phase === "waiting"', 'Inter-step wait is visible');
    await fs.access(path.join(directory, 'first.txt'));
    await click('[data-focus="cancel-production-wait"]');
    await until('!document.querySelector("[data-running-id=production-wait]") && Boolean(document.querySelector(".event-status.cancelled"))', 'Wait cancellation produces a distinct result');
    await assert.rejects(fs.access(path.join(directory, 'never.txt')));
    assert.equal((await nativeState()).events.find(item => item.bindingId === 'production-wait').status, 'cancelled');
    await launch('production-http');
    const httpDeadline = Date.now() + 2000;
    while (!httpStarted && Date.now() < httpDeadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(httpStarted, true);
    await click('[data-focus="cancel-production-http"]');
    await until('!document.querySelector("[data-running-id=production-http]")', 'In-flight HTTP cancellation completes');
    assert.equal((await nativeState()).events.find(item => item.bindingId === 'production-http').status, 'cancelled');
    await launch('production-all-a'); await launch('production-all-b');
    assert.equal((await nativeState()).running.length, 2);
    await evaluate('document.activeElement.blur();await window.keyboardTracker.setEnabled(true);');
    for (const theme of ['light', 'dark']) {
      await evaluate('window.keyboardAppearance.set(' + JSON.stringify(theme) + ');');
      await nativeEvaluate(electron + '.BrowserWindow.getAllWindows()[0].setSize(760,580)');
      await evaluate('await Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})));');
      await shot('production-running-' + theme);
    }
    await click('[data-focus="cancel-all"]');
    await until('!document.querySelector("[data-running-id]")', 'Stop all clears pending executions');
    assert.equal((await nativeState()).enabled, false);
    await click('[data-focus="filter-cancelled"]');
    assert.ok(await evaluate('return document.querySelectorAll(".event-status.cancelled").length >= 4'));
    assert.equal(await evaluate('return [...document.querySelectorAll("#events .event-status-cell .event-status")].every(node=>node.classList.contains("cancelled"))'), true);
    const backupA = structuredClone(config); backupA.layers[0].name = 'PRIVATE_BACKUP_A';
    const backupB = structuredClone(config); backupB.layers[0].name = 'PRIVATE_BACKUP_B';
    await evaluate('await window.keyboardTracker.saveConfig(' + JSON.stringify(backupA) + ');await window.keyboardTracker.saveConfig(' + JSON.stringify(backupB) + ');');
    await click('[data-view="settings"]');
    assert.equal(await evaluate('return document.querySelector("[data-focus=restore-backup]").disabled'), false);
    assert.equal(await evaluate('return document.querySelector("#storage-protection").dataset.protection'), (await nativeState()).storage.protection);
    await nativeEvaluate('globalThis.__productionDialogs={message:' + electron + '.dialog.showMessageBox,save:' + electron + '.dialog.showSaveDialog};globalThis.__productionConfirm=1;globalThis.__productionSavePath=' + JSON.stringify(diagPath) + ';' + electron + '.dialog.showMessageBox=async()=>({response:globalThis.__productionConfirm});' + electron + '.dialog.showSaveDialog=async()=>({canceled:false,filePath:globalThis.__productionSavePath});');
    await click('[data-focus="restore-backup"]');
    await until('Boolean(document.querySelector("[data-focus=restore-backup]"))', 'Cancelled recovery returns to settings');
    assert.equal((await nativeState()).config.layers[0].name, 'PRIVATE_BACKUP_B');
    await nativeEvaluate('globalThis.__productionConfirm=0;');
    await click('[data-focus="restore-backup"]');
    await until('document.querySelector("#toast").textContent.includes("Backup restaurado")', 'Confirmed recovery completes');
    assert.equal((await nativeState()).config.layers[0].name, 'PRIVATE_BACKUP_A');
    assert.equal((await nativeState()).enabled, false);
    await fill('#field-layerShortcut', 'F10');
    await click('[data-focus="restore-backup"]');
    await until('document.querySelector("#confirm-dialog").open', 'Recovery guards unsaved settings');
    await click('#confirm-dialog [data-cancel]');
    assert.equal(await evaluate('return document.querySelector("#field-layerShortcut").value'), 'F10');
    await click('[data-focus="export-diagnostics"]');
    const diagnostic = await waitFile(diagPath);
    const diagnosticText = JSON.stringify(diagnostic);
    for (const value of ['PRIVATE_LAYER_CANARY', 'PRIVATE_ACTION_CANARY', 'PRIVATE_BACKUP_A', 'PRIVATE_BODY_CANARY', 'PRIVATE_LOG_CANARY', 'PRIVATE_URL_CANARY', directory]) assert.ok(!diagnosticText.includes(value), 'Diagnostics omit ' + value);
    assert.equal(await evaluate('return document.querySelector("#field-layerShortcut").value'), 'F10', 'Diagnostic export preserves settings drafts');
    await nativeEvaluate('globalThis.__productionSavePath=' + JSON.stringify(portablePath) + ';');
    await click('[data-focus="export-config"]');
    const portable = await waitFile(portablePath);
    assert.deepEqual(portable.layers[0].bindings.find(item => item.id === 'production-http').action.headers, {});
    for (const theme of ['light', 'dark']) {
      await evaluate('window.keyboardAppearance.set(' + JSON.stringify(theme) + ');document.querySelector("#storage-protection").scrollIntoView({block:"start"});window.scrollBy(0,-72);const dismiss=document.querySelector("#toast:not([hidden]) button");dismiss?.click();await Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})));');
      const bounds = await evaluate('return {width:innerWidth,scroll:document.documentElement.scrollWidth}');
      assert.ok(bounds.scroll <= bounds.width, 'Protection and recovery controls fit the viewport');
      await shot('production-storage-' + theme);
    }
    await click('[data-view="history"]');
    if (await evaluate('return document.querySelector("#confirm-dialog").open')) await click('#confirm-dialog .danger-solid');
    console.log('Production UI passed: real wait/HTTP cancellation, stop-all pauses, cancelled filtering, backup confirmation/recovery, settings draft guard, native diagnostic/portable exports, privacy and two themes.');
  } finally {
    await nativeEvaluate('if(globalThis.__productionDialogs){' + electron + '.dialog.showMessageBox=globalThis.__productionDialogs.message;' + electron + '.dialog.showSaveDialog=globalThis.__productionDialogs.save;delete globalThis.__productionDialogs;delete globalThis.__productionConfirm;delete globalThis.__productionSavePath;}' + electron + '.clipboard.writeText(' + JSON.stringify(clipboardBefore) + ');' + electron + '.BrowserWindow.getAllWindows()[0].setSize(1280,900);').catch(() => {});
    await evaluate('await window.keyboardTracker.cancelAllExecutions();await window.keyboardTracker.saveConfig(' + JSON.stringify(before.config) + ');await window.keyboardTracker.setLayer(' + JSON.stringify(before.activeLayerId) + ');').catch(() => {});
    server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve));
  }
};
