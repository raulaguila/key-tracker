const { deflateSync } = require('node:zlib');
const { execFile } = require('node:child_process');

async function trayHostAvailable({ platform = process.platform, execFileImpl = execFile, signal } = {}) {
  if (platform !== 'linux') return true;
  return new Promise(resolve => {
    try {
      execFileImpl('dbus-send', ['--session', '--dest=org.freedesktop.DBus', '--type=method_call', '--print-reply', '/org/freedesktop/DBus', 'org.freedesktop.DBus.NameHasOwner', 'string:org.kde.StatusNotifierWatcher'], { timeout: 1500, maxBuffer: 4096, windowsHide: true, killSignal: 'SIGKILL', ...(signal ? { signal } : {}) }, (error, stdout) => {
        resolve(!error && /\bboolean\s+true\b/.test(stdout || ''));
      });
    } catch { resolve(false); }
  });
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), result.length - 4);
  return result;
}

// A native PNG works in Electron Tray on all platforms (SVG input does not).
function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function trayIcon(state) {
  const width = 48;
  const pixels = Buffer.alloc((width * 4 + 1) * width);
  const color = state === 'active' ? [34, 153, 94] : state === 'suspended' ? [65, 134, 230] : [221, 159, 38];
  const body = [[10, 5], [25, 5], [25, 19], [39, 19], [39, 29], [38, 34], [34, 39], [10, 39]];
  const counter = [[18, 15], [26, 15], [32, 21], [32, 29], [31, 31], [18, 31]];
  const fold = [[25, 5], [25, 19], [39, 19]];
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const index = y * (width * 4 + 1) + 1 + x * 4;
    let pixel = null;
    if (insidePolygon(x, y, body) && !insidePolygon(x, y, counter)) pixel = [169, 67, 32, 255];
    if (insidePolygon(x, y, fold)) pixel = [203, 138, 116, 255];
    if ((x - 38) ** 2 + (y - 36) ** 2 <= 100) pixel = [255, 255, 255, 255];
    if ((x - 38) ** 2 + (y - 36) ** 2 <= 64) {
      pixel = [...color, 255];
      const mark = state === 'active' ? x >= 36 && x <= 40 && Math.abs(y - 36) <= (40 - x)
        : state === 'suspended' ? x >= 34 && x <= 41 && y >= 35 && y <= 37
        : (x === 35 || x === 36 || x === 39 || x === 40) && y >= 32 && y <= 40;
      if (mark) pixel = [30, 32, 39, 255];
    }
    if (pixel) for (let channel = 0; channel < 4; channel++) pixels[index + channel] = pixel[channel];
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(width, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
}

class DesktopTray {
  constructor({ Tray, Menu, nativeImage, engine, tracker, showWindow, quit, platform = process.platform, hostAvailable = true, hostCheck, hostIntervalMs = 1000 }) {
    Object.assign(this, { Menu, nativeImage, engine, tracker, showWindow, quit, platform });
    this.available = false;
    this.tray = null;
    this.lastSignature = '';
    this.disposed = false;
    this.hostTimer = null;
    this.hostPending = null;
    this.hostIntervalMs = hostIntervalMs;
    this.hostController = new AbortController();
    this.hostCheck = hostCheck || (() => trayHostAvailable({ platform, signal: this.hostController.signal }));
    this.onState = state => this.refresh(state);
    if (!hostAvailable) return;
    try {
      this.tray = new Tray(this.image('paused'));
      this.tray.on('click', () => this.showWindow());
      this.tray.on('double-click', () => this.showWindow());
      this.available = true;
      engine.on('state', this.onState);
      this.refresh(engine.state());
      this.scheduleHostCheck();
    } catch { this.unavailable(); }
  }

  image(state) {
    const image = this.nativeImage.createFromBuffer(trayIcon(state), { scaleFactor: 2 });
    if (image.isEmpty()) throw new Error('Ícone de bandeja indisponível.');
    return image;
  }

  invoke(callback) {
    try { Promise.resolve(callback()).catch(() => this.showWindow()); }
    catch { this.showWindow(); }
  }

  template(state) {
    const status = !state.enabled ? 'Pausado' : state.editing ? 'Suspenso durante edição' : 'Ativo';
    return [
      { label: 'Abrir Dobra', click: () => this.showWindow() },
      { label: `Estado: ${status}`, enabled: false },
      { type: 'separator' },
      { label: state.enabled ? 'Pausar ações' : 'Ativar ações', click: () => this.invoke(() => this.engine.setEnabled(!this.engine.enabled)) },
      { label: 'Camada ativa', submenu: state.config.layers.map(layer => ({ label: layer.name, type: 'radio', checked: layer.id === state.activeLayerId, click: () => this.invoke(() => this.engine.setLayer(layer.id)) })) },
      { label: 'Desligar rastreio', enabled: Boolean(state.tracking.enabled), click: () => this.invoke(() => this.tracker.set(false)) },
      { type: 'separator' },
      { label: 'Sair', click: () => this.quit() }
    ];
  }

  refresh(state = this.engine.state()) {
    if (!this.available) return;
    const signature = JSON.stringify([state.enabled, state.editing, state.activeLayerId, state.tracking.enabled, state.config.layers.map(({ id, name }) => [id, name])]);
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    const status = !state.enabled ? 'paused' : state.editing ? 'suspended' : 'active';
    const label = status === 'paused' ? 'Pausado' : status === 'suspended' ? 'Suspenso durante edição' : 'Ativo';
    const layer = state.config.layers.find(item => item.id === state.activeLayerId);
    try {
      this.tray.setImage(this.image(status));
      this.tray.setToolTip(`Dobra · ${label}\n${layer?.name || ''}`);
      this.tray.setContextMenu(this.Menu.buildFromTemplate(this.template(state)));
    } catch { this.unavailable(); }
  }

  scheduleHostCheck() {
    if (this.platform !== 'linux' || !this.available || this.disposed || this.hostTimer) return;
    this.hostTimer = setTimeout(() => {
      this.hostTimer = null;
      void this.revalidate().finally(() => this.scheduleHostCheck());
    }, this.hostIntervalMs);
    this.hostTimer.unref?.();
  }

  revalidate() {
    if (this.disposed || !this.available) return Promise.resolve(false);
    try { if (this.tray?.isDestroyed?.()) { this.unavailable(); return Promise.resolve(false); } }
    catch { this.unavailable(); return Promise.resolve(false); }
    if (this.platform !== 'linux') return Promise.resolve(this.available);
    if (this.hostPending) return this.hostPending;
    this.hostPending = Promise.resolve().then(() => this.hostCheck()).then(available => {
      if (!available && !this.disposed) this.unavailable();
      return Boolean(available && this.available && !this.disposed);
    }, () => {
      if (!this.disposed) this.unavailable();
      return false;
    }).finally(() => { this.hostPending = null; });
    return this.hostPending;
  }

  unavailable() {
    const wasAvailable = this.available;
    this.available = false;
    clearTimeout(this.hostTimer);
    this.hostTimer = null;
    this.hostController.abort();
    this.engine.off('state', this.onState);
    try { this.tray?.destroy(); } catch { /* Native tray may already be gone. */ }
    this.tray = null;
    if (wasAvailable && this.engine.desktop?.trayAvailable) {
      this.engine.desktop.trayAvailable = false;
      this.engine.record?.('info', 'A bandeja ficou indisponível. A janela foi restaurada.');
      this.engine.publish();
      // A window hidden by close-to-tray must remain recoverable after a tray failure.
      this.showWindow();
    }
  }

  dispose() {
    this.disposed = true;
    this.available = false;
    clearTimeout(this.hostTimer);
    this.hostTimer = null;
    this.hostController.abort();
    this.engine.off('state', this.onState);
    try { this.tray?.destroy(); } catch { /* Native tray may already be gone. */ }
    this.tray = null;
  }
}

module.exports = { DesktopTray, trayIcon, trayHostAvailable };
