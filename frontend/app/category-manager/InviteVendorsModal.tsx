'use client';

// ==============================================================================
// CATEGORY MANAGER — INVITE VENDORS TO AN RFQ
// ==============================================================================
// Category match alone no longer grants a vendor visibility into an RFQ (see
// storeService.vendorCoversRFQ) — it only produces the candidate pool this
// modal fetches and lets the category manager pick from. Modal shell mirrors
// VendorUploadModal.tsx; the checkbox styling mirrors buyer-profile.tsx's
// category-chip pattern.
// ==============================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Send, CheckCircle2, Loader2, AlertTriangle, Users, Search, UserPlus } from 'lucide-react';
import { useApp } from '@/lib/store';
import { fetchAllVendors, fetchVendorCandidates, inviteVendorsToRFQ } from '@/lib/rfqClient';
import { fetchCategoryTaxonomy } from '@/lib/buyerProfileClient';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { RFQItem, RFQVendorCandidate, VendorPageMeta } from '@/lib/types';

// "All Vendors" can legitimately span tens of thousands of rows (the real
// directory is 80k+ vendors) — fetched and rendered a page at a time rather
// than all at once, which previously crashed the browser tab.
const ALL_VENDORS_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 350;

interface InviteVendorsModalProps {
  isOpen: boolean;
  rfq: RFQItem | null;
  onClose: () => void;
  onInvited?: (updatedRfq: RFQItem, invitedCount: number) => void;
}

const S = UI_STRINGS.inviteVendors;

type Tab = 'category' | 'all';

/** Every category string an RFQ carries — mirrors storeService._rfqCategorySignals. */
function rfqCategorySignals(rfq: RFQItem): string[] {
  const signals: string[] = [];
  if (rfq.category) signals.push(rfq.category);
  for (const ent of Array.isArray(rfq.extractedEntities) ? rfq.extractedEntities : []) {
    if (ent.majorCategory) signals.push(ent.majorCategory);
    if (ent.minorCategory) signals.push(ent.minorCategory);
    if (ent.category) signals.push(ent.category);
  }
  return signals;
}

/** Mirrors storeService.vendorCoversCategory's case-insensitive exact match. */
function vendorCoversAnySignal(vendor: RFQVendorCandidate, signals: string[]): boolean {
  const pools = [vendor.majorCategory, ...(Array.isArray(vendor.minorCategories) ? vendor.minorCategories : [])].map(
    (c) => String(c || '').trim().toLowerCase()
  );
  return signals.some((s) => pools.includes(String(s || '').trim().toLowerCase()));
}

