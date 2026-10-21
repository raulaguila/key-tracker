import { el, button, shortcut } from './ui.js';
const api = window.dobraPanel;
const main = document.querySelector('#quick-main');
let layout;
const records = new Map();
let lastRevision = -1;
function createLayout() {
  const name = el('h1'); const status = el('span');
  const dot = el('span', { class: 'status-dot', 'aria-hidden': 'true' });
  const list = el('ul', { class: 'quick-bindings' });
  const empty = el('p', { class: 'quick-empty' }, 'Esta camada ainda não tem ações. Abra o Dobra para configurar uma tecla.');
  main.replaceChildren(el('header', { class: 'quick-heading' }, el('div', {}, el('p', { class: 'quick-eyebrow' }, 'dobra · camada em uso'), name), button('Fechar painel', () => api.hide(), 'quiet', { symbol: 'close', iconOnly: true })),
    el('p', { class: 'quick-status', role: 'status' }, dot, status), list, empty,
    el('footer', { class: 'quick-footer' }, el('span', { class: 'hint' }, 'Escape fecha · Somente consulta'), button('Abrir Dobra', () => api.showMain(), '', { symbol: 'layers' })));
  return { name, status, dot, list, empty };
}
const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
function render(state) {
  if (Number.isSafeInteger(state.revision)) { if (state.revision <= lastRevision) return; lastRevision = state.revision; }
  const theme = state.theme === 'dark' ? 'dark' : 'light';
  if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
  main.removeAttribute('aria-busy');
  layout ||= createLayout();
  setText(layout.name, state.layer?.name || 'Nenhuma camada');
  const mode = state.stopping ? 'starting' : !state.enabled ? 'paused' : state.editing ? 'suspended' : state.input?.mode === 'global' ? 'active' : state.input?.mode === 'starting' ? 'starting' : 'unavailable';
  const labels = { active: 'Ações ativas', paused: 'Ações pausadas', suspended: 'Ações suspensas durante a edição', starting: state.stopping ? 'Parando ações…' : 'Preparando observação…', unavailable: 'Entrada indisponível' };
  setText(layout.status, labels[mode]);
  if (layout.dot.dataset.state !== mode) layout.dot.dataset.state = mode;
  const bindings = state.bindings || [];
  const ids = new Set(bindings.map(binding => binding.id));
  for (const [id, record] of records) if (!ids.has(id)) { record.node.remove(); records.delete(id); }
  for (const [index, binding] of bindings.entries()) {
    let record = records.get(binding.id);
    if (!record) {
      record = { name: el('strong'), moment: el('small'), key: el('span') };
      record.node = el('li', {}, el('div', {}, record.name, record.moment), record.key);
      records.set(binding.id, record);
    }
    setText(record.name, binding.name);
    setText(record.moment, ({ press: 'Ao pressionar', hold: 'Enquanto pressionada', release: 'Ao soltar' }[binding.trigger] || 'Ao pressionar') + (binding.enabled === false ? ' · Desativada' : ''));
    record.node.classList.toggle('quick-disabled', binding.enabled === false);
    const keySignature = (state.platform || 'linux') + ':' + binding.key;
    if (record.keySignature !== keySignature) { record.keySignature = keySignature; record.key.replaceChildren(shortcut(binding.key, state.platform || 'linux')); }
    if (layout.list.children[index] !== record.node) layout.list.insertBefore(record.node, layout.list.children[index] || null);
  }
  layout.empty.hidden = bindings.length > 0; layout.list.hidden = !bindings.length;
}
document.addEventListener('keydown', event => { if (event.key === 'Escape') void api.hide(); });
// Subscribe before requesting the snapshot. An event received while getState is
// pending must never be overwritten by an older reply; revisions order both channels.
let receivedEvent = false;
const unsubscribe = api.onState(state => { receivedEvent = true; render(state); });
window.addEventListener('unload', unsubscribe, { once: true });
try { render(await api.getState()); }
catch { if (!receivedEvent) { main.removeAttribute('aria-busy'); main.replaceChildren(el('p', { role: 'alert' }, 'Não foi possível carregar a camada.'), button('Abrir Dobra', () => api.showMain())); } }
