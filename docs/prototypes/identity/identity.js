'use strict';

// A self-contained visual study: no desktop APIs, requests, or keyboard hooks.
const brands = {
  klavra: {
    name: 'Klavra', wordmark: 'klavra', descriptor: 'Precisa · Discreta · Modular',
    promise: 'Seu teclado. Suas ações.',
    concept: 'Uma tecla, várias camadas. O monograma K e os planos deslocados traduzem controle e personalização. Framboesa dá personalidade a uma base de grafite e neutros.',
    footnote: 'Direção técnica · Marca compacta, desenho preciso e contraste contido.',
    colors: [['Framboesa', '#A52B65'], ['Grafite', '#251F29'], ['Névoa', '#F3F0F4'], ['Rosa claro', '#F29AC2']],
    mark: '<rect x="3" y="18" width="43" height="43" rx="10" fill="currentColor" opacity=".18"/><rect x="14" y="4" width="44" height="44" rx="10" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M27 16v20m14-20L30 26l12 11" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'
  },
  dobra: {
    name: 'Dobra', wordmark: 'dobra', descriptor: 'Próxima · Tátil · Versátil',
    promise: 'Mais possibilidades em cada tecla.',
    concept: 'Uma dobra transforma a mesma superfície. O D nasce de um recorte dobrado; o cobre e as letras mais cheias trazem proximidade, com a mesma organização compacta.',
    footnote: 'Direção tátil · Marca expressiva, geometria de dobra e neutros com cobre.',
    colors: [['Cobre', '#A94320'], ['Tinta', '#302721'], ['Porcelana', '#F6F2EF'], ['Pêssego', '#F4AE85']],
    mark: '<path fill="currentColor" fill-rule="evenodd" d="M10 6h23v22h22v15c0 9-6 15-15 15H10V6Zm13 16v23h14c4 0 6-2 6-6v-8l-9-9H23Z"/><path d="M33 6v22h22L33 6Z" fill="currentColor" opacity=".38"/>'
  }
};
const paths = {
  layers: '<path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h1m4 0h1m4 0h1M6 13h1m4 0h1m4 0h1M7 16h10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
  settings: '<path d="M4 7h16M4 17h16M8 4v6m8 4v6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  moon: '<path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  play: '<path d="m9 5 11 7-11 7V5Z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v12h5"/>',
  folder: '<path d="M3 7V4h7l3 3h8v13H3V7Z"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-5 3 2-16"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V3h8v4M3 12h18m-11 0v3h4v-3"/>',
  home: '<path d="m3 11 9-8 9 8m-16-2v12h14V9m-9 12v-7h4v7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.layers}</svg>`;
const mark = brand => `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true">${brands[brand].mark}</svg>`;
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const actionData = {
  Trabalho: [
    {key:'A', name:'Abrir meu workspace', meta:'Sequência · Ao pressionar', current:true},
    {key:'S', name:'Enviar atualização', meta:'Requisição HTTP · Ao soltar'},
    {key:'D', name:'Copiar minha assinatura', meta:'Copiar texto · Ao pressionar'},
    {key:'F', name:'Criar nota rápida', meta:'Criar arquivo · Ao pressionar'},
  ],
  Pessoal: [
    {key:'A', name:'Abrir meus favoritos', meta:'Abrir destino · Ao pressionar', current:true},
    {key:'S', name:'Copiar meu endereço', meta:'Copiar texto · Ao pressionar'},
    {key:'D', name:'Criar lembrete', meta:'Criar arquivo · Ao soltar'},
  ],
  Código: [
    {key:'A', name:'Preparar ambiente', meta:'Sequência · Ao pressionar', current:true},
    {key:'S', name:'Consultar serviço', meta:'Requisição HTTP · Enquanto pressionada'},
    {key:'D', name:'Copiar snippet', meta:'Copiar texto · Ao pressionar'},
  ],
};

function rows(layer = 'Trabalho', query = '') {
  const data = actionData[layer].filter(action => `${action.key} ${action.name} ${action.meta}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  if (!data.length) return '<tr><td colspan="3" class="empty-search">Nenhuma ação encontrada.</td></tr>';
  return data.map(action => `<tr class="${action.current ? 'current' : ''}"><td><kbd>${action.key}</kbd></td><td><div class="action-title">${action.name}</div><div class="action-meta">${action.meta}</div></td><td><button class="run" data-demo="${action.name}" aria-label="Visualizar teste: ${action.name}" title="Visualizar teste">${icon('play')}</button></td></tr>`).join('');
}

function keyboard() {
  return `<div class="keyboard-preview" hidden><p class="keyboard-note">Prévia de mapeamentos · US ANSI · Clique em A, S, D ou F</p>${[
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L',';'],
    ['Z','X','C','V','B','N','M',',','.','/']
  ].map(row => `<div class="key-row">${row.map(key => `<button class="key ${'ASDF'.includes(key) ? 'mapped' : ''}" data-key="${key}" aria-label="Tecla ${key}${'ASDF'.includes(key) ? ', com ação' : ', sem ação'}">${key}</button>`).join('')}</div>`).join('')}<div class="key-row"><button class="key wide" data-demo="Tecla Ctrl sem ação">Ctrl</button><button class="key wide" data-demo="Tecla Alt sem ação">Alt</button><button class="key space" data-demo="Espaço sem ação">Espaço</button><button class="key wide" data-demo="Tecla Alt sem ação">Alt</button><button class="key wide" data-demo="Tecla Ctrl sem ação">Ctrl</button></div></div>`;
}

function app(brand, theme) {
  const id = `${brand}-${theme}`;
  return `<div class="screen" data-screen-theme="${theme}"><div class="screen-label ${theme}"><span><i class="theme-dot"></i>Tema ${theme === 'light' ? 'claro' : 'escuro'}</span><span>Camadas / Trabalho</span></div><section class="app" data-mode="${theme}" aria-label="${brands[brand].name}, tema ${theme === 'light' ? 'claro' : 'escuro'}" data-layer="Trabalho">
    <div class="window-bar"><div class="window-dots" aria-hidden="true"><i></i><i></i><i></i></div><span class="window-caption">${mark(brand)}${brands[brand].name}</span><span class="window-end">Estudo visual</span></div>
    <div class="app-grid"><aside class="app-rail" aria-label="Navegação demonstrativa"><div class="rail-logo">${mark(brand)}</div><button class="rail-button selected" aria-label="Camadas" aria-current="page" data-demo="Camadas é a tela deste estudo">${icon('layers')}</button><button class="rail-button" aria-label="Rastreio" data-demo="Rastreio: tela fora deste estudo visual">${icon('keyboard')}</button><button class="rail-button" aria-label="Histórico" data-demo="Histórico: tela fora deste estudo visual">${icon('clock')}</button><div class="rail-bottom"><button class="rail-button" aria-label="Configurações" data-demo="Configurações: tela fora deste estudo visual">${icon('settings')}</button><button class="rail-button theme-preview" aria-label="${theme === 'light' ? 'Ver apenas tema escuro' : 'Ver apenas tema claro'}" data-select-theme="${theme === 'light' ? 'dark' : 'light'}">${icon(theme === 'light' ? 'moon' : 'sun')}</button></div></aside>
    <aside class="layers" aria-label="Camadas de exemplo"><div class="section-caption"><span>Camadas</span><span aria-hidden="true">+</span></div>${[['Trabalho','briefcase',4],['Pessoal','home',3],['Código','code',3]].map(([name,symbol,count]) => `<button class="layer ${name === 'Trabalho' ? 'selected' : ''}" data-select-layer="${name}" aria-pressed="${name === 'Trabalho'}">${icon(symbol)}${name}<small>${count}</small></button>`).join('')}<div class="layer-separator"></div><p class="layer-note">Alternar camada<br><kbd title="Ctrl + Shift + L">Ctrl ⇧ L</kbd></p></aside>
    <div class="action-area"><header class="app-top"><div><h3 class="app-heading">Trabalho</h3><p class="app-subtitle"><span class="action-count">4</span> ações · Camada em uso</p></div><div class="app-top-right"><span class="status">Ativo</span><button class="pause" aria-pressed="false" aria-label="Pausar demonstração">Ⅱ Pausar</button></div></header>
    <div class="app-content"><div class="actions-toolbar"><div class="view-switch" role="group" aria-label="Visualização de ações"><button data-view="table" aria-pressed="true">Tabela</button><button data-view="keyboard" aria-pressed="false">Teclado</button></div><button class="primary" data-demo="Criar uma ação: formulário disponível no aplicativo">+ Nova ação</button></div><label class="search" for="search-${id}">${icon('search')}<input id="search-${id}" type="search" placeholder="Buscar ações…" aria-label="Buscar ações em ${brands[brand].name}, ${theme === 'light' ? 'claro' : 'escuro'}"></label>
    <table class="action-table"><thead><tr><th>Tecla</th><th>Ação / Acionamento</th><th><span class="sr-only" hidden>Teste</span></th></tr></thead><tbody>${rows()}</tbody></table>${keyboard()}
    <div class="sequence-preview"><div class="sequence-head"><span>A · Abrir meu workspace</span><span>3 etapas</span></div><div class="sequence-flow"><span class="step">${icon('globe')}Abrir painel</span><span class="flow-arrow">→</span><span class="delay">250 ms</span><span class="flow-arrow">→</span><span class="step">${icon('copy')}Copiar texto</span><span class="flow-arrow">→</span><span class="step">${icon('folder')}Criar nota</span></div></div>
    </div><footer class="app-footer"><span>Em uso: <strong class="active-layer-name">Trabalho</strong></span><span>Demo · Nenhuma ação será executada</span></footer></div></div>
  </section></div>`;
}

document.querySelector('#studies').innerHTML = Object.entries(brands).map(([key,brand]) => `<article class="study ${key}" data-study="${key}" aria-labelledby="title-${key}"><div class="study-name"><h2 id="title-${key}">${brand.name}</h2><span>${key === 'klavra' ? 'Precisão em camadas' : 'Possibilidades que se desdobram'}</span></div><div class="identity-panel"><div class="signature">${mark(key)}<div><div class="wordmark" aria-label="Logo ${brand.name}">${brand.wordmark}</div><p class="brand-promise">${brand.promise}</p></div></div><div class="identity-bottom"><p class="brand-personality">${brand.descriptor}<br>Ícone de aplicativo + versão para bandeja</p><div class="app-icons"><span class="app-icon" aria-label="Ícone do aplicativo">${mark(key)}</span><span class="tray-icon" aria-label="Ícone monocromático de bandeja">${mark(key)}</span></div></div></div><div class="palette" aria-label="Paleta ${brand.name}">${brand.colors.map(([name,hex]) => `<button class="swatch" data-color="${hex}" aria-label="Copiar cor ${name}, ${hex}"><span class="swatch-color" style="--swatch:${hex}"></span><span class="swatch-name">${name}</span><span class="swatch-code">${hex}</span></button>`).join('')}</div><div class="downloads"><a href="assets/${key}-logo.svg" download>Logo SVG ↓</a><a href="assets/${key}-icon.svg" download>Ícone SVG ↓</a><a href="assets/${key}-mark.svg" download>Símbolo SVG ↓</a><a href="assets/${key}-logo-dark.svg" download>Logo para fundo escuro ↓</a></div><p class="brand-explanation">${brand.concept}</p><div class="screens">${app(key,'light')}${app(key,'dark')}</div><p class="brand-footnote">${brand.footnote}</p></article>`).join('');

let feedbackTimer;
function notify(message) {
  const feedback = document.querySelector('#feedback');
  feedback.textContent = message;
  feedback.classList.add('visible');
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => feedback.classList.remove('visible'), 3600);
}
function setFilter(type, value, updateURL = true) {
  if (!(type === 'brand' ? ['all','klavra','dobra'] : ['both','light','dark']).includes(value)) return;
  document.body.dataset[type] = value;
  document.querySelectorAll(`[data-${type}]`).forEach(button => {
    if (button.tagName === 'BUTTON') button.setAttribute('aria-pressed', String(button.dataset[type] === value));
  });
  if (type === 'brand') document.querySelectorAll('[data-study]').forEach(study => { study.hidden = value !== 'all' && study.dataset.study !== value; });
  else document.querySelectorAll('[data-screen-theme]').forEach(screen => { screen.hidden = value !== 'both' && screen.dataset.screenTheme !== value; });
  if (updateURL && location.protocol !== 'file:') {
    const url = new URL(location.href);
    url.searchParams.set(type, value);
    history.replaceState(null, '', url);
  }
}
const params = new URLSearchParams(location.search);
setFilter('brand', params.get('brand') || 'all', false);
setFilter('theme', params.get('theme') || 'both', false);

document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-brand')) return setFilter('brand', button.dataset.brand);
  if (button.hasAttribute('data-theme')) return setFilter('theme', button.dataset.theme);
  if (button.hasAttribute('data-select-theme')) return setFilter('theme', button.dataset.selectTheme);
  if (button.id === 'print') return window.print();
  if (button.hasAttribute('data-color')) {
    try { await navigator.clipboard.writeText(button.dataset.color); notify(`Cor copiada: ${button.dataset.color}`); }
    catch { notify(`Cor: ${button.dataset.color} · Copie o código exibido na paleta.`); }
    return;
  }
  const appElement = button.closest('.app');
  if (button.classList.contains('pause')) {
    const paused = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(paused));
    button.setAttribute('aria-label', paused ? 'Retomar demonstração' : 'Pausar demonstração');
    button.textContent = paused ? '▷ Retomar' : 'Ⅱ Pausar';
    const status = appElement.querySelector('.status');
    status.textContent = paused ? 'Pausado' : 'Ativo';
    status.classList.toggle('is-paused', paused);
    return;
  }
  if (button.dataset.selectLayer) {
    const layer = button.dataset.selectLayer;
    appElement.dataset.layer = layer;
    appElement.querySelectorAll('[data-select-layer]').forEach(item => {
      item.classList.toggle('selected', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    });
    appElement.querySelector('.app-heading').textContent = layer;
    appElement.querySelector('.active-layer-name').textContent = layer;
    appElement.querySelector('.action-count').textContent = actionData[layer].length;
    const search = appElement.querySelector('input[type=search]');
    search.value = '';
    appElement.querySelector('tbody').innerHTML = rows(layer);
    appElement.querySelectorAll('[data-key]').forEach(key => {
      const mapped = actionData[layer].some(action => action.key === key.dataset.key);
      key.classList.toggle('mapped', mapped);
      key.classList.remove('active');
      key.setAttribute('aria-label', `Tecla ${key.dataset.key}, ${mapped ? 'com ação' : 'sem ação'}`);
    });
    appElement.querySelector('.sequence-preview').hidden = layer !== 'Trabalho';
    const screenLabel = appElement.closest('.screen').querySelector('.screen-label span:last-child');
    screenLabel.textContent = `Camadas / ${layer}`;
    return;
  }
  if (button.dataset.view) {
    appElement.querySelectorAll('[data-view]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    appElement.querySelector('.action-table').hidden = button.dataset.view !== 'table';
    appElement.querySelector('.keyboard-preview').hidden = button.dataset.view !== 'keyboard';
    appElement.querySelector('.search').hidden = button.dataset.view !== 'table';
    return;
  }
  if (button.dataset.key) {
    appElement.querySelectorAll('[data-key]').forEach(key => key.classList.toggle('active', key === button));
    const action = actionData[appElement.dataset.layer].find(item => item.key === button.dataset.key);
    return notify(action ? `Prévia: ${button.dataset.key} → ${action.name}. Nenhuma ação executada.` : `${button.dataset.key}: sem ação nesta camada.`);
  }
  if (button.dataset.demo) notify(`${button.dataset.demo}. Apenas demonstração visual.`);
});
document.addEventListener('input', event => {
  if (!event.target.matches('.search input')) return;
  const appElement = event.target.closest('.app');
  appElement.querySelector('tbody').innerHTML = rows(appElement.dataset.layer, event.target.value);
});

// Also used by the asset exporter; the rendered page remains fully offline.
window.identityStudy = { brands };
