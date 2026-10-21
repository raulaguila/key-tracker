const { randomUUID } = require('node:crypto');
const { listTemplates, templateConfig, portableLayers, importDescription, planLayerImport, exportLayerConfig } = require('./layer-library.cjs');
const { readConfigFile } = require('./storage.cjs');
const { encodeConfig } = require('./config.cjs');
const { writeExport } = require('./safe-export.cjs');

function registerProductServices({ engine, storage, handle, stateResult, serialConfig, dialog, getWindow, now = Date.now }) {
  const sources = new Map(), plans = new Map();
  const add = (map, value) => {
    for (const [key, entry] of map) if (entry.expires <= now()) map.delete(key);
    while (map.size >= 10) map.delete(map.keys().next().value);
    const token = randomUUID(); map.set(token, { ...value, expires: now() + 300000 }); return token;
  };
  const get = (map, token) => {
    if (typeof token !== 'string' || token.length > 100) throw new Error('Prévia de importação inválida.');
    const entry = map.get(token);
    if (!entry || entry.expires <= now()) { map.delete(token); throw new Error('A prévia de importação expirou. Abra novamente.'); }
    if (entry.revision !== engine.configRevision) throw new Error('A configuração mudou. Abra uma nova prévia de importação.');
    return entry;
  };
  handle('get-templates', () => listTemplates());
  handle('preview-layer-import', async templateId => {
    if (templateId !== undefined && (typeof templateId !== 'string' || templateId.length > 80)) throw new Error('Modelo inválido.');
    let config;
    if (templateId !== undefined) config = templateConfig(templateId, engine.platform);
    else {
      const result = await dialog.showOpenDialog(getWindow(), { title: 'Importar camadas', properties: ['openFile'], filters: [{ name: 'Configuração Dobra', extensions: ['json'] }] });
      if (result.canceled || !result.filePaths.length) return null;
      config = await readConfigFile(result.filePaths[0], engine.platform);
    }
    const portable = portableLayers(config, engine.platform);
    const token = add(sources, { config: portable.config, revision: engine.configRevision });
    return { token, layers: importDescription(portable.config), removedHeaders: portable.removedHeaders, removedApplications: portable.removedApplications };
  });
  handle('plan-layer-import', (token, options) => {
    const source = get(sources, token);
    const plan = planLayerImport(engine.config, source.config, options, engine.platform);
    const planId = add(plans, { config: plan.config, revision: engine.configRevision });
    return { planId, summary: plan.summary, conflicts: plan.conflicts };
  });
  handle('apply-layer-import', stateResult(planId => serialConfig(async () => {
    const plan = get(plans, planId);
    plans.delete(planId);
    if (engine.stopping || engine.disposed) throw new Error('Aguarde a parada das execuções.');
    engine.stopping = true;
    engine.cancelAllExecutions();
    try {
      await engine.whenIdle();
      await engine.saveConfig(plan.config);
      sources.clear(); plans.clear();
    } finally {
      engine.stopping = false;
      if (!engine.disposed) engine.publish();
    }
    return engine.state();
  })));
  handle('export-layer', async layerId => {
    const portable = exportLayerConfig(engine.config, layerId, engine.platform);
    const result = await dialog.showSaveDialog(getWindow(), { title: 'Exportar camada e dependências', defaultPath: 'dobra-camada.json', filters: [{ name: 'Camada Dobra', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return;
    await writeExport(result.filePath, encodeConfig(portable, engine.platform), await storage.protectedPaths());
  });
  handle('undo-config', stateResult(() => serialConfig(() => engine.undoConfig())));
  handle('redo-config', stateResult(() => serialConfig(() => engine.redoConfig())));
  return { dispose() { sources.clear(); plans.clear(); } };
}
module.exports = { registerProductServices };
