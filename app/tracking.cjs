const path = require('node:path');

class Tracker {
  constructor({ engine, fork, accessibility = () => true, startupMs = 5000, wayland, nativeInput }) {
    Object.assign(this, { engine, fork, accessibility, startupMs, wayland, nativeInput });
    this.linuxRequested = engine.session === 'wayland';
    this.lastDeviceId = engine.config.settings.inputDeviceId || '';
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
    const integration = nativeInput || wayland;
    if (integration) {
      this.onLinuxState = () => this.configure();
      this.onLinuxKey = event => { if (this.disposed) return; engine.handleInput?.(event); if (this.visualEnabled) engine.emit('key', event); };
      this.onLinuxReset = pressed => { engine.synchronizeInput?.(pressed); if (this.visualEnabled) engine.emit('key', { reset: true, pressed }); };
      this.onLinuxInterrupted = () => { engine.resetInput?.(); engine.synchronizeInput?.([]); if (engine.enabled) engine.setEnabled(false); };
      integration.on('state', this.onLinuxState); integration.on('key', this.onLinuxKey);
      integration.on('reset', this.onLinuxReset); integration.on('interrupted', this.onLinuxInterrupted);
    }
    this.configure();
  }

  state() { return this.engine.state ? this.engine.state() : this.engine.tracking; }

  set(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Estado de rastreio inválido.');
    if (this.disposed) return this.state();
    this.visualEnabled = enabled;
    if (enabled) { this.failure = ''; this.nativeInput?.retry(); }
    this.configure();
    return this.state();
  }

  async setLinuxEnabled(enabled) {
    if (typeof enabled !== 'boolean' || !this.wayland || this.disposed) throw new Error('Integração Linux indisponível.');
    this.linuxRequested = enabled || this.engine.session === 'wayland';
    this.engine.resetInput?.(); this.engine.synchronizeInput?.([]);
    if (this.engine.enabled) this.engine.setEnabled(false);
    this.stopWorker();
    this.wayland.update({ config: this.engine.config, observe: this.inputDemand || this.visualEnabled, visual: this.visualEnabled });
    if (enabled) {
      if (!this.wayland.state().enabled && this.engine.enabled) this.engine.setEnabled(false);
      await this.wayland.enable();
    }
    else { if (this.engine.enabled) this.engine.setEnabled(false); await this.wayland.disable(); }
    this.configure();
    return this.state();
  }

  integration() { return this.nativeInput || (this.wayland && this.linuxRequested ? this.wayland : undefined); }

  suspend() {
    this.engine.resetInput?.();
    if (this.engine.enabled) this.engine.setEnabled(false);
    this.integration()?.suspend();
  }

  configure() {
    if (this.disposed || this.configuring) return;
    this.configuring = true;
    try {
      const needed = Boolean(this.engine.needsInput?.());
      if ((needed && !this.inputDemand) || (this.engine.enabled && !this.lastEnabled)) { this.failure = ''; this.nativeInput?.retry(); }
      this.lastEnabled = Boolean(this.engine.enabled);
      this.inputDemand = needed;
      const selectedId = this.engine.config.settings.inputDeviceId || '';
      if (selectedId !== this.lastDeviceId) {
        this.lastDeviceId = selectedId; this.engine.resetInput?.(); this.engine.synchronizeInput?.([]);
        if (this.engine.enabled) this.engine.setEnabled(false);
      }
      const integration = this.integration();
      if (integration) {
        this.stopWorker();
        integration.update({ config: this.engine.config, observe: needed || this.visualEnabled, visual: this.visualEnabled });
        this.report();
        return;
      }
      if (!needed && !this.visualEnabled) {
        this.failure = '';
        this.stopWorker();
      } else if (selectedId) {
        this.stopWorker();
        this.failure = 'Seleção de teclado exige habilitar a integração Linux por dispositivo. O backend X11 padrão observa todos os teclados.';
      } else if (this.engine.session === 'wayland') {
        this.stopWorker();
        this.failure = 'No Wayland, a observação global de teclas está indisponível. As ações por tecla não serão executadas. Use uma sessão X11 no Linux.';
      } else if (!this.worker && !this.failure) {
        let allowed = true;
        if (this.engine.platform === 'darwin') {
          try { allowed = this.accessibility(); } catch { allowed = false; }
        }
        if (!allowed) this.failure = 'Autorize o aplicativo em Ajustes do Sistema → Privacidade e Segurança → Acessibilidade. Depois, desligue e ative as ações ou o rastreio para tentar novamente.';
        else this.startWorker();
      }
      this.report();
    } finally {
      this.configuring = false;
      // Enabling visualization can arm the panel control during updateInput.
      if (!this.disposed && Boolean(this.engine.needsInput?.()) !== this.inputDemand) this.configure();
    }
  }

