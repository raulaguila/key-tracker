const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DesktopTray, trayIcon, trayHostAvailable } = require('../app/desktop-tray.cjs');

function fixture(options = {}) {
  const engine = new EventEmitter();
  engine.enabled = false;
  engine.editing = false;
  engine.activeLayerId = 'a';
  engine.config = { layers: [{ id: 'a', name: 'Padrão' }, { id: 'b', name: 'Trabalho' }] };
  engine.tracking = { enabled: false };
  engine.desktop = { trayAvailable: false };
  engine.state = () => ({ enabled: engine.enabled, editing: engine.editing, activeLayerId: engine.activeLayerId, config: engine.config, tracking: engine.tracking });
  engine.publish = () => { engine.emit('state', engine.state()); };
  engine.setEnabled = value => { engine.enabled = value; engine.publish(); };
  engine.setLayer = id => { engine.activeLayerId = id; engine.publish(); };
  let shown = 0;
  let quit = 0;
  let tracking;
  class Tray extends EventEmitter {
    constructor(image) { super(); this.image = image; this.destroyed = false; this.menuBuilds = 0; }
    setImage(image) { this.image = image; }
    setToolTip(value) { this.tooltip = value; }
    setContextMenu(value) { this.menu = value; this.menuBuilds++; }
    destroy() { this.destroyed = true; }
  }
  const desktop = new DesktopTray({
    Tray, Menu: { buildFromTemplate: value => value }, nativeImage: { createFromBuffer: buffer => ({ buffer, isEmpty: () => false }) }, engine,
    tracker: { set: value => { tracking = value; } }, showWindow: () => { shown++; }, quit: () => { quit++; }, ...options
  });
  engine.desktop.trayAvailable = desktop.available;
  return { desktop, engine, shown: () => shown, quit: () => quit, tracking: () => tracking };
}

test('bandeja reflete estados e camadas, oferece controles sem iniciar nada', t => {
  const { desktop, engine, shown, quit, tracking } = fixture();
  t.after(() => desktop.dispose());
  assert.equal(desktop.available, true);
  assert.equal(engine.enabled, false);
  assert.match(desktop.tray.tooltip, /Pausado/);
  assert.equal(desktop.tray.menu.find(item => item.label === 'Desligar rastreio').enabled, false);
  desktop.tray.menu.find(item => item.label === 'Ativar ações').click();
  assert.equal(engine.enabled, true);
  assert.match(desktop.tray.tooltip, /Ativo/);
  engine.editing = true; engine.publish();
  assert.match(desktop.tray.tooltip, /Suspenso/);
  desktop.tray.menu.find(item => item.label === 'Camada ativa').submenu[1].click();
  assert.equal(engine.activeLayerId, 'b');
  assert.equal(desktop.tray.menu.find(item => item.label === 'Camada ativa').submenu[1].checked, true);
  assert.match(desktop.tray.tooltip, /Trabalho/);
  engine.tracking.enabled = true; engine.publish();
  desktop.tray.menu.find(item => item.label === 'Desligar rastreio').click();
  assert.equal(tracking(), false);
  desktop.tray.menu.find(item => item.label === 'Abrir Keyboard Tracker').click();
  assert.equal(shown(), 1);
  desktop.tray.menu.find(item => item.label === 'Sair').click();
  assert.equal(quit(), 1, 'sair usa proteção de rascunhos do coordenador');
  const builds = desktop.tray.menuBuilds;
  engine.publish();
  assert.equal(desktop.tray.menuBuilds, builds, 'eventos de ação não reconstroem menu idêntico');
});

test('falha na bandeja preserva recuperação da janela e dispose remove assinaturas', () => {
  const { desktop, engine, shown } = fixture();
  const native = desktop.tray;
  native.setContextMenu = () => { throw new Error('Bandeja removida pelo ambiente'); };
  engine.enabled = true; engine.publish();
  assert.equal(desktop.available, false);
  assert.equal(engine.desktop.trayAvailable, false);
  assert.equal(shown(), 1);
  assert.equal(native.destroyed, true);
  assert.equal(engine.listenerCount('state'), 0);
  desktop.dispose();
  const unavailable = fixture({ Tray: class { constructor() { throw new Error('Sem host de bandeja'); } } });
  assert.equal(unavailable.desktop.available, false);
  assert.equal(unavailable.engine.listenerCount('state'), 0);
  unavailable.desktop.dispose();
});

test('ícones nativos são PNGs distintos por estado; encerramento destrói recurso', () => {
  const active = trayIcon('active');
  assert.deepEqual([...active.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.notDeepEqual(active, trayIcon('paused'));
  assert.notDeepEqual(active, trayIcon('suspended'));
  const { desktop, engine } = fixture();
  const native = desktop.tray;
  desktop.dispose();
  assert.equal(native.destroyed, true);
  assert.equal(engine.listenerCount('state'), 0);
});

test('Linux só oferece ocultar na bandeja com host confirmado; consulta é limitada e sem shell', async () => {
  let calls = 0;
  const execFileImpl = (command, args, options, callback) => {
    calls++;
    assert.equal(command, 'dbus-send');
    assert.ok(args.includes('string:org.kde.StatusNotifierWatcher'));
    assert.equal(options.timeout, 1500);
    assert.equal(options.maxBuffer, 4096);
    assert.equal(options.shell, undefined);
    callback(null, 'method return\n   boolean true\n');
  };
  assert.equal(await trayHostAvailable({ platform: 'linux', execFileImpl }), true);
  assert.equal(calls, 1);
  assert.equal(await trayHostAvailable({ platform: 'darwin', execFileImpl }), true);
  assert.equal(await trayHostAvailable({ platform: 'win32', execFileImpl }), true);
  assert.equal(calls, 1);
  assert.equal(await trayHostAvailable({ platform: 'linux', execFileImpl: (command, args, options, callback) => callback(null, 'boolean false') }), false);
  assert.equal(await trayHostAvailable({ platform: 'linux', execFileImpl: (command, args, options, callback) => callback(new Error('ENOENT')) }), false);
  assert.equal(await trayHostAvailable({ platform: 'linux', execFileImpl: () => { throw new Error('indisponível'); } }), false);
  const { desktop, engine } = fixture({ hostAvailable: false, Tray: class { constructor() { assert.fail('Sem host não cria recurso de bandeja'); } } });
  assert.equal(desktop.available, false);
  assert.equal(engine.listenerCount('state'), 0);
  desktop.dispose();
});
