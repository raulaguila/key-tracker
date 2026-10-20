const api = window.keyboardTracker;
const main = document.querySelector('#main');
let state = null;
let view = 'layers';
let selectedLayerId = null;
let editor = null;
let deleting = null;
let historyFilter = 'all';
let capture = null;
let editingRequested = false;
let editingQueue = Promise.resolve();
const pressed = new Map();
const keyNodes = new Map();
const labels = { http: 'Request HTTP', file: 'Arquivo', log: 'Mensagem no log' };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'class') node.className = value;
    else if (name === 'text') node.textContent = value;
    else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else if (name === 'checked' || name === 'disabled' || name === 'required') node[name] = Boolean(value);
    else if (value !== undefined && value !== null) node.setAttribute(name, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function button(text, handler, className = '', attrs = {}) {
  return el('button', { type: 'button', class: `button ${className}`, onclick: handler, ...attrs }, text);
}

function heading(title, description, action) {
  return el('div', { class: 'page-heading' }, el('div', {}, el('h1', {}, title), el('p', { class: 'page-description' }, description)), action);
}

function alertError(error) {
  const notice = document.querySelector('#notice');
  notice.replaceChildren(el('span', {}, error?.message || String(error)), button('Fechar', () => { notice.hidden = true; }, 'quiet small', { 'aria-label': 'Fechar mensagem de erro' }));
  notice.hidden = false;
}

function announce(text) { document.querySelector('#announcement').textContent = text; }
function configCopy() { return structuredClone(state.config); }
function layerById(id = selectedLayerId) { return state.config.layers.find(layer => layer.id === id); }
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }

async function perform(task, successMessage = '') {
  if (!api) return;
  try {
    const result = await task();
    if (result?.config) state = result;
    if (successMessage) announce(successMessage);
    return result;
  } catch (error) {
    alertError(error);
    throw error;
  } finally {
    updateStatus();
  }
}

function fire(task, message) { void perform(task, message).catch(() => {}); }

function updateStatus() {
  const toggle = document.querySelector('#engine-toggle');
  toggle.disabled = !state;
  if (!state) return;
  const active = layerById(state.activeLayerId);
  document.querySelector('#engine-status').textContent = state.editing ? 'Edição · ações suspensas' : state.enabled ? 'Ações ativas' : 'Ações pausadas';
  document.querySelector('#engine-dot').classList.toggle('enabled', state.enabled && !state.editing);
  toggle.textContent = state.enabled ? 'Pausar ações' : 'Ativar ações';
  toggle.setAttribute('aria-pressed', String(state.enabled));
  document.querySelector('#active-layer-label').textContent = active?.name || '';
  const platformNames = { linux: 'Linux', darwin: 'macOS', win32: 'Windows' };
  document.querySelector('#platform-label').textContent = `${platformNames[state.platform] || state.platform}${state.session === 'wayland' ? ' · Wayland' : state.session === 'x11' ? ' · X11' : ''}`;
}

function requestEditing(value) {
  if (!api || value === editingRequested) return;
  editingRequested = value;
  editingQueue = editingQueue.catch(() => {}).then(async () => {
    const result = await api.setEditing(value);
    if (result?.config) { state = result; updateStatus(); }
  }).catch(alertError);
}

function syncEditing() {
  const target = document.activeElement;
  requestEditing(Boolean(editor || capture || target?.matches('input, textarea, select, [contenteditable="true"]')));
}

document.addEventListener('focusin', syncEditing);
document.addEventListener('focusout', () => queueMicrotask(syncEditing));

function closeEditor() {
  editor = null;
  capture = null;
  render();
  syncEditing();
}

function startEditor(value) {
  editor = value;
  deleting = null;
  requestEditing(true);
  render();
  main.querySelector('form input')?.focus();
}

function render() {
  if (!state) return;
  if (!state.config.layers.some(layer => layer.id === selectedLayerId)) selectedLayerId = state.activeLayerId || state.config.layers[0]?.id;
  keyNodes.clear();
  main.replaceChildren();
  if (view === 'layers') renderLayers();
  if (view === 'tracking') renderTracking();
  if (view === 'history') renderHistory();
  if (view === 'settings') renderSettings();
  updateStatus();
}

function conflicts() {
  if (!state.shortcuts?.failed?.length) return null;
  return el('div', { class: 'conflict-list', role: 'status' }, el('strong', {}, 'Alguns atalhos não foram registrados'), el('ul', {}, state.shortcuts.failed.map(item => el('li', {}, `${item.key}: ${item.message}`))));
}

