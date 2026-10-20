import { el, icon, button, shortcut, heading, field, toast, announce, confirmDialog } from './ui.js';
import { keyboardView } from './keyboard.js';
import { createActionEditor, actionLabels, actionTypeLabels } from './action-editor.js';
import { createBindingTable } from './binding-table.js';
import { createBindingTrigger, triggerLabels, triggerFor, triggerDescription } from './key-moments.js';
import { shortcutForCode, shortcutModifiers } from './keyboard-bindings.mjs';
import { layouts, normalizeKeyboardPreference, resolveKeyboardLayout, readSystemKeyboardMap, keyboardEventLabel } from './keyboard-layouts.mjs';

const api = window.keyboardTracker;
const main = document.querySelector('#main');
const labels = actionLabels;
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
let bindingView = 'table';
try { bindingView = localStorage.getItem('keyboard-tracker.binding-view') === 'keyboard' ? 'keyboard' : 'table'; } catch { /* Session preference remains available. */ }
let visualModifiers = '';
let visualTrigger = 'press';
let previewGeneration = 0;
let bindingTable;
let visualBindingCache;
let editingRequested = false;
let editingQueue = Promise.resolve();
let closingAllowed = false;

// Visual preferences stay on this computer, separate from exported actions.
const sidebarPreference = 'keyboard-tracker.sidebar-collapsed';
const sidebarToggle = document.querySelector('#sidebar-toggle');
function setSidebarCollapsed(collapsed) {
  document.documentElement.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
  const label = collapsed ? 'Expandir menu' : 'Recolher menu';
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggle.setAttribute('aria-label', label);
  sidebarToggle.replaceChildren(icon('sidebar'), el('span', { class: 'sidebar-toggle-label' }, label));
}
let savedSidebarCollapsed = true;
try { savedSidebarCollapsed = localStorage.getItem(sidebarPreference) !== 'false'; } catch { /* Storage may be unavailable; the control still works. */ }
setSidebarCollapsed(savedSidebarCollapsed);
sidebarToggle.addEventListener('click', () => {
  const collapsed = document.documentElement.dataset.sidebar !== 'collapsed';
  setSidebarCollapsed(collapsed);
  try { localStorage.setItem(sidebarPreference, String(collapsed)); } catch { /* Keep the session preference. */ }
});
const sidebar = document.querySelector('#sidebar');
document.addEventListener('keydown', event => { if (event.key === 'Escape') sidebar.classList.add('dismiss-hints'); });
sidebar.addEventListener('pointerover', () => sidebar.classList.remove('dismiss-hints'));
sidebar.addEventListener('focusin', () => sidebar.classList.remove('dismiss-hints'));

const themeToggle = document.querySelector('#theme-toggle');
function syncAppearanceControls() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const label = dark ? 'Usar tema claro' : 'Usar tema escuro';
  themeToggle.setAttribute('aria-label', label);
  themeToggle.title = label;
  themeToggle.replaceChildren(icon(dark ? 'sun' : 'moon'), el('span', { class: 'nav-label' }, label));
  const select = document.querySelector('#field-theme');
  if (select) select.value = window.keyboardAppearance.preference;
}
themeToggle.addEventListener('click', () => {
  window.keyboardAppearance.set(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});
window.addEventListener('keyboard-appearance-change', syncAppearanceControls);
syncAppearanceControls();

const keyboardPreferenceKey = 'keyboard-tracker.keyboard-preview';
let keyboardPreference = normalizeKeyboardPreference();
try { keyboardPreference = normalizeKeyboardPreference(JSON.parse(localStorage.getItem(keyboardPreferenceKey))); } catch { /* Invalid or unavailable storage uses defaults. */ }
let systemKeyboardMap = null;
let layoutReadGeneration = 0;
let layoutStatus = 'Lendo as legendas do sistema…';
const currentKeyboardLayout = () => resolveKeyboardLayout(keyboardPreference, systemKeyboardMap);

async function refreshSystemLayout() {
  if (keyboardPreference.layout !== 'auto') return;
  const generation = ++layoutReadGeneration;
  const map = await readSystemKeyboardMap(navigator.keyboard);
  if (generation !== layoutReadGeneration || keyboardPreference.layout !== 'auto') return;
  systemKeyboardMap = map;
  layoutStatus = map ? 'Legendas fornecidas pelo sistema. O padrão físico é uma referência ajustável.' : 'Detecção indisponível. US como referência; escolha seu layout manualmente.';
  refreshKeyboardPreview();
}

function changeKeyboardPreference(name, value) {
  keyboardPreference = normalizeKeyboardPreference({ ...keyboardPreference, [name]: value });
  ++layoutReadGeneration;
  try { localStorage.setItem(keyboardPreferenceKey, JSON.stringify(keyboardPreference)); } catch { /* Keep session choices. */ }
  clearPressed();
  refreshKeyboardPreview();
  if (name === 'layout' && value === 'auto') void refreshSystemLayout();
}

function refreshKeyboardPreview() {
  const container = document.querySelector('#keyboard-preview');
  if (!container) { if (view === 'layers' && bindingView === 'keyboard') updateBindings(); return; }
  const layout = currentKeyboardLayout();
  const focused = container.contains(document.activeElement);
  const scrollLeft = container.querySelector('.keyboard-scroll')?.scrollLeft || 0;
  keyNodes.clear();
  container.replaceChildren(keyboardView(state.platform, keyNodes, { layout, size: keyboardPreference.size }));
  container.firstElementChild.scrollLeft = scrollLeft;
  if (focused) container.firstElementChild.focus({ preventScroll: true });
  document.querySelector('#layout-status').textContent = keyboardPreference.layout === 'auto' ? layoutStatus : 'Layout escolhido: ' + layout.name;
  document.querySelector('#keyboard-reference').textContent = 'Padrão físico de referência: ' + layout.geometry.toUpperCase();
  updateKeys();
}

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
  requestEditing(Boolean(editor || capture || isDirty() || textFocus() || document.activeElement?.closest('.keyboard-interactive')));
  const status = document.querySelector('#draft-status');
  if (status) status.textContent = isDirty() ? 'Alterações não salvas' : 'Nenhuma alteração pendente';
}

