const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTINGS = {
  refreshIntervalSec: 60,
  chartIntervalSec: 5,
  showDisconnected: false,
  elevateOnToggle: true,
  showConsole: true,
  minimizeToTray: true,
  lastPair: null,
  // The ICS pair this app last enabled ({ source, target }), or null. Used to
  // identify the source when the unprivileged poll can't (e.g. VPN-tunnel
  // uplinks that carry no default-gateway route). Cleared when sharing stops.
  activeShare: null,
  // User-saved Source/Target pairs: [{ id, name, source, target }]. Selected
  // from the footer dropdown; lastProfileId is restored on app start.
  profiles: [],
  lastProfileId: null
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
