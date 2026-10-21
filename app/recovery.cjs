const { readConfigFile } = require('./storage.cjs');

// Called before the renderer exists. No reset-to-default path can erase data.
async function loadWithRecovery({ storage, dialog }) {
  let problem;
  try { return await storage.load(); } catch (error) { problem = error; }
  for (;;) {
    let backup;
    try { backup = await storage.readBackup(); } catch { /* Keep import available. */ }
    const buttons = backup ? ['Restaurar último backup', 'Importar configuração', 'Sair'] : ['Importar configuração', 'Sair'];
    const { response } = await dialog.showMessageBox({
      type: 'error', title: 'Recuperar configuração', message: 'Não foi possível abrir sua configuração.',
      detail: 'O arquivo original será preservado. Você pode restaurar um backup válido ou importar uma configuração portátil.\n\n' + problem.message,
      buttons, defaultId: buttons.length - 1, cancelId: buttons.length - 1, noLink: true
    });
    if (response === buttons.length - 1 || response < 0 || response >= buttons.length) return null;
    try {
      if (backup && response === 0) return await storage.restoreBackup();
      const selected = await dialog.showOpenDialog({ title: 'Importar configuração para recuperação', properties: ['openFile'], filters: [{ name: 'Configuração JSON', extensions: ['json'] }] });
      if (!selected.canceled && selected.filePaths[0]) return await storage.recover(await readConfigFile(selected.filePaths[0]));
    } catch (error) { problem = error; }
  }
}
module.exports = { loadWithRecovery };
