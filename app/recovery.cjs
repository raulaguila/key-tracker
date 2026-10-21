const { readConfigFile } = require('./storage.cjs');

// Called while the loading shell is visible. No reset-to-default path can erase data.
async function loadWithRecovery({ storage, dialog, loadOptions, isCancelled = () => false }) {
  let problem;
  try { return await storage.load(loadOptions); } catch (error) { problem = error; }
  for (;;) {
    if (isCancelled()) return null;
    let backup;
    try { backup = await storage.readBackup(); } catch { /* Keep import available. */ }
    if (isCancelled()) return null;
    const buttons = backup ? ['Restaurar último backup', 'Importar configuração', 'Sair'] : ['Importar configuração', 'Sair'];
    const { response } = await dialog.showMessageBox({
      type: 'error', title: 'Recuperar configuração', message: 'Não foi possível abrir sua configuração.',
      detail: 'O arquivo original será preservado. Você pode restaurar um backup válido ou importar uma configuração portátil.\n\n' + problem.message,
      buttons, defaultId: buttons.length - 1, cancelId: buttons.length - 1, noLink: true
    });
    if (isCancelled()) return null;
    if (response === buttons.length - 1 || response < 0 || response >= buttons.length) return null;
    try {
      if (backup && response === 0) return await storage.restoreBackup();
      const selected = await dialog.showOpenDialog({ title: 'Importar configuração para recuperação', properties: ['openFile'], filters: [{ name: 'Configuração JSON', extensions: ['json'] }] });
      if (!selected.canceled && selected.filePaths[0]) return await storage.recover(await readConfigFile(selected.filePaths[0]));
    } catch (error) { problem = error; }
  }
}
module.exports = { loadWithRecovery };
