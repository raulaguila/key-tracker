// Runs before the stylesheet so a saved dark theme is applied before first paint.
(() => {
  const key = 'keyboard-tracker.appearance';
  const allowed = ['system', 'light', 'dark'];
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try {
    const saved = localStorage.getItem(key);
    if (allowed.includes(saved)) preference = saved;
  } catch { /* The session choice still works without storage. */ }
  function apply() {
    document.documentElement.dataset.theme = preference === 'system' ? system.matches ? 'dark' : 'light' : preference;
    document.documentElement.dataset.themePreference = preference;
  }
  window.keyboardAppearance = Object.freeze({
    get preference() { return preference; },
    set(value) {
      if (!allowed.includes(value)) throw new Error('Tema inválido.');
      preference = value;
      try { localStorage.setItem(key, value); } catch { /* Keep the session preference. */ }
      apply();
    }
  });
  system.addEventListener('change', () => { if (preference === 'system') apply(); });
  apply();
})();
