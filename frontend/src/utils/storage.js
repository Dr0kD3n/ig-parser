/** Безопасная обёртка над localStorage */
export const safeStorage = {
  getItem(key, def) {
    try {
      const val = localStorage.getItem(key);
      if (val === null || val === 'null' || val === 'undefined') return def;
      return val;
    } catch {
      return def;
    }
  },

  setItem(key, val) {
    try {
      if (val === null || val === undefined) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, val);
      }
    } catch {
      /* игнорируем quota / private mode */
    }
  },

  removeItem(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* игнорируем */
    }
  },

  parse(key, def) {
    try {
      const val = localStorage.getItem(key);
      if (val === null || val === 'null' || val === 'undefined') return def;
      return JSON.parse(val);
    } catch {
      return def;
    }
  },
};
