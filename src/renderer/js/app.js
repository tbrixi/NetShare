// Orchestrator: wires views together, runs the refresh loop, decides what
// status messages to surface based on detected ICS state transitions.

import { api } from './api.js';
import { state } from './state.js';
import * as statusBar     from './views/statusBar.js';
import * as toast         from './views/toast.js';
import * as adapterColumn from './views/adapterColumn.js';
import * as footer        from './views/footer.js';
import * as optionsModal  from './views/optionsModal.js';
import * as consolePanel  from './views/consolePanel.js';
import * as clientsPanel  from './views/clientsPanel.js';
import * as hotspotModal  from './views/hotspotModal.js';

const views = {};
let refreshTimer = null;
let chartTimer = null;

// How many byte/sec samples each adapter's traffic chart retains.
const TRAFFIC_HISTORY_MAX = 40;

function chartEnabled() {
  return (state.settings?.chartIntervalSec ?? 0) > 0;
}

// Surfaces a message in both the transient toast and the persistent activity
// log. Use `log(msg, kind)` for log-only entries (e.g. status transitions).
function notify(msg, kind = '') {
  views.toast.show(msg, kind);
  views.consolePanel.log(msg, kind);
}
function log(msg, kind = '') {
  views.consolePanel.log(msg, kind);
}

function renderAll() {
  views.publicColumn.render();
  views.privateColumn.render();
  views.footer.render();
}

// Stamps SharingEnabled / SharingConnectionType on each adapter from the
// resolved active pair, so the ICS Source / Target pills stay consistent even
// on the high-frequency traffic poll (which does not run full reconciliation).
function annotateSharingRoles(adapters) {
  for (const a of adapters) {
    const isSrc = state.sharingActive && a.Name === state.activePublic;
    const isTgt = state.sharingActive && a.Name === state.activePrivate;
    a.SharingEnabled = isSrc || isTgt;
    a.SharingConnectionType = isSrc ? 0 : isTgt ? 1 : -1;
  }
}

// Compares the latest live ICS state with the previous snapshot and decides
// whether to follow the change in the on-screen toggles + raise a toast.
function reconcileWithLiveState() {
  const live = state.adapters;

  // Target (private) = the adapter holding the ICS gateway IP; list-adapters.ps1
  // detects this reliably. Source (public) detection is unreliable for VPN-
  // tunnel uplinks that carry no default-gateway route, so when the app itself
  // enabled sharing we fall back to the pair it recorded (state.activeShare).
  let sourceName = state.detectedSource;
  let targetName = state.detectedTarget;

  const known = state.activeShare;
  if (known && state.serviceRunning && (!targetName || targetName === known.target)) {
    if (!targetName) targetName = known.target;
    if (!sourceName) sourceName = known.source;
  }

  // ICS is active whenever its service runs and a gateway-holding target
  // exists — this no longer depends on identifying the source.
  const sharingActive = !!(state.serviceRunning && targetName);

  const prevPub    = state.activePublic;
  const prevPriv   = state.activePrivate;
  const prevActive = state.sharingActive;

  state.activePublic  = sharingActive ? (sourceName || null) : null;
  state.activePrivate = sharingActive ? (targetName || null) : null;
  state.sharingActive = sharingActive;
  annotateSharingRoles(live);

  const externalChange = state.initialDetectDone
    && (state.activePublic !== prevPub || state.activePrivate !== prevPriv);

  if (!state.initialDetectDone) {
    if (state.activePublic)  state.selectedPublic  = state.activePublic;
    if (state.activePrivate) state.selectedPrivate = state.activePrivate;
  } else if (externalChange) {
    const userHadNotDiverged =
      state.selectedPublic === prevPub && state.selectedPrivate === prevPriv;
    if (userHadNotDiverged || (!state.selectedPublic && !state.selectedPrivate)) {
      state.selectedPublic  = state.activePublic;
      state.selectedPrivate = state.activePrivate;
    }
    if (state.sharingActive && !prevActive) {
      notify(`ICS active: ${state.activePublic || 'unknown source'} → ${state.activePrivate}`, 'success');
    } else if (!state.sharingActive && prevActive) {
      notify('ICS is no longer active', 'success');
    } else if (state.sharingActive) {
      notify(`ICS reconfigured: ${state.activePublic || 'unknown source'} → ${state.activePrivate}`, 'success');
    }
  }

  const scopeNote = state.scopeAddress ? ` (gateway ${state.scopeAddress})` : '';

  if (state.sharingActive) {
    views.statusBar.set(
      `Sharing ACTIVE — ${state.activePublic || 'unknown source'} → ${state.activePrivate}`,
      `Internet Connection Sharing is currently enabled${scopeNote}.`,
      'active'
    );
  } else if (sourceName || targetName) {
    const half = targetName || sourceName;
    const role = targetName ? 'target' : 'source';
    views.statusBar.set(
      `Sharing partially configured — ${half} flagged as ${role}`,
      'Pick the other side and start, or stop to clear the state.',
      'working'
    );
  } else {
    views.statusBar.set(
      'Idle — no sharing active',
      `Select an internet source on the left and a target adapter on the right${scopeNote}.`,
      'idle'
    );
  }

  state.initialDetectDone = true;
}

