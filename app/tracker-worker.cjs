// Native hooks can terminate on a missing display/permission. Keep them outside
// the desktop process, and never send or retain typed text.
const { uIOhook, UiohookKey } = require('uiohook-napi');
const names = new Map();
for (const [name, value] of Object.entries(UiohookKey)) if (!names.has(value)) names.set(value, name);
const aliases = { Ctrl: 'ControlLeft', CtrlRight: 'ControlRight', Alt: 'AltLeft', Shift: 'ShiftLeft', Meta: 'MetaLeft' };
const pressed = new Set();

function send(direction, event) {
  const name = names.get(event.keycode);
  if (!name) return;
  const code = /^[A-Z]$/.test(name) ? `Key${name}` : /^\d$/.test(name) ? `Digit${name}` : (aliases[name] || name);
  if (direction === 'down') {
    if (pressed.has(code)) return;
    pressed.add(code);
  } else pressed.delete(code);
  process.parentPort.postMessage({ type: 'key', code, key: name, direction, source: 'global' });
}

uIOhook.on('keydown', event => send('down', event));
uIOhook.on('keyup', event => send('up', event));
process.parentPort.on('message', event => {
  if (event.data === 'stop') { uIOhook.stop(); process.exit(0); }
});
uIOhook.start();
process.parentPort.postMessage({ type: 'ready' });
