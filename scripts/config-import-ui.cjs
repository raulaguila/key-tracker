// Real import IPC and Engine; controlled native effect/log completion proves ordering.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function configImportUI({ evaluate, until, nativeState, nativeEvaluate, data }) {
  const before = await nativeState();
  const directory = path.join(data, 'config-import');
  await fs.mkdir(directory, { recursive: true });
  const destination = { ...structuredClone(before.config), layers: [{ id: 'import-destination', name: 'Importada', bindings: [] }] };
  const importPath = path.join(directory, 'import.json');
  const persistedLayer = async () => JSON.parse(await fs.readFile(path.join(before.paths.data, 'config.json'), 'utf8')).layers[0].id;
  await fs.writeFile(importPath, JSON.stringify(destination));
  const effectPath = path.join(directory, 'never.txt');
  const source = { ...structuredClone(before.config), layers: [{ id: 'import-source', name: 'Anterior', bindings: [{
    id: 'import-sequence', key: 'Control+Alt+A', name: 'Execução anterior', action: { type: 'sequence', steps: [
      { type: 'clipboard', text: 'import-first' },
      { type: 'file', directory, filename: 'never.txt', mode: 'create', content: 'Não executar após importar' }
    ] }
  }] }] };
  try {
    await nativeEvaluate(`
      globalThis.__importReview = {
        dialog: process.mainModule.require('electron').dialog,
        desktop: process.mainModule.require(${JSON.stringify(path.resolve(__dirname, '../app/desktop-actions.cjs'))}).DesktopActions.prototype,
        storage: process.mainModule.require(${JSON.stringify(path.resolve(__dirname, '../app/storage.cjs'))}).Storage.prototype
      };
      const probe = globalThis.__importReview;
      probe.open = probe.dialog.showOpenDialog; probe.clipboard = probe.desktop.clipboard;
      probe.appendLog = probe.storage.appendLog; probe.save = probe.storage.save;
      probe.dialog.showOpenDialog = async () => ({canceled: Boolean(probe.cancelPicker), filePaths: [${JSON.stringify(importPath)}]});
      probe.desktop.clipboard = function(text) { return text === 'import-first' ? new Promise(resolve => { probe.releaseEffect = resolve; }) : probe.clipboard.call(this, text); };
      probe.storage.appendLog = async function(event) {
        if (event.bindingId === 'import-sequence') await new Promise(resolve => { probe.releaseLog = resolve; probe.onLogStarted(); });
        return probe.appendLog.call(this, event);
      };
      probe.storage.save = function(config) {
        if (probe.failSave && config.layers[0].id === 'import-destination') throw new Error('import-disk-fixture');
        return probe.save.call(this, config);
      };
    `);
    for (const failSave of [false, true]) {
      await evaluate('await window.dobra.saveConfig(' + JSON.stringify(source) + ');');
      const original = (await nativeState()).config;
      await nativeEvaluate('Object.assign(globalThis.__importReview, {failSave:' + failSave + ', releaseEffect:null, releaseLog:null});globalThis.__importReview.logStarted=new Promise(resolve=>{globalThis.__importReview.onLogStarted=resolve;});void 0;');
      await evaluate('window.__importRun = window.dobra.runBinding("import-source", "import-sequence");');
      assert.equal(await nativeEvaluate('typeof globalThis.__importReview.releaseEffect'), 'function');
      await evaluate('window.__importStatus="pending";window.__importResult=window.dobra.importConfig().then(state=>{window.__importStatus="done";return state;},error=>{window.__importStatus=error.message;});');
      await until('(await window.dobra.getState()).stopping', 'Import blocks activation while cancelling');
      assert.deepEqual((await nativeState()).config, original, 'Do not replace while native effect is pending');
      assert.equal(await persistedLayer(), 'import-source', 'Do not persist replacement before native effect finishes');
      assert.match(await evaluate('try { await window.dobra.setEnabled(true); return "enabled"; } catch(error) { return error.message; }'), /Aguarde/);
      assert.match(await evaluate('try { await window.dobra.runBinding("import-source","import-sequence"); return "started"; } catch(error) { return error.message; }'), /Aguarde/);
      await nativeEvaluate('globalThis.__importReview.releaseEffect();');
      await nativeEvaluate('globalThis.__importReview.logStarted');
      assert.equal(await nativeEvaluate('typeof globalThis.__importReview.releaseLog'), 'function');
      assert.equal(await evaluate('return window.__importStatus'), 'pending');
      assert.deepEqual((await nativeState()).config, original, 'Do not replace while final history is pending');
      assert.equal(await persistedLayer(), 'import-source', 'Do not persist replacement before final history finishes');
      await nativeEvaluate('globalThis.__importReview.releaseLog();');
      await evaluate('await window.__importResult;await window.__importRun;');
      const state = await nativeState();
      assert.equal(state.enabled, false); assert.equal(state.stopping, false); assert.equal(state.running.length, 0);
      assert.equal(state.events.find(event => event.bindingId === 'import-sequence').status, 'cancelled');
      await assert.rejects(fs.access(effectPath), { code: 'ENOENT' });
      if (failSave) {
        assert.match(await evaluate('return window.__importStatus'), /import-disk-fixture/);
        assert.deepEqual(state.config, original, 'Persistence failure preserves previous configuration');
        assert.equal(await persistedLayer(), 'import-source');
      } else {
        assert.equal(state.config.layers[0].id, 'import-destination');
        assert.equal(await persistedLayer(), 'import-destination');
      }
    }
    await nativeEvaluate('globalThis.__importReview.cancelPicker=true;');
    const original = (await nativeState()).config;
    await evaluate('await window.dobra.importConfig();');
    assert.deepEqual((await nativeState()).config, original, 'Picker cancellation preserves configuration');
    console.log('Config import UI passed: cancellation waits for native effects and final logs, blocks activation/manual tests, skips later steps, persists replacement, preserves configuration on disk failure and handles picker cancellation.');
  } finally {
    await nativeEvaluate(`if(globalThis.__importReview){const probe=globalThis.__importReview;probe.releaseEffect?.();probe.releaseLog?.();probe.dialog.showOpenDialog=probe.open;probe.desktop.clipboard=probe.clipboard;probe.storage.appendLog=probe.appendLog;probe.storage.save=probe.save;delete globalThis.__importReview;}`).catch(() => {});
    await evaluate('await window.__importResult;await window.__importRun;await window.dobra.saveConfig(' + JSON.stringify(before.config) + ');await window.dobra.setLayer(' + JSON.stringify(before.activeLayerId) + ');').catch(() => {});
  }
};
