// Reference legends from XKB basic layouts. Device geometry is a separate preference.
const base = Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(key => ['Key' + key, key]));
Object.assign(base, { Backquote: '`', Minus: '−', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', IntlBackslash: '\\', IntlRo: '/', NumpadDecimal: '.' });
for (let i = 0; i <= 9; i++) base['Digit' + i] = String(i);
export const layouts = {
  us: { name: 'English (US) · ANSI', geometry: 'ansi', keys: { ...base } },
  br: { name: 'Português (BR) · ABNT2', geometry: 'abnt2', keys: { ...base, Backquote: "'", BracketLeft: '´', BracketRight: '[', Backslash: ']', Semicolon: 'Ç', Quote: '~', Slash: ';', NumpadDecimal: ',' } },
  pt: { name: 'Português (PT) · ISO', geometry: 'iso', keys: { ...base, Backquote: '\\', Minus: "'", Equal: '«', BracketLeft: '+', BracketRight: '´', Backslash: '~', Semicolon: 'Ç', Quote: 'º', IntlBackslash: '<', Slash: '−', NumpadDecimal: ',' } },
  fr: { name: 'Français · AZERTY / ISO', geometry: 'iso', keys: { ...base, KeyQ: 'A', KeyW: 'Z', KeyA: 'Q', KeyZ: 'W', Semicolon: 'M', KeyM: ',', Comma: ';', Period: ':', Slash: '!', Backquote: '²', Digit1: '&', Digit2: 'é', Digit3: '"', Digit4: "'", Digit5: '(', Digit6: '−', Digit7: 'è', Digit8: '_', Digit9: 'ç', Digit0: 'à', Minus: ')', BracketLeft: '^', BracketRight: '$', Quote: 'ù', Backslash: '*', IntlBackslash: '<' } },
  de: { name: 'Deutsch · QWERTZ / ISO', geometry: 'iso', keys: { ...base, KeyY: 'Z', KeyZ: 'Y', Backquote: '^', Minus: 'ß', Equal: '´', BracketLeft: 'Ü', BracketRight: '+', Semicolon: 'Ö', Quote: 'Ä', Backslash: '#', IntlBackslash: '<', Slash: '−', NumpadDecimal: ',' } }
};

export function normalizeKeyboardPreference(value = {}) {
  return {
    layout: value && (value.layout === 'auto' || Object.hasOwn(layouts, value.layout)) ? value.layout : 'auto',
    size: ['full', 'tkl', 'compact'].includes(value?.size) ? value.size : 'full',
    geometry: ['auto', 'ansi', 'iso', 'abnt2'].includes(value?.geometry) ? value.geometry : 'auto'
  };
}

export function resolveKeyboardLayout(preference, map) {
  const { layout, geometry } = normalizeKeyboardPreference(preference);
  if (layout !== 'auto') return { ...layouts[layout], geometry: geometry === 'auto' ? layouts[layout].geometry : geometry };
  // Infer a reference, never claim to identify the connected hardware.
  let reference = layouts.us;
  const value = code => map?.get(code)?.toLowerCase();
  if (value('Semicolon') === 'ç') reference = value('BracketRight') === '[' ? layouts.br : layouts.pt;
  else if (value('KeyQ') === 'a' && value('KeyA') === 'q') reference = layouts.fr;
  else if (value('KeyY') === 'z' && value('KeyZ') === 'y') reference = layouts.de;
  const keys = { ...reference.keys };
  if (map) for (const [code, label] of map) {
    if (!label || ['Dead', 'Unidentified'].includes(label)) continue;
    const upper = label.toUpperCase();
    keys[code] = label.length === 1 && upper.length === 1 ? upper : label;
  }
  return {
    name: map ? 'Sistema · legendas detectadas' : 'US · referência provisória',
    geometry: geometry === 'auto' ? reference.geometry : geometry,
    keys
  };
}

export async function readSystemKeyboardMap(keyboard, timeoutMs = 2000) {
  let timer;
  try {
    if (typeof keyboard?.getLayoutMap !== 'function') return null;
    const result = await Promise.race([
      keyboard.getLayoutMap(),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); })
    ]);
    return result?.size ? new Map(result) : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export function keyboardEventLabel(layout, event) {
  if (event.code === 'Space') return 'Espaço';
  return (event.source === 'global' || event.key === 'Dead' ? layout.keys[event.code] : null) || event.key || event.code;
}
