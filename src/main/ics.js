const path = require('node:path');
const { runScript } = require('./powershell.js');

// In a packaged build the .ps1 files live in app.asar.unpacked (see build
// config's `asarUnpack`) because PowerShell cannot read into an asar archive.
// In dev `__dirname` has no `app.asar` in it, so the replace is a no-op.
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const LIST_SCRIPT    = path.join(SCRIPTS_DIR, 'list-adapters.ps1');
const STOP_SCRIPT    = path.join(SCRIPTS_DIR, 'stop-sharing.ps1');
const SET_SCRIPT     = path.join(SCRIPTS_DIR, 'set-sharing.ps1');
const PROPS_SCRIPT   = path.join(SCRIPTS_DIR, 'open-adapter-properties.ps1');
const CLIENTS_SCRIPT = path.join(SCRIPTS_DIR, 'list-clients.ps1');
const STATE_SCRIPT   = path.join(SCRIPTS_DIR, 'set-adapter-state.ps1');
const RESET_SCRIPT   = path.join(SCRIPTS_DIR, 'reset-sharing.ps1');

async function listAdapters({ showDisconnected = false } = {}) {
  const { stdout } = await runScript(LIST_SCRIPT);
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { adapters: [], sourceName: null, targetName: null, serviceRunning: false, scopeAddress: null };
  }
  const payload = JSON.parse(trimmed);
  let adapters = Array.isArray(payload.Adapters)
    ? payload.Adapters
    : (payload.Adapters ? [payload.Adapters] : []);
  if (!showDisconnected) {
    // Disabled adapters are always kept so their enable toggle stays reachable.
    adapters = adapters.filter(a =>
      a.Status === 'Up' || a.Status === 'Disabled' || a.SharingEnabled);
  }
  return {
    adapters,
    sourceName:     payload.SourceName || null,
    targetName:     payload.TargetName || null,
    serviceRunning: !!payload.ServiceRunning,
    scopeAddress:   payload.ScopeAddress || null,
    sampledAtMs:    payload.SampledAtMs || Date.now()
  };
}

async function startSharing({ publicName, privateName, elevate = true }) {
  if (!publicName || !privateName) throw new Error('Both adapters must be selected');
  if (publicName === privateName) throw new Error('Source and target must be different adapters');
  const { stdout } = await runScript(
    SET_SCRIPT,
    ['-PublicName', publicName, '-PrivateName', privateName],
    { elevate }
  );
  return stdout.trim();
}

async function stopSharing({ elevate = true } = {}) {
  const { stdout } = await runScript(STOP_SCRIPT, [], { elevate });
  return stdout.trim();
}

async function openAdapterProperties({ adapterName }) {
  if (!adapterName) throw new Error('Adapter name required');
  // Runs unelevated — the system properties dialog itself handles UAC if any
  // setting needs admin (TCP/IP changes, driver settings, etc.).
  await runScript(PROPS_SCRIPT, ['-AdapterName', adapterName]);
  return true;
}

async function listClients({ targetAdapter, gatewayIp }) {
  if (!targetAdapter || !gatewayIp) return [];
  const { stdout } = await runScript(CLIENTS_SCRIPT, [
    '-TargetAdapter', targetAdapter,
    '-GatewayIP',     gatewayIp
  ]);
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}

// Enables or disables an adapter (Enable-/Disable-NetAdapter). Always elevated
// — the cmdlets require Administrator, the same as the Windows control panel.
async function setAdapterState({ adapterName, enabled }) {
  if (!adapterName) throw new Error('Adapter name required');
  const { stdout } = await runScript(
    STATE_SCRIPT,
    ['-AdapterName', adapterName, '-Action', enabled ? 'Enable' : 'Disable'],
    { elevate: true }
  );
  return stdout.trim();
}

// Resets ICS to a clean slate (disable all sharing, drop stranded gateway IPs,
// restart the ICS service). Always elevated. Recovers from a stuck state where
// 192.168.137.1 is stranded on a leftover Wi-Fi Direct virtual adapter.
async function resetSharing({ elevate = true } = {}) {
  const { stdout } = await runScript(RESET_SCRIPT, [], { elevate });
  return stdout.trim();
}

module.exports = {
  listAdapters, startSharing, stopSharing, openAdapterProperties, listClients,
  setAdapterState, resetSharing
};
