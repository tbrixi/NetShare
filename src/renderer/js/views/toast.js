// Transient bottom-center notification.

export function mount(rootEl) {
  let timer = null;

  function show(message, kind = '') {
    rootEl.className = `toast ${kind}`;
    rootEl.textContent = message;
    rootEl.classList.remove('hidden');
    clearTimeout(timer);
    timer = setTimeout(() => rootEl.classList.add('hidden'), 3500);
  }

  return { show };
}
