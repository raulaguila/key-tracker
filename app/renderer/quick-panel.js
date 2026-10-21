import { el, button, shortcut } from './ui.js';
const api = window.dobraPanel;
const main = document.querySelector('#quick-main');
function render(state) {
  document.documentElement.dataset.theme = state.theme === 'dark' ? 'dark' : 'light';
  main.removeAttribute('aria-busy');
  main.replaceChildren(el('header', { class: 'quick-heading' }, el('div', {}, el('p', { class: 'quick-eyebrow' }, 'dobra · camada em uso'), el('h1', {}, state.layer?.name || 'Nenhuma camada')), button('Fechar painel', () => api.hide(), 'quiet', { symbol: 'close', iconOnly: true })),
    el('p', { class: 'quick-status', role: 'status' }, el('span', { class: 'status-dot', 'data-state': state.enabled && state.input?.mode === 'global' ? 'active' : 'paused', 'aria-hidden': 'true' }), state.enabled && state.input?.mode === 'global' ? 'Ações ativas' : state.enabled ? 'Entrada indisponível' : 'Ações pausadas'),
    state.bindings?.length ? el('ul', { class: 'quick-bindings' }, state.bindings.map(binding => el('li', { class: binding.enabled === false ? 'quick-disabled' : '' }, el('div', {}, el('strong', {}, binding.name), el('small', {}, ({ press: 'Ao pressionar', hold: 'Enquanto pressionada', release: 'Ao soltar' }[binding.trigger] || 'Ao pressionar') + (binding.enabled === false ? ' · Desativada' : ''))), shortcut(binding.key, state.platform || 'linux')))) : el('p', { class: 'quick-empty' }, 'Esta camada ainda não tem ações. Abra o Dobra para configurar uma tecla.'),
    el('footer', { class: 'quick-footer' }, el('span', { class: 'hint' }, 'Escape fecha · Somente consulta'), button('Abrir Dobra', () => api.showMain(), '', { symbol: 'layers' })));
}
document.addEventListener('keydown', event => { if (event.key === 'Escape') void api.hide(); });
try { render(await api.getState()); api.onState(render); }
catch { main.removeAttribute('aria-busy'); main.replaceChildren(el('p', { role: 'alert' }, 'Não foi possível carregar a camada.'), button('Abrir Dobra', () => api.showMain())); }
