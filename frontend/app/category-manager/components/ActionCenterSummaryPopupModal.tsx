'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Layers,
} from 'lucide-react';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { ActionCenterSummaryPopupModalProps, ActionCenterSummaryPopupColumn } from '@/lib/types';

export default function ActionCenterSummaryPopupModal<T extends object = Record<string, unknown>>({
  isOpen,
  onClose,
  title,
  subtitle,
  totalCount,
  columns,
  records,
  searchPlaceholder,
  searchKeys,
  initialPageSize = 10,
}: ActionCenterSummaryPopupModalProps<T>) {
  const strings = UI_STRINGS.actionCenter.summaryModal;

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize] = useState<number>(initialPageSize);

  // Reset internal search and page when opening or title changes
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setCurrentPage(1);
      setSortKey(null);
      setSortOrder('asc');
    }
  }, [isOpen, title]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Filter records based on search query
  const filteredRecords = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return records;

    return records.filter((item) => {
      if (searchKeys && searchKeys.length > 0) {
        return searchKeys.some((k) => {
          const val = (item as Record<string, unknown>)[k];
          if (val === null || val === undefined) return false;
          return String(val).toLowerCase().includes(q);
        });
      }

      // Default: inspect all string or number properties of the record
      return Object.values(item as object).some((val) => {
        if (typeof val === 'string' || typeof val === 'number') {
          return String(val).toLowerCase().includes(q);
        }
        return false;
      });
    });
  }, [records, searchQuery, searchKeys]);

  // Sort records
  const sortedRecords = useMemo(() => {
    if (!sortKey) return filteredRecords;

    return [...filteredRecords].sort((a, b) => {
      const valA = (a as Record<string, unknown>)[sortKey];
      const valB = (b as Record<string, unknown>)[sortKey];

      if (valA === undefined || valA === null) return 1;
      if (valB === undefined || valB === null) return -1;

      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortOrder === 'asc' ? valA - valB : valB - valA;
      }

      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();
      return sortOrder === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
    });
  }, [filteredRecords, sortKey, sortOrder]);

  // Pagination
  const totalItems = sortedRecords.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);

  const paginatedRecords = useMemo(() => {
    return sortedRecords.slice(startIndex, endIndex);
  }, [sortedRecords, startIndex, endIndex]);

  const handleSort = (col: ActionCenterSummaryPopupColumn<T>) => {
    if (col.sortable === false) return;
    if (sortKey === col.key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col.key);
      setSortOrder('asc');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="summary-popup-title"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden text-xs"
      >
        {/* Header */}
        <div className="px-4 py-3 sm:px-5 sm:py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/60 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shrink-0">
              <Layers className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3
                  id="summary-popup-title"
                  className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate"
                >
                  {title}
                </h3>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shrink-0">
                  {formatString(strings.totalRecordsBadge, { count: String(totalCount) })}
                </span>
              </div>
              {subtitle && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={strings.closeBtn}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Toolbar */}
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
          <div className="relative w-full">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder={searchPlaceholder || strings.searchPlaceholder}
              className="w-full pl-8 pr-7 py-1.5 h-8.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setCurrentPage(1);
                }}
                className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Data Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-10">
              <tr>
                {columns.map((col) => {
                  const isSorted = sortKey === col.key;
                  const isSortable = col.sortable !== false;
                  return (
                    <th
                      key={col.key}
                      onClick={() => isSortable && handleSort(col)}
                      className={`px-3 py-2 font-semibold whitespace-nowrap ${
                        isSortable ? 'cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-slate-800' : ''
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>{col.label}</span>
                        {isSortable && (
                          <span className="text-slate-400">
                            {isSorted ? (
                              sortOrder === 'asc' ? (
                                <ArrowUp className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                              ) : (
                                <ArrowDown className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-slate-300 dark:text-slate-600 opacity-60" />
                            )}
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
              {paginatedRecords.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-10 text-center text-slate-400">
                    <p className="font-medium">{strings.noRecordsFound}</p>
                  </td>
                </tr>
              ) : (
                paginatedRecords.map((item, rowIdx) => {
                  const itemRec = item as Record<string, unknown>;
                  const rowKey = String(itemRec.id || itemRec.accountId || itemRec.rfqNumber || `row-${rowIdx}`);
                  return (
                    <tr
                      key={rowKey}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {columns.map((col) => {
                        const content = col.render
                          ? col.render(item)
                          : ((itemRec[col.key] as React.ReactNode) ?? '–');
                        return (
                          <td key={col.key} className="px-3 py-2 whitespace-nowrap">
                            {content}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer with Pagination and Close */}
        <div className="px-4 py-2.5 sm:px-5 sm:py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col sm:flex-row items-center justify-between gap-2 shrink-0">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {totalItems > 0 ? (
              formatString(strings.showingRecords, {
                from: String(startIndex + 1),
                to: String(endIndex),
                total: String(totalItems),
              })
            ) : (
              formatString(strings.showingRecords, {
                from: '0',
                to: '0',
                total: '0',
              })
            )}
          </div>

          <div className="flex items-center gap-2">
            {totalPages > 1 && (
              <div className="flex items-center gap-1 mr-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  aria-label={strings.previous}
                  className="p-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[11px] text-slate-600 dark:text-slate-400 px-1.5 font-medium">
                  {formatString(strings.pageIndicator, {
                    current: String(safePage),
                    total: String(totalPages),
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  aria-label={strings.next}
                  className="p-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer"
            >
              {strings.closeBtn}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
