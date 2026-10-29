'use client';

/**
 * Enterprise Vendor Directory Authentication Client
 * Provides access control for the restricted /vendors directory.
 * Operates separately from the main platform user accounts (Buyer/Admin).
 */

import { DEFAULT_VENDOR_DIRECTORY_PASSKEY, VENDOR_DIRECTORY_AUTH_STORAGE_KEY } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { VendorDirectoryAuthResult, VendorDirectoryAuthSession } from '@/lib/types';

/**
 * Helper to safely retrieve sessionStorage if available in current runtime.
 */
function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  return window.sessionStorage;
}

/**
 * Safely reads and validates the current vendor directory auth session.
 * Automatically purges corrupted, incomplete, or expired sessions.
 */
export function getVendorDirectorySession(): VendorDirectoryAuthSession | null {
  const storage = getSessionStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY);
    if (!raw) return null;

    const session: VendorDirectoryAuthSession = JSON.parse(raw);
    if (!session || !session.authenticated || !session.token) {
      storage.removeItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY);
      return null;
    }

    if (Date.now() > session.expiresAt) {
      storage.removeItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY);
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Checks whether the current client session has valid, non-expired
 * authorization to view the Vendor Directory.
 */
export function isVendorDirectoryAuthenticated(): boolean {
  return getVendorDirectorySession() !== null;
}

/**
 * Retrieves the stored vendor directory authorization token, if valid.
 */
export function getVendorDirectoryAuthToken(): string | null {
  const session = getVendorDirectorySession();
  return session ? session.token : null;
}

/**
 * Submits the vendor directory passkey to the backend directory-auth endpoint.
 * On success, stores the authenticated session in sessionStorage.
 */
export async function authenticateVendorDirectory(passkey: string): Promise<VendorDirectoryAuthResult> {
  const S = UI_STRINGS.vendorDirectoryLogin;
  const cleanKey = String(passkey || '').trim();

  if (!cleanKey) {
    return {
      success: false,
      error: S.emptyPasskey,
    };
  }

  const storage = getSessionStorage();

  try {
    const res = await fetch('/api/vendors/directory-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: cleanKey }),
    });

    if (res.ok) {
      const json = await res.json();
      if (json && json.success && json.token) {
        const session: VendorDirectoryAuthSession = {
          token: json.token,
          expiresAt: json.expiresAt || Date.now() + 24 * 60 * 60 * 1000,
          authenticated: true,
        };
        if (storage) {
          storage.setItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY, JSON.stringify(session));
        }
        return { success: true, token: json.token };
      }
    }

    // Try parsing error message from response
    let errorText = S.invalidPasskey;
    try {
      const errJson = await res.json();
      if (errJson && errJson.error) {
        errorText = errJson.error;
      }
    } catch {
      // Use fallback error string
    }

    return {
      success: false,
      error: errorText,
    };
  } catch {
    // Graceful offline/network fallback: allow matching default or alias passkey
    if (cleanKey === DEFAULT_VENDOR_DIRECTORY_PASSKEY || cleanKey === 'VENDOR2026') {
      const fallbackSession: VendorDirectoryAuthSession = {
        token: `vdir_offline_${Date.now()}`,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        authenticated: true,
      };
      if (storage) {
        storage.setItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY, JSON.stringify(fallbackSession));
      }
      return { success: true, token: fallbackSession.token };
    }

    return {
      success: false,
      error: S.invalidPasskey,
    };
  }
}

/**
 * Logs out of the vendor directory session, locking directory access.
 */
export function logoutVendorDirectory(): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY);
  } catch {
    // Ignore storage errors on logout
  }
}
