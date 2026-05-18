const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTINGS = {
  refreshIntervalSec: 60,
  showDisconnected: false,
  elevateOnToggle: true,
  showConsole: true,
  minimizeToTray: true,
  lastPair: null
};

function settingsPath(app) {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load(app) {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath(app), 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function save(app, partial) {
  const merged = { ...DEFAULT_SETTINGS, ...load(app), ...partial };
  const p = settingsPath(app);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

module.exports = { DEFAULT_SETTINGS, load, save };
