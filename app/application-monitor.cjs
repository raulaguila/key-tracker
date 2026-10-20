const path = require('node:path');
const { Worker } = require('node:worker_threads');

class WindowReader {
  constructor() {
    this.worker = new Worker(path.join(__dirname, 'application-reader.cjs'));
    this.worker.unref();
    this.pending = null;
    this.stopping = null;
    this.worker.on('message', result => {
      if (result.type === 'stopped') { this.finishStop?.(); return; }
      const pending = this.pending;
      this.pending = null;
      if (!pending) return;
      if (result.error) pending.reject(Object.assign(new Error('Leitura indisponível.'), { code: result.error }));
      else pending.resolve(result);
    });
    this.worker.on('error', () => this.reject());
    this.worker.on('exit', () => this.reject());
  }
  reject() {
    const pending = this.pending;
    this.pending = null;
    pending?.reject(new Error('Leitura indisponível.'));
  }
  read() {
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.worker.postMessage('read');
    });
  }
  dispose() {
    if (this.stopping) return this.stopping;
    this.reject();
    this.stopping = new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.worker.off('exit', finish);
        this.finishStop = null;
        const terminated = Promise.resolve().then(() => this.worker.terminate()).catch(() => {});
        const deadline = setTimeout(resolve, 500);
        void terminated.then(() => { clearTimeout(deadline); resolve(); });
      };
      const timer = setTimeout(finish, 1500);
      this.finishStop = finish;
      this.worker.once('exit', finish);
      try { this.worker.postMessage({ type: 'stop' }); } catch { finish(); }
    });
    return this.stopping;
  }
}

function applicationOwner(result) {
  const owner = result?.owner;
  if (!owner) return null;
  if (owner.processId === process.pid) return undefined;
  const text = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 4096) : '';
  const current = { name: text(owner.name), path: text(owner.path) };
  const bundleId = text(owner.bundleId);
  if (bundleId) current.bundleId = bundleId;
  return current.name || current.path || bundleId ? current : null;
}

class ApplicationMonitor {
  constructor({ engine, platform = process.platform, session = 'native', getActiveWindow, intervalMs = 1000, timeoutMs = 2500 }) {
    this.engine = engine;
    this.platform = platform;
    this.session = session;
    this.getActiveWindow = getActiveWindow;
    this.intervalMs = intervalMs;
    this.timeoutMs = timeoutMs;
    this.enabled = false;
    this.disposed = false;
    this.generation = 0;
    this.timer = null;
    this.readTimeout = null;
    this.inFlight = false;
    this.readPending = false;
    this.reader = null;
    this.lastState = '';
    this.cleanups = new Set();
    this.disposePromise = null;
    this.onState = () => this.configure();
    engine.on('state', this.onState);
    this.configure();
  }

  update(status, message, current = null) {
    const next = { status, message, current };
    const signature = JSON.stringify(next);
    if (signature === this.lastState) return;
    this.lastState = signature;
    this.engine.updateApplication(next);
  }

  configure() {
    if (this.disposed) return;
    const enabled = Boolean(this.engine.config.settings.autoSwitchLayers);
    if (enabled === this.enabled && this.lastState) return;
    this.enabled = enabled;
    this.generation++;
    clearTimeout(this.timer);
    this.timer = null;
    this.stopReader();
    if (!enabled) {
      this.update('off', 'Troca por aplicativo desligada.');
      return;
    }
    if (this.platform === 'linux' && this.session === 'wayland') {
      this.update('unavailable', 'O Wayland não permite identificar o aplicativo em foco. Selecione a camada manualmente ou use uma sessão X11.');
      return;
    }
    if (!['linux', 'darwin', 'win32'].includes(this.platform)) {
      this.update('unavailable', 'Identificação de aplicativos indisponível neste sistema.');
      return;
    }
    this.update('ready', 'Aguardando aplicativo em foco.');
    void this.poll();
  }

  async poll() {
    if (this.disposed || !this.enabled || this.inFlight || this.readPending || (this.platform === 'linux' && this.session === 'wayland')) return;
    if (this.cleanups.size) return;
    this.inFlight = true;
    const generation = this.generation;
    let expired = false;
    let rejectTimeout;
    const timedOut = new Promise((resolve, reject) => { rejectTimeout = reject; });
    const timeout = setTimeout(() => {
      expired = true;
      if (!this.disposed && generation === this.generation && this.enabled) {
        this.update('error', 'A identificação do aplicativo não respondeu. O controle manual continua disponível.');
      }
      // Stop the owned native helpers before terminating/replacing their thread.
      this.stopReader();
      rejectTimeout(new Error('Leitura expirada.'));
    }, this.timeoutMs);
    this.readTimeout = timeout;
    timeout.unref?.();
    try {
      this.reader ??= this.getActiveWindow ? null : new WindowReader();
      this.readPending = true;
      const reading = Promise.resolve().then(() => this.getActiveWindow ? this.getActiveWindow({ accessibilityPermission: false, screenRecordingPermission: false }) : this.reader.read());
      const settled = () => { this.readPending = false; if (!this.inFlight) this.schedule(); };
      reading.then(settled, settled);
      const result = await Promise.race([reading, timedOut]);
      if (expired || this.disposed || !this.enabled || generation !== this.generation) return;
      const current = applicationOwner(result);
      if (current === undefined) return; // Preserve context while our own window is focused.
      this.update(current ? 'ready' : 'unavailable', current ? 'Aplicativo em foco identificado. Nenhum título de janela é salvo.' : 'Nenhum aplicativo em foco foi identificado. O controle manual continua disponível.', current);
    } catch (error) {
      if (expired || this.disposed || !this.enabled || generation !== this.generation) return;
      this.update(error.code === 'linux-tools' ? 'unavailable' : 'error', error.code === 'linux-tools'
        ? 'Instale xprop e xwininfo para identificar aplicativos no X11. O controle manual continua disponível.'
        : 'Não foi possível identificar o aplicativo em foco. O controle manual continua disponível.');
      this.stopReader();
    } finally {
      clearTimeout(timeout);
      if (this.readTimeout === timeout) this.readTimeout = null;
      this.inFlight = false;
      this.schedule();
    }
  }

  schedule() {
    if (!this.disposed && this.enabled && !this.timer && !this.readPending && !this.cleanups.size) {
      this.timer = setTimeout(() => { this.timer = null; void this.poll(); }, this.intervalMs);
      this.timer.unref?.();
    }
  }

  stopReader() {
    if (!this.reader) return;
    const reader = this.reader;
    this.reader = null;
    const cleanup = reader.dispose().catch(() => {});
    this.cleanups.add(cleanup);
    void cleanup.then(() => { this.cleanups.delete(cleanup); this.schedule(); });
  }

  dispose() {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.enabled = false;
    this.generation++;
    this.engine.off('state', this.onState);
    clearTimeout(this.timer);
    clearTimeout(this.readTimeout);
    this.timer = null;
    this.readTimeout = null;
    this.stopReader();
    this.disposePromise = Promise.allSettled([...this.cleanups]).then(() => {});
    return this.disposePromise;
  }
}

module.exports = { ApplicationMonitor, applicationOwner };
