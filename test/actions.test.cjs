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
  await storage.save(defaultConfig());
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
