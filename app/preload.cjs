const { contextBridge, ipcRenderer } = require('electron');
let latestState;
let hydration;
let notifiedRevision = -1;
const stateListeners = new Set();
const closeListeners = new Set();
let pendingClose;
ipcRenderer.on('dobra:close-requested', (_event, value) => {
  if (!closeListeners.size) { pendingClose = value; return; }
  for (const callback of closeListeners) callback(value);
});

function mergeState(value) {
  if (latestState && value.stateRevision < latestState.stateRevision) return latestState;
  if (value.config) {
    if (latestState && value.configRevision < latestState.configRevision) return latestState;
    latestState = value;
  } else if (latestState && value.configRevision === latestState.configRevision) {
    latestState = { ...value, config: latestState.config };
  } else return null;
  return latestState;
}

async function completeState(value) {
  const merged = mergeState(value);
  if (merged) return merged;
  // Events and invoke replies use different IPC channels. A reply can arrive
  // before the event containing its config; hydrate once without exposing a patch.
  if (!hydration) hydration = ipcRenderer.invoke('dobra:get-state').then(mergeState).finally(() => { hydration = null; });
  const fresh = await hydration;
  return mergeState(value) || fresh;
}
const invokeState = (channel, ...args) => ipcRenderer.invoke('dobra:' + channel, ...args).then(completeState);
ipcRenderer.on('dobra:state', (_event, value) => {
  void completeState(value).then(state => {
    if (state.stateRevision <= notifiedRevision) return;
    notifiedRevision = state.stateRevision;
    for (const listener of [...stateListeners]) listener(state);
  }).catch(() => { /* A subsequent state/getState retries after renderer reload. */ });
});
const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') throw new Error('Callback inválido.');
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('dobra', {
  getState: () => invokeState('get-state'),
  saveConfig: config => invokeState('save-config', config),
  setEnabled: enabled => invokeState('set-enabled', enabled),
  setLayer: id => invokeState('set-layer', id),
  setEditing: editing => invokeState('set-editing', editing),
  previewBinding: (layerId, bindingId) => ipcRenderer.invoke('dobra:preview-binding', layerId, bindingId),
  runBinding: (layerId, bindingId, previewId) => invokeState('run-binding', layerId, bindingId, previewId),
  cancelExecution: bindingId => invokeState('cancel-execution', bindingId),
  cancelAllExecutions: () => invokeState('cancel-all-executions'),
  setTracking: enabled => invokeState('set-tracking', enabled),
  setLinuxInputEnabled: enabled => invokeState('set-linux-input-enabled', enabled),
  chooseDirectory: () => ipcRenderer.invoke('dobra:choose-directory'),
  chooseApplication: () => ipcRenderer.invoke('dobra:choose-application'),
  chooseActionTarget: kind => ipcRenderer.invoke('dobra:choose-action-target', kind),
  getTemplates: () => ipcRenderer.invoke('dobra:get-templates'),
  previewLayerImport: templateId => ipcRenderer.invoke('dobra:preview-layer-import', templateId),
  planLayerImport: (token, options) => ipcRenderer.invoke('dobra:plan-layer-import', token, options),
  applyLayerImport: planId => invokeState('apply-layer-import', planId),
  exportLayer: layerId => ipcRenderer.invoke('dobra:export-layer', layerId),
  undoConfig: () => invokeState('undo-config'),
  redoConfig: () => invokeState('redo-config'),
  showQuickPanel: () => ipcRenderer.invoke('dobra:show-quick-panel'),
  hideQuickPanel: () => ipcRenderer.invoke('dobra:hide-quick-panel'),
  setQuickPanelTheme: theme => ipcRenderer.invoke('dobra:set-quick-panel-theme', theme),
  showWindow: () => ipcRenderer.invoke('dobra:show-window'),
  confirmClose: () => ipcRenderer.invoke('dobra:confirm-close'),
  cancelClose: () => ipcRenderer.invoke('dobra:cancel-close'),
  openDataDirectory: () => ipcRenderer.invoke('dobra:open-data-directory'),
  exportConfig: () => invokeState('export-config'),
  exportHistory: () => ipcRenderer.invoke('dobra:export-history'),
  exportDiagnostics: () => ipcRenderer.invoke('dobra:export-diagnostics'),
  restoreBackup: () => invokeState('restore-backup'),
  importConfig: () => invokeState('import-config'),
  onState: callback => {
    if (typeof callback !== 'function') throw new Error('Callback inválido.');
    stateListeners.add(callback);
    return () => stateListeners.delete(callback);
  },
  onCloseRequested: callback => {
    if (typeof callback !== 'function') throw new Error('Callback inválido.');
    closeListeners.add(callback);
    if (pendingClose) { const value = pendingClose; pendingClose = undefined; callback(value); }
    return () => closeListeners.delete(callback);
  },
  onKey: callback => subscribe('dobra:key', callback)
});
