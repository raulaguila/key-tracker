// Independent Electron process on the UI suite's isolated Xvfb display.
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
module.exports = async function externalWindow() {
  if (process.platform !== 'linux' || !process.env.DISPLAY?.startsWith(':')) throw new Error('External focus fixture requires the isolated Linux UI display.');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dobra-external-window-'));
  const entry = path.join(directory, 'receiver.cjs');
  await fs.writeFile(entry, `const {app,BrowserWindow}=require('electron');
    app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});
    app.whenReady().then(async()=>{
      const window=new BrowserWindow({width:420,height:240,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
      await window.loadURL('data:text/html,<title>Independent receiver</title><textarea autofocus></textarea>');
      window.show();window.focus();process.send({ready:true});
    });process.on('message',message=>{if(message.stop)app.exit(0);});`);
  const child = spawn(require('electron'), [entry, '--ozone-platform=x11', '--disable-gpu', ...(process.env.DOBRA_UI_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await new Promise(resolve => { child.once('exit', resolve); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000).unref(); });
    }
    await fs.rm(directory, { recursive: true, force: true });
  };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Independent receiver did not open')), 7000);
      const done = callback => value => { clearTimeout(timer); callback(value); };
      child.once('error', done(reject)); child.once('exit', done(() => reject(new Error('Independent receiver exited'))));
      child.on('message', message => { if (message.ready) done(resolve)(); });
    });
    return { stop };
  } catch (error) { await stop(); throw error; }
};
