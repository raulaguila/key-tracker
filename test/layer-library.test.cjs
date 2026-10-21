const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultConfig, validateConfig } = require('../app/config.cjs');
const { listTemplates, templateConfig, portableLayers, planLayerImport, exportLayerConfig } = require('../app/layer-library.cjs');

test('modelos locais são independentes, válidos nos três sistemas e sem credenciais', () => {
  assert.equal(listTemplates().length, 3);
  for (const platform of ['linux', 'win32', 'darwin']) for (const item of listTemplates()) {
    const source = templateConfig(item.id, platform);
    assert.deepEqual(validateConfig(source, platform), source);
    const current = defaultConfig();
    const plan = planLayerImport(current, source, { layers: source.layers.map(({ id }) => ({ id })), resolution: 'skip' }, platform);
    assert.equal(plan.summary.layersAdded, 1);
    assert.equal(current.layers.length, 2);
    assert.notEqual(plan.config.layers.at(-1).id, source.layers[0].id);
    for (const binding of plan.config.layers.at(-1).bindings) if (binding.action.type === 'http') assert.deepEqual(binding.action.headers, {});
  }
  assert.throws(() => templateConfig('missing'), /não encontrado/);
});

test('mescla distingue modificadores e resolve conflito por ignorar ou substituir', () => {
  const current = defaultConfig(); const source = defaultConfig();
  source.layers = [source.layers[0]];
  source.layers[0].bindings.push({ id: 'ctrl', key: 'Control+A', name: 'Outro comando', action: { type: 'clipboard', text: 'novo' } });
  const options = { layers: [{ id: source.layers[0].id, targetId: current.layers[0].id }], resolution: 'skip' };
  const skip = planLayerImport(current, source, options, 'linux');
  assert.equal(skip.summary.bindingsSkipped, 1); assert.equal(skip.summary.bindingsAdded, 1);
  assert.equal(skip.config.layers[0].bindings[0].id, current.layers[0].bindings[0].id);
  const replace = planLayerImport(current, source, { ...options, resolution: 'replace' }, 'linux');
  assert.equal(replace.summary.bindingsReplaced, 1); assert.equal(replace.config.layers[0].bindings.length, 2);
  assert.notEqual(replace.config.layers[0].bindings[0].id, current.layers[0].bindings[0].id);
});

test('controles reservados do destino não são substituídos por uma importação', () => {
  const current = defaultConfig(); current.settings.layerShortcut = 'F9';
  const source = defaultConfig(); source.layers[0].bindings[0].key = 'F9';
  const result = planLayerImport(current, source, { layers: [{ id: source.layers[0].id }], resolution: 'replace' });
  assert.equal(result.summary.bindingsSkipped, 1); assert.equal(result.config.layers.at(-1).bindings.length, 0);
  assert.match(result.conflicts[0].reason, /reservado/);
});

test('referências de camada são remapeadas; dependências ausentes impedem aplicação', () => {
  const current = defaultConfig(), source = defaultConfig();
  source.layers[0].bindings[0].action = { type: 'sequence', steps: [{ type: 'layer', layerId: source.layers[1].id }] };
  assert.throws(() => planLayerImport(current, source, { layers: [{ id: source.layers[0].id }], resolution: 'skip' }), /Selecione também/);
  const result = planLayerImport(current, source, { layers: source.layers.map(({ id }) => ({ id })), resolution: 'skip' });
  assert.equal(result.config.layers[2].bindings[0].action.steps[0].layerId, result.config.layers[3].id);
  assert.notEqual(result.config.layers[3].id, source.layers[1].id);
  assert.throws(() => planLayerImport(current, source, { layers: [{ id: source.layers[0].id }, { id: source.layers[0].id }], resolution: 'skip' }), /duplicada/);
});

test('exportação inclui dependências cíclicas uma vez e remove headers/associações', () => {
  const source = defaultConfig();
  source.layers[0].applications = ['private-app'];
  source.layers[0].bindings[0].action = { type: 'sequence', steps: [
    { type: 'http', method: 'GET', url: 'https://example.test', headers: { Authorization: 'private-test-value' }, query: {}, body: '' },
    { type: 'layer', layerId: source.layers[1].id }
  ] };
  source.layers[1].bindings[0].action = { type: 'layer', layerId: source.layers[0].id };
  const portable = exportLayerConfig(source, source.layers[0].id);
  assert.equal(portable.layers.length, 2); assert.deepEqual(portable.layers[0].applications, []);
  assert.equal(JSON.stringify(portable).includes('private-test-value'), false);
  const info = portableLayers(source); assert.equal(info.removedHeaders, 1); assert.equal(info.removedApplications, 1);
  assert.equal(source.layers[0].bindings[0].action.steps[0].headers.Authorization, 'private-test-value');
});

test('limites, alvos inexistentes e grupos físicos conflitantes são validados', () => {
  const current = defaultConfig(), source = defaultConfig();
  current.layers[0].bindings[0].keyCode = 'KeyA';
  source.layers[0].bindings[0] = { ...source.layers[0].bindings[0], trigger: 'release', keyCode: 'KeyQ' };
  const result = planLayerImport(current, source, { layers: [{ id: source.layers[0].id, targetId: current.layers[0].id }], resolution: 'skip' });
  assert.equal(result.summary.bindingsSkipped, 1);
  assert.throws(() => planLayerImport(current, source, { layers: [{ id: source.layers[0].id, targetId: 'missing' }], resolution: 'skip' }), /destino/);
  assert.throws(() => planLayerImport(current, source, { layers: [], resolution: 'skip' }), /Selecione/);
});
