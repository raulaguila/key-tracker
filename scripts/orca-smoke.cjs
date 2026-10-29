// Real Orca in a private D-Bus session, X display and disposable settings.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const exited = child => new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
async function main() {
  assert.equal(process.platform, 'linux', 'Requires Linux, Orca, AT-SPI, Xvfb and D-Bus');
  if (process.argv[2] !== '--session') {
    process.exitCode = await exited(spawn('xvfb-run', ['-a', 'dbus-run-session', '--', process.execPath, __filename, '--session'], { stdio: 'inherit' })); return;
  }
  const dir = path.resolve('artifacts/screen-reader');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dobra-orca-'));
  const data = path.join(temp, 'data');
  await fs.mkdir(path.join(data, 'orca'), { recursive: true }); await fs.mkdir(dir, { recursive: true });
  // Flush diagnostic text only. Keep the installed reader's speech and navigation unchanged.
  await fs.writeFile(path.join(data, 'orca/orca-customizations.py'), 'from orca import debug\nif debug.debugFile:\n    debug.debugFile.reconfigure(line_buffering=True)\n');
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(temp, 'config'), XDG_DATA_HOME: data, XDG_CACHE_HOME: path.join(temp, 'cache'), GSETTINGS_BACKEND: 'memory', NO_AT_BRIDGE: '0', GTK_MODULES: 'atk-bridge' };
  const log = path.join(dir, 'orca.log'); await fs.writeFile(log, '');
  const orca = spawn('orca', ['--debug-file=' + log], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostic = '', startupError;
  orca.on('error', error => { startupError = error; });
  for (const stream of [orca.stdout, orca.stderr]) stream.on('data', value => { diagnostic = (diagnostic + value).slice(-8000); });
  try {
    const deadline = Date.now() + 20000; let ready = false;
    while (Date.now() < deadline) {
      if (startupError) throw startupError;
      if (orca.exitCode !== null) throw new Error('Orca exited: ' + diagnostic);
      if ((await fs.readFile(log, 'utf8')).includes('SPEECH OUTPUT:')) { ready = true; break; }
      await pause(100);
    }
    assert.ok(ready, 'Orca initialized and generated speech: ' + diagnostic);
    const ui = spawn(process.execPath, [path.join(__dirname, 'ui-smoke.cjs')], { env: { ...env, DOBRA_UI_SCREEN_READER_ONLY: '1', DOBRA_ORCA_LOG: log }, stdio: 'inherit' });
    assert.equal(await exited(ui), 0, 'Screen reader interaction checks');
  } finally {
    orca.kill('SIGTERM');
    for (let attempt = 0; attempt < 30 && orca.exitCode === null && orca.signalCode === null; attempt++) await pause(100);
    if (orca.exitCode === null && orca.signalCode === null) orca.kill('SIGKILL');
    await fs.writeFile(path.join(dir, 'orca-launch.log'), diagnostic);
    await fs.rm(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
