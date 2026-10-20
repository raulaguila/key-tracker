const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DesktopActions, chooseActionTarget, exportSessionHistory, historySnapshot } = require('../app/desktop-actions.cjs');

function fixture(options = {}) {
  const calls = [];
  const notifications = [];
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor(value) { super(); this.options = value; notifications.push(this); }
    show() { calls.push(['notify', this.options]); }
    close() { this.closed = true; this.emit('close'); }
  }
  const actions = new DesktopActions({ clipboard: { writeText: value => calls.push(['clipboard', value]) }, shell: { openExternal: async value => { calls.push(['url', value]); }, openPath: async value => { calls.push(['path', value]); return ''; } }, Notification, platform: 'linux', ...options });
  return { actions, calls, notifications, Notification };
}

test('copiar usa somente clipboard.writeText e falha sem revelar texto', async t => {
  const { actions, calls } = fixture();
  t.after(() => actions.dispose());
  await actions.clipboard('Texto\n{{já resolvido}}');
  assert.deepEqual(calls, [['clipboard', 'Texto\n{{já resolvido}}']]);
  actions.clipboardAPI.writeText = () => { throw new Error('segredo copiado'); };
  await assert.rejects(actions.clipboard('segredo copiado'), error => error.message === 'Não foi possível copiar o texto.');
  await assert.rejects(actions.clipboard(null), /inválido/);
});

test('URL abre somente HTTP(S) sem credenciais e caminhos exigem destino absoluto', async t => {
  const { actions, calls } = fixture();
  t.after(() => actions.dispose());
  await actions.open('url', 'https://example.test/consulta?q=a');
  await actions.open('path', '/home/teste/Documento com espaço.txt');
  assert.deepEqual(calls, [['url', 'https://example.test/consulta?q=a'], ['path', '/home/teste/Documento com espaço.txt']]);
  for (const url of ['file:///tmp/file', 'javascript:alert(1)', 'https://name:secret@example.test/', 'ftp://example.test']) await assert.rejects(actions.open('url', url));
  for (const target of ['relativo.txt', 'arquivo\0invalido']) await assert.rejects(actions.open('path', target));
  await assert.rejects(actions.open('shell', '/bin/anything'));
  assert.equal(calls.length, 2);
  actions.shell.openPath = async () => 'segredo do caminho';
  await assert.rejects(actions.open('path', '/privado'), error => error.message === 'Não foi possível abrir o arquivo ou a pasta.');
});

test('app é iniciado sem argumentos, shell ou captura de saída; .app usa abertura nativa', async t => {
  let invocation;
  const child = new EventEmitter();
  let unref = false;
  child.unref = () => { unref = true; };
  const { actions } = fixture({ platform: 'win32', spawnImpl: (target, args, options) => {
    invocation = { target, args, options };
    queueMicrotask(() => child.emit('spawn'));
    return child;
  } });
  t.after(() => actions.dispose());
  await actions.open('application', 'C:\\Program Files\\Editor & Tools\\editor.exe');
  assert.deepEqual(invocation, { target: 'C:\\Program Files\\Editor & Tools\\editor.exe', args: [], options: { shell: false, detached: true, stdio: 'ignore', windowsHide: false } });
  assert.equal(unref, true);
  child.emit('error', new Error('erro depois da inicialização não vira exceção global'));
  const mac = fixture({ platform: 'darwin' });
  t.after(() => mac.actions.dispose());
  await mac.actions.open('application', '/Applications/Editor.app');
  assert.deepEqual(mac.calls, [['path', '/Applications/Editor.app']]);
});

test('falha ao iniciar app e tempo limite não produzem sucesso nem deixam execução pendente', async t => {
  const keepAlive = setTimeout(() => {}, 500);
  t.after(() => clearTimeout(keepAlive));
  const child = new EventEmitter();
  let killed = false;
  child.kill = () => { killed = true; };
  const { actions } = fixture({ timeoutMs: 10, spawnImpl: () => child });
  t.after(() => actions.dispose());
  await assert.rejects(actions.open('application', '/apps/never-started'), /Não foi possível iniciar/);
  assert.equal(killed, true);
  assert.equal(actions.pending.size, 0);
  actions.spawnImpl = () => { throw new Error('/caminho privado'); };
  await assert.rejects(actions.open('application', '/apps/private'), error => !error.message.includes('privado'));
  actions.shell.openExternal = () => new Promise(() => {});
  await assert.rejects(actions.open('url', 'https://example.test'), /Não foi possível abrir a URL/);
});

