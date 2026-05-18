const { app, BrowserWindow, Menu, screen } = require('electron');
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

  // Auto-open DevTools when running from source / `npm run dev` — packaged
  // builds (app.isPackaged) keep DevTools closed.
  if (!app.isPackaged) {
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
