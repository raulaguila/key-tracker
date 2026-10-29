import { el, button, shortcut, announce, icon } from './ui.js';
import { createLinuxInstallHelp } from './linux-install.js';
import { inputRecovery } from './input-recovery.mjs';

// Persist identities and a digest of the tested configuration, never its contents.
export function createFirstAutomation({ api, getState, create, test, edit, activate, configureInput, recoverInput, chooseDevice, onChange }) {
  const storageKey = 'dobra.first-automation';
  let progress = {};
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if ([1, 2].includes(saved?.version)) progress = {
      layerId: typeof saved.layerId === 'string' ? saved.layerId : undefined,
      bindingId: typeof saved.bindingId === 'string' ? saved.bindingId : undefined,
      testProof: /^[a-f0-9]{64}$/.test(saved.testProof) ? saved.testProof : undefined,
      complete: saved.version === 2 && saved.complete === true, dismissed: saved.dismissed === true
    };
  } catch { /* Session progress still works if storage is unavailable. */ }
  let tested = null, fingerprint = null, generation = 0, confirmation = null;
  let node, rendered, busy = false, error = '', shortcutError = '', celebrate = false;
  const persist = () => { try { localStorage.setItem(storageKey, JSON.stringify({ version: 2, ...progress })); } catch { /* Never fall back to storing content. */ } };
  const signature = binding => JSON.stringify([binding, getState()?.config.layers.find(layer => layer.id === progress.layerId)?.name]);
  const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  function target() {
    const layer = getState()?.config.layers.find(layer => layer.id === progress.layerId);
    const binding = layer?.bindings.find(binding => binding.id === progress.bindingId);
    return binding ? { layer, binding } : null;
  }
  const isTarget = (layerId, bindingId) => !progress.complete && !progress.dismissed && layerId === progress.layerId && bindingId === progress.bindingId;
  const installation = createLinuxInstallHelp({ api, onError: message => { error = message; update(); } });
  function update() {
    const state = getState();
    if (!state) return;
    const item = target();
    const value = item ? signature(item.binding) : null;
    if (value !== fingerprint) {
      fingerprint = value; tested = null; confirmation = null; shortcutError = '';
      const revision = ++generation, proof = progress.testProof;
      if (value && proof) void digest(value).then(hash => {
        if (generation !== revision || fingerprint !== value || progress.testProof !== proof) return;
        if (hash === proof) tested = value;
        else { delete progress.testProof; persist(); }
        update();
      }).catch(() => { /* Without a verified digest, require another manual test. */ });
      if (!item) { delete progress.testProof; persist(); }
    }
    if (confirmation && state.configRevision !== confirmation.revision) confirmation = null;
    if (confirmation && tested && !progress.dismissed && !progress.complete) {
      const events = state.events.filter(event => !confirmation.seen.has(event.id));
      confirmation.seen = new Set(state.events.map(event => event.id));
      const result = events.find(event => event.kind === 'action' && event.origin === 'shortcut' && event.outsideApp === true && event.bindingId === progress.bindingId && event.layerId === progress.layerId && event.configRevision === confirmation.revision && state.configRevision === confirmation.revision);
      if (result?.status === 'success' && item.binding.enabled !== false) {
        progress.complete = true; celebrate = true; confirmation = null; shortcutError = ''; error = ''; persist(); announce('Atalho confirmado fora do Dobra.');
      } else if (result) shortcutError = result.status === 'cancelled' ? 'O atalho foi recebido, mas a execução foi cancelada. Tente novamente quando estiver pronto.' : 'O atalho foi recebido, mas a ação falhou. ' + result.message;
    }
    if (!node?.isConnected) return;
    const waiting = tested && confirmation && item?.binding.enabled !== false && state.enabled && !state.editing && state.input.mode === 'global' && state.activeLayerId === item.layer.id;
    const step = !item ? 0 : !tested ? 1 : waiting ? 3 : 2;
    const recovery = step >= 2 ? inputRecovery(state) : null;
    const key = JSON.stringify([progress.complete, progress.dismissed, celebrate, step, item?.binding.name, item?.binding.key, item?.binding.enabled, state.enabled, state.editing, state.stopping, state.input, state.linuxInput, state.inputDevices, busy, error, shortcutError]);
    if (rendered === key) return;
    rendered = key;
    const focused = node.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    node.hidden = Boolean(progress.dismissed || progress.complete && (!celebrate || !item));
    if (node.hidden) return;
    const finish = () => { progress.dismissed = true; confirmation = null; persist(); update(); onChange(); };
    const copy = el('div', { class: 'first-automation-copy' }, el('h2', { id: 'first-automation-title' }, icon(progress.complete ? 'check' : 'keyboard'), progress.complete ? 'Seu atalho funcionou fora do Dobra' : 'Sua primeira automação'));
    const actions = el('div', { class: 'button-row first-automation-actions' });
    node.replaceChildren(copy, actions);
    if (progress.complete) {
      copy.append(el('p', {}, '“' + item.binding.name + '” foi executada com sucesso pelo atalho enquanto o Dobra estava fora de foco. Você pode pausar as ações pela barra superior.'), shortcut(item.binding.key, state.platform));
      actions.append(button('Concluir', finish, 'primary', { 'data-focus': 'first-finish' }));
    } else {
      copy.append(el('ol', { class: 'first-automation-steps', 'aria-label': 'Progresso da primeira automação' }, ['Criar', 'Testar', 'Ativar', 'Confirmar'].map((label, index) => el('li', { 'aria-current': index === step ? 'step' : undefined, class: index < step ? 'done' : index === step ? 'current' : '' }, (index + 1) + '. ' + label))));
      copy.append(el('p', {}, step === 0 ? 'Transforme um texto que você usa sempre em um atalho. Vamos criar, testar e confirmar juntos.' : step === 1 ? 'Automação salva. Confira a prévia e execute um teste antes de ativar os atalhos.' : step === 2 ? 'Teste concluído e preservado. Ative as ações para experimentar seu atalho fora do Dobra.' : 'Abra outro aplicativo e pressione seu atalho. Depois, volte ao Dobra para conferir o resultado.'));
      if (item) copy.append(el('p', { class: 'first-automation-target' }, el('strong', {}, item.binding.name), shortcut(item.binding.key, state.platform), el('span', {}, 'Camada: ' + item.layer.name)));
      if (step === 3) {
        copy.append(el('p', { class: 'first-automation-warning', role: 'status' }, 'Aguardando a execução pelo atalho fora do Dobra. O teste manual não conclui esta etapa.'));
        if (item.binding.action.type === 'clipboard') copy.append(el('p', { class: 'hint' }, 'Em um editor de texto, pressione o atalho e depois use Ctrl/⌘+V para colar. O Dobra confirma a cópia; você confere onde colar.'));
      } else {
        const recoveryAction = step === 2 && recovery && ['linux', 'install', 'mac'].includes(recovery.kind);
        actions.append(button(step === 0 ? 'Criar minha automação' : step === 1 ? 'Testar minha automação' : busy ? 'Aguarde…' : recovery?.kind === 'pending' ? recovery.label : recoveryAction ? recovery.label : recovery ? 'Tentar ativar novamente' : 'Ativar e confirmar atalho', () => {
          if (step === 0) create(); else if (step === 1) test(item.layer, item.binding); else if (recoveryAction) void recover(recovery.kind); else void enable();
        }, 'primary', { 'data-focus': 'first-next', disabled: busy || state.stopping || step === 2 && (state.editing || item.binding.enabled === false || recovery?.kind === 'pending') }));
        if (recovery?.kind === 'mac') actions.append(button('Tentar ativar novamente', () => void enable(), '', { 'data-focus': 'first-retry', disabled: busy || state.editing || state.stopping }));
      }
      if (item && !recovery) actions.append(button('Editar automação', () => edit(item.layer, item.binding), 'quiet', { 'data-focus': 'first-edit', disabled: busy || state.stopping }));
      if (recovery?.kind === 'device') actions.append(button('Escolher teclado', chooseDevice, '', { 'data-focus': 'first-device', disabled: busy }));
      if (recovery) {
        copy.append(el('section', { class: 'first-automation-recovery', role: 'status', 'aria-label': 'Recuperar entrada do teclado' }, el('h3', {}, recovery.title), el('p', {}, recovery.message)));
        if (recovery.kind === 'install') { installation.update(state.linuxInput); copy.append(installation.node); }
        if (recovery.kind === 'retry') actions.append(button('Mais ajuda com o teclado', configureInput, 'quiet', { 'data-focus': 'first-input', disabled: busy }));
      }
      actions.append(button('Agora não', finish, 'quiet', { 'data-focus': 'first-dismiss', disabled: busy }));
      if (step >= 2) copy.append(el('p', { class: 'hint' }, 'A ativação usa esta camada e habilita suas ações. As teclas continuam chegando ao aplicativo em foco.'));
    }
    if (shortcutError) copy.append(el('p', { class: 'form-errors', role: 'alert' }, shortcutError));
    if (error) copy.append(el('p', { class: 'form-errors', role: 'alert' }, error));
    if (focused) (node.querySelector('[data-focus="' + focused + '"]') || node.querySelector('[data-focus="first-finish"]'))?.focus({ preventScroll: true });
  }
  async function enable() {
    if (busy) return;
    busy = true; error = ''; shortcutError = ''; update();
    try {
      const item = target(), state = getState();
      if (!item || tested !== signature(item.binding)) throw new Error('Teste a automação novamente antes de ativar.');
      confirmation = { seen: new Set(state.events.map(event => event.id)), revision: state.configRevision };
      await activate(item.layer, item.binding);
    } catch (failure) { confirmation = null; error = failure.message || 'Não foi possível ativar. Tente novamente.'; }
    finally { busy = false; update(); }
  }
  async function recover(kind) {
    if (busy) return;
    busy = true; error = ''; confirmation = null; update();
    try { await recoverInput(kind); }
    catch (failure) { error = failure.message || 'Não foi possível recuperar a entrada. Tente novamente.'; }
    finally { busy = false; update(); }
  }
  return {
    isTarget,
    saved(layerId, bindingId) { progress = { layerId, bindingId }; tested = null; fingerprint = null; confirmation = null; ++generation; error = ''; persist(); },
    testing(layerId, bindingId) { if (isTarget(layerId, bindingId)) { tested = null; confirmation = null; ++generation; delete progress.testProof; persist(); update(); } },
    async tested(layerId, binding) {
      if (!isTarget(layerId, binding.id)) return;
      const value = signature(binding), revision = ++generation;
      let proof;
      try { proof = await digest(value); } catch { /* Keep session proof; require retest after restart. */ }
      if (revision !== generation || !isTarget(layerId, binding.id) || signature(target()?.binding) !== value) return;
      tested = fingerprint = value; progress.testProof = proof; persist(); update();
    },
    get ready() { const item = target(); return Boolean(item && tested === signature(item.binding)); },
    resume() { if (progress.complete) { progress = {}; tested = null; fingerprint = null; ++generation; } progress.dismissed = false; progress.complete = false; celebrate = false; persist(); onChange(); },
    render() { node = el('section', { class: 'first-automation', 'aria-labelledby': 'first-automation-title' }); rendered = null; return node; },
    update
  };
}
