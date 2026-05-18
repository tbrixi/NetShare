// Connected-clients table. Renders devices currently visible on the ICS
// target adapter's IPv4 neighbor cache (IP, MAC, hostname, state). Only shown
// when sharing is active and we know the target adapter.

import { el } from '../utils.js';

export function mount(rootEl, { onRefresh }) {
  const list = rootEl.querySelector('#clients-list');
  const count = rootEl.querySelector('#clients-count');
  rootEl.querySelector('#btn-clients-refresh').addEventListener('click', () => {
    if (onRefresh) onRefresh();
  });

  function stateClass(state) {
    const s = String(state || '').toLowerCase();
    if (s === 'reachable')   return 'reachable';
    if (s === 'unreachable') return 'unreachable';
    if (s === 'permanent')   return 'permanent';
    return 'stale';
  }

  function render(clients) {
    list.innerHTML = '';
    count.textContent = `(${clients.length})`;
    for (const c of clients) {
      const li = el('li', { class: `client-item ${stateClass(c.State)}` }, [
        el('div', { class: 'state-dot', title: c.State || 'Unknown' }),
        el('div', { class: 'client-ip',    text: c.IPAddress || '?' }),
        el('div', { class: 'client-mac',   text: c.LinkLayerAddress || '' }),
        el('div', {
          class: 'client-host',
          text: c.HostName || '—',
          title: c.HostName || ''
        }),
        el('div', { class: 'client-state', text: (c.State || '').toLowerCase() })
      ]);
      list.appendChild(li);
    }
  }

  function setVisible(visible) {
    rootEl.classList.toggle('hidden', !visible);
  }

  return { render, setVisible };
}