function updateStatus() {
  const toggle = document.querySelector('#engine-toggle');
  toggle.disabled = !state || (!state.enabled && state.editing);
  if (!state) return;
  const suspended = state.enabled && state.editing;
  const inputLimited = state.input?.mode === 'unavailable';
  const editingForm = Boolean(editor || isDirty());
  const navigatingKeyboard = Boolean(document.activeElement?.closest('.keyboard-interactive'));
  document.querySelector('.engine-status').dataset.status = suspended ? 'suspended' : state.enabled ? state.shortcuts.failed.length || inputLimited ? 'limited' : 'active' : 'paused';
  document.querySelector('#engine-status').textContent = suspended ? navigatingKeyboard ? 'Suspenso · teclado visual' : editingForm ? 'Suspenso · edição' : 'Suspenso · digitação' : state.enabled ? state.shortcuts.failed.length || inputLimited ? 'Ativo · com restrições' : 'Ativo' : 'Pausado';
  document.querySelector('#engine-detail').textContent = suspended ? navigatingKeyboard ? 'Saia do teclado visual para retomar os atalhos.' : editingForm ? 'Salve ou feche o editor para continuar.' : 'Clique fora do campo para retomar os atalhos.' : state.enabled ? inputLimited ? 'Alguns momentos da tecla estão indisponíveis. Confira a entrada global.' : 'Atalhos funcionando em outros aplicativos.' : state.editing ? editingForm ? 'Finalize a edição para ativar os atalhos.' : 'Clique fora do campo para ativar os atalhos.' : 'Ative quando estiver pronto para usar os atalhos.';
  document.querySelector('#engine-detail').classList.toggle('sr-only', !state.editing);
  document.querySelector('#control-shortcuts').hidden = state.editing;
  document.querySelector('#control-shortcuts').textContent = state.config.settings.layerShortcut + ' alternar · ' + state.config.settings.pauseShortcut.replace('CommandOrControl', state.platform === 'darwin' ? '⌘' : 'Ctrl') + ' pausar';
  toggle.replaceChildren(icon(state.enabled ? 'pause' : 'play'), el('span', {}, state.enabled ? 'Pausar ações' : 'Ativar ações'));
  toggle.setAttribute('aria-pressed', String(state.enabled));
  toggle.title = toggle.disabled && state.editing ? navigatingKeyboard ? 'Saia do teclado visual para ativar os atalhos.' : editingForm ? 'Salve ou cancele a edição para ativar.' : 'Clique fora do campo para ativar os atalhos.' : '';
  document.querySelector('#active-layer-label').textContent = layerById(state.activeLayerId)?.name || '—';
  const picker = document.querySelector('#active-layer-picker');
  if (picker) {
    const revision = String(state.configRevision);
    if (picker.dataset.revision !== revision) { picker.replaceChildren(...state.config.layers.map(layer => el('option', { value: layer.id }, layer.name))); picker.dataset.revision = revision; }
    picker.value = state.activeLayerId;
  }
  updateApplicationStatus();
  editor?.triggerControls?.setInputState(state.input, state.enabled);
  updateInputStatus();
  const closeToTray = document.querySelector('#field-closeToTray');
  if (closeToTray) {
    closeToTray.disabled = !state.desktop?.trayAvailable;
    document.querySelector('#field-closeToTray-hint').textContent = state.desktop?.trayAvailable ? 'Use “Sair” no menu da bandeja para encerrar o aplicativo.' : 'A bandeja não está disponível nesta sessão. Fechar a janela encerra o aplicativo.';
  }
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
  if (view !== 'layers') bindingTable = null;
  if (view !== 'layers' || bindingView !== 'keyboard') visualBindingCache = null;
  const previousFocus = focusKey || document.activeElement?.dataset.focus;
  if (!layerById()) selectedLayerId = state.activeLayerId;
  keyNodes.clear();
  main.dataset.view = view;
  document.querySelector('#page-name').textContent = { layers: 'Camadas', tracking: 'Rastreio', history: 'Histórico', settings: 'Configurações' }[view];
  const feedback = document.querySelector('#toast');
  if (feedback?.closest('#editor-drawer')) document.body.append(feedback);
  main.replaceChildren();
  ({ layers: renderLayers, tracking: renderTracking, history: renderHistory, settings: renderSettings })[view]();
  for (const form of main.querySelectorAll('form[data-draft]')) form.dataset.baseline = serializeForm(form);
  const drawer = main.querySelector('#editor-drawer');
  if (drawer) {
    drawer.showModal();
    (drawer.querySelector('form input') || drawer.querySelector('[data-initial-focus]') || drawer.querySelector('button'))?.focus({ preventScroll: true });
    if (editor.kind === 'test') { updateTestPreview(); if (!editor.preview && !editor.loading && !editor.result && !editor.error) void loadTestPreview(); }
  }
  restoreFocus(previousFocus);
  updateStatus();
  syncEditing();
}

