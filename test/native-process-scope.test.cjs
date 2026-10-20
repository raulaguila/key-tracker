const { test } = require('node:test');
const assert = require('node:assert/strict');
const { promisify } = require('node:util');
const { once } = require('node:events');
const { NativeProcessScope } = require('../app/native-process-scope.cjs');

test('wrapper preserva resultado promisify de execFile e recolhe subprocesso real', async t => {
  const scope = new NativeProcessScope();
  t.after(() => scope.cancel());
  const result = await promisify(scope.execFile)(process.execPath, ['-e', 'process.stdout.write("owner");process.stderr.write("diagnostic");']);
  assert.deepEqual(result, { stdout: 'owner', stderr: 'diagnostic' });
  assert.equal(scope.children.size, 0);
});

test('timeout mata processo bloqueado com SIGKILL e cancelamento impede novos helpers', async t => {
  const scope = new NativeProcessScope({ timeoutMs: 60 });
  t.after(() => scope.cancel());
  const operation = promisify(scope.execFile)(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setTimeout(()=>{},30000);']);
  const child = operation.child;
  const closed = once(child, 'close').catch(() => {});
  await assert.rejects(operation, error => error.killed && error.signal === 'SIGKILL');
  await closed;
  assert.equal(scope.children.size, 0);
  assert.throws(() => process.kill(child.pid, 0), /ESRCH/);
  await scope.cancel();
  assert.throws(() => scope.execFile(process.execPath, []), error => error.code === 'ABORT_ERR');
});

test('desligar aguarda close do filho real e cancelamento é idempotente', async t => {
  const scope = new NativeProcessScope({ timeoutMs: 30000 });
  t.after(() => scope.cancel());
  const operation = promisify(scope.execFile)(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setTimeout(()=>{},30000);']);
  const child = operation.child;
  const rejected = assert.rejects(operation, error => error.code === 'ABORT_ERR');
  await once(child, 'spawn');
  const cancelled = scope.cancel();
  assert.equal(scope.cancel(), cancelled);
  await cancelled; await rejected;
  assert.equal(scope.children.size, 0);
  assert.throws(() => process.kill(child.pid, 0), /ESRCH/);
});
