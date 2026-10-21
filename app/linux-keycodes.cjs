// Linux evdev positions, independent of text/layout and libuiohook's keycodes.
const codes = {
  1:'Escape',2:'Digit1',3:'Digit2',4:'Digit3',5:'Digit4',6:'Digit5',7:'Digit6',8:'Digit7',9:'Digit8',10:'Digit9',11:'Digit0',
  12:'Minus',13:'Equal',14:'Backspace',15:'Tab',16:'KeyQ',17:'KeyW',18:'KeyE',19:'KeyR',20:'KeyT',21:'KeyY',22:'KeyU',23:'KeyI',24:'KeyO',25:'KeyP',
  26:'BracketLeft',27:'BracketRight',28:'Enter',29:'ControlLeft',30:'KeyA',31:'KeyS',32:'KeyD',33:'KeyF',34:'KeyG',35:'KeyH',36:'KeyJ',37:'KeyK',38:'KeyL',
  39:'Semicolon',40:'Quote',41:'Backquote',42:'ShiftLeft',43:'Backslash',44:'KeyZ',45:'KeyX',46:'KeyC',47:'KeyV',48:'KeyB',49:'KeyN',50:'KeyM',
  51:'Comma',52:'Period',53:'Slash',54:'ShiftRight',55:'NumpadMultiply',56:'AltLeft',57:'Space',58:'CapsLock',69:'NumLock',70:'ScrollLock',
  71:'Numpad7',72:'Numpad8',73:'Numpad9',74:'NumpadSubtract',75:'Numpad4',76:'Numpad5',77:'Numpad6',78:'NumpadAdd',79:'Numpad1',80:'Numpad2',81:'Numpad3',82:'Numpad0',83:'NumpadDecimal',
  86:'IntlBackslash',89:'IntlRo',96:'NumpadEnter',97:'ControlRight',98:'NumpadDivide',99:'PrintScreen',100:'AltRight',102:'Home',103:'ArrowUp',104:'PageUp',105:'ArrowLeft',106:'ArrowRight',107:'End',108:'ArrowDown',109:'PageDown',110:'Insert',111:'Delete',
  117:'NumpadEqual',119:'Pause',124:'IntlYen',125:'MetaLeft',126:'MetaRight',127:'ContextMenu'
};
for (let i = 1; i <= 10; i++) codes[58 + i] = 'F' + i;
codes[87] = 'F11'; codes[88] = 'F12';
for (let i = 13; i <= 24; i++) codes[170 + i] = 'F' + i;
const positions = new Map(Object.entries(codes).map(([number, code]) => [code, Number(number)]));
module.exports = { linuxCode: code => positions.get(code), keyboardCode: number => codes[number] };