export default function InviteVendorsModal({ isOpen, rfq, onClose, onInvited }: InviteVendorsModalProps) {
  const { showToast } = useApp();

  const [tab, setTab] = useState<Tab>('category');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<RFQVendorCandidate[]>([]);
  const [allVendors, setAllVendors] = useState<RFQVendorCandidate[] | null>(null);
  const [allVendorsError, setAllVendorsError] = useState<string | null>(null);
  const [allVendorsLoading, setAllVendorsLoading] = useState(false);
  const [allVendorsLoadingMore, setAllVendorsLoadingMore] = useState(false);
  const [allVendorsPagination, setAllVendorsPagination] = useState<VendorPageMeta | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Add New Vendor (V0 & V2 feature)
  const [showAddVendorModal, setShowAddVendorModal] = useState(false);
  const [creatingVendor, setCreatingVendor] = useState(false);
  const [addVendorError, setAddVendorError] = useState<string | null>(null);
  const [newVendorName, setNewVendorName] = useState('');
  const [newVendorContactPerson, setNewVendorContactPerson] = useState('');
  const [newVendorEmail, setNewVendorEmail] = useState('');
  const [newVendorPhone, setNewVendorPhone] = useState('');
  const [newVendorMajorCategory, setNewVendorMajorCategory] = useState('');
  const [newVendorMinorCategory, setNewVendorMinorCategory] = useState('');
  const [newVendorCity, setNewVendorCity] = useState('');
  const [newVendorState, setNewVendorState] = useState('');
  const [newVendorPincode, setNewVendorPincode] = useState('');

  useEffect(() => {
    if (!isOpen || !rfq) return;
    const signals = rfqCategorySignals(rfq);
    setTab(signals.length === 0 ? 'all' : 'category');
    setSearch('');
    setDebouncedSearch('');
    setCategoryFilter('');
    setLoading(true);
    setError(null);
    setSelected(new Set());
    setAllVendors(null);
    setAllVendorsError(null);
    setAllVendorsPagination(null);
    void fetchVendorCandidates(rfq.id).then((result) => {
      if (result.success) {
        setCandidates(result.candidates);
      } else {
        setError(result.error || S.loadFailed);
      }
      setLoading(false);
    });
    void fetchCategoryTaxonomy().then((result) => {
      if (result.success) {
        setCategoryOptions(result.data.map((c) => c.majorCategory));
      }
    });
  }, [isOpen, rfq]);

  // Debounce free-text search before it re-triggers a server-side page fetch.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const stampInvited = (vendors: RFQVendorCandidate[]): RFQVendorCandidate[] => {
    const invitedIds = new Set((rfq?.assignedVendors || []).map((v) => v.id));
    return vendors.map((v) => ({ ...v, alreadyInvited: invitedIds.has(v.id) }));
  };

  // Fetched lazily on first switch into "All Vendors", and re-fetched from
  // page 1 whenever the (debounced) search term or category filter changes —
  // both run server-side over the whole directory, not just the pages
  // already loaded. Switching tabs back and forth does NOT refetch once a
  // given search+category combination has already been loaded, tracked via
  // lastFetchedKeyRef.
  const lastFetchedKeyRef = useRef<string | null>(null);
  // Guards against a slower, earlier request (e.g. the initial unfiltered
  // load) resolving AFTER a newer, filtered one and overwriting it with
  // stale data — only the most recently *issued* request's response is ever
  // applied.
  const fetchSeqRef = useRef(0);
  useEffect(() => {
    if (!isOpen || !rfq || tab !== 'all') return;
    const key = `${debouncedSearch}|${categoryFilter}`;
    if (allVendors !== null && lastFetchedKeyRef.current === key) return;
    lastFetchedKeyRef.current = key;
    const seq = ++fetchSeqRef.current;
    setAllVendorsLoading(true);
    setAllVendorsError(null);
    void fetchAllVendors({ page: 1, pageSize: ALL_VENDORS_PAGE_SIZE, search: debouncedSearch, category: categoryFilter }).then((result) => {
      if (seq !== fetchSeqRef.current) return;
      if (result.success) {
        setAllVendors(stampInvited(result.candidates));
        setAllVendorsPagination(result.pagination);
      } else {
        setAllVendorsError(result.error || S.allVendorsLoadFailed);
      }
      setAllVendorsLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rfq.assignedVendors is only read via stampInvited at fetch time, not a re-fetch trigger
  }, [isOpen, rfq, tab, debouncedSearch, categoryFilter]);

  const loadMoreAllVendors = () => {
    if (!allVendorsPagination || allVendorsLoadingMore) return;
    const nextPage = allVendorsPagination.page + 1;
    if (nextPage > allVendorsPagination.totalPages) return;
    const seq = ++fetchSeqRef.current;
    setAllVendorsLoadingMore(true);
    void fetchAllVendors({ page: nextPage, pageSize: ALL_VENDORS_PAGE_SIZE, search: debouncedSearch, category: categoryFilter }).then((result) => {
      if (seq !== fetchSeqRef.current) return;
      if (result.success) {
        setAllVendors((prev) => [...(prev || []), ...stampInvited(result.candidates)]);
        setAllVendorsPagination(result.pagination);
      } else {
        setAllVendorsError(result.error || S.allVendorsLoadFailed);
      }
      setAllVendorsLoadingMore(false);
    });
  };

  const categorySignals = useMemo(() => (rfq ? rfqCategorySignals(rfq) : []), [rfq]);

  // "All Vendors" is already server-paginated and server-searched — no
  // further client-side filtering needed (or possible, since only the
  // loaded pages exist in memory).
  const visibleVendors = tab === 'category' ? candidates : allVendors || [];
  const hasMoreAllVendors = !!allVendorsPagination && allVendorsPagination.page < allVendorsPagination.totalPages;

  if (!isOpen || !rfq) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const invitable = visibleVendors.filter((c) => !c.alreadyInvited);
  const selectableIds = invitable.map((c) => c.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  };

  const handleSubmit = async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    const result = await inviteVendorsToRFQ(rfq.id, Array.from(selected));
    setSubmitting(false);
    if (result.success) {
      if (result.invitedCount > 0) {
        showToast(S.successTitle, formatString(S.successMessage, { count: result.invitedCount, rfqNumber: rfq.rfqNumber }), 'success');
      }
      if ((result as any).excludedCount > 0) {
        showToast(
          'Category Mismatch Excluded',
          `${(result as any).excludedCount} vendor(s) were excluded from shortlist due to category mismatch. Profile update emails dispatched.`,
          'warning'
        );
      }
      onInvited?.(result.rfq, result.invitedCount);
      onClose();
    } else {
      showToast(S.failTitle, result.error, 'warning');
    }
  };

  const handleCreateVendorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddVendorError(null);

    const name = newVendorName.trim();
    const contactPerson = newVendorContactPerson.trim();
    const email = newVendorEmail.trim().toLowerCase();
    const phone = newVendorPhone.trim();
    const majorCategory = newVendorMajorCategory.trim() || rfq?.category || 'General';

    if (!name || !contactPerson || !email || !phone || !majorCategory) {
      setAddVendorError('Please fill in all required fields (Name, Contact Person, Email, Phone, Major Category).');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAddVendorError('Please enter a valid email address.');
      return;
    }

    setCreatingVendor(true);
    try {
      const token = authClient.getToken();
      const res = await fetch('/api/vendors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name,
          contactPerson,
          email,
          phone,
          majorCategory,
          minorCategories: newVendorMinorCategory.trim() ? [newVendorMinorCategory.trim()] : [],
          city: newVendorCity.trim() || undefined,
          state: newVendorState.trim() || undefined,
          pincode: newVendorPincode.trim() || undefined,
          source: 'procucev_network',
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 409) {
        const errorMsg = data.error || 'A vendor with this email or contact number is already registered in the system.';
        setAddVendorError(errorMsg);
        showToast('Duplicate Vendor', errorMsg, 'warning');
        return;
      }

      if (!res.ok || !data.success) {
        const errorMsg = data.error || 'Failed to create vendor account.';
        setAddVendorError(errorMsg);
        showToast('Vendor Creation Failed', errorMsg, 'warning');
        return;
      }

      const created = data.vendor || data.data;
      const candidateId = created?.id || String(created?._id) || `cand-created-${Date.now()}`;
      const newCandidate: RFQVendorCandidate = {
        id: candidateId,
        name: created?.name || name,
        email: created?.email || email,
        phone: created?.phone || phone,
        contactPerson: created?.contactPerson || contactPerson,
        majorCategory: created?.majorCategory || majorCategory,
        minorCategories: created?.minorCategories || (newVendorMinorCategory.trim() ? [newVendorMinorCategory.trim()] : []),
        location: [newVendorCity.trim(), newVendorState.trim()].filter(Boolean).join(', ') || 'India',
        rating: 4.8,
        source: 'procucev_network',
        alreadyInvited: false,
      };

      setCandidates((prev) => [newCandidate, ...prev]);
      if (allVendors) {
        setAllVendors((prev) => (prev ? [newCandidate, ...prev] : null));
      }
      setSelected((prev) => new Set([...Array.from(prev), candidateId]));

      showToast(
        'Vendor Registered',
        `${name} has been added as a Procucev Vendor and credentials emailed. Selected for invitation.`,
        'success'
      );
      setShowAddVendorModal(false);
    } catch (err: any) {
      const msg = err?.message || 'Network error occurred while creating vendor.';
      setAddVendorError(msg);
      showToast('Error', msg, 'warning');
    } finally {
      setCreatingVendor(false);
    }
  };

  const sourcingMode = String(rfq?.sourcingMode || '').toLowerCase();
  const isV0OrV2 =
    sourcingMode === 'mode_0' ||
    sourcingMode === 'v0' ||
    sourcingMode === 'version_0' ||
    sourcingMode === 'mode_2' ||
    sourcingMode === 'v2' ||
    sourcingMode === 'version_2';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 backdrop-blur-sm p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-vendors-modal-title"
      data-testid="invite-vendors-modal"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-slate-200 dark:border-gray-800 my-auto">
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-gray-800">
          <div>
            <h2 id="invite-vendors-modal-title" className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Users size={16} className="text-indigo-600 dark:text-indigo-400" /> {S.title}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
              {formatString(S.subtitle, { rfqNumber: rfq.rfqNumber })}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label={S.closeAria}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex items-center justify-between gap-1 px-5 pt-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="invite-tab-category"
              onClick={() => setTab('category')}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                tab === 'category'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-200'
              }`}
            >
              {S.categoryMatchesTab}
            </button>
            <button
              type="button"
              data-testid="invite-tab-all"
              onClick={() => setTab('all')}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                tab === 'all'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-200'
              }`}
            >
              {S.allVendorsTab}
            </button>
          </div>

          {isV0OrV2 && (
            <button
              type="button"
              data-testid="add-new-vendor-button"
              onClick={() => {
                setShowAddVendorModal(true);
                setAddVendorError(null);
                setNewVendorName('');
                setNewVendorContactPerson('');
                setNewVendorEmail('');
                setNewVendorPhone('');
                setNewVendorMajorCategory(rfq?.category || categoryOptions[0] || 'Mechanical & Fluid Equipment');
                setNewVendorMinorCategory(rfq?.extractedEntities?.[0]?.minorCategory || '');
                setNewVendorCity('');
                setNewVendorState('');
                setNewVendorPincode('');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors"
            >
              <UserPlus size={13} />
              <span>Add New Vendor</span>
            </button>
          )}
        </div>

        {tab === 'all' && (
          <div className="px-5 pt-3 flex gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={S.searchPlaceholder}
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-48 px-2 py-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="">All categories</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
          {tab === 'category' && loading && (
            <p className="text-sm text-slate-500 dark:text-gray-450 py-8 text-center flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> {S.loading}
            </p>
          )}

          {tab === 'category' && !loading && error && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <AlertTriangle size={22} className="text-rose-500" />
              <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
            </div>
          )}

          {tab === 'category' && !loading && !error && candidates.length === 0 && (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm text-slate-500 dark:text-gray-450">
                {categorySignals.length === 0
                  ? 'This V0 RFQ was submitted without a category. Switch to the "All Vendors" tab above to search and manually assign suppliers.'
                  : S.noCandidates}
              </p>
              {categorySignals.length === 0 && (
                <button
                  type="button"
                  onClick={() => setTab('all')}
                  className="btn btn-secondary btn-sm text-xs font-bold text-indigo-600 dark:text-indigo-400"
                >
                  Go to All Vendors
                </button>
              )}
            </div>
          )}

          {tab === 'all' && allVendorsLoading && (
            <p className="text-sm text-slate-500 dark:text-gray-450 py-8 text-center flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> {S.loading}
            </p>
          )}

          {tab === 'all' && !allVendorsLoading && allVendorsError && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <AlertTriangle size={22} className="text-rose-500" />
              <p className="text-sm text-rose-600 dark:text-rose-400">{allVendorsError}</p>
            </div>
          )}

          {tab === 'all' && !allVendorsLoading && !allVendorsError && visibleVendors.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-gray-450 py-8 text-center">{S.noVendorsFound}</p>
          )}

          {((tab === 'category' && !loading && !error) || (tab === 'all' && !allVendorsLoading && !allVendorsError)) &&
            visibleVendors.length > 0 && (
              <>
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-450">
                    {tab === 'all' && allVendorsPagination
                      ? formatString(S.candidateCountOfTotal, {
                          count: visibleVendors.length,
                          total: allVendorsPagination.total.toLocaleString(),
                        })
                      : formatString(S.candidateCount, { count: visibleVendors.length })}
                  </span>
                  {selectableIds.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleAll}
                      className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      {allSelected ? S.deselectAll : S.selectAll}
                    </button>
                  )}
                </div>

                <div className="space-y-1.5">
                  {visibleVendors.map((c) => {
                    const outsideCategory = tab === 'all' && !vendorCoversAnySignal(c, categorySignals);
                    const missingEmail = !c.email;
                    return (
                      <label
                        key={c.id}
                        className={`flex items-center gap-3 p-2.5 rounded-xl border text-xs cursor-pointer transition-colors ${
                          c.alreadyInvited
                            ? 'bg-slate-50 dark:bg-gray-800/40 border-slate-200 dark:border-gray-700/50 opacity-60 cursor-default'
                            : selected.has(c.id)
                            ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700'
                            : missingEmail
                            ? 'bg-rose-50/40 dark:bg-rose-950/20 border-rose-300 dark:border-rose-800'
                            : 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800 hover:border-indigo-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={c.alreadyInvited || selected.has(c.id)}
                          disabled={c.alreadyInvited}
                          onChange={() => toggle(c.id)}
                        />
                        <span
                          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                            c.alreadyInvited || selected.has(c.id)
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : 'border-slate-300 dark:border-gray-600'
                          }`}
                        >
                          {(c.alreadyInvited || selected.has(c.id)) && <CheckCircle2 size={12} />}
                        </span>
                        <span className="flex-1">
                          <span className="font-bold text-slate-800 dark:text-gray-200 block">{c.name}</span>
                          <span className="text-slate-500 dark:text-gray-450">{c.majorCategory}</span>
                        </span>
                        {outsideCategory && !c.alreadyInvited && (
                          <span
                            data-testid="outside-category-badge"
                            className="text-[10px] font-bold text-amber-600 dark:text-amber-400 shrink-0"
                          >
                            {S.outsideCategoryBadge}
                          </span>
                        )}
                        {c.alreadyInvited && (
                          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
                            {S.alreadyInvitedBadge}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>

                {tab === 'all' && hasMoreAllVendors && (
                  <button
                    type="button"
                    data-testid="load-more-vendors"
                    onClick={loadMoreAllVendors}
                    disabled={allVendorsLoadingMore}
                    className="w-full mt-2 py-2 rounded-lg border border-dashed border-slate-300 dark:border-gray-700 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                  >
                    {allVendorsLoadingMore ? (
                      <>
                        <Loader2 size={12} className="animate-spin" /> {S.loading}
                      </>
                    ) : (
                      formatString(S.loadMoreVendors, { pageSize: ALL_VENDORS_PAGE_SIZE })
                    )}
                  </button>
                )}
              </>
            )}
        </div>

        <div className="p-4 border-t border-slate-100 dark:border-gray-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="btn btn-secondary text-xs px-4 py-2 font-bold"
          >
            {S.cancelAction}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || selected.size === 0}
            className="btn btn-primary text-xs px-4 py-2 font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {formatString(S.inviteAction, { count: selected.size })}
          </button>
        </div>
      </div>

      {/* Add New Vendor Modal (Sub-modal for V0 and V2) */}
      {showAddVendorModal && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-new-vendor-title"
          data-testid="add-vendor-modal"
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-slate-200 dark:border-gray-800 overflow-hidden animate-scale-up">
            <header className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
                  <UserPlus size={16} />
                </div>
                <div>
                  <h3 id="add-new-vendor-title" className="text-sm font-bold text-slate-900 dark:text-white">
                    Add New Vendor
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-gray-400">
                    Register vendor on Procucev and dispatch credentials
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddVendorModal(false)}
                disabled={creatingVendor}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X size={16} />
              </button>
            </header>

            <form onSubmit={handleCreateVendorSubmit} className="p-5 space-y-3">
              {addVendorError && (
                <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-955/30 border border-amber-350 dark:border-amber-800/50 text-amber-850 dark:text-amber-300 text-xs flex items-start gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>{addVendorError}</span>
                </div>
              )}

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                  Company / Vendor Name *
                </label>
                <input
                  type="text"
                  required
                  value={newVendorName}
                  onChange={(e) => setNewVendorName(e.target.value)}
                  placeholder="e.g. Apex Industrial Supplies Pvt Ltd"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Contact Person *
                  </label>
                  <input
                    type="text"
                    required
                    value={newVendorContactPerson}
                    onChange={(e) => setNewVendorContactPerson(e.target.value)}
                    placeholder="e.g. Rajesh Kumar"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Contact Number *
                  </label>
                  <input
                    type="tel"
                    required
                    value={newVendorPhone}
                    onChange={(e) => setNewVendorPhone(e.target.value)}
                    placeholder="e.g. +91 98765 43210"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                  Email Address (Credentials will be sent here) *
                </label>
                <input
                  type="email"
                  required
                  value={newVendorEmail}
                  onChange={(e) => setNewVendorEmail(e.target.value)}
                  placeholder="e.g. sales@apexindustrial.com"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Major Category *
                  </label>
                  <select
                    value={newVendorMajorCategory}
                    onChange={(e) => setNewVendorMajorCategory(e.target.value)}
                    className="w-full px-2 py-2 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {categoryOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Minor Category
                  </label>
                  <input
                    type="text"
                    value={newVendorMinorCategory}
                    onChange={(e) => setNewVendorMinorCategory(e.target.value)}
                    placeholder="e.g. Valves & Pipes"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">City</label>
                  <input
                    type="text"
                    value={newVendorCity}
                    onChange={(e) => setNewVendorCity(e.target.value)}
                    placeholder="e.g. Mumbai"
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-xs text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">State</label>
                  <input
                    type="text"
                    value={newVendorState}
                    onChange={(e) => setNewVendorState(e.target.value)}
                    placeholder="e.g. Maharashtra"
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-xs text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Pincode</label>
                  <input
                    type="text"
                    value={newVendorPincode}
                    onChange={(e) => setNewVendorPincode(e.target.value)}
                    placeholder="e.g. 400001"
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-xs text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-gray-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddVendorModal(false)}
                  disabled={creatingVendor}
                  className="btn btn-secondary text-xs px-3 py-1.5 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingVendor}
                  className="btn btn-primary text-xs px-4 py-1.5 font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {creatingVendor ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
                  <span>{creatingVendor ? 'Creating...' : 'Create & Select Vendor'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
