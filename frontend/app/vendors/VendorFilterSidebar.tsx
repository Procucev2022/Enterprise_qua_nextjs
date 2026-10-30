'use client';

import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import type { PublicVendorFilterState } from '@/lib/types';
import { UI_STRINGS } from '@/lib/uiStrings';
import { INDIAN_STATES } from '@/lib/validationSchemas';
import { MAJOR_CATEGORIES } from './vendorUtils';

const S = UI_STRINGS.publicVendorDirectory;

export function FilterSection({
  id,
  label,
  children,
}: {
  id?: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      {label && (
        <label
          htmlFor={id}
          className="block text-[10px] uppercase tracking-wider font-semibold text-slate-400 dark:text-slate-500 mb-1.5 cursor-pointer"
        >
          {label}
        </label>
      )}
      {children}
    </div>
  );
}

export function formatCategoryLabel(cat: string): string {
  if (!cat) return '';
  if (/[A-Z]/.test(cat)) return cat;
  return cat.replace(/\b\w/g, (char) => char.toUpperCase());
}

interface VendorFilterSidebarProps {
  filter: PublicVendorFilterState;
  hasActiveFilters: boolean;
  onUpdateFilter: (patch: Partial<PublicVendorFilterState>) => void;
  onClearFilters: () => void;
  categories?: string[];
  states?: string[];
  isMobile?: boolean;
  onCloseMobile?: () => void;
}

export default function VendorFilterSidebar({
  filter,
  hasActiveFilters,
  onUpdateFilter,
  onClearFilters,
  categories,
  states,
  isMobile = false,
  onCloseMobile,
}: VendorFilterSidebarProps) {
  const idSuffix = isMobile ? '-mobile' : '';
  const categoryId = `vendor-filter-category${idSuffix}`;
  const stateId = `vendor-filter-state${idSuffix}`;
  const ratingId = `vendor-filter-rating${idSuffix}`;

  const categoryList = useMemo(() => {
    const base = categories && categories.length > 0 ? categories : MAJOR_CATEGORIES.slice(1);
    if (filter.category && filter.category !== 'all' && !base.includes(filter.category)) {
      return [filter.category, ...base];
    }
    return base;
  }, [categories, filter.category]);

  const stateList = useMemo(() => {
    const base = states && states.length > 0 ? states : INDIAN_STATES;
    if (filter.state && filter.state !== 'all' && !base.includes(filter.state)) {
      return [filter.state, ...base];
    }
    return base;
  }, [states, filter.state]);

  return (
    <div
      className={
        isMobile
          ? ''
          : 'bg-white dark:bg-slate-900/80 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm p-5 sticky top-6'
      }
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
          {S.filterHeading}
        </h2>
        {isMobile && onCloseMobile && (
          <button
            id="vendor-filter-close-mobile"
            onClick={onCloseMobile}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500"
            aria-label="Close filters"
          >
            <X size={16} />
          </button>
        )}
        {!isMobile && hasActiveFilters && (
          <button
            onClick={onClearFilters}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            {S.clearFilters}
          </button>
        )}
      </div>

      {/* Category Filter */}
      <FilterSection id={categoryId} label="Category">
        <select
          id={categoryId}
          value={filter.category}
          onChange={(e) => {
            onUpdateFilter({ category: e.target.value });
            if (isMobile && onCloseMobile) onCloseMobile();
          }}
          className="w-full text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        >
          <option value="all">{S.allCategories}</option>
          {categoryList.map((c) => (
            <option key={c} value={c}>
              {formatCategoryLabel(c)}
            </option>
          ))}
        </select>
      </FilterSection>

      {/* State Filter */}
      <FilterSection id={stateId} label="State / Region">
        <select
          id={stateId}
          value={filter.state}
          onChange={(e) => {
            onUpdateFilter({ state: e.target.value });
            if (isMobile && onCloseMobile) onCloseMobile();
          }}
          className="w-full text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        >
          <option value="all">{S.allStates}</option>
          {stateList.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </FilterSection>

      {/* Minimum Rating */}
      <FilterSection id={ratingId} label={S.ratingFilterLabel}>
        <select
          id={ratingId}
          value={filter.minRating}
          onChange={(e) => {
            onUpdateFilter({ minRating: Number(e.target.value) });
            if (isMobile && onCloseMobile) onCloseMobile();
          }}
          className="w-full text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        >
          <option value={0}>{S.allRatings}</option>
          <option value={3}>3+ ★★★</option>
          <option value={4}>4+ ★★★★</option>
          <option value={4.5}>4.5+ ★★★★½</option>
        </select>
      </FilterSection>

      {/* Verified Only */}
      <FilterSection label="">
        <label
          id={`vendor-filter-verified-label${idSuffix}`}
          className="flex items-center gap-2 cursor-pointer"
        >
          <input
            id={`vendor-filter-verified${idSuffix}`}
            type="checkbox"
            checked={filter.verifiedOnly}
            onChange={(e) => onUpdateFilter({ verifiedOnly: e.target.checked })}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-slate-700 dark:text-slate-300">
            {S.verifiedOnlyLabel}
          </span>
        </label>
      </FilterSection>

      {isMobile && hasActiveFilters && (
        <button
          onClick={() => {
            onClearFilters();
            if (onCloseMobile) onCloseMobile();
          }}
          className="mt-4 w-full py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          {S.clearFilters}
        </button>
      )}
    </div>
  );
}
