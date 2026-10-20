const { contextBridge, ipcRenderer } = require('electron');
const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') throw new Error('Callback inválido.');
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('keyboardTracker', {
  getState: () => ipcRenderer.invoke('tracker:get-state'),
  saveConfig: config => ipcRenderer.invoke('tracker:save-config', config),
  setEnabled: enabled => ipcRenderer.invoke('tracker:set-enabled', enabled),
  setLayer: id => ipcRenderer.invoke('tracker:set-layer', id),
  setEditing: editing => ipcRenderer.invoke('tracker:set-editing', editing),
  previewBinding: (layerId, bindingId) => ipcRenderer.invoke('tracker:preview-binding', layerId, bindingId),
  runBinding: (layerId, bindingId, previewId) => ipcRenderer.invoke('tracker:run-binding', layerId, bindingId, previewId),
  setTracking: enabled => ipcRenderer.invoke('tracker:set-tracking', enabled),
  chooseDirectory: () => ipcRenderer.invoke('tracker:choose-directory'),
  chooseApplication: () => ipcRenderer.invoke('tracker:choose-application'),
  chooseActionTarget: kind => ipcRenderer.invoke('tracker:choose-action-target', kind),
  showWindow: () => ipcRenderer.invoke('tracker:show-window'),
  confirmClose: () => ipcRenderer.invoke('tracker:confirm-close'),
  cancelClose: () => ipcRenderer.invoke('tracker:cancel-close'),
  openDataDirectory: () => ipcRenderer.invoke('tracker:open-data-directory'),
  exportConfig: () => ipcRenderer.invoke('tracker:export-config'),
  exportHistory: () => ipcRenderer.invoke('tracker:export-history'),
  importConfig: () => ipcRenderer.invoke('tracker:import-config'),
  onState: callback => subscribe('tracker:state', callback),
  onCloseRequested: callback => subscribe('tracker:close-requested', callback),
  onKey: callback => subscribe('tracker:key', callback)
});
