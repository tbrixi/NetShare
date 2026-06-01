// Footer: profile dropdown and Start / Stop / Reset sharing buttons.

export function mount(rootEl, { getState, onStart, onStop, onReset, onLoadProfile, onSaveProfile, onDeleteProfile }) {
  const btnStart = rootEl.querySelector('#btn-start');
  const btnStop  = rootEl.querySelector('#btn-stop');
  const btnReset = rootEl.querySelector('#btn-reset');
  const profileSel    = rootEl.querySelector('#profile-select');
  const btnSaveProf   = rootEl.querySelector('#btn-save-profile');
  const btnDeleteProf = rootEl.querySelector('#btn-delete-profile');

  // Tracks the last <option> list we wrote so we don't rebuild on every render
  // (preserves focus and avoids losing the dropdown's open state mid-pick).
  let lastProfileSig = '';

  btnStart.addEventListener('click', onStart);
  btnStop.addEventListener('click', onStop);
  btnReset.addEventListener('click', onReset);

  profileSel.addEventListener('change', () => {
    if (profileSel.value) onLoadProfile(profileSel.value);
  });

  const profileModal = mountProfileModal(document.getElementById('profile-overlay'));

  btnSaveProf.addEventListener('click', () => {
    const s = getState();
    profileModal.open({
      suggestion: `${s.selectedPublic} -> ${s.selectedPrivate}`,
      hint:       `${s.selectedPublic} → ${s.selectedPrivate}`,
      onSubmit:   (name) => onSaveProfile(name)
    });
  });

  btnDeleteProf.addEventListener('click', () => {
    const id = profileSel.value;
    if (!id) return;
    const p = (getState().profiles || []).find((x) => x.id === id);
    if (!p) return;
    // window.confirm IS supported in Electron renderer (only prompt is not).
    if (window.confirm(`Delete profile "${p.name}"?`)) onDeleteProfile(id);
  });

  function render() {
    const s = getState();

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
    btnReset.disabled    = s.busy;

    const profiles = s.profiles || [];
    // Placeholder doubles as a hint when no profiles exist yet: tells the user
    // to pick a Source + Target before the Save button appears.
    const placeholder = profiles.length === 0
      ? (hasValid ? 'Click "Save as profile" to add one' : 'Select adapters to save profile')
      : 'Load profile…';
    const sig = `${placeholder}|` + profiles.map((p) => `${p.id}${p.name}`).join('');
    if (sig !== lastProfileSig) {
      const opts = [`<option value="">${text(placeholder)}</option>`]
        .concat(profiles.map((p) => `<option value="${attr(p.id)}">${text(p.name)}</option>`));
      profileSel.innerHTML = opts.join('');
      lastProfileSig = sig;
    }

    // Show the profile whose pair matches the current selection (if any),
    // otherwise clear the dropdown so it never lies about what's loaded.
    const match = hasValid
      ? profiles.find((p) => p.source === s.selectedPublic && p.target === s.selectedPrivate)
      : null;
    profileSel.value = match ? match.id : '';

    btnSaveProf.hidden   = !hasValid || !!match || s.busy;
    btnDeleteProf.hidden = !match || s.busy;
  }

  return { render };
}

function attr(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function text(s) { return attr(s); }

// Small modal that asks for a profile name. Used because Electron's renderer
// does not support window.prompt (it silently returns null).
function mountProfileModal(overlay) {
  const input  = overlay.querySelector('#profile-name');
  const hint   = overlay.querySelector('#profile-pair-hint');
  const btnOk  = overlay.querySelector('#btn-profile-save');
  const btnX   = overlay.querySelector('#btn-profile-close');
  const btnNo  = overlay.querySelector('#btn-profile-cancel');
  let activeSubmit = null;

  function close() {
    overlay.classList.add('hidden');
    activeSubmit = null;
  }
  function submit() {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const cb = activeSubmit;
    close();
    if (cb) cb(name);
  }

  btnOk.addEventListener('click', submit);
  btnX.addEventListener('click', close);
  btnNo.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { e.preventDefault(); close();  }
  });

  return {
    open({ suggestion, hint: pairHint, onSubmit }) {
      activeSubmit = onSubmit;
      input.value = suggestion || '';
      hint.textContent = pairHint ? `Pair: ${pairHint}` : '';
      overlay.classList.remove('hidden');
      // Focus + select so the user can immediately type a new name.
      setTimeout(() => { input.focus(); input.select(); }, 0);
    }
  };
}
