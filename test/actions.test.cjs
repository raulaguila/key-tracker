const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { executeAction } = require('../app/actions.cjs');
const { Storage } = require('../app/storage.cjs');
const { defaultConfig } = require('../app/config.cjs');
const context = { key: 'A', layer: 'Camada 1' };

async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'key-tracker-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('arquivo cria em Documentos, não sobrescreve e acrescenta quando configurado', async t => {
  const root = await directory(t);
  const options = { documents: root };
  const action = { type: 'file', directory: '', filename: 'nota.txt', content: '{{key}} · {{layer}}', mode: 'create' };
  await executeAction(action, context, options);
  const target = path.join(root, 'Keyboard Tracker', 'nota.txt');
  assert.equal(await fs.readFile(target, 'utf8'), 'A · Camada 1');
  await assert.rejects(executeAction({ ...action, content: 'sobrescrever' }, context, options), /já existe/);
  await executeAction({ ...action, content: '\nmais', mode: 'append' }, context, options);
  assert.equal(await fs.readFile(target, 'utf8'), 'A · Camada 1\nmais');
});

test('nomes interpolados não criam caminhos e arquivo append recusa symlink', async t => {
  const root = await directory(t);
  await executeAction({ type: 'file', directory: root, filename: '{{layer}}.txt', content: 'ok', mode: 'create' }, { key: 'A', layer: '../folder' }, { documents: root });
  assert.ok((await fs.readdir(root)).includes('.._folder.txt'));
  if (process.platform === 'win32') return;
  await fs.writeFile(path.join(root, 'target'), 'preservado');
  await fs.symlink(path.join(root, 'target'), path.join(root, 'link'));
  await assert.rejects(executeAction({ type: 'file', directory: root, filename: 'link', content: 'bad', mode: 'append' }, context, { documents: root }), /link simbólico/);
  assert.equal(await fs.readFile(path.join(root, 'target'), 'utf8'), 'preservado');
});

test('HTTP real envia método, parâmetros, headers e corpo; não segue redirects', async t => {
  let captured;
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    captured = { method: request.method, url: request.url, token: request.headers['x-test'], body };
    response.writeHead(request.url.startsWith('/redirect') ? 302 : 201, { Location: '/target' });
    response.end('ok');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const action = { type: 'http', method: 'POST', url: url + '/action', query: { key: '{{key}}', value: 'á b' }, headers: { 'X-Test': 'test-header' }, body: '{"key":"{{key}}"}' };
  const statuses = [];
  assert.match(await executeAction(action, context, { onHttpStatus: status => statuses.push(status) }), /HTTP 201/);
  assert.deepEqual(statuses, [201]);
  assert.deepEqual(captured, { method: 'POST', url: '/action?key=A&value=%C3%A1+b', token: 'test-header', body: '{"key":"A"}' });
  await assert.rejects(executeAction({ ...action, url: url + '/redirect' }, context, {}), error => error.httpStatus === 302 && /Redirecionamentos/.test(error.message));
  assert.ok(captured.url.startsWith('/redirect'));
});

test('timeout HTTP tem mensagem clara sem revelar credenciais', async () => {
  const action = { type: 'http', method: 'GET', url: 'http://localhost/', query: {}, headers: {}, body: '' };
  await assert.rejects(executeAction(action, context, { fetchImpl: async (_url, options) => { assert.ok(options.signal); throw new DOMException('secret', 'TimeoutError'); } }), /10 segundos/);
});

