import { el, button, field, shortcut } from './ui.js';

export const triggerLabels = { press: 'Ao pressionar', hold: 'Enquanto pressionada', release: 'Ao soltar' };
export const triggerFor = binding => binding.trigger || 'press';
export function triggerDescription(binding) {
  return triggerFor(binding) === 'hold' ? 'Enquanto pressionada · ' + (binding.repeatMs || 400) + ' ms' : triggerLabels[triggerFor(binding)];
}

export function createBindingTrigger({ initial, platform, shortcutField, onDirty, invalid, getInputState }) {
  const keyCode = el('input', { type: 'hidden', id: 'field-keyCode', name: 'keyCode', value: initial?.keyCode || '' });
  const moment = field('trigger', 'Quando executar?', triggerFor(initial || {}), { choices: Object.entries(triggerLabels) });
  const repeat = field('repeatMs', 'Repetir a cada (ms)', initial?.repeatMs || 400, { type: 'number', min: 100, max: 60000, step: 1, required: true, hint: 'Começa após este intervalo e repete enquanto a tecla continuar pressionada.' });
  const physical = el('p', { class: 'physical-key-state', role: 'status' });
  const availability = el('p', { class: 'trigger-input-state', role: 'status', 'data-trigger-input-status': '' });
  const enabled = el('input', { type: 'checkbox', id: 'field-enabled', name: 'enabled', checked: initial?.enabled !== false });
  const summary = el('div', { class: 'trigger-summary' });
  const key = shortcutField('key', 'Tecla ou combinação', initial?.key || '', 'Capture no seu teclado ou digite um atalho, por exemplo, Control+Shift+A.', {
    onCapture(code) { keyCode.value = code || ''; refresh(); },
    onManualInput() { keyCode.value = ''; refresh(); }
  });
  const input = key.querySelector('input');
  const physicalHelp = el('p', { class: 'hint physical-key-help' }, 'Enquanto pressionada e Ao soltar exigem captura da tecla e entrada global. Alterar o atalho exige nova captura.');
  const body = el('div', { class: 'trigger-fields' }, key, keyCode,
    el('div', { class: 'trigger-options' }, moment.wrapper, repeat.wrapper),
    el('label', { class: 'trigger-enabled' }, enabled, 'Ação ativada'),
    physicalHelp, physical, availability);
  const node = el('details', { class: 'binding-trigger', open: !initial?.key || triggerFor(initial || {}) !== 'press' && !initial?.keyCode, 'data-binding-trigger': '' }, el('summary', {}, 'Tecla e momento'), body);
  node.addEventListener('invalid', () => { node.open = true; }, true);
  function refresh() {
    const hold = moment.input.value === 'hold';
    repeat.wrapper.hidden = !hold; repeat.input.disabled = !hold;
    physicalHelp.hidden = moment.input.value === 'press';
    const details = getInputState(input.value.trim());
    setInputState(details.input, details.enabled);
    physical.hidden = !keyCode.value;
    physical.textContent = keyCode.value ? 'Tecla capturada neste teclado' : '';
    summary.replaceChildren(...[el('span', { class: 'trigger-summary-moment' }, triggerLabels[moment.input.value]),
      input.value.trim() ? shortcut(input.value.trim(), platform) : el('span', { class: 'trigger-unset' }, 'Defina a tecla'),
      hold ? el('span', { class: 'trigger-summary-interval' }, (repeat.input.value || '400') + ' ms') : null,
      el('span', { class: 'trigger-summary-enabled' }, enabled.checked ? 'Ativada' : 'Desativada'),
      button('Editar gatilho', () => { node.open = true; input.focus(); }, 'quiet', { symbol: 'edit', iconOnly: true, title: 'Editar gatilho', 'data-edit-trigger': '' })].filter(Boolean));
  }
  function setInputState(state, actionsEnabled) {
    availability.hidden = moment.input.value === 'press' && !getInputState(input.value.trim()).groupRequiresInput;
    const mode = state?.mode || 'off';
    availability.dataset.mode = mode;
    availability.textContent = mode === 'unavailable' ? state.message || 'Entrada global indisponível. Este momento não executará ações.'
      : mode === 'starting' ? 'Preparando a entrada global…'
        : mode === 'global' ? 'Entrada global disponível.'
          : actionsEnabled ? 'Entrada global desligada. Este momento aguarda suporte global.' : 'Ative as ações para verificar a entrada global.';
  }
  for (const control of [moment.input, repeat.input, enabled]) control.addEventListener('change', refresh);
  repeat.input.addEventListener('input', refresh);
  refresh();
  return { node, summary, setInputState, read() {
    const trigger = moment.input.value;
    if (trigger !== 'press' && !keyCode.value) { node.open = true; invalid('Use Capturar tecla para definir a posição física deste momento.', 'key'); }
    const repeatMs = Number(repeat.input.value);
    if (trigger === 'hold' && (!Number.isInteger(repeatMs) || repeatMs < 100 || repeatMs > 60000)) { node.open = true; invalid('Use um intervalo inteiro entre 100 e 60000 ms.', 'repeatMs'); }
    return { key: input.value.trim(), trigger, ...(keyCode.value ? { keyCode: keyCode.value } : {}), ...(trigger === 'hold' ? { repeatMs } : {}), enabled: enabled.checked };
  } };
}