async function refresh() {
  if (state.busy) return;
  try {
    const payload = await api.listAdapters({
      showDisconnected: state.settings?.showDisconnected ?? false
    });
    annotateWithRates(payload.adapters, payload.sampledAtMs);
    if (chartEnabled()) recordTrafficSample(payload.adapters);
    state.adapters       = payload.adapters;
    state.detectedSource = payload.sourceName;
    state.detectedTarget = payload.targetName;
    state.serviceRunning = payload.serviceRunning;
    state.scopeAddress   = payload.scopeAddress;
    reconcileWithLiveState();
    renderAll();

    // Push state to the system tray so its menu / tooltip mirror reality.
    api.syncTrayState({
      sharingActive: state.sharingActive,
      sourceName:    state.activePublic,
      targetName:    state.activePrivate
    });

    // Pull connected clients in the background (no need to block on this).
    if (state.sharingActive && state.activePrivate && state.scopeAddress) {
      refreshClients();
    } else {
      state.clients = [];
      views.clientsPanel.setVisible(false);
      views.clientsPanel.render([]);
    }
  } catch (err) {
    views.statusBar.set('Failed to list adapters', err.message, 'error');
    notify('Adapter list failed: ' + err.message, 'error');
  }
}

async function refreshClients() {
  if (state.clientsLoading) return;
  if (!state.activePrivate || !state.scopeAddress) return;
  state.clientsLoading = true;
  try {
    state.clients = await api.listClients({
      targetAdapter: state.activePrivate,
      gatewayIp:     state.scopeAddress
    });
    views.clientsPanel.setVisible(true);
    views.clientsPanel.render(state.clients);
  } catch (err) {
    log('Client list failed: ' + err.message, 'error');
  } finally {
    state.clientsLoading = false;
  }
}

// Compares this poll's cumulative byte counters against the previous snapshot
// and writes per-second rates onto each adapter record. Counters can reset
// (adapter restart, interface re-enabled) — a negative delta is treated as
// "rate unknown" rather than producing a giant negative number.
function annotateWithRates(adapters, sampledAtMs) {
  const prev = state.prevSample;
  const nowMs = sampledAtMs || Date.now();
  const next = { ts: nowMs, perAdapter: {} };

  for (const a of adapters) {
    const sent = Number(a.BytesSent || 0);
    const recv = Number(a.BytesReceived || 0);
    next.perAdapter[a.Name] = { sent, received: recv };

    let rateUp = null;
    let rateDown = null;
    if (prev && prev.perAdapter[a.Name] && nowMs > prev.ts) {
      const p = prev.perAdapter[a.Name];
      const dt = (nowMs - prev.ts) / 1000;
      const dSent = sent - p.sent;
      const dRecv = recv - p.received;
      if (dSent >= 0 && dRecv >= 0 && dt > 0) {
        rateUp   = dSent / dt;
        rateDown = dRecv / dt;
      }
    }
    a.RateUpBytesPerSec   = rateUp;
    a.RateDownBytesPerSec = rateDown;
  }
  state.prevSample = next;
}

// Appends the latest per-second rates to each adapter's rolling chart buffer
// and discards buffers for adapters that have gone away. Adapters whose rate
// is not yet known (first poll) are skipped so the chart never plots a guess.
function recordTrafficSample(adapters) {
  const hist = state.trafficHistory;
  const live = new Set();
  for (const a of adapters) {
    live.add(a.Name);
    if (a.RateDownBytesPerSec == null) continue;
    const buf = hist[a.Name] || (hist[a.Name] = []);
    buf.push({
      down: Math.max(0, a.RateDownBytesPerSec || 0),
      up:   Math.max(0, a.RateUpBytesPerSec   || 0)
    });
    if (buf.length > TRAFFIC_HISTORY_MAX) buf.splice(0, buf.length - TRAFFIC_HISTORY_MAX);
  }
  for (const name of Object.keys(hist)) {
    if (!live.has(name)) delete hist[name];
  }
}

