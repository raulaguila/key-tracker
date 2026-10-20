const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { validateConfig, effectiveShortcut, electronShortcut, applicationIdentity } = require('./config.cjs');
const { executeAction, prepareAction, previewAction } = require('./actions.cjs');

class Engine extends EventEmitter {
  constructor({ config, shortcuts, storage, documents, platform = process.platform, session = 'native', execute = executeAction, now = Date.now }) {
    super();
    this.config = validateConfig(config, platform);
    this.shortcutsAPI = shortcuts;
    this.storage = storage;
    this.documents = documents;
    this.platform = platform;
    this.session = session;
    this.execute = execute;
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
    this.tracking = { enabled: false, mode: 'off', message: '' };
  }

  get activeLayer() { return this.config.layers.find(layer => layer.id === this.activeLayerId); }

  state() {
    return structuredClone({ config: this.config, activeLayerId: this.activeLayerId, enabled: this.enabled, editing: this.editing, platform: this.platform, session: this.session, paths: { data: this.storage.directory, documents: this.documents, log: this.storage.logPath }, shortcuts: { registered: [...this.registrations.values()], failed: this.failed }, tracking: this.tracking, application: this.application, desktop: this.desktop, events: this.events });
  }

  publish() { this.emit('state', this.state()); return this.state(); }

  record(status, message, extra = {}) {
    const event = { id: randomUUID(), time: new Date().toISOString(), kind: 'system', status, message, ...extra };
    this.events.unshift(event);
    this.events.length = Math.min(this.events.length, 100);
    return event;
  }

  setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Estado de ativação inválido.');
    if (this.enabled === enabled) return this.state();
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
    this.activeLayerId = id;
    this.manualLayerId = id;
    this.pendingApplication = false;
    this.lastRun.clear();
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
      this.activeLayerId = id;
      this.lastRun.clear();
      this.record('info', `Camada ativa: ${this.activeLayer.name}.`);
    }
  }

  async saveConfig(config) {
    const valid = validateConfig(config, this.platform);
    await this.storage.save(valid);
    const contextRules = value => JSON.stringify([value.settings.autoSwitchLayers, value.layers.map(layer => [layer.id, layer.applications])]);
    const contextChanged = contextRules(this.config) !== contextRules(valid);
    this.config = valid;
    this.previews.clear();
    if (!valid.layers.some(layer => layer.id === this.activeLayerId)) this.activeLayerId = valid.layers[0].id;
    if (!valid.layers.some(layer => layer.id === this.manualLayerId)) this.manualLayerId = valid.layers[0].id;
    if (!valid.settings.autoSwitchLayers) this.application = { status: 'off', message: '', current: null };
    if (contextChanged) {
      if (this.editing) this.pendingApplication = true;
      else this.applyApplication();
    }
    this.lastRun.clear();
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
    if (this.armed) {
      const pause = this.config.settings.pauseShortcut;
      desired.set(effectiveShortcut(pause, this.platform), pause);
      if (this.enabled && !this.editing) {
        const cycle = this.config.settings.layerShortcut;
        desired.set(effectiveShortcut(cycle, this.platform), cycle);
        for (const binding of this.activeLayer.bindings) if (binding.enabled) desired.set(effectiveShortcut(binding.key, this.platform), binding.key);
      }
    }
    for (const [effective, key] of this.registrations) {
      if (!desired.has(effective)) {
        this.shortcutsAPI.unregister(electronShortcut(key));
        this.registrations.delete(effective);
      }
    }
    this.failed = [];
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
    if (!this.enabled && !isPause) return;
    const now = Date.now();
    if (now - (this.lastRun.get(effective) ?? -Infinity) < settings.cooldownMs) return;
    this.lastRun.set(effective, now);
    if (isPause) { this.setEnabled(!this.enabled); return; }
    if (this.editing) return;
    if (effective === effectiveShortcut(settings.layerShortcut, this.platform)) {
      const index = this.config.layers.findIndex(layer => layer.id === this.activeLayerId);
      const next = this.config.layers[(index + 1) % this.config.layers.length].id;
      this.setLayer(next);
      this.lastRun.set(effective, now);
      return;
    }
    const binding = this.activeLayer.bindings.find(binding => binding.enabled && effectiveShortcut(binding.key, this.platform) === effective);
    if (binding) void this.runBinding(this.activeLayerId, binding.id).catch(error => { this.record('error', error.message); this.publish(); });
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
    const prepared = prepareAction(binding.action, { key: binding.key, layer: layer.name }, { documents: this.documents }, new Date(now));
    Object.values(prepared).filter(value => value && typeof value === 'object').forEach(Object.freeze);
    Object.freeze(prepared);
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
    const details = () => ({ kind: 'action', bindingId: binding.id, layer: layer.name, key: binding.key, durationMs: Math.max(0, this.now() - started), ...(httpStatus === undefined ? {} : { httpStatus }) });
    try {
      prepared ??= prepareAction(binding.action, { key: binding.key, layer: layer.name }, { documents: this.documents }, new Date(started));
      const message = await this.execute(binding.action, { key: binding.key, layer: layer.name }, { documents: this.documents, storage: this.storage, preparedAction: prepared, onHttpStatus: value => { if (Number.isInteger(value) && value >= 100 && value <= 599) httpStatus = value; } });
      const event = this.record('success', `${binding.name}: ${message}`, details());
      try { await this.storage.appendLog(event); }
      catch { this.record('error', 'A ação foi executada, mas não foi possível salvar o histórico em disco.'); }
    } catch (error) {
      // Keep request secrets and content out of the execution history.
      let message = ['EACCES', 'EPERM'].includes(error.code) ? 'Sem permissão para acessar o arquivo.' : error.message;
      if (binding.action.type === 'http') {
        if (Number.isInteger(error.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599) httpStatus = error.httpStatus;
        message = httpStatus ? `Destino respondeu HTTP ${httpStatus}${httpStatus >= 300 && httpStatus < 400 ? '. Redirecionamentos não são seguidos' : ''}.`
          : /^(A requisição excedeu o limite de 10 segundos\.|Não foi possível conectar ao destino HTTP\.)$/.test(error.message) ? error.message : 'Não foi possível concluir a requisição HTTP.';
      }
      const event = this.record('error', `${binding.name}: ${message}`, details());
      try { await this.storage.appendLog(event); }
      catch { this.record('error', 'Não foi possível salvar o histórico em disco.'); }
    } finally { this.inFlight.delete(binding.id); }
    return this.publish();
  }

  dispose() { this.enabled = false; this.armed = false; this.previews.clear(); this.shortcutsAPI.unregisterAll(); this.registrations.clear(); }
}

module.exports = { Engine };
