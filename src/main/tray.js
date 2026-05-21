const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');
const ics = require('./ics.js');
const settings = require('./settings.js');
const { getMainWindow, focusMainWindow, createMainWindow } = require('./window.js');

let tray = null;
let liveState = {
  sharingActive: false,
  sourceName: null,
  targetName: null
};
let lastPair = null;

function init() {
  const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.ico');
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('NetShare');
  tray.on('click', toggleWindow);

  // Restore the last-used adapter pair from settings so the "Start last"
  // shortcut survives across app restarts.
  lastPair = settings.load(app).lastPair || null;
  rebuildMenu();
}

function toggleWindow() {
  const win = getMainWindow();
  if (!win) {
    createMainWindow();
    return;
  }
  if (win.isVisible() && !win.isMinimized()) {
    win.hide();
  } else {
    focusMainWindow();
  }
}

// Renderer pushes its current view of the live state here after each refresh.
function updateLiveState(snapshot) {
  liveState = { ...liveState, ...snapshot };
  if (!tray) return;
  if (liveState.sharingActive) {
    tray.setToolTip(`NetShare — Sharing ${liveState.sourceName} → ${liveState.targetName}`);
  } else {
    tray.setToolTip('NetShare — Idle');
  }
  rebuildMenu();
}

function setLastPair(pair) {
  if (!pair || !pair.publicName || !pair.privateName) return;
  lastPair = pair;
  settings.save(app, { lastPair: pair });
  rebuildMenu();
}

function notifyRenderer(channel, payload) {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

async function trayStartLast() {
  if (!lastPair) return;
  try {
    await ics.startSharing({ ...lastPair, elevate: true });
    settings.save(app, { activeShare: { source: lastPair.publicName, target: lastPair.privateName } });
    notifyRenderer('tray:action', { type: 'started', pair: lastPair });
  } catch (err) {
    notifyRenderer('tray:action', { type: 'error', message: err.message });
  }
}

async function trayStop() {
  try {
    await ics.stopSharing({ elevate: true });
    settings.save(app, { activeShare: null });
    notifyRenderer('tray:action', { type: 'stopped' });
  } catch (err) {
    notifyRenderer('tray:action', { type: 'error', message: err.message });
  }
}

function rebuildMenu() {
  if (!tray) return;
  const win = getMainWindow();
  const visible = win && win.isVisible() && !win.isMinimized();

  const statusLabel = liveState.sharingActive
    ? `Sharing: ${liveState.sourceName} → ${liveState.targetName}`
    : 'Sharing: off';

  const items = [
    { label: statusLabel, enabled: false },
    { type: 'separator' }
  ];

  if (lastPair && !liveState.sharingActive) {
    items.push({
      label: `Start last (${lastPair.publicName} → ${lastPair.privateName})`,
      click: () => { trayStartLast(); }
    });
  }
  if (liveState.sharingActive) {
    items.push({ label: 'Stop sharing', click: () => { trayStop(); } });
  }

  items.push(
    { type: 'separator' },
    { label: visible ? 'Hide window' : 'Show window', click: toggleWindow },
    { type: 'separator' },
    {
      label: 'Quit NetShare',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  );

  tray.setContextMenu(Menu.buildFromTemplate(items));
}

module.exports = { init, updateLiveState, setLastPair, rebuildMenu };
