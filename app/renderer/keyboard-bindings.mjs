// Electron accelerators use logical keys. The preview maps the current legend
// back to that logical key and never confuses it with a tracked physical code.
const punctuation = { '=': 'Equal', '-': 'Minus', '−': 'Minus', ',': 'Comma', '.': 'Period', '/': 'Slash', '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', '`': 'Backquote', '[': 'BracketLeft', ']': 'BracketRight', '+': 'Plus' };
const named = new Set(['Space', 'Tab', 'Enter', 'Escape', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown']);
export function shortcutForCode(code, layout) {
  if (code.startsWith('Numpad')) return null;
  if (named.has(code) || /^F(?:[1-9]|1\d|2[0-4])$/.test(code)) return code;
  if (code.startsWith('Arrow')) return code.slice(5);
  const legend = layout.keys[code];
  if (legend && /^[A-Z0-9]$/i.test(legend)) return legend.toUpperCase();
  if (Object.hasOwn(punctuation, legend)) return punctuation[legend];
  if (/^Key[A-Z]$/.test(code) && !legend) return code.slice(3);
  if (/^Digit\d$/.test(code) && !legend) return code.slice(5);
  return null;
}
export function shortcutModifiers(value, platform) {
  return value.split('+').slice(0, -1).map(value => value === 'CommandOrControl' ? platform === 'darwin' ? 'Command' : 'Control' : value).join('+');
}
