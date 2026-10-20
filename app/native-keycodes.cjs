// Keep the hook's physical codes separate from layout-dependent legends.
function createKeyMapper(constants) {
  const names = new Map();
  for (const [name, value] of Object.entries(constants)) if (!names.has(value)) names.set(value, name);
  // Values from the bundled libuiohook/include/uiohook.h, absent from the JS enum.
  for (const [code, name] of [[0x0E46, 'IntlBackslash'], [0x0073, 'IntlRo'], [0x007D, 'IntlYen'], [0x007E, 'NumpadDecimal'], [0x0E5D, 'ContextMenu'], [0x0E45, 'Pause']]) {
    if (!names.has(code)) names.set(code, name);
  }
  const aliases = {
    Ctrl: 'ControlLeft', CtrlRight: 'ControlRight', Alt: 'AltLeft', Shift: 'ShiftLeft', Meta: 'MetaLeft',
    NumpadEnd: 'Numpad1', NumpadArrowDown: 'Numpad2', NumpadPageDown: 'Numpad3',
    NumpadArrowLeft: 'Numpad4', NumpadArrowRight: 'Numpad6', NumpadHome: 'Numpad7',
    NumpadArrowUp: 'Numpad8', NumpadPageUp: 'Numpad9', NumpadInsert: 'Numpad0', NumpadDelete: 'NumpadDecimal'
  };
  return keycode => {
    const name = names.get(keycode);
    if (!name) return null;
    const code = /^[A-Z]$/.test(name) ? 'Key' + name : /^\d$/.test(name) ? 'Digit' + name : aliases[name] || name;
    return { code, key: name };
  };
}
module.exports = { createKeyMapper };