// High-frequency poll dedicated to the traffic charts. Unlike refresh() it
// skips ICS reconciliation, tray sync and client probing — it only needs
// fresh byte counters to extend each adapter's history buffer and redraw.
async function pollTraffic() {
  if (state.busy || !chartEnabled()) return;
  try {
    const payload = await api.listAdapters({
      showDisconnected: state.settings?.showDisconnected ?? false
    });
    annotateWithRates(payload.adapters, payload.sampledAtMs);
    recordTrafficSample(payload.adapters);
    state.adapters = payload.adapters;
    annotateSharingRoles(state.adapters);
    renderAll();
  } catch (err) {
    log('Traffic poll failed: ' + err.message, 'error');
  }
}

async function startSharing() {
  if (!state.selectedPublic || !state.selectedPrivate) return;
  if (state.selectedPublic === state.selectedPrivate) {
    notify('Source and target must be different', 'error');
    return;
  }
  state.busy = true;
  renderAll();
  const label = `${state.selectedPublic} → ${state.selectedPrivate}`;
  views.statusBar.set('Starting ICS…', label, 'working');
  log(`Starting ICS: ${label}`, 'working');
  try {
    const out = await api.startSharing({
      publicName:  state.selectedPublic,
      privateName: state.selectedPrivate,
      elevate:     state.settings.elevateOnToggle
    });
    // Record the live pair so reconcile can resolve the source even when the
    // unprivileged poll can't (VPN-tunnel uplinks have no default-gateway route).
    state.activeShare = { source: state.selectedPublic, target: state.selectedPrivate };
    notify(`Internet Connection Sharing enabled (${out || 'ok'})`, 'success');
  } catch (err) {
    views.statusBar.set('Failed to start sharing', err.message, 'error');
    notify('Start failed: ' + err.message, 'error');
  } finally {
    state.busy = false;
    await refresh();
  }
}

async function stopSharing() {
  state.busy = true;
  renderAll();
  views.statusBar.set('Stopping ICS…', '', 'working');
  log('Stopping ICS…', 'working');
  try {
    const out = await api.stopSharing({ elevate: state.settings.elevateOnToggle });
    state.activeShare = null;
    notify(`Sharing stopped (${out})`, 'success');
  } catch (err) {
    views.statusBar.set('Failed to stop sharing', err.message, 'error');
    notify('Stop failed: ' + err.message, 'error');
  } finally {
    state.busy = false;
    await refresh();
  }
}

// Enables or disables an adapter — the elevated equivalent of the Windows
// Network Connections Enable/Disable command. Mirrors start/stopSharing:
// blocks the UI while the privileged script runs, then refreshes.
async function toggleAdapter(name, enabled) {
  if (state.busy) return;
  state.busy = true;
  renderAll();
  const verb = enabled ? 'Enabling' : 'Disabling';
  views.statusBar.set(`${verb} ${name}…`, 'Applying the adapter state change.', 'working');
  log(`${verb} adapter ${name}…`, 'working');
  try {
    await api.setAdapterState({ adapterName: name, enabled });
    notify(`Adapter ${name} ${enabled ? 'enabled' : 'disabled'}`, 'success');
  } catch (err) {
    notify(`Failed to ${enabled ? 'enable' : 'disable'} ${name}: ${err.message}`, 'error');
  } finally {
    state.busy = false;
    await refresh();
  }
}

// Recovers from a stuck ICS state — disables all sharing, drops stranded
// 192.168.137.x gateway IPs left on dead Wi-Fi Direct adapters, and restarts
// the ICS service. Elevated; mirrors start/stopSharing's busy + refresh flow.
async function resetSharing() {
  if (state.busy) return;
  state.busy = true;
  renderAll();
  views.statusBar.set('Resetting ICS…', 'Clearing stale sharing state.', 'working');
  log('Resetting ICS — disabling all sharing, clearing stale gateway IPs…', 'working');
  try {
    const out = await api.resetSharing({ elevate: true });
    state.activeShare = null;
    notify(`ICS reset (${out || 'ok'})`, 'success');
  } catch (err) {
    views.statusBar.set('Failed to reset ICS', err.message, 'error');
    notify('Reset failed: ' + err.message, 'error');
  } finally {
    state.busy = false;
    await refresh();
  }
}

