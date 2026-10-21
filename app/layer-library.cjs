const { randomUUID } = require('node:crypto');
const { validateConfig, defaultConfig, effectiveShortcut, getPanelShortcut, shortcutPosition } = require('./config.cjs');
const { exportConfigSafe } = require('./storage.cjs');

const templates = [
  { id: 'notes', name: 'Notas rápidas', description: 'Criar uma nota em Documentos/Dobra com data e hora.', layer: {
    id: 'model-notes', name: 'Notas rápidas', description: 'Arquivos locais. Confira a pasta e o conteúdo antes de ativar.', applications: [], bindings: [
      { id: 'model-note-new', key: 'CommandOrControl+Alt+N', name: 'Criar nota', action: { type: 'file', directory: '', filename: 'nota-{{timestamp}}.txt', content: 'Nota criada em {{date}}.\n', mode: 'create' } }
    ] } },
  { id: 'clipboard', name: 'Textos e navegação', description: 'Copiar um texto frequente e abrir um endereço.', layer: {
    id: 'model-clipboard', name: 'Textos e navegação', description: 'Substitua os exemplos pelos seus textos e endereços.', applications: [], bindings: [
      { id: 'model-copy', key: 'CommandOrControl+Alt+C', name: 'Copiar apresentação', action: { type: 'clipboard', text: 'Olá! Como posso ajudar?' } },
      { id: 'model-open', key: 'CommandOrControl+Alt+E', name: 'Abrir endereço de exemplo', action: { type: 'open', kind: 'url', target: 'https://example.com' } }
    ] } },
  { id: 'webhook', name: 'Enviar webhook', description: 'Preparar uma requisição HTTP para o seu serviço.', layer: {
    id: 'model-webhook', name: 'Webhooks', description: 'Defina a URL, os headers e o corpo do seu serviço antes de ativar.', applications: [], bindings: [
      { id: 'model-webhook-send', key: 'CommandOrControl+Alt+W', name: 'Enviar webhook de exemplo', action: { type: 'http', method: 'POST', url: 'https://example.com/webhook', headers: {}, query: {}, body: '{"origem":"Dobra","camada":"{{layer}}"}' } }
    ] } }
];