function renderLayers() {
  main.append(heading('Camadas', 'Uma tecla, várias possibilidades. Organize suas ações por contexto.', button('+ Nova camada', () => startEditor({ kind: 'layer', value: null }), 'primary')));
  if (editor?.kind === 'layer') main.append(layerForm());
  const conflict = conflicts();
  if (conflict) main.append(conflict);
  if (!state.config.layers.length) {
    main.append(empty('Comece com sua primeira camada', 'Crie uma camada e associe uma tecla a uma request HTTP, a um arquivo ou a uma mensagem no log.', button('Criar camada', () => startEditor({ kind: 'layer', value: null }), 'primary')));
    return;
  }
  const list = el('div', { class: 'layer-list', 'aria-label': 'Camadas cadastradas' }, el('div', { class: 'layer-list-heading' }, `${state.config.layers.length} ${state.config.layers.length === 1 ? 'camada' : 'camadas'}`));
  for (const layer of state.config.layers) {
    const chosen = layer.id === selectedLayerId;
    list.append(el('button', { type: 'button', class: `layer-choice${chosen ? ' selected' : ''}`, 'aria-pressed': String(chosen), onclick: () => { editor = null; deleting = null; capture = null; selectedLayerId = layer.id; render(); syncEditing(); } }, el('span', {}, el('strong', {}, layer.name), el('small', {}, `${layer.bindings.length} ${layer.bindings.length === 1 ? 'ação' : 'ações'}`)), layer.id === state.activeLayerId ? el('span', { class: 'live-mark' }, 'Atual') : null));
  }
  const layer = layerById();
  const detail = el('section', { class: 'layer-detail', 'aria-label': `Ações de ${layer.name}` });
  const actions = el('div', { class: 'button-row' });
  if (state.activeLayerId !== layer.id) actions.append(button('Usar camada', () => fire(() => api.setLayer(layer.id).then(result => { state = result; render(); return result; }), 'Camada alterada.'), 'primary small'));
  actions.append(button('Editar', () => startEditor({ kind: 'layer', value: layer }), 'small'));
  detail.append(el('div', { class: 'detail-heading' }, el('div', {}, el('h2', {}, layer.name), el('p', {}, layer.description || 'Associe teclas às ações desta camada.')), actions));
  if (deleting?.kind === 'layer' && deleting.id === layer.id) detail.append(deleteConfirmation(`Remover a camada “${layer.name}” e todas as suas ações?`, async () => {
    const config = configCopy();
    config.layers = config.layers.filter(item => item.id !== layer.id);
    await saveConfiguration(config);
  }));
  if (editor?.kind === 'binding') detail.append(bindingForm(layer));
  detail.append(el('div', { class: 'section-toolbar' }, el('span', { class: 'small-label' }, 'Teclas e ações'), button('+ Adicionar ação', () => startEditor({ kind: 'binding', value: null }), 'small')));
  const bindings = el('div', { class: 'binding-list' });
  if (!layer.bindings.length) bindings.append(empty('Qual será a primeira tecla?', 'Cadastre uma ação. Você poderá usar a mesma tecla em outra camada.'));
  for (const binding of layer.bindings) {
    bindings.append(el('div', { class: 'binding-row' }, el('kbd', { class: 'key-shortcut' }, binding.key), el('div', { class: 'binding-copy' }, el('div', { class: 'binding-name' }, binding.name), el('div', { class: 'binding-summary' }, actionSummary(binding.action))), el('div', { class: 'button-row' }, button('Testar', () => fire(() => api.runBinding(layer.id, binding.id), 'Ação de teste executada. Consulte o histórico.'), 'small', { title: 'Executa a ação real, mesmo com o sistema pausado', 'aria-label': `Testar ação ${binding.name}` }), button('Editar', () => startEditor({ kind: 'binding', value: binding }), 'small', { 'aria-label': `Editar ação ${binding.name}` }), button('Remover', () => { deleting = { kind: 'binding', id: binding.id }; render(); }, 'quiet small danger', { 'aria-label': `Remover ação ${binding.name}` }))));
    if (deleting?.kind === 'binding' && deleting.id === binding.id) bindings.append(deleteConfirmation(`Remover a ação “${binding.name}”?`, async () => {
      const config = configCopy();
      config.layers.find(item => item.id === layer.id).bindings = layer.bindings.filter(item => item.id !== binding.id);
      await saveConfiguration(config);
    }));
  }
  detail.append(bindings, el('p', { class: 'hint' }, 'Testar executa a ação real, inclusive enquanto as ações globais estão pausadas.'));
  if (state.config.layers.length > 1) detail.append(button('Remover camada', () => { editor = null; deleting = { kind: 'layer', id: layer.id }; render(); syncEditing(); }, 'quiet small danger'));
  main.append(el('div', { class: 'layer-layout' }, list, detail));
  main.append(el('div', { class: 'help-strip' }, el('span', { 'aria-hidden': 'true' }, '↪'), el('p', {}, 'Alterne a camada com ', el('kbd', {}, state.config.settings.layerShortcut), '. Pause ou retome com ', el('kbd', {}, state.config.settings.pauseShortcut), '. Com as ações ativas, os atalhos podem substituir a digitação em outros programas.')));
}

