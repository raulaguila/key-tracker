// Always create a disposable X11 display; never record/inject on the host desktop.
const { spawn } = require('node:child_process');
const path = require('node:path');
if (process.platform !== 'linux') {
  console.error('Esta prova usa Linux/X11 isolado; não certifica Windows/macOS ou um compositor Wayland.');
  process.exitCode = 1;
} else {
  const child = spawn('xvfb-run', ['-a', process.execPath, path.join(__dirname, 'ui-smoke.cjs')], {
    stdio: 'inherit', env: { ...process.env, DOBRA_UI_MACRO_ONLY: '1' }
  });
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
}
