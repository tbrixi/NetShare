// Status bar at the top of the window.
//  - `set(text, detail, kind)` drives the two ICS-status lines.
//  - `setSpeed(speedTest)` drives the dedicated internet speed-test line; it is
//    independent of `set` so a refresh poll rewriting the ICS status never
//    clobbers the speed-test result.

import { el } from '../utils.js';

export function mount(rootEl) {
  const textEl    = rootEl.querySelector('#status-text');
  const detailEl  = rootEl.querySelector('#status-detail');
  const speedLine = rootEl.querySelector('#status-speed-line');
  const speedEl   = rootEl.querySelector('#status-speed');

  function set(text, detail = '', kind = 'idle') {
    rootEl.className = `status-bar status-${kind}`;
    textEl.textContent = text;
    detailEl.textContent = detail;
  }

  // Renders the on-demand internet speed-test result on its own status line.
  // `speedTest` is state.speedTest ({ status, adapter, downMbps, upMbps,
  // pingMs, error, at }); a null value hides the line entirely.
  function setSpeed(speedTest) {
    if (!speedTest) {
      speedLine.classList.add('hidden');
      return;
    }
    speedLine.classList.remove('hidden');
    speedEl.innerHTML = '';
    speedEl.className = 'status-speed-value';

    if (speedTest.status === 'running') {
      speedEl.classList.add('running');
      speedEl.textContent =
        `Testing ${speedTest.adapter} — measuring internet throughput (this takes ~10-30s)…`;
      return;
    }
    if (speedTest.status === 'error') {
      speedEl.classList.add('error');
      speedEl.textContent =
        `${speedTest.adapter ? speedTest.adapter + ' — ' : ''}${speedTest.error}`;
      return;
    }

    // status === 'done'
    const when = speedTest.at ? new Date(speedTest.at).toLocaleTimeString() : '';
    const parts = [
      el('span', { class: 'sp-adapter', text: speedTest.adapter }),
      el('span', { class: 'sp-dl', text: `↓ ${speedTest.downMbps} Mbps` }),
      el('span', { class: 'sp-ul', text: `↑ ${speedTest.upMbps} Mbps` })
    ];
    if (speedTest.pingMs != null) {
      parts.push(el('span', { class: 'sp-pg', text: `${speedTest.pingMs} ms ping` }));
    }
    if (when) parts.push(el('span', { class: 'sp-at', text: `at ${when}` }));
    for (const p of parts) speedEl.appendChild(p);
  }

  return { set, setSpeed };
}
