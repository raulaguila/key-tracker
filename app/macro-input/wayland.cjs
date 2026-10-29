const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const path = require('node:path');
const { effectiveShortcut } = require('../config.cjs');

const messages = {
  'runtime-missing': 'A reprodução no Wayland precisa de Python 3, PyGObject e GIO. Instale as dependências do pacote Linux e autorize novamente.',
  unavailable: 'O ambiente Wayland não disponibilizou o portal de controle de teclado, mouse e monitores. Verifique o portal do seu ambiente gráfico e autorize novamente.',
  denied: 'A autorização de mouse, teclado ou monitor foi cancelada ou negada. Seu fluxo continua no editor; autorize novamente para testar.',
  revoked: 'O compartilhamento de controle do desktop foi encerrado. Seu fluxo foi preservado; autorize novamente antes de executar.',
  'geometry-missing': 'O portal não informou a posição e o tamanho dos monitores. Não é possível reproduzir cliques com coordenadas seguras neste compositor.',
  coordinates: 'A posição do clique está fora dos monitores autorizados. Revise as coordenadas ou autorize o monitor correspondente.',
  timeout: 'O portal de controle do desktop não respondeu a tempo. A sessão foi encerrada; autorize novamente.',
  protocol: 'A integração de controle do desktop foi interrompida. Autorize novamente antes de executar.',
  'permission-required': 'Autorize o controle de mouse, teclado e monitores antes de executar este fluxo no Wayland.',
  busy: 'Já existe uma operação de controle do desktop em andamento.',
  cancelled: 'Execução cancelada.'
};
const readyMessage = 'Controle de mouse e teclado autorizado nos monitores selecionados. Este compositor não oferece gravação passiva global; adicione ou edite as etapas no editor.';

function failure(reason) {
  const error = new Error(messages[reason] || messages.unavailable);
  error.code = reason === 'cancelled' ? 'EXECUTION_CANCELLED' : 'MACRO_' + reason.toUpperCase().replaceAll('-', '_');
  return error;
}

