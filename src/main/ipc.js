const { ipcMain } = require('electron');
const ics = require('./ics.js');
const hotspot = require('./hotspot.js');
const settings = require('./settings.js');
const tray = require('./tray.js');

function register(app) {
  ipcMain.handle('adapters:list', (_evt, args) => ics.listAdapters(args || {}));
  ipcMain.handle('adapter:properties', (_evt, args) => ics.openAdapterProperties(args || {}));
  ipcMain.handle('clients:list', (_evt, args) => ics.listClients(args || {}));

  ipcMain.handle('hotspot:get',       () => hotspot.getHotspot());
  ipcMain.handle('hotspot:configure', (_evt, args) => hotspot.configureHotspot(args || {}));
  ipcMain.handle('hotspot:start',     () => hotspot.startHotspot());
  ipcMain.handle('hotspot:stop',      () => hotspot.stopHotspot());

  ipcMain.handle('sharing:start', async (_evt, args) => {
    const result = await ics.startSharing(args || {});
    if (args && args.publicName && args.privateName) {
      tray.setLastPair({ publicName: args.publicName, privateName: args.privateName });
    }
    return result;
  });
  ipcMain.handle('sharing:stop',  (_evt, args) => ics.stopSharing(args || {}));

  ipcMain.handle('settings:get',  () => settings.load(app));
  ipcMain.handle('settings:set',  (_evt, partial) => settings.save(app, partial || {}));

  // Renderer pushes its current ICS-state view so the tray menu / tooltip stay
  // in sync. Fire-and-forget.
  ipcMain.handle('tray:syncState', (_evt, snapshot) => {
    tray.updateLiveState(snapshot || {});
    return true;
  });
}

module.exports = { register };
