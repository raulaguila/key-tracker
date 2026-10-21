import { el, button, shortcut } from './ui.js';

export function runningExecutions({ platform, onCancel, onCancelAll }) {
  const records = new Map();
  const count = el('span', { class: 'running-count', role: 'status' });
  const stop = button('Parar todas', onCancelAll, 'quiet danger', { 'data-focus': 'cancel-all', disabled: true });
  const list = el('div', { class: 'running-list' });
  const idle = el('p', { class: 'hint' }, 'Nenhuma execução em andamento.');
  const heading = el('h2', { id: 'running-title', tabindex: '-1' }, 'Em execução');
  const node = el('section', { class: 'running-section', 'aria-labelledby': 'running-title' },
    el('div', { class: 'running-heading' }, el('div', {}, heading, count), stop), list, idle,
    el('p', { class: 'hint running-policy' }, 'Cancelar interrompe a espera e as próximas etapas. Efeitos já concluídos não são desfeitos. Parar todas também pausa as ações.'));
  function update(items = []) {
    const ids = new Set(items.map(item => item.bindingId));
    for (const [id, record] of records) if (!ids.has(id)) {
      const focused = record.node.contains(document.activeElement);
      record.node.remove(); records.delete(id);
      if (focused) heading.focus({ preventScroll: true });
    }
    const total = items.length ? String(items.length) : '';
    if (count.textContent !== total) count.textContent = total;
    idle.hidden = Boolean(items.length);
    node.querySelector('.running-policy').hidden = !items.length;
    stop.disabled = !items.length;
    for (const item of items) {
      let record = records.get(item.bindingId);
      if (!record) {
        const name = el('strong'); const key = el('span'); const status = el('p', { class: 'running-status', role: 'status' });
        const progress = el('progress', { 'aria-label': 'Etapas concluídas' });
        const cancel = button('Cancelar', () => onCancel(item.bindingId), 'quiet danger', { 'data-focus': 'cancel-' + item.bindingId });
        const row = el('div', { class: 'running-item', 'data-running-id': item.bindingId }, el('div', { class: 'running-copy' }, el('div', { class: 'running-name' }, name, key), status), progress, cancel);
        record = { node: row, name, key, status, progress, cancel }; records.set(item.bindingId, record); list.append(row);
      }
      if (record.name.textContent !== item.name) record.name.textContent = item.name;
      if (record.key.dataset.key !== item.key) { record.key.replaceChildren(shortcut(item.key, platform)); record.key.dataset.key = item.key; }
      const many = item.stepCount > 1;
      const message = item.phase === 'cancelling' ? 'Cancelando… Aguardando a etapa em andamento encerrar.'
        : item.phase === 'waiting' ? 'Aguardando próxima etapa · ' + item.stepIndex + ' de ' + item.stepCount + ' concluídas'
          : many ? 'Executando etapa ' + item.stepIndex + ' de ' + item.stepCount : 'Executando ação…';
      if (record.status.textContent !== message) record.status.textContent = message;
      record.node.dataset.phase = item.phase;
      record.progress.hidden = !many;
      const max = Math.max(1, item.stepCount);
      const completed = item.phase === 'waiting' ? item.stepIndex : Math.max(0, item.stepIndex - 1);
      if (record.progress.max !== max) record.progress.max = max;
      if (record.progress.value !== completed) record.progress.value = completed;
      if (record.progress.getAttribute('aria-valuetext') !== message) record.progress.setAttribute('aria-valuetext', message);
      record.cancel.disabled = item.phase === 'cancelling';
      record.cancel.setAttribute('aria-label', 'Cancelar execução: ' + item.name);
    }
  }
  return { node, update };
}

export function updateStorageStatus(storage = {}) {
  const title = document.querySelector('#storage-protection');
  if (!title) return;
  const labels = { encrypted: 'Proteção nativa ativa', plain: 'Configuração local sem criptografia', legacy: 'Credenciais antigas: migração pendente', unavailable: 'Proteção nativa indisponível' };
  const text = labels[storage.protection] || 'Verificando proteção…';
  if (title.textContent !== text) title.textContent = text;
  title.dataset.protection = storage.protection || 'unavailable';
  for (const [selector, value] of [
    ['#storage-message', storage.message || 'A disponibilidade depende do provedor seguro deste sistema.'],
    ['#storage-backup', storage.backupAvailable ? 'Última versão válida disponível neste computador.' : 'O backup será criado após uma gravação válida da configuração.']
  ]) { const node = document.querySelector(selector); if (node.textContent !== value) node.textContent = value; }
  document.querySelector('[data-focus="restore-backup"]').disabled = !storage.backupAvailable;
}
