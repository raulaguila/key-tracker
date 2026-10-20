// This thread is started only after the user enables application profiles.
// Window titles and URLs never cross the thread boundary.
const { parentPort } = require('node:worker_threads');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const childProcess = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const { NativeProcessScope } = require('./native-process-scope.cjs');

const processes = new NativeProcessScope();
childProcess.execFile = processes.execFile;
syncBuiltinESMExports();
let stopping = false;

async function executableAvailable(name) {
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    try { await fs.access(path.join(directory, name), fs.constants.X_OK); return true; }
    catch { /* Continue through PATH; never execute a shell. */ }
  }
  return false;
}

let load;
async function read() {
  if (process.platform === 'linux' && !(await executableAvailable('xprop') && await executableAvailable('xwininfo'))) {
    parentPort.postMessage({ error: 'linux-tools' });
    return;
  }
  if (!load) {
    // Swift is an executable, so macOS must load it from the physical unpacked
    // directory rather than ask execFile to execute a virtual ASAR path.
    const entry = process.platform === 'darwin'
      ? path.join(path.dirname(require.resolve('get-windows')).replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`), 'lib', 'macos.js')
      : require.resolve('get-windows');
    load = import(pathToFileURL(entry).href);
  }
  const { activeWindow } = await load;
  const result = await activeWindow({ accessibilityPermission: false, screenRecordingPermission: false });
  const owner = result?.owner;
  parentPort.postMessage({ owner: owner ? { name: owner.name, path: owner.path, bundleId: owner.bundleId, processId: owner.processId } : null });
}

parentPort.on('message', message => {
  const type = typeof message === 'string' ? message : message?.type;
  if (type === 'stop') {
    if (stopping) return;
    stopping = true;
    void processes.cancel().then(() => { parentPort.postMessage({ type: 'stopped' }); parentPort.close(); });
  } else if (type === 'read' && !stopping) {
    void read().catch(() => { if (!stopping) parentPort.postMessage({ error: 'native-read' }); });
  }
});
