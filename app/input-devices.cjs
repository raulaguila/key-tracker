const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { keyboardCode } = require('./linux-keycodes.cjs');

function deviceId(raw, platform) { return platform + ':' + createHash('sha256').update(raw).digest('hex').slice(0, 40); }
function hidCode(usage) {
  if (usage >= 4 && usage <= 29) return 'Key' + String.fromCharCode(65 + usage - 4);
  if (usage >= 30 && usage <= 38) return 'Digit' + (usage - 29);
  if (usage >= 58 && usage <= 69) return 'F' + (usage - 57);
  if (usage >= 104 && usage <= 115) return 'F' + (usage - 91);
  if (usage >= 89 && usage <= 97) return 'Numpad' + (usage - 88);
  return ({39:'Digit0',40:'Enter',41:'Escape',42:'Backspace',43:'Tab',44:'Space',45:'Minus',46:'Equal',47:'BracketLeft',48:'BracketRight',49:'Backslash',50:'Backslash',51:'Semicolon',52:'Quote',53:'Backquote',54:'Comma',55:'Period',56:'Slash',57:'CapsLock',70:'PrintScreen',71:'ScrollLock',72:'Pause',73:'Insert',74:'Home',75:'PageUp',76:'Delete',77:'End',78:'PageDown',79:'ArrowRight',80:'ArrowLeft',81:'ArrowDown',82:'ArrowUp',83:'NumLock',84:'NumpadDivide',85:'NumpadMultiply',86:'NumpadSubtract',87:'NumpadAdd',88:'NumpadEnter',98:'Numpad0',99:'NumpadDecimal',100:'IntlBackslash',101:'ContextMenu',103:'NumpadEqual',133:'NumpadComma',135:'IntlRo',137:'IntlYen',224:'ControlLeft',225:'ShiftLeft',226:'AltLeft',227:'MetaLeft',228:'ControlRight',229:'ShiftRight',230:'AltRight',231:'MetaRight'})[usage];
}
function windowsCode(scan, extended, e1, virtualKey) {
  if (Number.isInteger(virtualKey) && virtualKey >= 0x7c && virtualKey <= 0x87) return 'F' + (virtualKey - 0x7c + 13);
  if (e1) return scan === 0x45 || scan === 0x1d ? 'Pause' : undefined;
  if (extended) return ({0x1c:'NumpadEnter',0x1d:'ControlRight',0x35:'NumpadDivide',0x37:'PrintScreen',0x38:'AltRight',0x47:'Home',0x48:'ArrowUp',0x49:'PageUp',0x4b:'ArrowLeft',0x4d:'ArrowRight',0x4f:'End',0x50:'ArrowDown',0x51:'PageDown',0x52:'Insert',0x53:'Delete',0x5b:'MetaLeft',0x5c:'MetaRight',0x5d:'ContextMenu'})[scan];
  if (scan >= 0x64 && scan <= 0x6e) return 'F' + (scan - 0x64 + 13);
  if (scan === 0x76) return 'F24';
  if (scan === 0x73) return 'IntlRo';
  if (scan === 0x7d) return 'IntlYen';
  if (scan === 0x7e) return 'NumpadComma';
  if (scan === 0x59) return 'NumpadEqual';
  // PC set-1 codes coincide with evdev positions through the basic 0x58 block.
  return keyboardCode(scan);
}
const flags = codes => ({ ctrlKey: codes.has('ControlLeft') || codes.has('ControlRight'), altKey: codes.has('AltLeft') || codes.has('AltRight'), shiftKey: codes.has('ShiftLeft') || codes.has('ShiftRight'), metaKey: codes.has('MetaLeft') || codes.has('MetaRight') });

