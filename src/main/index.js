const { app, BrowserWindow } = require('electron');
const { createMainWindow, focusMainWindow } = require('./window.js');
const ipc = require('./ipc.js');
const tray = require('./tray.js');

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

  // With a tray icon, hiding the window is not the same as quitting; we only
  // exit the app when the user explicitly chose "Quit" (sets isQuitting).
  app.on('window-all-closed', () => {
    if (app.isQuitting && process.platform !== 'darwin') app.quit();
  });
}
