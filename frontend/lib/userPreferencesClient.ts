import { authClient } from './authClient';
import { LEGACY_LOCAL_STORAGE_KEYS, LEGACY_SESSION_STORAGE_KEYS } from './constants';

let cachedToken: string | null = null;
let cachedPreferences: Record<string, unknown> | null = null;
let inFlightLoad: Promise<Record<string, unknown>> | null = null;

function buildAuthHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export function clearUserPreferencesCache(): void {
  cachedToken = null;
  cachedPreferences = null;
  inFlightLoad = null;
}

export async function loadUserPreferences(force = false): Promise<Record<string, unknown>> {
  const token = authClient.getToken();
  if (!token) {
    clearUserPreferencesCache();
    return {};
  }

  if (!force && cachedPreferences !== null && cachedToken === token) {
    return cachedPreferences;
  }

  if (inFlightLoad && cachedToken === token) {
    return inFlightLoad;
  }

  cachedToken = token;
  let request: Promise<Record<string, unknown>> | null = null;
  request = (async (): Promise<Record<string, unknown>> => {
    try {
      const res = await fetch('/api/user-preferences', {
        headers: buildAuthHeaders(token),
        cache: 'no-store',
      });
      if (!res.ok) {
        return cachedPreferences ?? {};
      }
      const json = (await res.json()) as {
        success?: boolean;
        data?: Record<string, unknown>;
      } | null;
      if (json?.success && json.data && typeof json.data === 'object' && !Array.isArray(json.data)) {
        if (authClient.getToken() === token) {
          cachedPreferences = { ...json.data };
        }
        return json.data;
      }
      return cachedPreferences ?? {};
    } catch {
      return cachedPreferences ?? {};
    } finally {
      if (inFlightLoad === request) {
        inFlightLoad = null;
      }
    }
  })();

  inFlightLoad = request;
  return request;
}

export async function getUserPreference<T = unknown>(key: string): Promise<T | null> {
  const trimmedKey = key.trim();
  if (!trimmedKey) return null;
  const prefs = await loadUserPreferences(false);
  const val = prefs[trimmedKey];
  return val !== undefined ? (val as T) : null;
}

export async function saveUserPreference<T = unknown>(key: string, value: T): Promise<boolean> {
  const trimmedKey = key.trim();
  const token = authClient.getToken();
  if (!trimmedKey || !token) return false;

  if (cachedToken === token && cachedPreferences) {
    cachedPreferences = { ...cachedPreferences, [trimmedKey]: value };
  } else {
    cachedToken = token;
    cachedPreferences = { [trimmedKey]: value };
  }

  try {
    const res = await fetch(`/api/user-preferences/${encodeURIComponent(trimmedKey)}`, {
      method: 'PUT',
      headers: buildAuthHeaders(token),
      body: JSON.stringify({ value }),
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteUserPreference(key: string): Promise<boolean> {
  const trimmedKey = key.trim();
  const token = authClient.getToken();
  if (!trimmedKey || !token) return false;

  if (cachedToken === token && cachedPreferences && trimmedKey in cachedPreferences) {
    const next = { ...cachedPreferences };
    delete next[trimmedKey];
    cachedPreferences = next;
  }

  try {
    const res = await fetch(`/api/user-preferences/${encodeURIComponent(trimmedKey)}`, {
      method: 'DELETE',
      headers: buildAuthHeaders(token),
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Purges legacy domain-data and UI-preference keys that older builds persisted
 * in browser localStorage / sessionStorage, ensuring every browser and device
 * hydrates exclusively from backend APIs.
 */
export function purgeLegacyClientStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const key of LEGACY_LOCAL_STORAGE_KEYS) {
      window.localStorage.removeItem(key);
    }
    const keysToDrop: string[] = [];
    for (let idx = 0; idx < window.localStorage.length; idx += 1) {
      const k = window.localStorage.key(idx);
      if (k && (k.startsWith('qua_approvals_columns_') || k.startsWith('procucev_approval_col_prefs_'))) {
        keysToDrop.push(k);
      }
    }
    for (const key of keysToDrop) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage access may be restricted in private browsing contexts.
  }

  try {
    for (const key of LEGACY_SESSION_STORAGE_KEYS) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Storage access may be restricted in private browsing contexts.
  }
}
