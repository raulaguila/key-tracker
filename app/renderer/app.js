import { el, icon, button, shortcut, heading, field, toast, announce, confirmDialog } from './ui.js';
import { keyboardView } from './keyboard.js';

const api = window.keyboardTracker;
const main = document.querySelector('#main');
const labels = { http: 'Requisição HTTP', file: 'Arquivo', log: 'Log' };
const pendingBindings = new Set();
const pressed = new Map();
const keyNodes = new Map();
let state;
let view = 'layers';
let selectedLayerId;
let editor = null;
let capture = null;
let actionQuery = '';
let historyQuery = '';
let historyFilter = 'all';
let editingRequested = false;
let editingQueue = Promise.resolve();
let closingAllowed = false;

const copyConfig = () => structuredClone(state.config);
const layerById = (id = selectedLayerId) => state.config.layers.find(layer => layer.id === id);
const newId = prefix => prefix + '-' + crypto.randomUUID();
const textFocus = () => document.activeElement?.matches('input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]');
const serializeForm = form => JSON.stringify([...new FormData(form).entries()]);

function isDirty() {
  const form = main.querySelector('form[data-draft]');
  return Boolean(form && serializeForm(form) !== form.dataset.baseline);
}

async function guardNavigation(callback) {
  if (isDirty() && !await confirmDialog({
    title: 'Descartar alterações?',
    message: 'Você tem alterações que ainda não foram salvas.',
    confirmLabel: 'Descartar alterações', cancelLabel: 'Continuar editando', danger: true
  })) return;
  document.querySelector('#toast').hidden = true;
  stopCapture();
  callback();
}

async function perform(task, message) {
  try {
    const result = await task();
    if (result?.config) state = result;
    if (message) toast(message);
    return result;
  } catch (error) {
    toast(error.message || String(error), 'error');
  } finally { updateStatus(); }
}

function requestEditing(value) {
  if (!api || value === editingRequested) return;
  editingRequested = value;
  editingQueue = editingQueue.catch(() => {}).then(async () => {
    state = await api.setEditing(value);
    updateStatus();
  }).catch(error => toast(error.message, 'error'));
}

function syncEditing() {
  requestEditing(Boolean(editor || capture || isDirty() || textFocus()));
  const status = document.querySelector('#draft-status');
  if (status) status.textContent = isDirty() ? 'Alterações não salvas' : 'Nenhuma alteração pendente';
}

function updateStatus() {
  const toggle = document.querySelector('#engine-toggle');
  toggle.disabled = !state || (!state.enabled && state.editing);
  if (!state) return;
  const suspended = state.enabled && state.editing;
  const editingForm = Boolean(editor || isDirty());
  document.querySelector('#engine-status').textContent = suspended ? editingForm ? 'Ações suspensas durante a edição' : 'Ações suspensas enquanto você digita' : state.enabled ? 'Ações ativas' : 'Ações pausadas';
  document.querySelector('#engine-detail').textContent = suspended ? editingForm ? 'Salve ou feche o editor para continuar.' : 'Clique fora do campo para retomar os atalhos.' : state.enabled ? 'Atalhos funcionando em outros aplicativos.' : state.editing ? editingForm ? 'Finalize a edição para ativar os atalhos.' : 'Clique fora do campo para ativar os atalhos.' : 'Ative quando estiver pronto para usar os atalhos.';
  document.querySelector('#engine-dot').classList.toggle('enabled', state.enabled && !state.editing);
  toggle.replaceChildren(icon(state.enabled ? 'pause' : 'play'), el('span', {}, state.enabled ? 'Pausar ações' : 'Ativar ações'));
  toggle.setAttribute('aria-pressed', String(state.enabled));
  toggle.title = toggle.disabled && state.editing ? 'Salve ou cancele a edição para ativar.' : '';
  document.querySelector('#active-layer-label').textContent = layerById(state.activeLayerId)?.name || '—';
  const names = { linux: 'Linux', darwin: 'macOS', win32: 'Windows' };
  document.querySelector('#platform-label').textContent = (names[state.platform] || state.platform) + (state.session === 'native' ? '' : ' · ' + (state.session === 'wayland' ? 'Wayland' : 'X11'));
  const warning = document.querySelector('#shortcut-warning');
  const failures = state.shortcuts.failed;
  warning.hidden = !failures.length;
  if (failures.length) warning.replaceChildren(icon('alert'), el('div', {}, el('strong', {}, 'Alguns atalhos estão indisponíveis'),
    el('p', {}, failures.map(item => item.key).join(', ') + ' · Outro aplicativo ou uma restrição do sistema pode estar usando estas teclas.')),
    button('Revisar atalhos', () => navigate('settings'), 'small'));
}

function restoreFocus(key) {
  if (!key) return;
  main.querySelector('[data-focus="' + CSS.escape(key) + '"]')?.focus({ preventScroll: true });
}

function render(focusKey) {
  if (!state) return;
  const previousFocus = focusKey || document.activeElement?.dataset.focus;
  if (!layerById()) selectedLayerId = state.activeLayerId;
  keyNodes.clear();
  main.dataset.view = view;
  main.replaceChildren();
  ({ layers: renderLayers, tracking: renderTracking, history: renderHistory, settings: renderSettings })[view]();
  for (const form of main.querySelectorAll('form[data-draft]')) form.dataset.baseline = serializeForm(form);
  restoreFocus(previousFocus);
  updateStatus();
  syncEditing();
}

