import { el, icon, button, field, shortcut } from './ui.js';

// Native dialogs supply focus containment and Escape; data never becomes HTML.
export function createProductivity({ api, getState, applyState, guard, editBinding, editLayer, selectLayer, onModalChange, notify }) {
  let active = null;
  const wizardKey = 'dobra.setup-progress';
  const readProgress = () => { try { return Number(localStorage.getItem(wizardKey)) || 0; } catch { return 0; } };
  const remember = step => { try { localStorage.setItem(wizardKey, String(step)); } catch { /* Session flow still works. */ } };
  function dialog(title, description, className = '') {
    if (active) active.close();
    const returnFocus = document.activeElement;
    const titleId = 'productivity-title';
    const node = el('dialog', { class: 'productivity-dialog ' + className, 'aria-labelledby': titleId },
      el('div', { class: 'productivity-heading' }, el('div', {}, el('h2', { id: titleId }, title), el('p', { class: 'hint' }, description)), button('Fechar', () => node.close(), 'quiet', { symbol: 'close', iconOnly: true })),
      el('div', { class: 'productivity-content' }));
    const content = node.lastElementChild;
    node.addEventListener('close', () => { if (active === node) active = null; node.remove(); onModalChange(); if (returnFocus?.isConnected) returnFocus.focus(); }, { once: true });
    document.body.append(node); active = node; node.showModal(); onModalChange();
    return { node, content };
  }
  function errorBox() { return el('p', { class: 'form-errors', role: 'alert', hidden: true }); }
  async function run(buttonNode, errors, task) {
    buttonNode.disabled = true; buttonNode.setAttribute('aria-busy', 'true'); errors.hidden = true;
    try { await task(); } catch (error) { errors.textContent = error.message || String(error); errors.hidden = false; }
    finally { buttonNode.disabled = buttonNode.dataset.locked === 'true'; buttonNode.removeAttribute('aria-busy'); }
  }
  function openSearch() {
    guard(() => {
      const { node, content } = dialog('Buscar no Dobra', 'Encontre uma ação, uma camada ou um comando.', 'command-palette');
      const search = field('command-search', 'Buscar comandos', '', { type: 'search', placeholder: 'Nome, tecla, camada…', autocomplete: 'off' });
      const results = el('div', { id: 'command-results', class: 'command-results', 'aria-label': 'Resultados da busca' });
      const count = el('p', { class: 'hint', role: 'status' }); search.input.setAttribute('aria-controls', results.id);
      const choose = task => { node.close(); Promise.resolve().then(task).catch(error => notify(error.message || String(error), 'error')); };
      function update() {
        const state = getState(); const query = search.input.value.trim().toLocaleLowerCase();
        const commands = [
          { name: 'Biblioteca de modelos', detail: 'Criar a partir de exemplos', action: openLibrary },
          { name: 'Importar camadas', detail: 'Revisar e mesclar um arquivo', action: () => openImport() },
          { name: 'Assistente inicial', detail: 'Permissões e teste do teclado', action: openWizard },
          { name: 'Painel rápido', detail: 'Consultar a camada em uso', action: () => api.showQuickPanel() }
        ];
        if (state.configHistory?.canUndo) commands.push({ name: 'Desfazer configuração', detail: 'Reverter a última alteração; ações permanecem pausadas', action: async () => { applyState(await api.undoConfig()); notify('Alteração desfeita. Ações pausadas.'); } });
        if (state.configHistory?.canRedo) commands.push({ name: 'Refazer configuração', detail: 'Reaplicar a alteração; ações permanecem pausadas', action: async () => { applyState(await api.redoConfig()); notify('Alteração refeita. Ações pausadas.'); } });
        for (const layer of state.config.layers) {
          commands.push({ name: layer.name, detail: 'Editar camada', action: () => editLayer(layer.id) });
          commands.push({ name: 'Usar ' + layer.name, detail: 'Trocar a camada em uso', action: () => selectLayer(layer.id) });
          for (const binding of layer.bindings) commands.push({ name: binding.name, key: binding.key, detail: layer.name + ' · Editar ação', action: () => editBinding(layer.id, binding.id) });
        }
        const matches = commands.filter(item => (item.name + ' ' + item.detail + ' ' + (item.key || '')).toLocaleLowerCase().includes(query));
        results.replaceChildren(...matches.slice(0, 40).map(item => button(item.name, () => choose(item.action), 'quiet command-result', { title: item.detail })));
        [...results.children].forEach((row, index) => { const item = matches[index]; row.append(el('small', {}, item.detail), item.key ? shortcut(item.key, state.platform) : null); });
        count.textContent = !matches.length ? 'Nenhum resultado. Tente o nome de uma camada ou uma tecla.' : matches.length > 40 ? 'Mostrando 40 de ' + matches.length + '. Refine sua busca.' : matches.length + ' resultado(s)';
      }
      search.input.addEventListener('input', update);
      node.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const rows = [...results.querySelectorAll('button')]; if (!rows.length) return;
          event.preventDefault(); const index = rows.indexOf(document.activeElement); rows[(index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus();
        } else if (event.key === 'Enter' && document.activeElement === search.input) { event.preventDefault(); results.querySelector('button')?.click(); }
      });
      content.append(search.wrapper, results, count); update(); search.input.focus();
    });
  }
  async function openLibrary() {
    const { node, content } = dialog('Biblioteca de modelos', 'Revise as camadas antes de adicionar. As ações permanecem pausadas.');
    const errors = errorBox(); const list = el('div', { class: 'template-list', 'aria-busy': 'true' }, el('p', { role: 'status' }, 'Carregando modelos…'));
    content.append(list, errors, button('Importar camadas de um arquivo', () => { node.close(); void openImport(); }, '', { symbol: 'upload' }));
    try {
      const templates = await api.getTemplates(); if (!node.isConnected) return;
      list.replaceChildren(...templates.map(template => el('div', { class: 'template-row' }, el('div', {}, el('h3', {}, template.name), el('p', { class: 'hint' }, template.description)), button('Revisar modelo', () => { node.close(); void openImport(template.id); }, '', { 'aria-label': 'Revisar modelo: ' + template.name }))));
    } catch (error) { list.replaceChildren(); errors.textContent = error.message; errors.hidden = false; }
    finally { list.removeAttribute('aria-busy'); }
  }
  async function openImport(templateId) {
    const { node, content } = dialog('Adicionar camadas', 'Escolha o que adicionar e confira os conflitos antes de confirmar.');
    const errors = errorBox(); const loading = el('p', { role: 'status' }, templateId ? 'Preparando o modelo…' : 'Escolha um arquivo na janela do sistema.'); content.append(loading, errors);
    try {
      const preview = await api.previewLayerImport(templateId); if (!node.isConnected) return;
      if (!preview) { node.close(); return; } loading.remove();
      const rows = preview.layers.map(layer => {
        const selected = el('input', { type: 'checkbox', checked: true, 'aria-label': 'Importar ' + layer.name });
        const target = field('import-target-' + layer.id, 'Destino de ' + layer.name, '', { choices: [['', 'Criar nova camada'], ...getState().config.layers.map(item => [item.id, 'Mesclar em ' + item.name])] });
        const row = el('div', { class: 'import-layer-row' }, el('label', {}, selected, el('span', {}, el('strong', {}, layer.name), el('small', {}, layer.count + (layer.count === 1 ? ' ação' : ' ações')), el('span', { class: 'import-key-preview' }, (layer.keys || []).map(key => shortcut(key, getState().platform))), layer.dependencies?.length ? el('small', {}, 'Também requer: ' + layer.dependencies.map(id => preview.layers.find(item => item.id === id)?.name || id).join(', ')) : null)), target.wrapper);
        selected.addEventListener('change', () => { target.input.disabled = !selected.checked; invalidate(); }); target.input.addEventListener('change', invalidate);
        return { layer, selected, target, row };
      });
      const resolution = field('import-resolution', 'Se a tecla e o momento já existirem', 'skip', { choices: [['skip', 'Manter a ação existente'], ['replace', 'Substituir pela ação importada']], hint: 'Substituir altera somente os conflitos identificados na revisão.' });
      const review = el('div', { class: 'import-review', role: 'status', hidden: true }); let plan;
      const apply = button('Adicionar camadas', () => void run(apply, errors, async () => {
        if (!plan) throw new Error('Revise as alterações antes de adicionar.');
        const oldIds = new Set(getState().config.layers.map(layer => layer.id));
        const next = await api.applyLayerImport(plan.planId); const destinationId = next.config.layers.find(layer => !oldIds.has(layer.id))?.id || rows.find(row => row.selected.checked)?.target.input.value;
        applyState(next, { layerId: destinationId }); node.close(); notify('Camadas adicionadas. As ações estão pausadas.');
      }), 'primary', { disabled: true });
      function invalidate() { plan = null; apply.disabled = true; review.hidden = true; }
      resolution.input.addEventListener('change', invalidate);
      const prepare = button('Revisar alterações', () => void run(prepare, errors, async () => {
        const layers = rows.filter(row => row.selected.checked).map(({ layer, target }) => ({ id: layer.id, ...(target.input.value ? { targetId: target.input.value } : {}) }));
        if (!layers.length) throw new Error('Selecione pelo menos uma camada.');
        plan = await api.planLayerImport(preview.token, { layers, resolution: resolution.input.value });
        if (!node.isConnected) return;
        const entries = typeof plan.summary === 'string' ? [plan.summary] : Object.entries(plan.summary || {}).map(([key, value]) => ({ layersAdded: 'Novas camadas', layersMerged: 'Camadas mescladas', bindingsAdded: 'Ações adicionadas', bindingsReplaced: 'Ações substituídas', bindingsSkipped: 'Ações mantidas', layers: 'Camadas', bindings: 'Ações' }[key] || key) + ': ' + value);
        review.replaceChildren(el('h3', {}, 'Revisão'), ...entries.map(line => el('p', {}, line)), el('p', {}, (plan.conflicts?.length || 0) + ' conflito(s) de tecla e momento.'));
        if (plan.conflicts?.length) review.append(el('ul', {}, plan.conflicts.map(conflict => el('li', {}, typeof conflict === 'string' ? conflict : [conflict.layerName || conflict.layer, conflict.key, conflict.name || conflict.bindingName, conflict.trigger, conflict.reason].filter(Boolean).join(' · ')))));
        review.hidden = false; apply.disabled = false;
      }));
      content.prepend(el('div', { class: 'import-layer-list' }, rows.map(row => row.row)), resolution.wrapper,
        el('p', { class: 'context-note' }, 'A cópia portátil remove headers HTTP e associações com aplicativos. Reconfigure credenciais e associações depois de importar.' + (preview.removedHeaders ? ' Headers removidos: ' + preview.removedHeaders + '.' : '') + (preview.removedApplications ? ' Associações removidas: ' + preview.removedApplications + '.' : '')),
        review, el('div', { class: 'dialog-actions' }, prepare, apply));
    } catch (error) { loading.remove(); errors.textContent = error.message || String(error); errors.hidden = false; }
  }
  async function openWizard() {
    guard(async () => {
      const { node, content } = dialog('Primeiros passos', 'Prepare o teclado com as ações pausadas.', 'setup-dialog');
      const initialTracking = getState().tracking.enabled;
      let step = Math.min(readProgress(), 2); let trackingStarted = false; let lastKey = ''; let unsubscribe; let unsubscribeState;
      const errors = errorBox();
      node.addEventListener('close', () => { unsubscribe?.(); unsubscribeState?.(); if (trackingStarted && !initialTracking) void api.setTracking(false).catch(() => {}); });
      try { if (getState().enabled) applyState(await api.setEnabled(false)); }
      catch (error) { errors.textContent = error.message; errors.hidden = false; }
      function draw() {
        content.replaceChildren(el('ol', { class: 'setup-progress', 'aria-label': 'Etapas' }, ['Permissões', 'Testar teclado', 'Primeira ação'].map((label, index) => el('li', { 'aria-current': index === step ? 'step' : undefined, class: index === step ? 'current' : '' }, (index + 1) + '. ' + label))));
        const state = getState();
        if (step === 0) {
          content.append(el('h3', {}, 'Permitir a observação das teclas'), el('p', {}, state.session === 'wayland' ? 'No Wayland, habilite o componente Linux e autorize pelo sistema. A integração não ativa ações.' : state.platform === 'darwin' ? 'Autorize o Dobra em Privacidade e Segurança → Monitoramento de Entrada. Reinicie o aplicativo após conceder a permissão. Acessibilidade pode ser necessária para a detecção opcional de aplicativos.' : 'O Dobra observa o teclado sem bloquear a digitação nos outros aplicativos.'), el('p', { class: 'context-note' }, state.linuxInput?.supported ? state.linuxInput.message : state.input?.message || 'O teste da próxima etapa confirma a disponibilidade da entrada.'));
          if (state.linuxInput?.supported) { const enable = button(state.linuxInput.enabled ? 'Integração habilitada' : 'Habilitar integração Linux', () => void run(enable, errors, async () => { applyState(await api.setLinuxInputEnabled(true)); draw(); }), '', { disabled: state.linuxInput.enabled }); content.append(enable); }
        } else if (step === 1) {
          const status = el('p', { id: 'setup-key-status', class: 'setup-key-status', role: 'status' }, lastKey || 'O teste ainda não começou.');
          const test = button(trackingStarted ? 'Teste em andamento' : 'Iniciar teste de uma tecla', () => void run(test, errors, async () => {
            if (getState().enabled) applyState(await api.setEnabled(false));
            applyState(await api.setTracking(true)); trackingStarted = true; status.textContent = getState().tracking.mode === 'global' ? 'Pressione uma tecla, inclusive fora desta janela.' : getState().tracking.mode === 'starting' ? 'Preparando a observação global…' : 'Entrada global indisponível. Uma tecla nesta janela confirma apenas a detecção local.'; test.dataset.locked = 'true'; test.querySelector('span').textContent = 'Teste em andamento';
          }), '', { disabled: trackingStarted });
          content.append(el('h3', {}, 'Confirmar a detecção'), el('p', {}, 'O teste não dispara ações. A tecla detectada aparece só aqui e não é salva.'), test, status);
        } else content.append(el('h3', {}, 'Criar sua primeira ação'), el('p', {}, 'Escolha um modelo, revise as camadas e personalize a tecla e o destino antes de ativar.'), button('Escolher um modelo', () => { node.close(); void openLibrary(); }, 'primary', { symbol: 'layers' }));
        content.append(errors, el('div', { class: 'dialog-actions' }, step ? button('Voltar', () => { step--; remember(step); draw(); }) : null,
          button(step === 2 ? 'Concluir assistente' : 'Continuar', () => { if (step === 2) { remember(3); node.close(); } else { step++; remember(step); draw(); } }, step === 2 ? '' : 'primary')));
      }
      const detected = event => { if (step !== 1 || !trackingStarted || event.reset || event.direction !== 'down') return; lastKey = 'Tecla detectada: ' + (event.key || event.code); const status = node.querySelector('#setup-key-status'); if (status) status.textContent = lastKey; };
      unsubscribe = api.onKey(detected);
      node.addEventListener('keydown', event => { if (getState().tracking.mode !== 'global' && event.key !== 'Escape' && !event.repeat) detected({ code: event.code, key: event.key, direction: 'down' }); });
      unsubscribeState = api.onState(next => { if (step !== 1 || !trackingStarted || lastKey) return; const status = node.querySelector('#setup-key-status'); if (status) status.textContent = next.tracking.mode === 'global' ? 'Pressione uma tecla, inclusive fora desta janela.' : next.tracking.mode === 'starting' ? 'Preparando a observação global…' : 'Entrada global indisponível. Uma tecla nesta janela confirma apenas a detecção local.'; });
      draw();
    });
  }
  return { get active() { return Boolean(active?.open); }, openSearch, openLibrary: () => guard(() => void openLibrary()), openImport: () => guard(() => void openImport()), openWizard, needsSetup: () => readProgress() < 3 };
}