test('configuração persiste, corrupção é preservada, log é serializado e rotacionado', async t => {
  const root = await directory(t);
  const storage = new Storage(root);
  const initial = await storage.load();
  initial.layers[0].name = 'Persistida';
  await storage.save(initial);
  assert.equal((await new Storage(root).load()).layers[0].name, 'Persistida');
  await Promise.all(Array.from({ length: 10 }, (_, id) => storage.appendLog({ id })));
  const entries = (await fs.readFile(storage.logPath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(entries.map(entry => entry.id), Array.from({ length: 10 }, (_, id) => id));
  await fs.writeFile(storage.logPath, 'x'.repeat(1024 * 1024));
  await storage.appendLog({ rotated: true });
  assert.equal((await fs.stat(storage.logPath + '.1')).size, 1024 * 1024);
  await fs.writeFile(storage.configPath, '{invalid');
  await assert.rejects(storage.load(), /preservado/);
  assert.equal(await fs.readFile(storage.configPath, 'utf8'), '{invalid');
  await assert.rejects(storage.save(defaultConfig()), /preservado/);
  assert.equal(await fs.readFile(storage.configPath, 'utf8'), '{invalid');
});

test('log grava mensagem interpolada', async t => {
  const root = await directory(t);
  const storage = new Storage(root);
  await executeAction({ type: 'log', message: '{{key}} na {{layer}}' }, context, { storage });
  const result = JSON.parse((await fs.readFile(storage.logPath, 'utf8')).trim());
  assert.equal(result.message, 'A na Camada 1');
});

test('preparação não cria arquivos; execução usa os valores exatos da prévia', async t => {
  const { prepareAction, previewAction } = require('../app/actions.cjs');
  const root = await directory(t);
  const action = { type: 'file', directory: '', filename: 'nota-{{timestamp}}-{{layer}}.txt', content: '{{key}} em {{date}} / {{timestamp}}', mode: 'create' };
  const prepared = prepareAction(action, { key: 'A', layer: 'pasta/filha' }, { documents: root }, new Date('2026-10-20T12:00:00.000Z'));
  assert.deepEqual(await fs.readdir(root), []);
  assert.match(prepared.filename, /nota-2026-10-20T12-00-00-000Z-pasta_filha/);
  assert.equal(previewAction(prepared).target, prepared.target);
  await executeAction(action, context, { documents: root, preparedAction: prepared });
  assert.equal(await fs.readFile(prepared.target, 'utf8'), 'A em 2026-10-20 / 2026-10-20T12-00-00-000Z');
});

test('prévia HTTP mascara todos os headers e preserva valores privados para execução', () => {
  const { prepareAction, previewAction } = require('../app/actions.cjs');
  const action = { type: 'http', method: 'POST', url: 'https://example.test/test?original=1', query: { key: '{{key}}' }, headers: { Authorization: 'Bearer secret', 'X-Custom': '{{layer}}' }, body: '{{date}}' };
  const prepared = prepareAction(action, context, {}, new Date('2026-10-20T12:00:00.000Z'));
  const preview = previewAction(prepared);
  assert.equal(preview.url, 'https://example.test/test?original=1&key=A');
  assert.equal(preview.body, '2026-10-20');
  assert.deepEqual(preview.headers, { Authorization: '••••••', 'X-Custom': '••••••' });
  assert.equal(prepared.headers.Authorization, 'Bearer secret');
});

test('prévia de sequência resolve origem e instante únicos, mascara headers recursivos e congela profundamente', () => {
  const { prepareAction, previewAction, freezePreparedAction } = require('../app/actions.cjs');
  const action = { type: 'sequence', steps: [
    { type: 'clipboard', text: '{{key}}/{{layer}}/{{timestamp}}' },
    { type: 'open', kind: 'url', target: 'https://example.test/{{date}}' },
    { type: 'layer', layerId: 'destino' },
    { type: 'notification', title: '{{layer}}', message: '{{timestamp}}' },
    { type: 'http', method: 'POST', url: 'https://example.test/', query: {}, headers: { Authorization: 'segredo' }, body: '{{timestamp}}' }
  ] };
  const prepared = freezePreparedAction(prepareAction(action, context, { layers: [{ id: 'destino', name: 'Outra camada' }] }, new Date('2026-10-20T12:00:00.000Z')));
  const preview = previewAction(prepared);
  assert.equal(preview.steps[0].text, 'A/Camada 1/2026-10-20T12-00-00-000Z');
  assert.equal(preview.steps[1].target, 'https://example.test/2026-10-20');
  assert.equal(preview.steps[2].layerName, 'Outra camada');
  assert.equal(preview.steps[3].title, context.layer);
  assert.equal(preview.steps[3].message, preview.steps[4].body);
  assert.equal(preview.steps[4].headers.Authorization, '••••••');
  assert.equal(prepared.steps[4].headers.Authorization, 'segredo');
  assert.equal(Object.isFrozen(prepared.steps), true);
  assert.equal(Object.isFrozen(prepared.steps[4].headers), true);
  preview.steps[0].text = 'alterado';
  assert.notEqual(prepared.steps[0].text, 'alterado');
});

test('sequência executa etapas em ordem, aguarda serviços nativos e preserva origem após mudar camada', async () => {
  const calls = [];
  const steps = [];
  let release;
  const action = { type: 'sequence', steps: [
    { type: 'clipboard', text: '{{layer}}' }, { type: 'layer', layerId: 'destino' },
    { type: 'notification', title: '{{layer}}', message: '{{key}}' },
    { type: 'open', kind: 'url', target: 'https://example.test/{{key}}' }
  ] };
  const running = executeAction(action, context, {
    desktopActions: {
      clipboard: text => { calls.push(['clipboard', text]); return new Promise(resolve => { release = resolve; }); },
      notify: value => calls.push(['notification', value]), open: (kind, target) => calls.push(['open', kind, target])
    },
    setLayer: id => calls.push(['layer', id]), onStep: step => steps.push(step)
  });
  assert.deepEqual(calls, [['clipboard', 'Camada 1']]);
  assert.equal(steps.length, 0);
  release();
  assert.match(await running, /4 etapas/);
  assert.deepEqual(calls, [['clipboard', 'Camada 1'], ['layer', 'destino'], ['notification', { title: 'Camada 1', message: 'A' }], ['open', 'url', 'https://example.test/A']]);
  assert.deepEqual(steps.map(step => [step.index, step.type, step.status]), [[1, 'clipboard', 'success'], [2, 'layer', 'success'], [3, 'notification', 'success'], [4, 'open', 'success']]);
  assert.ok(steps.every(step => Number.isInteger(step.durationMs) && step.durationMs >= 0));
});

test('sequência para na primeira falha com metadados sanitizados, preservando arquivo já criado', async t => {
  const root = await directory(t);
  const steps = [];
  let notified = false;
  const action = { type: 'sequence', steps: [
    { type: 'file', directory: root, filename: 'feito.txt', content: 'conteúdo privado', mode: 'create' },
    { type: 'open', kind: 'path', target: path.join(root, 'destino-privado') },
    { type: 'notification', title: 'Privado', message: 'Não executar' }
  ] };
  await assert.rejects(executeAction(action, context, { onStep: step => steps.push(step), desktopActions: {
    open: () => { throw new Error('segredo ' + root); }, notify: () => { notified = true; }
  } }), /etapa 2 de 3: Não foi possível abrir/);
  assert.equal(await fs.readFile(path.join(root, 'feito.txt'), 'utf8'), 'conteúdo privado');
  assert.equal(notified, false);
  assert.deepEqual(steps.map(step => step.status), ['success', 'error']);
  assert.doesNotMatch(JSON.stringify(steps), /conteúdo privado|destino-privado|segredo/);
  assert.equal(JSON.stringify(steps).includes(root), false);
});

test('novos tipos e sequência persistem e recarregam sem converter ações legadas', async t => {
  const root = await directory(t);
  const storage = new Storage(root);
  const config = defaultConfig();
  config.layers[0].bindings[0].action = { type: 'sequence', stepDelayMs: 850, steps: [
    { type: 'clipboard', text: 'Texto {{key}}' },
    { type: 'open', kind: 'path', target: root },
    { type: 'notification', title: 'Título', message: 'Mensagem' },
    { type: 'layer', layerId: config.layers[1].id },
    { type: 'log', message: 'Log legado' }
  ] };
  const saved = await storage.save(config);
  const loaded = await new Storage(root).load();
  assert.equal(loaded.version, 1);
  assert.deepEqual(loaded, saved);
  assert.equal(loaded.layers[0].bindings[0].action.stepDelayMs, 850);
  assert.deepEqual(await fs.readdir(root), ['config.json']);
});

test('delay entre etapas começa após conclusão, libera event loop e não espera após última etapa', async () => {
  const { setTimeout: delay } = require('node:timers/promises');
  const calls = [];
  const finished = [];
  const steps = [];
  let releaseFirst, reachedLast;
  const last = new Promise(resolve => { reachedLast = resolve; });
  const action = { type: 'sequence', stepDelayMs: 60, steps: ['um', 'dois', 'três'].map(text => ({ type: 'clipboard', text })) };
  const running = executeAction(action, context, {
    desktopActions: { clipboard: async text => {
      calls.push({ text, at: performance.now() });
      if (text === 'um') await new Promise(resolve => { releaseFirst = resolve; });
      finished.push(performance.now());
    } },
    onStep: step => { steps.push(step); if (step.index === 3) reachedLast(); }
  });
  assert.deepEqual(calls.map(call => call.text), ['um']); // no initial delay
  await delay(25);
  assert.equal(calls.length, 1);
  releaseFirst();
  await delay(10); // runs while the sequence is waiting
  assert.equal(calls.length, 1);
  await last;
  assert.deepEqual(calls.map(call => call.text), ['um', 'dois', 'três']);
  assert.ok(calls[1].at - finished[0] >= 50);
  assert.ok(calls[2].at - finished[1] >= 50);
  assert.ok(steps[0].durationMs >= 20);
  assert.ok(steps[1].durationMs < 60); // excludes its following gap
  assert.equal(await Promise.race([running.then(() => true), delay(10).then(() => false)]), true);
});

test('zero, legado e etapa única não agendam espera; falha encerra sem delay final', async () => {
  const { setTimeout: delay } = require('node:timers/promises');
  for (const [stepDelayMs, count] of [[undefined, 3], [0, 3], [60000, 1]]) {
    const calls = [];
    const action = { type: 'sequence', ...(stepDelayMs === undefined ? {} : { stepDelayMs }), steps: Array.from({ length: count }, (_, index) => ({ type: 'clipboard', text: String(index) })) };
    const running = executeAction(action, context, { desktopActions: { clipboard: text => calls.push(text) } });
    assert.equal(await Promise.race([running.then(() => true), delay(10).then(() => false)]), true);
    assert.equal(calls.length, count);
  }
  const steps = [];
  let reachedFailure;
  const failure = new Promise(resolve => { reachedFailure = resolve; });
  const action = { type: 'sequence', stepDelayMs: 60, steps: ['ok', 'falha', 'não executar'].map(text => ({ type: 'clipboard', text })) };
  const running = executeAction(action, context, {
    desktopActions: { clipboard: text => { if (text === 'falha') throw new Error('conteúdo privado'); } },
    onStep: step => { steps.push(step); if (step.status === 'error') reachedFailure(); }
  });
  const rejected = assert.rejects(running, /etapa 2 de 3: Não foi possível copiar/);
  await failure;
  assert.equal(await Promise.race([rejected.then(() => true), delay(10).then(() => false)]), true);
  assert.deepEqual(steps.map(step => step.status), ['success', 'error']);
  assert.doesNotMatch(JSON.stringify(steps), /conteúdo privado/);
});

test('signal já cancelado e cancelamento entre etapas com delay zero impedem novos efeitos', async () => {
  const controller = new AbortController();
  controller.abort('razão privada');
  let effects = 0;
  await assert.rejects(executeAction({ type: 'clipboard', text: 'privado' }, context, { signal: controller.signal, desktopActions: { clipboard: () => { effects++; } } }), /Execução cancelada/);
  assert.equal(effects, 0);
  const next = new AbortController();
  const steps = [];
  await assert.rejects(executeAction({ type: 'sequence', stepDelayMs: 0, steps: [
    { type: 'clipboard', text: 'um' }, { type: 'clipboard', text: 'dois' }
  ] }, context, {
    signal: next.signal, desktopActions: { clipboard: () => { effects++; } },
    onStep: step => { steps.push(step); next.abort('razão privada'); }
  }), /Execução cancelada/);
  assert.equal(effects, 1);
  assert.deepEqual(steps.map(step => step.status), ['success']);
});
