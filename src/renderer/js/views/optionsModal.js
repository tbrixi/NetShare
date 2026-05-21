// Centered options dialog. Opens with current settings, calls onSave with the
// new values when the user confirms.

export function mount(overlayEl, { onSave }) {
  const refresh      = overlayEl.querySelector('#opt-refresh');
  const chart        = overlayEl.querySelector('#opt-chart');
  const disconnected = overlayEl.querySelector('#opt-disconnected');
  const elevate      = overlayEl.querySelector('#opt-elevate');
  const consoleVis   = overlayEl.querySelector('#opt-console');
  const tray         = overlayEl.querySelector('#opt-tray');

  overlayEl.querySelector('#btn-options-close').addEventListener('click', close);
  overlayEl.querySelector('#btn-options-cancel').addEventListener('click', close);
  overlayEl.querySelector('#btn-options-save').addEventListener('click', () => {
    onSave({
      refreshIntervalSec: Math.max(0, parseInt(refresh.value, 10) || 0),
      chartIntervalSec:   Math.max(0, parseInt(chart.value, 10) || 0),
      showDisconnected:   disconnected.checked,
      elevateOnToggle:    elevate.checked,
      showConsole:        consoleVis.checked,
      minimizeToTray:     tray.checked
    });
    close();
  });
  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlayEl.classList.contains('hidden')) close();
  });

  function open(settings) {
    refresh.value        = settings.refreshIntervalSec;
    chart.value          = settings.chartIntervalSec ?? 5;
    disconnected.checked = settings.showDisconnected;
    elevate.checked      = settings.elevateOnToggle;
    consoleVis.checked   = settings.showConsole !== false;
    tray.checked         = settings.minimizeToTray !== false;
    overlayEl.classList.remove('hidden');
  }

  function close() {
    overlayEl.classList.add('hidden');
  }

  return { open, close };
}