function actionSummary(action) {
  if (action.type === 'http') return `${action.method} ${action.url}`;
  if (action.type === 'file') return `${action.mode === 'append' ? 'Adicionar a' : 'Criar'} ${action.filename}`;
  return `Log · ${action.message}`;
}

function empty(title, description, action) { return el('div', { class: 'empty-state' }, el('h2', {}, title), el('p', {}, description), action); }

function deleteConfirmation(message, onDelete) {
  return el('div', { class: 'confirm-delete' }, el('span', {}, message), button('Remover', () => fire(onDelete, 'Removido.'), 'small danger'), button('Cancelar', () => { deleting = null; render(); }, 'small'));
}

async function saveConfiguration(config) {
  const result = await api.saveConfig(config);
  state = result;
  editor = null;
  deleting = null;
  capture = null;
  render();
  syncEditing();
  return result;
}

function inputField(name, label, value = '', options = {}) {
  const inputId = `field-${name}`;
  const { hint, multiline, choices, className, ...attrs } = options;
  let input;
  if (choices) {
    input = el('select', { id: inputId, name, ...attrs }, choices.map(([value, title]) => el('option', { value }, title)));
    input.value = value;
  } else {
    input = el(multiline ? 'textarea' : 'input', { id: inputId, name, class: className || '', ...attrs });
    input.value = value;
  }
  const wrapper = el('div', { class: 'field' }, el('label', { for: inputId }, label), input, hint ? el('small', { id: `${inputId}-hint` }, hint) : null);
  if (hint) input.setAttribute('aria-describedby', `${inputId}-hint`);
  return { wrapper, input };
}

function shortcutField(name, label, value, hint) {
  const field = inputField(name, label, value, { required: true, placeholder: 'Ex.: A ou Control+Shift+A', hint });
  const record = button('Capturar tecla', () => {
    if (capture?.input === field.input) { stopCapture(); return; }
    stopCapture();
    capture = { input: field.input, button: record };
    record.textContent = 'Pressione · Esc cancela';
    announce('Pressione a tecla ou combinação desejada. Escape cancela.');
    requestEditing(true);
    record.focus();
  }, 'small');
  const controls = el('div', { class: 'input-with-button' });
  field.input.replaceWith(controls);
  controls.append(field.input, record);
  return field.wrapper;
}

function stopCapture() {
  if (capture) capture.button.textContent = 'Capturar tecla';
  capture = null;
}

function formError(form, error) {
  form.querySelector('.form-error')?.remove();
  form.append(el('div', { class: 'form-error', role: 'alert' }, error.message || String(error)));
}

function formFooter(saveText = 'Salvar') {
  return el('div', { class: 'form-footer' }, el('button', { type: 'submit', class: 'button primary' }, saveText), button('Cancelar', closeEditor));
}

function layerForm() {
  const current = editor.value;
  const name = inputField('name', 'Nome da camada', current?.name || '', { required: true, maxlength: 80, placeholder: 'Ex.: Trabalho' });
  const description = inputField('description', 'Descrição (opcional)', current?.description || '', { maxlength: 240, placeholder: 'O que você quer fazer nesta camada?' });
  const form = el('form', { class: 'editor', onsubmit: async event => {
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const config = configCopy();
      const value = { id: current?.id || id('layer'), name: name.input.value.trim(), description: description.input.value.trim(), bindings: current?.bindings || [] };
      if (!value.name) throw new Error('Informe o nome da camada.');
      if (current) config.layers[config.layers.findIndex(layer => layer.id === current.id)] = value;
      else config.layers.push(value);
      selectedLayerId = value.id;
      await perform(() => saveConfiguration(config), 'Camada salva.');
    } catch (error) { formError(form, error); } finally { submit.disabled = false; }
  } }, el('h2', {}, current ? 'Editar camada' : 'Nova camada'), name.wrapper, description.wrapper, formFooter('Salvar camada'));
  return form;
}

