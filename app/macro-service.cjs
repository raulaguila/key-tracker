const { NativeMacroDriver, macroError } = require('./macro-input/native.cjs');
const { normalizeShortcut, effectiveShortcut } = require('./config.cjs');

const STOP_SHORTCUT = 'Control+Shift+F10';
const STOP_CANDIDATES = [...new Set([10, 9, 11, ...Array.from({ length: 24 }, (_, index) => index + 1)])].map(key => `Control+Shift+F${key}`).concat(Array.from({ length: 24 }, (_, index) => `Control+Alt+Shift+F${index + 1}`));
const MAX_STEPS = 200;
const MAX_RECORDING_MS = 5 * 60 * 1000;
const descriptions = {
  ready: 'Automação de mouse e teclado disponível. Revise as etapas antes de testar em outro aplicativo.',
  unauthorized: 'Autorize a automação para gravar ou executar cliques e teclas em outros aplicativos.',
  authorizing: 'Verificando a integração e aguardando a autorização do sistema…',
  recording: 'Gravação em andamento.',
  playing: 'Fluxo em execução.',
  denied: 'O sistema não autorizou a automação. Corrija as permissões e tente novamente; seu fluxo continua no editor.',
  unavailable: 'A integração de automação não está disponível. Confira as permissões, os componentes nativos e a sessão de desktop.'
};

