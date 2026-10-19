'use client';

/**
 * Public Vendor Directory Client
 * Unauthenticated fetch helpers for the public /vendors page.
 * Never sends an Authorization header — the endpoint is open to all visitors.
 */

import { UI_STRINGS } from '@/lib/uiStrings';
import type { PublicVendorFilterState, PublicVendorPageResult, PublicVendor } from '@/lib/types';

/**
 * Fetches a paginated, filtered listing of Procucev-network vendors.
 * No auth token is sent or required.
 */
export async function fetchPublicVendors(
  filter: Partial<PublicVendorFilterState> = {}
): Promise<PublicVendorPageResult> {
  const {
    page = 1,
    pageSize = 24,
    search = '',
    category = '',
    state = '',
    minRating = 0,
  } = filter;

  const params = new URLSearchParams({
    page: String(Math.max(1, page)),
    pageSize: String(Math.min(100, Math.max(1, pageSize))),
  });

  if (search && search.trim()) params.set('search', search.trim().slice(0, 200));
  if (category && category !== 'all' && category.trim()) params.set('category', category.trim());
  if (state && state !== 'all' && state.trim()) params.set('state', state.trim());
  if (minRating > 0) params.set('minRating', String(Math.min(5, Math.max(0, minRating))));

  try {
    const res = await fetch(`/api/vendors/public?${params.toString()}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      // Allow browser/CDN caching of the public listing for 60s
      cache: 'default',
    });

    if (!res.ok) {
      let errMsg = `${UI_STRINGS.publicVendorDirectory.errorText} (HTTP ${res.status})`;
      try {
        const json = await res.json();
        if (json?.error) errMsg = json.error;
      } catch {
        // ignore parse error, use default message
      }
      return {
        success: false,
        data: [],
        pagination: { page, pageSize, total: 0, totalPages: 1 },
        error: errMsg,
      };
    }

    const json: PublicVendorPageResult = await res.json();
    return json;
  } catch {
    return {
      success: false,
      data: [],
      pagination: { page, pageSize, total: 0, totalPages: 1 },
      error: UI_STRINGS.publicVendorDirectory.errorText,
    };
  }
}

/**
 * Fetches a single public vendor profile by id.
 * Returns null if not found or an error occurs.
 */
export async function fetchPublicVendorById(
  id: string
): Promise<PublicVendor | null> {
  if (!id) return null;
  try {
    const res = await fetch(`/api/vendors/public/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    const json: { success: boolean; data?: PublicVendor } = await res.json();
    return (json.success && json.data) ? json.data : null;
  } catch {
    return null;
  }
}