function navigate(next) {
  if (next === view) return;
  void guardNavigation(() => {
    editor = null;
    view = next;
    for (const item of document.querySelectorAll('#navigation [data-view]')) {
      if (item.dataset.view === view) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    render();
    main.focus({ preventScroll: true });
    if (next === 'tracking') void refreshSystemLayout();
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
}

function startEditor(value) {
  void guardNavigation(() => {
    editor = { ...value, returnFocus: value.returnFocus || document.activeElement?.dataset.focus || (value.kind === 'binding' ? 'new-binding' : 'new-layer'), scrollY: window.scrollY };
    requestEditing(true);
    render();
  });
}

function closeEditor() {
  void guardNavigation(() => {
    const previous = editor;
    editor = null;
    render(previous?.returnFocus);
    window.scrollTo({ top: previous?.scrollY || 0, behavior: 'instant' });
  });
}

function empty(title, description, action) {
  return el('div', { class: 'empty-state' }, icon('layers'), el('h3', {}, title), el('p', {}, description), action);
}

function duplicateBinding(binding) {
  startEditor({ kind: 'binding', value: null, returnFocus: 'more-' + binding.id, seed: { ...structuredClone(binding), id: undefined, key: '', name: (binding.name.slice(0, 92) + ' · cópia') } });
}

function duplicateLayer(layer) {
  startEditor({ kind: 'layer', value: null, seed: { name: layer.name.slice(0, 72) + ' · cópia', description: layer.description, applications: [], bindings: layer.bindings.map(binding => ({ ...structuredClone(binding), id: newId('binding') })) } });
}

function checkboxField(name, label, checked, hint, disabled = false) {
  return el('div', { class: 'checkbox-field' }, el('label', {}, el('input', { id: 'field-' + name, name, type: 'checkbox', checked, disabled, 'aria-describedby': 'field-' + name + '-hint' }), el('span', {}, label)),
    el('small', { id: 'field-' + name + '-hint', class: 'hint' }, hint));
}

function applicationRules(applications) {
  const item = field('applications', 'Aplicativos associados', applications.join('\n'), { multiline: true, spellcheck: 'false', placeholder: 'Ex.: code\nfirefox', hint: 'Um nome, caminho de executável ou bundle ID por linha. Correspondência exata, sem títulos de janelas. Ative a troca automática em Configurações.' });
  return el('details', { class: 'advanced-fields', open: applications.length > 0 }, el('summary', {}, 'Trocar por aplicativo', applications.length ? el('span', {}, applications.length + ' associado(s)') : null), item.wrapper,
    button('Escolher aplicativo', () => void perform(async () => {
      const selected = await api.chooseApplication();
      if (!selected) return;
      const values = item.input.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      if (!values.includes(selected)) values.push(selected);
      item.input.value = values.join('\n');
      syncEditing();
    }), '', { symbol: 'folder', 'data-focus': 'choose-application' }));
}

function updateApplicationStatus() {
  const node = document.querySelector('#application-status');
  if (!node) return;
  const application = state.application;
  if (!application || application.status === 'off') { node.textContent = 'Detecção desligada. Salve a configuração para aplicar mudanças.'; node.dataset.status = 'off'; return; }
  node.dataset.status = application.status;
  const current = application.current;
  node.textContent = application.message + (current ? ' Aplicativo: ' + (current.name || current.path || current.bundleId) + '.' : '');
}

function updateInputStatus() {
  const node = document.querySelector('#input-status');
  if (!node) return;
  const relevant = [layerById(), layerById(state.activeLayerId)].some(layer => layer?.bindings.some(binding => binding.enabled !== false && triggerFor(binding) !== 'press'));
  node.hidden = !relevant;
  const mode = state.input?.mode || 'off';
  node.dataset.mode = mode;
  const message = state.input?.message || (mode === 'global' ? 'Entrada global disponível para os momentos da tecla.' : mode === 'starting' ? 'Preparando a entrada global…' : mode === 'unavailable' ? 'Entrada global indisponível. Enquanto pressionada e Ao soltar não executarão ações.' : 'Ative as ações para verificar a entrada global dos momentos da tecla.');
  if (node.textContent !== message) node.textContent = message;
}

function renderBindingKeyboard(container, layer, matches) {
  const context = [container, state.configRevision, layer.id, state.platform, keyboardPreference.layout, keyboardPreference.size, keyboardPreference.geometry, layoutReadGeneration, layoutStatus, visualModifiers, visualTrigger];
  if (visualBindingCache && context.every((value, index) => value === visualBindingCache.context[index])) {
    updateVisualBindingFilter(visualBindingCache, matches);
    return;
  }
  container.replaceChildren();
  const layout = currentKeyboardLayout();
  const names = value => value ? value.replaceAll('Control', 'Ctrl').replaceAll('Command', '⌘').replaceAll('Super', state.platform === 'darwin' ? '⌘' : 'Win') : 'Sem modificadores';
  const combinations = new Set(['', 'Control', 'Alt', 'Shift', 'Control+Shift', ...(state.platform === 'darwin' ? ['Command', 'Command+Shift'] : ['Super'])]);
  for (const binding of layer.bindings) combinations.add(shortcutModifiers(binding.key, state.platform));
  combinations.add(visualModifiers);
  const modifiers = field('keyboard-modifiers', 'Combinação', visualModifiers, { choices: [...combinations].map(value => [value, names(value)]) });
  modifiers.input.dataset.focus = 'keyboard-modifiers';
  modifiers.input.addEventListener('change', () => { visualModifiers = modifiers.input.value; updateBindings(); });
  const moment = field('keyboard-trigger', 'Momento', visualTrigger, { choices: Object.entries(triggerLabels) });
  moment.input.dataset.focus = 'keyboard-trigger';
  moment.input.addEventListener('change', () => { visualTrigger = moment.input.value; updateBindings(); });
  const layoutChoice = field('editor-keyboard-layout', 'Layout', keyboardPreference.layout, { choices: [['auto', 'Automático'], ...Object.entries(layouts).map(([id, item]) => [id, item.name])] });
  layoutChoice.input.dataset.focus = 'editor-keyboard-layout';
  layoutChoice.input.addEventListener('change', () => changeKeyboardPreference('layout', layoutChoice.input.value));
  const nodes = new Map();
  const keyboard = keyboardView(state.platform, nodes, { layout, size: keyboardPreference.size, interactive: true, onKey: code => {
    const key = shortcutForCode(code, layout);
    if (!key) return;
    const value = [visualModifiers, key].filter(Boolean).join('+');
    const existing = layer.bindings.find(binding => binding.key.split('+').at(-1) === key && shortcutModifiers(binding.key, state.platform) === visualModifiers && triggerFor(binding) === visualTrigger);
    startEditor({ kind: 'binding', value: existing || null, seed: existing ? undefined : { key: value, trigger: visualTrigger } });
  } });
  const matched = new Set(matches.map(binding => binding.id));
  for (const [code, node] of nodes) {
    const key = shortcutForCode(code, layout);
    const binding = key && layer.bindings.find(binding => binding.key.split('+').at(-1) === key && shortcutModifiers(binding.key, state.platform) === visualModifiers && triggerFor(binding) === visualTrigger);
    if (!key) { node.disabled = true; node.title = 'Use “Nova ação” para capturar combinações compatíveis.'; node.setAttribute('aria-label', (node.textContent || code) + ': sem atalho simples compatível'); continue; }
    const value = [visualModifiers, key].filter(Boolean).join('+');
    const reserved = [state.config.settings.layerShortcut, state.config.settings.pauseShortcut].some(shortcut => shortcut.split('+').at(-1) === key && shortcutModifiers(shortcut, state.platform) === visualModifiers);
    if (reserved) { node.disabled = true; node.title = 'Reservada para controlar as camadas ou pausar as ações.'; node.setAttribute('aria-label', value + ': reservada para controle'); continue; }
    node.classList.toggle('mapped', Boolean(binding));
    node.classList.toggle('mapped-disabled', binding?.enabled === false);
    node.classList.toggle('unmatched', Boolean(actionQuery && (!binding || !matched.has(binding.id))));
    node.dataset.focus = 'visual-key-' + code;
    node.dataset.shortcut = value;
    if (binding) node.dataset.bindingId = binding.id;
    const label = value + ' · ' + triggerLabels[visualTrigger] + ': ' + (binding ? binding.name + (binding.enabled === false ? ' · desativada' : '') + '. Editar ação' : 'Criar ação');
    node.setAttribute('aria-label', label);
    node.title = label;
  }
  container.classList.remove('table-scroll');
  container.append(el('div', { class: 'binding-visual-toolbar' }, modifiers.wrapper, moment.wrapper, layoutChoice.wrapper), keyboard,
    el('div', { class: 'keyboard-caption' }, el('span', {}, 'Clique em uma tecla para configurar. Use as setas para navegar.'), el('span', {}, 'Rosa: ativada · tracejado: desativada')),
    el('p', { class: 'hint visual-layout-note' }, keyboardPreference.layout === 'auto' ? layoutStatus : layout.name + '. O layout visual não altera os atalhos salvos.'),
    el('div', { class: 'visual-binding-list', role: 'list', 'aria-label': 'Todas as ações, incluindo outras combinações' }, layer.bindings.map(binding => el('div', { 'data-binding-id': binding.id, class: 'visual-binding-item' + (binding.enabled === false ? ' binding-disabled' : ''), role: 'listitem' },
      button(binding.name, () => startEditor({ kind: 'binding', value: binding }), 'quiet visual-binding-edit', { 'data-focus': 'edit-' + binding.id }), shortcut(binding.key, state.platform), el('small', { class: 'visual-trigger-label' }, triggerDescription(binding)), binding.enabled === false ? el('small', { class: 'disabled-label' }, 'Desativada') : null,
      button('Executar teste: ' + binding.name, () => runBinding(layer, binding), 'quiet', { symbol: 'play', iconOnly: true, disabled: pendingBindings.has(binding.id), 'data-focus': 'test-' + binding.id }), bindingMenu(layer, binding)))));
  const first = [...nodes.values()].find(node => !node.disabled);
  if (first) first.tabIndex = 0;
  const emptyMessage = el('p', { class: 'hint' });
  container.append(emptyMessage);
  const items = new Map([...container.querySelectorAll('.visual-binding-item')].map(row => [row.dataset.bindingId, { row, test: row.querySelector('[data-focus^="test-"]') }]));
  visualBindingCache = { context, nodes, items, emptyMessage };
  updateVisualBindingFilter(visualBindingCache, matches);
}

function updateVisualBindingFilter(cache, matches) {
  const matched = new Set(matches.map(binding => binding.id));
  for (const node of cache.nodes.values()) node.classList.toggle('unmatched', Boolean(actionQuery && (!node.dataset.bindingId || !matched.has(node.dataset.bindingId))));
  for (const [id, item] of cache.items) {
    const hidden = !matched.has(id);
    if (item.row.hidden !== hidden) item.row.hidden = hidden;
    const pending = pendingBindings.has(id);
    if (item.test.disabled !== pending) item.test.disabled = pending;
  }
  cache.emptyMessage.hidden = matches.length > 0;
  const text = actionQuery ? 'Nenhuma ação corresponde à busca. Limpe a busca ou clique em uma tecla para criar.' : 'Ainda não há ações nesta camada. Escolha uma tecla para começar.';
  if (cache.emptyMessage.textContent !== text) cache.emptyMessage.textContent = text;
}

function renderLayers() {
  const list = el('aside', { class: 'layer-list', 'aria-label': 'Escolher camada para edição' },
    el('div', { class: 'layer-list-heading' }, el('strong', {}, 'Suas camadas'),
      button('Nova camada', () => startEditor({ kind: 'layer', value: null }), 'quiet', { symbol: 'plus', iconOnly: true, title: 'Nova camada', 'data-focus': 'new-layer' })));
  const choices = el('div', { class: 'layer-choices' });
  state.config.layers.forEach(layer => choices.append(
    el('button', { type: 'button', class: 'layer-choice' + (layer.id === selectedLayerId ? ' selected' : ''), 'aria-pressed': String(layer.id === selectedLayerId), 'data-focus': 'layer-' + layer.id,
      onclick: () => {
        if (layer.id === selectedLayerId && !editor) return;
        void guardNavigation(() => { selectedLayerId = layer.id; editor = null; actionQuery = ''; render('layer-' + layer.id); });
      } },
    el('strong', {}, layer.name),
    layer.id === state.activeLayerId ? el('span', { class: 'live-mark', title: 'Camada em uso', 'aria-label': 'Em uso' }, el('i', { class: 'status-dot enabled', 'aria-hidden': 'true' })) : null,
    el('small', {}, layer.bindings.length + (layer.bindings.length === 1 ? ' ação' : ' ações')))
  ));
  list.append(choices);
  const layer = layerById();
  const current = layer.id === state.activeLayerId;
  const detail = el('section', { class: 'layer-detail', 'aria-label': 'Ações de ' + layer.name });
  detail.append(el('div', { class: 'detail-heading' },
    el('div', {}, el('div', { class: 'title-line' }, el('h1', { id: 'layer-title' }, layer.name),
      el('span', { class: 'badge ' + (current ? 'success' : '') }, current ? 'Em uso' : 'Visualizando')),
    layer.description ? el('p', {}, layer.description) : null),
    el('div', { class: 'button-row' }, !current ? button('Usar esta camada', () => void perform(async () => { state = await api.setLayer(layer.id); render(); return state; }, 'Camada em uso: ' + layer.name), '', { symbol: 'layers' }) : null,
      button('Duplicar camada', () => duplicateLayer(layer), 'quiet', { symbol: 'copy', iconOnly: true, title: 'Duplicar camada', 'data-focus': 'duplicate-layer' }),
      button('Editar camada', () => startEditor({ kind: 'layer', value: layer }), 'quiet', { symbol: 'edit', iconOnly: true, title: 'Editar camada', 'data-focus': 'edit-layer' }),
      button('Nova ação', () => startEditor({ kind: 'binding', value: null }), 'primary', { symbol: 'plus', 'data-focus': 'new-binding' }))));
  detail.append(el('p', { id: 'input-status', class: 'input-mode-status', role: 'status', hidden: true }));
  const search = field('action-search', 'Buscar ações', actionQuery, { type: 'search', placeholder: 'Buscar ação, tecla ou tipo…' });
  search.input.addEventListener('input', () => { actionQuery = search.input.value; updateBindings(); });
  const modes = el('div', { class: 'filter-group binding-view-toggle', role: 'group', 'aria-label': 'Visualização das ações' }, [['table', 'Tabela', 'list'], ['keyboard', 'Teclado', 'keyboard']].map(([value, label, symbol]) => button(label, () => { bindingView = value; try { localStorage.setItem('keyboard-tracker.binding-view', value); } catch { /* Keep session preference. */ } render('view-' + value); }, bindingView === value ? 'selected' : 'quiet', { symbol, 'aria-pressed': String(bindingView === value), 'data-focus': 'view-' + value })));
  detail.append(el('div', { class: 'section-toolbar' }, el('div', { class: 'search-field' }, icon('search'), search.wrapper), modes, el('span', { id: 'action-count' })),
    el('div', { id: 'bindings', class: 'binding-list table-scroll' }),
    el('p', { class: 'test-explanation' }, 'Confira a prévia antes de executar um teste. A execução funciona mesmo com os atalhos pausados.'),
    el('details', { class: 'usage-help' }, el('summary', {}, 'Atalhos e uso'), el('p', {}, 'Selecionar uma camada abre suas ações para edição. “Usar esta camada” troca a camada dos atalhos. Enquanto ativas, as teclas configuradas podem substituir a digitação em outros programas.')));
  const workspace = el('div', { class: 'layer-workspace' }, detail);
  main.append(el('div', { class: 'layer-layout' }, list, workspace));
  if (editor) {
    const form = editor.kind === 'layer' ? layerForm() : editor.kind === 'test' ? testPreviewPanel(layer) : bindingForm(layer);
    const header = form.querySelector('.editor-heading');
    header.querySelector('h2').id = 'drawer-title';
    header.querySelector('p').id = 'drawer-description';
    header.prepend(el('p', { class: 'editor-context' }, editor.kind !== 'layer' ? 'Camada: ' + layer.name : 'Organização das camadas'));
    header.append(button('Fechar editor', closeEditor, 'quiet drawer-close', { symbol: 'close', iconOnly: true, 'data-drawer-close': '' }));
    const danger = form.querySelector('.danger-zone');
    if (danger) form.querySelector('.form-fields').append(danger);
    const drawer = el('dialog', { id: 'editor-drawer', class: 'editor-drawer', 'aria-labelledby': 'drawer-title', 'aria-describedby': 'drawer-description' }, form);
    drawer.addEventListener('cancel', event => {
      event.preventDefault();
      closeEditor();
    });
    // A drag starting inside the form must not become a backdrop dismissal.
    let backdropPointer;
    const outside = event => {
      const rect = drawer.getBoundingClientRect();
      return event.target === drawer && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
    };
    drawer.addEventListener('pointerdown', event => { backdropPointer = event.button === 0 && outside(event) ? event.pointerId : undefined; });
    drawer.addEventListener('pointerup', event => {
      if (backdropPointer !== undefined && backdropPointer === event.pointerId && outside(event)) closeEditor();
      backdropPointer = undefined;
    });
    main.append(drawer);
  }
  updateBindings();
}

function actionSummary(action) {
  if (action.type === 'http') return action.method + ' ' + action.url;
  if (action.type === 'file') return (action.mode === 'append' ? 'Acrescentar em ' : 'Criar ') + action.filename;
  if (action.type === 'clipboard') return action.text;
  if (action.type === 'open') return action.target;
  if (action.type === 'notification') return action.title;
  if (action.type === 'layer') return 'Usar ' + (layerById(action.layerId)?.name || 'camada de destino');
  if (action.type === 'sequence') return action.steps.length + ' etapas · ' + action.steps.map(step => actionTypeLabels[step.type]).join(' → ');
  return action.message;
}

function updateBindings() {
  const container = document.querySelector('#bindings');
  if (!container) return;
  const layer = layerById();
  const query = actionQuery.trim().toLocaleLowerCase('pt-BR');
  const matches = layer.bindings.filter(binding => [binding.name, binding.key, labels[binding.action.type], triggerDescription(binding)].join(' ').toLocaleLowerCase('pt-BR').includes(query));
  const focus = document.activeElement?.dataset.focus;
  document.querySelector('#action-count').textContent = query ? matches.length + ' de ' + layer.bindings.length + ' ações encontradas' : layer.bindings.length + (layer.bindings.length === 1 ? ' ação nesta camada' : ' ações nesta camada');
  container.classList.toggle('table-scroll', bindingView === 'table');
  if (bindingView === 'keyboard') {
    renderBindingKeyboard(container, layer, matches);
    restoreFocus(focus);
    return;
  }
  bindingTable ||= createBindingTable({ platform: state.platform, labels, typeLabels: actionTypeLabels, summaryFor: actionSummary, triggerFor, triggerDescription,
    onTest: (layer, binding) => void runBinding(layer, binding), onEdit: binding => startEditor({ kind: 'binding', value: binding }), menuFor: bindingMenu });
  const table = bindingTable.update(layer, matches, state.events, pendingBindings);
  if (table.parentNode !== container) container.replaceChildren(table);
  const oldEmpty = container.querySelector('.empty-state');
  if (matches.length) oldEmpty?.remove();
  else if (!oldEmpty || oldEmpty.dataset.query !== query) {
    oldEmpty?.remove();
    const message = query
      ? empty('Nenhuma ação encontrada', 'Tente outro nome, tecla ou tipo.', button('Limpar busca', () => { actionQuery = ''; render(); }))
      : empty('Escolha sua primeira tecla', 'Escolha uma tecla para copiar texto, abrir um destino, mostrar uma notificação ou executar uma sequência.',
        button('Criar primeira ação', () => startEditor({ kind: 'binding', value: null }), '', { symbol: 'plus' }));
    message.dataset.query = query;
    container.append(message);
  }
  restoreFocus(focus);
}

function bindingMenu(getModelOrLayer, bindingValue) {
  const model = typeof getModelOrLayer === 'function' ? getModelOrLayer : () => ({ layer: getModelOrLayer, binding: bindingValue });
  const binding = model().binding;
  const menu = el('div', { class: 'action-menu-content', popover: 'auto', role: 'group', id: 'menu-' + binding.id, 'aria-label': 'Mais opções de ' + binding.name });
  menu.addEventListener('beforetoggle', event => {
    if (event.newState !== 'open') return;
    const { layer, binding } = model();
    menu.setAttribute('aria-label', 'Mais opções de ' + binding.name);
    menu.replaceChildren(button(binding.enabled === false ? 'Ativar ação' : 'Desativar ação', () => { menu.hidePopover(); void toggleBinding(layer, binding); }, 'quiet', { symbol: binding.enabled === false ? 'play' : 'pause', 'data-focus': 'toggle-' + binding.id }),
      button('Duplicar ação', () => { menu.hidePopover(); duplicateBinding(binding); }, 'quiet', { symbol: 'copy', 'data-focus': 'duplicate-' + binding.id }),
      button('Remover ação: ' + binding.name, () => { menu.hidePopover(); void removeBinding(layer, binding); }, 'quiet danger', { symbol: 'trash', 'data-focus': 'remove-' + binding.id }));
  });
  menu.addEventListener('toggle', () => { if (!menu.matches(':popover-open')) menu.replaceChildren(); });
  return el('span', { class: 'action-menu' }, button('Mais opções: ' + binding.name, () => {}, 'quiet', { symbol: 'more', iconOnly: true, title: 'Mais opções: ' + binding.name, popovertarget: menu.id, 'data-focus': 'more-' + binding.id }), menu);
}

async function toggleBinding(layer, binding) {
  await guardNavigation(() => void perform(async () => {
    const config = copyConfig();
    config.layers.find(item => item.id === layer.id).bindings.find(item => item.id === binding.id).enabled = binding.enabled === false;
    return saveConfiguration(config, 'more-' + binding.id);
  }, binding.enabled === false ? 'Ação ativada.' : 'Ação desativada.'));
}

function runBinding(layer, binding) {
  if (pendingBindings.has(binding.id)) return;
  startEditor({ kind: 'test', value: binding, layerId: layer.id, preview: null, loading: false, result: null });
}

async function loadTestPreview() {
  const target = editor;
  if (target?.kind !== 'test' || target.loading) return;
  const generation = ++previewGeneration;
  target.loading = true;
  target.error = null;
  target.result = null;
  updateTestPreview();
  try {
    const preview = await api.previewBinding(target.layerId, target.value.id);
    if (editor !== target || generation !== previewGeneration) return;
    target.preview = preview;
    target.resolvedAction = preview.action;
  } catch (error) { if (editor === target) target.error = error.message; }
  finally { if (editor === target) { target.loading = false; updateTestPreview(); } }
}

async function executePreview() {
  const target = editor;
  if (target?.kind !== 'test' || !target.preview || target.running) return;
  target.running = true;
  target.result = null;
  target.error = null;
  pendingBindings.add(target.value.id);
  const previous = new Set(state.events.map(event => event.id));
  const token = target.preview.previewId;
  target.preview = null; // Tokens are consumed once, including failed executions.
  updateTestPreview();
  updateBindings();
  try {
    state = await api.runBinding(target.layerId, target.value.id, token);
    target.result = state.events.find(event => !previous.has(event.id) && event.kind === 'action' && event.bindingId === target.value.id);
    if (target.result) toast(target.result.message, target.result.status);
  } catch (error) { target.error = error.message; }
  finally {
    target.running = false;
    pendingBindings.delete(target.value.id);
    if (editor === target) {
      updateTestPreview();
      document.querySelector('#editor-drawer')?.scrollTo({ top: 0, behavior: 'instant' });
    }
    updateBindings();
    updateStatus();
  }
}

function testPreviewPanel(layer) {
  return el('section', { class: 'editor test-preview', 'aria-label': 'Prévia e teste da ação' },
    el('div', { class: 'editor-heading' }, el('h2', {}, 'Testar ' + editor.value.name), el('p', {}, triggerDescription(editor.value) + ' · ' + editor.value.key), el('p', {}, 'Executar teste realiza uma execução, sem aguardar o delay, iniciar repetição ou aguardar soltura.')),
    el('div', { id: 'test-preview-content', class: 'form-fields', role: 'status', 'aria-live': 'polite' }),
    el('div', { class: 'form-footer' }, button('Fechar', closeEditor),
      el('div', { class: 'button-row' }, button('Atualizar prévia', () => void loadTestPreview(), '', { 'data-focus': 'refresh-preview', 'data-initial-focus': '' }), button('Executar teste', () => void executePreview(), 'primary', { symbol: 'play', 'data-focus': 'execute-preview' }))));
}

function actionPreview(action) {
  if (action.type === 'sequence') return el('section', { class: 'sequence-preview' },
    el('p', { class: 'context-note' }, action.steps.length + ' etapas em ordem. A primeira falha interrompe as próximas; efeitos concluídos não são desfeitos.'),
    el('ol', { class: 'preview-sequence' }, action.steps.map((step, index) => el('li', {}, el('h3', {}, 'Etapa ' + (index + 1) + ' · ' + actionTypeLabels[step.type]), actionPreview(step)))));
  const entries = action.type === 'http' ? [['Método', action.method], ['URL final', action.url], ['Headers', Object.entries(action.headers || {}).map(([key, value]) => key + ': ' + value).join('\n') || 'Sem headers'], ['Corpo', action.body || 'Sem corpo']]
    : action.type === 'file' ? [['Operação', action.mode === 'append' ? 'Acrescentar ao final' : 'Criar sem sobrescrever'], ['Arquivo', action.target], ['Conteúdo', action.content || 'Arquivo vazio']]
      : action.type === 'clipboard' ? [['Texto a copiar', action.text]]
        : action.type === 'open' ? [[{ url: 'URL a abrir', path: 'Arquivo ou pasta', application: 'Aplicativo' }[action.kind], action.target]]
          : action.type === 'notification' ? [['Título', action.title], ['Mensagem', action.message || 'Sem mensagem adicional']]
            : action.type === 'layer' ? [['Camada de destino', action.layerName || layerById(action.layerId)?.name || action.layerId]]
              : [['Mensagem do log', action.message]];
  return el('dl', { class: 'preview-values' }, entries.map(([label, value]) => [el('dt', {}, label), el('dd', {}, el('pre', {}, value))]));
}

function executionSteps(steps, open = false, total, eventId) {
  if (!steps?.length) return null;
  const interrupted = steps.some(step => step.status === 'error');
  return el('details', { class: 'execution-steps', open, 'data-event-steps': eventId },
    el('summary', {}, 'Etapas · ' + steps.length + (total ? ' de ' + total + ' iniciadas' : ' registradas')),
    el('ol', {}, steps.map(step => el('li', { value: step.index, class: 'execution-step ' + step.status },
      el('div', { class: 'execution-step-heading' }, el('strong', {}, 'Etapa ' + step.index + ' · ' + (actionTypeLabels[step.type] || 'Ação')), el('span', { class: 'event-status ' + step.status }, icon(step.status === 'error' ? 'alert' : 'check'), step.status === 'error' ? 'Falhou' : 'Concluída')),
      el('p', {}, step.message), el('p', { class: 'hint' }, [Number.isFinite(step.durationMs) ? step.durationMs + ' ms' : null, step.httpStatus ? 'HTTP ' + step.httpStatus : null].filter(Boolean).join(' · '))))),
    interrupted ? el('p', { class: 'hint' }, 'A sequência parou nesta falha. As etapas anteriores não foram desfeitas.' + (total && total > steps.length ? ' ' + (total - steps.length) + ' etapa(s) não iniciada(s).' : '')) : null);
}

function updateTestPreview() {
  const target = editor;
  const content = document.querySelector('#test-preview-content');
  if (!content || target?.kind !== 'test') return;
  content.replaceChildren();
  const execute = document.querySelector('[data-focus="execute-preview"]');
  const refresh = document.querySelector('[data-focus="refresh-preview"]');
  execute.disabled = !target.preview || target.running || target.loading;
  execute.setAttribute('aria-busy', String(Boolean(target.running)));
  execute.querySelector('span').textContent = target.running ? 'Executando…' : 'Executar teste';
  refresh.disabled = target.running || target.loading;
  if (target.loading) content.append(el('p', { class: 'hint' }, 'Resolvendo variáveis…'));
  if (target.result) content.append(el('section', { class: 'test-result ' + target.result.status, 'data-test-result': target.result.status }, el('h3', {}, target.result.status === 'error' ? 'Falha na execução' : 'Teste concluído'),
    el('p', {}, target.result.message), el('p', { class: 'hint' }, [Number.isFinite(target.result.durationMs) ? target.result.durationMs + ' ms' : null, target.result.httpStatus ? 'HTTP ' + target.result.httpStatus : null].filter(Boolean).join(' · ')),
    el('p', { class: 'hint' }, 'Atualize a prévia para executar outro teste.'),
    executionSteps(target.result.steps, true, target.resolvedAction?.type === 'sequence' ? target.resolvedAction.steps.length : undefined)));
  if (target.error) content.append(el('div', { class: 'form-errors', role: 'alert' }, icon('alert'), target.error));
  if (target.resolvedAction) {
    const action = target.resolvedAction;
    content.append(actionPreview(action),
      el('p', { class: 'hint' }, target.preview ? 'Valores fixos nesta prévia por até 5 minutos.' : 'Valores da última prévia. Atualize para preparar outra execução.'),
      ...(action.type === 'http' || action.type === 'sequence' && action.steps.some(step => step.type === 'http') ? [el('p', { class: 'hint' }, 'Valores de headers ficam ocultos. A execução usa os valores completos.')] : []));
  }
  if (target.running) content.append(el('p', { class: 'context-note' }, icon('play'), 'Executando a ação… Você pode fechar este painel; o resultado ficará no Histórico.'));

  if (!target.preview && !target.loading && !target.running && !target.result && !target.error) content.append(el('p', { class: 'hint' }, 'Aguardando a prévia…'));
}

async function removeBinding(layer, binding) {
  if (!await confirmDialog({ title: 'Remover esta ação?', message: '“' + binding.name + '” (' + triggerDescription(binding) + ') será removida. As outras ações deste atalho serão mantidas.', confirmLabel: 'Remover ação', danger: true })) return;
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
  const previous = editor;
  editor = null;
  stopCapture();
  render(focusKey || previous?.returnFocus);
  window.scrollTo({ top: previous?.scrollY || 0, behavior: 'instant' });
  return result;
}

function shortcutField(name, label, value, hint, options = {}) {
  const item = field(name, label, value, { required: true, placeholder: 'Ex.: A ou Control+Shift+A', hint });
  const record = button('Capturar tecla', () => {
    if (capture?.input === item.input) { stopCapture(); return; }
    stopCapture();
    capture = { input: item.input, button: record, onCapture: options.onCapture };
    record.replaceChildren(icon('keyboard'), el('span', {}, 'Pressione uma tecla…'));
    record.setAttribute('aria-pressed', 'true');
    item.wrapper.classList.add('capturing');
    announce('Pressione a combinação desejada. Escape cancela.');
    requestEditing(true);
    record.focus();
  }, '', { symbol: 'keyboard', 'aria-pressed': 'false' });
  item.input.addEventListener('input', () => options.onManualInput?.());
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
  box.dataset.fieldName = error.fieldName || '';
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
  const initial = current || editor.seed;
  const form = formShell(current ? 'Editar camada' : editor.seed ? 'Duplicar camada' : 'Nova camada', 'Dê um nome que ajude a reconhecer o contexto destas teclas.', async form => {
    const data = new FormData(form);
    const name = String(data.get('name')).trim();
    if (!name) invalid('Informe um nome para a camada.', 'name');
    const value = { id: current?.id || newId('layer'), name, description: String(data.get('description')).trim(), bindings: initial?.bindings || [], applications: String(data.get('applications') || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean) };
    const config = copyConfig();
    if (current) config.layers[config.layers.findIndex(layer => layer.id === current.id)] = value;
    else config.layers.push(value);
    selectedLayerId = value.id;
    actionQuery = '';
    await saveConfiguration(config, 'edit-layer');
    toast('Camada salva.');
  },
    field('name', 'Nome da camada', initial?.name || '', { required: true, maxlength: 80, placeholder: 'Ex.: Trabalho, reuniões ou arquivos' }).wrapper,
    field('description', 'Descrição', initial?.description || '', { maxlength: 240, placeholder: 'Para que você vai usar esta camada?', hint: 'Opcional. Aparece junto das ações.' }).wrapper,
    applicationRules(initial?.applications || []));
  if (current && state.config.layers.length > 1) form.append(el('div', { class: 'danger-zone' }, el('div', {}, el('h3', {}, 'Remover camada'), el('p', {}, 'Remove também as ' + current.bindings.length + ' ações cadastradas nela.')),
    button('Remover camada', () => void removeLayer(current), 'danger', { symbol: 'trash' })));
  return form;
}

function bindingForm(layer) {
  const current = editor.value;
  const initial = current || editor.seed;
  const triggers = createBindingTrigger({ initial, platform: state.platform, shortcutField, onDirty: syncEditing, invalid, getInputState: key => ({ input: state.input, enabled: state.enabled, groupRequiresInput: layer.bindings.some(binding => binding.key === key && binding.enabled !== false && triggerFor(binding) !== 'press') }) });
  editor.triggerControls = triggers;
  const actionEditor = createActionEditor({ initial: initial?.action || { type: 'clipboard', text: '' }, layers: state.config.layers, api,
    defaultDirectory: defaultFilesPath(), onDirty: syncEditing, onError: message => toast(message, 'error'), invalid });
  const form = formShell(current ? 'Editar ação' : editor.seed?.action ? 'Duplicar ação' : 'Nova ação', 'Configure a tecla e depois escolha o que ela executa.', async form => {
    const data = new FormData(form);
    const name = String(data.get('name')).trim();
    const key = String(data.get('key')).trim();
    if (!name) invalid('Dê um nome para identificar esta ação.', 'name');
    if (!key) invalid('Digite ou capture uma tecla para esta ação.', 'key');
    const binding = { id: current?.id || newId('binding'), name, ...triggers.read(), action: actionEditor.read() };
    const config = copyConfig();
    const bindings = config.layers.find(item => item.id === layer.id).bindings;
    if (current) bindings[bindings.findIndex(item => item.id === current.id)] = binding;
    else bindings.push(binding);
    await saveConfiguration(config, 'edit-' + binding.id);
    toast('Ação salva em ' + layer.name + '.');
  },
    field('name', 'Nome da ação', initial?.name || '', { required: true, maxlength: 100, placeholder: 'Ex.: Copiar resposta ou abrir meu projeto' }).wrapper,
    triggers.node, actionEditor.node,
    el('details', { class: 'variable-help' }, el('summary', {}, 'Personalizar com variáveis'), el('p', {}, 'Use em textos, notificações, URLs, parâmetros e conteúdo de arquivos. Numa sequência, todas as etapas usam a tecla e a camada de origem.'),
      el('dl', {}, [['{{key}}', 'Tecla configurada'], ['{{layer}}', 'Nome da camada de origem'], ['{{date}}', 'Data UTC: ano-mês-dia'], ['{{timestamp}}', 'Instante UTC, seguro para nomes de arquivo']].map(([term, description]) => [el('dt', {}, el('code', {}, term)), el('dd', {}, description)]))));
  form.classList.add('compact-binding-editor');
  let invalidTarget;
  form.addEventListener('invalid', event => {
    event.preventDefault();
    if (invalidTarget) return;
    invalidTarget = event.target;
    queueMicrotask(() => {
      for (let parent = invalidTarget.parentElement; parent && parent !== form; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
      const message = invalidTarget.validity.valueMissing ? 'Preencha este campo para continuar.' : invalidTarget.name === 'repeatMs' ? 'Use um intervalo inteiro entre 100 e 60000 ms.' : 'Confira o valor deste campo.';
      formError(form, { message, fieldName: invalidTarget.name });
      invalidTarget = null;
    });
  }, true);
  const header = form.querySelector('.editor-heading');
  header.querySelector('p').classList.add('sr-only');
  header.append(triggers.summary);
  return form;
}

function renderTracking() {
  const tracking = state.tracking;
  const mode = !tracking.enabled ? 'Desligado' : tracking.mode === 'global' ? 'Captura global' : tracking.mode === 'starting' ? 'Iniciando captura' : 'Somente nesta janela';
  const status = !tracking.enabled ? 'off' : tracking.mode === 'global' ? 'active' : tracking.mode === 'starting' ? 'starting' : 'limited';
  main.append(heading('Rastreio do teclado', '', el('span', { class: 'tracking-mode status-indicator', 'data-status': status, role: 'status', 'aria-atomic': 'true' }, el('span', { class: 'status-dot', 'aria-hidden': 'true' }), mode)));
  const layout = field('keyboard-layout', 'Layout', keyboardPreference.layout, { choices: [['auto', 'Automático (sistema)'], ...Object.entries(layouts).map(([id, item]) => [id, item.name])] });
  const size = field('keyboard-size', 'Formato', keyboardPreference.size, { choices: [['full', 'Completo'], ['tkl', 'Sem numérico (TKL)'], ['compact', 'Compacto (60%)']] });
  const geometry = field('keyboard-geometry', 'Padrão físico', keyboardPreference.geometry, { choices: [['auto', 'Referência do layout'], ['ansi', 'ANSI'], ['iso', 'ISO'], ['abnt2', 'ABNT2']] });
  for (const [name, item] of [['layout', layout], ['size', size], ['geometry', geometry]]) item.input.addEventListener('change', () => changeKeyboardPreference(name, item.input.value));
  const toggle = el('input', { type: 'checkbox', role: 'switch', checked: tracking.enabled, 'data-focus': 'tracking-toggle', 'aria-label': 'Ativar rastreio do teclado', onchange: async () => {
    toggle.disabled = true;
    try { state = await api.setTracking(toggle.checked); clearPressed(); render('tracking-toggle'); }
    catch (error) { toggle.checked = tracking.enabled; toast(error.message, 'error'); }
    finally { toggle.disabled = false; }
  } });
  main.append(el('div', { class: 'tracking-toolbar' }, layout.wrapper, size.wrapper,
    el('label', { class: 'switch' }, toggle, el('span', { class: 'switch-track', 'aria-hidden': 'true' }), 'Ativar rastreio')),
    el('p', { id: 'layout-status', class: 'layout-status', role: 'status' }));
  if (tracking.enabled && tracking.mode === 'local') main.append(el('div', { class: 'context-note tracking-limitation', role: 'status' }, icon('alert'), el('p', {}, tracking.message)));
  else if (tracking.mode === 'starting') main.append(el('p', { class: 'tracking-message' }, 'Conectando a captura ao sistema…'));
  main.append(el('section', { class: 'pressed-panel', 'aria-label': 'Teclas pressionadas agora' }, el('h2', {}, 'Pressionadas agora'), el('p', { id: 'pressed-label', role: 'status', 'aria-atomic': 'true' }, 'Nenhuma tecla pressionada'),
    el('div', { id: 'pressed-keys', class: 'pressed-keys', 'aria-hidden': 'true' })),
    el('div', { id: 'keyboard-preview' }),
    el('div', { class: 'keyboard-caption' }, el('span', { id: 'keyboard-reference' }), el('span', {}, 'Teclas pressionadas em rosa')),
    el('details', { class: 'usage-help keyboard-help' }, el('summary', {}, 'Layout, privacidade e funcionamento'), geometry.wrapper,
      el('p', {}, 'As legendas do sistema podem diferir do teclado conectado. Ajuste layout, formato e padrão físico para corrigir a referência. A seleção visual não altera os atalhos das ações.'),
      el('p', {}, 'As teclas rastreadas não são gravadas. O rastreio é independente das ações controladas na barra superior. Algumas teclas internacionais podem não estar disponíveis na captura global deste sistema; seus nomes continuam aparecendo quando recebidos.')));
  refreshKeyboardPreview();
}

function keyEvent(event) {
  if (!state?.tracking.enabled) return;
  if (event.direction === 'down' && pressed.has(event.code)) return;
  if (event.direction === 'up' && !pressed.has(event.code)) return;
  if (event.direction === 'down') pressed.set(event.code, keyboardEventLabel(currentKeyboardLayout(), event));
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
  main.append(heading('Histórico de execução', '',
    el('div', { class: 'button-row' }, button('Exportar histórico', () => void perform(() => api.exportHistory()), '', { symbol: 'download', 'data-focus': 'export-history' }),
      button('Abrir pasta de dados', () => void perform(() => api.openDataDirectory()), 'quiet', { symbol: 'folder' }))));
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
  const expandedEvents = new Set([...container.querySelectorAll('[data-event-steps][open]')].map(node => node.dataset.eventSteps));
  container.replaceChildren();
  if (!events.length) {
    container.append(empty(query ? 'Nenhum evento encontrado' : historyFilter === 'error' ? 'Nenhum erro registrado' : 'Seu histórico começa com uma ação',
      query ? 'Tente outra busca ou altere o filtro.' : historyFilter === 'error' ? 'As falhas de execução aparecerão aqui com o motivo.' : 'Execute um teste em Camadas para conferir o resultado aqui.',
      !query && historyFilter !== 'error' ? button('Configurar ações', () => navigate('layers'), '', { symbol: 'layers' }) : null));
    return;
  }
  const body = el('tbody');
  container.classList.add('table-scroll');
  container.append(el('table', { class: 'event-table' }, el('caption', { class: 'sr-only' }, 'Histórico de execução'),
    el('thead', {}, el('tr', {}, [['Horário', 'event-time'], ['Resultado', 'event-status-cell'], ['Evento', ''], ['Camada / tecla', 'event-context']].map(([label, className]) => el('th', { scope: 'col', class: className }, label)))), body));
  for (const event of events) {
    const date = new Date(event.time);
    const valid = !Number.isNaN(date.getTime());
    const context = () => el('span', { class: 'event-meta' }, event.layer || '', event.key ? shortcut(event.key, state.platform) : null, event.key ? el('span', { class: 'event-trigger' }, triggerDescription(event)) : null);
    body.append(el('tr', {},
      el('td', { class: 'event-time' }, el('time', { datetime: valid ? date.toISOString() : undefined, title: valid ? date.toLocaleString('pt-BR') : '' },
        valid ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—')),
      el('td', { class: 'event-status-cell' }, el('span', { class: 'event-status ' + event.status }, icon(event.status === 'error' ? 'alert' : event.status === 'success' ? 'check' : 'layers'),
        { success: 'Concluído', error: 'Erro', info: 'Sistema' }[event.status] || event.status)),
      el('td', {}, el('p', { class: 'event-message' }, event.message), el('span', { class: 'event-mobile-context' }, context()), executionSteps(event.steps, expandedEvents.has(event.id), undefined, event.id)),
      el('td', { class: 'event-context' }, context())));
  }

}

function defaultFilesPath() {
  const separator = state.platform === 'win32' ? '\\' : '/';
  return state.paths.documents.replace(/[\\/]$/, '') + separator + 'Keyboard Tracker';
}

function renderSettings() {
  main.append(heading('Configurações'));
  const theme = field('theme', 'Tema', window.keyboardAppearance.preference, { choices: [['system', 'Seguir o sistema'], ['light', 'Claro'], ['dark', 'Escuro']], hint: 'Aplicado na hora e salvo neste computador.' });
  theme.input.addEventListener('change', () => window.keyboardAppearance.set(theme.input.value));
  const appearance = el('section', { class: 'settings-section appearance-section' }, el('div', { class: 'section-heading' }, el('h2', {}, 'Aparência')), theme.wrapper);
  const settings = state.config.settings;
  const shortcutForm = formShell('Atalhos de controle', 'Estes atalhos valem para todas as camadas.', async form => {
    const data = new FormData(form);
    const config = copyConfig();
    config.settings = { ...settings, layerShortcut: String(data.get('layerShortcut')).trim(), pauseShortcut: String(data.get('pauseShortcut')).trim(), cooldownMs: Number(data.get('cooldownMs')), autoSwitchLayers: data.get('autoSwitchLayers') === 'on', closeToTray: state.desktop?.trayAvailable ? data.get('closeToTray') === 'on' : Boolean(settings.closeToTray) };
    await saveConfiguration(config, 'save-settings');
    toast('Configurações salvas.');
  },
    el('div', { class: 'form-grid' }, shortcutField('layerShortcut', 'Alternar camada', settings.layerShortcut, 'Percorre suas camadas na ordem da lista.'),
      shortcutField('pauseShortcut', 'Pausar ou retomar ações', settings.pauseShortcut, 'Disponível após a primeira ativação pelo botão.')),
    el('section', { class: 'behavior-settings' }, el('h3', {}, 'Comportamento'),
      checkboxField('autoSwitchLayers', 'Trocar camadas conforme o aplicativo em foco', settings.autoSwitchLayers, 'Associe aplicativos no editor de cada camada. Ao sair, a última camada manual é retomada.'),
      el('p', { id: 'application-status', class: 'application-status', role: 'status' }),
      checkboxField('closeToTray', 'Manter na bandeja ao fechar a janela', settings.closeToTray, state.desktop?.trayAvailable ? 'Use “Sair” no menu da bandeja para encerrar o aplicativo.' : 'A bandeja não está disponível nesta sessão. Fechar a janela encerra o aplicativo.', !state.desktop?.trayAvailable)),
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
    el('details', { class: 'storage-details' }, el('summary', {}, 'Locais dos arquivos'),
      el('div', { class: 'path-list' }, [['Dados do aplicativo', state.paths.data], ['Arquivos criados por padrão', defaultFilesPath()], ['Log de execução', state.paths.log]].map(([label, path]) =>
        el('div', { class: 'path-row' }, el('strong', {}, label), el('code', {}, path)))),
      button('Abrir pasta de dados', () => void perform(() => api.openDataDirectory()), '', { symbol: 'folder' })),
    el('p', { class: 'hint token-note' }, 'Tokens de API ficam na configuração e na cópia exportada. Guarde o arquivo em um local de confiança.'));
  const support = el('details', { class: 'settings-section support-details' }, el('summary', {}, 'Captura e permissões'),
    el('div', { class: 'platform-note' }, el('strong', {}, state.platform === 'linux' && state.session === 'wayland' ? 'Você está no Linux com Wayland' : state.platform === 'darwin' ? 'Você está no macOS' : state.platform === 'win32' ? 'Você está no Windows' : 'Você está no Linux com X11'),
      el('p', {}, state.session === 'wayland' ? 'O teclado visual funciona com esta janela em foco. Para rastreio global integral, use uma sessão X11. Os atalhos globais dependem do portal do compositor.' : state.platform === 'darwin' ? 'Autorize o aplicativo em Privacidade e Segurança → Acessibilidade. O sistema também pode solicitar Monitoramento de Entrada.' : 'Atalhos ocupados por outro programa são informados na barra de avisos. O rastreio global pode depender de permissões da sessão.')),
    el('p', { class: 'hint' }, 'Ao abrir o aplicativo, as ações começam pausadas e o rastreio desligado.'));
  main.append(el('div', { class: 'settings-layout' }, el('div', {}, shortcutForm, support), el('div', {}, appearance, data)));
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
  const physical = event.code.startsWith('Key') ? event.code.slice(3) : event.code.startsWith('Digit') ? event.code.slice(5) : mapped[event.code] || event.code;
  const logical = shortcutForCode(event.code, { keys: { [event.code]: event.key === ' ' ? undefined : event.key } });
  const key = logical || physical;
  if (!key || key === 'Unidentified') return null;
  return [...parts, key].join('+');
}

document.addEventListener('focusin', syncEditing);
document.addEventListener('focusout', () => queueMicrotask(syncEditing));
function clearFieldError(event) {
  event.target.removeAttribute('aria-invalid');
  const box = event.target.closest('form')?.querySelector('.form-errors');
  if (box?.dataset.fieldName && box.dataset.fieldName === event.target.name) { box.hidden = true; box.replaceChildren(); delete box.dataset.fieldName; }
  syncEditing();
}
document.addEventListener('input', clearFieldError);
document.addEventListener('change', clearFieldError);
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
      capture.onCapture?.(event.code, value);
      stopCapture();
      input.focus();
      clearFieldError({ target: input });
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
for (const item of document.querySelectorAll('#navigation [data-view]')) {
  const label = item.textContent;
  item.setAttribute('aria-label', label);
  item.replaceChildren(icon({ layers: 'layers', tracking: 'keyboard', history: 'history', settings: 'settings' }[item.dataset.view]), el('span', { class: 'nav-label', 'aria-hidden': 'true' }, label));
}
document.querySelector('#active-layer-picker').addEventListener('change', event => {
  const id = event.target.value;
  event.target.value = state.activeLayerId;
  void guardNavigation(() => void perform(async () => {
    state = await api.setLayer(id);
    editor = null;
    if (view === 'layers') selectedLayerId = id;
    render();
    toast('Camada em uso: ' + layerById(id).name, 'info');
  }));
});

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
    api.onCloseRequested?.(async ({ toTray }) => {
      if (isDirty() && !await confirmDialog({ title: toTray ? 'Ocultar sem salvar?' : 'Sair sem salvar?', message: 'Você tem alterações que ainda não foram salvas.', confirmLabel: toTray ? 'Descartar e ocultar' : 'Descartar e sair', cancelLabel: 'Continuar editando', danger: true })) { await api.cancelClose(); return; }
      editor = null;
      stopCapture();
      render();
      requestEditing(false);
      await editingQueue;
      closingAllowed = !toTray;
      await api.confirmClose();
      if (toTray) closingAllowed = false;
    });
    selectedLayerId = state.activeLayerId;
    render();
    api.onState(next => {
      const previous = state;
      const configChanged = previous.configRevision !== next.configRevision;
      const layerChanged = previous.activeLayerId !== next.activeLayerId;
      const trackingChanged = previous.tracking.enabled !== next.tracking.enabled || previous.tracking.mode !== next.tracking.mode || previous.tracking.message !== next.tracking.message;
      const eventsChanged = previous.events.length !== next.events.length || previous.events[0]?.id !== next.events[0]?.id;
      state = next;
      updateStatus();
      if (trackingChanged) clearPressed();
      if (layerChanged) toast('Camada em uso: ' + (layerById(next.activeLayerId)?.name || '—'), 'info');
      if (editor?.kind === 'test' && configChanged) { ++previewGeneration; editor.loading = false; editor.preview = null; editor.error = 'A configuração mudou. Atualize a prévia antes de executar.'; updateTestPreview(); }
      if (layerChanged && !editor && selectedLayerId === previous.activeLayerId) { selectedLayerId = next.activeLayerId; actionQuery = ''; }
      if (view === 'history') updateHistory();
      if (view === 'layers' && !editor && !layerChanged && !configChanged && eventsChanged) updateBindings();
      if (!editor && !isDirty() && !textFocus() && (configChanged || layerChanged || (view === 'tracking' && trackingChanged))) render();
    });
    api.onKey(keyEvent);
    void refreshSystemLayout();
  } catch (error) {
    document.querySelector('#engine-status').textContent = 'Não foi possível iniciar';
    document.querySelector('#engine-detail').textContent = 'Feche e abra o aplicativo novamente.';
    main.replaceChildren(heading('Não foi possível carregar suas camadas', 'A configuração foi preservada. Feche e abra o aplicativo para tentar novamente.'));
    toast(error.message, 'error');
  }
}

// Some Chromium builds expose getLayoutMap without EventTarget support.
navigator.keyboard?.addEventListener?.('layoutchange', () => void refreshSystemLayout());
window.addEventListener('focus', () => { if (view === 'tracking') void refreshSystemLayout(); });