function parseObject(value, label) {
  let result;
  try { result = JSON.parse(value || '{}'); } catch { throw new Error(`${label}: informe um objeto JSON válido.`); }
  if (!result || Array.isArray(result) || typeof result !== 'object') throw new Error(`${label}: use um objeto JSON, como {"chave":"valor"}.`);
  return result;
}

function bindingForm(layer) {
  const current = editor.value;
  const currentAction = current?.action || { type: 'log', message: '' };
  const name = inputField('name', 'Nome da ação', current?.name || '', { required: true, maxlength: 100, placeholder: 'Ex.: Avisar início do trabalho' });
  const type = inputField('type', 'Tipo de ação', currentAction.type, { choices: Object.entries(labels) });
  const actionFields = el('div', { class: 'action-fields' });
  const drafts = {};
  let activeType = currentAction.type;
  function rememberFields() {
    drafts[activeType] = Object.fromEntries([...actionFields.querySelectorAll('[name]')].map(input => [input.name, input.value]));
  }
  function showActionFields(actionType) {
    actionFields.replaceChildren();
    const initial = actionType === currentAction.type ? currentAction : {};
    const values = drafts[actionType] || initial;
    if (actionType === 'http') {
      const method = inputField('method', 'Método', values.method || 'POST', { choices: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map(value => [value, value]) });
      const url = inputField('url', 'URL', values.url || '', { required: true, type: 'url', placeholder: 'https://exemplo.com/webhook' });
      const headers = inputField('headers', 'Headers (JSON)', typeof values.headers === 'string' ? values.headers : JSON.stringify(values.headers || {}, null, 2), { multiline: true, className: 'mono', spellcheck: 'false', hint: 'Ex.: {"Content-Type":"application/json"}' });
      const query = inputField('query', 'Parâmetros da URL (JSON)', typeof values.query === 'string' ? values.query : JSON.stringify(values.query || {}, null, 2), { multiline: true, className: 'mono', spellcheck: 'false', hint: 'Ex.: {"origem":"teclado","tecla":"{{key}}"}' });
      const body = inputField('body', 'Corpo da request (opcional)', values.body || '', { multiline: true, className: 'mono', spellcheck: 'false', placeholder: '{"evento":"iniciar"}', hint: 'Texto enviado como está. GET e HEAD não enviam corpo.' });
      actionFields.append(el('div', { class: 'form-grid' }, method.wrapper, url.wrapper), el('div', { class: 'form-grid' }, headers.wrapper, query.wrapper), body.wrapper);
    }
    if (actionType === 'file') {
      const directory = inputField('directory', 'Pasta de destino', values.directory || '', { placeholder: 'Padrão: Documentos/Keyboard Tracker', hint: 'Deixe vazio para usar a pasta padrão do aplicativo.' });
      const choose = button('Escolher pasta', () => fire(async () => { const path = await api.chooseDirectory(); if (path) directory.input.value = path; }), 'small');
      const controls = el('div', { class: 'input-with-button' });
      directory.input.replaceWith(controls);
      controls.append(directory.input, choose);
      const filename = inputField('filename', 'Nome do arquivo', values.filename || '', { required: true, placeholder: 'nota-{{timestamp}}.txt' });
      const mode = inputField('mode', 'Como salvar', values.mode || 'create', { choices: [['create', 'Criar novo arquivo'], ['append', 'Adicionar ao final']], hint: 'Criar não sobrescreve um arquivo existente.' });
      const content = inputField('content', 'Conteúdo', values.content || '', { multiline: true, placeholder: 'Criado em {{date}} pela tecla {{key}}.' });
      actionFields.append(directory.wrapper, el('div', { class: 'form-grid' }, filename.wrapper, mode.wrapper), content.wrapper);
    }
    if (actionType === 'log') actionFields.append(inputField('message', 'Mensagem', values.message || '', { multiline: true, required: true, placeholder: 'A tecla {{key}} foi acionada na camada {{layer}}.' }).wrapper);
    activeType = actionType;
  }
  type.input.addEventListener('change', () => { rememberFields(); showActionFields(type.input.value); });
  showActionFields(currentAction.type);
  const form = el('form', { class: 'editor', onsubmit: async event => {
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const data = new FormData(form);
      const actionType = data.get('type');
      let action;
      if (actionType === 'http') {
        const url = String(data.get('url')).trim();
        const parsed = new URL(url);
        if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Use uma URL HTTP ou HTTPS.');
        action = { type: actionType, method: data.get('method'), url, headers: parseObject(data.get('headers'), 'Headers'), query: parseObject(data.get('query'), 'Parâmetros'), body: data.get('body') };
        if (['GET', 'HEAD'].includes(action.method) && action.body) throw new Error('GET e HEAD não aceitam corpo. Deixe esse campo vazio ou escolha outro método.');
      }
      if (actionType === 'file') action = { type: actionType, directory: String(data.get('directory')).trim(), filename: String(data.get('filename')).trim(), content: data.get('content'), mode: data.get('mode') };
      if (actionType === 'log') action = { type: actionType, message: data.get('message') };
      const value = { id: current?.id || id('binding'), name: name.input.value.trim(), key: String(data.get('key')).trim(), action };
      if (!value.name || !value.key) throw new Error('Informe um nome e uma tecla para a ação.');
      const config = configCopy();
      const bindings = config.layers.find(item => item.id === layer.id).bindings;
      if (current) bindings[bindings.findIndex(item => item.id === current.id)] = value;
      else bindings.push(value);
      await perform(() => saveConfiguration(config), 'Ação salva.');
    } catch (error) { formError(form, error); } finally { submit.disabled = false; }
  } }, el('h2', {}, current ? 'Editar ação' : 'Nova ação'), name.wrapper, shortcutField('key', 'Tecla ou combinação', current?.key || '', 'Use uma letra, F1–F24 ou uma combinação como Control+Shift+A.'), type.wrapper, actionFields, el('p', { class: 'hint' }, 'Variáveis disponíveis: {{key}}, {{layer}}, {{date}} e {{timestamp}}. Ações ficam suspensas enquanto você edita.'), formFooter('Salvar ação'));
  return form;
}

