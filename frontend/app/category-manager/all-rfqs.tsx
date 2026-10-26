'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { RFQItem, QuoteComparison, RFQAssignedVendor } from '@/lib/types';
import { formatCurrency, formatIndianDateTime } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { fetchAllRFQs } from '@/lib/rfqClient';
import { ClipboardList, Search, ChevronRight, RefreshCw, AlertTriangle, FileText, UserPlus, X, Building2, Store } from 'lucide-react';
import InviteVendorsModal from './InviteVendorsModal';
import BuyerDetailsModal from './BuyerDetailsModal';
import VendorDetailsModal from './VendorDetailsModal';

interface AllRFQsConsoleProps {
  /** Open the comparative quote matrix for one RFQ. */
  onNavigateToMatrix?: (rfq: RFQItem) => void;
  /** Open the full read-only detail view for one RFQ. */
  onViewDetails?: (rfq: RFQItem) => void;
}

const S = UI_STRINGS.allRfqs;

/** Every real RFQ status → badge tone. Covers all members of the union. */
const STATUS_TONE: Record<RFQItem['status'], string> = {
  Parsing: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  'Quotes Pending': 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  'Quotes Received': 'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300',
  'In Evaluation': 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
  'AI Recommended': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  'PO Generated': 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300',
  Closed: 'bg-slate-200 text-slate-800 dark:bg-gray-800 dark:text-slate-300',
  Expired: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
};

const ALL_STATUSES: RFQItem['status'][] = [
  'Parsing',
  'Quotes Pending',
  'Quotes Received',
  'In Evaluation',
  'AI Recommended',
  'PO Generated',
  'Closed',
  'Expired',
];

/**
 * The most recent vendor-quotation submission timestamp on an RFQ, or `null`
 * when no vendor has quoted yet. Each quote stamps `submittedAt` at submission
 * (both the portal and email-ingestion paths do — see rfqController and
 * emailGatewayService), so the latest is simply the max across the quotes.
 */
function latestQuoteSubmittedAt(rfq: RFQItem): string | null {
  const times = (rfq.quotes || [])
    .map((q) => q.submittedAt)
    .filter((t): t is string => !!t && !Number.isNaN(Date.parse(t)));
  if (times.length === 0) return null;
  return times.reduce((latest, t) => (Date.parse(t) > Date.parse(latest) ? t : latest));
}

