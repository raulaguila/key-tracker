(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  function node(tag, attributes = {}, ...children) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (name.startsWith('on')) element.addEventListener(name.slice(2), value);
      else if (['checked', 'disabled', 'hidden', 'required'].includes(name)) element[name] = value;
      else element.setAttribute(name, value);
    }
    for (const child of children.flat(Infinity)) if (child !== null && child !== undefined) element.append(child instanceof Node ? child : String(child));
    return element;
  }
  // Reuse the application's icon vocabulary; no external assets or dependencies.
  const paths = {
    layers: ['M12 3 2 8l10 5 10-5-10-5Z', 'm2 12 10 5 10-5', 'm2 16 10 5 10-5'],
    tracking: ['M4 5h16v14H4V5Z', 'M7 9h.01M12 9h.01M17 9h.01M7 12h.01M12 12h.01M17 12h.01M8 16h8'],
    history: ['M3 11a9 9 0 1 1 2.5 7', 'M3 4v7h7', 'M12 7v5l3 2'],
    settings: ['M4 6h16M4 12h16M4 18h16', 'M8 3v6M16 9v6M10 15v6'],
    sidebar: ['M3 4h18v16H3V4ZM9 4v16', 'm14 9 3 3-3 3'],
    plus: ['M12 5v14M5 12h14'], search: ['m21 21-5-5', 'M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z'],
    play: ['m9 5 11 7-11 7V5Z'], edit: ['m16 3 5 5-12 12H4v-5L16 3Z', 'm14 5 5 5'],
    close: ['m6 6 12 12M6 18 18 6'], check: ['m5 12 4 4L19 6'],
    alert: ['m12 3 10 18H2L12 3Z', 'M12 9v4M12 17h.01'],
    download: ['m7 11 5 5 5-5M12 3v13M4 17v4h16v-4'], upload: ['m7 8 5-5 5 5M12 3v12M4 15v6h16v-6']
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon' })) svg.setAttribute(key, value);
    for (const d of paths[name] || paths.layers) { const p = document.createElementNS(svg.namespaceURI, 'path'); p.setAttribute('d', d); svg.append(p); }
    return svg;
  }
  function button(label, callback, symbol, variant = '', iconOnly = false) {
    return node('button', { type: 'button', class: 'control ' + variant + (iconOnly ? ' icon-only' : ''), 'aria-label': label, title: iconOnly ? label : '', onclick: callback }, symbol ? icon(symbol) : null, iconOnly ? null : label);
  }
  function shortcut(key) { return node('span', { class: 'shortcut' }, key.split('+').map(part => node('kbd', {}, part))); }
  let feedbackTimer;
  function feedback(message) { clearTimeout(feedbackTimer); $('#feedback').textContent = message; $('#feedback').hidden = false; feedbackTimer = setTimeout(() => { $('#feedback').hidden = true; }, 4500); }

  const layers = [
    { name: 'Automação', description: 'Integrações e tarefas do dia a dia.', actions: [
      ['A', 'Enviar evento ao CRM', 'HTTP', 'POST api.exemplo.test/events'],
      ['S', 'Salvar nota rápida', 'Arquivo', 'Documentos/notas/{{date}}.txt'],
      ['D', 'Registrar marcador', 'Log', 'Marcador em {{timestamp}}'],
      ['F', 'Consultar status', 'HTTP', 'GET api.exemplo.test/status'],
      ['G', 'Acrescentar ao diário', 'Arquivo', 'Documentos/diario.txt'],
      ['H', 'Iniciar rotina', 'HTTP', 'POST api.exemplo.test/routines/start'],
      ['Ctrl+J', 'Registrar checkpoint', 'Log', 'Checkpoint · {{layer}}'],
      ['Ctrl+K', 'Criar arquivo de tarefa', 'Arquivo', 'Documentos/tarefas/{{timestamp}}.txt']
    ] },
    { name: 'Notas', description: 'Arquivos e registros pessoais.', actions: [['A', 'Criar nota', 'Arquivo', 'Documentos/notas/{{timestamp}}.txt'], ['S', 'Registrar ideia', 'Log', 'Ideia · {{timestamp}}']] },
    { name: 'Desenvolvimento', description: 'Atalhos para seu ambiente de trabalho.', actions: [['A', 'Consultar ambiente', 'HTTP', 'GET localhost:3000/status'], ['S', 'Criar registro', 'Log', 'Validação · {{timestamp}}']] },
    { name: 'Apresentação', description: 'Controles para uma apresentação.', actions: [['A', 'Próximo slide', 'HTTP', 'POST localhost:4000/next']] }
  ];
  const events = [
    ['14:32:08', 'Concluído', 'Enviar evento ao CRM', 'HTTP 201 · 124 ms', 'A'],
    ['14:31:42', 'Concluído', 'Salvar nota rápida', 'Arquivo criado em Documentos/notas', 'S'],
    ['14:30:19', 'Erro', 'Consultar status', 'HTTP 503 · serviço indisponível', 'F'],
    ['14:29:50', 'Concluído', 'Registrar marcador', 'Mensagem adicionada ao log', 'D'],
    ['14:28:11', 'Concluído', 'Acrescentar ao diário', 'Conteúdo acrescentado', 'G'],
    ['14:26:38', 'Concluído', 'Iniciar rotina', 'HTTP 202 · 208 ms', 'H']
  ];
  const names = { layers: 'Camadas', tracking: 'Rastreio', history: 'Histórico', settings: 'Configurações' };
  const content = $('#content');
  let view = 'layers', selected = 0, active = 0, query = '', historyFilter = 'all', editing = null;
  let layout = 'br', size = 'full', tracking = false, map = null, autoStatus = '', autoGeneration = 0;
  const pressed = new Map();

  function heading(title, description, actions) {
    return node('div', { class: 'page-heading' }, node('div', {}, node('div', { class: 'title-line' }, node('h1', {}, title)), description ? node('p', { class: 'subtitle' }, description) : null), actions);
  }
  function search(value, placeholder, callback) {
    return node('div', { class: 'search' }, icon('search'), node('input', { type: 'search', value, placeholder, 'aria-label': placeholder, oninput: event => callback(event.target.value) }));
  }
  function render() {
    $('#page-name').textContent = names[view];
    for (const item of document.querySelectorAll('#navigation button')) {
      if (item.dataset.view === view) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    }
    $('#status-context').textContent = 'Em uso: ' + layers[active].name;
    content.replaceChildren();
    ({ layers: renderLayers, tracking: renderTracking, history: renderHistory, settings: renderSettings })[view]();
  }
  function navigate(next) { view = next; editing = null; pressed.clear(); query = ''; render(); content.focus(); }
  function renderLayers() {
    const pane = node('aside', { class: 'layers-pane', 'aria-label': 'Camadas para edição' }, node('div', { class: 'pane-title' }, 'Suas camadas', button('Nova camada', () => {
      layers.push({ name: 'Nova camada', description: 'Configure suas primeiras ações.', actions: [] }); selected = layers.length - 1; render();
    }, 'plus', 'quiet', true)));
    const choices = node('div', { class: 'layer-options' }, layers.map((layer, index) => node('button', { type: 'button', class: 'layer' + (index === selected ? ' selected' : ''), 'aria-pressed': String(index === selected), onclick: () => { selected = index; editing = null; query = ''; render(); } }, node('span', {}, layer.name), index === active ? node('i', { class: 'dot on', 'aria-label': 'Em uso', title: 'Em uso' }) : null, node('small', {}, layer.actions.length))));
    pane.append(choices, node('p', { class: 'layer-note' }, 'Selecionar uma camada abre suas ações para edição.'));
    const current = layers[selected];
    const surface = node('section', { class: 'surface', 'aria-label': 'Ações de ' + current.name });
    const actions = node('div', { class: 'settings-buttons' }, selected !== active ? button('Usar camada', () => { active = selected; render(); }, 'layers') : null,
      button('Nova ação', () => { editing = -1; render(); $('#action-name').focus(); }, 'plus', 'primary'));
    const header = heading(current.name, current.description, actions);
    header.querySelector('.title-line').append(node('span', { class: selected === active ? 'badge' : 'muted' }, selected === active ? 'Em uso' : 'Visualizando'));
    surface.append(header, node('div', { class: 'toolbar' }, search(query, 'Buscar ação ou tecla…', value => { query = value; updateActions(); }), node('span', { class: 'muted', id: 'action-count' }, current.actions.length + ' ações')),
      node('div', { class: 'table-wrap', id: 'actions-table' }),
      node('p', { class: 'table-footnote' }, icon('alert'), 'Nesta prévia, testar uma ação apenas simula o resultado.'));
    const workspace = node('div', { class: 'actions-workspace' + (editing !== null ? ' with-editor' : '') }, surface);
    if (editing !== null) workspace.append(editor(current));
    content.append(node('div', { class: 'layers-layout' }, pane, workspace));
    updateActions();
  }
  function updateActions() {
    const current = layers[selected];
    const matches = current.actions.map((action, index) => ({ action, index })).filter(({ action }) => action.join(' ').toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
    $('#action-count').textContent = matches.length + (matches.length === 1 ? ' ação' : ' ações');
    const table = node('table', {}, node('caption', { class: 'sr-only' }, 'Ações configuradas em ' + current.name), node('thead', {}, node('tr', {},
      node('th', { scope: 'col', class: 'key-column' }, 'Tecla'), node('th', { scope: 'col' }, 'Nome'), node('th', { scope: 'col', class: 'type-column' }, 'Tipo'), node('th', { scope: 'col', class: 'detail-column' }, 'Destino / conteúdo'), node('th', { scope: 'col' }, node('span', { class: 'sr-only' }, 'Ações')))));
    const body = node('tbody');
    for (const { action, index } of matches) body.append(node('tr', {}, node('td', {}, shortcut(action[0])), node('td', {}, node('strong', {}, action[1])), node('td', { class: 'type-column muted' }, action[2]), node('td', { class: 'detail-column detail-cell mono', title: action[3] }, action[3]),
      node('td', {}, node('div', { class: 'row-controls' }, button('Simular teste: ' + action[1], () => feedback('Simulação concluída. Nenhuma request ou arquivo foi criado.'), 'play', 'quiet', true), button('Editar: ' + action[1], () => { editing = index; render(); $('#action-name').focus(); }, 'edit', 'quiet', true)))));
    table.append(body);
    $('#actions-table').replaceChildren(matches.length ? table : node('p', { class: 'empty' }, query ? 'Nenhuma ação encontrada.' : 'Adicione a primeira ação desta camada.'));
  }
  function editor(layer) {
    const action = editing === -1 ? ['', '', 'HTTP', ''] : layer.actions[editing];
    const form = node('form', { class: 'inspector', 'aria-label': 'Editor de ação', onsubmit: event => {
      event.preventDefault(); const data = new FormData(form);
      const entry = ['key', 'name', 'type', 'destination'].map(key => String(data.get(key)).trim());
      if (editing === -1) layer.actions.push(entry); else layer.actions[editing] = entry;
      editing = null; render(); feedback('Alteração mantida apenas nesta prévia.');
    } });
    form.append(node('div', { class: 'inspector-header' }, node('h2', {}, editing === -1 ? 'Nova ação' : 'Editar ação'), button('Fechar editor', () => { editing = null; render(); }, 'close', 'quiet', true)),
      node('label', { for: 'action-name' }, 'Nome', node('input', { id: 'action-name', name: 'name', required: true, value: action[1] })),
      node('label', { for: 'action-key' }, 'Tecla', node('input', { id: 'action-key', name: 'key', required: true, value: action[0], placeholder: 'Ex.: Ctrl+J' })),
      node('label', { for: 'action-type' }, 'Tipo de ação', node('select', { id: 'action-type', name: 'type' }, ['HTTP', 'Arquivo', 'Log'].map(type => { const option = node('option', { value: type }, type); option.selected = type === action[2]; return option; }))),
      node('label', { for: 'action-destination' }, 'Destino / conteúdo', node('textarea', { id: 'action-destination', name: 'destination', required: true }, action[3])),
      node('details', {}, node('summary', {}, 'Opções avançadas'), node('p', { class: 'muted' }, 'No aplicativo, este espaço reúne método HTTP, headers, parâmetros e variáveis.')),
      node('div', { class: 'form-actions' }, button('Cancelar', () => { editing = null; render(); }, null, 'quiet'), node('button', { type: 'submit', class: 'control primary' }, 'Salvar ação')),
      node('p', { class: 'inspector-note' }, 'Protótipo: os campos são ilustrativos e não executam ações.'));
    return form;
  }

  // Base legends from XKB br/pt/fr/de basic layouts. These are reference
  // geometries, not hardware detection. OS/macOS variants can differ.
  const base = Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(key => ['Key' + key, key]));
  Object.assign(base, { Backquote: '`', Minus: '−', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', IntlBackslash: '\\', IntlRo: '/', NumpadDecimal: '.' });
  for (let i = 0; i <= 9; i++) base['Digit' + i] = String(i);
  const layouts = {
    us: { name: 'English (US) · ANSI', geometry: 'ansi', keys: { ...base } },
    br: { name: 'Português (BR) · ABNT2', geometry: 'abnt2', keys: { ...base, Backquote: "'", BracketLeft: '´', BracketRight: '[', Backslash: ']', Semicolon: 'Ç', Quote: '~', Slash: ';', NumpadDecimal: ',' } },
    pt: { name: 'Português (PT) · ISO', geometry: 'iso', keys: { ...base, Backquote: '\\', Minus: "'", Equal: '«', BracketLeft: '+', BracketRight: '´', Backslash: '~', Semicolon: 'Ç', Quote: 'º', IntlBackslash: '<', Slash: '−', NumpadDecimal: ',' } },
    fr: { name: 'Français · AZERTY / ISO', geometry: 'iso', keys: { ...base, KeyQ: 'A', KeyW: 'Z', KeyA: 'Q', KeyZ: 'W', Semicolon: 'M', KeyM: ',', Comma: ';', Period: ':', Slash: '!', Backquote: '²', Digit1: '&', Digit2: 'é', Digit3: '"', Digit4: "'", Digit5: '(', Digit6: '−', Digit7: 'è', Digit8: '_', Digit9: 'ç', Digit0: 'à', Minus: ')', BracketLeft: '^', BracketRight: '$', Quote: 'ù', Backslash: '*', IntlBackslash: '<' } },
    de: { name: 'Deutsch · QWERTZ / ISO', geometry: 'iso', keys: { ...base, KeyY: 'Z', KeyZ: 'Y', Backquote: '^', Minus: 'ß', Equal: '´', BracketLeft: 'Ü', BracketRight: '+', Semicolon: 'Ö', Quote: 'Ä', Backslash: '#', IntlBackslash: '<', Slash: '−', NumpadDecimal: ',' } }
  };
  function selectedLayout() {
    if (layout !== 'auto') return layouts[layout];
    // Use a reference shape; getLayoutMap supplies legends, not device geometry.
    const reference = map?.get('Semicolon')?.toLowerCase() === 'ç' && map?.get('BracketRight') === '[' ? layouts.br : layouts.us;
    const keys = { ...reference.keys };
    if (map) for (const [code, value] of map) if (value && !['Dead', 'Unidentified'].includes(value)) keys[code] = value.length === 1 && /\p{L}/u.test(value) ? value.toUpperCase() : value;
    return { name: map ? 'Sistema · legendas detectadas' : 'US · referência provisória', geometry: reference.geometry, keys };
  }
  async function detectLayout() {
    const generation = ++autoGeneration;
    try {
      if (!navigator.keyboard?.getLayoutMap) throw new Error('unavailable');
      const result = await navigator.keyboard.getLayoutMap();
      if (!result.size) throw new Error('empty');
      if (generation !== autoGeneration) return;
      map = result; autoStatus = 'Legendas fornecidas pelo sistema. O formato físico continua sendo uma referência.';
    } catch {
      if (generation !== autoGeneration) return;
      map = null; autoStatus = 'Detecção indisponível neste ambiente. US como referência; escolha um layout para ajustar.';
    }
    if (view === 'tracking' && layout === 'auto') render();
  }
  function renderTracking() {
    const chosen = selectedLayout();
    const layoutSelect = node('select', { id: 'keyboard-layout', onchange: event => { layout = event.target.value; pressed.clear(); render(); if (layout === 'auto') void detectLayout(); } },
      [['auto', 'Automático (sistema)'], ...Object.entries(layouts).map(([id, data]) => [id, data.name])].map(([value, label]) => { const option = node('option', { value }, label); option.selected = value === layout; return option; }));
    const formatSelect = node('select', { id: 'keyboard-format', onchange: event => { size = event.target.value; pressed.clear(); render(); } }, [['full', 'Completo'], ['tkl', 'Sem numérico (TKL)'], ['compact', 'Compacto (60%)']].map(([value, label]) => { const option = node('option', { value }, label); option.selected = value === size; return option; }));
    const surface = node('section', { class: 'surface' }, heading('Rastreio do teclado', null, node('span', { class: 'muted' }, 'Captura nesta janela')),
      node('div', { class: 'tracking-controls' }, node('label', { class: 'inline-field', for: 'keyboard-layout' }, 'Layout', layoutSelect), node('label', { class: 'inline-field', for: 'keyboard-format' }, 'Formato', formatSelect),
        node('label', { class: 'tracking-switch' }, node('input', { type: 'checkbox', id: 'track-toggle', checked: tracking, onchange: event => { tracking = event.target.checked; pressed.clear(); updatePressed(); } }), 'Ativar rastreio')),
      node('p', { class: 'layout-status', role: 'status' }, layout === 'auto' ? autoStatus || 'Lendo o mapeamento do sistema…' : 'Layout escolhido manualmente · ' + chosen.name),
      node('div', { class: 'pressed' }, node('span', {}, 'Pressionadas agora'), node('div', { id: 'pressed-output', class: 'pressed-output', role: 'status', 'aria-live': 'polite' })),
      node('div', { class: 'keyboard-scroll', tabindex: '0', role: 'region', 'aria-label': 'Teclado visual. Role horizontalmente quando necessário.' }, keyboard(chosen)),
      node('div', { class: 'keyboard-caption' }, node('span', {}, 'Formato de referência: ' + chosen.geometry.toUpperCase()), node('span', {}, 'As teclas pressionadas são destacadas em rosa.')),
      node('details', { class: 'keyboard-help' }, node('summary', {}, 'Sobre o layout e o rastreio'), node('p', {}, 'O mapeamento do sistema pode diferir das legendas impressas no teclado. A seleção manual corrige a prévia. Neste protótipo, a captura funciona apenas com esta página em foco e não grava teclas.')));
    content.append(surface); updatePressed();
  }
  function keyboard(chosen) {
    const iso = chosen.geometry !== 'ansi';
    function key(code, label, units = 1, extra = '') {
      const actual = chosen.keys[code] ?? label;
      return node('span', { class: 'key u-' + String(units).replace('.', '-') + ' ' + extra, 'data-code': code, title: code }, extra === 'iso-enter' ? node('span', { class: 'iso-shape' }, 'Enter') : actual);
    }
    const letters = value => [...value].map(letter => key('Key' + letter, letter));
    const row = (keys, extra = '') => node('div', { class: 'key-row ' + extra }, keys);
    const main = node('div', { class: 'keyboard-main' });
    if (size !== 'compact') main.append(row([key('Escape', 'Esc'), ...Array.from({ length: 12 }, (_, i) => key('F' + (i + 1), 'F' + (i + 1)))], 'functions'));
    main.append(
      row([key('Backquote', '`'), ...'1234567890'.split('').map(digit => key('Digit' + digit, digit)), key('Minus', '−'), key('Equal', '='), key('Backspace', '⌫', 2)]),
      row([key('Tab', 'Tab', 1.5), ...letters('QWERTYUIOP'), key('BracketLeft', '['), key('BracketRight', ']'), iso ? key('Enter', 'Enter', 1.5, 'iso-enter') : key('Backslash', '\\', 1.5)]),
      row([key('CapsLock', 'Caps', 1.75), ...letters('ASDFGHJKL'), key('Semicolon', ';'), key('Quote', "'"), iso ? key('Backslash', ']') : null, iso ? key('', '', 1.25, 'void') : key('Enter', 'Enter', 2.25)]),
      row([key('ShiftLeft', 'Shift', iso ? 1.25 : 2.25), iso ? key('IntlBackslash', '\\') : null, ...letters('ZXCVBNM'), key('Comma', ','), key('Period', '.'), key('Slash', '/'), chosen.geometry === 'abnt2' ? key('IntlRo', '/') : null, key('ShiftRight', 'Shift', chosen.geometry === 'abnt2' ? 1.75 : 2.75)]),
      row([key('ControlLeft', 'Ctrl', 1.25), key('MetaLeft', 'Super', 1.25, 'small'), key('AltLeft', 'Alt', 1.25), key('Space', '', 6.25), key('AltRight', 'AltGr', 1.25, 'small'), key('MetaRight', 'Super', 1.25, 'small'), key('ContextMenu', 'Menu', 1.25, 'small'), key('ControlRight', 'Ctrl', 1.25)]));
    const assembly = node('div', { class: 'keyboard', 'data-size': size, role: 'img', 'aria-label': 'Prévia do teclado ' + chosen.name + '. Teclas pressionadas também aparecem na lista acima.' }, main);
    if (size !== 'compact') assembly.append(node('div', { class: 'keyboard-navigation' },
      row([key('PrintScreen', 'PrtSc'), key('ScrollLock', 'Scroll'), key('Pause', 'Pause')], 'functions'),
      row([key('Insert', 'Ins'), key('Home', 'Home'), key('PageUp', 'PgUp')]), row([key('Delete', 'Del'), key('End', 'End'), key('PageDown', 'PgDn')]),
      row([key('', '', 1, 'void'), key('ArrowUp', '↑'), key('', '', 1, 'void')], 'arrow-gap'), row([key('ArrowLeft', '←'), key('ArrowDown', '↓'), key('ArrowRight', '→')])));
    if (size === 'full') assembly.append(node('div', { class: 'keyboard-numpad' }, row([key('NumLock', 'Num'), key('NumpadDivide', '/'), key('NumpadMultiply', '×'), key('NumpadSubtract', '−')], 'functions'),
      node('div', { class: 'numpad-grid' }, key('Numpad7', '7'), key('Numpad8', '8'), key('Numpad9', '9'), key('NumpadAdd', '+', 1, 'tall'), key('Numpad4', '4'), key('Numpad5', '5'), key('Numpad6', '6'), key('Numpad1', '1'), key('Numpad2', '2'), key('Numpad3', '3'), key('NumpadEnter', '↵', 1, 'tall'), key('Numpad0', '0', 1, 'wide'), key('NumpadDecimal', '.'))));
    return assembly;
  }
  function updatePressed() {
    if (view !== 'tracking') return;
    for (const element of document.querySelectorAll('.key[data-code]')) element.classList.toggle('pressed', pressed.has(element.dataset.code));
    $('#pressed-output').replaceChildren(...(pressed.size ? [...pressed.values()].map(label => node('kbd', {}, label)) : [node('span', { class: 'muted' }, tracking ? 'Nenhuma tecla' : 'Rastreio desligado')]));
  }
  function renderHistory() {
    const surface = node('section', { class: 'surface' }, heading('Histórico de execução', 'Resultados ilustrativos de uma sessão.', button('Exportar log', () => feedback('Exportação ilustrativa. Nenhum arquivo foi gerado.'), 'download', 'quiet')),
      node('div', { class: 'toolbar' }, node('div', { class: 'filters' }, [['all', 'Tudo'], ['success', 'Concluídos'], ['error', 'Erros']].map(([value, label]) => button(label, () => { historyFilter = value; render(); }, null, value === historyFilter ? 'selected quiet' : 'quiet'))), search(query, 'Buscar no histórico…', value => { query = value; updateHistory(); })), node('div', { class: 'table-wrap', id: 'events-table' }));
    content.append(surface); updateHistory();
  }
  function updateHistory() {
    const matches = events.filter(event => (historyFilter === 'all' || (historyFilter === 'error') === (event[1] === 'Erro')) && event.join(' ').toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
    $('#events-table').replaceChildren(matches.length ? node('table', {}, node('caption', { class: 'sr-only' }, 'Eventos de exemplo'), node('thead', {}, node('tr', {}, ['Horário', 'Resultado', 'Ação', 'Detalhes', 'Tecla'].map((name, index) => node('th', { scope: 'col', class: index === 3 ? 'detail-column' : '' }, name)))), node('tbody', {}, matches.map(event => node('tr', {}, node('td', {}, node('time', {}, event[0])), node('td', {}, node('span', { class: 'event-status ' + (event[1] === 'Erro' ? 'error' : 'success') }, icon(event[1] === 'Erro' ? 'alert' : 'check'), event[1])), node('td', {}, event[2]), node('td', { class: 'detail-column muted' }, event[3]), node('td', {}, shortcut(event[4])))))) : node('p', { class: 'empty' }, 'Nenhum evento encontrado.'));
  }
  function renderSettings() {
    const form = node('form', { class: 'settings-block', onsubmit: event => { event.preventDefault(); feedback('Preferências simuladas. O aplicativo não foi alterado.'); } }, node('h2', {}, 'Atalhos de controle'),
      node('div', { class: 'settings-row' }, node('label', { for: 'layer-shortcut' }, 'Alternar camada'), node('input', { id: 'layer-shortcut', value: 'F8', required: true })),
      node('div', { class: 'settings-row' }, node('label', { for: 'pause-shortcut' }, 'Pausar / retomar'), node('input', { id: 'pause-shortcut', value: 'Ctrl+Shift+F12', required: true })),
      node('div', { class: 'settings-row' }, node('label', { for: 'repeat' }, 'Intervalo mínimo', node('small', {}, 'Evita disparos repetidos.')), node('input', { id: 'repeat', type: 'number', value: '400', min: '100', max: '10000', 'aria-label': 'Intervalo mínimo em milissegundos' })),
      node('div', { class: 'form-actions' }, node('button', { type: 'submit', class: 'control primary' }, 'Salvar configurações')));
    content.append(node('section', { class: 'surface' }, heading('Configurações'), node('div', { class: 'settings-layout' }, node('div', {}, form,
      node('details', { class: 'settings-block' }, node('summary', {}, 'Captura e permissões'), node('p', {}, 'No aplicativo, as permissões e a disponibilidade da captura são informadas conforme Windows, macOS ou Linux. A prévia captura apenas nesta janela.'))),
      node('div', {}, node('section', { class: 'settings-block' }, node('h2', {}, 'Configuração e backups'), node('p', {}, 'Leve suas camadas para outro computador.'), node('div', { class: 'settings-buttons' }, button('Exportar', () => feedback('Exportação simulada.'), 'download'), button('Importar', () => feedback('Importação simulada. Nenhuma configuração será substituída.'), 'upload'))),
        node('details', { class: 'settings-block' }, node('summary', {}, 'Locais dos arquivos'), node('p', {}, 'Caminhos ilustrativos:'), node('p', { class: 'mono' }, 'Documentos/Keyboard Tracker'), node('p', { class: 'mono' }, 'Keyboard Tracker/actions.jsonl'))))));
  }

  for (const item of document.querySelectorAll('#navigation button')) { item.prepend(icon(item.dataset.view)); item.addEventListener('click', () => navigate(item.dataset.view)); }
  $('#nav-toggle').prepend(icon('sidebar'));
  $('#nav-toggle').addEventListener('click', () => { const expanded = $('#shell').classList.toggle('expanded'); $('#nav-toggle').setAttribute('aria-expanded', String(expanded)); $('#nav-toggle').setAttribute('aria-label', expanded ? 'Recolher menu' : 'Expandir menu'); $('#nav-toggle .nav-name').textContent = expanded ? 'Recolher menu' : 'Expandir menu'; });
  $('#engine-toggle').addEventListener('click', () => {
    const enabled = $('#engine-toggle').getAttribute('aria-pressed') !== 'true';
    $('#engine-toggle').setAttribute('aria-pressed', String(enabled)); $('#engine-toggle').textContent = enabled ? 'Pausar ações' : 'Ativar ações';
    $('#engine-state').replaceChildren(node('i', { class: 'dot' + (enabled ? ' on' : '') }), enabled ? 'Ativo · simulação' : 'Pausado');
    feedback('Estado ilustrativo. Nenhum atalho global foi registrado.');
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') $('.rail').classList.add('dismiss-hints');
    if (view !== 'tracking' || !tracking || event.target.matches?.('input,select,textarea')) return;
    if (event.key === 'Tab' || (event.ctrlKey || event.metaKey)) return; // Preserve navigation/browser shortcuts in this preview.
    event.preventDefault();
    if (!pressed.has(event.code)) pressed.set(event.code, event.key === ' ' ? 'Espaço' : event.key);
    updatePressed();
  });
  document.addEventListener('keyup', event => { pressed.delete(event.code); updatePressed(); });
  window.addEventListener('blur', () => { pressed.clear(); updatePressed(); });
  $('.rail').addEventListener('focusin', () => $('.rail').classList.remove('dismiss-hints'));
  $('.rail').addEventListener('pointerover', () => $('.rail').classList.remove('dismiss-hints'));
  navigator.keyboard?.addEventListener?.('layoutchange', () => { if (layout === 'auto') void detectLayout(); });
  window.addEventListener('focus', () => { if (view === 'tracking' && layout === 'auto') void detectLayout(); });
  render();
})();
