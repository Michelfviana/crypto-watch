const Preferences = {
  read() {
    try {
      const value = JSON.parse(localStorage.getItem('cryptowatch.preferences') || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch { return {}; }
  },
  write(value) {
    try { localStorage.setItem('cryptowatch.preferences', JSON.stringify(value)); }
    catch { /* Storage may be disabled; the dashboard remains usable. */ }
  },
};