function renderTracking() {
  main.append(heading('Rastreio do teclado', 'Veja as teclas pressionadas e soltas, em tempo real.'));
  const toggle = el('input', { type: 'checkbox', checked: state.tracking.enabled, onchange: () => {
    toggle.disabled = true;
    fire(async () => { try { const result = await api.setTracking(toggle.checked); state = result; clearPressed(); render(); return result; } finally { toggle.disabled = false; toggle.checked = state.tracking.enabled; } });
  } });
  main.append(el('div', { class: 'tracking-controls' }, el('div', {}, el('h2', {}, 'Visualização ao vivo'), el('p', {}, 'O rastreio é independente das ações configuradas.')), el('label', { class: 'switch' }, toggle, 'Ativar rastreio')));
  main.append(el('p', { class: 'tracking-message', id: 'tracking-message', role: 'status' }, trackingMessage()));
  const assembly = el('div', { class: 'keyboard-assembly', role: 'img', 'aria-label': 'Teclado visual QWERTY. Teclas pressionadas são destacadas. O layout representa os códigos físicos; as legendas podem variar no seu teclado.' });
  const keyboard = el('div', { class: 'keyboard-main' });
  const rows = [
    [['Escape','Esc'], ...Array.from({ length: 12 }, (_, i) => [`F${i+1}`,`F${i+1}`])],
    [['Backquote','`'],['Digit1','1'],['Digit2','2'],['Digit3','3'],['Digit4','4'],['Digit5','5'],['Digit6','6'],['Digit7','7'],['Digit8','8'],['Digit9','9'],['Digit0','0'],['Minus','−'],['Equal','='],['Backspace','⌫','2']],
    [['Tab','Tab','15'],['KeyQ','Q'],['KeyW','W'],['KeyE','E'],['KeyR','R'],['KeyT','T'],['KeyY','Y'],['KeyU','U'],['KeyI','I'],['KeyO','O'],['KeyP','P'],['BracketLeft','['],['BracketRight',']'],['Backslash','\\','15']],
    [['CapsLock','Caps','175'],['KeyA','A'],['KeyS','S'],['KeyD','D'],['KeyF','F'],['KeyG','G'],['KeyH','H'],['KeyJ','J'],['KeyK','K'],['KeyL','L'],['Semicolon',';'],['Quote',"'"],['Enter','Enter','225']],
    [['ShiftLeft','Shift','225'],['KeyZ','Z'],['KeyX','X'],['KeyC','C'],['KeyV','V'],['KeyB','B'],['KeyN','N'],['KeyM','M'],['Comma',','],['Period','.'],['Slash','/'],['ShiftRight','Shift','275']],
    [['ControlLeft','Ctrl','15'],['MetaLeft',state.platform === 'darwin' ? '⌘' : 'Win','15'],['AltLeft','Alt','15'],['Space','Espaço','6'],['AltRight','Alt','15'],['MetaRight',state.platform === 'darwin' ? '⌘' : 'Win','15'],['ContextMenu','Menu','15'],['ControlRight','Ctrl','15']]
  ];
  rows.forEach((keys, index) => keyboard.append(keyRow(keys, index === 0)));
  const navigation = el('div', { class: 'keyboard-navigation' }, keyRow([['PrintScreen','PrtSc'],['ScrollLock','Scroll'],['Pause','Pause']], true), keyRow([['Insert','Ins'],['Home','Home'],['PageUp','PgUp']]), keyRow([['Delete','Del'],['End','End'],['PageDown','PgDn']]), keyRow([['',''],['ArrowUp','↑'],['','']]), keyRow([['ArrowLeft','←'],['ArrowDown','↓'],['ArrowRight','→']]));
  assembly.append(keyboard, navigation);
  main.append(assembly, el('div', { class: 'keyboard-caption' }, el('span', { class: 'key-legend' }, el('span', { class: 'legend-square', 'aria-hidden': 'true' }), 'Tecla pressionada'), el('span', {}, 'Posições físicas · referência QWERTY')), el('div', { class: 'tracking-readout' }, el('strong', { id: 'pressed-label', role: 'status' }, 'Nenhuma tecla pressionada'), el('span', { id: 'tracking-source' }, sourceLabel())), el('p', { class: 'tracking-privacy' }, 'As teclas são exibidas apenas durante esta sessão. O rastreio não salva teclas em arquivo nem no histórico.'));
  updateKeys();
}