function scheduleAutoRefresh() {
  clearInterval(refreshTimer);
  const sec = state.settings?.refreshIntervalSec ?? 0;
  if (sec > 0) refreshTimer = setInterval(refresh, sec * 1000);
}

// Drives the per-adapter traffic charts. An interval of 0 disables the chart
// entirely — the timer is cleared and accumulated history dropped so the
// cards re-render without a chart.
function scheduleChartRefresh() {
  clearInterval(chartTimer);
  chartTimer = null;
  const sec = state.settings?.chartIntervalSec ?? 0;
  if (sec > 0) {
    chartTimer = setInterval(pollTraffic, sec * 1000);
  } else {
    state.trafficHistory = {};
  }
}

async function saveOptions(updated) {
  state.settings = await api.setSettings(updated);
  scheduleAutoRefresh();
  scheduleChartRefresh();
  views.consolePanel.setVisible(state.settings.showConsole !== false);
  notify('Settings saved', 'success');
  await refresh();
}

async function init() {
  views.statusBar    = statusBar.mount(document.getElementById('status-bar'));
  views.toast        = toast.mount(document.getElementById('toast'));
  views.consolePanel = consolePanel.mount(document.getElementById('console-panel'));
  views.clientsPanel = clientsPanel.mount(document.getElementById('clients-panel'), {
    onRefresh: refreshClients
  });

  // Tray-initiated start/stop arrive here so we can refresh + toast.
  api.onTrayAction((action) => {
    if (!action) return;
    if (action.type === 'started') {
      state.activeShare = { source: action.pair.publicName, target: action.pair.privateName };
      notify(`Sharing started from tray: ${action.pair.publicName} → ${action.pair.privateName}`, 'success');
      refresh();
    } else if (action.type === 'stopped') {
      state.activeShare = null;
      notify('Sharing stopped from tray', 'success');
      refresh();
    } else if (action.type === 'error') {
      notify('Tray action failed: ' + action.message, 'error');
    }
  });

  const onPropertiesError = (msg) => notify(`Properties failed: ${msg}`, 'error');
  const onPropertiesInfo  = (msg) => notify(msg, 'success');

  views.publicColumn = adapterColumn.mount(document.getElementById('list-public'), {
    role: 'public',
    getState: () => state,
    onToggle: (name) => {
      state.selectedPublic = state.selectedPublic === name ? null : name;
      renderAll();
    },
    onSetState: toggleAdapter,
    onError: onPropertiesError,
    onInfo: onPropertiesInfo
  });

  views.privateColumn = adapterColumn.mount(document.getElementById('list-private'), {
    role: 'private',
    getState: () => state,
    onToggle: (name) => {
      state.selectedPrivate = state.selectedPrivate === name ? null : name;
      renderAll();
    },
    onSetState: toggleAdapter,
    onError: onPropertiesError,
    onInfo: onPropertiesInfo
  });

  views.footer = footer.mount(document.querySelector('.app-footer'), {
    getState: () => state,
    onStart:  startSharing,
    onStop:   stopSharing,
    onReset:  resetSharing
  });

  views.options = optionsModal.mount(document.getElementById('options-overlay'), {
    onSave: saveOptions
  });

  views.hotspot = hotspotModal.mount(document.getElementById('hotspot-overlay'), {
    onInfo:  (msg) => notify(msg, 'success'),
    onError: (msg) => notify(msg, 'error')
  });

  const sortPublic = document.getElementById('sort-public');
  sortPublic.value = state.sourceSort;
  sortPublic.addEventListener('change', () => {
    state.sourceSort = sortPublic.value;
    views.publicColumn.render();
  });

  document.getElementById('btn-refresh').addEventListener('click', refresh);
  document.getElementById('btn-options').addEventListener('click', () => views.options.open(state.settings));
  document.getElementById('btn-hotspot').addEventListener('click', () => views.hotspot.open());

  state.settings = await api.getSettings();
  // Carry a previously recorded ICS pair across restarts so the source is
  // known even if the app was closed while sharing was active.
  state.activeShare = state.settings.activeShare || null;
  views.consolePanel.setVisible(state.settings.showConsole !== false);
  views.statusBar.set('Detecting current state…', 'Reading network adapters and ICS configuration.', 'working');
  log('Detecting current ICS state…', 'working');
  await refresh();
  scheduleAutoRefresh();
  scheduleChartRefresh();
}

init();
