import { createLinuxInstallHelp } from './linux-install.js';
import { el, button, field, shortcut, icon } from './ui.js';

// Native dialogs supply focus containment and Escape; data never becomes HTML.
export function createProductivity({ api, getState, applyState, guard, editBinding, editLayer, selectLayer, onModalChange, notify, startAutomation }) {
  let active = null;
  let activeReturnFocus = null;
  let dialogSequence = 0;
  const wizardKey = 'dobra.setup-progress';
  const readProgress = () => { try { const step = Number(localStorage.getItem(wizardKey)); return Number.isInteger(step) && step >= 0 && step <= 3 ? step : 0; } catch { return 0; } };
  const remember = step => { try { localStorage.setItem(wizardKey, String(step)); } catch { /* Session flow still works. */ } };
  function dialog(title, description, className = '', symbol = 'layers') {
    const returnFocus = active ? activeReturnFocus : document.activeElement;
    if (active) active.close();
    const titleId = 'productivity-title-' + ++dialogSequence;
    const descriptionId = titleId + '-description';
    const node = el('dialog', { class: 'productivity-dialog ' + className, 'aria-labelledby': titleId, 'aria-describedby': descriptionId },
      el('div', { class: 'productivity-heading' }, el('div', {}, el('h2', { id: titleId }, icon(symbol), title), el('p', { id: descriptionId, class: 'hint' }, description)), button('Fechar', () => node.close(), 'quiet', { symbol: 'close', iconOnly: true })),
      el('div', { class: 'productivity-content' }));
    const content = node.lastElementChild;
    node.addEventListener('close', () => { const current = active === node; if (current) { active = null; activeReturnFocus = null; } node.remove(); onModalChange(); if (current && returnFocus?.isConnected) returnFocus.focus(); }, { once: true });
    content.inert = true;
    const readiness = el('p', { class: 'productivity-readiness hint', role: 'status' }, 'Pausando atalhos para configurar…');
    node.insertBefore(readiness, content);
    document.body.append(node); active = node; activeReturnFocus = returnFocus; node.showModal();
    void Promise.resolve().then(() => onModalChange()).then(() => {
      if (!node.isConnected) return;
      content.inert = false; readiness.remove();
      if (className === 'command-palette') content.querySelector('input')?.focus();
    }).catch(error => { if (node.isConnected) { readiness.textContent = error.message || 'Não foi possível suspender os atalhos. Feche este painel e tente novamente.'; readiness.setAttribute('role', 'alert'); } });
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
      const { node, content } = dialog('Buscar no Dobra', 'Encontre uma ação, uma camada ou um comando.', 'command-palette', 'search');
      const search = field('command-search', 'Buscar comandos', '', { type: 'search', placeholder: 'Nome, tecla, camada…', autocomplete: 'off' });
      const results = el('div', { id: 'command-results', class: 'command-results', 'aria-label': 'Resultados da busca' });
      const count = el('p', { class: 'hint', role: 'status' }); search.input.setAttribute('aria-controls', results.id);
      const choose = task => { node.close(); Promise.resolve().then(task).catch(error => notify(error.message || String(error), 'error')); };
      function update() {
        const state = getState(); const query = search.input.value.trim().toLocaleLowerCase();
        const commands = [
          { name: 'Biblioteca de modelos', detail: 'Criar a partir de exemplos', symbol: 'layers', action: openLibrary },
          { name: 'Importar camadas', detail: 'Revisar e mesclar um arquivo', symbol: 'upload', action: () => openImport() },
          { name: 'Configurar teclado', detail: 'Permissões e teste de detecção', symbol: 'keyboard', action: openWizard },
          { name: 'Painel rápido', detail: 'Consultar a camada em uso', symbol: 'list', action: () => api.showQuickPanel() }
        ];
        if (state.configHistory?.canUndo) commands.push({ name: 'Desfazer configuração', detail: 'Reverter a última alteração; ações permanecem pausadas', action: async () => { applyState(await api.undoConfig()); notify('Alteração desfeita. Ações pausadas.'); } });
        if (state.configHistory?.canRedo) commands.push({ name: 'Refazer configuração', detail: 'Reaplicar a alteração; ações permanecem pausadas', action: async () => { applyState(await api.redoConfig()); notify('Alteração refeita. Ações pausadas.'); } });
        for (const layer of state.config.layers) {
          commands.push({ name: layer.name, detail: 'Editar camada', action: () => editLayer(layer.id) });
          commands.push({ name: 'Usar ' + layer.name, detail: 'Trocar a camada em uso', action: () => selectLayer(layer.id) });
          for (const binding of layer.bindings) commands.push({ name: binding.name, key: binding.key, detail: layer.name + ' · Editar ação', action: () => editBinding(layer.id, binding.id) });
        }
        const matches = commands.filter(item => {
          const key = item.key || '';
          const labels = key.replaceAll('CommandOrControl', 'Ctrl Cmd ⌘').replaceAll('Control', 'Ctrl').replaceAll('Command', 'Cmd ⌘').replaceAll('Super', 'Win ⌘').replaceAll('Space', 'Espaço');
          return (item.name + ' ' + item.detail + ' ' + key + ' ' + labels).toLocaleLowerCase().includes(query);
        });
        results.replaceChildren(...matches.slice(0, 40).map(item => button(item.name, () => choose(item.action), 'quiet command-result', { title: item.detail, symbol: item.symbol || (item.key ? 'keyboard' : 'layers') })));
        [...results.children].forEach((row, index) => {
          const item = matches[index], copy = row.querySelector('span');
          copy.classList.add('command-copy'); copy.append(el('small', {}, item.detail));
          if (item.key) row.append(shortcut(item.key, state.platform));
        });
        count.textContent = !matches.length ? 'Nenhum resultado. Tente o nome de uma camada ou uma tecla.' : matches.length > 40 ? 'Mostrando 40 de ' + matches.length + '. Refine sua busca.' : matches.length + ' resultado(s)';
      }
      search.input.addEventListener('input', update);
      node.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const rows = [...results.querySelectorAll('button')]; if (!rows.length) return;
          event.preventDefault(); const index = rows.indexOf(document.activeElement); const next = index < 0 ? event.key === 'ArrowDown' ? 0 : rows.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length; rows[next].focus();
        } else if (event.key === 'Enter' && document.activeElement === search.input) { event.preventDefault(); results.querySelector('button')?.click(); }
      });
      const help = el('p', { class: 'command-help hint' }, el('kbd', {}, '↑'), el('kbd', {}, '↓'), ' navegar · ', el('kbd', {}, 'Enter'), ' abrir · ', el('kbd', {}, 'Esc'), ' fechar');
      content.append(search.wrapper, results, el('div', { class: 'command-footer' }, count, help)); update(); search.input.focus();
    });
  }
  async function openLibrary() {
    const { node, content } = dialog('Biblioteca de modelos', 'Revise as camadas antes de adicionar. As ações permanecem pausadas.', 'template-library');
    const errors = errorBox(); const list = el('div', { class: 'template-list', 'aria-busy': 'true' }, el('p', { role: 'status' }, 'Carregando modelos…'));
    content.append(list, errors, el('div', { class: 'productivity-footer' }, button('Importar camadas de um arquivo', () => { node.close(); void openImport(); }, '', { symbol: 'upload' })));
    try {
      const templates = await api.getTemplates(); if (!node.isConnected) return;
      list.replaceChildren(...templates.map(template => el('div', { class: 'template-row' },
        el('span', { class: 'template-symbol', 'aria-hidden': 'true' }, icon({ notes: 'file', clipboard: 'copy', webhook: 'http' }[template.id] || 'layers')),
        el('div', { class: 'template-copy' }, el('h3', {}, template.name), el('p', { class: 'hint' }, template.description)),
        button('Revisar modelo', () => { node.close(); void openImport(template.id); }, '', { 'aria-label': 'Revisar modelo: ' + template.name }))));
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
        const keys = layer.keys || [];
        const keyPreview = el('div', { class: 'import-key-preview' }, keys.slice(0, 4).map(key => shortcut(key, getState().platform)));
        const more = keys.length > 4 ? el('details', { class: 'import-key-details' }, el('summary', {}, 'Ver mais ' + (keys.length - 4) + ' atalhos')) : null;
        more?.addEventListener('toggle', () => { if (more.open && !more.dataset.loaded) { more.dataset.loaded = 'true'; more.append(el('div', { class: 'import-key-preview' }, keys.slice(4).map(key => shortcut(key, getState().platform)))); } });
        const row = el('div', { class: 'import-layer-row' }, el('div', { class: 'import-layer-copy' }, el('label', {}, selected, el('span', {}, el('strong', {}, layer.name), el('small', {}, layer.count + (layer.count === 1 ? ' ação' : ' ações')))), keyPreview, more,
          layer.dependencies?.length ? el('small', {}, 'Também requer: ' + layer.dependencies.map(id => preview.layers.find(item => item.id === id)?.name || id).join(', ')) : null), target.wrapper);
        selected.addEventListener('change', () => { target.input.disabled = !selected.checked; invalidate(); }); target.input.addEventListener('change', invalidate);
        return { layer, selected, target, row };
      });
      const resolution = field('import-resolution', 'Se a tecla e o momento já existirem', 'skip', { choices: [['skip', 'Manter a ação existente'], ['replace', 'Substituir pela ação importada']], hint: 'Substituir altera somente os conflitos identificados na revisão.' });
      const review = el('div', { class: 'import-review', hidden: true }); let plan; let planVersion = 0;
      const apply = button('Adicionar camadas', () => void run(apply, errors, async () => {
        if (!plan) throw new Error('Revise as alterações antes de adicionar.');
        const oldIds = new Set(getState().config.layers.map(layer => layer.id));
        setApplying(true);
        try {
          const next = await api.applyLayerImport(plan.planId); const destinationId = next.config.layers.find(layer => !oldIds.has(layer.id))?.id || rows.find(row => row.selected.checked)?.target.input.value;
          applyState(next, { layerId: destinationId }); node.close(); notify('Camadas adicionadas. As ações estão pausadas.');
        } catch (error) { invalidate(); throw error; }
        finally { setApplying(false); }
      }), 'primary', { disabled: true, 'data-locked': 'true' });
      function invalidate() { ++planVersion; plan = null; apply.disabled = true; apply.dataset.locked = 'true'; review.hidden = true; }
      resolution.input.addEventListener('change', invalidate);
      const prepare = button('Revisar alterações', () => void run(prepare, errors, async () => {
        invalidate(); const version = planVersion;
        const layers = rows.filter(row => row.selected.checked).map(({ layer, target }) => ({ id: layer.id, ...(target.input.value ? { targetId: target.input.value } : {}) }));
        if (!layers.length) throw new Error('Selecione pelo menos uma camada.');
        const result = await api.planLayerImport(preview.token, { layers, resolution: resolution.input.value });
        if (!node.isConnected || version !== planVersion) return;
        plan = result;
        const entries = typeof plan.summary === 'string' ? [plan.summary] : Object.entries(plan.summary || {}).map(([key, value]) => ({ layersAdded: 'Novas camadas', layersMerged: 'Camadas mescladas', bindingsAdded: 'Ações adicionadas', bindingsReplaced: 'Ações substituídas', bindingsSkipped: 'Ações mantidas', layers: 'Camadas', bindings: 'Ações' }[key] || key) + ': ' + value);
        review.replaceChildren(el('h3', {}, 'Revisão'), ...entries.map(line => el('p', {}, line)), el('p', { role: 'status' }, (plan.conflicts?.length || 0) + ' conflito(s) de tecla e momento.'));
        if (plan.conflicts?.length) review.append(el('ul', {}, plan.conflicts.map(conflict => el('li', {}, typeof conflict === 'string' ? conflict : [conflict.layerName || conflict.layer, conflict.key, conflict.name || conflict.bindingName, conflict.trigger, conflict.reason].filter(Boolean).join(' · ')))));
        review.hidden = false; apply.dataset.locked = 'false'; apply.disabled = false;
      }));
      const restart = button(templateId ? 'Recomeçar revisão' : 'Escolher outro arquivo', () => { node.close(); void openImport(templateId); }, 'quiet');
      function setApplying(busy) {
        content.setAttribute('aria-busy', String(busy)); prepare.disabled = busy; restart.disabled = busy; resolution.input.disabled = busy;
        for (const row of rows) { row.selected.disabled = busy; row.target.input.disabled = busy || !row.selected.checked; }
        apply.querySelector('span').textContent = busy ? 'Adicionando camadas…' : 'Adicionar camadas';
      }
      content.prepend(el('div', { class: 'import-layer-list' }, rows.map(row => row.row)), resolution.wrapper,
        el('p', { class: 'context-note' }, 'A cópia portátil remove headers HTTP e associações com aplicativos. Reconfigure credenciais e associações depois de importar.' + (preview.removedHeaders ? ' Headers removidos: ' + preview.removedHeaders + '.' : '') + (preview.removedApplications ? ' Associações removidas: ' + preview.removedApplications + '.' : '')),
        review, el('div', { class: 'dialog-actions' }, restart, prepare, apply));
    } catch (error) { loading.remove(); errors.textContent = error.message || String(error); errors.hidden = false; }
  }
  async function openWizard() {
    guard(async () => {
      const { node, content } = dialog('Configurar teclado', 'Confira permissões e detecção com as ações pausadas.', 'setup-dialog', 'keyboard');
      const initialTracking = getState().tracking.enabled;
      let step = Math.min(readProgress(), 2); let trackingStarted = false; let trackingRequest; let lastKey = ''; let unsubscribe; let unsubscribeState;
      const errors = errorBox();
      node.addEventListener('close', () => { unsubscribe?.(); unsubscribeState?.(); if (!initialTracking && (trackingStarted || trackingRequest)) void api.setTracking(false).catch(() => {}); });
      try { if (getState().enabled) applyState(await api.setEnabled(false)); }
      catch (error) { errors.textContent = error.message; errors.hidden = false; }
      if (!node.isConnected) return;
      async function moveTo(next) {
        if (step === 1 && next !== 1 && !initialTracking && trackingStarted) { await api.setTracking(false); trackingStarted = false; }
        if (!node.isConnected) return; step = next; remember(step); draw();
      }
      function draw() {
        content.replaceChildren(el('ol', { class: 'setup-progress', 'aria-label': 'Etapas' }, ['Permissões', 'Testar teclado', 'Primeira ação'].map((label, index) => el('li', { 'aria-current': index === step ? 'step' : undefined, class: index === step ? 'current' : '' }, (index + 1) + '. ' + label))));
        const state = getState();
        if (step === 0) {
          content.append(el('h3', {}, 'Permitir a observação das teclas'), el('p', {}, state.session === 'wayland' ? 'No Wayland, habilite o componente Linux e autorize pelo sistema. A integração não ativa ações.' : state.platform === 'darwin' ? 'Autorize o Dobra em Privacidade e Segurança → Monitoramento de Entrada. Reinicie o aplicativo após conceder a permissão. Acessibilidade pode ser necessária para a detecção opcional de aplicativos.' : 'O Dobra observa o teclado sem bloquear a digitação nos outros aplicativos.'), el('p', { class: 'context-note' }, state.linuxInput?.supported ? state.linuxInput.message : state.input?.message || 'O teste da próxima etapa confirma a disponibilidade da entrada.'));
          if (state.linuxInput?.supported) {
            const enable = button(state.linuxInput.enabled ? 'Integração habilitada' : 'Habilitar integração Linux', () => void run(enable, errors, async () => {
              try { const next = await api.setLinuxInputEnabled(true); if (node.isConnected) { applyState(next); draw(); } }
              catch {
                let next = getState(); try { next = await api.getState(); } catch { /* Retain the last contextual status. */ }
                if (node.isConnected) { applyState(next); draw(); }
                throw new Error(next.linuxInput?.message || 'Não foi possível habilitar a integração Linux. Confira a instalação do componente.');
              }
            }), '', { disabled: state.linuxInput.enabled });
            const installation = createLinuxInstallHelp({ api, onError: message => { errors.textContent = message; errors.hidden = false; } });
            installation.update(state.linuxInput); content.append(enable, installation.node);
          }
        } else if (step === 1) {
          const status = el('p', { id: 'setup-key-status', class: 'setup-key-status', role: 'status' }, lastKey || 'O teste ainda não começou.');
          const test = button(trackingStarted ? 'Teste em andamento' : 'Iniciar teste de uma tecla', () => void run(test, errors, async () => {
            if (getState().enabled) applyState(await api.setEnabled(false));
            if (!node.isConnected) return; lastKey = '';
            trackingRequest = api.setTracking(true);
            const next = await trackingRequest;
            if (!node.isConnected) { if (!initialTracking) await api.setTracking(false); return; }
            applyState(next); trackingStarted = true; status.textContent = getState().tracking.mode === 'global' ? 'Pressione uma tecla, inclusive fora desta janela.' : getState().tracking.mode === 'starting' ? 'Preparando a observação global…' : 'Entrada global indisponível. Uma tecla nesta janela confirma apenas a detecção local.'; test.dataset.locked = 'true'; test.querySelector('span').textContent = 'Teste em andamento';
          }), '', { disabled: trackingStarted });
          content.append(el('h3', {}, 'Confirmar a detecção'), el('p', {}, 'O teste não dispara ações. A tecla detectada aparece só aqui e não é salva.'), test, status);
        } else content.append(el('h3', {}, 'Continue com sua automação'), el('p', {}, 'Volte ao guia para criar, testar e ativar sua automação. A autorização do teclado não ativa ações sozinha.'), button('Continuar no guia', () => { remember(3); node.close(); if (startAutomation) startAutomation(); else void openLibrary(); }, 'primary', { symbol: 'layers' }));
        content.append(errors, el('div', { class: 'dialog-actions' }, step ? button('Voltar', event => void run(event.currentTarget, errors, () => moveTo(step - 1))) : null,
          button(step === 2 ? 'Concluir assistente' : 'Continuar', event => void run(event.currentTarget, errors, async () => { if (step === 2) { remember(3); node.close(); } else await moveTo(step + 1); }), step === 2 ? '' : 'primary')));
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
