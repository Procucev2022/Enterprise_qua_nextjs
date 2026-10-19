'use client';

/**
 * Public Vendor Directory — /vendors
 *
 * No authentication required. Open to all visitors.
 * Components modularly imported from co-located modules:
 * - VendorCard
 * - VendorFilterSidebar
 * - VendorDetailModal
 * - VendorEmptyState
 * All UI strings sourced from UI_STRINGS.publicVendorDirectory.
 * Zero direct DOM manipulation — all state is declarative React.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicVendor, PublicVendorFilterState } from '@/lib/types';
import { fetchPublicVendors } from '@/lib/vendorDirectoryClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import {
  Building2,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  Filter,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { DEFAULT_FILTER } from './vendorUtils';
import VendorCard from './VendorCard';
import VendorDetailModal from './VendorDetailModal';
import VendorFilterSidebar from './VendorFilterSidebar';
import VendorEmptyState from './VendorEmptyState';

const S = UI_STRINGS.publicVendorDirectory;

export default function PublicVendorDirectoryPage() {
  const [filter, setFilter] = useState<PublicVendorFilterState>(DEFAULT_FILTER);
  const [vendors, setVendors] = useState<PublicVendor[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 24, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<PublicVendor | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadVendors = useCallback(async (f: PublicVendorFilterState) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPublicVendors(f);
      if (result.success) {
        setVendors(result.data);
        setPagination(result.pagination);
      } else {
        setError(result.error || S.errorText);
        setVendors([]);
      }
    } catch {
      setError(S.errorText);
      setVendors([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce search by 350ms, immediate for filter dropdown changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadVendors(filter);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filter, loadVendors]);

  function updateFilter(patch: Partial<PublicVendorFilterState>) {
    setFilter((prev) => ({
      ...prev,
      ...patch,
      page: patch.page !== undefined ? patch.page : 1,
    }));
  }

  function clearFilters() {
    setFilter(DEFAULT_FILTER);
  }

  function goToPage(p: number) {
    updateFilter({ page: p });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const hasActiveFilters = useMemo(
    () =>
      filter.search !== '' ||
      filter.category !== 'all' ||
      filter.state !== 'all' ||
      filter.minRating > 0 ||
      filter.verifiedOnly,
    [filter]
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#04060b]">
      {/* ── Hero Banner ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#074193] via-[#0a3a7a] to-[#001d5c] dark:from-[#030f2a] dark:via-[#040c1e] dark:to-[#020913]">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 50%, #00dbff 0%, transparent 50%), radial-gradient(circle at 80% 20%, #ff4800 0%, transparent 40%)',
          }}
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <Building2 size={20} className="text-[#00dbff]" />
            </div>
            <span className="text-[#00dbff] text-sm font-semibold tracking-widest uppercase">
              Procucev Enterprise
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-3">
            {S.title}
          </h1>
          <p className="text-blue-200 dark:text-blue-300 text-base sm:text-lg max-w-2xl">
            {S.subtitle}
          </p>

          {/* Search bar */}
          <div className="mt-8 relative max-w-2xl">
            <Search
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            />
            <input
              id="vendor-directory-search"
              type="text"
              value={filter.search}
              onChange={(e) => updateFilter({ search: e.target.value })}
              placeholder={S.searchPlaceholder}
              maxLength={200}
              className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 border border-white/20 dark:border-slate-700 shadow-xl focus:outline-none focus:ring-2 focus:ring-[#00dbff]/60 text-sm"
            />
            {filter.search && (
              <button
                onClick={() => updateFilter({ search: '' })}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 transition-colors"
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Main Layout: Sidebar & Content ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex gap-8">
          {/* Desktop Filter Sidebar */}
          <aside className="hidden lg:block w-64 shrink-0 space-y-5">
            <VendorFilterSidebar
              filter={filter}
              hasActiveFilters={hasActiveFilters}
              onUpdateFilter={updateFilter}
              onClearFilters={clearFilters}
            />
          </aside>

          {/* Main Vendor Content Grid */}
          <main className="flex-1 min-w-0">
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <button
                  id="vendor-filter-mobile-toggle"
                  onClick={() => setSidebarOpen(true)}
                  className="lg:hidden flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  <Filter size={14} />
                  Filters
                  {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-blue-600" />}
                </button>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {loading
                    ? S.loadingText
                    : formatString(S.totalFound, {
                        count: pagination.total.toLocaleString('en-IN'),
                      })}
                </p>
              </div>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <X size={11} /> {S.clearFilters}
                </button>
              )}
            </div>

            {/* Error banner */}
            {error && !loading && (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/60 mb-6">
                <AlertCircle size={16} className="text-red-600 dark:text-red-400 shrink-0" />
                <span className="text-sm text-red-700 dark:text-red-300 flex-1">{error}</span>
                <button
                  onClick={() => loadVendors(filter)}
                  className="flex items-center gap-1 text-xs font-semibold text-red-700 dark:text-red-400 hover:underline"
                >
                  <RefreshCw size={11} /> {S.retryButton}
                </button>
              </div>
            )}

            {/* Loading skeleton */}
            {loading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-52 rounded-2xl bg-slate-200 dark:bg-slate-800 animate-pulse"
                  />
                ))}
              </div>
            )}

            {/* Vendor grid */}
            {!loading && !error && vendors.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {vendors.map((v) => (
                  <VendorCard
                    key={v.id ?? v.name}
                    vendor={v}
                    onViewDetails={setSelectedVendor}
                  />
                ))}
              </div>
            )}

            {/* Empty state */}
            {!loading && !error && vendors.length === 0 && (
              <VendorEmptyState onClear={clearFilters} />
            )}

            {/* Pagination Controls */}
            {!loading && pagination.totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-2">
                <button
                  id="vendor-pagination-prev"
                  onClick={() => goToPage(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={15} /> {S.pagination.previous}
                </button>
                <span className="px-4 py-2 text-sm text-slate-500 dark:text-slate-400">
                  {formatString(S.pagination.pageOf, {
                    page: pagination.page,
                    total: pagination.totalPages,
                  })}
                </span>
                <button
                  id="vendor-pagination-next"
                  onClick={() => goToPage(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {S.pagination.next} <ChevronRight size={15} />
                </button>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Mobile Filter Drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setSidebarOpen(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="absolute inset-y-0 left-0 w-72 bg-white dark:bg-slate-900 shadow-2xl p-6 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <VendorFilterSidebar
              filter={filter}
              hasActiveFilters={hasActiveFilters}
              onUpdateFilter={updateFilter}
              onClearFilters={clearFilters}
              isMobile={true}
              onCloseMobile={() => setSidebarOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Vendor Detail Modal */}
      {selectedVendor && (
        <VendorDetailModal
          vendor={selectedVendor}
          onClose={() => setSelectedVendor(null)}
        />
      )}
    </div>
  );
}
