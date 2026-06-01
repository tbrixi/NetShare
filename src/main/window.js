const { app, BrowserWindow, Menu, clipboard, screen } = require('electron');
const path = require('node:path');
const settings = require('./settings.js');

// Wide enough to roomily fit both adapter columns; tall enough to display
// most users' full adapter list without scrolling. Both are clamped at
// runtime to the available work area so the window never opens off-screen.
const PREFERRED_WIDTH  = 1000;
const PREFERRED_HEIGHT = 1080;
const SCREEN_MARGIN    = 60;

let mainWindow = null;

function getMainWindow() {
  return mainWindow;
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow();
    return mainWindow;
  }
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width  = Math.min(PREFERRED_WIDTH,  workArea.width  - SCREEN_MARGIN);
  const height = Math.min(PREFERRED_HEIGHT, workArea.height - SCREEN_MARGIN);

  const win = new BrowserWindow({
    width,
    height,
    minWidth: 760,
    minHeight: 560,
    center: true,
    title: 'NetShare — Windows ICS Manager',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    backgroundColor: '#1e1e23',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // With no application menu, the standard Edit-role accelerators (Copy /
  // Cut / Paste / Select All) aren't bound. Wire them by hand so users can
  // copy any selected text in the renderer.
  win.webContents.on('before-input-event', (_evt, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return;
    const k = input.key.toLowerCase();
    if (k === 'c') win.webContents.copy();
    else if (k === 'x') win.webContents.cut();
    else if (k === 'v') win.webContents.paste();
    else if (k === 'a') win.webContents.selectAll();
  });

  // Right-click → Copy / Select All. When text is selected the menu shows
  // Copy; otherwise it just offers Select All (no editable-field cases here).
  win.webContents.on('context-menu', (_evt, params) => {
    const items = [];
    if (params.selectionText) {
      items.push({ label: 'Copy', click: () => clipboard.writeText(params.selectionText) });
    }
    items.push({ label: 'Select All', click: () => win.webContents.selectAll() });
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Open DevTools only when explicitly requested via NETSHARE_DEVTOOLS=1
  // (set by `npm run dev`). `npm start` and packaged builds leave it closed.
  if (!app.isPackaged && process.env.NETSHARE_DEVTOOLS === '1') {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  // Close button hides the window into the tray when minimizeToTray is on
  // and we are not actually quitting. Real quits go through tray menu →
  // app.quit() (app.isQuitting flag) or "Quit NetShare" from File menu.
  win.on('close', (e) => {
    if (app.isQuitting) return;
    if (settings.load(app).minimizeToTray !== false) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => { mainWindow = null; });
  mainWindow = win;
  return win;
}

module.exports = { createMainWindow, getMainWindow, focusMainWindow };
