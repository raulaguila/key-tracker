const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ApplicationMonitor, applicationOwner } = require('../app/application-monitor.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(options = {}) {
  const engine = new EventEmitter();
  engine.config = { settings: { autoSwitchLayers: false } };
  engine.updates = [];
  engine.updateApplication = next => { engine.application = next; engine.updates.push(next); engine.emit('state', { application: next }); };
  const monitor = new ApplicationMonitor({ engine, platform: 'linux', session: 'x11', intervalMs: 60000, ...options });
  const enable = value => { engine.config.settings.autoSwitchLayers = value; engine.emit('state', {}); };
  return { engine, monitor, enable };
}

test('monitor é opt-in, dispensa permissões de título/URL e publica somente dono', async t => {
  let calls = 0;
  let receivedOptions;
  const { engine, monitor, enable } = fixture({ getActiveWindow: async options => {
    calls++; receivedOptions = options;
    return { title: 'segredo', url: 'https://privado.test', owner: { name: 'Editor', path: '/apps/editor', processId: 42, bundleId: 'test.editor', title: 'segredo' } };
  } });
  t.after(() => monitor.dispose());
  assert.equal(calls, 0);
  assert.equal(engine.application.status, 'off');
  enable(true); await tick();
  assert.equal(calls, 1);
  assert.deepEqual(receivedOptions, { accessibilityPermission: false, screenRecordingPermission: false });
  assert.deepEqual(engine.application.current, { name: 'Editor', path: '/apps/editor', bundleId: 'test.editor' });
  assert.ok(!JSON.stringify(engine.updates).includes('segredo'));
  const count = engine.updates.length;
  await monitor.poll();
  assert.equal(engine.updates.length, count, 'a mesma aplicação não causa loop de publicação');
  enable(false);
  assert.equal(engine.application.status, 'off');
  assert.equal(engine.application.current, null);
});

test('Wayland informa indisponibilidade sem importar ou consultar backend nativo', async t => {
  let calls = 0;
  const { engine, monitor, enable } = fixture({ session: 'wayland', getActiveWindow: async () => { calls++; } });
  t.after(() => monitor.dispose());
  enable(true); await tick(); await monitor.poll();
  assert.equal(calls, 0);
  assert.equal(engine.application.status, 'unavailable');
  assert.match(engine.application.message, /Wayland/);
});

