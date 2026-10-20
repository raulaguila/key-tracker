import { el } from './ui.js';

export function keyboardView(platform, nodes) {
  const rows = [
    [['Escape', 'Esc'], ...Array.from({ length: 12 }, (_, i) => ['F' + (i + 1), 'F' + (i + 1)])],
    [['Backquote', '~'], ...Array.from({ length: 9 }, (_, i) => ['Digit' + (i + 1), String(i + 1)]), ['Digit0', '0'], ['Minus', '−'], ['Equal', '='], ['Backspace', '⌫', '2']],
    [['Tab', 'Tab', '15'], ...'QWERTYUIOP'.split('').map(key => ['Key' + key, key]), ['BracketLeft', '['], ['BracketRight', ']'], ['Backslash', '\\', '15']],
    [['CapsLock', 'Caps', '175'], ...'ASDFGHJKL'.split('').map(key => ['Key' + key, key]), ['Semicolon', ';'], ['Quote', "'"], ['Enter', 'Enter', '225']],
    [['ShiftLeft', 'Shift', '225'], ...'ZXCVBNM'.split('').map(key => ['Key' + key, key]), ['Comma', ','], ['Period', '.'], ['Slash', '/'], ['ShiftRight', 'Shift', '275']],
    [['ControlLeft', 'Ctrl', '15'], ['MetaLeft', platform === 'darwin' ? '⌘' : 'Win', '15'], ['AltLeft', 'Alt', '15'], ['Space', 'Espaço', '6'], ['AltRight', 'Alt', '15'], ['MetaRight', platform === 'darwin' ? '⌘' : 'Win', '15'], ['ContextMenu', 'Menu', '15'], ['ControlRight', 'Ctrl', '15']]
  ];
  function row(keys, functionRow = false) {
    return el('div', { class: 'keyboard-row' + (functionRow ? ' function-row' : '') }, keys.map(([code, label, width]) => {
      const node = el('span', { class: 'keycap' + (width ? ' width-' + width : '') + (!code ? ' spacer' : ''), 'data-code': code, title: code || undefined }, label);
      if (code) nodes.set(code, node);
      return node;
    }));
  }
  const main = el('div', { class: 'keyboard-main' }, rows.map((keys, index) => row(keys, index === 0)));
  const navigation = el('div', { class: 'keyboard-navigation' },
    row([['PrintScreen', 'PrtSc'], ['ScrollLock', 'Scroll'], ['Pause', 'Pause']], true),
    row([['Insert', 'Ins'], ['Home', 'Home'], ['PageUp', 'PgUp']]),
    row([['Delete', 'Del'], ['End', 'End'], ['PageDown', 'PgDn']]),
    row([['', ''], ['ArrowUp', '↑'], ['', '']]),
    row([['ArrowLeft', '←'], ['ArrowDown', '↓'], ['ArrowRight', '→']]));
  const numpad = el('div', { class: 'keyboard-numpad' },
    row([['NumLock', 'Num'], ['NumpadDivide', '/'], ['NumpadMultiply', '×'], ['NumpadSubtract', '−']], true),
    row([['Numpad7', '7'], ['Numpad8', '8'], ['Numpad9', '9'], ['NumpadAdd', '+']]),
    row([['Numpad4', '4'], ['Numpad5', '5'], ['Numpad6', '6']]),
    row([['Numpad1', '1'], ['Numpad2', '2'], ['Numpad3', '3'], ['NumpadEnter', '↵']]),
    row([['Numpad0', '0', '2'], ['NumpadDecimal', '.']]));
  return el('div', { class: 'keyboard-scroll', role: 'region', tabindex: '0', 'aria-label': 'Teclado visual QWERTY e numérico. Role horizontalmente em janelas pequenas.' },
    el('div', { class: 'keyboard-assembly', role: 'img', 'aria-label': 'Teclado físico de referência. As teclas pressionadas são destacadas; a lista acima informa seus nomes.' }, main, navigation, numpad));
}
