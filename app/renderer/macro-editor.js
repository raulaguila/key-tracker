import { el, button, field, confirmDialog } from './ui.js';

const kinds = { click: 'Clique do mouse', text: 'Inserir texto', key: 'Pressionar teclas', wait: 'Esperar' };
const maximumSteps = 200;

// The editable DOM is the draft. Native permission and recording events only
// update the recording controls; they never recreate fields or save a binding.
export function createMacroEditor({ initial = {}, prefix = '', api, shortcutField, onDirty = () => {}, onError = () => {}, invalid, cancelShortcutCapture = () => {} }) {
  const name = key => prefix + 'macro-' + key;
  const makeField = (key, label, value, options) => field(name(key), label, value, options);
  const fail = (message, key) => {
    if (invalid) invalid(message, key ? name(key) : undefined);
    throw new Error(message);
  };
  const node = el('div', { class: 'macro-editor', 'data-macro-editor': '' });
  const steps = [];
  const draft = el('input', { type: 'hidden', name: name('draft'), value: '' });
  const startDelay = makeField('startDelayMs', 'Tempo para ir ao aplicativo (ms)', initial.startDelayMs ?? 3000, {
    type: 'number', min: 0, max: 60000, step: 1, required: true,
    hint: 'Antes de executar, use esse tempo para selecionar a janela de destino. 3000 ms = 3 segundos.'
  });
  const nativeStatus = el('p', { class: 'macro-native-status', role: 'status', 'aria-atomic': 'true', 'data-macro-status': '' }, 'Verificando gravação e permissões…');
  const recordedCount = el('p', { class: 'hint macro-recorded-count', 'aria-live': 'off', hidden: true, 'data-macro-recorded-count': '' });
  const recordingHelp = el('p', { class: 'hint macro-recording-help', hidden: true });
  const record = button('Gravar cliques e teclas', () => void startRecording(), 'primary', { symbol: 'play', 'data-macro-record': '' });
  const stop = button('Parar gravação', () => void finishRecording(false), '', { symbol: 'pause', hidden: true, 'data-macro-stop': '' });
  const cancel = button('Cancelar gravação', () => void finishRecording(true), 'quiet', { symbol: 'close', hidden: true, 'data-macro-cancel': '' });
  const authorize = button('Rever permissões', () => void requestAuthorization(), 'quiet', { symbol: 'settings', 'data-macro-authorize': '' });
  const pendingCopy = el('p', { 'data-macro-review-copy': '' });
  const append = button('Acrescentar ao fluxo', () => applyRecording(false), 'primary', { symbol: 'plus', 'data-macro-append': '' });
  const replace = button('Substituir etapas', () => void replaceRecording(), '', { symbol: 'edit', 'data-macro-replace': '' });
  const discard = button('Descartar gravação', () => { pending = null; refreshPending(); changed(); record.focus(); }, 'quiet', { symbol: 'close', 'data-macro-discard': '' });
  const pendingPanel = el('section', { class: 'macro-recording-review', 'aria-label': 'Revisar gravação', hidden: true, 'data-macro-review': '' },
    el('h3', {}, 'Gravação pronta para revisão'), pendingCopy, el('div', { class: 'button-row' }, append, replace, discard));
  const list = el('div', { class: 'macro-steps', 'data-macro-steps': '' });
  const empty = el('p', { class: 'macro-empty', 'data-macro-empty': '' }, 'Grave no aplicativo que você usa ou adicione a primeira etapa abaixo. Depois, revise a ordem antes de testar.');
  const count = el('span', { class: 'sequence-count', 'data-macro-count': '' });
  const addKind = makeField('newKind', 'Nova etapa', 'click', { choices: Object.entries(kinds) });
  const add = button('Adicionar etapa', () => addStep({ kind: addKind.input.value }, true), '', { symbol: 'plus', 'data-macro-add': '' });
  let nativeState = { status: 'loading', recording: false, playing: false, capabilities: { playback: false, recording: false } };
  let busy = false;
  let disposed = false;
  let ownsRecording = false;
  let sawRecording = false;
  let harvesting = false;
  let pending = null;
  let nativeError = '';
  let unsubscribe;

  function changed() {
    // FormData already records field values and order. This marker protects
    // an active/pending recording, then clears when it is cancelled/discarded.
    draft.value = ownsRecording ? 'recording' : pending ? 'pending' : '';
    onDirty();
    node.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function report(error) {
    if (disposed) return;
    nativeError = error?.message || 'Não foi possível concluir a gravação. Seu fluxo continua no editor.';
    nativeStatus.textContent = nativeError;
    nativeStatus.dataset.status = 'error';
    onError(nativeStatus.textContent);
  }

  function refreshNative() {
    if (disposed) return;
    const active = Boolean(nativeState.recording);
    const ownActive = ownsRecording && active;
    record.hidden = ownActive;
    record.disabled = busy || active || nativeState.playing || nativeState.status === 'loading' || !nativeState.capabilities?.recording;
    stop.hidden = cancel.hidden = !ownActive;
    stop.disabled = cancel.disabled = busy;
    authorize.disabled = busy || active || nativeState.playing || nativeState.status === 'loading';
    authorize.querySelector('span').textContent = ['unauthorized', 'denied'].includes(nativeState.status) ? 'Autorizar acesso' : 'Rever permissões';
    recordingHelp.hidden = !nativeState.stopShortcut;
    recordingHelp.textContent = nativeState.stopShortcut ? 'Ao começar, o Dobra minimiza. Pare com ' + nativeState.stopShortcut + ' para voltar ao editor, ou reabra a janela e escolha Parar gravação.' : '';
    recordedCount.hidden = !ownActive;
    recordedCount.textContent = (nativeState.count || 0) + ' de ' + maximumSteps + ' etapas gravadas';
    nativeStatus.dataset.status = nativeError ? 'error' : nativeState.status || '';
    const message = busy ? 'Aguardando o sistema…'
      : nativeError || (ownActive ? 'Gravando no outro aplicativo. Para encerrar, use ' + (nativeState.stopShortcut || 'Control+Shift+F10') + ' ou volte e escolha Parar gravação.'
        : nativeState.message || (nativeState.capabilities?.recording ? 'Pronto para gravar. O fluxo só é salvo quando você salvar a ação.' : 'Gravação indisponível neste sistema. Você pode montar e editar o fluxo abaixo.'));
    // Count updates deliberately stay outside the live region.
    if (nativeStatus.textContent !== message) nativeStatus.textContent = message;
  }

  function acceptState(value) {
    if (disposed || !value || typeof value !== 'object') return;
    const wasRecording = nativeState.recording;
    nativeState = value;
    if (ownsRecording && value.recording) sawRecording = true;
    refreshNative();
    if (ownsRecording && sawRecording && wasRecording && !value.recording && !harvesting) void finishRecording(false);
  }

  async function requestAuthorization() {
    if (busy || disposed) return;
    nativeError = ''; busy = true; refreshNative();
    try { acceptState(await api.authorizeMacros()); }
    catch (error) { report(error); }
    finally { busy = false; if (!disposed) { refreshNative(); authorize.focus(); } }
  }

  async function startRecording() {
    if (busy || nativeState.recording || disposed) return;
    if (pending) { pendingPanel.querySelector('button:not(:disabled)')?.focus(); return; }
    nativeError = ''; busy = true; ownsRecording = true; sawRecording = false; changed(); refreshNative();
    try { acceptState(await api.startMacroRecording()); }
    catch (error) { ownsRecording = false; if (!disposed) changed(); report(error); }
    finally { busy = false; refreshNative(); }
  }

  async function finishRecording(cancelled) {
    if (!ownsRecording || harvesting) return;
    harvesting = true; busy = true; refreshNative();
    try {
      const result = await api.stopMacroRecording({ cancel: cancelled });
      ownsRecording = false; sawRecording = false;
      if (!cancelled && result?.steps?.length) {
        if (result.steps.length > maximumSteps || result.steps.some(step => !Object.hasOwn(kinds, step.kind))) throw new Error('A gravação retornou etapas inválidas. O fluxo existente foi preservado.');
        pending = { steps: result.steps, reason: result.reason || '' };
      }
      if (!disposed) {
        refreshPending(); changed();
        if (node.isConnected) (pending ? pendingPanel.querySelector('button:not(:disabled)') : record)?.focus();
        acceptState(await api.getMacroState());
      }
    } catch (error) { if (!disposed && !ownsRecording) changed(); report(error); }
    finally { harvesting = false; busy = false; refreshNative(); }
  }

  function refreshPending() {
    pendingPanel.hidden = !pending;
    if (!pending) return;
    const total = pending.steps.length;
    const limit = ['limit', 'step-limit', 'timeout', 'time-limit'].includes(pending.reason);
    pendingCopy.textContent = total + (total === 1 ? ' etapa gravada.' : ' etapas gravadas.') + (limit ? ' A gravação parou no limite; revise o ponto em que terminou.' : '') + ' Escolha como incluir as etapas. Nada foi salvo ainda.';
    append.disabled = steps.length + total > maximumSteps;
    append.title = append.disabled ? 'O total ultrapassaria 200 etapas. Remova etapas ou substitua o fluxo.' : '';
    replace.hidden = !steps.length;
  }

  function applyRecording(replaceExisting) {
    if (!pending || !replaceExisting && steps.length + pending.steps.length > maximumSteps) return;
    cancelShortcutCapture();
    if (replaceExisting) steps.length = 0;
    const recorded = pending.steps;
    pending = null;
    for (const value of recorded) addStep(value);
    refreshPending(); updateSteps(); changed();
    const first = steps[replaceExisting ? 0 : steps.length - recorded.length];
    if (first) { openStep(first); first.summary.focus(); }
  }

  async function replaceRecording() {
    if (!pending) return;
    if (steps.length && !await confirmDialog({ title: 'Substituir etapas do fluxo?', message: 'As ' + steps.length + ' etapas deste rascunho serão substituídas pela gravação. A ação salva só muda quando você salvar alterações.', confirmLabel: 'Substituir etapas' })) return;
    applyRecording(true);
  }

  function summarize(step) {
    const kind = step.kind.input.value;
    const value = key => step.content.querySelector('[name="' + step.id + key + '"]')?.value || '';
    if (kind === 'click') return (value('clicks') === '2' ? 'Clique duplo' : 'Clique') + ' · X ' + (value('x') || '0') + ', Y ' + (value('y') || '0');
    if (kind === 'text') return value('text').length ? value('text').length + ' caracteres' : 'Defina o texto';
    if (kind === 'key') return value('key') || 'Defina a tecla ou combinação';
    return (value('ms') || '0') + ' ms';
  }

  function describeStep(step, index) {
    step.summary.replaceChildren(el('span', { class: 'step-summary-copy' }, el('strong', {}, 'Etapa ' + (index + 1) + ' · ' + kinds[step.kind.input.value]), el('small', {}, summarize(step))));
  }

  function updateSteps() {
    for (const [index, step] of steps.entries()) {
      describeStep(step, index);
      step.node.dataset.macroStepIndex = String(index + 1);
      step.up.disabled = index === 0;
      step.down.disabled = index === steps.length - 1;
      step.up.setAttribute('aria-label', 'Mover etapa ' + (index + 1) + ' para cima');
      step.down.setAttribute('aria-label', 'Mover etapa ' + (index + 1) + ' para baixo');
      step.remove.setAttribute('aria-label', 'Remover etapa ' + (index + 1));
    }
    list.replaceChildren(...steps.map(step => step.node));
    empty.hidden = Boolean(steps.length);
    add.disabled = steps.length >= maximumSteps;
    count.textContent = steps.length + ' de ' + maximumSteps;
    refreshPending();
  }

  function openStep(selected) { for (const step of steps) step.node.open = step === selected; }

  function move(step, direction) {
    const index = steps.indexOf(step);
    const destination = index + direction;
    if (destination < 0 || destination >= steps.length) return;
    cancelShortcutCapture();
    [steps[index], steps[destination]] = [steps[destination], steps[index]];
    updateSteps(); step.summary.focus(); changed();
  }

  function addStep(value, focus = false) {
    if (steps.length >= maximumSteps) return;
    const step = { id: name('step-') + crypto.randomUUID() + '-', cache: new Map() };
    const itemField = (key, label, initialValue = '', options = {}) => field(step.id + key, label, initialValue, options);
    step.kind = itemField('kind', 'Tipo de etapa', value.kind || 'click', { choices: Object.entries(kinds) });
    step.content = el('div', { class: 'macro-step-fields' });
    step.summary = el('summary', {});
    step.before = itemField('delayBeforeMs', 'Espera antes desta etapa (ms)', value.delayBeforeMs ?? 0, { type: 'number', min: 0, max: 60000, step: 1, required: true });
    function integer(item, label, min = 0, max = 60000) {
      const number = Number(item.input.value);
      if (!item.input.value.trim() || !Number.isInteger(number) || number < min || number > max) {
        step.node.open = true;
        if (invalid) invalid(label, item.input.name);
        throw new Error(label);
      }
      return number;
    }
    function createFields(kind) {
      const source = kind === value.kind ? value : {};
      const content = el('div');
      let read;
      if (kind === 'click') {
        const x = itemField('x', 'Posição X na tela', source.x ?? 0, { type: 'number', min: -100000, max: 100000, step: 1, required: true });
        const y = itemField('y', 'Posição Y na tela', source.y ?? 0, { type: 'number', min: -100000, max: 100000, step: 1, required: true });
        const which = itemField('button', 'Botão do mouse', source.button || 'left', { choices: [['left', 'Esquerdo'], ['right', 'Direito'], ['middle', 'Central']] });
        const clicks = itemField('clicks', 'Quantidade de cliques', source.clicks ?? 1, { choices: [['1', 'Um clique'], ['2', 'Clique duplo']] });
        content.append(el('div', { class: 'macro-coordinate-fields' }, x.wrapper, y.wrapper), which.wrapper, clicks.wrapper,
          el('p', { class: 'hint' }, 'As posições são absolutas. Mantenha a janela e os monitores nas mesmas posições usadas na gravação.'));
        read = () => ({ kind, x: integer(x, 'Use uma posição X inteira entre -100000 e 100000.', -100000, 100000), y: integer(y, 'Use uma posição Y inteira entre -100000 e 100000.', -100000, 100000), button: which.input.value, clicks: Number(clicks.input.value) });
      } else if (kind === 'text') {
        const text = itemField('text', 'Texto para inserir', source.text || '', { multiline: true, maxlength: 64000, required: true, placeholder: 'Olá! Segue a informação que você pediu.', hint: 'Insere o texto colando no aplicativo de destino. Substitui o conteúdo da área de transferência.' });
        content.append(text.wrapper);
        read = () => {
          if (!text.input.value) { step.node.open = true; if (invalid) invalid('Informe o texto que será inserido.', text.input.name); else throw new Error('Informe o texto que será inserido.'); }
          return { kind, text: text.input.value };
        };
      } else if (kind === 'key') {
        const wrapper = shortcutField
          ? shortcutField(step.id + 'key', 'Tecla ou combinação a pressionar', source.key || '', 'Ex.: Enter, Tab ou Control+Shift+A. Use Inserir texto para frases e caracteres especiais.')
          : itemField('key', 'Tecla ou combinação a pressionar', source.key || '', { required: true, maxlength: 120, placeholder: 'Ex.: Enter ou Control+A', hint: 'Use Inserir texto para frases e caracteres especiais.' }).wrapper;
        const input = wrapper.querySelector('input');
        content.append(wrapper);
        read = () => {
          if (!input.value.trim()) { step.node.open = true; if (invalid) invalid('Informe a tecla ou combinação desta etapa.', input.name); else throw new Error('Informe a tecla ou combinação desta etapa.'); }
          return { kind, key: input.value.trim() };
        };
      } else {
        const wait = itemField('ms', 'Duração da espera (ms)', source.ms ?? 500, { type: 'number', min: 0, max: 60000, step: 1, required: true, hint: '1000 ms = 1 segundo. O fluxo continua depois desta espera.' });
        content.append(wait.wrapper);
        read = () => ({ kind, ms: integer(wait, 'Use uma duração inteira entre 0 e 60000 ms.') });
      }
      return { node: content, read };
    }
    function showFields() {
      const kind = step.kind.input.value;
      cancelShortcutCapture();
      if (!step.cache.has(kind)) step.cache.set(kind, createFields(kind));
      step.content.replaceChildren(step.cache.get(kind).node);
      step.before.wrapper.hidden = kind === 'wait';
      step.before.input.disabled = kind === 'wait';
      if (steps.includes(step)) describeStep(step, steps.indexOf(step));
    }
    step.up = button('Mover etapa para cima', () => move(step, -1), 'quiet', { symbol: 'up', iconOnly: true, 'data-macro-up': '' });
    step.down = button('Mover etapa para baixo', () => move(step, 1), 'quiet', { symbol: 'down', iconOnly: true, 'data-macro-down': '' });
    step.remove = button('Remover etapa', () => {
      const index = steps.indexOf(step);
      cancelShortcutCapture(); steps.splice(index, 1); updateSteps();
      const target = steps[Math.min(index, steps.length - 1)];
      if (target) { openStep(target); target.summary.focus(); } else add.focus();
      changed();
    }, 'quiet danger', { symbol: 'trash', iconOnly: true, 'data-macro-remove': '' });
    const delayOptions = el('details', { class: 'macro-step-delay', open: Boolean(value.delayBeforeMs) }, el('summary', {}, 'Espera antes desta etapa'), step.before.wrapper);
    step.node = el('details', { class: 'macro-step', 'data-macro-step': '', open: focus || !steps.length }, step.summary,
      el('div', { class: 'macro-step-toolbar' }, el('span', { class: 'hint' }, 'Ordem da execução'), el('div', { class: 'button-row' }, step.up, step.down, step.remove)),
      step.kind.wrapper, step.content, delayOptions);
    step.read = () => {
      const result = step.cache.get(step.kind.input.value).read();
      return result.kind === 'wait' ? result : { ...result, delayBeforeMs: integer(step.before, 'Use uma espera inteira entre 0 e 60000 ms.') };
    };
    step.kind.input.addEventListener('change', () => { showFields(); delayOptions.hidden = step.kind.input.value === 'wait'; });
    step.content.addEventListener('input', () => describeStep(step, steps.indexOf(step)));
    step.content.addEventListener('change', () => describeStep(step, steps.indexOf(step)));
    showFields(); delayOptions.hidden = step.kind.input.value === 'wait';
    steps.push(step); updateSteps();
    if (focus) { openStep(step); step.kind.input.focus(); changed(); }
  }

  node.append(draft,
    el('section', { class: 'macro-recording-controls', 'aria-label': 'Gravação do fluxo' },
      el('h3', {}, 'Gravar em outro aplicativo'),
      el('p', { class: 'hint' }, 'Registra cliques, combinações de teclas e intervalos enquanto você usa outro aplicativo. Evite senhas e outros dados sensíveis. Limite: 5 minutos ou 200 etapas.'),
      el('div', { class: 'button-row' }, record, stop, cancel, authorize), nativeStatus, recordedCount, recordingHelp),
    pendingPanel, startDelay.wrapper,
    el('p', { class: 'context-note' }, 'Revise o destino de cada clique. O fluxo atua na janela em foco; cancelar interrompe as próximas etapas e preserva os efeitos já realizados.'),
    empty, list,
    el('div', { class: 'macro-add-row' }, addKind.wrapper, add, count));
  for (const value of initial.steps || []) addStep(value);
  updateSteps(); refreshNative();
  if (api?.onMacroState) unsubscribe = api.onMacroState(acceptState);
  if (api?.getMacroState) void api.getMacroState().then(value => { if (nativeState.status === 'loading') acceptState(value); }).catch(error => {
    nativeState = { ...nativeState, status: 'unavailable' }; report(error); refreshNative();
  });
  else { nativeState = { status: 'unavailable', message: 'A gravação está disponível no aplicativo desktop. Você pode preparar as etapas manualmente.', capabilities: { playback: false, recording: false } }; refreshNative(); }

  return {
    node,
    describe: () => steps.length + (steps.length === 1 ? ' etapa' : ' etapas') + ' · início em ' + (startDelay.input.value || '0') + ' ms',
    read() {
      if (ownsRecording || busy) fail('Encerre a gravação antes de salvar o fluxo.');
      if (pending) fail('Inclua ou descarte a gravação antes de salvar o fluxo.');
      if (!steps.length) fail('Grave ou adicione pelo menos uma etapa ao fluxo.', 'newKind');
      const delay = Number(startDelay.input.value);
      if (!startDelay.input.value.trim() || !Number.isInteger(delay) || delay < 0 || delay > 60000) fail('Use um tempo inicial inteiro entre 0 e 60000 ms.', 'startDelayMs');
      return { type: 'macro', startDelayMs: delay, steps: steps.map(step => step.read()) };
    },
    deactivate() { cancelShortcutCapture(); if (ownsRecording) void finishRecording(false); },
    dispose() {
      disposed = true; unsubscribe?.(); cancelShortcutCapture();
      if (ownsRecording && !harvesting) {
        ownsRecording = false;
        return api.stopMacroRecording({ cancel: true }).catch(error => onError(error?.message || 'Não foi possível encerrar a gravação. Use o atalho de parada.'));
      }
    }
  };
}