  report() {
    const integration = this.integration()?.state();
    const deviceState = this.integration()?.deviceState?.() || { supported: false, devices: [], selectedId: this.engine.config.settings.inputDeviceId || '', status: 'unsupported', message: 'O backend X11 padrão observa todos os teclados. Habilite a integração Linux para selecionar um dispositivo.' };
    const devicesChanged = JSON.stringify(this.engine.inputDevices) !== JSON.stringify(deviceState);
    this.engine.inputDevices = deviceState;
    // A request made while the selected source is absent must not spring to
    // life when it reconnects; activation is explicit after availability.
    if (this.engine.enabled && ['missing', 'waiting'].includes(deviceState.status)) this.engine.setEnabled(false);
    const nativeMode = integration ? integration.status === 'global' ? 'global' : integration.status === 'authorizing' ? 'starting' : 'local' : this.worker ? this.workerMode : 'local';
    const visualMode = !this.visualEnabled ? 'off' : nativeMode;
    const tracking = {
      enabled: this.visualEnabled,
      mode: visualMode,
      message: visualMode === 'off' ? 'Rastreio desligado.'
        : visualMode === 'global' ? 'Capturando pressionar e soltar em todo o sistema. As teclas não são salvas.'
        : visualMode === 'starting' ? 'Iniciando captura global…'
        : integration ? integration.message + ' Rastreio disponível nesta janela.'
        : this.engine.session === 'wayland' ? 'No Wayland, o rastreio visual funciona apenas nesta janela. Para rastreio global no Linux, habilite a integração Linux nas configurações.'
        : this.failure + ' Rastreio disponível somente nesta janela.'
    };
    const input = {
      mode: !this.inputDemand ? 'off' : nativeMode === 'local' ? 'unavailable' : nativeMode,
      message: !this.inputDemand ? 'Ative as ações para observar teclas em outros aplicativos.'
        : integration ? integration.message
        : this.workerMode === 'global' ? 'Observação global ativa. As teclas continuam funcionando nos outros aplicativos.'
        : this.worker ? 'Iniciando observação global das teclas…'
        : this.failure || 'Observação global indisponível. As ações por tecla não serão executadas.'
    };
    const trackingChanged = JSON.stringify(this.engine.tracking) !== JSON.stringify(tracking);
    const inputChanged = JSON.stringify(this.engine.input) !== JSON.stringify(input);
    const linuxState = this.wayland?.state();
    const integrationChanged = linuxState && JSON.stringify(this.engine.linuxInput) !== JSON.stringify(linuxState);
    if (linuxState) this.engine.linuxInput = linuxState;
    this.engine.tracking = tracking;
    if ((inputChanged || trackingChanged && this.visualEnabled) && this.engine.updateInput) {
      const revision = this.engine.stateRevision;
      this.engine.updateInput(input);
      // Input availability may stay identical while visualization or device
      // metadata changes. Deliver that state before the next reset/key frame.
      if (this.engine.stateRevision === revision && (trackingChanged || integrationChanged || devicesChanged)) this.engine.publish();
    } else if (trackingChanged || integrationChanged || devicesChanged) this.engine.publish();
  }

  startWorker() {
    try {
      const worker = this.fork(path.join(__dirname, 'tracker-worker.cjs'), [], { serviceName: 'Dobra Input', stdio: 'ignore' });
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

  stop() { return this.dispose(); }

  dispose() {
    if (this.disposed) return this.disposePromise;
    this.disposed = true;
    const owned = [...new Set([this.worker, ...this.retiring.keys()].filter(Boolean))];
    this.disposePromise = Promise.all(owned.map(worker => new Promise(resolve => {
      const finish = () => { clearTimeout(timer); worker.off('exit', finish); resolve(); };
      const timer = setTimeout(finish, 1000);
      worker.once('exit', finish);
    })));
    this.engine.off('state', this.onState);
    const integration = this.nativeInput || this.wayland;
    if (integration) {
      integration.off('state', this.onLinuxState); integration.off('key', this.onLinuxKey);
      integration.off('reset', this.onLinuxReset); integration.off('interrupted', this.onLinuxInterrupted);
      this.disposePromise = Promise.all([this.disposePromise, integration.dispose()]);
    }
    this.visualEnabled = false;
    this.inputDemand = false;
    this.stopWorker();
    for (const [worker, timer] of this.retiring) {
      clearTimeout(timer);
      try { worker.kill(); } catch { /* Already exited. */ }
    }
    this.retiring.clear();
    this.report();
    return this.disposePromise;
  }
}

module.exports = { Tracker };