function keyRow(keys, functionRow = false) {
  return el('div', { class: `keyboard-row${functionRow ? ' function-row' : ''}` }, keys.map(([code, label, width]) => {
    const node = el('span', { class: `keycap${width ? ` width-${width}` : ''}${code ? '' : ' spacer'}`, 'data-code': code, 'aria-hidden': 'true', title: code || undefined }, label);
    if (code) keyNodes.set(code, node);
    return node;
  }));
}

function trackingMessage() {
  if (!state.tracking.enabled) return 'Rastreio pausado. Ative quando quiser visualizar seu teclado.';
  if (state.tracking.mode === 'starting') return 'Iniciando rastreio…';
  return state.tracking.message || (state.tracking.mode === 'global' ? 'Rastreio global ativo, inclusive quando outro programa estiver em foco.' : 'Rastreio local: mantenha esta janela em foco para visualizar as teclas.');
}

function sourceLabel() {
  if (!state.tracking.enabled) return 'Rastreio desligado';
  return state.tracking.mode === 'global' ? 'Captura global' : state.tracking.mode === 'starting' ? 'Iniciando captura' : 'Captura nesta janela';
}

function keyEvent(event) {
  if (!state?.tracking.enabled) return;
  if (event.direction === 'down') pressed.set(event.code, event.key || event.code);
  else pressed.delete(event.code);
  updateKeys();
}

function updateKeys() {
  for (const [code, node] of keyNodes) node.classList.toggle('pressed', pressed.has(code));
  const label = document.querySelector('#pressed-label');
  if (label) label.textContent = pressed.size ? `${pressed.size === 1 ? 'Pressionada' : 'Pressionadas'}: ${[...pressed.values()].join(' + ')}` : 'Nenhuma tecla pressionada';
}

function clearPressed() { pressed.clear(); updateKeys(); }