function listTemplates() { return templates.map(({ id, name, description }) => ({ id, name, description })); }
function templateConfig(id, platform = process.platform) {
  const item = templates.find(item => item.id === id);
  if (!item) throw new Error('Modelo não encontrado.');
  return validateConfig({ version: 1, settings: defaultConfig().settings, layers: [structuredClone(item.layer)] }, platform);
}
function actionsOf(binding) { return binding.action.type === 'sequence' ? binding.action.steps : [binding.action]; }
function dependencies(layer) { return [...new Set(layer.bindings.flatMap(binding => actionsOf(binding).filter(action => action.type === 'layer').map(action => action.layerId)))]; }
function portableLayers(config, platform = process.platform) {
  const valid = validateConfig(config, platform);
  const removedHeaders = valid.layers.reduce((total, layer) => total + layer.bindings.reduce((n, binding) => n + actionsOf(binding).reduce((count, action) => count + (action.type === 'http' ? Object.keys(action.headers).length : 0), 0), 0), 0);
  const removedApplications = valid.layers.reduce((n, layer) => n + layer.applications.length, 0);
  const portable = exportConfigSafe(valid, platform);
  portable.layers.forEach(layer => { layer.applications = []; });
  return { config: portable, removedHeaders, removedApplications };
}
function importDescription(source) {
  return source.layers.map(layer => ({ id: layer.id, name: layer.name, count: layer.bindings.length,
    keys: layer.bindings.map(binding => binding.key), dependencies: dependencies(layer) }));
}
function signature(binding, platform, cache) {
  if (cache.has(binding)) return cache.get(binding);
  const position = shortcutPosition(binding.key, binding.keyCode, platform);
  const result = { effective: effectiveShortcut(binding.key, platform), position, code: position.split(':').at(-1) };
  cache.set(binding, result);
  return result;
}
function collides(a, b, platform, cache) {
  const pa = signature(a, platform, cache), pb = signature(b, platform, cache);
  const sameKey = pa.effective === pb.effective;
  const samePosition = pa.position === pb.position;
  if (sameKey && pa.code !== pb.code) return true;
  if (samePosition && !sameKey) return true;
  return (sameKey || samePosition) && (a.trigger || 'press') === (b.trigger || 'press');
}
function planLayerImport(current, source, options, platform = process.platform) {
  current = validateConfig(current, platform); source = validateConfig(source, platform);
  if (!options || !Array.isArray(options.layers) || !options.layers.length || options.layers.length > 30 || !['skip', 'replace'].includes(options.resolution)) throw new Error('Selecione as camadas e a resolução dos conflitos.');
  const config = structuredClone(current), idMap = new Map(), selected = new Set();
  const summary = { layersAdded: 0, layersMerged: 0, bindingsAdded: 0, bindingsReplaced: 0, bindingsSkipped: 0 };
  for (const selection of options.layers) {
    if (!selection || typeof selection.id !== 'string' || selected.has(selection.id) || !source.layers.some(layer => layer.id === selection.id)) throw new Error('Seleção de camadas inválida ou duplicada.');
    selected.add(selection.id);
    if (selection.targetId !== undefined && (typeof selection.targetId !== 'string' || !config.layers.some(layer => layer.id === selection.targetId))) throw new Error('Camada de destino não encontrada.');
    idMap.set(selection.id, selection.targetId || randomUUID());
  }
  for (const id of selected) {
    const layer = source.layers.find(layer => layer.id === id);
    for (const dependency of dependencies(layer)) if (!selected.has(dependency)) throw new Error('Selecione também a camada de destino “' + source.layers.find(layer => layer.id === dependency)?.name + '” usada por “' + layer.name + '”.');
  }
  for (const selection of options.layers) if (!selection.targetId) {
    const layer = source.layers.find(layer => layer.id === selection.id);
    config.layers.push({ ...structuredClone(layer), id: idMap.get(layer.id), applications: [], bindings: [] });
    summary.layersAdded++;
  } else summary.layersMerged++;
  const controls = [config.settings.layerShortcut, config.settings.pauseShortcut, getPanelShortcut(config, platform), config.settings.momentaryShortcut].filter(Boolean);
  const reserved = controls.map(key => effectiveShortcut(key, platform));
  const positions = new Set(controls.map(key => shortcutPosition(key, undefined, platform)));
  const conflicts = [], signatures = new WeakMap();
  for (const selection of options.layers) {
    const original = source.layers.find(layer => layer.id === selection.id);
    const target = config.layers.find(layer => layer.id === idMap.get(original.id));
    for (const item of original.bindings) {
      const binding = { ...structuredClone(item), id: randomUUID() };
      for (const action of actionsOf(binding)) if (action.type === 'layer') action.layerId = idMap.get(action.layerId);
      const existing = target.bindings.filter(other => collides(binding, other, platform, signatures));
      const incoming = signature(binding, platform, signatures);
      const control = reserved.includes(incoming.effective) || positions.has(incoming.position);
      if (control || existing.length) {
        conflicts.push({ layerId: original.id, layerName: original.name, bindingId: item.id, key: item.key, trigger: item.trigger || 'press', reason: control ? 'Atalho reservado por um controle do Dobra.' : 'A combinação ou posição física já possui ação neste momento.' });
        if (control || options.resolution === 'skip') { summary.bindingsSkipped++; continue; }
        const ids = new Set(existing.map(item => item.id));
        target.bindings = target.bindings.filter(item => !ids.has(item.id));
        summary.bindingsReplaced += existing.length;
      }
      target.bindings.push(binding); summary.bindingsAdded++;
    }
  }
  return { config: validateConfig(config, platform), summary, conflicts };
}
function exportLayerConfig(config, layerId, platform = process.platform) {
  config = validateConfig(config, platform);
  if (typeof layerId !== 'string' || !config.layers.some(layer => layer.id === layerId)) throw new Error('Camada não encontrada.');
  const selected = new Set();
  function visit(id) { if (selected.has(id)) return; selected.add(id); dependencies(config.layers.find(layer => layer.id === id)).forEach(visit); }
  visit(layerId);
  const settings = { layerShortcut: config.settings.layerShortcut, pauseShortcut: config.settings.pauseShortcut, cooldownMs: config.settings.cooldownMs, autoSwitchLayers: false, closeToTray: false,
    ...(config.settings.panelShortcut !== undefined ? { panelShortcut: config.settings.panelShortcut } : {}) };
  return portableLayers({ version: 1, settings, layers: config.layers.filter(layer => selected.has(layer.id)) }, platform).config;
}
module.exports = { listTemplates, templateConfig, portableLayers, importDescription, planLayerImport, exportLayerConfig };
