const path = require('node:path');
const { pathToFileURL } = require('node:url');

function panelState(engine, theme = 'light') {
  const layer = engine.activeLayer;
  return { platform: engine.platform, layer: { name: layer?.name || 'Sem camada', description: '' }, enabled: Boolean(engine.enabled), editing: Boolean(engine.editing), stopping: Boolean(engine.stopping),
    input: { mode: engine.input?.mode || 'off', message: engine.input?.message || '' }, theme,
    bindings: (layer?.bindings || []).map(({ id, name, key, trigger, enabled }) => ({ id, name, key, trigger: trigger || 'press', enabled: enabled !== false })) };
}

class QuickPanel {
  constructor({ BrowserWindow, ipcMain, nativeTheme, engine, showMain }) {
    Object.assign(this, { BrowserWindow, ipcMain, nativeTheme, engine, showMain });
    this.theme = 'system'; this.window = null; this.disposed = false; this.visibleRequested = false; this.ready = false;
    this.file = path.join(__dirname, 'renderer', 'quick-panel.html');
    this.url = pathToFileURL(this.file).href;
    this.channels = ['get-state', 'hide', 'show-main'];
    const operations = [() => this.state(), () => this.hide(), () => { this.hide(); this.showMain(); }];
    for (let index = 0; index < this.channels.length; index++) ipcMain.handle('dobra-panel:' + this.channels[index], (event) => {
      let url;
      try { url = new URL(event.senderFrame?.url); url.hash = ''; } catch { throw new Error('Origem não autorizada.'); }
      if (this.disposed || event.sender !== this.window?.webContents || event.senderFrame !== this.window.webContents.mainFrame || url.href !== this.url) throw new Error('Origem não autorizada.');
      return operations[index]();
    });
    this.onState = () => this.publish();
    this.onShortcut = () => this.show();
    engine.on('state', this.onState); engine.on('quick-panel', this.onShortcut);
    nativeTheme.on('updated', this.onState);
  }
  state() {
    const theme = this.theme === 'system' ? this.nativeTheme.shouldUseDarkColors ? 'dark' : 'light' : this.theme;
    const key = [this.engine.configRevision, this.engine.activeLayer, this.engine.enabled, this.engine.editing, this.engine.stopping, this.engine.input?.mode, this.engine.input?.message, theme];
    if (!this.projectionKey || key.some((value, index) => value !== this.projectionKey[index])) {
      this.projectionKey = key;
      const projected = panelState(this.engine, theme);
      const content = JSON.stringify(projected);
      if (content !== this.projectionContent) {
        this.projectionContent = content;
        this.projectionRevision = (this.projectionRevision || 0) + 1;
        this.projection = { ...projected, revision: this.projectionRevision };
        this.serializedProjection = JSON.stringify(this.projection);
      }
    }
    return this.projection;
  }
  setTheme(theme) {
    if (!['light', 'dark', 'system'].includes(theme)) throw new Error('Tema inválido.');
    this.theme = theme; this.publish();
  }
  publish() {
    if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) return;
    const state = this.state();
    if (this.lastSent === this.serializedProjection) return;
    this.lastSent = this.serializedProjection;
    this.window.webContents.send('dobra-panel:state', state);
  }
  show() {
    if (this.disposed) return;
    this.visibleRequested = true;
    if (!this.window || this.window.isDestroyed()) {
      const window = new this.BrowserWindow({ width: 380, height: 500, minWidth: 300, minHeight: 240, show: false, title: 'Painel rápido · Dobra',
        autoHideMenuBar: true, resizable: true, minimizable: false, maximizable: false, fullscreenable: false,
        webPreferences: { preload: path.join(__dirname, 'quick-panel-preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
      this.window = window; this.ready = false; this.lastSent = null; window.setMenu?.(null);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => { if (url !== this.url) event.preventDefault(); });
      window.webContents.on('before-input-event', (event, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); this.hide(); } });
      window.webContents.on('render-process-gone', () => window.destroy());
      window.on('close', event => { if (!this.disposed) { event.preventDefault(); this.hide(); } });
      window.on('closed', () => { if (this.window === window) this.window = null; });
      window.once('ready-to-show', () => {
        if (this.disposed || this.window !== window) return;
        this.ready = true;
        if (this.visibleRequested) { window.show(); window.focus(); this.publish(); }
      });
      void window.loadFile(this.file).catch(() => { if (this.window === window && !window.isDestroyed()) window.destroy(); });
    } else if (this.ready) { this.window.show(); this.window.focus(); this.publish(); }
  }
  hide() { this.visibleRequested = false; if (this.window && !this.window.isDestroyed()) this.window.hide(); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.engine.off('state', this.onState); this.engine.off('quick-panel', this.onShortcut); this.nativeTheme.off('updated', this.onState);
    for (const channel of this.channels) this.ipcMain.removeHandler('dobra-panel:' + channel);
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }
}
module.exports = { QuickPanel, panelState };
