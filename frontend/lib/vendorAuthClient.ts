'use client';

/**
 * Enterprise Vendor Directory Authentication Client
 * Provides access control and session management for the restricted /vendors directory.
 * Restricted strictly to Category Managers with valid @procucev.com email addresses.
 */

import { VENDOR_DIRECTORY_AUTH_STORAGE_KEY } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { VendorDirectoryAuthResult, VendorDirectoryAuthSession } from '@/lib/types';

/** Helper to safely retrieve sessionStorage if available in current runtime. */
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
    try {
      storage.removeItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY);
    } catch {
      // ignore
    }
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
 * Updates the last activity timestamp for the active session in storage.
 */
export function touchVendorDirectoryActivity(): void {
  const storage = getSessionStorage();
  if (!storage) return;

  const session = getVendorDirectorySession();
  if (!session) return;

  try {
    session.lastActivityAt = Date.now();
    storage.setItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Requests a single-use 6-digit OTP code for a Category Manager with a @procucev.com email.
 * Calls POST /api/auth/vendor-directory/request-otp.
 */
export async function requestVendorDirectoryOtp(
  email: string
): Promise<{ success: boolean; message?: string; error?: string; expiresInSeconds?: number }> {
  const S = UI_STRINGS.vendorDirectoryLogin;
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!cleanEmail) {
    return { success: false, error: S.emptyEmail };
  }

  if (!cleanEmail.endsWith('@procucev.com')) {
    return { success: false, error: S.procucevEmailRequired };
  }

  try {
    const res = await fetch('/api/auth/vendor-directory/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail }),
    });

    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }

    if (res.ok && json?.success) {
      return {
        success: true,
        message: json.message,
        expiresInSeconds: json.expiresInSeconds,
      };
    }

    const errorMsg = json?.error || (res.status === 403 ? S.accessDeniedNotice : S.networkError);
    return {
      success: false,
      error: errorMsg,
    };
  } catch {
    return {
      success: false,
      error: S.networkError,
    };
  }
}

/**
 * Verifies the 6-digit OTP code and initiates an authenticated Vendor Directory session.
 * Calls POST /api/auth/vendor-directory/verify-otp.
 */
export async function verifyVendorDirectoryOtp(
  email: string,
  code: string
): Promise<VendorDirectoryAuthResult> {
  const S = UI_STRINGS.vendorDirectoryLogin;
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanCode = String(code || '').trim();

  if (!cleanEmail) {
    return { success: false, error: S.emptyEmail };
  }

  if (!cleanEmail.endsWith('@procucev.com')) {
    return { success: false, error: S.procucevEmailRequired };
  }

  if (!cleanCode) {
    return { success: false, error: S.emptyOtp };
  }

  if (!/^\d{6}$/.test(cleanCode)) {
    return { success: false, error: S.invalidOtp };
  }

  const storage = getSessionStorage();

  try {
    const res = await fetch('/api/auth/vendor-directory/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, code: cleanCode }),
    });

    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }

    if (res.ok && json?.success && json?.token) {
      const expiryMs = json.expiresAt
        ? (typeof json.expiresAt === 'number' ? json.expiresAt : new Date(json.expiresAt).getTime())
        : Date.now() + 5 * 60 * 1000;

      const session: VendorDirectoryAuthSession = {
        token: json.token,
        sessionId: json.sessionId,
        expiresAt: isNaN(expiryMs) ? Date.now() + 5 * 60 * 1000 : expiryMs,
        lastActivityAt: Date.now(),
        authenticated: true,
        user: json.user,
      };

      if (storage) {
        storage.setItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY, JSON.stringify(session));
      }

      return {
        success: true,
        token: json.token,
        sessionId: json.sessionId,
        expiresAt: session.expiresAt,
        user: json.user,
      };
    }

    const errorMsg = json?.error || (res.status === 403 ? S.accessDeniedNotice : S.invalidOtp);
    return {
      success: false,
      error: errorMsg,
    };
  } catch {
    return {
      success: false,
      error: S.networkError,
    };
  }
}

/**
 * Logs out of the vendor directory session, locking directory access.
 * Performs best-effort token revocation with the server and clears client storage.
 */
export async function logoutVendorDirectory(logoutReason?: string): Promise<void> {
  const token = getVendorDirectoryAuthToken();
  const storage = getSessionStorage();

  if (storage) {
    try {
      storage.removeItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY);
    } catch {
      // Ignore storage errors on logout
    }
  }

  if (token) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ logoutReason: logoutReason || 'MANUAL' }),
      });
    } catch {
      // Best-effort network logout
    }
  }
}
