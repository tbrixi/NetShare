// Persistent activity-log panel rendered below the Start/Stop buttons.
// `log(message, kind)` appends a timestamped entry; the panel auto-scrolls
// to the newest line and caps the buffer at 500 entries.

import { el } from '../utils.js';

const MAX_ENTRIES = 500;

export function mount(rootEl) {
  const list = rootEl.querySelector('#console-log');
  const clearBtn = rootEl.querySelector('#btn-console-clear');
  const handle = rootEl.querySelector('#console-resize');
  clearBtn.addEventListener('click', () => { list.innerHTML = ''; });

  // Vertical resize via the top drag-handle. Height clamped between the panel's
  // CSS min-height (80) and most of the work area so the columns above always
  // keep some space. Session-local — not persisted to settings.
  let dragging = false;
  let startY = 0;
  let startH = 0;
  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startY = e.clientY;
    startH = rootEl.getBoundingClientRect().height;
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const maxH = Math.max(120, window.innerHeight - 220);
    const newH = Math.max(80, Math.min(maxH, startH - (e.clientY - startY)));
    rootEl.style.height = newH + 'px';
    list.scrollTop = list.scrollHeight;
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  });

  function log(message, kind = '') {
    const time = new Date().toTimeString().slice(0, 8);
    const li = el('li', { class: kind }, [
      el('span', { class: 'time', text: time }),
      el('span', { class: 'msg',  text: String(message) })
    ]);
    list.appendChild(li);
    while (list.childElementCount > MAX_ENTRIES) {
      list.removeChild(list.firstChild);
    }
    list.scrollTop = list.scrollHeight;
  }

  function setVisible(visible) {
    rootEl.classList.toggle('hidden', !visible);
  }

  return { log, setVisible };
}
