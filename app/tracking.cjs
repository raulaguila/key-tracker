const path = require('node:path');

class Tracker {
  constructor({ engine, fork, accessibility = () => true, startupMs = 5000 }) {
    Object.assign(this, { engine, fork, accessibility, startupMs });
    this.worker = null;
    this.workerMode = 'off';
    this.timer = null;
    this.visualEnabled = Boolean(engine.tracking?.enabled);
    this.inputDemand = false;
    this.lastEnabled = Boolean(engine.enabled);
    this.failure = '';
    this.configuring = false;
    this.disposed = false;
    this.retiring = new Map();
    this.onState = () => this.configure();
    engine.on('state', this.onState);
    this.configure();
  }

  state() { return this.engine.state ? this.engine.state() : this.engine.tracking; }

  set(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Estado de rastreio inválido.');
    if (this.disposed) return this.state();
    this.visualEnabled = enabled;
    if (enabled) this.failure = '';
    this.configure();
    return this.state();
  }

  configure() {
    if (this.disposed || this.configuring) return;
    this.configuring = true;
    try {
      const needed = Boolean(this.engine.needsInput?.());
      if ((needed && !this.inputDemand) || (this.engine.enabled && !this.lastEnabled)) this.failure = '';
      this.lastEnabled = Boolean(this.engine.enabled);
      this.inputDemand = needed;
      if (!needed && !this.visualEnabled) {
        this.failure = '';
        this.stopWorker();
      } else if (this.engine.session === 'wayland') {
        this.stopWorker();
        this.failure = 'No Wayland, ações ao manter ou soltar não estão disponíveis. Use uma sessão X11 para entrada global no Linux.';
      } else if (!this.worker && !this.failure) {
        let allowed = true;
        if (this.engine.platform === 'darwin') {
          try { allowed = this.accessibility(); } catch { allowed = false; }
        }
        if (!allowed) this.failure = 'Autorize o aplicativo em Ajustes do Sistema → Privacidade e Segurança → Acessibilidade. Depois, desligue e ative as ações ou o rastreio para tentar novamente.';
        else this.startWorker();
      }
      this.report();
    } finally { this.configuring = false; }
  }

  report() {
    const visualMode = !this.visualEnabled ? 'off' : this.worker ? this.workerMode : 'local';
    const tracking = {
      enabled: this.visualEnabled,
      mode: visualMode,
      message: visualMode === 'off' ? 'Rastreio desligado.'
        : visualMode === 'global' ? 'Capturando pressionar e soltar em todo o sistema. As teclas não são salvas.'
        : visualMode === 'starting' ? 'Iniciando captura global…'
        : this.engine.session === 'wayland' ? 'No Wayland, o rastreio visual funciona apenas nesta janela. Para rastreio global no Linux, use uma sessão X11.'
        : this.failure + ' Rastreio disponível somente nesta janela.'
    };
    const input = {
      mode: !this.inputDemand ? 'off' : this.worker ? this.workerMode : 'unavailable',
      message: !this.inputDemand ? 'Ative as ações para usar os momentos de manter e soltar.'
        : this.workerMode === 'global' ? 'Momentos de tecla disponíveis globalmente.'
        : this.worker ? 'Iniciando entrada global para os momentos da tecla…'
        : this.failure || 'Entrada global indisponível. Os momentos de manter e soltar não serão executados.'
    };
    const trackingChanged = JSON.stringify(this.engine.tracking) !== JSON.stringify(tracking);
    const inputChanged = JSON.stringify(this.engine.input) !== JSON.stringify(input);
    this.engine.tracking = tracking;
    if (inputChanged && this.engine.updateInput) this.engine.updateInput(input);
    else if (trackingChanged) this.engine.publish();
  }

  startWorker() {
    try {
      const worker = this.fork(path.join(__dirname, 'tracker-worker.cjs'), [], { serviceName: 'Keyboard Tracker Input', stdio: 'ignore' });
      this.worker = worker;
      this.workerMode = 'starting';
      this.timer = setTimeout(() => {
        if (this.worker === worker) this.fail('A entrada global não respondeu. Verifique as permissões de entrada.');
      }, this.startupMs);
      this.timer.unref?.();
      worker.on('message', message => {
        if (this.worker !== worker || this.disposed) return;
        if (message.type === 'ready') {
          clearTimeout(this.timer);
          this.timer = null;
          this.workerMode = 'global';
          this.configure();
        } else if (message.type === 'key' && this.workerMode === 'global' && typeof message.code === 'string' && ['down', 'up'].includes(message.direction)) {
          const event = { code: message.code, key: typeof message.key === 'string' ? message.key : message.code, direction: message.direction,
            ctrlKey: Boolean(message.ctrlKey), altKey: Boolean(message.altKey), shiftKey: Boolean(message.shiftKey), metaKey: Boolean(message.metaKey), source: 'global' };
          // Paused/editing releases still clear held keys. Visualization subscribes
          // independently to this same hook and never enables actions.
          this.engine.handleInput?.(event);
          if (this.visualEnabled && this.worker === worker) this.engine.emit('key', event);
        }
      });
      worker.on('exit', () => {
        if (this.worker === worker) this.fail('A entrada global foi interrompida. Verifique as permissões e ative novamente para tentar.');
      });
      worker.on('error', () => {
        if (this.worker === worker) this.fail('Não foi possível iniciar a entrada global. Verifique as permissões e o suporte do sistema.');
      });
    } catch {
      this.failure = 'Não foi possível iniciar a entrada global. Verifique as permissões e o suporte do sistema.';
      this.workerMode = 'off';
      this.worker = null;
      this.engine.resetInput?.();
    }
  }

  fail(message) {
    this.failure = message;
    this.stopWorker();
    this.configure();
  }

  stopWorker() {
    clearTimeout(this.timer);
    this.timer = null;
    const worker = this.worker;
    this.worker = null;
    this.workerMode = 'off';
    if (!worker) return;
    this.engine.resetInput?.();
    const timer = setTimeout(() => { this.retiring.delete(worker); try { worker.kill(); } catch { /* Already exited. */ } }, 1000);
    timer.unref?.();
    this.retiring.set(worker, timer);
    worker.once('exit', () => { clearTimeout(timer); this.retiring.delete(worker); });
    try { worker.postMessage('stop'); } catch { /* It may have exited between messages. */ }
  }

  stop() { this.dispose(); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.engine.off('state', this.onState);
    this.visualEnabled = false;
    this.inputDemand = false;
    this.stopWorker();
    for (const [worker, timer] of this.retiring) {
      clearTimeout(timer);
      try { worker.kill(); } catch { /* Already exited. */ }
    }
    this.retiring.clear();
    this.report();
  }
}

module.exports = { Tracker };
