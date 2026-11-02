'use client';

/**
 * Public Vendor Directory Client
 * Unauthenticated fetch helpers for the public /vendors page with in-memory caching
 * to minimize DB compute hours and eliminate redundant network roundtrips.
 * Never sends an Authorization header — the endpoint is open to all visitors.
 */

import { UI_STRINGS } from '@/lib/uiStrings';
import { getVendorDirectoryAuthToken } from '@/lib/vendorAuthClient';
import type { PublicVendorFilterState, PublicVendorPageResult, PublicVendor, PublicVendorFilterOptions } from '@/lib/types';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const PAGE_CACHE_MAX_ENTRIES = 50;
const PAGE_CACHE_TTL_MS = 60000; // 1 minute
const FILTERS_CACHE_TTL_MS = 300000; // 5 minutes
const VENDOR_CACHE_TTL_MS = 120000; // 2 minutes

const pageCache = new Map<string, CacheEntry<PublicVendorPageResult>>();
let filtersCache: CacheEntry<{ success: boolean; categories: string[]; states: string[] }> | null = null;
const vendorDetailCache = new Map<string, CacheEntry<PublicVendor | null>>();

function getFromCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.data;
}

function setInCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T, ttlMs: number): void {
  if (cache.size >= PAGE_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/**
 * Clear client-side public vendor caches (used for test isolation or explicit refresh).
 */
export function clearPublicVendorClientCache(): void {
  pageCache.clear();
  filtersCache = null;
  vendorDetailCache.clear();
}

/**
 * Fetches a paginated, filtered listing of Procucev-network vendors.
 * Utilizes client-side in-memory caching and browser/CDN HTTP caching.
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
    verifiedOnly = false,
  } = filter;

  const params = new URLSearchParams({
    page: String(Math.max(1, page)),
    pageSize: String(Math.min(100, Math.max(1, pageSize))),
  });

  if (search && search.trim()) params.set('search', search.trim().slice(0, 200));
  if (category && category !== 'all' && category.trim()) params.set('category', category.trim());
  if (state && state !== 'all' && state.trim()) params.set('state', state.trim());
  if (minRating > 0) params.set('minRating', String(Math.min(5, Math.max(0, minRating))));
  if (verifiedOnly) params.set('verifiedOnly', 'true');

  const cacheKey = params.toString();
  const cached = getFromCache(pageCache, cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const token = getVendorDirectoryAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`/api/vendors/public?${params.toString()}`, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });

    if (!res.ok) {
      let errMsg = `${UI_STRINGS.publicVendorDirectory.errorText} (HTTP ${res.status})`;
      let sessionExpired = res.status === 401;
      try {
        const json = await res.json();
        if (json?.error) errMsg = json.error;
        if (json?.sessionExpired !== undefined) {
          sessionExpired = Boolean(json.sessionExpired);
        }
      } catch {
        // ignore parse error, use default message
      }
      return {
        success: false,
        sessionExpired,
        data: [],
        pagination: { page, pageSize, total: 0, totalPages: 1 },
        error: errMsg,
      };
    }

    const json: PublicVendorPageResult = await res.json();
    if (json.success) {
      setInCache(pageCache, cacheKey, json, PAGE_CACHE_TTL_MS);
    }
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
 * Fetches dynamic category and state filter options from the database.
 * Utilizes a 5-minute client-side in-memory cache to prevent redundant queries.
 * Completely public and unauthenticated.
 */
export async function fetchPublicVendorFilters(): Promise<{
  success: boolean;
  sessionExpired?: boolean;
  categories: string[];
  states: string[];
}> {
  if (filtersCache && Date.now() <= filtersCache.expiresAt) {
    return filtersCache.data;
  }

  try {
    const token = getVendorDirectoryAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch('/api/vendors/public/filters', {
      method: 'GET',
      headers,
      cache: 'no-store',
    });
    if (!res.ok) {
      let sessionExpired = res.status === 401;
      try {
        const json = await res.json();
        if (json?.sessionExpired !== undefined) {
          sessionExpired = Boolean(json.sessionExpired);
        }
      } catch {
        // ignore
      }
      return { success: false, sessionExpired, categories: [], states: [] };
    }
    const json: { success: boolean; data?: PublicVendorFilterOptions } = await res.json();
    const result = {
      success: Boolean(json.success),
      categories: Array.isArray(json.data?.categories) ? json.data.categories : [],
      states: Array.isArray(json.data?.states) ? json.data.states : [],
    };
    if (result.success) {
      filtersCache = { data: result, expiresAt: Date.now() + FILTERS_CACHE_TTL_MS };
    }
    return result;
  } catch {
    return { success: false, categories: [], states: [] };
  }
}

/**
 * Fetches a single public vendor profile by id.
 * Caches vendor details in memory for 2 minutes to prevent repeated fetches.
 * Returns null if not found or an error occurs.
 */
export async function fetchPublicVendorById(
  id: string
): Promise<PublicVendor | null> {
  if (!id) return null;
  const cached = getFromCache(vendorDetailCache, id);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const token = getVendorDirectoryAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`/api/vendors/public/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json: { success: boolean; data?: PublicVendor } = await res.json();
    const vendor = (json.success && json.data) ? json.data : null;
    if (vendor) {
      setInCache(vendorDetailCache, id, vendor, VENDOR_CACHE_TTL_MS);
    }
    return vendor;
  } catch {
    return null;
  }
}
