// Repeatable local workload. Reports measurements, never an invented latency SLA.
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { defaultConfig, validateConfig } = require('../app/config.cjs');
const { planLayerImport } = require('../app/layer-library.cjs');

function fixture() {
  const config = defaultConfig();
  config.layers = Array.from({ length: 20 }, (_, layer) => ({
    id: 'l' + layer, name: 'L', description: '', applications: [],
    bindings: Array.from({ length: 100 }, (_, index) => ({
      id: layer.toString(36) + index.toString(36).padStart(2, '0'), name: 'A',
      key: (index < 60 ? '' : 'Control+') + (index % 60 < 26 ? String.fromCharCode(65 + index % 60) : index % 60 < 36 ? String(index % 60 - 26) : 'F' + (index % 60 - 35)),
      action: { type: 'clipboard', text: 'x' }
    })).filter(binding => !['F8', 'F9'].includes(binding.key))
  }));
  return validateConfig(config);
}
const config = fixture();
const results = {};
for (const resolution of ['skip', 'replace']) {
  const samples = [];
  for (let index = 0; index < 5; index++) {
    const start = performance.now();
    const plan = planLayerImport(config, config, { layers: config.layers.map(layer => ({ id: layer.id, targetId: layer.id })), resolution });
    samples.push(performance.now() - start);
    assert.equal(plan.config.layers.reduce((total, layer) => total + layer.bindings.length, 0), 1960);
    assert.equal(resolution === 'skip' ? plan.summary.bindingsSkipped : plan.summary.bindingsReplaced, 1960);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  results[resolution] = { samplesMs: samples, medianMs: sorted[2], maxMs: sorted.at(-1) };
}
console.log(JSON.stringify({ workload: 'layer-import-conflicts', node: process.version, platform: process.platform, arch: process.arch,
  layers: 20, actions: 1960, normalizedBytes: Buffer.byteLength(JSON.stringify(config)), results,
  note: 'Single local process, warm OS caches, five samples per resolution; not hardware certification or a cross-OS comparison.' }, null, 2));
