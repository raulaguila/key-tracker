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
  runBinding: (layerId, bindingId) => ipcRenderer.invoke('tracker:run-binding', layerId, bindingId),
  setTracking: enabled => ipcRenderer.invoke('tracker:set-tracking', enabled),
  chooseDirectory: () => ipcRenderer.invoke('tracker:choose-directory'),
  openDataDirectory: () => ipcRenderer.invoke('tracker:open-data-directory'),
  exportConfig: () => ipcRenderer.invoke('tracker:export-config'),
  importConfig: () => ipcRenderer.invoke('tracker:import-config'),
  onState: callback => subscribe('tracker:state', callback),
  onKey: callback => subscribe('tracker:key', callback)
});
