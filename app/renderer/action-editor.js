import { el, button, field } from './ui.js';

export const actionLabels = {
  clipboard: 'Copiar texto', open: 'Abrir URL, arquivo ou aplicativo', notification: 'Mostrar notificação',
  layer: 'Trocar camada', sequence: 'Executar sequência', http: 'Requisição HTTP', file: 'Criar ou acrescentar em arquivo', log: 'Registro em log (legado)'
};
export const actionTypeLabels = { clipboard: 'Copiar', open: 'Abrir', notification: 'Notificação', layer: 'Camada', sequence: 'Sequência', http: 'HTTP', file: 'Arquivo', log: 'Log legado' };

// Each type retains its own DOM while detached. Switching types therefore keeps
// incomplete pairs, field values, expanded sections and sequence order intact.
export function createActionEditor({ initial = { type: 'clipboard', text: '' }, prefix = '', layers, api, defaultDirectory, onDirty, onError, invalid, allowSequence = true }) {
  const name = value => prefix + value;
  const makeField = (key, label, value = '', options = {}) => field(name(key), label, value, options);
  const type = makeField('type', allowSequence ? 'O que esta tecla deve fazer?' : 'O que esta etapa deve fazer?', initial.type, {
    choices: Object.entries(actionLabels).filter(([key]) => allowSequence || key !== 'sequence')
  });
  const host = el('div', { class: 'action-fields' });
  const node = el('section', { class: 'action-configuration', 'data-action-editor': '', 'data-action-prefix': prefix }, type.wrapper, host);
  node.addEventListener('invalid', event => {
    for (let parent = event.target.parentElement; parent && parent !== node.parentElement; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
  }, true);
  const cache = new Map();
  const fail = (message, key) => invalid(message, name(key));
  const text = input => input.value;
  function choose(task, input) {
    void (async () => {
      try { const value = await task(); if (value) { input.value = value; onDirty(); } }
      catch (error) { onError(error.message || String(error)); }
    })();
  }
  function mapField(key, title, values, hint) {
    const rows = el('div', { class: 'map-rows' });
    const addRow = (keyValue = '', value = '', focus = false) => {
      const id = name(key) + '-' + crypto.randomUUID();
      const keyInput = el('input', { id: id + '-key', name: name(key) + '-key', 'aria-label': title + ': nome', placeholder: 'Nome' });
      const valueInput = el('input', { id: id + '-value', name: name(key) + '-value', 'aria-label': title + ': valor', placeholder: 'Valor' });
      keyInput.value = keyValue; valueInput.value = value;
      const row = el('div', { class: 'map-row' }, keyInput, valueInput, button('Remover parâmetro', () => {
        row.remove(); if (!rows.children.length) addRow(); rows.querySelector('input')?.focus(); onDirty();
      }, 'quiet danger', { symbol: 'trash', iconOnly: true, title: 'Remover parâmetro' }));
      rows.append(row); if (focus) keyInput.focus();
    };
    const entries = Object.entries(values || {});
    (entries.length ? entries : [['', '']]).forEach(([key, value]) => addRow(key, value));
    return {
      node: el('fieldset', { class: 'map-field', 'data-map': key }, el('legend', {}, title), el('p', { class: 'hint' }, hint),
        el('div', { class: 'map-column-labels', 'aria-hidden': 'true' }, el('span', {}, 'Nome'), el('span', {}, 'Valor')), rows,
        button('Adicionar parâmetro', () => { addRow('', '', true); onDirty(); }, 'quiet small', { symbol: 'plus' })),
      read() {
        const result = {};
        for (const row of rows.children) {
          const [keyInput, valueInput] = row.querySelectorAll('input');
          const keyValue = keyInput.value.trim();
          if (!keyValue && !valueInput.value) continue;
          if (!keyValue || Object.hasOwn(result, keyValue)) {
            keyInput.setAttribute('aria-invalid', 'true'); keyInput.focus();
            throw new Error(!keyValue ? 'Informe o nome do parâmetro que possui um valor.' : 'O parâmetro “' + keyValue + '” está repetido.');
          }
          Object.defineProperty(result, keyValue, { value: valueInput.value, enumerable: true, configurable: true });
        }
        return result;
      }
    };
  }
  function createFields(kind) {
    const value = kind === initial.type ? initial : {};
    const content = el('div');
    let read;
    if (kind === 'clipboard') {
      const item = makeField('text', 'Texto para copiar', value.text || '', { required: true, multiline: true, maxlength: 64000, placeholder: 'Olá! Aqui está a informação que você pediu.', hint: 'Copia para a área de transferência. Você decide onde colar.' });
      content.append(item.wrapper); read = () => ({ type: kind, text: text(item.input) });
    } else if (kind === 'open') {
      const mode = makeField('kind', 'O que abrir?', value.kind || 'url', { choices: [['url', 'URL na aplicação padrão'], ['path', 'Arquivo ou pasta'], ['application', 'Aplicativo']] });
      const target = makeField('target', 'Destino', value.target || '', { required: true, placeholder: 'https://exemplo.com', hint: 'Use uma URL HTTP/HTTPS ou um caminho absoluto, conforme a opção acima.' });
      const picker = button('Escolher destino', () => choose(() => api.chooseActionTarget(mode.input.value), target.input), '', { symbol: 'folder', 'data-choose-target': '' });
      const controls = el('div', { class: 'input-with-button' }); target.input.replaceWith(controls); controls.append(target.input, picker);
      let previousKind = mode.input.value;
      const targets = new Map([[previousKind, target.input.value]]);
      function updateMode() {
        picker.hidden = mode.input.value === 'url';
        target.input.type = mode.input.value === 'url' ? 'url' : 'text';
        target.input.placeholder = mode.input.value === 'url' ? 'https://exemplo.com' : 'Caminho completo do arquivo, pasta ou aplicativo';
        picker.querySelector('span').textContent = mode.input.value === 'application' ? 'Escolher aplicativo' : 'Escolher arquivo ou pasta';
      }
      mode.input.addEventListener('change', () => { targets.set(previousKind, target.input.value); previousKind = mode.input.value; target.input.value = targets.get(previousKind) || ''; updateMode(); });
      updateMode(); content.append(mode.wrapper, target.wrapper);
      read = () => {
        const destination = target.input.value.trim();
        if (!destination) fail('Informe o destino que será aberto.', 'target');
        if (mode.input.value === 'url') {
          let url; try { url = new URL(destination); } catch { fail('Informe uma URL completa, começando com http:// ou https://.', 'target'); }
          if (!['http:', 'https:'].includes(url.protocol)) fail('Use uma URL HTTP ou HTTPS.', 'target');
        }
        return { type: kind, kind: mode.input.value, target: destination };
      };
    } else if (kind === 'notification') {
      const title = makeField('title', 'Título da notificação', value.title || '', { required: true, maxlength: 120, placeholder: 'Lembrete' });
      const message = makeField('message', 'Mensagem da notificação', value.message || '', { multiline: true, maxlength: 4000, placeholder: 'Hora de fazer uma pausa.', hint: 'A exibição depende das permissões e do modo de concentração do sistema.' });
      content.append(title.wrapper, message.wrapper); read = () => ({ type: kind, title: text(title.input), message: text(message.input) });
    } else if (kind === 'layer') {
      const destination = makeField('layerId', 'Camada de destino', value.layerId || '', { required: true, choices: [['', 'Escolha uma camada'], ...layers.map(layer => [layer.id, layer.name])], hint: 'Troca a camada como uma seleção manual. Não ativa as ações nem executa a camada de destino.' });
      content.append(destination.wrapper); read = () => { if (!destination.input.value) fail('Escolha a camada de destino.', 'layerId'); return { type: kind, layerId: destination.input.value }; };
    } else if (kind === 'http') {
      const method = makeField('method', 'Método', value.method || 'POST', { choices: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map(item => [item, item]) });
      const url = makeField('url', 'URL de destino', value.url || '', { required: true, type: 'url', placeholder: 'https://api.exemplo.com/eventos' });
      const body = makeField('body', 'Corpo da requisição', value.body || '', { multiline: true, className: 'mono', spellcheck: 'false', placeholder: '{"evento":"iniciar","tecla":"{{key}}"}', hint: 'Opcional. Para JSON, adicione Content-Type com valor application/json.' });
      const note = el('p', { class: 'context-note' }, 'GET e HEAD enviam os dados pelos parâmetros da URL e não aceitam corpo.');
      const headers = mapField('headers', 'Headers', value.headers, 'Ex.: Content-Type → application/json ou Authorization → Bearer seu-token.');
      const query = mapField('query', 'Parâmetros da URL', value.query, 'Os valores são codificados e acrescentados à URL automaticamente.');
      content.append(el('div', { class: 'http-destination' }, method.wrapper, url.wrapper), body.wrapper, note,
        el('details', { class: 'advanced-fields', open: Boolean(Object.keys(value.headers || {}).length || Object.keys(value.query || {}).length) }, el('summary', {}, 'Parâmetros e headers', el('span', {}, 'Autenticação e dados da URL')), query.node, headers.node));
      function updateMethod() { const noBody = ['GET', 'HEAD'].includes(method.input.value); body.input.disabled = noBody; body.wrapper.hidden = noBody; note.hidden = !noBody; }
      method.input.addEventListener('change', updateMethod); updateMethod();
      read = () => {
        const destination = url.input.value.trim();
        let parsed; try { parsed = new URL(destination); } catch { fail('Informe uma URL completa, começando com http:// ou https://.', 'url'); }
        if (!['http:', 'https:'].includes(parsed.protocol)) fail('Use uma URL HTTP ou HTTPS.', 'url');
        return { type: kind, method: method.input.value, url: destination, headers: headers.read(), query: query.read(), body: body.input.disabled ? '' : body.input.value };
      };
    } else if (kind === 'file') {
      const directory = makeField('directory', 'Pasta de destino', value.directory || '', { placeholder: 'Pasta padrão em Documentos', hint: 'Deixe vazio para usar ' + defaultDirectory });
      const controls = el('div', { class: 'input-with-button' }); directory.input.replaceWith(controls);
      controls.append(directory.input, button('Escolher pasta', () => choose(() => api.chooseDirectory(), directory.input), '', { symbol: 'folder' }));
      const filename = makeField('filename', 'Nome do arquivo', value.filename || '', { required: true, placeholder: 'nota-{{timestamp}}.txt', hint: 'Use {{timestamp}} para criar um arquivo diferente a cada execução.' });
      const mode = makeField('mode', 'Como salvar', value.mode || 'create', { choices: [['create', 'Criar novo · sem sobrescrever'], ['append', 'Acrescentar ao final']] });
      const contents = makeField('content', 'Conteúdo do arquivo', value.content || '', { multiline: true, placeholder: 'Criado pela tecla {{key}} em {{date}}.' });
      content.append(directory.wrapper, el('div', { class: 'form-grid' }, filename.wrapper, mode.wrapper), contents.wrapper);
      read = () => ({ type: kind, directory: directory.input.value.trim(), filename: filename.input.value.trim(), mode: mode.input.value, content: contents.input.value });
    } else if (kind === 'log') {
      const message = makeField('message', 'Mensagem do log', value.message || '', { required: true, multiline: true, placeholder: 'A tecla {{key}} foi acionada na camada {{layer}}.', hint: 'Compatibilidade com ações existentes. O histórico de execução já é registrado automaticamente.' });
      content.append(message.wrapper); read = () => ({ type: kind, message: message.input.value });
    } else if (kind === 'sequence' && allowSequence) {
      const steps = [];
      const accordionName = 'sequence-' + crypto.randomUUID();
      const count = el('span', { class: 'sequence-count', role: 'status' });
      const list = el('div', { class: 'sequence-steps', 'data-sequence-steps': '' });
      const add = button('Adicionar etapa', () => addStep({ type: 'clipboard', text: '' }, true), '', { symbol: 'plus', 'data-step-add': '' });
      function describeStep(step, index) {
        step.summary.replaceChildren(el('span', { class: 'step-summary-copy' },
          el('strong', {}, 'Etapa ' + (index + 1) + ' · ' + actionTypeLabels[step.editor.type]),
          el('small', {}, step.editor.describe())));
      }
      function openStep(step) { for (const item of steps) item.node.open = item === step; }
      function updateSteps() {
        for (const [index, step] of steps.entries()) {
          describeStep(step, index);
          step.node.dataset.stepIndex = String(index + 1);
          step.up.disabled = index === 0; step.down.disabled = index === steps.length - 1; step.remove.disabled = steps.length === 1;
          step.up.setAttribute('aria-label', 'Mover etapa ' + (index + 1) + ' para cima');
          step.down.setAttribute('aria-label', 'Mover etapa ' + (index + 1) + ' para baixo');
          step.remove.setAttribute('aria-label', 'Remover etapa ' + (index + 1));
        }
        list.replaceChildren(...steps.map(step => step.node));
        add.disabled = steps.length >= 10;
        count.textContent = steps.length + ' de 10';
      }
      function move(step, direction) {
        const index = steps.indexOf(step); const destination = index + direction;
        if (destination < 0 || destination >= steps.length) return;
        [steps[index], steps[destination]] = [steps[destination], steps[index]];
        updateSteps(); step.summary.focus(); onDirty();
      }
      function addStep(action, focus = false) {
        if (steps.length >= 10) return;
        const step = {};
        const id = 'step-' + crypto.randomUUID() + '-';
        step.editor = createActionEditor({ initial: action, prefix: id, layers, api, defaultDirectory, onDirty, onError, invalid, allowSequence: false });
        step.summary = el('summary', { tabindex: '0' });
        step.up = button('Mover etapa para cima', () => move(step, -1), 'quiet', { symbol: 'up', iconOnly: true, 'data-step-up': '' });
        step.down = button('Mover etapa para baixo', () => move(step, 1), 'quiet', { symbol: 'down', iconOnly: true, 'data-step-down': '' });
        step.remove = button('Remover etapa', () => {
          const index = steps.indexOf(step); if (steps.length <= 1) return;
          steps.splice(index, 1); updateSteps(); const target = steps[Math.min(index, steps.length - 1)]; if (!steps.some(item => item.node.open)) openStep(target); target.summary.focus(); onDirty();
        }, 'quiet danger', { symbol: 'trash', iconOnly: true, 'data-step-remove': '' });
        step.node = el('details', { class: 'sequence-step', name: accordionName, 'data-sequence-step': '', open: focus || steps.length === 0 }, step.summary,
          el('div', { class: 'sequence-step-toolbar' }, el('span', { class: 'hint' }, 'Ordem da execução'), el('div', { class: 'button-row' }, step.up, step.down, step.remove)), step.editor.node);
        step.editor.node.addEventListener('change', () => describeStep(step, steps.indexOf(step)));
        step.editor.node.addEventListener('input', () => describeStep(step, steps.indexOf(step)));
        steps.push(step); updateSteps();
        if (focus) { openStep(step); step.editor.node.querySelector('select')?.focus(); onDirty(); }
      }
      content.append(el('p', { class: 'context-note' }, 'A primeira falha interrompe as próximas etapas. Efeitos concluídos não são desfeitos.'), list, el('div', { class: 'sequence-add-row' }, add, count),
        el('p', { class: 'hint sequence-limit' }, 'As variáveis usam a tecla e a camada que iniciaram a sequência.'));
      (value.steps?.length ? value.steps : [{ type: 'clipboard', text: '' }]).forEach(action => addStep(action));
      read = () => ({ type: kind, steps: steps.map(step => step.editor.read()) });
    }
    return { node: content, read };
  }
  function show() {
    const kind = type.input.value;
    if (!cache.has(kind)) cache.set(kind, createFields(kind));
    host.replaceChildren(cache.get(kind).node); node.dataset.actionType = kind;
  }
  type.input.addEventListener('change', show); show();
  function describe() {
    const value = key => host.querySelector('[name="' + name(key) + '"]')?.value || '';
    const destination = target => {
      try { const url = new URL(target); return url.host + url.pathname; } catch { return 'Defina o destino'; }
    };
    const filename = target => target.replace(/[\\/]$/, '').split(/[\\/]/).at(-1) || 'Defina o destino';
    switch (type.input.value) {
      case 'clipboard': return value('text') ? 'Texto configurado · ' + value('text').length + ' caracteres' : 'Defina o texto';
      case 'open': return value('kind') === 'url' ? destination(value('target')) : filename(value('target'));
      case 'notification': return value('title') || 'Defina o título';
      case 'layer': return layers.find(layer => layer.id === value('layerId'))?.name || 'Escolha a camada';
      case 'http': return value('method') + ' · ' + destination(value('url'));
      case 'file': return (value('mode') === 'append' ? 'Acrescentar · ' : 'Criar · ') + (value('filename') || 'Defina o nome');
      case 'log': return value('message') ? 'Mensagem configurada' : 'Defina a mensagem';
      default: return 'Configure as etapas';
    }
  }
  return { node, read: () => cache.get(type.input.value).read(), describe, get type() { return type.input.value; } };
}