function renderHistory() {
  main.append(heading('Histórico', 'Resultados das ações e eventos do aplicativo. As últimas 100 entradas ficam disponíveis.'));
  const filters = [['all','Tudo'],['action','Ações'],['error','Erros']];
  main.append(el('div', { class: 'history-toolbar', 'aria-label': 'Filtrar histórico' }, filters.map(([value, label]) => button(label, () => { historyFilter = value; render(); }, `small${historyFilter === value ? ' selected' : ''}`, { 'aria-pressed': String(historyFilter === value) }))));
  const events = state.events.filter(event => historyFilter === 'all' || (historyFilter === 'error' ? event.status === 'error' : event.kind === 'action'));
  if (!events.length) { main.append(empty('O histórico começa com suas ações', historyFilter === 'all' ? 'Teste uma ação na tela de camadas ou ative os atalhos para acompanhar os resultados aqui.' : 'Nenhuma entrada corresponde a este filtro.')); return; }
  main.append(el('div', { class: 'event-list', 'aria-label': 'Eventos recentes' }, events.map(event => {
    const date = new Date(event.time);
    const validDate = !Number.isNaN(date.getTime());
    const time = validDate ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
    const status = { success: 'Concluído', error: 'Erro', info: 'Sistema' }[event.status] || event.status;
    return el('article', { class: 'event-row' }, el('time', { datetime: validDate ? date.toISOString() : undefined, title: validDate ? date.toLocaleString('pt-BR') : '' }, time), el('span', { class: `badge ${event.status}` }, status), el('div', { class: 'event-copy' }, el('p', { class: 'event-message' }, event.message), event.layer || event.key ? el('p', { class: 'event-meta' }, [event.layer, event.key].filter(Boolean).join(' · ')) : null));
  })));
}

function renderSettings() {
  main.append(heading('Configurações', 'Ajuste os atalhos gerais e gerencie seus dados.'));
  const cooldown = inputField('cooldownMs', 'Intervalo mínimo entre ações (ms)', state.config.settings.cooldownMs, { type: 'number', required: true, min: 100, max: 10000, step: 50, hint: 'Entre 100 e 10000 ms. Evita disparos em sequência ao manter uma tecla pressionada.' });
  const form = el('form', { class: 'settings-section', onsubmit: async event => {
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const data = new FormData(form);
      const config = configCopy();
      config.settings = { ...config.settings, layerShortcut: String(data.get('layerShortcut')).trim(), pauseShortcut: String(data.get('pauseShortcut')).trim(), cooldownMs: Number(data.get('cooldownMs')) };
      await perform(() => saveConfiguration(config), 'Configurações salvas.');
    } catch (error) { formError(form, error); } finally { submit.disabled = false; }
  } }, el('h2', {}, 'Atalhos e execução'), el('p', {}, 'A tecla de camada percorre suas camadas na ordem cadastrada. A pausa afeta todas as ações.'), shortcutField('layerShortcut', 'Alternar camada', state.config.settings.layerShortcut, 'Ex.: F8. Esse atalho funciona globalmente quando registrado.'), shortcutField('pauseShortcut', 'Pausar ou retomar ações', state.config.settings.pauseShortcut), cooldown.wrapper, el('button', { type: 'submit', class: 'button primary' }, 'Salvar configurações'));
  const data = el('section', { class: 'settings-section' }, el('h2', {}, 'Configuração e arquivos'), el('p', {}, 'Exporte suas camadas para levar a outro computador. Importar substitui a configuração atual.'), el('div', { class: 'button-row' }, button('Exportar configuração', () => fire(() => api.exportConfig(), 'Exportação concluída ou cancelada.')), button('Importar configuração', () => { deleting = { kind: 'import' }; render(); })), el('div', { class: 'setting-row' }, el('div', {}, el('strong', {}, 'Dados do aplicativo'), el('span', { class: 'path-value' }, state.paths.data)), button('Abrir pasta', () => fire(() => api.openDataDirectory()), 'small')), el('div', { class: 'setting-row' }, el('div', {}, el('strong', {}, 'Arquivos criados por padrão'), el('span', { class: 'path-value' }, state.paths.documents))), el('div', { class: 'setting-row' }, el('div', {}, el('strong', {}, 'Arquivo de log'), el('span', { class: 'path-value' }, state.paths.log))));
  if (deleting?.kind === 'import') data.prepend(el('div', { class: 'confirm-delete' }, el('span', {}, 'A importação substitui as camadas e os atalhos atuais. Exporte antes se quiser guardar uma cópia.'), button('Escolher arquivo', () => fire(async () => { const result = await api.importConfig(); state = result; deleting = null; selectedLayerId = state.activeLayerId; render(); return result; }), 'small primary'), button('Cancelar', () => { deleting = null; render(); }, 'small')));
  const support = el('section', { class: 'settings-section' }, el('h2', {}, 'Captura e permissões'), el('p', {}, 'No macOS, os atalhos e o rastreio podem exigir permissão de Acessibilidade e Monitoramento de Entrada. No Linux com Wayland, a captura global depende do ambiente; quando indisponível, o rastreio funciona nesta janela.'), el('p', {}, 'As ações começam pausadas a cada abertura. O rastreio só inicia quando você o ativa. As configurações podem conter tokens de APIs; guarde os arquivos exportados em um local de confiança.'));
  main.append(form, data, support);
  const conflict = conflicts();
  if (conflict) main.append(conflict);
}

