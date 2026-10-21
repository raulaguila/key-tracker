const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dobraPanel', {
  getState: () => ipcRenderer.invoke('dobra-panel:get-state'),
  hide: () => ipcRenderer.invoke('dobra-panel:hide'),
  showMain: () => ipcRenderer.invoke('dobra-panel:show-main'),
  onState: callback => {
    if (typeof callback !== 'function') throw new Error('Callback inválido.');
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('dobra-panel:state', listener);
    return () => ipcRenderer.removeListener('dobra-panel:state', listener);
  }
});
