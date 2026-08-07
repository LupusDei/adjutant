/**
 * API key storage — the single source of truth for where the dashboard's
 * bearer key lives.
 *
 * The key is persisted in `localStorage`, NOT `sessionStorage` (adj-0da4g):
 * sessionStorage is scoped to one window/tab and wiped when it closes, so
 * every new browser window demanded a fresh key. Every other persisted
 * setting in the app (project, communication priority, overseer prefs)
 * already uses localStorage.
 *
 * SECURITY: localStorage keeps the bearer key on disk where any XSS on this
 * origin can read it. That is an accepted trade-off for a local dashboard
 * whose explicit requirement is persistence; if tighter security is wanted
 * later, have the backend issue an httpOnly cookie instead.
 *
 * Import this module (not a raw string literal) anywhere the key is read —
 * both `api.ts` and `api-costs.ts` go through here so the storage key can
 * never drift between call sites.
 */

/** The one storage key for the dashboard API key. Shared by all callers. */
export const API_KEY_STORAGE_KEY = 'adjutant-api-key';

/**
 * One-time migration of a key left behind in sessionStorage by the pre-adj-0da4g
 * build, so an in-flight session isn't logged out by the upgrade.
 * Returns the migrated value, or null if there was nothing to migrate.
 */
function migrateLegacySessionKey(): string | null {
  try {
    const legacy = sessionStorage.getItem(API_KEY_STORAGE_KEY);
    if (legacy === null) return null;
    sessionStorage.removeItem(API_KEY_STORAGE_KEY);
    if (legacy.length > 0) {
      localStorage.setItem(API_KEY_STORAGE_KEY, legacy);
      return legacy;
    }
    return null;
  } catch {
    // Storage unavailable (private mode / disabled cookies) — nothing to do.
    return null;
  }
}

/**
 * Get the stored API key, or null when none is configured.
 * Falls back to a one-time sessionStorage migration for legacy sessions.
 */
export function getApiKey(): string | null {
  try {
    const stored = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (stored !== null) return stored;
  } catch {
    // Storage unavailable — treat as unconfigured.
    return null;
  }
  return migrateLegacySessionKey();
}

/** Persist the API key so it survives new windows and browser restarts. */
export function setApiKey(key: string): void {
  try {
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
  } catch {
    // Storage unavailable — the key stays in memory for this page only.
  }
}

/** Clear the stored API key (the Settings "sign out" action). */
export function clearApiKey(): void {
  try {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    // Also drop any legacy copy so a stale key can't be resurrected.
    sessionStorage.removeItem(API_KEY_STORAGE_KEY);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

/** Check whether a non-empty API key is configured. */
export function hasApiKey(): boolean {
  const key = getApiKey();
  return key !== null && key.length > 0;
}
