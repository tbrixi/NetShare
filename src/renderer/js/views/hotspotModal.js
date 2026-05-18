// Mobile Hotspot configuration & control modal. Polls the underlying WinRT
// state every 5 s while open so SSID / passphrase / band / client count stay
// in sync with whatever Windows reports.

import { api } from '../api.js';

const BAND_VALUES = new Set(['Auto', 'TwoPointFourGigahertz', 'FiveGigahertz']);

export function mount(overlayEl, { onInfo, onError } = {}) {
  const stateBadge   = overlayEl.querySelector('#hotspot-state');
  const connName     = overlayEl.querySelector('#hotspot-conn');
  const ssidInput    = overlayEl.querySelector('#hotspot-ssid');
  const passInput    = overlayEl.querySelector('#hotspot-pass');
  const passToggle   = overlayEl.querySelector('#btn-hotspot-pass-toggle');
  const bandRadios   = overlayEl.querySelectorAll('input[name="hotspot-band"]');
  const clientsCell  = overlayEl.querySelector('#hotspot-clients');
  const maxCell      = overlayEl.querySelector('#hotspot-max');
  const closeBtn     = overlayEl.querySelector('#btn-hotspot-close');
  const cancelBtn    = overlayEl.querySelector('#btn-hotspot-cancel');
  const applyBtn     = overlayEl.querySelector('#btn-hotspot-apply');
  const toggleBtn    = overlayEl.querySelector('#btn-hotspot-toggle');

  let pollTimer = null;
  let currentState = null;

  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlayEl.classList.contains('hidden')) close();
  });

  passToggle.addEventListener('click', () => {
    const showing = passInput.type === 'text';
    passInput.type = showing ? 'password' : 'text';
    passToggle.textContent = showing ? 'Show' : 'Hide';
  });

  applyBtn.addEventListener('click', async () => {
    const args = readFormFields();
    applyBtn.disabled = true;
    try {
      await api.configureHotspot(args);
      if (onInfo) onInfo(`Hotspot configured: ${args.ssid} (${prettyBand(args.band)})`);
      await refresh();
    } catch (err) {
      if (onError) onError('Configure failed: ' + err.message);
    } finally {
      applyBtn.disabled = false;
    }
  });

  toggleBtn.addEventListener('click', async () => {
    toggleBtn.disabled = true;
    const wasOn = currentState && currentState.State === 'On';
    try {
      if (!wasOn) {
        // Apply latest form values first so Start sees the user's intent.
        const args = readFormFields();
        if (hasConfigDrift(args)) await api.configureHotspot(args);
        await api.startHotspot();
        if (onInfo) onInfo(`Hotspot started: ${args.ssid} (${prettyBand(args.band)})`);
      } else {
        await api.stopHotspot();
        if (onInfo) onInfo('Hotspot stopped');
      }
      await refresh();
    } catch (err) {
      if (onError) onError((wasOn ? 'Stop' : 'Start') + ' hotspot failed: ' + err.message);
    } finally {
      toggleBtn.disabled = false;
    }
  });

  function readFormFields() {
    const ssid = ssidInput.value.trim();
    const passphrase = passInput.value;
    const checked = Array.from(bandRadios).find((r) => r.checked);
    const band = checked && BAND_VALUES.has(checked.value) ? checked.value : 'Auto';
    return { ssid, passphrase, band };
  }

  function hasConfigDrift({ ssid, passphrase, band }) {
    if (!currentState) return true;
    return ssid !== currentState.Ssid
        || passphrase !== currentState.Passphrase
        || band !== currentState.Band;
  }

  function prettyBand(b) {
    return b === 'TwoPointFourGigahertz' ? '2.4 GHz'
         : b === 'FiveGigahertz'         ? '5 GHz'
         : 'Auto';
  }

  function setStatePill(state) {
    const cls = state === 'On' ? 'on' : state === 'InTransition' ? 'transition' : 'off';
    stateBadge.className = `hotspot-state-pill ${cls}`;
    stateBadge.textContent = state || 'Unknown';
  }

  async function refresh() {
    let data;
    try {
      data = await api.getHotspot();
    } catch (err) {
      if (onError) onError('Failed to read hotspot state: ' + err.message);
      return;
    }
    currentState = data;

    if (!data.Available) {
      setStatePill('—');
      connName.textContent = data.Error || 'No connection profile';
      ssidInput.disabled = true;
      passInput.disabled = true;
      bandRadios.forEach((r) => { r.disabled = true; });
      applyBtn.disabled = true;
      toggleBtn.disabled = true;
      return;
    }

    ssidInput.disabled = false;
    passInput.disabled = false;
    bandRadios.forEach((r) => { r.disabled = false; });
    applyBtn.disabled = false;
    toggleBtn.disabled = false;

    setStatePill(data.State);
    connName.textContent = data.InternetProfile || '—';
    ssidInput.value = data.Ssid || '';
    passInput.value = data.Passphrase || '';
    clientsCell.textContent = String(data.ClientCount);
    maxCell.textContent = String(data.MaxClientCount);
    bandRadios.forEach((r) => { r.checked = r.value === data.Band; });

    toggleBtn.textContent = data.State === 'On' ? '■ Stop Hotspot' : '▶ Start Hotspot';
    toggleBtn.classList.toggle('btn-danger',  data.State === 'On');
    toggleBtn.classList.toggle('btn-primary', data.State !== 'On');
  }

  async function open() {
    overlayEl.classList.remove('hidden');
    await refresh();
    clearInterval(pollTimer);
    pollTimer = setInterval(refresh, 5000);
  }

  function close() {
    overlayEl.classList.add('hidden');
    clearInterval(pollTimer);
    pollTimer = null;
  }

  return { open, close };
}