function navigate(next) {
  if (next === view) return;
  void guardNavigation(() => {
    editor = null;
    view = next;
    for (const item of document.querySelectorAll('[data-view]')) {
      if (item.dataset.view === view) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    render();
    main.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
}

function startEditor(value) {
  void guardNavigation(() => {
    editor = { ...value, returnFocus: document.activeElement?.dataset.focus };
    requestEditing(true);
    render();
    window.scrollTo({ top: 0, behavior: 'instant' });
    main.querySelector('form input')?.focus({ preventScroll: true });
  });
}

function closeEditor() {
  void guardNavigation(() => {
    const focus = editor?.returnFocus;
    editor = null;
    render(focus);
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
}

function empty(title, description, action) {
  return el('div', { class: 'empty-state' }, icon('layers'), el('h3', {}, title), el('p', {}, description), action);
}

function renderLayers() {
  main.append(heading('Camadas e ações', 'Escolha uma camada para configurar o que cada tecla faz.',
    button('Nova camada', () => startEditor({ kind: 'layer', value: null }), '', { symbol: 'plus', 'data-focus': 'new-layer' })));
  const list = el('aside', { class: 'layer-list', 'aria-label': 'Escolher camada para edição' },
    el('div', { class: 'layer-list-heading' }, el('strong', {}, 'Suas camadas'), el('span', {}, state.config.layers.length)));
  const choices = el('div', { class: 'layer-choices' });
  state.config.layers.forEach((layer, index) => choices.append(
    el('button', { type: 'button', class: 'layer-choice' + (layer.id === selectedLayerId ? ' selected' : ''), 'aria-pressed': String(layer.id === selectedLayerId), 'data-focus': 'layer-' + layer.id,
      onclick: () => {
        if (layer.id === selectedLayerId && !editor) return;
        void guardNavigation(() => { selectedLayerId = layer.id; editor = null; actionQuery = ''; render('layer-' + layer.id); });
      } },
    el('span', { class: 'layer-index', 'aria-hidden': 'true' }, index + 1),
    el('span', { class: 'layer-choice-copy' }, el('strong', {}, layer.name), el('small', {}, layer.bindings.length + (layer.bindings.length === 1 ? ' ação' : ' ações'))),
    layer.id === state.activeLayerId ? el('span', { class: 'live-mark', title: 'Camada em uso pelos atalhos' }, 'Em uso') : null)
  ));
  list.append(choices, el('div', { class: 'layer-list-help' }, icon('keyboard'), el('span', {}, 'Alternar camada', shortcut(state.config.settings.layerShortcut, state.platform))));
  const detail = el('section', { class: 'layer-detail', 'aria-label': editor ? 'Editor de configuração' : 'Ações de ' + layerById().name });
  if (editor) {
    detail.append(button('Voltar para as ações', closeEditor, 'quiet back-button', { symbol: 'back' }),
      el('p', { class: 'editor-context' }, editor.kind === 'binding' ? 'Camada: ' + layerById().name : 'Organização das camadas'),
      editor.kind === 'layer' ? layerForm() : bindingForm(layerById()));
  } else {
    const layer = layerById();
    const current = layer.id === state.activeLayerId;
    detail.append(el('div', { class: 'detail-heading' },
      el('div', {}, el('div', { class: 'title-line' }, el('h2', { id: 'layer-title' }, layer.name),
        el('span', { class: 'badge ' + (current ? 'success' : '') }, current ? 'Em uso' : 'Visualizando')),
      el('p', {}, layer.description || 'Defina uma tecla e a ação que ela deve executar.')),
      el('div', { class: 'button-row' }, !current ? button('Usar esta camada', () => void perform(async () => { state = await api.setLayer(layer.id); render(); return state; }, 'Camada em uso: ' + layer.name), '', { symbol: 'layers' }) : null,
        button('Editar camada', () => startEditor({ kind: 'layer', value: layer }), 'quiet', { symbol: 'edit', 'data-focus': 'edit-layer' }))));
    if (!current) detail.append(el('p', { class: 'context-note' }, icon('layers'), 'Os atalhos continuam usando ' + layerById(state.activeLayerId).name + '. Clique em “Usar esta camada” para trocar.'));
    const search = field('action-search', 'Buscar ações', actionQuery, { type: 'search', placeholder: 'Buscar por nome, tecla ou tipo de ação' });
    search.input.addEventListener('input', () => { actionQuery = search.input.value; updateBindings(); });
    detail.append(el('div', { class: 'section-toolbar' }, el('div', {}, el('h3', {}, 'Teclas configuradas'), el('p', { id: 'action-count' }, '')),
      button('Nova ação', () => startEditor({ kind: 'binding', value: null }), 'primary', { symbol: 'plus', 'data-focus': 'new-binding' })));
    if (layer.bindings.length) detail.append(el('div', { class: 'search-field' }, icon('search'), search.wrapper));
    detail.append(el('div', { id: 'bindings', class: 'binding-list' }),
      el('p', { class: 'test-explanation' }, icon('play'), 'Executar teste realiza a ação de verdade, mesmo com os atalhos pausados.'));
  }
  main.append(el('div', { class: 'layer-layout' }, list, detail),
    el('div', { class: 'help-strip' }, el('div', {}, el('strong', {}, 'Controle pelo teclado'), el('span', {}, shortcut(state.config.settings.layerShortcut, state.platform), ' alterna a camada · ', shortcut(state.config.settings.pauseShortcut, state.platform), ' pausa ou retoma')),
      el('p', {}, 'Enquanto ativas, as teclas configuradas podem substituir a digitação em outros programas.')));
  if (!editor) updateBindings();
}

function actionSummary(action) {
  if (action.type === 'http') return action.method + ' ' + action.url;
  if (action.type === 'file') return (action.mode === 'append' ? 'Acrescentar em ' : 'Criar ') + action.filename;
  return action.message;
}

function updateBindings() {
  const container = document.querySelector('#bindings');
  if (!container) return;
  const layer = layerById();
  const query = actionQuery.trim().toLocaleLowerCase('pt-BR');
  const matches = layer.bindings.filter(binding => [binding.name, binding.key, labels[binding.action.type]].join(' ').toLocaleLowerCase('pt-BR').includes(query));
  const focus = document.activeElement?.dataset.focus;
  document.querySelector('#action-count').textContent = query ? matches.length + ' de ' + layer.bindings.length + ' ações encontradas' : layer.bindings.length + (layer.bindings.length === 1 ? ' ação nesta camada' : ' ações nesta camada');
  container.replaceChildren();
  if (!matches.length) {
    container.append(query
      ? empty('Nenhuma ação encontrada', 'Tente outro nome, tecla ou tipo.', button('Limpar busca', () => { actionQuery = ''; render(); }))
      : empty('Escolha sua primeira tecla', 'Associe uma tecla a uma requisição, um arquivo ou uma mensagem de log.',
        button('Criar primeira ação', () => startEditor({ kind: 'binding', value: null }), '', { symbol: 'plus' })));
  }
  for (const binding of matches) {
    const pending = pendingBindings.has(binding.id);
    const lastResult = state.events.find(event => event.kind === 'action' && event.layer === layer.name && event.key === binding.key);
    const result = pending ? el('p', { class: 'binding-result info', role: 'status' }, 'Executando ação…') : lastResult ? el('p', { class: 'binding-result ' + lastResult.status },
      icon(lastResult.status === 'error' ? 'alert' : 'check'), lastResult.message) : null;
    container.append(el('article', { class: 'binding-row', 'aria-label': binding.name },
      el('div', { class: 'binding-key' }, shortcut(binding.key, state.platform)),
      el('div', { class: 'binding-copy' },
        el('div', { class: 'binding-title' }, el('h4', {}, binding.name), el('span', { class: 'type-label' }, icon(binding.action.type), labels[binding.action.type])),
        el('p', { class: 'binding-summary', title: actionSummary(binding.action) }, actionSummary(binding.action)), result),
      el('div', { class: 'binding-actions' },
        button(pending ? 'Executando…' : 'Executar teste', () => void runBinding(layer, binding), 'quiet', { symbol: 'play', disabled: pending, 'aria-label': 'Executar teste: ' + binding.name, 'data-focus': 'test-' + binding.id }),
        button('Editar', () => startEditor({ kind: 'binding', value: binding }), '', { symbol: 'edit', 'aria-label': 'Editar ação: ' + binding.name, 'data-focus': 'edit-' + binding.id }),
        button('Remover ação: ' + binding.name, () => void removeBinding(layer, binding), 'quiet danger', { symbol: 'trash', iconOnly: true, title: 'Remover ação', 'data-focus': 'remove-' + binding.id }))));
  }
  restoreFocus(focus);
}

async function runBinding(layer, binding) {
  if (pendingBindings.has(binding.id)) return;
  pendingBindings.add(binding.id);
  const previous = new Set(state.events.map(event => event.id));
  updateBindings();
  try {
    state = await api.runBinding(layer.id, binding.id);
    const result = state.events.find(event => !previous.has(event.id) && event.kind === 'action' && event.key === binding.key && event.layer === layer.name);
    if (result) toast(result.message, result.status);
  } catch (error) { toast(error.message, 'error'); }
  finally { pendingBindings.delete(binding.id); updateBindings(); }
}

async function removeBinding(layer, binding) {
  if (!await confirmDialog({ title: 'Remover esta ação?', message: '“' + binding.name + '” deixará de ser executada pela tecla ' + binding.key + ' nesta camada.', confirmLabel: 'Remover ação', danger: true })) return;
  const config = copyConfig();
  config.layers.find(item => item.id === layer.id).bindings = layer.bindings.filter(item => item.id !== binding.id);
  await perform(() => saveConfiguration(config), 'Ação removida.');
}

async function removeLayer(layer) {
  if (!await confirmDialog({ title: 'Remover a camada “' + layer.name + '”?', message: 'Esta camada e suas ' + layer.bindings.length + ' ações serão removidas da configuração.', confirmLabel: 'Remover camada', danger: true })) return;
  const config = copyConfig();
  config.layers = config.layers.filter(item => item.id !== layer.id);
  await perform(() => saveConfiguration(config), 'Camada removida.');
}

async function saveConfiguration(config, focusKey) {
  const result = await api.saveConfig(config);
  state = result;
  editor = null;
  stopCapture();
  render(focusKey);
  window.scrollTo({ top: 0, behavior: 'instant' });
  return result;
}

function shortcutField(name, label, value, hint) {
  const item = field(name, label, value, { required: true, placeholder: 'Ex.: A ou Control+Shift+A', hint });
  const record = button('Capturar tecla', () => {
    if (capture?.input === item.input) { stopCapture(); return; }
    stopCapture();
    capture = { input: item.input, button: record };
    record.replaceChildren(icon('keyboard'), el('span', {}, 'Pressione uma tecla…'));
    record.setAttribute('aria-pressed', 'true');
    item.wrapper.classList.add('capturing');
    announce('Pressione a combinação desejada. Escape cancela.');
    requestEditing(true);
    record.focus();
  }, '', { symbol: 'keyboard', 'aria-pressed': 'false' });
  const controls = el('div', { class: 'input-with-button' });
  item.input.replaceWith(controls);
  controls.append(item.input, record);
  return item.wrapper;
}

function stopCapture() {
  if (capture) {
    capture.button.replaceChildren(icon('keyboard'), el('span', {}, 'Capturar tecla'));
    capture.button.setAttribute('aria-pressed', 'false');
    capture.input.closest('.field').classList.remove('capturing');
  }
  capture = null;
}

function formError(form, error) {
  const box = form.querySelector('.form-errors');
  box.replaceChildren(icon('alert'), el('p', {}, error.message || String(error)));
  box.hidden = false;
  const input = error.fieldName ? form.elements.namedItem(error.fieldName) : form.querySelector('[aria-invalid="true"]');
  if (input instanceof HTMLElement) {
    input.setAttribute('aria-invalid', 'true');
    for (let parent = input.parentElement; parent && parent !== form; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
    input.focus();
  } else box.focus();
}

function invalid(message, fieldName) {
  const error = new Error(message);
  error.fieldName = fieldName;
  throw error;
}

function formShell(title, description, submit, ...content) {
  return el('form', { class: 'editor', 'data-draft': '', onsubmit: async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const label = button.textContent;
    button.textContent = 'Salvando…';
    form.querySelector('.form-errors').hidden = true;
    for (const input of form.querySelectorAll('[aria-invalid]')) input.removeAttribute('aria-invalid');
    try { await submit(form); }
    catch (error) { formError(form, error); }
    finally { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = label; }
  } },
    el('div', { class: 'editor-heading' }, el('h2', {}, title), el('p', {}, description)),
    el('div', { class: 'form-errors', role: 'alert', tabindex: '-1', hidden: true }),
    el('div', { class: 'form-fields' }, content),
    el('div', { class: 'form-footer' }, el('span', { id: 'draft-status' }, 'Nenhuma alteração pendente'),
      el('div', { class: 'button-row' }, button('Cancelar', closeEditor), el('button', { type: 'submit', class: 'button primary' }, icon('save'), 'Salvar alterações'))));
}

function layerForm() {
  const current = editor.value;
  const form = formShell(current ? 'Editar camada' : 'Nova camada', 'Dê um nome que ajude a reconhecer o contexto destas teclas.', async form => {
    const data = new FormData(form);
    const name = String(data.get('name')).trim();
    if (!name) invalid('Informe um nome para a camada.', 'name');
    const value = { id: current?.id || newId('layer'), name, description: String(data.get('description')).trim(), bindings: current?.bindings || [] };
    const config = copyConfig();
    if (current) config.layers[config.layers.findIndex(layer => layer.id === current.id)] = value;
    else config.layers.push(value);
    selectedLayerId = value.id;
    actionQuery = '';
    await saveConfiguration(config, 'edit-layer');
    toast('Camada salva.');
  },
    field('name', 'Nome da camada', current?.name || '', { required: true, maxlength: 80, placeholder: 'Ex.: Trabalho, reuniões ou arquivos' }).wrapper,
    field('description', 'Descrição', current?.description || '', { maxlength: 240, placeholder: 'Para que você vai usar esta camada?', hint: 'Opcional. Aparece junto das ações.' }).wrapper);
  if (current && state.config.layers.length > 1) form.append(el('div', { class: 'danger-zone' }, el('div', {}, el('h3', {}, 'Remover camada'), el('p', {}, 'Remove também as ' + current.bindings.length + ' ações cadastradas nela.')),
    button('Remover camada', () => void removeLayer(current), 'danger', { symbol: 'trash' })));
  return form;
}

function mapField(name, title, values, hint) {
  const rows = el('div', { class: 'map-rows' });
  const addRow = (key = '', value = '', focus = false) => {
    const index = newId('row');
    const keyInput = el('input', { name: name + '-key', 'aria-label': title + ': nome', placeholder: 'Nome', 'data-row': index });
    const valueInput = el('input', { name: name + '-value', 'aria-label': title + ': valor', placeholder: 'Valor', 'data-row': index });
    keyInput.value = key;
    valueInput.value = value;
    const row = el('div', { class: 'map-row' }, keyInput, valueInput, button('Remover parâmetro', () => {
      row.remove();
      if (!rows.children.length) addRow();
      rows.querySelector('input')?.focus();
      syncEditing();
    }, 'quiet danger', { symbol: 'trash', iconOnly: true, title: 'Remover parâmetro' }));
    rows.append(row);
    if (focus) keyInput.focus();
  };
  const entries = Object.entries(values || {});
  (entries.length ? entries : [['', '']]).forEach(([key, value]) => addRow(key, value));
  return el('fieldset', { class: 'map-field', 'data-map': name }, el('legend', {}, title), el('p', { class: 'hint' }, hint),
    el('div', { class: 'map-column-labels', 'aria-hidden': 'true' }, el('span', {}, 'Nome'), el('span', {}, 'Valor')), rows,
    button('Adicionar parâmetro', () => { addRow('', '', true); syncEditing(); }, 'quiet small', { symbol: 'plus' }));
}

function readMap(container, name) {
  const result = {};
  for (const row of container.querySelectorAll('[data-map="' + name + '"] .map-row')) {
    const keyInput = row.querySelector('[name="' + name + '-key"]');
    const valueInput = row.querySelector('[name="' + name + '-value"]');
    const key = keyInput.value.trim();
    if (!key && !valueInput.value) continue;
    if (!key) { keyInput.setAttribute('aria-invalid', 'true'); keyInput.focus(); throw new Error('Informe o nome do parâmetro que possui um valor.'); }
    if (Object.hasOwn(result, key)) { keyInput.setAttribute('aria-invalid', 'true'); keyInput.focus(); throw new Error('O parâmetro “' + key + '” está repetido.'); }
    Object.defineProperty(result, key, { value: valueInput.value, enumerable: true, configurable: true });
  }
  return result;
}

function bindingForm(layer) {
  const current = editor.value;
  const currentAction = current?.action || { type: 'log', message: '' };
  const actionFields = el('div', { class: 'action-fields' });
  const type = field('type', 'O que esta tecla deve fazer?', currentAction.type, { choices: Object.entries(labels).map(([key, value]) => [key, value === 'Arquivo' ? 'Criar ou acrescentar em um arquivo' : value === 'Log' ? 'Salvar uma mensagem no log' : value]) });
  const drafts = {};
  let activeType = currentAction.type;
  function rememberFields() {
    const values = Object.fromEntries([...actionFields.querySelectorAll('[name]')].filter(input => !input.name.endsWith('-key') && !input.name.endsWith('-value')).map(input => [input.name, input.value]));
    // Draft rows are kept verbatim, including incomplete pairs, when switching types.
    for (const name of ['headers', 'query']) values[name + 'Rows'] = [...actionFields.querySelectorAll('[data-map="' + name + '"] .map-row')].map(row => [...row.querySelectorAll('input')].map(input => input.value));
    drafts[activeType] = values;
  }
  function showActionFields(actionType) {
    actionFields.replaceChildren();
    const values = drafts[actionType] || (actionType === currentAction.type ? currentAction : {});
    if (actionType === 'http') {
      const method = field('method', 'Método', values.method || 'POST', { choices: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map(value => [value, value]) });
      const url = field('url', 'URL de destino', values.url || '', { required: true, type: 'url', placeholder: 'https://api.exemplo.com/eventos' });
      const body = field('body', 'Corpo da requisição', values.body || '', { multiline: true, className: 'mono', spellcheck: 'false', placeholder: '{"evento":"iniciar","tecla":"{{key}}"}', hint: 'Opcional. Para JSON, adicione o header Content-Type com valor application/json.' });
      const note = el('p', { class: 'context-note' }, icon('http'), 'GET e HEAD enviam os dados pelos parâmetros da URL e não aceitam corpo.');
      const headers = mapField('headers', 'Headers', values.headers, 'Ex.: Content-Type → application/json ou Authorization → Bearer seu-token.');
      const query = mapField('query', 'Parâmetros da URL', values.query, 'Os valores são codificados e acrescentados à URL automaticamente.');
      const advanced = el('details', { class: 'advanced-fields', open: Boolean(values.headersRows?.some(row => row.some(Boolean)) || values.queryRows?.some(row => row.some(Boolean)) || Object.keys(values.headers || {}).length || Object.keys(values.query || {}).length) },
        el('summary', {}, 'Parâmetros e headers', el('span', {}, 'Autenticação e dados da URL')), query, headers);
      actionFields.append(el('div', { class: 'http-destination' }, method.wrapper, url.wrapper), body.wrapper, note, advanced);
      function updateMethod() {
        const noBody = ['GET', 'HEAD'].includes(method.input.value);
        body.input.disabled = noBody;
        body.wrapper.hidden = noBody;
        note.hidden = !noBody;
      }
      method.input.addEventListener('change', updateMethod);
      updateMethod();
      for (const name of ['headers', 'query']) {
        if (!values[name + 'Rows']) continue;
        const rows = actionFields.querySelector('[data-map="' + name + '"] .map-rows');
        const add = actionFields.querySelector('[data-map="' + name + '"] > button');
        while (rows.children.length < values[name + 'Rows'].length) add.click();
        [...rows.children].forEach((row, i) => {
          const inputs = row.querySelectorAll('input');
          inputs[0].value = values[name + 'Rows'][i]?.[0] || '';
          inputs[1].value = values[name + 'Rows'][i]?.[1] || '';
        });
      }
    }
    if (actionType === 'file') {
      const directory = field('directory', 'Pasta de destino', values.directory || '', { placeholder: 'Pasta padrão em Documentos', hint: 'Deixe vazio para usar ' + defaultFilesPath() });
      const controls = el('div', { class: 'input-with-button' });
      directory.input.replaceWith(controls);
      controls.append(directory.input, button('Escolher pasta', () => void perform(async () => {
        const path = await api.chooseDirectory();
        if (path) { directory.input.value = path; syncEditing(); }
      }), '', { symbol: 'folder' }));
      actionFields.append(directory.wrapper,
        el('div', { class: 'form-grid' }, field('filename', 'Nome do arquivo', values.filename || '', { required: true, placeholder: 'nota-{{timestamp}}.txt', hint: 'Use {{timestamp}} para criar um arquivo diferente a cada execução.' }).wrapper,
          field('mode', 'Como salvar', values.mode || 'create', { choices: [['create', 'Criar novo · sem sobrescrever'], ['append', 'Acrescentar ao final']] }).wrapper),
        field('content', 'Conteúdo do arquivo', values.content || '', { multiline: true, placeholder: 'Criado pela tecla {{key}} em {{date}}.' }).wrapper);
    }
    if (actionType === 'log') actionFields.append(field('message', 'Mensagem do log', values.message || '', { required: true, multiline: true, placeholder: 'A tecla {{key}} foi acionada na camada {{layer}}.', hint: 'A mensagem fica no arquivo de log local. O resultado aparece no Histórico.' }).wrapper);
    activeType = actionType;
  }
  type.input.addEventListener('change', () => { rememberFields(); showActionFields(type.input.value); });
  showActionFields(currentAction.type);
  return formShell(current ? 'Editar ação' : 'Nova ação', 'Configure a tecla e depois escolha o que ela executa.', async form => {
    const data = new FormData(form);
    const name = String(data.get('name')).trim();
    const key = String(data.get('key')).trim();
    if (!name) invalid('Dê um nome para identificar esta ação.', 'name');
    if (!key) invalid('Digite ou capture uma tecla para esta ação.', 'key');
    const actionType = data.get('type');
    let action;
    if (actionType === 'http') {
      const url = String(data.get('url')).trim();
      let parsed;
      try { parsed = new URL(url); } catch { invalid('Informe uma URL completa, começando com http:// ou https://.', 'url'); }
      if (!['http:', 'https:'].includes(parsed.protocol)) invalid('Use uma URL HTTP ou HTTPS.', 'url');
      action = { type: 'http', method: data.get('method'), url, headers: readMap(form, 'headers'), query: readMap(form, 'query'), body: data.get('body') || '' };
    } else if (actionType === 'file') action = { type: 'file', directory: String(data.get('directory')).trim(), filename: String(data.get('filename')).trim(), mode: data.get('mode'), content: data.get('content') };
    else action = { type: 'log', message: data.get('message') };
    const binding = { id: current?.id || newId('binding'), name, key, action };
    const config = copyConfig();
    const bindings = config.layers.find(item => item.id === layer.id).bindings;
    if (current) bindings[bindings.findIndex(item => item.id === current.id)] = binding;
    else bindings.push(binding);
    await saveConfiguration(config, 'edit-' + binding.id);
    toast('Ação salva em ' + layer.name + '.');
  },
    el('div', { class: 'form-grid' }, field('name', 'Nome da ação', current?.name || '', { required: true, maxlength: 100, placeholder: 'Ex.: Enviar evento de início' }).wrapper,
      shortcutField('key', 'Tecla ou combinação', current?.key || '', 'Capture a combinação ou digite, por exemplo, Control+Shift+A.')),
    el('section', { class: 'action-configuration' }, type.wrapper, actionFields),
    el('details', { class: 'variable-help' }, el('summary', {}, 'Personalizar com variáveis'), el('p', {}, 'Use nos valores de parâmetros, headers, mensagens, corpo e conteúdo de arquivos.'),
      el('dl', {}, [['{{key}}', 'Tecla configurada'], ['{{layer}}', 'Nome da camada'], ['{{date}}', 'Data UTC: ano-mês-dia'], ['{{timestamp}}', 'Instante UTC, seguro para nomes de arquivo']].map(([term, description]) => [el('dt', {}, el('code', {}, term)), el('dd', {}, description)]))));
}

function renderTracking() {
  main.append(heading('Rastreio do teclado', 'Acompanhe as teclas enquanto são pressionadas e soltas.'));
  const tracking = state.tracking;
  const mode = !tracking.enabled ? 'Desligado' : tracking.mode === 'global' ? 'Captura global' : tracking.mode === 'starting' ? 'Iniciando captura' : 'Somente nesta janela';
  const toggle = el('input', { type: 'checkbox', role: 'switch', checked: tracking.enabled, 'aria-label': 'Ativar rastreio do teclado', onchange: async () => {
    toggle.disabled = true;
    try { state = await api.setTracking(toggle.checked); clearPressed(); render(); }
    catch (error) { toggle.checked = tracking.enabled; toast(error.message, 'error'); }
    finally { toggle.disabled = false; }
  } });
  main.append(el('div', { class: 'tracking-toolbar' }, el('div', { class: 'tracking-mode' }, el('span', { class: 'status-dot' + (tracking.enabled ? ' enabled' : '') }), el('strong', {}, mode)),
    el('label', { class: 'switch' }, toggle, el('span', { class: 'switch-track', 'aria-hidden': 'true' }), 'Ativar rastreio')));
  if (tracking.enabled && tracking.mode === 'local') main.append(el('div', { class: 'context-note tracking-limitation', role: 'status' }, icon('alert'), el('p', {}, tracking.message)));
  else main.append(el('p', { class: 'tracking-message' }, !tracking.enabled ? 'Ative o rastreio e pressione uma tecla para começar.' : tracking.mode === 'starting' ? 'Conectando a captura ao sistema…' : 'Você pode alternar para outro programa. As teclas continuam aparecendo aqui.'));
  main.append(el('section', { class: 'pressed-panel', 'aria-label': 'Teclas pressionadas agora' }, el('div', {}, el('h2', {}, 'Pressionadas agora'), el('p', { id: 'pressed-label', role: 'status', 'aria-atomic': 'true' }, 'Nenhuma tecla pressionada')),
    el('div', { id: 'pressed-keys', class: 'pressed-keys', 'aria-hidden': 'true' })),
    keyboardView(state.platform, keyNodes),
    el('div', { class: 'keyboard-caption' }, el('span', { class: 'key-legend' }, el('span', { class: 'legend-square' }), 'Tecla pressionada'),
      el('span', {}, 'Referência física QWERTY · inclui teclado numérico')),
    el('div', { class: 'privacy-note' }, icon('check'), el('p', {}, 'Visualização temporária: as teclas rastreadas não são gravadas em arquivo nem no histórico. As ações configuradas têm um controle independente na barra superior.')));
  updateKeys();
}

function keyEvent(event) {
  if (!state?.tracking.enabled) return;
  if (event.direction === 'down' && pressed.has(event.code)) return;
  if (event.direction === 'up' && !pressed.has(event.code)) return;
  if (event.direction === 'down') pressed.set(event.code, event.key || event.code);
  else pressed.delete(event.code);
  updateKeys();
}

function updateKeys() {
  for (const [code, node] of keyNodes) node.classList.toggle('pressed', pressed.has(code));
  const label = document.querySelector('#pressed-label');
  if (label) label.textContent = pressed.size ? [...pressed.values()].join(' + ') : state?.tracking.enabled ? 'Nenhuma tecla pressionada' : 'O rastreio está desligado';
  const keys = document.querySelector('#pressed-keys');
  if (keys) keys.replaceChildren(...[...pressed.values()].map(key => el('kbd', { class: 'pressed-chip' }, key)));
}

function clearPressed() { pressed.clear(); updateKeys(); }

function renderHistory() {
  main.append(heading('Histórico de execução', 'Confira o resultado das ações e identifique o que precisa de atenção.',
    button('Abrir pasta de dados', () => void perform(() => api.openDataDirectory()), '', { symbol: 'folder' })));
  const filters = [['all', 'Tudo'], ['action', 'Ações'], ['error', 'Erros']];
  const search = field('history-search', 'Buscar no histórico', historyQuery, { type: 'search', placeholder: 'Buscar por mensagem, camada ou tecla' });
  search.input.addEventListener('input', () => { historyQuery = search.input.value; updateHistory(); });
  main.append(el('div', { class: 'history-toolbar' }, el('div', { class: 'filter-group', role: 'group', 'aria-label': 'Filtrar eventos' }, filters.map(([value, label]) =>
    button(label, () => { historyFilter = value; render('filter-' + value); }, historyFilter === value ? 'selected' : 'quiet', { 'aria-pressed': String(historyFilter === value), 'data-focus': 'filter-' + value }))),
    el('div', { class: 'search-field' }, icon('search'), search.wrapper)),
    el('p', { id: 'history-count', class: 'result-count' }),
    el('div', { id: 'events', class: 'event-list' }),
    el('p', { class: 'history-footnote' }, 'Até 100 eventos desta sessão. Os resultados das ações também ficam no log em disco.'));
  updateHistory();
}

function updateHistory() {
  const container = document.querySelector('#events');
  if (!container) return;
  const query = historyQuery.trim().toLocaleLowerCase('pt-BR');
  const events = state.events.filter(event => (historyFilter === 'all' || (historyFilter === 'error' ? event.status === 'error' : event.kind === 'action')) &&
    [event.message, event.layer, event.key].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR').includes(query));
  document.querySelector('#history-count').textContent = events.length + (events.length === 1 ? ' evento encontrado' : ' eventos encontrados');
  container.replaceChildren();
  if (!events.length) {
    container.append(empty(query ? 'Nenhum evento encontrado' : historyFilter === 'error' ? 'Nenhum erro registrado' : 'Seu histórico começa com uma ação',
      query ? 'Tente outra busca ou altere o filtro.' : historyFilter === 'error' ? 'As falhas de execução aparecerão aqui com o motivo.' : 'Execute um teste em Camadas para conferir o resultado aqui.',
      !query && historyFilter !== 'error' ? button('Configurar ações', () => navigate('layers'), '', { symbol: 'layers' }) : null));
    return;
  }
  container.append(el('div', { class: 'event-columns', 'aria-hidden': 'true' }, 'Resultado', 'Evento', 'Horário'));
  for (const event of events) {
    const date = new Date(event.time);
    const valid = !Number.isNaN(date.getTime());
    container.append(el('article', { class: 'event-row' },
      el('span', { class: 'event-status ' + event.status }, icon(event.status === 'error' ? 'alert' : event.status === 'success' ? 'check' : 'layers'),
        { success: 'Concluído', error: 'Erro', info: 'Sistema' }[event.status] || event.status),
      el('div', { class: 'event-copy' }, el('p', { class: 'event-message' }, event.message),
        event.layer || event.key ? el('p', { class: 'event-meta' }, event.layer, event.key ? shortcut(event.key, state.platform) : null) : null),
      el('time', { datetime: valid ? date.toISOString() : undefined, title: valid ? date.toLocaleString('pt-BR') : '' },
        valid ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—')));
  }
}

function defaultFilesPath() {
  const separator = state.platform === 'win32' ? '\\' : '/';
  return state.paths.documents.replace(/[\\/]$/, '') + separator + 'Keyboard Tracker';
}

function renderSettings() {
  main.append(heading('Configurações', 'Controle seus atalhos gerais, dados e permissões.'));
  const settings = state.config.settings;
  const shortcutForm = formShell('Atalhos de controle', 'Estes atalhos valem para todas as camadas.', async form => {
    const data = new FormData(form);
    const config = copyConfig();
    config.settings = { ...settings, layerShortcut: String(data.get('layerShortcut')).trim(), pauseShortcut: String(data.get('pauseShortcut')).trim(), cooldownMs: Number(data.get('cooldownMs')) };
    await saveConfiguration(config, 'save-settings');
    toast('Configurações salvas.');
  },
    el('div', { class: 'form-grid' }, shortcutField('layerShortcut', 'Alternar camada', settings.layerShortcut, 'Percorre suas camadas na ordem da lista.'),
      shortcutField('pauseShortcut', 'Pausar ou retomar ações', settings.pauseShortcut, 'Disponível após a primeira ativação pelo botão.')),
    el('details', { class: 'advanced-fields' }, el('summary', {}, 'Repetição das ações'),
      field('cooldownMs', 'Intervalo mínimo (milissegundos)', settings.cooldownMs, { type: 'number', required: true, min: 100, max: 10000, step: 1, hint: '400 ms = 0,4 segundo. Uma tecla mantida pressionada pode disparar novamente depois deste intervalo.' }).wrapper));
  shortcutForm.classList.add('settings-form');
  shortcutForm.querySelector('.form-footer .button-row').replaceChildren(
    button('Descartar alterações', () => void guardNavigation(() => render()), 'quiet'),
    el('button', { type: 'submit', class: 'button primary', 'data-focus': 'save-settings' }, icon('save'), 'Salvar configurações'));
  const data = el('section', { class: 'settings-section' }, el('div', { class: 'section-heading' }, icon('folder'), el('div', {}, el('h2', {}, 'Dados e backups'), el('p', {}, 'Suas camadas e ações ficam salvas neste computador.'))),
    el('div', { class: 'backup-row' }, el('div', {}, el('h3', {}, 'Levar a configuração para outro computador'), el('p', {}, 'Exporte uma cópia antes de importar ou substituir suas camadas.')),
      el('div', { class: 'button-row' }, button('Exportar', () => void perform(() => api.exportConfig()), '', { symbol: 'download' }),
        button('Importar', () => void guardNavigation(() => void importConfiguration()), '', { symbol: 'upload' }))),
    el('div', { class: 'path-list' }, [['Dados do aplicativo', state.paths.data], ['Arquivos criados por padrão', defaultFilesPath()], ['Log de execução', state.paths.log]].map(([label, path]) =>
      el('div', { class: 'path-row' }, el('strong', {}, label), el('code', {}, path)))),
    button('Abrir pasta de dados', () => void perform(() => api.openDataDirectory()), '', { symbol: 'folder' }),
    el('p', { class: 'hint token-note' }, 'Tokens de API ficam na configuração e na cópia exportada. Guarde o arquivo em um local de confiança.'));
  const support = el('section', { class: 'settings-section' }, el('div', { class: 'section-heading' }, icon('keyboard'), el('div', {}, el('h2', {}, 'Captura e permissões'), el('p', {}, 'A disponibilidade da captura depende do sistema operacional.'))),
    el('div', { class: 'platform-note' }, el('strong', {}, state.platform === 'linux' && state.session === 'wayland' ? 'Você está no Linux com Wayland' : state.platform === 'darwin' ? 'Você está no macOS' : state.platform === 'win32' ? 'Você está no Windows' : 'Você está no Linux com X11'),
      el('p', {}, state.session === 'wayland' ? 'O teclado visual funciona com esta janela em foco. Para rastreio global integral, use uma sessão X11. Os atalhos globais dependem do portal do compositor.' : state.platform === 'darwin' ? 'Autorize o aplicativo em Privacidade e Segurança → Acessibilidade. O sistema também pode solicitar Monitoramento de Entrada.' : 'Atalhos ocupados por outro programa são informados na barra de avisos. O rastreio global pode depender de permissões da sessão.')),
    el('p', { class: 'hint' }, 'Ao abrir o aplicativo, as ações começam pausadas e o rastreio desligado.'));
  main.append(shortcutForm, data, support);
}

async function importConfiguration() {
  if (!await confirmDialog({ title: 'Substituir a configuração atual?', message: 'O arquivo escolhido substituirá suas camadas e atalhos. Exporte uma cópia se quiser guardar a configuração atual.', confirmLabel: 'Escolher arquivo', danger: true })) return;
  await perform(async () => {
    state = await api.importConfig();
    editor = null;
    selectedLayerId = state.activeLayerId;
    actionQuery = '';
    render();
  });
}

function accelerator(event) {
  if (['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(event.code)) return null;
  const parts = [];
  if (event.metaKey) parts.push(state.platform === 'darwin' ? 'Command' : 'Super');
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  const mapped = { Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
  const key = event.code.startsWith('Key') ? event.code.slice(3) : event.code.startsWith('Digit') ? event.code.slice(5) : mapped[event.code] || event.code;
  if (!key || key === 'Unidentified') return null;
  return [...parts, key].join('+');
}

document.addEventListener('focusin', syncEditing);
document.addEventListener('focusout', () => queueMicrotask(syncEditing));
document.addEventListener('input', event => { event.target.removeAttribute('aria-invalid'); syncEditing(); });
document.addEventListener('change', syncEditing);
document.addEventListener('keydown', event => {
  if (document.querySelector('#confirm-dialog').open) return;
  if (capture) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { stopCapture(); syncEditing(); return; }
    const value = accelerator(event);
    if (value) {
      const input = capture.input;
      input.value = value;
      stopCapture();
      input.focus();
      syncEditing();
      announce('Atalho capturado: ' + value);
    }
    return;
  }
  if (state?.tracking.enabled && state.tracking.mode === 'local') keyEvent({ code: event.code, key: event.key === ' ' ? 'Espaço' : event.key, direction: 'down' });
}, true);
document.addEventListener('keyup', event => {
  if (state?.tracking.enabled && state.tracking.mode === 'local') keyEvent({ code: event.code, direction: 'up' });
}, true);
window.addEventListener('blur', () => { if (state?.tracking.mode !== 'global') clearPressed(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state?.tracking.mode !== 'global') clearPressed(); });
window.addEventListener('beforeunload', event => {
  if (!closingAllowed && isDirty()) {
    event.preventDefault();
    event.returnValue = false;
    // Let Electron finish cancelling the close before opening a DOM dialog.
    setTimeout(() => {
      void confirmDialog({ title: 'Sair sem salvar?', message: 'Você tem alterações que ainda não foram salvas.', confirmLabel: 'Descartar e sair', cancelLabel: 'Continuar editando', danger: true }).then(confirmed => {
        if (confirmed) { closingAllowed = true; window.close(); }
      });
    }, 0);
  }
});
document.querySelector('#navigation').addEventListener('click', event => {
  const target = event.target.closest('[data-view]');
  if (target && state) navigate(target.dataset.view);
});
for (const item of document.querySelectorAll('[data-view]')) item.prepend(icon({ layers: 'layers', tracking: 'keyboard', history: 'history', settings: 'settings' }[item.dataset.view]));
document.querySelector('#engine-toggle').addEventListener('click', () => void perform(async () => {
  state = await api.setEnabled(!state.enabled);
  const error = state.events[0];
  if (error?.status === 'error') toast(error.message, 'error');
  updateStatus();
}));

if (!api) {
  document.querySelector('#engine-status').textContent = 'Aplicativo desktop necessário';
  document.querySelector('#engine-detail').textContent = 'Abra a versão instalada para usar a captura nativa.';
  main.replaceChildren(heading('Abra no aplicativo desktop', 'Atalhos globais e ações locais precisam da integração com o sistema operacional.'));
} else {
  try {
    state = await api.getState();
    selectedLayerId = state.activeLayerId;
    render();
    api.onState(next => {
      const previous = state;
      const configChanged = JSON.stringify(previous.config) !== JSON.stringify(next.config);
      const layerChanged = previous.activeLayerId !== next.activeLayerId;
      const trackingChanged = JSON.stringify(previous.tracking) !== JSON.stringify(next.tracking);
      state = next;
      updateStatus();
      if (trackingChanged) clearPressed();
      if (layerChanged && !editor && selectedLayerId === previous.activeLayerId) { selectedLayerId = next.activeLayerId; actionQuery = ''; }
      if (view === 'history') updateHistory();
      if (view === 'layers' && !editor && !layerChanged && !configChanged) updateBindings();
      if (!editor && !isDirty() && !textFocus() && (configChanged || layerChanged || (view === 'tracking' && trackingChanged))) render();
    });
    api.onKey(keyEvent);
  } catch (error) {
    document.querySelector('#engine-status').textContent = 'Não foi possível iniciar';
    document.querySelector('#engine-detail').textContent = 'Feche e abra o aplicativo novamente.';
    main.replaceChildren(heading('Não foi possível carregar suas camadas', 'A configuração foi preservada. Feche e abra o aplicativo para tentar novamente.'));
    toast(error.message, 'error');
  }
}