function cancelled() { return Object.assign(new Error('Execução cancelada.'), { code: 'EXECUTION_CANCELLED' }); }
function check(signal) { if (signal?.aborted) throw cancelled(); }
function delay(ms, signal) {
  check(signal);
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
    const abort = () => finish(cancelled());
    const timer = setTimeout(() => finish(), ms);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

class MacroService {
  constructor({ platform = process.platform, session = process.env.XDG_SESSION_TYPE, clipboard, screen, getWindow = () => null, isAppFocused = () => false, getReservedShortcuts = () => [], onChange = () => {}, driverFactory, fork, accessibility, now = () => Number(process.hrtime.bigint()) / 1000000, recordingMs = MAX_RECORDING_MS, settleMs = 100, recordPrepareMs = 250 } = {}) {
    Object.assign(this, { platform, session, clipboard, screen, getWindow, isAppFocused, getReservedShortcuts, onChange, driverFactory, fork, accessibility, now, recordingMs, settleMs, recordPrepareMs });
    this.backend = platform === 'linux' ? session === 'wayland' ? 'xdg-portal' : 'x11' : platform === 'darwin' ? 'quartz' : platform === 'win32' ? 'send-input' : 'unsupported';
    this.capabilities = { playback: false, recording: false };
    this.status = 'unauthorized'; this.message = descriptions.unauthorized; this.count = 0;
    this.recording = false; this.playing = false; this.disposed = false; this.generation = 0; this.stopGeneration = 0; this.retiring = new Set(); this.stopShortcut = STOP_SHORTCUT;
  }
  state() {
    return { status: this.status, message: this.message, recording: this.recording, playing: this.playing, count: this.count,
      stopShortcut: this.backend === 'xdg-portal' || this.backend === 'unsupported' ? '' : this.stopShortcut,
      capabilities: { ...this.capabilities }, backend: this.backend };
  }
  publish(status = this.status, message) {
    this.status = status; this.message = message || descriptions[status] || descriptions.unavailable;
    if (!message && status === 'recording') this.message += ` Use ${this.stopShortcut} para parar e voltar ao editor.`;
    if (!message && status === 'playing') this.message += this.backend === 'xdg-portal' ? ' Volte ao Dobra para cancelar.' : ` Use ${this.stopShortcut} ou volte ao Dobra para cancelar.`;
    this.onChange(this.state());
  }
  pickStopShortcut(extra = []) {
    if (this.backend === 'xdg-portal') return;
    const reserved = new Set([...this.getReservedShortcuts(), ...extra].filter(Boolean).map(key => effectiveShortcut(key, this.platform)));
    const candidate = STOP_CANDIDATES.find(key => !reserved.has(effectiveShortcut(key, this.platform)));
    if (!candidate) throw macroError('MACRO_STOP_CONFLICT');
    this.stopShortcut = candidate;
    this.stopGeneration++;
    this.driver?.invalidateStop?.(candidate, this.stopGeneration);
  }
  makeDriver() {
    const options = { platform: this.platform, fork: this.fork, accessibility: this.accessibility, stopShortcut: this.stopShortcut, stopGeneration: this.stopGeneration,
      onInput: step => this.capture(step), onStop: event => {
        if (!event || event.key !== this.stopShortcut || event.generation !== this.stopGeneration) return;
        if (this.recording) void this.finishRecording('shortcut'); else this.cancelPlayback();
      },
      onError: error => this.driverFailed(error) };
    if (this.driverFactory) return this.driverFactory(options);
    if (this.backend === 'xdg-portal') return require('./macro-input/wayland.cjs').createWaylandDriver(options);
    if (this.backend === 'unsupported') throw macroError();
    return new NativeMacroDriver(options);
  }
  async ensureDriver(prompt = false) {
    if (!this.driver) this.driver = this.makeDriver();
    const driver = this.driver, generation = this.generation;
    const capabilities = await driver.authorize({ prompt });
    if (driver.setStopShortcut) await driver.setStopShortcut(this.stopShortcut, { generation: this.stopGeneration });
    if (this.disposed || this.driver !== driver || generation !== this.generation) throw macroError('MACRO_STOPPED');
    this.capabilities = { playback: capabilities.playback === true, recording: capabilities.recording === true };
    this.readyMessage = capabilities.message || descriptions.ready;
    return driver;
  }
  async authorize() {
    if (this.disposed) throw macroError();
    if (this.recording || this.playing || this.suspending) throw macroError('MACRO_BUSY');
    if (this.authorization) return this.authorization;
    this.pickStopShortcut();
    this.publish('authorizing');
    this.authorization = (async () => {
      try {
        await this.ensureDriver(true);
        if (this.disposed) throw macroError();
        this.authorized = true; this.failureStatus = null; this.failureMessage = null; this.publish('ready', this.readyMessage);
        return this.state();
      } catch (error) {
        this.authorized = false; this.capabilities = { playback: false, recording: false };
        await this.closeDriver();
        this.publish(error?.code === 'MACRO_PERMISSION' || error?.code === 'MACRO_DENIED' ? 'denied' : 'unavailable', this.backend === 'xdg-portal' && error?.code?.startsWith('MACRO_') ? error.message : undefined);
        throw error?.code?.startsWith('MACRO_') ? error : macroError();
      } finally { this.authorization = null; }
    })();
    return this.authorization;
  }
  startRecording() {
    if (this.recordingStartTask) return Promise.reject(macroError('MACRO_BUSY'));
    const task = this.beginRecording(); this.recordingStartTask = task;
    return task.finally(() => { if (this.recordingStartTask === task) this.recordingStartTask = null; });
  }
  async beginRecording() {
    if (this.disposed) throw macroError();
    if (this.recording || this.playing || this.authorization || this.suspending) throw macroError('MACRO_BUSY');
    if (!this.authorized) throw macroError('MACRO_PERMISSION');
    if (!this.capabilities.recording) throw macroError('MACRO_UNAVAILABLE');
    this.pickStopShortcut();
    this.recording = true; this.steps = []; this.pendingRecording = null; this.count = 0; this.recordStarted = this.now(); this.recordLast = this.recordStarted;
    this.publish('recording');
    try {
      const driver = await this.ensureDriver();
      if (!this.recording) return this.state();
      const window = this.getWindow();
      if (window && !window.isDestroyed?.()) { this.returnWindow = window; window.minimize(); }
      // The start click/released key must not become the first recorded step.
      await delay(this.recordPrepareMs);
      if (!this.recording) return this.state();
      this.recordLast = this.now();
      await driver.startRecording(step => this.capture(step), reason => { void this.finishRecording(reason || 'interrupted'); });
      this.recordTimer = setTimeout(() => { void this.finishRecording('time-limit'); }, this.recordingMs); this.recordTimer.unref?.();
      return this.state();
    } catch (error) {
      await this.finishRecording('interrupted');
      this.publish(error?.code === 'MACRO_PERMISSION' ? 'denied' : 'unavailable');
      throw error?.code?.startsWith('MACRO_') ? error : macroError();
    }
  }
  capture(step) {
    if (!this.recording || this.isAppFocused()) return;
    let safe;
    if (step?.kind === 'key') {
      try { const key = normalizeShortcut(step.key); if (key === this.stopShortcut) { void this.finishRecording('shortcut'); return; } safe = { kind: 'key', key }; }
      catch { return; }
    } else if (step?.kind === 'click' && Number.isInteger(step.x) && Number.isInteger(step.y) && Math.abs(step.x) <= 100000 && Math.abs(step.y) <= 100000 && ['left', 'right', 'middle'].includes(step.button)) {
      safe = { kind: 'click', x: step.x, y: step.y, button: step.button, clicks: 1 };
    } else return;
    const at = this.now(); let elapsed = Math.max(0, Math.round(at - this.recordLast)); this.recordLast = at;
    while (elapsed > 60000 && this.steps.length < MAX_STEPS - 1) { this.steps.push({ kind: 'wait', ms: 60000 }); elapsed -= 60000; }
    if (elapsed > 60000) {
      // Keep a faithful prefix: when the remaining gap cannot fit, do not
      // shorten it and replay the following click/key earlier than recorded.
      this.count = this.steps.length;
      void this.finishRecording('step-limit'); return;
    }
    if (this.steps.length >= MAX_STEPS) { void this.finishRecording('step-limit'); return; }
    safe.delayBeforeMs = Math.min(elapsed, 60000); this.steps.push(safe); this.count = this.steps.length;
    this.publish('recording');
    if (this.steps.length >= MAX_STEPS) void this.finishRecording('step-limit');
  }
  async finishRecording(reason = 'stopped', cancel = false) {
    if (this.finishingRecording) return this.finishingRecording;
    if (!this.recording) {
      if (cancel) this.pendingRecording = null;
      return;
    }
    // Keep recording=true until the native listener has acknowledged the stop;
    // the engine remains suspended throughout cleanup and queued input.
    this.finishingRecording = (async () => {
      clearTimeout(this.recordTimer); this.recordTimer = null;
      try { await this.driver?.stopRecording?.(); } catch { reason = 'interrupted'; }
      await delay(this.settleMs);
      await this.closeDriver();
      this.recording = false;
      this.pendingRecording = cancel ? null : { steps: structuredClone(this.steps || []), reason };
      this.steps = []; this.count = this.pendingRecording?.steps.length || 0;
      const messages = { shortcut: 'Gravação encerrada pelo atalho. Revise as etapas no editor.', stopped: 'Gravação encerrada. Revise as etapas antes de salvar.', 'step-limit': 'Gravação encerrada no limite de 200 etapas. Revise o trecho capturado.', 'time-limit': 'Gravação encerrada no limite de cinco minutos. Revise o trecho capturado.', interrupted: 'A gravação foi interrompida. As etapas já capturadas continuam disponíveis para revisão.' };
      this.publish(this.authorized ? 'ready' : 'unavailable', cancel ? 'Gravação descartada. O fluxo anterior foi preservado.' : messages[reason] || messages.interrupted);
      this.restoreWindow();
    })();
    try { await this.finishingRecording; } finally { this.finishingRecording = null; }
  }
  async stopRecording({ cancel = false } = {}) {
    if (typeof cancel !== 'boolean') throw macroError();
    await this.finishRecording('stopped', cancel);
    if (cancel) { this.pendingRecording = null; return { steps: [], reason: 'cancelled' }; }
    const result = this.pendingRecording || { steps: [], reason: 'stopped' };
    this.pendingRecording = null; return structuredClone(result);
  }
  restoreWindow() {
    const window = this.returnWindow; this.returnWindow = null;
    if (this.disposed || !window || window.isDestroyed?.()) return;
    if (window.isMinimized?.()) window.restore();
    window.show(); window.focus();
  }
  async run(action, { signal, onProgress, onStep } = {}) {
    if (this.disposed) throw macroError();
    if (this.recording || this.playing || this.authorization || this.suspending) throw macroError('MACRO_BUSY');
    if (!this.authorized || !this.capabilities.playback) throw macroError('MACRO_PERMISSION');
    this.pickStopShortcut(action.steps.filter(step => step.kind === 'key').map(step => step.key));
    check(signal);
    const controller = new AbortController(); this.playbackController = controller;
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    this.playing = true; this.count = 0; this.publish('playing');
    this.playbackError = null;
    const stopDriver = () => { void this.closeDriver(); }; controller.signal.addEventListener('abort', stopDriver, { once: true });
    const task = (async () => {
      try {
        const driver = await this.ensureDriver(); check(controller.signal);
        onProgress?.({ stepIndex: 1, stepCount: action.steps.length, phase: 'waiting' });
        await delay(action.startDelayMs ?? 3000, controller.signal);
        if (driver.released) {
          const deadline = this.now() + 5000;
          while (!(await driver.released())) { if (this.now() >= deadline) throw macroError('MACRO_KEYS_HELD'); await delay(25, controller.signal); }
        }
        for (const [index, step] of action.steps.entries()) {
          const stepStarted = this.now();
          try {
          check(controller.signal);
          onProgress?.({ stepIndex: index + 1, stepCount: action.steps.length, phase: step.kind === 'wait' || step.delayBeforeMs ? 'waiting' : 'running' });
          await delay(step.kind === 'wait' ? step.ms : step.delayBeforeMs || 0, controller.signal);
          check(controller.signal);
          // Returning to this application is a safe way to stop a flow; never
          // inject into the user's editor, search field or permission dialog.
          if (this.isAppFocused()) throw macroError('MACRO_FOCUSED');
          if (step.kind === 'click') await driver.click(step, { signal: controller.signal });
          else if (step.kind === 'key') await driver.key(step.key, { signal: controller.signal });
          else if (step.kind === 'text') {
            if (!this.clipboard?.writeText) throw macroError();
            this.clipboard.writeText(step.text);
            await driver.key(this.platform === 'darwin' ? 'Command+V' : 'Control+V', { signal: controller.signal });
            // Give the destination time to request the clipboard before the
            // next text step replaces it. No clipboard restore race is hidden.
            await delay(150, controller.signal);
          } else if (step.kind !== 'wait') throw macroError();
          check(controller.signal); this.count = index + 1;
          onStep?.({ index: index + 1, type: step.kind, status: 'success', message: 'Etapa do fluxo concluída.', durationMs: Math.max(0, this.now() - stepStarted) });
          } catch (error) {
            onStep?.({ index: index + 1, type: step.kind, status: controller.signal.aborted && !this.playbackError ? 'cancelled' : 'error', message: controller.signal.aborted && !this.playbackError ? 'Etapa cancelada.' : 'Não foi possível concluir esta etapa do fluxo.', durationMs: Math.max(0, this.now() - stepStarted) });
            throw error;
          }
        }
        return { message: `Fluxo concluído: ${action.steps.length} etapas.`, steps: action.steps.length };
      } catch (error) {
        if (this.playbackError) throw this.playbackError;
        check(controller.signal);
        throw error?.code?.startsWith('MACRO_') ? error : macroError();
      } finally {
        // Drain native input before exposing playing=false so synthetic keys
        // cannot retrigger configured actions through another hook's queue.
        await delay(this.settleMs);
        if (this.backend !== 'xdg-portal' || controller.signal.aborted) await this.closeDriver();
        this.playing = false; this.playbackController = null;
        controller.signal.removeEventListener('abort', stopDriver); signal?.removeEventListener('abort', abort);
        this.publish(this.authorized ? 'ready' : this.failureStatus || 'unavailable', this.authorized ? this.readyMessage : this.failureMessage);
      }
    })();
    this.playbackTask = task;
    try { return await task; } finally { if (this.playbackTask === task) this.playbackTask = null; }
  }
  cancelPlayback() { this.playbackController?.abort(); return this.playbackTask?.catch(() => {}); }
  async closeDriver() {
    const driver = this.driver; this.driver = null;
    if (driver && this.backend === 'xdg-portal') { this.authorized = false; this.capabilities = { playback: false, recording: false }; }
    if (driver) {
      const task = Promise.resolve().then(() => driver.dispose?.());
      this.retiring.add(task);
      // Completion can be joined by abort, run-finally and shutdown together.
      void task.then(() => this.retiring.delete(task), () => this.retiring.delete(task));
    }
    const outcomes = await Promise.allSettled([...this.retiring]);
    if (outcomes.some(outcome => outcome.status === 'rejected')) {
      this.authorized = false; this.capabilities = { playback: false, recording: false };
      this.failureStatus = 'unavailable'; this.failureMessage = descriptions.unavailable;
    }
  }
  driverFailed(error) {
    this.authorized = false; this.capabilities = { playback: false, recording: false };
    if (this.recording) void this.finishRecording('interrupted');
    if (this.playing) { this.playbackError = error?.code?.startsWith('MACRO_') ? error : macroError(); this.playbackController?.abort(); }
    this.failureStatus = error?.code === 'MACRO_PERMISSION' ? 'denied' : 'unavailable';
    this.failureMessage = this.backend === 'xdg-portal' && error?.code?.startsWith('MACRO_') ? error.message : descriptions[this.failureStatus];
    this.publish(this.failureStatus, this.failureMessage);
  }
  async suspend({ reauthorize = false, message } = {}) {
    if (reauthorize) { this.authorized = false; this.capabilities = { playback: false, recording: false }; }
    if (message) this.suspendMessage = message;
    if (this.suspension) return this.suspension;
    this.generation++; this.suspending = true;
    const task = this.playbackTask, authorization = this.authorization, recordingStart = this.recordingStartTask;
    this.playbackController?.abort();
    this.suspension = (async () => {
      try {
        await this.closeDriver();
        await this.finishRecording('interrupted');
        await task?.catch(() => {});
        await authorization?.catch(() => {});
        await recordingStart?.catch(() => {});
        this.publish(this.authorized ? 'ready' : 'unauthorized', this.suspendMessage || (this.authorized ? this.readyMessage : descriptions.unauthorized));
      } finally { this.suspending = false; this.suspension = null; this.suspendMessage = null; }
    })();
    return this.suspension;
  }
  async dispose() { this.disposed = true; await this.suspend(); this.pendingRecording = null; this.steps = []; }
}
module.exports = { MacroService, MAX_STEPS, MAX_RECORDING_MS, STOP_SHORTCUT };