test('resposta atrasada é descartada após desligar e consultas não se sobrepõem', async t => {
  let release;
  let calls = 0;
  const { engine, monitor, enable } = fixture({ getActiveWindow: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  t.after(() => monitor.dispose());
  enable(true);
  await monitor.poll();
  assert.equal(calls, 1);
  enable(false);
  release({ owner: { name: 'Editor', path: '/editor' } });
  await tick();
  assert.equal(engine.application.status, 'off');
  assert.equal(engine.application.current, null);
  enable(true);
  await tick();
  assert.equal(calls, 2);
  monitor.dispose();
  release({ owner: { name: 'Não publicar', path: '/privado' } });
  await tick();
  assert.ok(!JSON.stringify(engine.updates).includes('Não publicar'));
  assert.equal(engine.listenerCount('state'), 0);
});

test('timeout fica explícito sem acumular leituras; erro nativo não revela mensagem arbitrária', async t => {
  let release;
  let calls = 0;
  const { engine, monitor, enable } = fixture({ timeoutMs: 10, getActiveWindow: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  t.after(() => monitor.dispose());
  enable(true);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(engine.application.status, 'error');
  assert.match(engine.application.message, /não respondeu/);
  assert.equal(monitor.inFlight, false, 'o timeout conclui a promessa do ciclo');
  await monitor.poll();
  assert.equal(calls, 1, 'uma leitura antiga pendente não acumula novas consultas');
  const count = engine.updates.length;
  release({ owner: { name: 'Atrasado', path: '/atrasado' } });
  await tick();
  assert.equal(engine.updates.length, count);
  monitor.getActiveWindow = async () => { throw new Error('token privado da biblioteca'); };
  await monitor.poll();
  assert.equal(engine.application.status, 'error');
  assert.ok(!JSON.stringify(engine.updates).includes('token privado'));
});

test('monitor ignora processo próprio, distingue ausência de foco e ferramentas X11 ausentes', async t => {
  let result = { owner: { name: 'Editor', path: '/editor' } };
  const { engine, monitor, enable } = fixture({ getActiveWindow: async () => result });
  t.after(() => monitor.dispose());
  enable(true); await tick();
  result = { owner: { name: 'Keyboard Tracker', path: '/self', processId: process.pid } };
  await monitor.poll();
  assert.equal(engine.application.current.name, 'Editor');
  result = undefined;
  await monitor.poll();
  assert.equal(engine.application.status, 'unavailable');
  assert.equal(engine.application.current, null);
  monitor.getActiveWindow = async () => { throw Object.assign(new Error('xprop'), { code: 'linux-tools' }); };
  await monitor.poll();
  assert.match(engine.application.message, /xprop e xwininfo/);
  assert.equal(applicationOwner({ owner: { name: '\u0000 Editor\n', path: '/app' } }).name, 'Editor');
});

test('desligar e reativar depois do agendamento mantém consultas recorrentes', async t => {
  let calls = 0;
  const { monitor, enable } = fixture({ intervalMs: 5, getActiveWindow: async () => { calls++; return { owner: { name: 'Editor', path: '/editor' } }; } });
  t.after(() => monitor.dispose());
  const waitFor = async predicate => {
    const deadline = Date.now() + 1000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(predicate(), 'o monitor deveria continuar consultando');
  };
  enable(true);
  await waitFor(() => calls >= 1 && !monitor.inFlight && monitor.timer);
  enable(false);
  assert.equal(monitor.timer, null);
  const previous = calls;
  enable(true);
  await waitFor(() => calls >= previous + 3);
  monitor.dispose();
  assert.equal(monitor.timer, null);
  assert.equal(monitor.readTimeout, null);
});

test('worker real cancela helper bloqueado no timeout, ao desligar e no encerramento', { skip: process.platform !== 'linux' }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'keyboard-tracker-helper-'));
  const previousPath = process.env.PATH;
  const previousPidFile = process.env.KEY_TRACKER_NATIVE_TEST_PID;
  const script = '#!/bin/sh\nprintf "%s" "$$" > "$KEY_TRACKER_NATIVE_TEST_PID"\nexec /bin/sleep 30\n';
  await fs.writeFile(path.join(directory, 'xprop'), script, { mode: 0o700 });
  await fs.writeFile(path.join(directory, 'xwininfo'), script, { mode: 0o700 });
  process.env.PATH = directory + path.delimiter + previousPath;
  t.after(async () => {
    process.env.PATH = previousPath;
    if (previousPidFile === undefined) delete process.env.KEY_TRACKER_NATIVE_TEST_PID;
    else process.env.KEY_TRACKER_NATIVE_TEST_PID = previousPidFile;
    await fs.rm(directory, { recursive: true, force: true });
  });
  for (const mode of ['timeout', 'off', 'quit']) {
    await t.test(mode, async () => {
      const pidFile = path.join(directory, mode + '.pid');
      process.env.KEY_TRACKER_NATIVE_TEST_PID = pidFile;
      const { engine, monitor, enable } = fixture({ intervalMs: 60000, timeoutMs: 2000 });
      let pid;
      try {
        enable(true);
        const deadline = Date.now() + 4000;
        while (!pid && Date.now() < deadline) {
          try { pid = Number(await fs.readFile(pidFile, 'utf8')); } catch { /* Wait for the owned helper. */ }
          if (!pid) await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(pid, 'o adaptador real deve iniciar o helper controlado');
        if (mode === 'off') enable(false);
        if (mode === 'timeout') {
          while (engine.application.status !== 'error' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
          assert.equal(engine.application.status, 'error');
        }
        await monitor.dispose();
        assert.throws(() => process.kill(pid, 0), /ESRCH/, 'o subprocesso precisa ser recolhido antes do dispose concluir');
        assert.equal(monitor.cleanups.size, 0);
      } finally {
        await monitor.dispose();
        if (pid) try { process.kill(pid, 'SIGKILL'); } catch { /* Already reaped. */ }
      }
    });
  }
});
