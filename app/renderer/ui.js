export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'class') node.className = value;
    else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else if (['checked', 'disabled', 'required', 'hidden', 'open'].includes(name)) node[name] = Boolean(value);
    else if (value !== undefined && value !== null) node.setAttribute(name, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child !== undefined && child !== null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const paths = {
  copy: ['M9 9h12v12H9V9ZM15 5V3H3v12h2'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'],
  list: ['M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'],
  layers: ['M12 3 2 8l10 5 10-5-10-5Z', 'm2 12 10 5 10-5', 'm2 16 10 5 10-5'],
  keyboard: ['M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z', 'M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10'],
  history: ['M3 11a9 9 0 1 1 2.5 7', 'M3 4v7h7', 'M12 7v5l3 2'],
  settings: ['M4 6h16M4 12h16M4 18h16', 'M8 3v6M16 9v6M10 15v6'],
  play: ['m9 5 11 7-11 7V5Z'],
  pause: ['M8 5v14M16 5v14'],
  plus: ['M12 5v14M5 12h14'],
  back: ['m12 5-7 7 7 7M5 12h14'],
  sidebar: ['M3 4h18v16H3V4ZM9 4v16', 'm15 9-3 3 3 3'],
  close: ['m6 6 12 12M6 18 18 6'],
  check: ['m5 12 4 4L19 6'],
  alert: ['m12 3 10 18H2L12 3Z', 'M12 9v4M12 17h.01'],
  search: ['M21 21l-5-5', 'M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z'],
  edit: ['m16 3 5 5-12 12H4v-5L16 3Z', 'm14 5 5 5'],
  trash: ['M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7'],
  folder: ['M3 7V5h6l2 2h10v13H3V7Z'],
  upload: ['m7 8 5-5 5 5M12 3v12M4 15v6h16v-6'],
  download: ['m7 11 5 5 5-5M12 3v13M4 17v4h16v-4'],
  http: ['m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16'],
  file: ['M14 2H5v20h14V7l-5-5ZM14 2v6h5M8 13h8M8 17h6'],
  log: ['M4 4h16v16H4V4ZM8 8h8M8 12h8M8 16h4'],
  save: ['M5 3h12l4 4v14H3V3h2ZM7 3v6h10V3M7 21v-8h10v8']
};

export function icon(name) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: 'icon' })) node.setAttribute(key, value);
  for (const d of paths[name] || paths.layers) {
    const path = document.createElementNS(node.namespaceURI, 'path');
    path.setAttribute('d', d);
    node.append(path);
  }
  return node;
}

export function button(label, handler, variant = '', attrs = {}) {
  const { symbol, iconOnly, ...rest } = attrs;
  return el('button', { type: 'button', class: 'button ' + variant + (iconOnly ? ' icon-button' : ''), onclick: handler, ...rest },
    symbol ? icon(symbol) : null, el('span', { class: iconOnly ? 'sr-only' : '' }, label));
}

export function shortcut(value, platform = 'linux') {
  const labels = { CommandOrControl: platform === 'darwin' ? '⌘' : 'Ctrl', Command: '⌘', Control: 'Ctrl', Super: platform === 'darwin' ? '⌘' : 'Win', Shift: 'Shift', Alt: platform === 'darwin' ? 'Option' : 'Alt', Space: 'Espaço', Up: '↑', Down: '↓', Left: '←', Right: '→', Equal: '=', Minus: '−', Slash: '/', Period: '.', Comma: ',', Semicolon: ';', Quote: "'", Backslash: '\\', BracketLeft: '[', BracketRight: ']' };
  const parts = value.split('+').map(part => labels[part] || part);
  return el('span', { class: 'shortcut', role: 'img', 'aria-label': parts.join(' + ') }, parts.map((part, index) => [
    index ? el('span', { class: 'shortcut-plus', 'aria-hidden': 'true' }, '+') : null,
    el('kbd', {}, part)
  ]));
}

export function heading(title, description, action) {
  return el('div', { class: 'page-heading' }, el('div', {}, el('h1', {}, title), description ? el('p', { class: 'page-description' }, description) : null), action);
}

export function field(name, label, value = '', options = {}) {
  const { hint, multiline, choices, className, ...attrs } = options;
  const inputId = 'field-' + name;
  const input = choices
    ? el('select', { id: inputId, name, ...attrs }, choices.map(([key, title]) => el('option', { value: key }, title)))
    : el(multiline ? 'textarea' : 'input', { id: inputId, name, class: className || '', ...attrs });
  input.value = value;
  const wrapper = el('div', { class: 'field' }, el('label', { for: inputId }, label, attrs.required ? el('span', { class: 'required-label', 'aria-hidden': 'true' }, ' *') : null), input,
    hint ? el('small', { id: inputId + '-hint' }, hint) : null);
  if (hint) input.setAttribute('aria-describedby', inputId + '-hint');
  return { input, wrapper };
}

let toastTimer;
export function toast(message, status = 'success') {
  const node = document.querySelector('#toast');
  // Feedback must share the modal's top layer to remain visible and dismissible.
  (document.querySelector('#editor-drawer[open]') || document.body).append(node);
  clearTimeout(toastTimer);
  node.className = 'toast ' + status;
  node.replaceChildren(icon(status === 'error' ? 'alert' : 'check'), el('span', {}, message),
    button('Fechar mensagem', () => { node.hidden = true; }, 'quiet', { symbol: 'close', iconOnly: true }));
  node.hidden = false;
  if (status !== 'error') toastTimer = setTimeout(() => { node.hidden = true; }, 6000);
}

export function announce(message) { document.querySelector('#announcement').textContent = message; }

export function confirmDialog({ title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false }) {
  const previous = document.querySelector('#confirm-dialog');
  if (previous.open) return Promise.resolve(false);
  // Each invocation owns its close event. A queued event from an earlier dialog
  // must never resolve a newly opened confirmation.
  const dialog = el('dialog', { id: 'confirm-dialog', 'aria-labelledby': 'dialog-title', 'aria-describedby': 'dialog-description' });
  previous.replaceWith(dialog);
  dialog.replaceChildren(
    el('div', { class: 'dialog-symbol' }, icon(danger ? 'alert' : 'upload')),
    el('h2', { id: 'dialog-title' }, title),
    el('p', { id: 'dialog-description' }, message),
    el('div', { class: 'dialog-actions' },
      button(cancelLabel, () => dialog.close('cancel'), '', { 'data-cancel': '' }),
      button(confirmLabel, () => dialog.close('confirm'), danger ? 'danger-solid' : 'primary'))
  );
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.returnValue = '';
    dialog.showModal();
    dialog.querySelector('[data-cancel]').focus();
  });
}
