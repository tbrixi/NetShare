// Status bar at the top of the window.
// Exposes only `set(text, detail, kind)` — the orchestrator decides what to show.

export function mount(rootEl) {
  const textEl = rootEl.querySelector('#status-text');
  const detailEl = rootEl.querySelector('#status-detail');

  function set(text, detail = '', kind = 'idle') {
    rootEl.className = `status-bar status-${kind}`;
    textEl.textContent = text;
    detailEl.textContent = detail;
  }

  return { set };
}
