const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const path = require('node:path');
const { effectiveShortcut } = require('../config.cjs');

function macroError(code = 'MACRO_UNAVAILABLE') { return Object.assign(new Error(code), { code }); }
function unpack(value) { return value.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1'); }

// Own both transports so no hook or injection helper can outlive its operation.
class NativeMacroDriver {
  constructor({ platform = process.platform, spawnImpl = spawn, fork, accessibility, onInput, onStop, onError, requestMs = 4000, stopShortcut = 'Control+Shift+F10', stopGeneration = 1 } = {}) {
    Object.assign(this, { platform, spawnImpl, fork, accessibility, onInput, onStop, onError, requestMs, stopShortcut, stopGeneration });
    this.requests = new Map(); this.counter = 0; this.disposed = false;
  }
  async authorize({ prompt = false } = {}) {
    if (this.disposed) throw macroError();
    if (this.platform === 'darwin') {
      const check = this.accessibility || (value => require('electron').systemPreferences.isTrustedAccessibilityClient(value));
      if (!check(prompt)) throw macroError('MACRO_PERMISSION');
    }
    await this.startPointer(prompt);
    if (this.disposed) throw macroError('MACRO_STOPPED');
    await this.startHook();
    return { playback: true, recording: true };
  }
  async startPointer(prompt = false) {
    if (this.disposed) throw macroError('MACRO_STOPPED');
    if (this.pointerReady) return;
    if (this.pointerStartup) return this.pointerStartup;
    this.pointerStartup = new Promise((resolve, reject) => {
      let child;
      try {
        const executable = this.platform === 'linux' ? '/usr/bin/python3' : unpack(path.join(__dirname, '..', 'native-input', this.platform === 'win32' ? 'dobra-macro.exe' : 'dobra-macro'));
        const args = this.platform === 'linux' ? ['-I', '-B', unpack(path.join(__dirname, 'x11.py'))] : this.platform === 'darwin' && prompt ? ['--authorize'] : [];
        child = this.spawnImpl(executable, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
        this.pointer = child;
      } catch { reject(macroError()); return; }
      const timer = setTimeout(() => this.fail(macroError()), this.requestMs); timer.unref?.();
      this.pointerReject = error => { clearTimeout(timer); reject(error); };
      const decoder = new StringDecoder('utf8'); let buffer = '';
      child.stdout.on('data', chunk => {
        if (this.disposed || this.pointer !== child) return;
        buffer += decoder.write(chunk);
        if (buffer.length > 8192) { this.fail(macroError()); return; }
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          let message; try { message = JSON.parse(line); } catch { this.fail(macroError()); return; }
          if (message?.type === 'ready' && !this.pointerReady) {
            clearTimeout(timer); this.pointerReject = null; this.pointerReady = true; resolve();
          } else if (message?.type === 'error') this.fail(macroError(message.code === 'MACRO_PERMISSION' ? message.code : 'MACRO_UNAVAILABLE'));
          else if (message?.type === 'result') this.result(message);
          else { this.fail(macroError()); return; }
        }
      });
      child.stdin.on('error', () => { if (!this.disposed) this.fail(macroError()); });
      child.on('error', () => this.fail(macroError()));
      child.on('exit', () => { if (!this.disposed) this.fail(macroError()); });
    });
    return this.pointerStartup;
  }
  async startHook() {
    if (this.disposed) throw macroError('MACRO_STOPPED');
    if (this.hookReady) return;
    if (this.hookStartup) return this.hookStartup;
    this.hookStartup = new Promise((resolve, reject) => {
      let worker;
      try {
        const fork = this.fork || ((...args) => require('electron').utilityProcess.fork(...args));
        worker = fork(path.join(__dirname, 'hook-worker.cjs'), [], { serviceName: 'Dobra Macro Input', stdio: 'ignore' }); this.hook = worker;
      } catch { reject(macroError()); return; }
      const timer = setTimeout(() => this.fail(macroError()), this.requestMs); timer.unref?.();
      this.hookReject = error => { clearTimeout(timer); reject(error); };
      worker.on('message', message => {
        if (this.disposed || this.hook !== worker) return;
        if (message?.type === 'ready' && !this.hookReady) { clearTimeout(timer); this.hookReject = null; this.hookReady = true; resolve(); }
        else if (message?.type === 'result') this.result(message);
        else if (message?.type === 'input') { if (this.recording) this.onInput?.(message.step); }
        else if (message?.type === 'stop') {
          if (message.key === this.stopShortcut && message.generation === this.stopGeneration) this.onStop?.({ key: message.key, generation: message.generation });
        }
        else this.fail(macroError());
      });
      worker.on('exit', () => { if (!this.disposed) this.fail(macroError()); });
      worker.on('error', () => { if (!this.disposed) this.fail(macroError()); });
    });
    return this.hookStartup;
  }
  result(message) {
    if (!Number.isInteger(message.id) || typeof message.ok !== 'boolean') { this.fail(macroError()); return; }
    const pending = this.requests.get(message.id); if (!pending) return;
    this.requests.delete(message.id); clearTimeout(pending.timer);
    message.ok ? pending.resolve(message) : pending.reject(macroError(['MACRO_COORDINATES', 'MACRO_PERMISSION'].includes(message.code) ? message.code : 'MACRO_UNAVAILABLE'));
  }
  request(target, value) {
    if (this.disposed) return Promise.reject(macroError());
    return new Promise((resolve, reject) => {
      const id = ++this.counter;
      const timer = setTimeout(() => { this.requests.delete(id); reject(macroError()); this.fail(macroError()); }, this.requestMs); timer.unref?.();
      this.requests.set(id, { resolve, reject, timer });
      try {
        if (target === 'hook') this.hook.postMessage({ ...value, id });
        else this.pointer.stdin.write(id + ' ' + value + '\n');
      } catch { this.fail(macroError()); }
    });
  }
  async click({ x, y, button, clicks }) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) > 100000 || Math.abs(y) > 100000 || !['left', 'middle', 'right'].includes(button) || ![1, 2].includes(clicks)) throw macroError('MACRO_COORDINATES');
    await this.request('pointer', `click ${x} ${y} ${{ left: 1, middle: 2, right: 3 }[button]} ${clicks}`);
  }
  async key(key) {
    const normalized = effectiveShortcut(key, this.platform);
    if (normalized === this.stopShortcut) throw macroError('MACRO_STOPPED');
    await this.request('hook', { type: 'key', key: normalized });
  }
  invalidateStop(key, generation) {
    this.stopShortcut = effectiveShortcut(key, this.platform);
    this.stopGeneration = generation;
  }
  async setStopShortcut(key, { generation = this.stopGeneration + 1 } = {}) {
    this.invalidateStop(key, generation);
    if (this.hookReady && (this.configuredStop !== this.stopShortcut || this.configuredGeneration !== generation)) {
      await this.request('hook', { type: 'stop-shortcut', key: this.stopShortcut, generation });
      this.configuredStop = this.stopShortcut; this.configuredGeneration = generation;
    }
  }
  async released() { return (await this.request('pointer', 'released')).released === true; }
  async startRecording() { this.recording = true; await this.request('hook', { type: 'record', enabled: true }); }
  async stopRecording() {
    this.recording = false;
    if (this.hookReady && !this.disposed) await this.request('hook', { type: 'record', enabled: false });
  }
  fail(error) {
    if (this.disposed || this.failed) return;
    this.failed = true;
    this.pointerReject?.(error); this.hookReject?.(error);
    for (const pending of this.requests.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.requests.clear();
    void this.dispose();
    this.onError?.(error);
  }
  async dispose() {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true; this.recording = false;
    const error = macroError('MACRO_STOPPED');
    this.pointerReject?.(error); this.hookReject?.(error);
    for (const pending of this.requests.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.requests.clear();
    const retire = (child, hook) => new Promise(resolve => {
      if (!child || child.exitCode !== null && child.exitCode !== undefined) { resolve(); return; }
      const finish = () => { clearTimeout(timer); child.off('exit', finish); resolve(); };
      const timer = setTimeout(() => { try { child.kill(); } catch { /* Already exited. */ } finish(); }, 1000); timer.unref?.();
      child.once('exit', finish);
      try { hook ? child.postMessage('stop') : child.stdin.end(); } catch { finish(); }
    });
    this.disposePromise = Promise.all([retire(this.pointer, false), retire(this.hook, true)]);
    await this.disposePromise;
  }
}
module.exports = { NativeMacroDriver, macroError };
