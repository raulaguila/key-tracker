const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultConfig } = require('../app/config.cjs');
const { Engine } = require('../app/engine.cjs');
const { registerProductServices } = require('../app/product-services.cjs');

function fixture(t, options = {}) {
  const handlers = new Map(); let clock = 0; let fail = false;
  const storage = { directory: '/data', logPath: '/data/log', save: async () => { if (fail) throw new Error('disk-fixture'); }, appendLog: async () => {} };
  const engine = new Engine({ config: defaultConfig(), platform: 'linux', storage, documents: '/documents' });
  let queue = Promise.resolve();
  const service = registerProductServices({ engine, storage, handle: (channel, fn) => handlers.set(channel, fn), stateResult: fn => fn,
    serialConfig: fn => (queue = queue.catch(() => {}).then(fn)), dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), ...options.dialog }, getWindow: () => null, now: () => clock });
  t.after(() => { service.dispose(); engine.dispose(); });
  return { handlers, engine, advance: ms => { clock += ms; }, fail: () => { fail = true; } };
}
test('modelo exige prévia/plano, mantém pausado e não reaplica o mesmo plano', async t => {
  const { handlers: api, engine } = fixture(t);
  assert.equal(api.get('get-templates')().length, 3);
  const preview = await api.get('preview-layer-import')('notes');
  const plan = api.get('plan-layer-import')(preview.token, { layers: preview.layers.map(({ id }) => ({ id })), resolution: 'skip' });
  assert.equal(engine.config.layers.length, 2);
  const state = await api.get('apply-layer-import')(plan.planId);
  assert.equal(state.config.layers.length, 3); assert.equal(state.enabled, false); assert.equal(state.stopping, false);
  await assert.rejects(api.get('apply-layer-import')(plan.planId), /expirou/);
});
test('mudança de revisão e expiração invalidam planos sem alterar configuração', async t => {
  const { handlers: api, engine, advance } = fixture(t);
  const preview = await api.get('preview-layer-import')('notes');
  const plan = api.get('plan-layer-import')(preview.token, { layers: preview.layers.map(({ id }) => ({ id })), resolution: 'skip' });
  const config = structuredClone(engine.config); config.layers[0].name = 'Editada'; await engine.saveConfig(config);
  await assert.rejects(api.get('apply-layer-import')(plan.planId), /mudou/);
  const other = await api.get('preview-layer-import')('clipboard'); advance(300001);
  assert.throws(() => api.get('plan-layer-import')(other.token, { layers: other.layers.map(({ id }) => ({ id })), resolution: 'skip' }), /expirou/);
  assert.equal(engine.config.layers.length, 2);
});
test('falha de persistência preserva configuração e libera parada; cancelamento nativo não importa', async t => {
  const { handlers: api, engine, fail } = fixture(t);
  assert.equal(await api.get('preview-layer-import')(), null);
  const source = await api.get('preview-layer-import')('notes');
  const plan = api.get('plan-layer-import')(source.token, { layers: source.layers.map(({ id }) => ({ id })), resolution: 'skip' });
  fail(); await assert.rejects(api.get('apply-layer-import')(plan.planId), /disk-fixture/);
  assert.equal(engine.config.layers.length, 2); assert.equal(engine.enabled, false); assert.equal(engine.stopping, false);
});
