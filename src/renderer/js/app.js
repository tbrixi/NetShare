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

// Compares the latest live ICS state with the previous snapshot and decides
// whether to follow the change in the on-screen toggles + raise a toast.
function reconcileWithLiveState() {
  const live = state.adapters;
  const pub  = live.find(a => a.SharingEnabled && a.SharingConnectionType === 0);
  const priv = live.find(a => a.SharingEnabled && a.SharingConnectionType === 1);

  const prevPub    = state.activePublic;
  const prevPriv   = state.activePrivate;
  const prevActive = state.sharingActive;

  state.activePublic  = pub  ? pub.Name  : null;
  state.activePrivate = priv ? priv.Name : null;
  state.sharingActive = !!(pub && priv);

  const externalChange = state.initialDetectDone
    && (state.activePublic !== prevPub || state.activePrivate !== prevPriv);

  if (!state.initialDetectDone) {
    if (state.sharingActive) {
      state.selectedPublic  = pub.Name;
      state.selectedPrivate = priv.Name;
    } else if (pub || priv) {
      if (pub)  state.selectedPublic  = pub.Name;
      if (priv) state.selectedPrivate = priv.Name;
    }
  } else if (externalChange) {
    const userHadNotDiverged =
      state.selectedPublic === prevPub && state.selectedPrivate === prevPriv;
    if (userHadNotDiverged || (!state.selectedPublic && !state.selectedPrivate)) {
      state.selectedPublic  = state.activePublic;
      state.selectedPrivate = state.activePrivate;
    }
    if (state.sharingActive && !prevActive) {
      notify(`ICS enabled externally: ${state.activePublic} → ${state.activePrivate}`, 'success');
    } else if (!state.sharingActive && prevActive) {
      notify('ICS was disabled outside the app', 'success');
    } else if (state.sharingActive) {
      notify(`ICS reconfigured externally: ${state.activePublic} → ${state.activePrivate}`, 'success');
    }
  }

  const scopeNote = state.scopeAddress ? ` (gateway ${state.scopeAddress})` : '';

  if (state.sharingActive) {
    views.statusBar.set(
      `Sharing ACTIVE — ${pub.Name} → ${priv.Name}`,
      `Internet Connection Sharing is currently enabled${scopeNote}.`,
      'active'
    );
  } else if (pub || priv) {
    const half = pub || priv;
    const role = pub ? 'source' : 'target';
    views.statusBar.set(
      `Sharing partially configured — ${half.Name} flagged as ${role}`,
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
    notify(`Sharing stopped (${out})`, 'success');
  } catch (err) {
    views.statusBar.set('Failed to stop sharing', err.message, 'error');
    notify('Stop failed: ' + err.message, 'error');
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

async function saveOptions(updated) {
  state.settings = await api.setSettings(updated);
  scheduleAutoRefresh();
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
      notify(`Sharing started from tray: ${action.pair.publicName} → ${action.pair.privateName}`, 'success');
      refresh();
    } else if (action.type === 'stopped') {
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
    onError: onPropertiesError,
    onInfo: onPropertiesInfo
  });

  views.footer = footer.mount(document.querySelector('.app-footer'), {
    getState: () => state,
    onStart:  startSharing,
    onStop:   stopSharing
  });

  views.options = optionsModal.mount(document.getElementById('options-overlay'), {
    onSave: saveOptions
  });

  views.hotspot = hotspotModal.mount(document.getElementById('hotspot-overlay'), {
    onInfo:  (msg) => notify(msg, 'success'),
    onError: (msg) => notify(msg, 'error')
  });

  document.getElementById('btn-refresh').addEventListener('click', refresh);
  document.getElementById('btn-options').addEventListener('click', () => views.options.open(state.settings));
  document.getElementById('btn-hotspot').addEventListener('click', () => views.hotspot.open());

  state.settings = await api.getSettings();
  views.consolePanel.setVisible(state.settings.showConsole !== false);
  views.statusBar.set('Detecting current state…', 'Reading network adapters and ICS configuration.', 'working');
  log('Detecting current ICS state…', 'working');
  await refresh();
  scheduleAutoRefresh();
}

init();
