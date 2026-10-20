// Native hooks can terminate on a missing display/permission. Keep them outside
// the desktop process, and never send or retain typed text.
const { uIOhook, UiohookKey } = require('uiohook-napi');
const { createKeyMapper } = require('./native-keycodes.cjs');
const mapKey = createKeyMapper(UiohookKey);
const pressed = new Set();

function send(direction, event) {
  const key = mapKey(event.keycode);
  if (!key) return;
  const { code } = key;
  if (direction === 'down') {
    if (pressed.has(code)) return;
    pressed.add(code);
  } else pressed.delete(code);
  process.parentPort.postMessage({ type: 'key', ...key, direction, source: 'global',
    ctrlKey: Boolean(event.ctrlKey), altKey: Boolean(event.altKey), shiftKey: Boolean(event.shiftKey), metaKey: Boolean(event.metaKey) });
}

uIOhook.on('keydown', event => send('down', event));
uIOhook.on('keyup', event => send('up', event));
process.parentPort.on('message', event => {
  if (event.data === 'stop') { uIOhook.stop(); process.exit(0); }
});
uIOhook.start();
process.parentPort.postMessage({ type: 'ready' });
