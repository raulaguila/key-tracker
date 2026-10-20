const { app, BrowserWindow, ipcMain, globalShortcut, dialog, shell, clipboard, Notification, Menu, utilityProcess, systemPreferences, powerMonitor } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Storage, readConfigFile } = require('./storage.cjs');
const { Engine } = require('./engine.cjs');
const { Tracker } = require('./tracking.cjs');
const { encodeConfig } = require('./config.cjs');
const { writeExport } = require('./safe-export.cjs');
const { ApplicationMonitor } = require('./application-monitor.cjs');
const { DesktopTray, trayHostAvailable } = require('./desktop-tray.cjs');
const { WindowLifecycle } = require('./window-lifecycle.cjs');
const { DesktopActions, chooseActionTarget, exportSessionHistory } = require('./desktop-actions.cjs');

if (!app.isPackaged && process.env.KEYBOARD_TRACKER_DATA_DIR) app.setPath('userData', path.resolve(process.env.KEYBOARD_TRACKER_DATA_DIR));
app.setName('Keyboard Tracker');
if (process.platform === 'win32') app.setAppUserModelId('io.keyboardtracker.app');
if (process.platform === 'linux') app.setDesktopName('io.keyboardtracker.app.desktop');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  let window;
  let engine;
  let tracker;
  let monitor;
  let tray;
  let lifecycle;
  let desktopActions;
  let servicesStopping = false;
  let servicesStopped = false;
  let sentConfigRevision = null;
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

  function statePayload(state, full = false) {
    if (full || sentConfigRevision !== state.configRevision) {
      sentConfigRevision = state.configRevision;
      return state;
    }
    const { config, ...update } = state;
    return update;
  }
  const stateResult = operation => async (...args) => statePayload(await operation(...args));

  function showWindow() {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  }

  function requestQuit() { if (lifecycle) lifecycle.request(true); else app.quit(); }

  function createWindow() {
    window = new BrowserWindow({
      width: 1280, height: 860, minWidth: 760, minHeight: 580,
      title: 'Keyboard Tracker', backgroundColor: '#ffffff', show: false,
      icon: path.join(__dirname, 'assets', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (!isAppURL(url)) event.preventDefault(); });
    lifecycle = new WindowLifecycle({ window,
      shouldHide: () => engine.config.settings.closeToTray ? tray?.revalidate() ?? false : false,
      requestConfirmation: payload => send('close-requested', payload),
      beforeHide: () => engine.setEditing(false), quit: () => app.quit() });
    window.webContents.on('render-process-gone', () => { engine.dispose(); tracker.set(false); lifecycle.forceQuit(); });
    window.webContents.on('did-start-loading', () => { sentConfigRevision = null; engine.setEnabled(false); engine.setEditing(false); });
    window.once('ready-to-show', () => window.show());
    window.on('closed', () => {
      window = null;
      // Closing the only window stops all hooks, including on macOS.
      app.quit();
    });
    void window.loadFile(entry);
  }

  app.on('second-instance', showWindow);
  app.on('before-quit', event => {
    if (window && lifecycle && !lifecycle.allowClose) { event.preventDefault(); lifecycle.request(true); }
  });
  app.on('will-quit', event => {
    if (servicesStopped) return;
    event.preventDefault();
    if (servicesStopping) return;
    servicesStopping = true;
    tray?.dispose(); tracker?.stop(); desktopActions?.dispose(); engine?.dispose();
    // The reader owns native helper processes; let it reap them before Electron
    // terminates the worker thread during shutdown.
    Promise.resolve(monitor?.dispose()).catch(() => {}).finally(() => {
      servicesStopped = true;
      // A resolved cleanup can finish before Electron resets its cancelled quit
      // cycle. Resume on the next turn rather than inside that event's microtask.
      setImmediate(() => app.quit());
    });
  });
  app.on('window-all-closed', () => app.quit());

  app.whenReady().then(async () => {
    const storage = new Storage(app.getPath('userData'));
    const config = await storage.load();
    desktopActions = new DesktopActions({ clipboard, shell, Notification });
    engine = new Engine({ config, shortcuts: globalShortcut, storage, documents: app.getPath('documents'), session, desktopActions });
    tracker = new Tracker({ engine, fork: (...args) => utilityProcess.fork(...args), accessibility: () => systemPreferences.isTrustedAccessibilityClient(true) });
    const suspendActions = () => {
      engine.resetInput();
      if (engine.enabled) {
        engine.setEnabled(false);
        engine.record('info', 'Atalhos pausados ao bloquear ou suspender o sistema. Ative novamente quando estiver pronto.');
        engine.publish();
      }
    };
    powerMonitor.on('suspend', suspendActions);
    powerMonitor.on('lock-screen', suspendActions);
    powerMonitor.on('resume', () => engine.resetInput());
    powerMonitor.on('unlock-screen', () => engine.resetInput());
    engine.on('state', state => send('state', statePayload(state)));
    engine.on('key', key => send('key', key));

    handle('get-state', () => statePayload(engine.state(), true));
    handle('save-config', stateResult(config => serialConfig(() => engine.saveConfig(config))));
    handle('set-enabled', stateResult(enabled => engine.setEnabled(enabled)));
    handle('set-layer', stateResult(id => engine.setLayer(id)));
    handle('set-editing', stateResult(editing => engine.setEditing(editing)));
    handle('preview-binding', (layerId, bindingId) => engine.previewBinding(layerId, bindingId));
    handle('run-binding', stateResult((layerId, bindingId, previewId) => engine.runBinding(layerId, bindingId, previewId)));
    handle('show-window', showWindow);
    handle('confirm-close', () => lifecycle?.confirm());
    handle('cancel-close', () => lifecycle?.cancel());
    handle('set-tracking', stateResult(enabled => tracker.set(enabled)));
    handle('choose-directory', async () => {
      const result = await dialog.showOpenDialog(window, { title: 'Escolher pasta para os arquivos', properties: ['openDirectory', 'createDirectory'] });
      return result.canceled ? null : result.filePaths[0];
    });
    handle('choose-application', async () => {
      const result = await dialog.showOpenDialog(window, {
        title: 'Escolher aplicativo para esta camada',
        properties: ['openFile'],
        ...(process.platform === 'win32' ? { filters: [{ name: 'Aplicativos', extensions: ['exe'] }] } : {})
      });
      return result.canceled ? null : result.filePaths[0];
    });
    handle('choose-action-target', kind => chooseActionTarget({ kind, dialog, window }));
    handle('export-history', () => exportSessionHistory({ events: engine.events, dialog, window, protectedPaths: [storage.configPath, storage.logPath, storage.logPath + '.1'] }));
    handle('open-data-directory', async () => {
      const error = await shell.openPath(storage.directory);
      if (error) throw new Error('Não foi possível abrir a pasta de dados.');
    });
    handle('export-config', stateResult(async () => {
      const result = await dialog.showSaveDialog(window, { title: 'Exportar configuração', defaultPath: 'keyboard-tracker.json', filters: [{ name: 'Configuração JSON', extensions: ['json'] }] });
      if (!result.canceled && result.filePath) {
        await writeExport(result.filePath, encodeConfig(engine.config), [storage.configPath, storage.logPath, storage.logPath + '.1']);
      }
      return engine.state();
    }));
    handle('import-config', stateResult(async () => {
      const result = await dialog.showOpenDialog(window, { title: 'Importar configuração', properties: ['openFile'], filters: [{ name: 'Configuração JSON', extensions: ['json'] }] });
      if (result.canceled) return engine.state();
      const file = result.filePaths[0];
      const config = await readConfigFile(file);
      return serialConfig(async () => {
        engine.setEnabled(false);
        return engine.saveConfig(config);
      });
    }));
    const template = [
      ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
      { label: 'Editar', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'Aplicativo', submenu: [{ label: 'Pausar atalhos', click: () => engine.setEnabled(false) }, { label: 'Desligar rastreio', click: () => tracker.set(false) }, { type: 'separator' }, { label: 'Sair', click: requestQuit }] }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    createWindow();
    const { Tray, nativeImage } = require('electron');
    const hostAvailable = await trayHostAvailable();
    tray = new DesktopTray({ Tray, Menu, nativeImage, engine, tracker, showWindow, quit: requestQuit, platform: process.platform, hostAvailable });
    engine.desktop = { trayAvailable: tray.available };
    monitor = new ApplicationMonitor({ engine, platform: process.platform, session });
    monitor.configure();
    engine.publish();
  }).catch(error => {
    dialog.showErrorBox('Não foi possível iniciar o Keyboard Tracker', error.message);
    app.quit();
  });
}
