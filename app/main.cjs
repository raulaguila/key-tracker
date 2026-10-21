const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Notification, Menu, utilityProcess, systemPreferences, powerMonitor, safeStorage } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Storage, readConfigFile, exportConfigSafe } = require('./storage.cjs');
const { createConfigProtection } = require('./config-protection.cjs');
const { loadWithRecovery } = require('./recovery.cjs');
const { createDiagnostics } = require('./diagnostics.cjs');
const { Engine } = require('./engine.cjs');
const { drainServices, waitForShutdown } = require('./shutdown.cjs');
const { StateDelivery } = require('./state-delivery.cjs');
const { Tracker } = require('./tracking.cjs');
const { WaylandInput } = require('./wayland-input.cjs');
const { encodeConfig } = require('./config.cjs');
const { writeExport } = require('./safe-export.cjs');
const { ApplicationMonitor } = require('./application-monitor.cjs');
const { DesktopTray, trayHostAvailable } = require('./desktop-tray.cjs');
const { WindowLifecycle } = require('./window-lifecycle.cjs');
const { DesktopActions, chooseActionTarget, exportSessionHistory } = require('./desktop-actions.cjs');

if (!app.isPackaged && process.env.DOBRA_DATA_DIR) app.setPath('userData', path.resolve(process.env.DOBRA_DATA_DIR));
app.setName('Dobra');
if (process.platform === 'win32') app.setAppUserModelId('io.dobra.app');
if (process.platform === 'linux') app.setDesktopName('io.dobra.app.desktop');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  let window;
  let engine;
  let storage;
  let resolveStartup, rejectStartup;
  const startup = new Promise((resolve, reject) => { resolveStartup = resolve; rejectStartup = reject; });
  void startup.catch(() => {});
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
  const pendingOperations = new Set();
  const drainChannels = new Set(['save-config', 'import-config', 'restore-backup', 'export-config', 'export-history', 'export-diagnostics']);
  const serialConfig = operation => {
    if (servicesStopping) return Promise.reject(new Error('O aplicativo está encerrando.'));
    const result = configWrite.catch(() => {}).then(operation);
    configWrite = result;
    return result;
  };

  function handle(channel, callback) {
    ipcMain.handle(`dobra:${channel}`, async (event, ...args) => {
      if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !isAppURL(event.senderFrame.url)) throw new Error('Origem não autorizada.');
      if (servicesStopping) throw new Error('O aplicativo está encerrando.');
      const result = Promise.resolve(callback(...args));
      if (!drainChannels.has(channel)) return result;
      pendingOperations.add(result);
      try { return await result; } finally { pendingOperations.delete(result); }
    });
  }

  function send(channel, payload) {
    if (window && !window.isDestroyed()) window.webContents.send(`dobra:${channel}`, payload);
  }

  function statePayload(state, full = false) {
    if (full || sentConfigRevision !== state.configRevision) {
      sentConfigRevision = state.configRevision;
      return state;
    }
    const { config, ...update } = state;
    return update;
  }
  const visualState = new StateDelivery({ send: state => send('state', statePayload(state)), visible: () => Boolean(window && !window.isDestroyed() && window.isVisible() && !window.isMinimized()) });
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
      title: 'Dobra', backgroundColor: '#ffffff', show: false,
      icon: path.join(__dirname, 'assets', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (!isAppURL(url)) event.preventDefault(); });
    lifecycle = new WindowLifecycle({ window,
      shouldHide: () => engine?.config.settings.closeToTray ? tray?.revalidate() ?? false : false,
      requestConfirmation: payload => { if (engine) send('close-requested', payload); else { lifecycle.allowClose = true; window.close(); } },
      beforeHide: () => engine?.setEditing(false), quit: () => app.quit() });
    window.webContents.on('render-process-gone', () => { engine?.dispose(); tracker?.set(false); lifecycle.forceQuit(); });
    window.webContents.on('did-start-loading', () => { sentConfigRevision = null; engine?.setEnabled(false); engine?.setEditing(false); });
    window.once('ready-to-show', () => { if (!window?.isDestroyed()) window?.show(); });
    window.on('show', () => visualState.flush());
    window.on('restore', () => visualState.flush());
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
    rejectStartup(new Error('Inicialização cancelada.'));
    visualState.dispose();
    const draining = drainServices({ engine, tracker, desktopActions, tray, monitor, storage, configuration: Promise.allSettled([configWrite, ...pendingOperations]) });
    void (async () => {
      while (!await waitForShutdown(draining)) {
        const answer = await dialog.showMessageBox({ type: 'warning', title: 'Encerramento em andamento',
          message: 'Ainda há operações sendo finalizadas.',
          detail: 'A última configuração concluída permanece preservada. Sair agora pode impedir a conclusão de gravações e do histórico pendentes.',
          buttons: ['Continuar aguardando', 'Sair mesmo assim'], defaultId: 0, cancelId: 0, noLink: true });
        if (answer.response === 1) break;
      }
      servicesStopped = true;
      setImmediate(() => app.quit());
    })();
  });
  app.on('window-all-closed', () => app.quit());

  app.whenReady().then(async () => {
    app.setAboutPanelOptions({ applicationName: 'Dobra', applicationVersion: app.getVersion(), iconPath: path.join(__dirname, 'assets', 'icon.png') });
    handle('get-state', async () => { await startup; return statePayload(engine.state(), true); });
    createWindow();
    const protection = await createConfigProtection({ safeStorage, platform: process.platform });
    if (servicesStopping) return;
    storage = new Storage(app.getPath('userData'), { protection });
    const config = await loadWithRecovery({ storage, dialog, loadOptions: { deferBackup: true }, isCancelled: () => servicesStopping });
    if (servicesStopping) return;
    if (!config) { app.quit(); return; }
    desktopActions = new DesktopActions({ clipboard, shell, Notification });
    engine = new Engine({ config, storage, documents: app.getPath('documents'), session, desktopActions });
    tracker = new Tracker({ engine, fork: (...args) => utilityProcess.fork(...args), accessibility: () => systemPreferences.isTrustedAccessibilityClient(true),
      wayland: process.platform === 'linux' && session === 'wayland' ? new WaylandInput() : undefined });
    const suspendActions = () => {
      const wasEnabled = engine.enabled;
      tracker.suspend();
      if (wasEnabled) {
        engine.record('info', 'Atalhos pausados ao bloquear ou suspender o sistema. Ative novamente quando estiver pronto.');
        engine.publish();
      }
    };
    powerMonitor.on('suspend', suspendActions);
    powerMonitor.on('lock-screen', suspendActions);
    powerMonitor.on('resume', () => engine.resetInput());
    powerMonitor.on('unlock-screen', () => engine.resetInput());
    engine.on('state', state => visualState.push(state));
    // A fresh tracking snapshot must reach the renderer before its key stream,
    // including the initial held-key snapshot from the Wayland service.
    engine.on('key', key => { visualState.flush(); send('key', key); });

    handle('save-config', stateResult(config => serialConfig(() => engine.saveConfig(config))));
    handle('set-enabled', stateResult(enabled => engine.setEnabled(enabled)));
    handle('set-layer', stateResult(id => engine.setLayer(id)));
    handle('set-editing', stateResult(editing => engine.setEditing(editing)));
    handle('preview-binding', (layerId, bindingId) => engine.previewBinding(layerId, bindingId));
    handle('run-binding', stateResult((layerId, bindingId, previewId) => engine.runBinding(layerId, bindingId, previewId)));
    handle('cancel-execution', stateResult(bindingId => engine.cancelExecution(bindingId)));
    handle('cancel-all-executions', stateResult(() => engine.requestStop()));
    handle('show-window', showWindow);
    handle('confirm-close', () => lifecycle?.confirm());
    handle('cancel-close', () => lifecycle?.cancel());
    handle('set-tracking', stateResult(enabled => tracker.set(enabled)));
    handle('set-linux-input-enabled', stateResult(enabled => tracker.setLinuxEnabled(enabled)));
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
    handle('export-history', async () => exportSessionHistory({ events: engine.events, dialog, window, protectedPaths: await storage.protectedPaths() }));
    handle('export-diagnostics', async () => {
      const result = await dialog.showSaveDialog(window, { title: 'Exportar diagnóstico', defaultPath: 'dobra-diagnostics.json', filters: [{ name: 'Diagnóstico JSON', extensions: ['json'] }] });
      if (result.canceled || !result.filePath) return;
      const diagnostic = createDiagnostics({ state: engine.state(), versions: { ...process.versions, app: app.getVersion() }, platform: process.platform, arch: process.arch });
      await writeExport(result.filePath, JSON.stringify(diagnostic, null, 2) + '\n', await storage.protectedPaths());
    });
    handle('restore-backup', stateResult(async () => {
      const result = await dialog.showMessageBox(window, { type: 'question', title: 'Restaurar backup', message: 'Restaurar a configuração anterior?', detail: 'As ações serão pausadas e as execuções em andamento serão canceladas. A configuração atual válida será preservada no backup.', buttons: ['Restaurar backup', 'Cancelar'], defaultId: 1, cancelId: 1, noLink: true });
      if (result.response !== 0) return engine.state();
      return serialConfig(async () => {
        engine.cancelAllExecutions();
        const backup = await storage.readBackup();
        if (!backup) throw new Error('Nenhum backup válido disponível.');
        return engine.saveConfig(backup);
      });
    }));
    handle('open-data-directory', async () => {
      const error = await shell.openPath(storage.directory);
      if (error) throw new Error('Não foi possível abrir a pasta de dados.');
    });
    handle('export-config', stateResult(async () => {
      const result = await dialog.showSaveDialog(window, { title: 'Exportar configuração', defaultPath: 'dobra.json', filters: [{ name: 'Configuração JSON', extensions: ['json'] }] });
      if (!result.canceled && result.filePath) {
        await writeExport(result.filePath, encodeConfig(exportConfigSafe(engine.config)), await storage.protectedPaths());
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
      ...(process.platform === 'darwin' ? [{ label: 'Dobra', submenu: [{ role: 'about', label: 'Sobre Dobra' }, { type: 'separator' }, { role: 'quit', label: 'Sair de Dobra' }] }] : []),
      { label: 'Editar', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'Aplicativo', submenu: [{ label: 'Pausar atalhos', click: () => engine.setEnabled(false) }, { label: 'Parar execuções e pausar', click: () => engine.requestStop() }, { label: 'Desligar rastreio', click: () => tracker.set(false) }, { type: 'separator' }, { label: 'Sair', click: requestQuit }] }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    resolveStartup();
    setImmediate(() => {
      if (servicesStopping) return;
      void storage.refreshBackup().then(() => { if (!servicesStopping) engine.publish(); });
    });
    const { Tray, nativeImage } = require('electron');
    const hostAvailable = await trayHostAvailable();
    if (servicesStopping) return;
    tray = new DesktopTray({ Tray, Menu, nativeImage, engine, tracker, showWindow, quit: requestQuit, platform: process.platform, hostAvailable });
    engine.desktop = { trayAvailable: tray.available };
    monitor = new ApplicationMonitor({ engine, platform: process.platform, session });
    monitor.configure();
    engine.publish();
  }).catch(error => {
    rejectStartup(error);
    if (servicesStopping) return;
    dialog.showErrorBox('Não foi possível iniciar o Dobra', error.message);
    app.quit();
  });
}
