const path = require('node:path');
const { writeExport } = require('./safe-export.cjs');
const { spawn } = require('node:child_process');

const failure = (message, code) => Object.assign(new Error(message), code ? { code } : {});

class DesktopActions {
  constructor({ clipboard, shell, Notification, spawnImpl = spawn, platform = process.platform, timeoutMs = 10000, notificationTimeoutMs = 5000, notificationLifetimeMs = 60000 }) {
    Object.assign(this, { clipboardAPI: clipboard, shell, Notification, spawnImpl, platform, timeoutMs, notificationTimeoutMs, notificationLifetimeMs });
    this.pending = new Set();
    this.notifications = new Map();
    this.disposed = false;
  }

  bounded(operation, message) {
    if (this.disposed) return Promise.reject(failure('O aplicativo está encerrando.'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pending.delete(cancel);
        if (error) reject(failure(message)); else resolve(value);
      };
      const cancel = () => finish(true);
      const timer = setTimeout(cancel, this.timeoutMs);
      timer.unref?.();
      this.pending.add(cancel);
      Promise.resolve().then(() => { if (!settled) return operation(); }).then(value => finish(false, value), () => finish(true));
    });
  }

  clipboard(text) {
    if (typeof text !== 'string') return Promise.reject(failure('Texto para copiar inválido.'));
    return this.bounded(() => this.clipboardAPI.writeText(text), 'Não foi possível copiar o texto.');
  }

  open(kind, target) {
    if (typeof target !== 'string' || !target || target.includes('\0')) return Promise.reject(failure('Destino inválido.'));
    if (kind === 'url') {
      let url;
      try { url = new URL(target); } catch { return Promise.reject(failure('Informe uma URL HTTP ou HTTPS válida.')); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return Promise.reject(failure('Informe uma URL HTTP ou HTTPS sem credenciais.'));
      return this.bounded(() => this.shell.openExternal(url.href), 'Não foi possível abrir a URL.');
    }
    const paths = this.platform === 'win32' ? path.win32 : path.posix;
    if (!['path', 'application'].includes(kind) || !paths.isAbsolute(target)) return Promise.reject(failure('Informe um caminho absoluto para o destino.'));
    if (kind === 'path' || (this.platform === 'darwin' && /\.app\/?$/i.test(target))) {
      return this.bounded(async () => {
        if (await this.shell.openPath(target)) throw new Error('Abertura recusada pelo sistema.');
      }, kind === 'path' ? 'Não foi possível abrir o arquivo ou a pasta.' : 'Não foi possível iniciar o aplicativo.');
    }
    if (this.disposed) return Promise.reject(failure('O aplicativo está encerrando.'));
    return new Promise((resolve, reject) => {
      let child;
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pending.delete(cancel);
        if (error) reject(failure('Não foi possível iniciar o aplicativo.')); else resolve();
      };
      const cancel = () => { try { child?.kill(); } catch { /* The process may have exited already. */ } finish(true); };
      const timer = setTimeout(cancel, this.timeoutMs);
      timer.unref?.();
      this.pending.add(cancel);
      try {
        child = this.spawnImpl(target, [], { shell: false, detached: true, stdio: 'ignore', windowsHide: false });
        child.once('error', () => finish(true));
        child.once('spawn', () => { child.unref(); finish(false); });
      } catch { finish(true); }
    });
  }

  notify({ title, message }) {
    if (this.disposed) return Promise.reject(failure('O aplicativo está encerrando.', 'NOTIFICATION_REJECTED'));
    if (typeof title !== 'string' || typeof message !== 'string') return Promise.reject(failure('Notificação inválida.', 'NOTIFICATION_REJECTED'));
    let supported;
    try { supported = this.Notification.isSupported(); } catch { supported = false; }
    if (!supported) return Promise.reject(failure('Notificações não são compatíveis com este ambiente.', 'NOTIFICATION_UNSUPPORTED'));
    if (this.notifications.size >= 32) return Promise.reject(failure('Aguarde as notificações anteriores terminarem.', 'NOTIFICATION_REJECTED'));
    return new Promise((resolve, reject) => {
      let notification;
      let timer;
      let lifetime;
      let settled = false;
      let cleaned = false;
      const cleanup = (close = true) => {
        if (cleaned) return;
        cleaned = true;
        clearTimeout(timer); clearTimeout(lifetime);
        this.pending.delete(cancel);
        this.notifications.delete(notification);
        if (notification) {
          notification.removeListener('show', onShow);
          notification.removeListener('failed', onFailed);
          notification.removeListener('close', onClose);
          if (close) try { notification.close(); } catch { /* Native notification has already closed. */ }
        }
      };
      const rejected = () => {
        if (!settled) {
          settled = true;
          reject(failure('O sistema não confirmou a exibição da notificação. Confira as permissões de notificações.', 'NOTIFICATION_REJECTED'));
        }
        cleanup();
      };
      const cancel = () => rejected();
      const onShow = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pending.delete(cancel);
        // Keep the native object alive while displayed. Close is not guaranteed
        // on every OS, so the reference also has a bounded lifetime.
        lifetime = setTimeout(cleanup, this.notificationLifetimeMs);
        lifetime.unref?.();
        resolve();
      };
      const onFailed = () => rejected();
      const onClose = () => { if (!settled) rejected(); else cleanup(false); };
      try {
        notification = new this.Notification({ title, body: message });
        this.notifications.set(notification, cleanup);
        this.pending.add(cancel);
        notification.once('show', onShow);
        notification.once('failed', onFailed);
        notification.once('close', onClose);
        timer = setTimeout(rejected, this.notificationTimeoutMs);
        timer.unref?.();
        notification.show();
      } catch { rejected(); }
    });
  }

  dispose() {
    this.disposed = true;
    for (const cancel of [...this.pending]) cancel();
    for (const cleanup of [...this.notifications.values()]) cleanup();
  }
}