function accelerator(event) {
  const modifierCodes = ['ControlLeft','ControlRight','ShiftLeft','ShiftRight','AltLeft','AltRight','MetaLeft','MetaRight'];
  if (modifierCodes.includes(event.code)) return null;
  const parts = [];
  if (event.metaKey) parts.push('Super');
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  const mapped = { Space:'Space', Escape:'Escape', ArrowUp:'Up', ArrowDown:'Down', ArrowLeft:'Left', ArrowRight:'Right', Backspace:'Backspace', Delete:'Delete', Enter:'Enter', Tab:'Tab', Home:'Home', End:'End', PageUp:'PageUp', PageDown:'PageDown', Insert:'Insert', Minus:'-', Equal:'=', BracketLeft:'[', BracketRight:']', Backslash:'\\', Semicolon:';', Quote:"'", Comma:',', Period:'.', Slash:'/', Backquote:'`' };
  const key = event.code.startsWith('Key') ? event.code.slice(3) : event.code.startsWith('Digit') ? event.code.slice(5) : mapped[event.code] || (/^F\d+$/.test(event.code) ? event.code : event.key);
  if (!key || key === 'Unidentified') return null;
  parts.push(key);
  return parts.join('+');
}

document.addEventListener('keydown', event => {
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
      announce(`Atalho capturado: ${value}`);
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

document.querySelector('#navigation').addEventListener('click', event => {
  const target = event.target.closest('[data-view]');
  if (!target || !state) return;
  view = target.dataset.view;
  editor = null;
  deleting = null;
  stopCapture();
  for (const item of document.querySelectorAll('[data-view]')) {
    if (item === target) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  render();
  syncEditing();
  main.focus();
});
document.querySelector('#engine-toggle').addEventListener('click', () => fire(async () => {
  const result = await api.setEnabled(!state.enabled);
  state = result;
  if (!editor && !document.activeElement?.matches('input,textarea,select')) render();
  return result;
}));

if (!api) {
  document.querySelector('#engine-status').textContent = 'Aplicativo desktop necessário';
  main.replaceChildren(el('div', { class: 'desktop-required' }, el('h1', {}, 'Abra no aplicativo desktop'), el('p', {}, 'O Keyboard Tracker usa a integração nativa com o sistema para registrar atalhos globais, executar ações e acompanhar o teclado. Esta página precisa ser aberta pelo aplicativo instalado.')));
} else {
  try {
    state = await api.getState();
    selectedLayerId = state.activeLayerId || state.config.layers[0]?.id;
    render();
    api.onState(next => {
      const previousConfig = JSON.stringify(state.config);
      const previousLayer = state.activeLayerId;
      const previousTracking = JSON.stringify(state.tracking);
      state = next;
      updateStatus();
      const focusedInput = document.activeElement?.matches('input,textarea,select');
      if (!state.tracking.enabled || previousTracking !== JSON.stringify(state.tracking)) clearPressed();
      if (!editor && !capture && !focusedInput && (view === 'history' || previousConfig !== JSON.stringify(state.config) || previousLayer !== state.activeLayerId || (view === 'tracking' && previousTracking !== JSON.stringify(state.tracking)))) render();
    });
    api.onKey(keyEvent);
  } catch (error) {
    document.querySelector('#engine-status').textContent = 'Não foi possível iniciar';
    main.replaceChildren(empty('Não foi possível carregar o aplicativo', 'Feche e abra o Keyboard Tracker novamente.'));
    alertError(error);
  }
}
