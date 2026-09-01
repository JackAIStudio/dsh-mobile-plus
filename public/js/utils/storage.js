/**
 * LocalStorage utilities for preferences and booleans.
 */

export function readStoredBoolean(key, fallback) {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return fallback
      return raw === '1' || raw.toLowerCase() === 'true'
    } catch {
      return fallback
    }
  }

export function writeStoredBoolean(key, value) {
    try {
      localStorage.setItem(key, value ? '1' : '0')
    } catch {
      /* quota / privacy mode: non-persistent is acceptable */
    }
  }
