// Footer: selection summary pills and Start / Stop sharing buttons.

export function mount(rootEl, { getState, onStart, onStop }) {
  const selPub  = rootEl.querySelector('#sel-public');
  const selPriv = rootEl.querySelector('#sel-private');
  const btnStart = rootEl.querySelector('#btn-start');
  const btnStop  = rootEl.querySelector('#btn-stop');

  btnStart.addEventListener('click', onStart);
  btnStop.addEventListener('click', onStop);

  function render() {
    const s = getState();
    selPub.textContent  = s.selectedPublic  || '—';
    selPriv.textContent = s.selectedPrivate || '—';

    const hasValid = s.selectedPublic
      && s.selectedPrivate
      && s.selectedPublic !== s.selectedPrivate;

    const matchesActive = s.sharingActive
      && s.selectedPublic === s.activePublic
      && s.selectedPrivate === s.activePrivate;

    btnStart.disabled    = !hasValid || matchesActive || s.busy;
    btnStart.textContent = s.sharingActive && !matchesActive ? '▶ Switch Sharing' : '▶ Start Sharing';
    btnStart.title       = matchesActive ? 'These adapters are already sharing' : '';
    btnStop.disabled     = !s.sharingActive || s.busy;
  }

  return { render };
}