/** Session-scoped portal owner. It never falls back to XWayland input. */
class WaylandMacroDriver {
  constructor({ spawnImpl = spawn, onError = () => {}, helperPath = path.join(__dirname, 'wayland.py').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1'), authorizeTimeoutMs = 125000, operationTimeoutMs = 8000 } = {}) {
    Object.assign(this, { spawnImpl, onError, helperPath, authorizeTimeoutMs, operationTimeoutMs });
    this.child = null; this.pending = null; this.authorized = false; this.nextId = 0; this.retiring = new Set(); this.disposed = false;
  }
  authorize({ signal } = {}) {
    if (this.disposed) return Promise.reject(failure('unavailable'));
    if (this.authorized) return Promise.resolve({ playback: true, recording: false, message: readyMessage });
    if (this.pending) return this.pending.op === 'authorize' ? this.pending.promise : Promise.reject(failure('busy'));
    return this.request('authorize', {}, { signal, timeoutMs: this.authorizeTimeoutMs });
  }
  click(step, { signal } = {}) {
    if (!Number.isInteger(step?.x) || Math.abs(step.x) > 100000 || !Number.isInteger(step?.y) || Math.abs(step.y) > 100000 || !['left', 'right', 'middle'].includes(step.button) || ![1, 2].includes(step.clicks)) return Promise.reject(failure('protocol'));
    return this.input('click', { x: step.x, y: step.y, button: step.button, clicks: step.clicks }, signal);
  }
  key(accelerator, { signal } = {}) {
    let key;
    try { key = effectiveShortcut(accelerator, 'linux'); } catch { return Promise.reject(failure('protocol')); }
    return this.input('key', { key }, signal);
  }
  input(op, payload, signal) {
    if (!this.authorized || this.disposed) return Promise.reject(failure('permission-required'));
    return this.request(op, payload, { signal, timeoutMs: this.operationTimeoutMs });
  }
  launch() {
    const child = this.spawnImpl('/usr/bin/python3', ['-I', '-B', this.helperPath], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env } });
    this.child = child;
    const decoder = new StringDecoder('utf8'); let buffer = '';
    child.stdout.on('data', chunk => {
      if (this.child !== child) return;
      buffer += decoder.write(chunk);
      if (Buffer.byteLength(buffer) > 8192) { this.fail('protocol'); return; }
      let at;
      while ((at = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        try { this.receive(JSON.parse(line)); } catch { this.fail('protocol'); return; }
        if (this.child !== child) return;
      }
    });
    child.stdin.on('error', () => { if (this.child === child) this.fail('unavailable'); });
    child.on('error', () => { if (this.child === child) this.fail('runtime-missing'); });
    child.on('exit', () => { if (this.child === child) this.fail('revoked'); });
  }
  request(op, payload, { signal, timeoutMs }) {
    if (signal?.aborted) return Promise.reject(failure('cancelled'));
    if (this.pending) return Promise.reject(failure('busy'));
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const pending = { id: ++this.nextId, op, promise, resolve, reject, signal };
    this.pending = pending;
    pending.abort = () => this.fail('cancelled', false);
    signal?.addEventListener('abort', pending.abort, { once: true });
    pending.timer = setTimeout(() => this.fail('timeout'), timeoutMs); pending.timer.unref?.();
    try {
      if (!this.child) this.launch();
      this.child.stdin.write(JSON.stringify({ id: pending.id, op, ...payload }) + '\n');
    } catch { this.fail('runtime-missing'); }
    return promise;
  }
  receive(event) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Invalid portal frame');
    if (event.type === 'closed') { this.fail('revoked'); return; }
    if (event.type === 'fatal') { this.fail(Object.hasOwn(messages, event.code) ? event.code : 'unavailable'); return; }
    const pending = this.pending;
    if (!pending || event.id !== pending.id || typeof event.ok !== 'boolean') throw new Error('Invalid portal reply');
    if (!event.ok) {
      const reason = Object.hasOwn(messages, event.code) ? event.code : 'unavailable';
      // Invalid coordinates do not invalidate a valid authorized session.
      if (reason === 'coordinates') this.settle(pending, failure(reason));
      else this.fail(reason);
      return;
    }
    if (pending.op === 'authorize') {
      if (event.playback !== true || event.recording !== false) throw new Error('Invalid portal capabilities');
      this.authorized = true;
      this.settle(pending, null, { playback: true, recording: false, message: readyMessage });
    } else this.settle(pending, null);
  }
  settle(pending, error, value) {
    if (this.pending !== pending) return;
    this.pending = null; clearTimeout(pending.timer); pending.signal?.removeEventListener('abort', pending.abort);
    if (error) pending.reject(error); else pending.resolve(value);
  }
  fail(reason, report = true) {
    const wasAuthorized = this.authorized; this.authorized = false;
    const child = this.child; this.child = null;
    const retired = child ? this.retire(child) : Promise.resolve();
    const error = failure(reason);
    const pending = this.pending;
    if (pending && !pending.finalizing) {
      pending.finalizing = true;
      clearTimeout(pending.timer); pending.signal?.removeEventListener('abort', pending.abort);
      // The owner must not report cancellation/drain while a native call could
      // still finish. Wait for EOF cleanup or the bounded forced termination.
      void retired.then(() => this.settle(pending, error));
    }
    if (report && wasAuthorized) this.onError(error);
  }
  retire(child) {
    const promise = new Promise(resolve => {
      let softTimer, hardTimer;
      const finish = () => { clearTimeout(softTimer); clearTimeout(hardTimer); child.off('exit', finish); resolve(); };
      child.once('exit', finish);
      // EOF gives the helper time to release held inputs and close the portal.
      child.stdin.end();
      softTimer = setTimeout(() => child.kill('SIGTERM'), 200); softTimer.unref?.();
      hardTimer = setTimeout(() => { child.kill('SIGKILL'); finish(); }, 1500); hardTimer.unref?.();
      if (child.exitCode !== null && child.exitCode !== undefined) finish();
    });
    this.retiring.add(promise); void promise.finally(() => this.retiring.delete(promise));
    return promise;
  }
  async dispose() {
    this.disposed = true; this.fail('cancelled', false);
    await Promise.all([...this.retiring]);
  }
}

module.exports = { createWaylandDriver: options => new WaylandMacroDriver(options), WaylandMacroDriver };
