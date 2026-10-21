import { el, icon, button, shortcut } from './ui.js';

// Keep keyed rows while searching or receiving execution results. Handlers read
// the current model, so reused rows never operate on an older configuration.
export function createBindingTable({ platform, labels, typeLabels, summaryFor, onTest, onEdit, menuFor, triggerFor, triggerDescription }) {
  const caption = el('caption', { class: 'sr-only' });
  const body = el('tbody');
  const node = el('table', { class: 'binding-table' }, caption,
    el('thead', {}, el('tr', {}, [['Tecla', 'binding-key'], ['Nome', ''], ['Tipo', 'type-column'], ['Destino / conteúdo', 'summary-column'], ['Ações', 'controls-column']]
      .map(([label, className]) => el('th', { scope: 'col', class: className }, label)))), body);
  const records = new Map();
  function labelButton(control, label) {
    const text = control.querySelector('span');
    if (text.textContent !== label) text.textContent = label;
    if (control.title !== label) control.title = label;
  }
  function create(binding) {
    const record = { binding, layer: null };
    record.key = el('td', { class: 'binding-key' });
    record.name = el('strong');
    record.copy = el('td', { class: 'binding-copy' }, record.name);
    record.type = el('td', { class: 'type-column' });
    record.summary = el('span', { class: 'binding-summary' });
    record.test = button('', () => onTest(record.layer, record.binding), 'quiet', { symbol: 'play', iconOnly: true, 'data-focus': 'test-' + binding.id });
    record.edit = button('', () => onEdit(record.binding), 'quiet', { symbol: 'edit', iconOnly: true, 'data-focus': 'edit-' + binding.id });
    record.menu = menuFor(() => ({ layer: record.layer, binding: record.binding }));
    record.more = record.menu.querySelector('button');
    record.row = el('tr', { class: 'binding-row', 'data-binding-id': binding.id }, record.key, record.copy, record.type,
      el('td', { class: 'summary-column' }, record.summary), el('td', { class: 'controls-column' }, el('div', { class: 'binding-actions' }, record.test, record.edit, record.menu)));
    return record;
  }
  function update(layer, matches, events, pendingBindings) {
    const nextCaption = 'Ações de ' + layer.name;
    if (caption.textContent !== nextCaption) caption.textContent = nextCaption;
    const matched = new Set(matches.map(binding => binding.id));
    const ids = new Set(layer.bindings.map(binding => binding.id));
    for (const [id, record] of records) if (!ids.has(id)) { record.row.remove(); records.delete(id); }
    const results = new Map();
    const legacy = [];
    for (const event of events) if (event.kind === 'action') {
      if (event.bindingId) { if (!results.has(event.bindingId)) results.set(event.bindingId, event); }
      else legacy.push(event);
    }
    for (const [index, binding] of layer.bindings.entries()) {
      let record = records.get(binding.id);
      if (!record) { record = create(binding); records.set(binding.id, record); }
      record.binding = binding; record.layer = layer;
      const disabled = binding.enabled === false;
      const momentKey = triggerDescription(binding);
      if (record.keyValue !== binding.key || record.disabled !== disabled || record.momentKey !== momentKey) {
        record.key.replaceChildren(shortcut(binding.key, platform), el('small', { class: 'binding-trigger-label' }, momentKey), ...(disabled ? [el('small', { class: 'disabled-label' }, 'Desativada')] : []));
        record.row.classList.toggle('binding-disabled', disabled);
        record.keyValue = binding.key; record.disabled = disabled; record.momentKey = momentKey;
      }
      if (record.name.textContent !== binding.name) record.name.textContent = binding.name;
      labelButton(record.edit, 'Editar ação: ' + binding.name);
      labelButton(record.more, 'Mais opções: ' + binding.name);
      const type = typeLabels[binding.action.type];
      if (record.type.textContent !== type) record.type.textContent = type;
      if (record.type.title !== labels[binding.action.type]) record.type.title = labels[binding.action.type];
      // Configuration changes can alter a layer name used by a summary, even
      // when the binding itself is unchanged.
      const summary = summaryFor(binding.action);
      if (record.summary.textContent !== summary) { record.summary.textContent = summary; record.summary.title = summary; }
      const pending = pendingBindings.has(binding.id);
      labelButton(record.test, pending ? 'Executando…' : 'Executar teste: ' + binding.name);
      if (record.test.disabled !== pending) record.test.disabled = pending;
      const result = results.get(binding.id) || legacy.find(event => event.layer === layer.name && event.key === binding.key && (event.trigger || 'press') === triggerFor(binding));
      const resultKey = pending ? 'pending' : result?.id;
      if (record.resultKey !== resultKey) {
        record.feedback?.remove(); record.feedback = null;
        if (pending || result) {
          record.feedback = el('p', { class: 'binding-result ' + (pending ? 'info' : result.status), ...(pending ? { role: 'status' } : {}) },
            pending ? null : icon(result.status === 'cancelled' ? 'close' : result.status === 'error' ? 'alert' : 'check'), pending ? 'Executando ação…' : result.message);
          record.copy.append(record.feedback);
        }
        record.resultKey = resultKey;
      }
      const hidden = !matched.has(binding.id);
      if (record.row.hidden !== hidden) record.row.hidden = hidden;
      if (body.children[index] !== record.row) body.insertBefore(record.row, body.children[index] || null);
    }
    node.hidden = !matches.length;
    return node;
  }
  return { node, update };
}
