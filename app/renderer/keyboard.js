import { el } from './ui.js';

export function keyboardView(platform, nodes, { layout: chosen, size = 'full' }) {
  const iso = chosen.geometry !== 'ansi';
  function key(code, label, units = 1, extra = '') {
    const actual = chosen.keys[code] ?? label;
    const element = el('span', { class: 'keycap u-' + String(units).replace('.', '-') + ' ' + extra, 'data-code': code, title: code || undefined }, extra === 'iso-enter' ? el('span', { class: 'iso-shape' }, 'Enter') : actual);
    // All typing rows share a 15-unit grid, subdivided into quarter units.
    element.style.setProperty('--key-span', units * 4);
    if (code) nodes.set(code, element);
    return element;
  }
  const letters = value => [...value].map(letter => key('Key' + letter, letter));
  const row = (keys, extra = '') => el('div', { class: 'keyboard-row ' + extra }, keys);
  const main = el('div', { class: 'keyboard-main' });
  if (size !== 'compact') main.append(row([key('Escape', 'Esc'), ...Array.from({ length: 12 }, (_, i) => key('F' + (i + 1), 'F' + (i + 1)))], 'functions'));
  main.append(
    row([key('Backquote', '`'), ...'1234567890'.split('').map(digit => key('Digit' + digit, digit)), key('Minus', '−'), key('Equal', '='), key('Backspace', '⌫', 2)]),
    row([key('Tab', 'Tab', 1.5), ...letters('QWERTYUIOP'), key('BracketLeft', '['), key('BracketRight', ']'), iso ? key('Enter', 'Enter', 1.5, 'iso-enter') : key('Backslash', '\\', 1.5)]),
    row([key('CapsLock', 'Caps', 1.75), ...letters('ASDFGHJKL'), key('Semicolon', ';'), key('Quote', "'"), iso ? key('Backslash', ']') : null, iso ? key('', '', 1.25, 'void') : key('Enter', 'Enter', 2.25)]),
    row([key('ShiftLeft', 'Shift', iso ? 1.25 : 2.25), iso ? key('IntlBackslash', '\\') : null, ...letters('ZXCVBNM'), key('Comma', ','), key('Period', '.'), key('Slash', '/'), chosen.geometry === 'abnt2' ? key('IntlRo', '/') : null, key('ShiftRight', 'Shift', chosen.geometry === 'abnt2' ? 1.75 : 2.75)]),
    row([key('ControlLeft', 'Ctrl', 1.25), key('MetaLeft', platform === 'darwin' ? '⌘' : 'Win', 1.25, 'small'), key('AltLeft', platform === 'darwin' ? 'Option' : 'Alt', 1.25), key('Space', '', 6.25), key('AltRight', platform === 'darwin' ? 'Option' : chosen.geometry === 'ansi' ? 'Alt' : 'AltGr', 1.25, 'small'), key('MetaRight', platform === 'darwin' ? '⌘' : 'Win', 1.25, 'small'), key('ContextMenu', 'Menu', 1.25, 'small'), key('ControlRight', 'Ctrl', 1.25)]));
  const assembly = el('div', { class: 'keyboard-assembly', 'data-size': size, role: 'img', 'aria-label': 'Prévia do teclado ' + chosen.name + '. Teclas pressionadas também aparecem na lista acima.' }, main);
  if (size !== 'compact') assembly.append(el('div', { class: 'keyboard-navigation' },
    row([key('PrintScreen', 'PrtSc'), key('ScrollLock', 'Scroll'), key('Pause', 'Pause')], 'functions'),
    row([key('Insert', 'Ins'), key('Home', 'Home'), key('PageUp', 'PgUp')]), row([key('Delete', 'Del'), key('End', 'End'), key('PageDown', 'PgDn')]),
    row([key('', '', 1, 'void'), key('ArrowUp', '↑'), key('', '', 1, 'void')], 'arrow-gap'), row([key('ArrowLeft', '←'), key('ArrowDown', '↓'), key('ArrowRight', '→')])));
  if (size === 'full') assembly.append(el('div', { class: 'keyboard-numpad' }, row([key('NumLock', 'Num'), key('NumpadDivide', '/'), key('NumpadMultiply', '×'), key('NumpadSubtract', '−')], 'functions'),
    el('div', { class: 'numpad-grid' }, key('Numpad7', '7'), key('Numpad8', '8'), key('Numpad9', '9'), key('NumpadAdd', '+', 1, 'tall'), key('Numpad4', '4'), key('Numpad5', '5'), key('Numpad6', '6'), key('Numpad1', '1'), key('Numpad2', '2'), key('Numpad3', '3'), key('NumpadEnter', '↵', 1, 'tall'), key('Numpad0', '0', 1, 'wide'), key('NumpadDecimal', '.'))));
  return el('div', { class: 'keyboard-scroll', role: 'region', tabindex: '0', 'aria-label': 'Teclado visual ' + chosen.name + '. Role horizontalmente quando necessário.' }, assembly);
}
