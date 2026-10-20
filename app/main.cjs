const { app, BrowserWindow, ipcMain, globalShortcut, dialog, shell, Menu, utilityProcess, systemPreferences } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { Storage } = require('./storage.cjs');
const { Engine } = require('./engine.cjs');
const { Tracker } = require('./tracking.cjs');
const { MAX_CONFIG_BYTES } = require('./config.cjs');

if (!app.isPackaged && process.env.KEYBOARD_TRACKER_DATA_DIR) app.setPath('userData', path.resolve(process.env.KEYBOARD_TRACKER_DATA_DIR));
app.setName('Keyboard Tracker');
if (process.platform === 'linux') app.setDesktopName('io.keyboardtracker.app.desktop');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  let window;
  let engine;
  let tracker;
  const entry = path.join(__dirname, 'renderer', 'index.html');
  const entryURL = pathToFileURL(entry).href;
  function isAppURL(value) {
    try { const url = new URL(value); url.hash = ''; return url.href === entryURL; }
    catch { return false; }
  }
  const session = process.platform === 'linux' ? (process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11') : 'native';
  let configWrite = Promise.resolve();
  const serialConfig = operation => {
    const result = configWrite.catch(() => {}).then(operation);
    configWrite = result;
    return result;
  };

  function handle(channel, callback) {
    ipcMain.handle(`tracker:${channel}`, async (event, ...args) => {
      if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !isAppURL(event.senderFrame.url)) throw new Error('Origem não autorizada.');
      return callback(...args);
    });
  }

  function send(channel, payload) {
    if (window && !window.isDestroyed()) window.webContents.send(`tracker:${channel}`, payload);
  }

  function createWindow() {
    window = new BrowserWindow({
      width: 1280, height: 860, minWidth: 760, minHeight: 580,
      title: 'Keyboard Tracker', backgroundColor: '#ffffff', show: false,
      icon: path.join(__dirname, 'assets', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (!isAppURL(url)) event.preventDefault(); });
    window.webContents.on('render-process-gone', () => { engine.dispose(); tracker.set(false); });
    window.webContents.on('did-start-loading', () => { engine.setEnabled(false); engine.setEditing(false); });
    window.once('ready-to-show', () => window.show());
    window.on('closed', () => {
      window = null;
      // Closing the only window stops all hooks, including on macOS.
      app.quit();
    });
    void window.loadFile(entry);
  }

  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('will-quit', () => { tracker?.stop(); engine?.dispose(); });
  app.on('window-all-closed', () => app.quit());

  app.whenReady().then(async () => {
    const storage = new Storage(app.getPath('userData'));
    const config = await storage.load();
    engine = new Engine({ config, shortcuts: globalShortcut, storage, documents: app.getPath('documents'), session });
    tracker = new Tracker({ engine, fork: (...args) => utilityProcess.fork(...args), accessibility: () => systemPreferences.isTrustedAccessibilityClient(true) });
    engine.on('state', state => send('state', state));
    engine.on('key', key => send('key', key));

    handle('get-state', () => engine.state());
    handle('save-config', config => serialConfig(() => engine.saveConfig(config)));
    handle('set-enabled', enabled => engine.setEnabled(enabled));
    handle('set-layer', id => engine.setLayer(id));
    handle('set-editing', editing => engine.setEditing(editing));
    handle('run-binding', (layerId, bindingId) => engine.runBinding(layerId, bindingId));
    handle('set-tracking', enabled => tracker.set(enabled));
    handle('choose-directory', async () => {
      const result = await dialog.showOpenDialog(window, { title: 'Escolher pasta para os arquivos', properties: ['openDirectory', 'createDirectory'] });
      return result.canceled ? null : result.filePaths[0];
    });
    handle('open-data-directory', async () => {
      const error = await shell.openPath(storage.directory);
      if (error) throw new Error('Não foi possível abrir a pasta de dados.');
    });
    handle('export-config', async () => {
      const result = await dialog.showSaveDialog(window, { title: 'Exportar configuração', defaultPath: 'keyboard-tracker.json', filters: [{ name: 'Configuração JSON', extensions: ['json'] }] });
      if (!result.canceled && result.filePath) {
        if (path.resolve(result.filePath) === path.resolve(storage.configPath)) throw new Error('Escolha um destino diferente da configuração interna.');
        await fs.writeFile(result.filePath, JSON.stringify(engine.config, null, 2) + '\n', { mode: 0o600 });
      }
      return engine.state();
    });
    handle('import-config', async () => {
      const result = await dialog.showOpenDialog(window, { title: 'Importar configuração', properties: ['openFile'], filters: [{ name: 'Configuração JSON', extensions: ['json'] }] });
      if (result.canceled) return engine.state();
      const file = result.filePaths[0];
      if ((await fs.stat(file)).size > MAX_CONFIG_BYTES) throw new Error('Configuração deve ter até 256 KB.');
      let config;
      try { config = JSON.parse(await fs.readFile(file, 'utf8')); } catch { throw new Error('O arquivo não contém um JSON válido.'); }
      return serialConfig(async () => {
        engine.setEnabled(false);
        return engine.saveConfig(config);
      });
    });
    const template = [
      ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
      { label: 'Editar', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'Aplicativo', submenu: [{ label: 'Pausar atalhos', click: () => engine.setEnabled(false) }, { label: 'Desligar rastreio', click: () => tracker.set(false) }, { type: 'separator' }, { role: 'quit', label: 'Sair' }] }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    createWindow();
  }).catch(error => {
    dialog.showErrorBox('Não foi possível iniciar o Keyboard Tracker', error.message);
    app.quit();
  });
}
