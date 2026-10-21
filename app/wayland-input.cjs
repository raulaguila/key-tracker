const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const path = require('node:path');
const { keyboardCode, linuxCode } = require('./linux-keycodes.cjs');
const { referenceCode } = require('./passive-shortcuts.cjs');
const { effectiveShortcut } = require('./config.cjs');

const messages = {
  disabled: 'Integração com Wayland desabilitada. Habilite nas configurações para observar teclas de outros aplicativos.',
  authorizing: 'Aguardando autorização do sistema para observar os teclados nesta sessão…',
  idle: 'Integração autorizada. Ative as ações ou o Rastreio para observar o teclado.',
  global: 'Observação global no Wayland ativa. As teclas continuam funcionando nos outros aplicativos.',
  waiting: 'Integração autorizada, aguardando um teclado disponível nesta sessão.',
  'not-installed': 'Componente Linux não instalado. Instale ou atualize o pacote .deb do Dobra. O AppImage também precisa desse componente no sistema.',
  'runtime-missing': 'Instale as dependências do componente Linux: Python 3, PyGObject e bibliotecas GIO.',
  denied: 'Autorização cancelada ou negada. Habilite novamente quando desejar permitir a observação.',
  busy: 'Já existe uma conexão de teclado para este usuário. Feche a outra instância antes de habilitar.',
  'version-mismatch': 'O componente Linux é incompatível. Atualize o pacote .deb do Dobra.',
  'session-suspended': 'Observação encerrada ao bloquear, suspender ou trocar de sessão. Habilite novamente para retomar.',
  delayed: 'A entrada ficou atrasada e foi interrompida para evitar ações antigas. Habilite novamente para retomar.',
  unavailable: 'Não foi possível observar os teclados. Verifique o componente Linux, as permissões e a sessão local ativa.'
};
class WaylandInput extends EventEmitter {
  constructor({ spawnClient = spawn, clientPath = path.join(__dirname, 'linux-input', 'client.py').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1'), timeoutMs = 100000, now = () => Number(process.hrtime.bigint()) / 1000000 } = {}) {
    super(); Object.assign(this, { spawnClient, clientPath, timeoutMs, now });
    this.status = 'disabled'; this.connected = false; this.child = null; this.retiring = new Set();
    this.configuration = JSON.stringify({ type: 'configure', keys: [], visual: false, observe: false });
    this.disposed = false; this.devices = 0; this.deviceList = []; this.selectedId = ""; this.selectionReady = true;
  }
  state() { return { supported: true, enabled: this.connected, status: this.connected && !this.selectionReady ? 'authorizing' : this.status, keyboards: this.devices, message: messages[this.status] || messages.unavailable }; }
  deviceState() { return { supported: true, devices: this.deviceList.map(device => ({ ...device })), selectedId: this.selectedId,
    status: this.selectedId && this.connected && !this.deviceList.some(device => device.id === this.selectedId) ? 'missing' : this.status,
    message: this.selectedId && this.connected && !this.deviceList.some(device => device.id === this.selectedId) ? 'O teclado selecionado não está disponível. Reconecte e ative as ações explicitamente.' : this.state().message }; }
  publish(status) { this.status = status; this.emit('state', this.state()); }
  update({ config, observe, visual }) {
    if (this.lastConfig === config && this.observe === observe && this.visual === visual) return;
    const selectedId = config.settings.inputDeviceId || '';
    if (selectedId !== this.selectedId) { this.selectedId = selectedId; this.selectionReady = false; this.emit('interrupted'); this.emit('reset', []); }
    this.lastConfig = config; this.observe = observe; this.visual = visual;
    const keys = new Set();
    if (observe) {
      const add = (key, code) => { const value = linuxCode(code || referenceCode(effectiveShortcut(key, 'linux').split('+').at(-1))); if (value) keys.add(value); };
      add(config.settings.pauseShortcut); add(config.settings.layerShortcut);
      add(config.settings.panelShortcut || 'CommandOrControl+Shift+Space');
      if (config.settings.momentaryShortcut) add(config.settings.momentaryShortcut);
      for (const layer of config.layers) for (const binding of layer.bindings) if (binding.enabled) add(binding.key, binding.keyCode);
    }
    this.configuration = JSON.stringify({ type: 'configure', keys: [...keys].sort((a, b) => a - b), visual: Boolean(visual), observe: Boolean(observe), selectedId: this.selectedId });
    if (this.connected) this.sendConfiguration();
  }
  sendConfiguration() {
    if (!this.child || this.sent === this.configuration) return;
    this.sent = this.configuration;
    if (!this.child.stdin.write(this.configuration + '\n')) this.fail('unavailable');
  }
  enable() {
    if (this.disposed) return Promise.reject(new Error('O aplicativo está encerrando.'));
    if (this.connected) return Promise.resolve(this.state());
    if (this.pending) return this.pending.promise;
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    this.pending = { promise, resolve, reject };
    this.publish('authorizing');
    try {
      const child = this.spawnClient('/usr/bin/python3', ['-I', '-B', this.clientPath], {
        stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, DBUS_SYSTEM_BUS_ADDRESS: 'unix:path=/run/dbus/system_bus_socket' }
      });
      this.child = child; this.sent = null;
      const decoder = new StringDecoder('utf8');
      let buffer = '';
      child.stdout.on('data', chunk => {
        if (this.child !== child) return;
        buffer += decoder.write(chunk);
        if (buffer.length > 65536) { this.fail('unavailable'); return; }
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          try { this.receive(JSON.parse(line)); } catch { this.fail('unavailable'); return; }
          if (this.child !== child) return;
        }
      });
      child.stdin.on('error', () => { if (this.child === child) this.fail('unavailable'); });
      child.on('error', () => { if (this.child === child) this.fail('runtime-missing'); });
      child.on('exit', () => { if (this.child === child) this.fail('unavailable'); });
      this.timer = setTimeout(() => this.fail('denied'), this.timeoutMs); this.timer.unref?.();
      this.sendConfiguration();
    } catch { this.fail('runtime-missing'); }
    return promise;
  }
  receive(event) {
    if (!event || typeof event !== 'object') throw new Error('Invalid input message');
    if (event.type === 'authorizing') return;
    if (event.type === 'connected') {
      clearTimeout(this.timer); this.connected = true; this.publish('idle');
      const pending = this.pending; this.pending = null; pending?.resolve(this.state());
      this.sendConfiguration();
    } else if (event.type === 'devices' && this.connected && Array.isArray(event.devices) && event.devices.length <= 32) {
      const seen = new Set();
      for (const device of event.devices) {
        if (typeof device.id !== 'string' || !/^linux:[a-f0-9]{40}$/.test(device.id) || seen.has(device.id) || typeof device.name !== 'string' || device.name.length > 120 || /[\x00-\x1f\x7f]/.test(device.name)) throw new Error('Invalid device');
        seen.add(device.id);
      }
      if (event.selectedId !== this.selectedId) return; // Configuration acknowledgment from an older selection.
      if (this.deviceList.some(device => (!this.selectedId || device.id === this.selectedId) && !seen.has(device.id))) { this.emit('interrupted'); this.emit('reset', []); }
      this.selectionReady = true;
      this.deviceList = event.devices.map(({id,name}) => ({id,name}));
      this.publish(this.status);
    } else if (event.type === 'status' && this.connected && ['idle', 'global', 'waiting'].includes(event.mode) && Number.isInteger(event.keyboards) && event.keyboards >= (event.mode === 'global' ? 1 : 0) && event.keyboards <= 32) {
      this.devices = event.keyboards;
      this.publish(event.mode);
    } else if (event.type === 'reset' && this.connected && Array.isArray(event.held) && event.held.length <= 256 && event.held.every(code => Number.isInteger(code) && code > 0 && code <= 255)) {
      this.emit('reset', event.held.map(keyboardCode).filter(Boolean));
    } else if (event.type === 'key' && this.connected && this.selectionReady && this.status === 'global' && Number.isInteger(event.code) && typeof event.down === 'boolean' && Number.isInteger(event.modifiers) && event.modifiers >= 0 && event.modifiers <= 15) {
      // A stalled client must never replay its pipe backlog as fresh actions.
      const age = this.now() - event.monotonicMs;
      if (!Number.isFinite(event.monotonicMs) || !Number.isFinite(age) || Math.abs(age) > 1000) { this.fail('delayed'); return; }
      const code = keyboardCode(event.code); if (!code) return;
      this.emit('key', { code, key: code, direction: event.down ? 'down' : 'up', ctrlKey: Boolean(event.modifiers & 1), altKey: Boolean(event.modifiers & 2), shiftKey: Boolean(event.modifiers & 4), metaKey: Boolean(event.modifiers & 8), source: 'global' });
    } else if (event.type === 'key' && this.connected && !this.selectionReady) {
      return;
    } else if (['error', 'ended'].includes(event.type)) {
      this.fail(Object.hasOwn(messages, event.reason) ? event.reason : 'unavailable');
    } else throw new Error('Invalid input message');
  }
  fail(reason) {
    const connected = this.connected; this.connected = false; this.devices = 0; this.deviceList = [];
    clearTimeout(this.timer);
    const child = this.child; this.child = null;
    if (child) this.retire(child);
    const pending = this.pending; this.pending = null;
    pending?.reject(new Error(messages[reason] || messages.unavailable));
    this.publish(reason);
    if (connected) this.emit('interrupted');
  }
  retire(child) {
    const promise = new Promise(resolve => {
      const finish = () => { clearTimeout(timer); child.off('exit', finish); resolve(); };
      const timer = setTimeout(() => { child.kill('SIGKILL'); finish(); }, 1000); timer.unref?.();
      child.once('exit', finish);
      child.stdin.end(); child.kill('SIGTERM');
      if (child.exitCode !== null && child.exitCode !== undefined) finish();
    });
    this.retiring.add(promise); void promise.finally(() => this.retiring.delete(promise));
    return promise;
  }
  async disable() { this.fail('disabled'); await Promise.all([...this.retiring]); return this.state(); }
  suspend() { this.fail('session-suspended'); }
  async dispose() { this.disposed = true; return this.disable(); }
}
module.exports = { WaylandInput };