class NativeInput extends EventEmitter {
  constructor({ platform = process.platform, spawnClient = spawn, executable = path.join(__dirname, 'native-input', platform === 'win32' ? 'dobra-input.exe' : 'dobra-input').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1'), now = () => Number(process.hrtime.bigint()) / 1e6, startupMs = 5000 } = {}) {
    super(); Object.assign(this, { platform, spawnClient, executable, now, startupMs });
    this.autoEnable = true; this.status = 'disabled'; this.devices = []; this.rawDevices = new Map(); this.held = new Map(); this.observed = new Map(); this.selectedId = ''; this.child = null; this.disposed = false; this.retiring = new Set(); this.failure = false; this.blocked = new Map(); this.initialBlocked = new Set();
  }
  state() { return { supported: true, enabled: Boolean(this.child), status: this.status, message: this.deviceState().message }; }
  deviceState() {
    const messages = { disabled:'Ative as ações ou o Rastreio para listar os teclados.', authorizing:'Iniciando observação passiva dos teclados…', global:'Teclado selecionado observado sem bloquear outros aplicativos.', waiting:'Nenhum teclado disponível.', missing:'O teclado selecionado está desconectado. Reconecte e ative as ações explicitamente.', unavailable: this.platform === 'darwin' ? 'Entrada indisponível. Autorize Dobra em Privacidade e Segurança → Monitoramento de Entrada e tente novamente.' : 'Componente de entrada indisponível. Reinstale o pacote e ative novamente para tentar.' };
    return { supported: true, devices: this.devices.map(({id,name}) => ({id,name})), selectedId: this.selectedId, status: this.status, message: messages[this.status] || messages.unavailable };
  }
  publish(status = this.status) { this.status = status; this.emit('state', this.state()); }
  update({config, observe}) {
    const selected = config.settings.inputDeviceId || '';
    if (selected !== this.selectedId) {
      this.selectedId = selected;
      this.emit('interrupted'); this.reset(); this.blockObserved();
      if (this.child && this.status !== 'authorizing') this.publish(this.mode());
    }
    this.observe = observe;
    if (observe && !this.child && !this.failure && !this.disposed) this.start();
    if (!observe && this.child) void this.disable();
  }
  retry() { this.failure = false; if (this.observe && !this.child && !this.disposed) this.start(); }
  mode() { return this.selectedId && !this.devices.some(device => device.id === this.selectedId) ? 'missing' : this.devices.length ? 'global' : 'waiting'; }
  reset() { this.held.clear(); this.emit('reset', []); }
  blockedModifier() {
    const modifier = code => /^(Control|Alt|Shift|Meta)(Left|Right)$/.test(code);
    return [...this.initialBlocked].some(modifier) || [...this.blocked].some(([id, codes]) =>
      (!this.selectedId || this.selectedId === id) && [...codes].some(modifier));
  }
  blockObserved() {
    for (const [id, codes] of this.observed) if (!this.selectedId || this.selectedId === id) {
      const blocked = this.blocked.get(id) || new Set();
      for (const code of codes) blocked.add(code);
      this.blocked.set(id, blocked);
    }
  }
  start() {
    try {
      const child = this.spawnClient(this.executable, [], { stdio:['pipe','pipe','ignore'], windowsHide:true });
      this.child = child; this.publish('authorizing');
      const decoder = new StringDecoder('utf8');
      let buffer = '';
      child.stdout.on('data', chunk => {
        if (this.child !== child || this.disposed) return;
        buffer += decoder.write(chunk);
        if (buffer.length > 65536) return this.fail();
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0,end); buffer = buffer.slice(end+1);
          try { this.receive(JSON.parse(line)); } catch { this.fail(); return; }
          if (this.child !== child) return;
        }
      });
      child.on('error', () => { if (this.child === child) this.fail(); });
      child.on('exit', () => { if (this.child === child) this.fail(); });
      child.stdin.on('error', () => { if (this.child === child) this.fail(); });
      this.timer = setTimeout(() => this.fail(), this.startupMs); this.timer.unref?.();
    } catch { this.fail(); }
  }
  receive(event) {
    if (event.type === 'ready' && Number.isFinite(event.monotonicMs)) {
      // Helpers use the same OS counter as libuv hrtime; never recalibrate
      // an already queued ready/key stream into apparently fresh input.
      if (Math.abs(this.now() - event.monotonicMs) > 1000) { this.fail(); return; }
      this.offset = 0; clearTimeout(this.timer); this.publish(this.mode()); return;
    }
    if (event.type === 'devices' && Array.isArray(event.devices) && event.devices.length <= 32) {
      const raw = new Map();
      for (const device of event.devices) {
        if (typeof device.id !== 'string' || !device.id.length || device.id.length > 4096 || typeof device.name !== 'string' || device.name.length > 256 || raw.has(device.id)) throw new Error('Invalid device');
        raw.set(device.id, { id:deviceId(device.id,this.platform), name:device.name.replace(/[\x00-\x1f\x7f]/g,'').slice(0,120) || 'Teclado' });
      }
      const previous = new Set(this.devices.map(device=>device.id));
      this.rawDevices = raw; this.devices = [...raw.values()];
      const current = new Set(this.devices.map(device=>device.id));
      const changed = this.selectedId ? previous.has(this.selectedId) !== current.has(this.selectedId)
        : previous.size !== current.size || [...previous].some(id=>!current.has(id));
      if (changed) {
        if (previous.size) this.emit('interrupted');
        this.reset(); this.blockObserved();
      }
      for (const id of this.observed.keys()) if (!current.has(id)) this.observed.delete(id);
      if (this.offset !== undefined) this.publish(this.mode());
      return;
    }
    if (event.type === 'baseline' && Array.isArray(event.keys) && event.keys.length <= 256) {
      const blocked = new Set();
      for (const item of event.keys) {
        if (!Number.isInteger(item.code)) throw new Error('Invalid initial state');
        const code = this.platform === 'win32' ? windowsCode(item.code, Boolean(item.extended), Boolean(item.e1), item.virtualKey) : hidCode(item.code);
        if (code) blocked.add(code);
      }
      if (event.device === undefined && this.platform === 'win32') this.initialBlocked = blocked;
      else {
        const device = this.rawDevices.get(event.device);
        if (!device) throw new Error('Unknown initial device');
        this.blocked.set(device.id, blocked);
      }
      return;
    }
    if (event.type === 'error') { this.fail(); return; }
    if (event.type !== 'key' || this.offset === undefined || !Number.isInteger(event.code) || typeof event.down !== 'boolean' || !Number.isFinite(event.monotonicMs) || !this.rawDevices.has(event.device)) throw new Error('Invalid input event');
    if (Math.abs(this.now() - (event.monotonicMs + this.offset)) > 1000) { this.fail(); return; }
    const device = this.rawDevices.get(event.device);
    const code = this.platform === 'win32' ? windowsCode(event.code,Boolean(event.extended),Boolean(event.e1),event.virtualKey) : hidCode(event.code);
    if (!code) return;
    const observed = this.observed.get(device.id) || new Set();
    observed[event.down ? 'add' : 'delete'](code); this.observed.set(device.id, observed);
    const blocked = this.blocked.get(device.id);
    if (this.initialBlocked.has(code) || blocked?.has(code)) {
      if (!event.down) {
        if (event.globallyDown === false) this.initialBlocked.delete(code);
        blocked?.delete(code);
      }
      return;
    }
    if (this.selectedId && device.id !== this.selectedId) return;
    if (this.status !== 'global') return;
    if (event.down && this.blockedModifier()) {
      const suppressed = this.blocked.get(device.id) || new Set();
      suppressed.add(code); this.blocked.set(device.id, suppressed);
      return;
    }
    const keys = this.held.get(device.id) || new Set(); this.held.set(device.id, keys);
    if (keys.has(code) === event.down) return;
    keys[event.down ? 'add' : 'delete'](code);
    const aggregate = new Set([...this.held.values()].flatMap(value=>[...value]));
    if (!event.down && aggregate.has(code)) return;
    if (event.down && [...this.held].some(([id,value])=>id!==device.id && value.has(code))) return;
    this.emit('key',{code,key:code,direction:event.down?'down':'up',...flags(aggregate),source:'global',monotonicMs:event.monotonicMs});
  }
  fail() { this.failure = true; this.emit('interrupted'); this.reset(); this.retire(); this.devices=[]; this.rawDevices.clear(); this.publish('unavailable'); }
  retire() {
    clearTimeout(this.timer); const child=this.child; this.child=null; this.offset=undefined; this.blocked.clear(); this.initialBlocked.clear(); this.observed.clear();
    if (!child) return Promise.resolve();
    const pending = new Promise(resolve=> {
      const done=()=>{clearTimeout(timer);child.off('exit',done);resolve();};
      const timer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}done();},1000); timer.unref?.();
      child.once('exit',done); try{child.stdin.end();child.kill();}catch{done();}
      if (child.exitCode !== null && child.exitCode !== undefined) done();
    });
    this.retiring.add(pending); void pending.finally(()=>this.retiring.delete(pending)); return pending;
  }
  async disable() { this.reset(); await this.retire(); this.devices=[]; this.rawDevices.clear(); this.publish('disabled'); }
  suspend() { this.fail(); }
  async dispose() { this.disposed=true; await this.disable(); await Promise.all([...this.retiring]); }
}
module.exports = { NativeInput, deviceId, hidCode, windowsCode };