async function chooseActionTarget({ kind, dialog, window, platform = process.platform }) {
  if (!['path', 'application'].includes(kind)) throw failure('Tipo de destino inválido.');
  let directory = false;
  if (kind === 'path') {
    const choice = await dialog.showMessageBox(window, { type: 'question', title: 'Escolher destino', message: 'Você quer escolher um arquivo ou uma pasta?', buttons: ['Arquivo', 'Pasta', 'Cancelar'], defaultId: 0, cancelId: 2, noLink: true });
    if (![0, 1].includes(choice.response)) return null;
    directory = choice.response === 1;
  }
  const result = await dialog.showOpenDialog(window, {
    title: kind === 'application' ? 'Escolher aplicativo para abrir' : directory ? 'Escolher pasta para abrir' : 'Escolher arquivo para abrir',
    properties: [directory ? 'openDirectory' : 'openFile'],
    ...(kind === 'application' && platform === 'win32' ? { filters: [{ name: 'Aplicativos', extensions: ['exe'] }] } : {})
  });
  return result.canceled ? null : result.filePaths[0] || null;
}

function historySnapshot(events) {
  const strings = ['id', 'time', 'kind', 'status', 'message', 'layer', 'key', 'bindingId', 'trigger', 'keyCode'];
  const numbers = ['durationMs', 'httpStatus', 'repeatMs', 'holdDelayMs'];
  const pick = (value, textKeys, numberKeys) => Object.fromEntries([
    ...textKeys.filter(key => typeof value[key] === 'string').map(key => [key, value[key]]),
    ...numberKeys.filter(key => Number.isFinite(value[key])).map(key => [key, value[key]])
  ]);
  return events.slice(0, 100).map(event => ({
    ...pick(event, strings, numbers),
    ...(Array.isArray(event.steps) ? { steps: event.steps.slice(0, 10).map(step => pick(step, ['type', 'status', 'message'], ['index', 'durationMs', 'httpStatus'])) } : {})
  }));
}

async function exportSessionHistory({ events, dialog, window, protectedPaths = [] }) {
  const snapshot = { version: 1, exportedAt: new Date().toISOString(), events: historySnapshot(events) };
  const result = await dialog.showSaveDialog(window, { title: 'Exportar histórico da sessão', defaultPath: 'keyboard-tracker-history.json', filters: [{ name: 'Histórico JSON', extensions: ['json'] }] });
  if (result.canceled || !result.filePath) return;
  try { await writeExport(result.filePath, JSON.stringify(snapshot, null, 2) + '\n', protectedPaths); }
  catch (error) {
    if (error.message.includes('arquivos internos')) throw error;
    throw failure('Não foi possível exportar o histórico. Verifique a pasta e as permissões.');
  }
}

module.exports = { DesktopActions, chooseActionTarget, exportSessionHistory, historySnapshot };