test('notificação só confirma após show, preserva referência e encerra no close', async t => {
  const { actions, notifications } = fixture();
  t.after(() => actions.dispose());
  let complete = false;
  const result = actions.notify({ title: 'Aviso', message: 'Mensagem' }).then(() => { complete = true; });
  assert.equal(complete, false);
  assert.equal(actions.notifications.size, 1);
  notifications[0].emit('show');
  await result;
  assert.equal(complete, true);
  assert.deepEqual(notifications[0].options, { title: 'Aviso', body: 'Mensagem' });
  assert.equal(actions.notifications.size, 1);
  notifications[0].emit('close');
  assert.equal(actions.notifications.size, 0);
  assert.equal(notifications[0].listenerCount('failed'), 0);
});

test('notificação distingue não suportada, rejeitada, fechamento antecipado e timeout', async t => {
  const keepAlive = setTimeout(() => {}, 500);
  t.after(() => clearTimeout(keepAlive));
  const unsupported = fixture({ Notification: class { static isSupported() { return false; } } });
  t.after(() => unsupported.actions.dispose());
  await assert.rejects(unsupported.actions.notify({ title: 'Teste', message: 'Texto' }), error => error.code === 'NOTIFICATION_UNSUPPORTED');
  const { actions, notifications } = fixture({ notificationTimeoutMs: 10 });
  t.after(() => actions.dispose());
  const rejected = actions.notify({ title: 'Privado', message: 'Conteúdo privado' });
  notifications[0].emit('failed', {}, 'Conteúdo privado retornado pelo SO');
  await assert.rejects(rejected, error => error.code === 'NOTIFICATION_REJECTED' && !error.message.includes('privado'));
  const closed = actions.notify({ title: 'Teste', message: 'Texto' });
  notifications[1].emit('close');
  await assert.rejects(closed, error => error.code === 'NOTIFICATION_REJECTED');
  await assert.rejects(actions.notify({ title: 'Teste', message: 'Texto' }), error => error.code === 'NOTIFICATION_REJECTED');
  assert.equal(actions.notifications.size, 0);
  assert.ok(notifications.every(notification => notification.closed));
});

test('dispose libera notificações, listeners, timers e ações ainda pendentes', async () => {
  const { actions, notifications, calls } = fixture();
  const displayed = actions.notify({ title: 'Exibida', message: 'Texto' });
  notifications[0].emit('show');
  await displayed;
  const pending = actions.notify({ title: 'Pendente', message: 'Texto' });
  const copy = actions.clipboard('Não executar depois do dispose');
  actions.dispose();
  await assert.rejects(pending, error => error.code === 'NOTIFICATION_REJECTED');
  await assert.rejects(copy);
  assert.equal(actions.notifications.size, 0);
  assert.equal(actions.pending.size, 0);
  assert.ok(notifications.every(notification => notification.closed && notification.listenerCount('show') === 0 && notification.listenerCount('close') === 0));
  assert.equal(calls.some(call => call[0] === 'clipboard'), false);
  await assert.rejects(actions.open('url', 'https://example.test'), /encerrando/);
});

test('escolha nativa de arquivo/pasta/app preserva cancelamento e não executa destino', async () => {
  const calls = [];
  let response = 1;
  const dialog = { showMessageBox: async () => ({ response }), showOpenDialog: async (window, options) => { calls.push(options); return { canceled: false, filePaths: ['/escolhido'] }; } };
  assert.equal(await chooseActionTarget({ kind: 'path', dialog, window: {} }), '/escolhido');
  assert.deepEqual(calls[0].properties, ['openDirectory']);
  response = 0;
  await chooseActionTarget({ kind: 'path', dialog, window: {} });
  assert.deepEqual(calls[1].properties, ['openFile']);
  response = 2;
  assert.equal(await chooseActionTarget({ kind: 'path', dialog, window: {} }), null);
  assert.equal(calls.length, 2);
  await chooseActionTarget({ kind: 'application', dialog, platform: 'win32' });
  assert.deepEqual(calls[2].filters, [{ name: 'Aplicativos', extensions: ['exe'] }]);
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  assert.equal(await chooseActionTarget({ kind: 'application', dialog }), null);
  await assert.rejects(chooseActionTarget({ kind: 'shell', dialog }), /inválido/);
});

