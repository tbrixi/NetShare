const { app, BrowserWindow } = require('electron');
const { createMainWindow, focusMainWindow } = require('./window.js');
const ipc = require('./ipc.js');
const tray = require('./tray.js');
const settings = require('./settings.js');

app.isQuitting = false;

// Reject second launches — focus the existing window instead of opening a new one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => focusMainWindow());

  app.whenReady().then(() => {
    ipc.register(app);
    tray.init();
    createMainWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('before-quit', () => { app.isQuitting = true; });

  // With a tray icon, hiding the window is not the same as quitting. When
  // minimizeToTray is on, the close button hides the window (handled in
  // window.js) so this event doesn't fire. When it's off, the window is
  // actually destroyed — quit the app so the tray process doesn't linger.
  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') return;
    if (app.isQuitting || settings.load(app).minimizeToTray === false) app.quit();
  });
}
