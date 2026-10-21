const { contextBridge, ipcRenderer } = require('electron');
let latestState;
let hydration;
let notifiedRevision = -1;
const stateListeners = new Set();

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
  if (!hydration) hydration = ipcRenderer.invoke('tracker:get-state').then(mergeState).finally(() => { hydration = null; });
  const fresh = await hydration;
  return mergeState(value) || fresh;
}
const invokeState = (channel, ...args) => ipcRenderer.invoke('tracker:' + channel, ...args).then(completeState);
ipcRenderer.on('tracker:state', (_event, value) => {
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
contextBridge.exposeInMainWorld('keyboardTracker', {
  getState: () => invokeState('get-state'),
  saveConfig: config => invokeState('save-config', config),
  setEnabled: enabled => invokeState('set-enabled', enabled),
  setLayer: id => invokeState('set-layer', id),
  setEditing: editing => invokeState('set-editing', editing),
  previewBinding: (layerId, bindingId) => ipcRenderer.invoke('tracker:preview-binding', layerId, bindingId),
  runBinding: (layerId, bindingId, previewId) => invokeState('run-binding', layerId, bindingId, previewId),
  cancelExecution: bindingId => invokeState('cancel-execution', bindingId),
  cancelAllExecutions: () => invokeState('cancel-all-executions'),
  setTracking: enabled => invokeState('set-tracking', enabled),
  chooseDirectory: () => ipcRenderer.invoke('tracker:choose-directory'),
  chooseApplication: () => ipcRenderer.invoke('tracker:choose-application'),
  chooseActionTarget: kind => ipcRenderer.invoke('tracker:choose-action-target', kind),
  showWindow: () => ipcRenderer.invoke('tracker:show-window'),
  confirmClose: () => ipcRenderer.invoke('tracker:confirm-close'),
  cancelClose: () => ipcRenderer.invoke('tracker:cancel-close'),
  openDataDirectory: () => ipcRenderer.invoke('tracker:open-data-directory'),
  exportConfig: () => invokeState('export-config'),
  exportHistory: () => ipcRenderer.invoke('tracker:export-history'),
  exportDiagnostics: () => ipcRenderer.invoke('tracker:export-diagnostics'),
  restoreBackup: () => invokeState('restore-backup'),
  importConfig: () => invokeState('import-config'),
  onState: callback => {
    if (typeof callback !== 'function') throw new Error('Callback inválido.');
    stateListeners.add(callback);
    return () => stateListeners.delete(callback);
  },
  onCloseRequested: callback => subscribe('tracker:close-requested', callback),
  onKey: callback => subscribe('tracker:key', callback)
});
