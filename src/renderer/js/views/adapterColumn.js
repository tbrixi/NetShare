// Adapter list column. The same component drives both the "Internet Source"
// (role: 'public') and "Share To" (role: 'private') columns.

import { el, svgFromString } from '../utils.js';
import { api } from '../api.js';

// RJ-45 style network jack with the two indicator LEDs you find on a real
// integrated network card. Left LED = link (green, lit when the adapter is
// Up); right LED = activity (amber, lit + blinking when traffic is flowing).
// The .selected modifier on the parent <li> turns the jack body into a
// "plugged in" connector; the LEDs are independent and always reflect the
// underlying adapter's physical state.
const PORT_SVG = `
<svg class="port" viewBox="0 0 44 32" width="44" height="32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect class="port-body"  x="1" y="1" width="42" height="30" rx="3"/>
  <rect class="port-led-bg" x="3" y="3" width="6" height="3" rx="1"/>
  <rect class="port-led-bg" x="35" y="3" width="6" height="3" rx="1"/>
  <rect class="port-led port-led-link" x="3" y="3" width="6" height="3" rx="1"/>
  <rect class="port-led port-led-act"  x="35" y="3" width="6" height="3" rx="1"/>
  <path class="port-mouth" d="M8 9 L36 9 L36 22 L28 22 L28 26 L16 26 L16 22 L8 22 Z"/>
</svg>
`;

// Builds the per-row traffic line: download/upload rates plus cumulative
// totals. Rates show "—" until two consecutive polls have been observed for
// this adapter; totals show the running counters since adapter start.
function renderTraffic(adapter) {
  const totalDown = Number(adapter.BytesReceived || 0);
  const totalUp   = Number(adapter.BytesSent || 0);
  if (!totalDown && !totalUp && adapter.RateDownBytesPerSec == null) return null;

  const dn = adapter.RateDownBytesPerSec;
  const up = adapter.RateUpBytesPerSec;
  const rateText = dn == null
    ? '↓ — ↑ —'
    : `↓ ${formatBytes(dn)}/s   ↑ ${formatBytes(up)}/s`;
  const totalText = `total ↓ ${formatBytes(totalDown)} · ↑ ${formatBytes(totalUp)}`;

  return el('div', {
    class: 'adapter-traffic',
    title: `Received: ${formatBytes(totalDown)} (${totalDown.toLocaleString()} bytes)\n` +
           `Sent: ${formatBytes(totalUp)} (${totalUp.toLocaleString()} bytes)`
  }, [
    el('span', { class: 'rate', text: rateText }),
    el('span', { class: 'total', text: totalText })
  ]);
}

// Formats a byte count as B/KB/MB/GB/TB with one decimal place beyond KB.
function formatBytes(bytes) {
  if (bytes == null || isNaN(bytes)) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const precision = unit === 0 ? 0 : (value >= 100 ? 0 : value >= 10 ? 1 : 2);
  return `${value.toFixed(precision)} ${units[unit]}`;
}

// Builds a human-readable subnet description for the tooltip:
//   "192.168.137.1/24 — subnet 192.168.137.0–192.168.137.255 (254 usable hosts, mask 255.255.255.0)"
// Handles multiple addresses joined with ", " and silently skips any malformed
// entries.
function subnetTooltip(ipsWithPrefix) {
  if (!ipsWithPrefix) return '';
  const lines = [];
  for (const entry of String(ipsWithPrefix).split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = entry.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
    if (!m) { lines.push(entry); continue; }
    const ip = m[1];
    const prefix = parseInt(m[2], 10);
    const octets = ip.split('.').map(Number);
    const ipInt = (octets[0] << 24 | octets[1] << 16 | octets[2] << 8 | octets[3]) >>> 0;
    const maskInt = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
    const networkInt = (ipInt & maskInt) >>> 0;
    const broadcastInt = (networkInt | (~maskInt >>> 0)) >>> 0;
    const fmt = (n) => `${(n >>> 24) & 0xFF}.${(n >>> 16) & 0xFF}.${(n >>> 8) & 0xFF}.${n & 0xFF}`;
    const usable = prefix >= 31 ? 0 : Math.pow(2, 32 - prefix) - 2;
    lines.push(
      `${entry} — subnet ${fmt(networkInt)}–${fmt(broadcastInt)}` +
      ` (${usable} usable hosts, mask ${fmt(maskInt)})`
    );
  }
  return lines.join('\n');
}

export function mount(rootEl, { role, getState, onToggle, onError, onInfo }) {
  const thisKey = role === 'public' ? 'selectedPublic' : 'selectedPrivate';
  const otherKey = role === 'public' ? 'selectedPrivate' : 'selectedPublic';

  function render() {
    const s = getState();
    rootEl.innerHTML = '';
    for (const adapter of s.adapters) {
      rootEl.appendChild(renderItem(adapter, s));
    }
  }

  function renderItem(adapter, s) {
    const isOther = s[otherKey] === adapter.Name;
    const isChecked = s[thisKey] === adapter.Name;
    const disabled = isOther || s.busy;

    const tags = [
      el('span', {
        class: `tag ${adapter.Status === 'Up' ? 'up' : 'down'}`,
        text: adapter.Status
      })
    ];
    if (adapter.HasInternet) {
      tags.push(el('span', { class: 'tag internet', text: 'Internet' }));
    }
    if (adapter.SharingEnabled) {
      const isSource = adapter.SharingConnectionType === 0;
      tags.push(el('span', {
        class: `tag ${isSource ? 'public' : 'private'}`,
        text: isSource ? 'ICS Source' : 'ICS Target'
      }));
    }

    const desc = adapter.InterfaceDescription || '';
    const ip = adapter.IPv4Address || '';
    const children = [el('div', { class: 'adapter-name', text: adapter.Name })];
    if (ip) {
      children.push(el('div', {
        class: 'adapter-ip',
        text: ip,
        title: subnetTooltip(adapter.IPv4WithPrefix) || ip
      }));
    }

    const trafficNode = renderTraffic(adapter);
    if (trafficNode) children.push(trafficNode);

    if (desc) {
      children.push(el('div', { class: 'adapter-desc', title: desc, text: desc }));
    }
    children.push(el('div', { class: 'adapter-tags' }, tags));

    const meta = el('div', { class: 'adapter-meta' }, children);
    const port = svgFromString(PORT_SVG);

    const linkUp = adapter.Status === 'Up';
    const totalRate = (adapter.RateDownBytesPerSec || 0) + (adapter.RateUpBytesPerSec || 0);
    // Activity threshold ~ 1 KB/s — filters background OS chatter so the LED
    // does not blink continuously on a quiet adapter.
    const hasActivity = linkUp && totalRate > 1024;

    const li = el('li', {
      class: [
        'adapter-item',
        isChecked && 'selected',
        isOther && 'disabled',
        linkUp && 'link-up',
        hasActivity && 'activity'
      ].filter(Boolean).join(' ')
    }, [meta, port]);

    li.addEventListener('click', (e) => {
      e.stopPropagation();
      if (disabled) return;
      onToggle(adapter.Name);
    });

    li.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await api.openAdapterProperties({ adapterName: adapter.Name });
        if (onInfo) onInfo(`Opened properties for ${adapter.Name}`);
      } catch (err) {
        if (onError) onError(err.message || String(err));
      }
    });
    li.title = 'Right-click to open Windows adapter properties';

    return li;
  }

  return { render };
}
