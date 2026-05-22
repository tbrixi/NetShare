const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('netshare', {
  listAdapters:          (args)    => ipcRenderer.invoke('adapters:list', args || {}),
  listClients:           (args)    => ipcRenderer.invoke('clients:list', args || {}),
  openAdapterProperties: (args)    => ipcRenderer.invoke('adapter:properties', args || {}),
  setAdapterState:       (args)    => ipcRenderer.invoke('adapter:setState', args || {}),
  runSpeedTest:          (args)    => ipcRenderer.invoke('adapter:speedTest', args || {}),
  startSharing:          (args)    => ipcRenderer.invoke('sharing:start', args || {}),
  stopSharing:           (args)    => ipcRenderer.invoke('sharing:stop',  args || {}),
  resetSharing:          (args)    => ipcRenderer.invoke('sharing:reset', args || {}),
  getHotspot:            ()        => ipcRenderer.invoke('hotspot:get'),
  configureHotspot:      (args)    => ipcRenderer.invoke('hotspot:configure', args || {}),
  startHotspot:          ()        => ipcRenderer.invoke('hotspot:start'),
  stopHotspot:           ()        => ipcRenderer.invoke('hotspot:stop'),
  getSettings:           ()        => ipcRenderer.invoke('settings:get'),
  setSettings:           (partial) => ipcRenderer.invoke('settings:set', partial),
  // Pushes our current view of ICS state to the main process so the system
  // tray menu / tooltip can stay in sync.
  syncTrayState:         (snapshot) => ipcRenderer.invoke('tray:syncState', snapshot || {}),
  // Subscribes to tray-initiated actions (start last / stop / errors). The
  // renderer reacts by refreshing and surfacing toasts.
  onTrayAction:          (cb) => {
    const listener = (_evt, payload) => cb(payload);
    ipcRenderer.on('tray:action', listener);
    return () => ipcRenderer.removeListener('tray:action', listener);
  }
});
