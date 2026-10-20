const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { validateConfig, effectiveShortcut, electronShortcut, applicationIdentity } = require('./config.cjs');
const { executeAction, prepareAction, previewAction, freezePreparedAction, actionErrorMessage } = require('./actions.cjs');
const { KeyGestures, shortcutModifiers, matchesModifiers } = require('./key-gestures.cjs');
const PAUSE_RESUME_DEBOUNCE_MS = 400;
const triggerDetails = binding => ({ trigger: binding.trigger || 'press', ...(binding.keyCode ? { keyCode: binding.keyCode } : {}), ...(binding.trigger === 'hold' ? { repeatMs: binding.repeatMs ?? 400, holdDelayMs: binding.holdDelayMs ?? binding.repeatMs ?? 400 } : {}) });

class Engine extends EventEmitter {
  constructor({ config, shortcuts, storage, documents, platform = process.platform, session = 'native', execute = executeAction, desktopActions = {}, now = Date.now }) {
    super();
    this.config = validateConfig(config, platform);
    this.serializedConfig = JSON.stringify(this.config);
    this.configRevision = 0;
    this.stateRevision = 0;
    this.shortcutsAPI = shortcuts;
    this.storage = storage;
    this.documents = documents;
    this.platform = platform;
    this.session = session;
    this.execute = execute;
    this.desktopActions = desktopActions;
    this.now = now;
    this.activeLayerId = this.config.layers[0].id;
    this.manualLayerId = this.activeLayerId;
    this.application = { status: 'off', message: '', current: null };
    this.desktop = { trayAvailable: false };
    this.pendingApplication = false;
    this.previews = new Map();
    this.enabled = false;
    this.armed = false;
    this.editing = false;
    this.registrations = new Map();
    this.failed = [];
    this.events = [];
    this.inFlight = new Set();
    this.lastRun = new Map();
    this.lastPauseControlAt = -Infinity;
    this.tracking = { enabled: false, mode: 'off', message: '' };
    this.input = { mode: 'off', message: '' };
    this.inputGroupCache = new Map();
    this.gestures = new KeyGestures({
      findGroup: event => this.inputGroups().find(group => group.keyCode === event.code && matchesModifiers(event, group.modifiers)),
      isActive: group => this.enabled && !this.editing && this.input.mode === 'global' && this.activeLayerId === group.layerId && this.registrations.has(group.effective),
      run: (group, binding) => this.runInputBinding(group, binding)
    });
  }

  get activeLayer() { return this.config.layers.find(layer => layer.id === this.activeLayerId); }

  state() {
    return structuredClone({ config: this.config, configRevision: this.configRevision, stateRevision: this.stateRevision, activeLayerId: this.activeLayerId, enabled: this.enabled, editing: this.editing, platform: this.platform, session: this.session, paths: { data: this.storage.directory, documents: this.documents, log: this.storage.logPath }, shortcuts: { registered: [...this.registrations.values()], failed: this.failed }, tracking: this.tracking, input: this.input, application: this.application, desktop: this.desktop, events: this.events });
  }

  publish() {
    this.stateRevision++;
    const snapshot = this.state();
    this.emit('state', snapshot);
    return snapshot;
  }

  record(status, message, extra = {}) {
    const event = { id: randomUUID(), time: new Date().toISOString(), kind: 'system', status, message, ...extra };
    this.events.unshift(event);
    this.events.length = Math.min(this.events.length, 100);
    return event;
  }

  setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Estado de ativação inválido.');
    if (this.enabled === enabled) return this.state();
    this.resetInput();
    if (enabled) this.armed = true;
    this.enabled = enabled;
    this.syncShortcuts();
    // Never leave actions active without a working emergency pause.
    const pause = effectiveShortcut(this.config.settings.pauseShortcut, this.platform);
    if (enabled && !this.registrations.has(pause)) {
      this.enabled = false;
      const failures = this.failed;
      this.syncShortcuts();
      this.failed = failures;
      this.record('error', 'Ativação cancelada: o atalho de pausa não está disponível.');
    } else this.record('info', enabled ? 'Atalhos ativados.' : 'Atalhos pausados.');
    return this.publish();
  }

  setEditing(editing) {
    if (typeof editing !== 'boolean') throw new Error('Estado de edição inválido.');
    if (this.editing === editing) return this.state();
    this.resetInput();
    this.editing = editing;
    if (!editing && this.pendingApplication) {
      this.pendingApplication = false;
      this.applyApplication();
    }
    this.syncShortcuts();
    return this.publish();
  }

  setLayer(id) {
    if (!this.config.layers.some(layer => layer.id === id)) throw new Error('Camada não encontrada.');
    if (id !== this.activeLayerId) this.resetInput();
    this.activeLayerId = id;
    this.manualLayerId = id;
    this.pendingApplication = false;
    this.syncShortcuts();
    this.record('info', `Camada ativa: ${this.activeLayer.name}.`);
    return this.publish();
  }

  updateApplication({ status, message = '', current = null }) {
    if (!['off', 'ready', 'unavailable', 'error'].includes(status)) throw new Error('Estado de aplicativo inválido.');
    let identity = null;
    if (status === 'ready' && current) {
      if (typeof current.name !== 'string' || typeof current.path !== 'string' || (current.bundleId !== undefined && typeof current.bundleId !== 'string')) throw new Error('Identidade de aplicativo inválida.');
      identity = { name: current.name.slice(0, 4000), path: current.path.slice(0, 4000), ...(current.bundleId ? { bundleId: current.bundleId.slice(0, 4000) } : {}) };
    }
    const next = this.config.settings.autoSwitchLayers ? { status, message: String(message).slice(0, 500), current: identity } : { status: 'off', message: '', current: null };
    if (JSON.stringify(next) === JSON.stringify(this.application)) return this.state();
    const changed = JSON.stringify(next.current) !== JSON.stringify(this.application.current) || next.status !== this.application.status;
    this.application = structuredClone(next);
    if (changed) {
      if (this.editing) this.pendingApplication = true;
      else { this.applyApplication(); this.syncShortcuts(); }
    }
    return this.publish();
  }

  applyApplication() {
    let id = this.manualLayerId;
    if (this.config.settings.autoSwitchLayers && this.application.status === 'ready' && this.application.current) {
      const current = this.application.current;
      const executable = current.path ? (this.platform === 'win32' ? path.win32 : path.posix).basename(current.path) : null;
      const appBundle = this.platform === 'darwin' ? current.path?.match(/^(.*?\.app)(?:\/|$)/i)?.[1] : null;
      // Full paths/bundles win over exact executable and display names.
      for (const candidate of [current.path, current.bundleId, appBundle, executable, current.name].filter(Boolean)) {
        const identity = applicationIdentity(candidate, this.platform);
        const matched = this.config.layers.find(layer => layer.applications.some(value => applicationIdentity(value, this.platform) === identity));
        if (matched) { id = matched.id; break; }
      }
    }
    if (id !== this.activeLayerId) {
      this.resetInput();
      this.activeLayerId = id;
      this.record('info', `Camada ativa: ${this.activeLayer.name}.`);
    }
  }

  async saveConfig(config) {
    const valid = validateConfig(config, this.platform);
    const serialized = JSON.stringify(valid);
    await this.storage.save(valid);
    this.resetInput();
    const contextRules = value => JSON.stringify([value.settings.autoSwitchLayers, value.layers.map(layer => [layer.id, layer.applications])]);
    const contextChanged = contextRules(this.config) !== contextRules(valid);
    this.config = valid;
    this.inputGroupCache.clear();
    if (serialized !== this.serializedConfig) this.configRevision++;
    this.serializedConfig = serialized;
    this.previews.clear();
    if (!valid.layers.some(layer => layer.id === this.activeLayerId)) this.activeLayerId = valid.layers[0].id;
    if (!valid.layers.some(layer => layer.id === this.manualLayerId)) this.manualLayerId = valid.layers[0].id;
    if (!valid.settings.autoSwitchLayers) this.application = { status: 'off', message: '', current: null };
    if (contextChanged) {
      if (this.editing) this.pendingApplication = true;
      else this.applyApplication();
    }
    const bindingKeys = new Set(valid.layers.flatMap(layer => layer.bindings.map(binding => JSON.stringify([layer.id, binding.id]))));
    for (const key of this.lastRun.keys()) if (key !== 'control:layer' && !bindingKeys.has(key)) this.lastRun.delete(key);
    this.syncShortcuts();
    const pause = effectiveShortcut(this.config.settings.pauseShortcut, this.platform);
    if (this.enabled && !this.registrations.has(pause)) {
      this.enabled = false;
      const failures = this.failed;
      this.syncShortcuts();
      this.failed = failures;
      this.record('error', 'Atalhos pausados: novo atalho de pausa indisponível.');
    }
    return this.publish();
  }

  syncShortcuts() {
    const desired = new Map();
    const unavailable = new Map();
    if (this.armed) {
      const pause = this.config.settings.pauseShortcut;
      desired.set(effectiveShortcut(pause, this.platform), pause);
      if (this.enabled && !this.editing) {
        const cycle = this.config.settings.layerShortcut;
        desired.set(effectiveShortcut(cycle, this.platform), cycle);
        const inputGroups = new Set(this.inputGroups().map(group => group.effective));
        for (const binding of this.activeLayer.bindings) if (binding.enabled) {
          const effective = effectiveShortcut(binding.key, this.platform);
          if (inputGroups.has(effective) && this.input.mode !== 'global') {
            unavailable.set(effective, { key: binding.key, message: this.input.mode === 'unavailable' ? 'Gatilhos de tecla indisponíveis neste ambiente. A combinação não foi reservada.' : 'Aguardando entrada global para reservar esta combinação.' });
          } else desired.set(effective, binding.key);
        }
      }
    }
    for (const [effective, key] of this.registrations) {
      if (!desired.has(effective)) {
        this.shortcutsAPI.unregister(electronShortcut(key));
        this.registrations.delete(effective);
      }
    }
    this.failed = [...unavailable.values()];
    for (const [effective, key] of desired) {
      if (this.registrations.has(effective)) continue;
      let registered = false;
      try { registered = this.shortcutsAPI.register(electronShortcut(key), () => this.handleShortcut(effective)); }
      catch { /* Invalid/unsupported native accelerators are reported below. */ }
      if (registered) this.registrations.set(effective, key);
      else this.failed.push({ key, message: 'Atalho indisponível: conflito, permissão ou restrição do sistema.' });
    }
  }

  handleShortcut(effective) {
    const settings = this.config.settings;
    const isPause = effective === effectiveShortcut(settings.pauseShortcut, this.platform);
    if (isPause) {
      const now = this.now();
      // Pausing is immediate; rapid repeats must not resume a newly paused engine.
      if (!this.enabled && now - this.lastPauseControlAt < PAUSE_RESUME_DEBOUNCE_MS) return;
      this.lastPauseControlAt = now;
      this.setEnabled(!this.enabled);
      return;
    }
    if (!this.enabled || this.editing) return;
    const now = this.now();
    if (effective === effectiveShortcut(settings.layerShortcut, this.platform)) {
      if (now - (this.lastRun.get('control:layer') ?? -Infinity) < settings.cooldownMs) return;
      this.lastRun.set('control:layer', now);
      const index = this.config.layers.findIndex(layer => layer.id === this.activeLayerId);
      const next = this.config.layers[(index + 1) % this.config.layers.length].id;
      this.setLayer(next);
      return;
    }
    const layer = this.activeLayer;
    if (this.inputGroups().some(group => group.effective === effective)) return;
    const binding = layer.bindings.find(binding => binding.enabled && effectiveShortcut(binding.key, this.platform) === effective);
    if (binding) {
      const key = JSON.stringify([layer.id, binding.id]);
      if (now - (this.lastRun.get(key) ?? -Infinity) < settings.cooldownMs) return;
      this.lastRun.set(key, now);
      void this.runBinding(layer.id, binding.id).catch(error => { this.record('error', error.message); this.publish(); });
    }
  }

  needsInput() {
    return this.armed && this.config.layers.some(layer => layer.bindings.some(binding => binding.enabled && ['hold', 'release'].includes(binding.trigger)));
  }

  inputGroups() {
    if (this.inputGroupCache.has(this.activeLayerId)) return this.inputGroupCache.get(this.activeLayerId);
    const grouped = new Map();
    for (const binding of this.activeLayer.bindings) {
      if (!binding.enabled) continue;
      const effective = effectiveShortcut(binding.key, this.platform);
      if (!grouped.has(effective)) grouped.set(effective, { layerId: this.activeLayerId, layerName: this.activeLayer.name, effective, modifiers: shortcutModifiers(effective), bindings: {} });
      const group = grouped.get(effective);
      const trigger = binding.trigger || 'press';
      group.bindings[trigger] = binding;
      if (trigger !== 'press') group.keyCode = binding.keyCode;
    }
    const groups = [...grouped.values()].filter(group => group.bindings.hold || group.bindings.release);
    this.inputGroupCache.set(this.activeLayerId, groups);
    return groups;
  }

  updateInput({ mode, message = '' }) {
    if (!['off', 'starting', 'global', 'unavailable'].includes(mode)) throw new Error('Estado de entrada inválido.');
    if (mode === this.input.mode && message === this.input.message) return this.state();
    if (mode !== 'global') this.resetInput();
    const modeChanged = mode !== this.input.mode;
    this.input = { mode, message: String(message).slice(0, 500) };
    if (modeChanged) this.syncShortcuts();
    return this.publish();
  }

  handleInput(event) { this.gestures.handle(event); }

  resetInput() { this.gestures.reset(); }

  async runInputBinding(group, binding) {
    if (!this.enabled || this.editing || this.input.mode !== 'global' || group.layerId !== this.activeLayerId || !this.registrations.has(group.effective)) return;
    const trigger = binding.trigger || 'press';
    if (trigger === 'hold' && (this.inFlight.has(binding.id) || this.inFlight.size >= 4)) return;
    if (trigger !== 'hold') {
      const key = JSON.stringify([group.layerId, binding.id]);
      const now = this.now();
      if (now - (this.lastRun.get(key) ?? -Infinity) < this.config.settings.cooldownMs) return;
      this.lastRun.set(key, now);
    }
    try { await this.runBinding(group.layerId, binding.id); }
    catch (error) {
      this.record('error', `${binding.name}: ${error.message}`, { kind: 'action', bindingId: binding.id, layer: group.layerName, key: binding.key, ...triggerDetails(binding), durationMs: 0 });
      this.publish();
    }
  }

  findBinding(layerId, bindingId) {
    const layer = this.config.layers.find(layer => layer.id === layerId);
    const binding = layer?.bindings.find(binding => binding.id === bindingId);
    if (!binding) throw new Error('Ação não encontrada.');
    return { layer, binding };
  }

  previewBinding(layerId, bindingId) {
    const { layer, binding } = this.findBinding(layerId, bindingId);
    const now = this.now();
    for (const [id, entry] of this.previews) if (entry.expires <= now) this.previews.delete(id);
    const prepared = freezePreparedAction(prepareAction(binding.action, { key: binding.key, layer: layer.name }, { documents: this.documents, layers: this.config.layers, platform: this.platform }, new Date(now)));
    const previewId = randomUUID();
    const expires = now + 5 * 60 * 1000;
    while (this.previews.size >= 10) this.previews.delete(this.previews.keys().next().value);
    this.previews.set(previewId, { layerId, bindingId, prepared, expires });
    return { previewId, expiresAt: new Date(expires).toISOString(), action: previewAction(prepared) };
  }

  async runBinding(layerId, bindingId, previewId) {
    const { layer, binding } = this.findBinding(layerId, bindingId);
    if (this.inFlight.has(binding.id)) throw new Error('Esta ação ainda está em execução.');
    if (this.inFlight.size >= 4) throw new Error('Limite de quatro ações simultâneas atingido.');
    let prepared;
    if (previewId !== undefined) {
      const preview = this.previews.get(previewId);
      if (preview?.expires <= this.now()) this.previews.delete(previewId);
      if (!preview || preview.expires <= this.now() || preview.layerId !== layerId || preview.bindingId !== bindingId) throw new Error('Prévia inválida ou expirada. Abra uma nova prévia antes de executar.');
      prepared = preview.prepared;
      this.previews.delete(previewId);
    }
    this.inFlight.add(binding.id);
    const started = this.now();
    let httpStatus;
    const steps = [];
    const details = () => ({ kind: 'action', bindingId: binding.id, layer: layer.name, key: binding.key, ...triggerDetails(binding), durationMs: Math.max(0, this.now() - started), ...(httpStatus === undefined ? {} : { httpStatus }), ...(binding.action.type === 'sequence' ? { steps: structuredClone(steps) } : {}) });
    try {
      prepared ??= prepareAction(binding.action, { key: binding.key, layer: layer.name }, { documents: this.documents, layers: this.config.layers, platform: this.platform }, new Date(started));
      const message = await this.execute(binding.action, { key: binding.key, layer: layer.name }, { documents: this.documents, storage: this.storage, platform: this.platform,
        desktopActions: this.desktopActions, setLayer: id => this.setLayer(id), now: this.now, preparedAction: prepared,
        onStep: step => steps.push(step), onHttpStatus: value => { if (Number.isInteger(value) && value >= 100 && value <= 599) httpStatus = value; } });
      const event = this.record('success', `${binding.name}: ${message}`, details());
      try { await this.storage.appendLog(event); }
      catch { this.record('error', 'A ação foi executada, mas não foi possível salvar o histórico em disco.'); }
    } catch (error) {
      // Keep request secrets and content out of the execution history.
      if (binding.action.type === 'http' && Number.isInteger(error.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599) httpStatus = error.httpStatus;
      const failedStep = steps.find(step => step.status === 'error');
      const message = binding.action.type === 'sequence'
        ? failedStep ? `Sequência interrompida na etapa ${failedStep.index} de ${binding.action.steps.length}: ${failedStep.message}` : 'Não foi possível preparar ou executar a sequência.'
        : actionErrorMessage(binding.action.type, error, httpStatus);
      const event = this.record('error', `${binding.name}: ${message}`, details());
      try { await this.storage.appendLog(event); }
      catch { this.record('error', 'Não foi possível salvar o histórico em disco.'); }
    } finally { this.inFlight.delete(binding.id); }
    return this.publish();
  }

  dispose() { this.resetInput(); this.enabled = false; this.armed = false; this.previews.clear(); this.shortcutsAPI.unregisterAll(); this.registrations.clear(); }
}

module.exports = { Engine };
