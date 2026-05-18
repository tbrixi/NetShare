// Adapter list column. The same component drives both the "Internet Source"
// (role: 'public') and "Share To" (role: 'private') columns.

import { el } from '../utils.js';
import { api } from '../api.js';

export function mount(rootEl, { role, getState, onToggle, onError }) {
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
      children.push(el('div', { class: 'adapter-ip', text: ip }));
    }
    if (desc) {
      children.push(el('div', { class: 'adapter-desc', title: desc, text: desc }));
    }
    children.push(el('div', { class: 'adapter-tags' }, tags));

    const meta = el('div', { class: 'adapter-meta' }, children);

    const input = el('input', { type: 'checkbox' });
    input.checked = isChecked;
    input.disabled = disabled;
    const sw = el('label', { class: 'switch' }, [input, el('span', { class: 'slider' })]);

    const li = el('li', {
      class: ['adapter-item', isChecked && 'selected', isOther && 'disabled']
        .filter(Boolean)
        .join(' ')
    }, [meta, sw]);

    const toggle = (e) => {
      e.stopPropagation();
      if (disabled) return;
      onToggle(adapter.Name);
    };
    input.addEventListener('click', toggle);
    li.addEventListener('click', (e) => { if (e.target !== input) toggle(e); });

    li.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      try {
        await api.openAdapterProperties({ adapterName: adapter.Name });
      } catch (err) {
        if (onError) onError(err.message || String(err));
      }
    });
    li.title = 'Right-click to open Windows adapter properties';

    return li;
  }

  return { render };
}
