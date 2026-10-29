// Explicit macro recording is isolated: native hook failures must not terminate
// the application. No key payload is sent while recording is disabled.
const { uIOhook, UiohookKey } = require('uiohook-napi');
const { normalizeShortcut, effectiveShortcut } = require('../config.cjs');
const { createKeyMapper } = require('../native-keycodes.cjs');
const mapKey = createKeyMapper(UiohookKey);
const port = process.parentPort;
let recording = false;
let stopShortcut = '';
let stopGeneration = 0;
const pressed = new Set();
const aliases = { Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight', Command: 'Meta', Super: 'Meta', Control: 'Ctrl', Quote: 'Quote' };
function send(value) { port.postMessage(value); }
function chord(event) {
  const mapped = mapKey(event.keycode);
  if (!mapped || /^(Control|Alt|Shift|Meta)/.test(mapped.code)) return null;
  const key = (mapped.code.startsWith('Numpad') ? mapped.code : mapped.key).replace(/^Arrow/, '');
  try { return normalizeShortcut([event.ctrlKey && 'Control', event.metaKey && (process.platform === 'darwin' ? 'Command' : 'Super'), event.altKey && 'Alt', event.shiftKey && 'Shift', key].filter(Boolean).join('+')); }
  catch { return null; }
}
uIOhook.on('keydown', event => {
  if (pressed.has(event.keycode)) return;
  pressed.add(event.keycode);
  const key = chord(event);
  if (key && key === stopShortcut) { send({ type: 'stop', key, generation: stopGeneration }); return; }
  if (recording && key) send({ type: 'input', step: { kind: 'key', key } });
});
uIOhook.on('keyup', event => pressed.delete(event.keycode));
// mousedown preserves actual click count and time; the synthesized libuiohook
// 'click' event can be emitted in addition to down/up and would duplicate it.
uIOhook.on('mousedown', event => {
  if (!recording) return;
  const button = { 1: 'left', 2: 'right', 3: 'middle' }[event.button];
  if (button) send({ type: 'input', step: { kind: 'click', x: Math.round(event.x), y: Math.round(event.y), button, clicks: 1 } });
});
port.on('message', event => {
  const message = event.data;
  if (message === 'stop') { uIOhook.stop(); process.exit(0); }
  if (!message || typeof message !== 'object' || !Number.isInteger(message.id)) return;
  try {
    if (message.type === 'record') recording = message.enabled === true;
    else if (message.type === 'stop-shortcut') {
      if (!Number.isSafeInteger(message.generation) || message.generation < 1) throw new Error('Invalid generation');
      stopShortcut = normalizeShortcut(message.key); stopGeneration = message.generation;
    }
    else if (message.type === 'key') {
      const parts = effectiveShortcut(message.key).split('+');
      let key = parts.pop();
      if (key === 'Plus') { key = 'Equal'; if (!parts.includes('Shift')) parts.push('Shift'); }
      const code = UiohookKey[aliases[key] || key];
      const modifiers = parts.map(item => UiohookKey[aliases[item] || item]);
      if (!Number.isInteger(code) || modifiers.some(value => !Number.isInteger(value))) throw new Error('Unsupported key');
      uIOhook.keyTap(code, modifiers);
    } else throw new Error('Invalid command');
    send({ type: 'result', id: message.id, ok: true });
  } catch { send({ type: 'result', id: message.id, ok: false }); }
});
uIOhook.start();
send({ type: 'ready' });