/** Check if RFQ has any category signal in header or line items */
function rfqHasCategorySignal(rfq: RFQItem): boolean {
  if (rfq.category && rfq.category.trim()) return true;
  for (const ent of Array.isArray(rfq.extractedEntities) ? rfq.extractedEntities : []) {
    if (
      (ent.majorCategory && ent.majorCategory.trim()) ||
      (ent.minorCategory && ent.minorCategory.trim()) ||
      (ent.category && ent.category.trim())
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Category-manager "All RFQs" console.
 *
 * Reads `GET /api/rfqs/all` — the full cross-buyer list, which the server
 * gates to the category_manager/admin roles. Deliberately does not use the
 * store's `rfqs`: that list is loaded through the buyer-scoped endpoint and a
 * category manager who also holds a buyer account would see only their own.
 */
export default function AllRFQsConsole({ onNavigateToMatrix, onViewDetails }: AllRFQsConsoleProps) {
  const [rfqs, setRfqs] = useState<RFQItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [buyerFilter, setBuyerFilter] = useState<string>('all');
  const [inviteTargetRfq, setInviteTargetRfq] = useState<RFQItem | null>(null);

  const [selectedBuyerInfo, setSelectedBuyerInfo] = useState<{
    name: string | null;
    id?: string | null;
    rfq: RFQItem;
  } | null>(null);

  const [selectedVendorInfo, setSelectedVendorInfo] = useState<{
    name: string;
    id?: string | null;
    quote?: QuoteComparison | null;
    assignedVendor?: RFQAssignedVendor | null;
    rfq: RFQItem;
  } | null>(null);

  const [vendorListModalData, setVendorListModalData] = useState<{
    rfq: RFQItem;
    mode: 'quotes' | 'assigned';
  } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const result = await fetchAllRFQs({ summary: true, limit: 100 });
    if (result.success) {
      setRfqs(result.rfqs);
    } else {
      setError(result.error || S.loadFailed);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const buyerNames = useMemo(() => {
    const names = new Set<string>();
    for (const r of rfqs) {
      if (r.buyerAccountName) names.add(r.buyerAccountName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [rfqs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rfqs.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (buyerFilter !== 'all' && (r.buyerAccountName || '') !== buyerFilter) return false;
      if (!q) return true;
      return (
        r.rfqNumber.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        (r.category || '').toLowerCase().includes(q) ||
        (r.buyerAccountName || '').toLowerCase().includes(q) ||
        (r.quotes || []).some((qt) => qt.vendorName?.toLowerCase().includes(q)) ||
        (r.assignedVendors || []).some((av) => (av.name || '').toLowerCase().includes(q))
      );
    });
  }, [rfqs, search, statusFilter, buyerFilter]);
  const hasFilters = search.trim().length > 0 || statusFilter !== 'all' || buyerFilter !== 'all';

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setBuyerFilter('all');
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap pb-1">
        {!loading && !error ? (
          <p className="text-xs font-bold text-slate-500 dark:text-gray-450" data-testid="all-rfqs-count">
            {formatString(S.countSummary, { count: rfqs.length, buyers: buyerNames.length })}
          </p>
        ) : (
          <div />
        )}
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="btn-ghost flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:cursor-wait disabled:opacity-60 dark:border-slate-800 dark:text-gray-250 ml-auto"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> {S.retryAction}
        </button>
      </div>

      <section
        aria-label={S.filtersLabel}
        className="space-y-4 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-gray-950/50 sm:p-5"
      >
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(180px,220px)_minmax(180px,240px)_auto]">
          <div className="min-w-0 sm:col-span-2 lg:col-span-1">
            <label htmlFor="all-rfqs-search" className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-gray-300">
              {S.searchLabel}
            </label>
            <div className="relative">
              <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="all-rfqs-search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label={S.searchLabel}
                placeholder={S.searchPlaceholder}
                className={`input has-leading-icon h-11 w-full rounded-xl border-slate-200 bg-slate-50 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white dark:border-slate-800 dark:bg-gray-950 dark:text-gray-200 dark:focus:bg-gray-900 ${search ? 'has-trailing-icon' : ''}`}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label={S.clearSearch}
                  className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:bg-slate-800 dark:hover:text-gray-200"
                >
                  <X size={15} />
                </button>
              )}
            </div>
          </div>
          <div className="min-w-0">
            <label htmlFor="all-rfqs-status" className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-gray-300">
              {S.statusFilterLabel}
            </label>
            <select
              id="all-rfqs-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label={S.statusFilterLabel}
              className="select h-11 w-full rounded-xl border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 dark:border-slate-800 dark:bg-gray-950 dark:text-gray-200"
            >
              <option value="all">{S.allStatuses}</option>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor="all-rfqs-buyer" className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-gray-300">
              {S.buyerFilterLabel}
            </label>
            <select
              id="all-rfqs-buyer"
              value={buyerFilter}
              onChange={(e) => setBuyerFilter(e.target.value)}
              aria-label={S.buyerFilterLabel}
              className="select h-11 w-full rounded-xl border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 dark:border-slate-800 dark:bg-gray-950 dark:text-gray-200"
            >
              <option value="all">{S.allBuyers}</option>
              {buyerNames.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-slate-800 dark:text-gray-300 dark:hover:bg-gray-900 dark:hover:text-white"
            >
              <X size={14} />
              {S.clearFilters}
            </button>
          )}
        </div>
        {!loading && !error && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <p aria-live="polite" className="text-xs font-medium text-slate-500 dark:text-gray-400">
              {formatString(S.resultCount, { shown: filtered.length, total: rfqs.length })}
            </p>
            {hasFilters && (
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                {S.filtersApplied}
              </span>
            )}
          </div>
        )}
      </section>

      {loading && <p className="text-sm text-slate-500 dark:text-gray-450 py-10 text-center">{S.loading}</p>}

      {!loading && error && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertTriangle size={28} className="text-rose-500" />
          <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="btn-primary text-xs font-bold px-4 py-1.5 rounded-lg bg-indigo-600 text-white"
          >
            {S.retryAction}
          </button>
        </div>
      )}

      {!loading && !error && rfqs.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-gray-450 py-10 text-center">{S.empty}</p>
      )}

      {!loading && !error && rfqs.length > 0 && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
          <Search size={24} aria-hidden="true" className="text-slate-400" />
          <p className="text-sm text-slate-500 dark:text-gray-450">{S.noMatches}</p>
          <button type="button" onClick={clearFilters} className="text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-400">
            {S.clearFilters}
          </button>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-850 dark:bg-gray-950/40">
          <table className="w-full min-w-[1600px] table-fixed text-sm">
            <caption className="sr-only">{S.subtitle}</caption>
            <colgroup>
              <col className="w-[155px]" />
              <col className="w-[220px]" />
              <col className="w-[165px]" />
              <col className="w-[145px]" />
              <col className="w-[75px]" />
              <col className="w-[210px]" />
              <col className="w-[125px]" />
              <col className="w-[105px]" />
              <col className="w-[180px]" />
              <col className="w-[300px]" />
            </colgroup>
            <thead>
              <tr className="bg-slate-50 dark:bg-gray-950 text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-450">
                <th scope="col" className="px-3 py-3 text-left font-bold">{S.colRfqNumber}</th>
                <th scope="col" className="px-3 py-3 text-left font-bold">{S.colTitle}</th>
                <th scope="col" className="px-3 py-3 text-left font-bold">{S.colBuyer}</th>
                <th scope="col" className="px-3 py-3 text-left font-bold">{S.colStatus}</th>
                <th scope="col" className="px-3 py-3 text-right font-bold">{S.colQuotes}</th>
                <th scope="col" className="px-3 py-3 text-left font-bold">{S.colVendors}</th>
                <th scope="col" className="px-3 py-3 text-right font-bold">{S.colBudget}</th>
                <th scope="col" className="px-3 py-3 text-left font-bold">{S.colCreated}</th>
                <th scope="col" className="px-3 py-3 text-left font-bold">{S.colLatestQuote}</th>
                <th scope="col" className="px-3 py-3 text-right font-bold">{S.colActions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
              {filtered.map((rfq) => {
                const isUncategorizedV0 =
                  (rfq.sourcingMode === 'mode_0' || (rfq.sourcingMode as any) === 'v0') &&
                  !rfqHasCategorySignal(rfq) &&
                  (!rfq.assignedVendors || rfq.assignedVendors.length === 0);
                const needsAssignment = Boolean(rfq.needsCategoryManagerAssignment || isUncategorizedV0);

                return (
                <tr key={rfq.id} className="align-middle transition-colors hover:bg-slate-50 dark:hover:bg-gray-900/60">
                  <td className="px-3 py-3 font-mono text-xs font-bold text-slate-800 dark:text-gray-200">{rfq.rfqNumber}</td>
                  <td className="px-3 py-3">
                    <div className="truncate font-bold text-slate-800 dark:text-gray-200" title={rfq.title}>{rfq.title}</div>
                    <div className="truncate text-[11px] text-slate-500 dark:text-gray-450" title={rfq.category || undefined}>{rfq.category || '—'}</div>
                  </td>
                  <td className="break-words px-3 py-3 text-slate-700 dark:text-gray-300">
                    {rfq.buyerAccountName ? (
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedBuyerInfo({
                            name: rfq.buyerAccountName || null,
                            id: rfq.buyerAccountId || null,
                            rfq,
                          })
                        }
                        className="inline-flex items-center gap-1.5 text-left font-bold text-slate-800 dark:text-gray-200 hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline transition-colors group cursor-pointer"
                        title={`Click to view full buyer details for ${rfq.buyerAccountName}`}
                      >
                        <Building2 size={13} className="text-slate-400 group-hover:text-indigo-500 shrink-0 transition-colors" />
                        <span>{rfq.buyerAccountName}</span>
                      </button>
                    ) : (
                      <span className="italic text-slate-400">{S.buyerUnknown}</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-bold ${STATUS_TONE[rfq.status]}`}>
                        {rfq.status}
                      </span>
                      {needsAssignment && (
                        <span className="inline-flex whitespace-nowrap rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 px-1.5 py-0.5 text-[9px] font-bold">
                          Pending CM Assignment
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-700 dark:text-gray-300">{rfq.quotesCount}</td>
                  <td className="px-3 py-3">
                    {rfq.quotes && rfq.quotes.length > 0 ? (
                      <div className="flex flex-col items-start gap-1 max-w-full">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {rfq.quotes.slice(0, 2).map((q, idx) => (
                            <button
                              key={q.vendorId || `${q.vendorName}-${idx}`}
                              type="button"
                              onClick={() =>
                                setSelectedVendorInfo({
                                  name: q.vendorName,
                                  id: q.vendorId,
                                  quote: q,
                                  rfq,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950/70 border border-teal-200 dark:border-teal-800 text-teal-800 dark:text-teal-200 text-xs font-semibold hover:bg-teal-100 dark:hover:bg-teal-900 transition-colors max-w-[135px] truncate cursor-pointer shadow-2xs group"
                              title={`Quoted vendor: ${q.vendorName}. Click to view quotation details.`}
                            >
                              <Store size={11} className="text-teal-600 dark:text-teal-400 shrink-0" />
                              <span className="truncate">{q.vendorName}</span>
                              {q.isBestPrice && (
                                <span className="shrink-0 px-1 py-0.2 rounded text-[9px] font-black bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                  L1
                                </span>
                              )}
                            </button>
                          ))}
                          {rfq.quotes.length > 2 && (
                            <button
                              type="button"
                              onClick={() => setVendorListModalData({ rfq, mode: 'quotes' })}
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 hover:bg-teal-100 dark:hover:bg-teal-900 transition border border-teal-200 dark:border-teal-800 cursor-pointer"
                              title="Click to view all quoted vendors"
                            >
                              +{rfq.quotes.length - 2} more
                            </button>
                          )}
                        </div>
                      </div>
                    ) : rfq.assignedVendors && rfq.assignedVendors.length > 0 ? (
                      <div className="flex flex-col items-start gap-1 max-w-full">
                        <span className="text-[9px] uppercase font-bold tracking-wider text-slate-400 dark:text-gray-500">
                          Invited ({rfq.assignedVendors.length})
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {rfq.assignedVendors.slice(0, 2).map((av, idx) => {
                            const vName = av.name || (av as any).vendorName || 'Vendor';
                            const vId = av.id || (av as any).vendorId || null;
                            return (
                              <button
                                key={vId || idx}
                                type="button"
                                onClick={() =>
                                  setSelectedVendorInfo({
                                    name: vName,
                                    id: vId,
                                    assignedVendor: av,
                                    rfq,
                                  })
                                }
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors max-w-[125px] truncate cursor-pointer"
                                title={`Invited vendor: ${vName}. Click to view details.`}
                              >
                                <Store size={10} className="text-slate-400 shrink-0" />
                                <span className="truncate">{vName}</span>
                              </button>
                            );
                          })}
                          {rfq.assignedVendors.length > 2 && (
                            <button
                              type="button"
                              onClick={() => setVendorListModalData({ rfq, mode: 'assigned' })}
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition border border-indigo-200 dark:border-indigo-800 cursor-pointer"
                              title="Click to view all invited vendors"
                            >
                              +{rfq.assignedVendors.length - 2} more
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="italic text-slate-400 text-xs">{S.colVendorsNone}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs text-slate-700 dark:text-gray-300">
                    {rfq.budget > 0 ? formatCurrency(rfq.budget) : <span className="text-slate-400">{S.budgetUnset}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-[11px] text-slate-500 dark:text-gray-450">
                    {rfq.createdAt ? new Date(rfq.createdAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-3 text-[11px] text-slate-600 dark:text-gray-300" data-testid="all-rfqs-latest-quote">
                    {(() => {
                      const latest = latestQuoteSubmittedAt(rfq);
                      return latest ? (
                        <span className="whitespace-nowrap font-semibold">{formatIndianDateTime(latest)}</span>
                      ) : (
                        <span className="italic text-slate-400">{S.latestQuoteNone}</span>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-nowrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setInviteTargetRfq(rfq)}
                        aria-label={formatString(S.inviteVendorsAria, { rfqNumber: rfq.rfqNumber })}
                        className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-bold hover:underline ${
                          needsAssignment ? 'text-indigo-600 dark:text-indigo-400 font-extrabold' : 'text-slate-600 dark:text-gray-300'
                        }`}
                      >
                        <UserPlus size={13} /> {needsAssignment ? 'Assign Vendors' : S.inviteVendorsAction}
                      </button>
                      <button
                        type="button"
                        onClick={() => onViewDetails?.(rfq)}
                        aria-label={formatString(S.viewDetailsAria, { rfqNumber: rfq.rfqNumber })}
                        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-bold text-slate-600 hover:underline dark:text-gray-300"
                      >
                        <FileText size={13} /> {S.viewDetailsAction}
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigateToMatrix?.(rfq)}
                        aria-label={formatString(S.viewMatrixAria, { rfqNumber: rfq.rfqNumber })}
                        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {S.viewMatrixAction} <ChevronRight size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
      )}

      <InviteVendorsModal
        isOpen={inviteTargetRfq !== null}
        rfq={inviteTargetRfq}
        onClose={() => setInviteTargetRfq(null)}
        onInvited={(updatedRfq) => {
          setRfqs((prev) => prev.map((r) => (r.id === updatedRfq.id ? updatedRfq : r)));
        }}
      />

      <BuyerDetailsModal
        isOpen={selectedBuyerInfo !== null}
        buyerName={selectedBuyerInfo?.name}
        buyerAccountId={selectedBuyerInfo?.id}
        rfq={selectedBuyerInfo?.rfq}
        onClose={() => setSelectedBuyerInfo(null)}
      />

      <VendorDetailsModal
        isOpen={selectedVendorInfo !== null}
        vendorName={selectedVendorInfo?.name}
        vendorId={selectedVendorInfo?.id}
        quote={selectedVendorInfo?.quote}
        assignedVendor={selectedVendorInfo?.assignedVendor}
        rfq={selectedVendorInfo?.rfq}
        onClose={() => setSelectedVendorInfo(null)}
        onNavigateToMatrix={onNavigateToMatrix}
      />

      {/* Multiple Vendors Overview Modal */}
      {vendorListModalData && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setVendorListModalData(null);
          }}
        >
          <div className="relative w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4 bg-white/95 dark:bg-gray-900/95">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="rounded-xl bg-teal-50 dark:bg-teal-950/70 p-2 text-teal-600 dark:text-teal-400 shrink-0">
                  <Store size={20} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-black text-slate-900 dark:text-white truncate">
                    {vendorListModalData.mode === 'quotes'
                      ? `Quoted Vendors (${vendorListModalData.rfq.quotes?.length || 0})`
                      : `Invited Vendors (${vendorListModalData.rfq.assignedVendors?.length || 0})`}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-gray-450 truncate">
                    {vendorListModalData.rfq.rfqNumber} • {vendorListModalData.rfq.title}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setVendorListModalData(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2 flex-1 divide-y divide-slate-100 dark:divide-slate-800/60">
              {vendorListModalData.mode === 'quotes'
                ? (vendorListModalData.rfq.quotes || []).map((q, idx) => (
                    <div
                      key={q.vendorId || idx}
                      className="pt-2.5 first:pt-0 flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-gray-800/50 transition border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 dark:text-white text-sm truncate">
                            {q.vendorName}
                          </span>
                          {q.isBestPrice && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                              L1 Best Price
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-gray-450 mt-1">
                          <span>Total: <strong className="text-slate-800 dark:text-gray-200">{formatCurrency(q.totalPrice)}</strong></span>
                          <span>Lead: <strong>{q.leadTimeDays}d</strong></span>
                          <span>Warranty: <strong>{q.warrantyYears || 0}y</strong></span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const targetRfq = vendorListModalData.rfq;
                          setVendorListModalData(null);
                          setSelectedVendorInfo({
                            name: q.vendorName,
                            id: q.vendorId,
                            quote: q,
                            rfq: targetRfq,
                          });
                        }}
                        className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white transition shadow-xs cursor-pointer"
                      >
                        View Details
                      </button>
                    </div>
                  ))
                : (vendorListModalData.rfq.assignedVendors || []).map((av, idx) => {
                    const vName = av.name || (av as any).vendorName || 'Vendor';
                    const vId = av.id || (av as any).vendorId || null;
                    return (
                      <div
                        key={vId || idx}
                        className="pt-2.5 first:pt-0 flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-gray-800/50 transition border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
                      >
                        <div className="min-w-0">
                          <span className="font-bold text-slate-900 dark:text-white text-sm truncate block">
                            {vName}
                          </span>
                          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-gray-450 mt-0.5 flex-wrap">
                            {av.contactPerson && <span>Contact: {av.contactPerson}</span>}
                            {av.city && <span>{av.city}</span>}
                            <span className="italic text-amber-600 dark:text-amber-400">Awaiting Quotation</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const targetRfq = vendorListModalData.rfq;
                            setVendorListModalData(null);
                            setSelectedVendorInfo({
                              name: vName,
                              id: vId,
                              assignedVendor: av,
                              rfq: targetRfq,
                            });
                          }}
                          className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-xs cursor-pointer"
                        >
                          View Details
                        </button>
                      </div>
                    );
                  })}
            </div>

            <div className="flex items-center justify-end border-t border-slate-200 dark:border-slate-800 px-5 py-3 bg-slate-50/80 dark:bg-gray-950/80">
              <button
                type="button"
                onClick={() => setVendorListModalData(null)}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
