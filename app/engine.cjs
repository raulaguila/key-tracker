const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { validateConfig, effectiveShortcut, electronShortcut } = require('./config.cjs');
const { executeAction } = require('./actions.cjs');

class Engine extends EventEmitter {
  constructor({ config, shortcuts, storage, documents, platform = process.platform, session = 'native', execute = executeAction }) {
    super();
    this.config = validateConfig(config, platform);
    this.shortcutsAPI = shortcuts;
    this.storage = storage;
    this.documents = documents;
    this.platform = platform;
    this.session = session;
    this.execute = execute;
    this.activeLayerId = this.config.layers[0].id;
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
    return structuredClone({ config: this.config, activeLayerId: this.activeLayerId, enabled: this.enabled, editing: this.editing, platform: this.platform, session: this.session, paths: { data: this.storage.directory, documents: this.documents, log: this.storage.logPath }, shortcuts: { registered: [...this.registrations.values()], failed: this.failed }, tracking: this.tracking, events: this.events });
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
    this.syncShortcuts();
    return this.publish();
  }

  setLayer(id) {
    if (!this.config.layers.some(layer => layer.id === id)) throw new Error('Camada não encontrada.');
    this.activeLayerId = id;
    this.lastRun.clear();
    this.syncShortcuts();
    this.record('info', `Camada ativa: ${this.activeLayer.name}.`);
    return this.publish();
  }

  async saveConfig(config) {
    const valid = validateConfig(config, this.platform);
    await this.storage.save(valid);
    this.config = valid;
    if (!valid.layers.some(layer => layer.id === this.activeLayerId)) this.activeLayerId = valid.layers[0].id;
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
        for (const binding of this.activeLayer.bindings) desired.set(effectiveShortcut(binding.key, this.platform), binding.key);
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
    const binding = this.activeLayer.bindings.find(binding => effectiveShortcut(binding.key, this.platform) === effective);
    if (binding) void this.runBinding(this.activeLayerId, binding.id).catch(error => { this.record('error', error.message); this.publish(); });
  }

  async runBinding(layerId, bindingId) {
    const layer = this.config.layers.find(layer => layer.id === layerId);
    const binding = layer?.bindings.find(binding => binding.id === bindingId);
    if (!binding) throw new Error('Ação não encontrada.');
    if (this.inFlight.has(binding.id)) throw new Error('Esta ação ainda está em execução.');
    if (this.inFlight.size >= 4) throw new Error('Limite de quatro ações simultâneas atingido.');
    this.inFlight.add(binding.id);
    try {
      const message = await this.execute(binding.action, { key: binding.key, layer: layer.name }, { documents: this.documents, storage: this.storage });
      const event = this.record('success', `${binding.name}: ${message}`, { kind: 'action', layer: layer.name, key: binding.key });
      try { await this.storage.appendLog(event); }
      catch { this.record('error', 'A ação foi executada, mas não foi possível salvar o histórico em disco.'); }
    } catch (error) {
      // Keep request secrets and content out of the execution history.
      const message = binding.action.type === 'http' ? error.message : (['EACCES', 'EPERM'].includes(error.code) ? 'Sem permissão para acessar o arquivo.' : error.message);
      const event = this.record('error', `${binding.name}: ${message}`, { kind: 'action', layer: layer.name, key: binding.key });
      try { await this.storage.appendLog(event); }
      catch { this.record('error', 'Não foi possível salvar o histórico em disco.'); }
    } finally { this.inFlight.delete(binding.id); }
    return this.publish();
  }

  dispose() { this.enabled = false; this.armed = false; this.shortcutsAPI.unregisterAll(); this.registrations.clear(); }
}

module.exports = { Engine };
