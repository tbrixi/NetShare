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

// Traffic-chart geometry. The SVG is drawn in this fixed coordinate space and
// stretched to the card width via preserveAspectRatio="none".
const CHART_W = 240;
const CHART_H = 34;

// Builds the per-adapter traffic chart shown at the bottom of the card.
// `history` is a chronological list of { down, up } byte/sec samples. Download
// and upload are drawn as two areas sharing one peak-based scale, in distinct
// colours so both series stay readable where they overlap.
function renderTrafficChart(adapter, history) {
  const samples = Array.isArray(history) ? history : [];
  if (samples.length < 2) {
    return el('div', { class: 'adapter-chart empty' }, [
      el('span', { class: 'chart-hint', text: 'Collecting traffic…' })
    ]);
  }

  const peak = Math.max(1, ...samples.map(s => Math.max(s.down || 0, s.up || 0)));
  const n = samples.length;
  const stepX = CHART_W / (n - 1);
  const xAt = (i) => (i * stepX).toFixed(1);
  // 1px margin top and bottom so peaks and the baseline are not clipped.
  const yAt = (v) => (CHART_H - 1 - (Math.min(v, peak) / peak) * (CHART_H - 2)).toFixed(1);

  const areaPath = (key) => {
    let d = `M 0 ${CHART_H}`;
    samples.forEach((s, i) => { d += ` L ${xAt(i)} ${yAt(s[key] || 0)}`; });
    return d + ` L ${CHART_W} ${CHART_H} Z`;
  };
  const linePath = (key) => {
    let d = '';
    samples.forEach((s, i) => { d += `${i ? 'L' : 'M'}${xAt(i)} ${yAt(s[key] || 0)} `; });
    return d.trim();
  };

  const svg = svgFromString(`
<svg class="chart-svg" viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path class="chart-area chart-down" d="${areaPath('down')}"/>
  <path class="chart-area chart-up"   d="${areaPath('up')}"/>
  <path class="chart-line chart-down" d="${linePath('down')}"/>
  <path class="chart-line chart-up"   d="${linePath('up')}"/>
</svg>`);

  const last = samples[n - 1];
  return el('div', {
    class: 'adapter-chart',
    title: `Traffic — last ${n} samples\n` +
           `now  ↓ ${formatBytes(last.down)}/s · ↑ ${formatBytes(last.up)}/s\n` +
           `peak ${formatBytes(peak)}/s`
  }, [
    svg,
    el('div', { class: 'chart-legend' }, [
      el('span', { class: 'chart-key chart-down', text: 'Download' }),
      el('span', { class: 'chart-key chart-up',   text: 'Upload' }),
      el('span', { class: 'chart-peak', text: `peak ${formatBytes(peak)}/s` })
    ])
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

// Returns a sorted copy of the adapter list for the given '<field>-<dir>' key.
// Traffic uses cumulative bytes (received + sent) — monotonic, so the order
// stays stable across polls instead of reshuffling on every rate change.
// Ties fall back to name so equal-traffic adapters keep a fixed order.
function sortAdapters(adapters, sortKey) {
  const [field, dir] = String(sortKey || 'name-asc').split('-');
  const mul = dir === 'desc' ? -1 : 1;
  const byName = (a, b) =>
    String(a.Name).localeCompare(String(b.Name), undefined, { sensitivity: 'base', numeric: true });
  return adapters.slice().sort((a, b) => {
    if (field === 'traffic') {
      const ta = Number(a.BytesReceived || 0) + Number(a.BytesSent || 0);
      const tb = Number(b.BytesReceived || 0) + Number(b.BytesSent || 0);
      return (ta === tb ? byName(a, b) : (ta - tb) * mul);
    }
    return byName(a, b) * mul;
  });
}

// Returns a copy of the adapter list with the active ICS target hoisted to
// the top, so the "Share To" column always shows the adapter currently
// receiving shared internet first. The relative order of the rest is kept.
function activeFirst(adapters, activeName) {
  if (!activeName) return adapters.slice();
  return adapters.slice().sort((a, b) => {
    const aActive = a.Name === activeName ? 0 : 1;
    const bActive = b.Name === activeName ? 0 : 1;
    return aActive - bActive;
  });
}

// Builds the enable/disable switch shown at the top-right of every adapter
// card (above the jack icon) — the same action as Enable/Disable in the
// Windows Network Connections panel. The switch reflects adapter.Status
// ('Disabled' => off) and triggers an elevated state change via onSetState.
// Clicks are stopped from bubbling so flipping it never also selects the card.
function renderToggle(adapter, busy, onSetState) {
  const enabled = adapter.Status !== 'Disabled';

  const input = el('input', { type: 'checkbox', class: 'switch-input' });
  input.checked = enabled;
  input.disabled = busy;
  input.addEventListener('change', (e) => {
    e.stopPropagation();
    onSetState(adapter.Name, input.checked);
  });

  return el('label', {
    class: 'adapter-switch',
    title: enabled ? `Disable ${adapter.Name}` : `Enable ${adapter.Name}`,
    onClick: (e) => e.stopPropagation()
  }, [input, el('span', { class: 'switch-slider' })]);
}

export function mount(rootEl, { role, getState, onToggle, onSetState, onError, onInfo }) {
  const thisKey = role === 'public' ? 'selectedPublic' : 'selectedPrivate';
  const otherKey = role === 'public' ? 'selectedPrivate' : 'selectedPublic';

  function render() {
    const s = getState();
    rootEl.innerHTML = '';
    // The Internet Source list is sortable; the "Share To" list keeps the
    // adapter order reported by Windows but hoists the active ICS target to
    // the top so the adapter currently in use is always first.
    const list = role === 'public'
      ? sortAdapters(s.adapters, s.sourceSort)
      : activeFirst(s.adapters, s.activePrivate);
    for (const adapter of list) {
      rootEl.appendChild(renderItem(adapter, s));
    }
  }

  function renderItem(adapter, s) {
    const isOther = s[otherKey] === adapter.Name;
    const isChecked = s[thisKey] === adapter.Name;
    const isStateDisabled = adapter.Status === 'Disabled';
    // A disabled adapter can't carry shared internet, so it isn't selectable —
    // only its enable toggle stays live.
    const disabled = isOther || s.busy || isStateDisabled;

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
    // Right-hand column: enable/disable switch on top, RJ-45 jack below it.
    // The switch is shown only in the Internet Source list — the Share To
    // list shows the same adapters, so a second toggle would be a duplicate.
    const side = el('div', { class: 'adapter-side' }, [
      role === 'public' ? renderToggle(adapter, s.busy, onSetState) : null,
      svgFromString(PORT_SVG)
    ]);

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
        isStateDisabled && 'state-disabled',
        linkUp && 'link-up',
        hasActivity && 'activity'
      ].filter(Boolean).join(' ')
    }, [meta, side]);

    // Traffic chart at the bottom of the card. Internet Source list: every
    // adapter. Share To list: only the adapter currently receiving shared
    // internet (the active ICS target). Disabled when the chart interval is 0.
    const chartOn = (s.settings?.chartIntervalSec ?? 0) > 0;
    const showChart = chartOn && (role === 'public' || adapter.Name === s.activePrivate);
    if (showChart) {
      li.appendChild(renderTrafficChart(adapter, s.trafficHistory?.[adapter.Name]));
    }

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
