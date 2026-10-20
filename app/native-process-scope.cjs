const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

// Used only inside the application-reader thread. The dependency keeps using its
// own adapters, while this owner bounds and cancels every native helper it starts.
class NativeProcessScope {
  constructor({ execFileImpl = execFile, timeoutMs = 2500, cleanupMs = 500 } = {}) {
    this.execFileImpl = execFileImpl;
    this.timeoutMs = timeoutMs;
    this.cleanupMs = cleanupMs;
    this.controller = new AbortController();
    this.children = new Map();
    this.closed = false;
    this.cancelled = null;
    this.execFile = this.execFile.bind(this);
    this.execFile[promisify.custom] = (...args) => {
      let child;
      const result = new Promise((resolve, reject) => {
        child = this.execFile(...args, (error, stdout, stderr) => {
          if (error) reject(error); else resolve({ stdout, stderr });
        });
      });
      result.child = child;
      return result;
    };
  }

  execFile(file, ...parameters) {
    const callback = typeof parameters.at(-1) === 'function' ? parameters.pop() : undefined;
    const args = Array.isArray(parameters[0]) ? parameters.shift() : [];
    const options = parameters[0] || {};
    if (this.closed) throw Object.assign(new Error('Leitura nativa cancelada.'), { code: 'ABORT_ERR' });
    const signals = [this.controller.signal, options.signal].filter(Boolean);
    const child = this.execFileImpl(file, args, {
      ...options,
      timeout: options.timeout > 0 ? Math.min(options.timeout, this.timeoutMs) : this.timeoutMs,
      maxBuffer: options.maxBuffer > 0 ? Math.min(options.maxBuffer, 1024 * 1024) : 1024 * 1024,
      killSignal: 'SIGKILL',
      signal: AbortSignal.any(signals)
    }, callback);
    let resolveClose;
    const closed = new Promise(resolve => { resolveClose = resolve; });
    this.children.set(child, closed);
    child.once('close', () => { this.children.delete(child); resolveClose(); });
    return child;
  }

  cancel() {
    if (this.cancelled) return this.cancelled;
    this.closed = true;
    this.controller.abort();
    for (const child of this.children.keys()) {
      try { child.kill('SIGKILL'); } catch { /* The owned child may have closed already. */ }
    }
    this.cancelled = new Promise(resolve => {
      const timer = setTimeout(resolve, this.cleanupMs);
      Promise.allSettled([...this.children.values()]).then(() => { clearTimeout(timer); resolve(); });
    });
    return this.cancelled;
  }
}

module.exports = { NativeProcessScope };
