// Mobile Hotspot operations — thin wrappers around the four hotspot-*.ps1
// scripts. The WinRT API is callable as a standard user, so no elevation
// is needed for any of these.

const path = require('node:path');
const { runScript } = require('./powershell.js');

const SCRIPTS_DIR = path
  .join(__dirname, '..', 'scripts')
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

const GET_SCRIPT      = path.join(SCRIPTS_DIR, 'hotspot-get.ps1');
const SET_SCRIPT      = path.join(SCRIPTS_DIR, 'hotspot-set.ps1');
const START_SCRIPT    = path.join(SCRIPTS_DIR, 'hotspot-start.ps1');
const STOP_SCRIPT     = path.join(SCRIPTS_DIR, 'hotspot-stop.ps1');
const RADIO_ON_SCRIPT = path.join(SCRIPTS_DIR, 'wifi-radio-on.ps1');

async function getHotspot() {
  const { stdout } = await runScript(GET_SCRIPT);
  const trimmed = stdout.trim();
  if (!trimmed) return { available: false, error: 'Empty response' };
  return JSON.parse(trimmed);
}

async function configureHotspot({ ssid, passphrase, band }) {
  if (!ssid)               throw new Error('SSID is required');
  if (!passphrase || passphrase.length < 8) {
    throw new Error('Passphrase must be at least 8 characters');
  }
  const allowed = new Set(['Auto', 'TwoPointFourGigahertz', 'FiveGigahertz']);
  const bandValue = allowed.has(band) ? band : 'Auto';
  const { stdout } = await runScript(SET_SCRIPT, [
    '-Ssid',       ssid,
    '-Passphrase', passphrase,
    '-Band',       bandValue
  ]);
  return stdout.trim();
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startHotspot() {
  // The hotspot broadcasts via the Wi-Fi adapter, so its radio must be on —
  // otherwise StartTetheringAsync fails with WiFiDeviceOff. Turn it on (a
  // no-op if already on), then start tethering, retrying while the Wi-Fi
  // device is still coming up: it reports WiFiDeviceOff / InTransition for a
  // few seconds after the radio switches on. Other errors fail immediately.
  await runScript(RADIO_ON_SCRIPT);

  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    await delay(attempt === 1 ? 1500 : 2500);
    try {
      const { stdout } = await runScript(START_SCRIPT);
      return stdout.trim();
    } catch (err) {
      lastErr = err;
      if (!/WiFiDeviceOff|InTransition/i.test(err.message)) throw err;
    }
  }
  throw lastErr;
}

async function stopHotspot() {
  const { stdout } = await runScript(STOP_SCRIPT);
  return stdout.trim();
}

module.exports = { getHotspot, configureHotspot, startHotspot, stopHotspot };