test('histórico exporta apenas eventos e etapas sanitizados, com limites e sem afetar configuração', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'keyboard-tracker-history-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = path.join(directory, 'config.json');
  const target = path.join(directory, 'history.json');
  await fs.writeFile(config, 'configuração preservada');
  const events = [{ id: '1', time: '2026-10-20T00:00:00Z', kind: 'action', status: 'success', message: 'Texto copiado.', durationMs: 2, headers: { secret: 'não exportar' }, text: 'não exportar', steps: [{ index: 1, type: 'clipboard', status: 'success', message: 'Texto copiado.', durationMs: 1, text: 'não exportar' }] }];
  let destination = target;
  const dialog = { showSaveDialog: async () => ({ canceled: false, filePath: destination }) };
  await exportSessionHistory({ events, dialog, protectedPaths: [config] });
  const exported = JSON.parse(await fs.readFile(target, 'utf8'));
  assert.equal(exported.version, 1);
  assert.equal(exported.events[0].steps[0].index, 1);
  assert.equal(exported.events[0].durationMs, 2);
  assert.equal(JSON.stringify(exported).includes('não exportar'), false);
  assert.equal(historySnapshot(Array(150).fill(events[0])).length, 100);
  destination = config;
  await assert.rejects(exportSessionHistory({ events, dialog, protectedPaths: [config] }), /arquivos internos/);
  assert.equal(await fs.readFile(config, 'utf8'), 'configuração preservada');
  dialog.showSaveDialog = async () => ({ canceled: true, filePath: target });
  const original = await fs.readFile(target, 'utf8');
  await exportSessionHistory({ events: [], dialog, protectedPaths: [config] });
  assert.equal(await fs.readFile(target, 'utf8'), original);
});

test('histórico preserva momento configurado sem exportar eventos crus do teclado', () => {
  const [event] = historySnapshot([{ id: 'phase', kind: 'action', trigger: 'hold', keyCode: 'KeyA', repeatMs: 250,
    rawInput: { code: 'KeyB', key: 'texto privado', direction: 'down' }, ctrlKey: true }]);
  assert.equal(event.trigger, 'hold');
  assert.equal(event.keyCode, 'KeyA');
  assert.equal(event.repeatMs, 250);
  assert.equal(JSON.stringify(event).includes('texto privado'), false);
  assert.equal(Object.hasOwn(event, 'ctrlKey'), false);
});

test('exportar histórico rejeita hardlinks dos dados internos e não deixa temporários', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'keyboard-tracker-alias-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = path.join(directory, 'config.json');
  const alias = path.join(directory, 'history.json');
  await fs.writeFile(config, 'configuração preservada');
  await fs.link(config, alias);
  const dialog = { showSaveDialog: async () => ({ canceled: false, filePath: alias }) };
  await assert.rejects(exportSessionHistory({ events: [], dialog, protectedPaths: [config] }), /arquivos internos/);
  assert.equal(await fs.readFile(config, 'utf8'), 'configuração preservada');
  assert.equal(await fs.readFile(alias, 'utf8'), 'configuração preservada');
  assert.equal((await fs.readdir(directory)).some(file => file.endsWith('.tmp')), false);
});

test('exportação atômica troca só o destino quando há hardlink para outro arquivo', async t => {
  const { writeExport } = require('../app/safe-export.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'keyboard-tracker-export-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const original = path.join(directory, 'original.json'), target = path.join(directory, 'export.json');
  await fs.writeFile(original, 'original preservado');
  await fs.link(original, target);
  await writeExport(target, '{"exported":true}');
  assert.equal(await fs.readFile(original, 'utf8'), 'original preservado');
  assert.equal(await fs.readFile(target, 'utf8'), '{"exported":true}');
  assert.equal((await fs.readdir(directory)).length, 2);
});
