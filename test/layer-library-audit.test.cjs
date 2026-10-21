const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultConfig } = require('../app/config.cjs');
const { planLayerImport, exportLayerConfig } = require('../app/layer-library.cjs');

test('importação protege a posição física de controles mesmo com outra tecla lógica', () => {
  const current = defaultConfig(), source = defaultConfig();
  current.settings.layerShortcut = 'F9';
  source.layers = [source.layers[0]];
  Object.assign(source.layers[0].bindings[0], { key: 'B', keyCode: 'F9' });
  const plan = planLayerImport(current, source, { layers: [{ id: source.layers[0].id }], resolution: 'replace' }, 'linux');
  assert.equal(plan.summary.bindingsSkipped, 1);
  assert.equal(plan.config.layers.at(-1).bindings.length, 0);
  assert.match(plan.conflicts[0].reason, /reservado/);
});

test('atalho do painel desabilitado é preservado na exportação e fica disponível na importação', () => {
  const current = defaultConfig(); current.settings.panelShortcut = '';
  const source = defaultConfig(); source.settings.panelShortcut = '';
  source.layers = [source.layers[0]];
  source.layers[0].bindings[0].key = 'CommandOrControl+Shift+Space';
  const portable = exportLayerConfig(source, source.layers[0].id, 'linux');
  assert.equal(portable.settings.panelShortcut, '');
  const plan = planLayerImport(current, portable, { layers: [{ id: portable.layers[0].id }], resolution: 'skip' }, 'linux');
  assert.equal(plan.summary.bindingsAdded, 1);
  assert.equal(plan.summary.bindingsSkipped, 0);
});

test('assinaturas de conflitos são isoladas por plano e preservam momentos e modificadores', () => {
  const current = defaultConfig(), source = defaultConfig();
  current.layers[0].bindings = [{ id: 'existing-press', key: 'Control+A', keyCode: 'KeyA', name: 'Press', action: { type: 'clipboard', text: 'old' } }];
  source.layers = [{ ...source.layers[0], bindings: [
    { id: 'new-press', key: 'Control+A', keyCode: 'KeyA', name: 'New press', action: { type: 'clipboard', text: 'new' } },
    { id: 'new-release', key: 'Control+A', keyCode: 'KeyA', trigger: 'release', name: 'Release', action: { type: 'clipboard', text: 'release' } },
    { id: 'new-alt', key: 'Alt+A', keyCode: 'KeyA', name: 'Alt', action: { type: 'clipboard', text: 'alt' } }
  ] }];
  const options = { layers: [{ id: source.layers[0].id, targetId: current.layers[0].id }], resolution: 'skip' };
  const skip = planLayerImport(current, source, options, 'linux');
  assert.equal(skip.summary.bindingsSkipped, 1); assert.equal(skip.summary.bindingsAdded, 2);
  const replace = planLayerImport(current, source, { ...options, resolution: 'replace' }, 'linux');
  assert.equal(replace.summary.bindingsReplaced, 1); assert.equal(replace.summary.bindingsAdded, 3);
  assert.equal(current.layers[0].bindings[0].action.text, 'old');
});

test('aliases de Plus/Equal e Command/Super preservam controles físicos na importação', () => {
  for (const [platform, control, key] of [['linux', 'Control+Shift+Equal', 'Control+Plus'], ['darwin', 'Command+F9', 'Super+F9']]) {
    const current = defaultConfig(), source = defaultConfig();
    current.settings.layerShortcut = control;
    source.layers = [source.layers[0]];
    source.layers[0].bindings[0].key = key;
    const plan = planLayerImport(current, source, { layers: [{ id: source.layers[0].id }], resolution: 'replace' }, platform);
    assert.equal(plan.summary.bindingsSkipped, 1);
    assert.equal(plan.config.layers.at(-1).bindings.length, 0);
  }
});
