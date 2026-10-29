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
import {
  X,
  Send,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Users,
  Search,
  UserPlus,
  Trash2,
  MapPin,
} from 'lucide-react';
import { useApp } from '@/lib/store';
import { fetchAllVendors, fetchVendorCandidates, inviteVendorsToRFQ } from '@/lib/rfqClient';
import { fetchCategoryTaxonomy } from '@/lib/buyerProfileClient';
import { getMajorCategories } from '@/lib/categoryTaxonomy';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { MAX_INVITE_VENDORS, getIndianStates, getCitiesForState } from '@/lib/constants';
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
  const { showToast, categoryTaxonomy } = useApp();

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
  const [stateFilter, setStateFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [categoryOptions, setCategoryOptions] = useState<string[]>(() => getMajorCategories());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Persistent registry of all seen vendor records to resolve names in selected chips
  const knownVendorsRef = useRef<Map<string, RFQVendorCandidate>>(new Map());

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
    setStateFilter('');
    setCityFilter('');
    setLoading(true);
    setError(null);
    setSelected(new Set());
    setAllVendors(null);
    setAllVendorsError(null);
    setAllVendorsPagination(null);
    knownVendorsRef.current.clear();

    void fetchVendorCandidates(rfq.id).then((result) => {
      if (result.success) {
        setCandidates(result.candidates);
        result.candidates.forEach((c) => {
          if (c?.id) knownVendorsRef.current.set(c.id, c);
        });
      } else {
        setError(result.error || S.loadFailed);
      }
      setLoading(false);
    });

    void fetchCategoryTaxonomy()
      .then((result) => {
        if (result.success && Array.isArray(result.data) && result.data.length > 0) {
          const fetched = result.data.map((c) => c.majorCategory).filter(Boolean);
          if (fetched.length > 0) {
            setCategoryOptions(fetched);
          }
        }
      })
      .catch(() => {
        // Fall back gracefully to standard major categories
      });
  }, [isOpen, rfq]);

  // Track known vendors for displaying chip names across searches and filters
  useEffect(() => {
    candidates.forEach((c) => {
      if (c?.id) knownVendorsRef.current.set(c.id, c);
    });
  }, [candidates]);

  useEffect(() => {
    if (allVendors) {
      allVendors.forEach((v) => {
        if (v?.id) knownVendorsRef.current.set(v.id, v);
      });
    }
  }, [allVendors]);

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
  // page 1 whenever the (debounced) search term, category, state, or city filter changes.
  const lastFetchedKeyRef = useRef<string | null>(null);
  const fetchSeqRef = useRef(0);

  useEffect(() => {
    if (!isOpen || !rfq || tab !== 'all') return;
    const key = `${debouncedSearch}|${categoryFilter}|${stateFilter}|${cityFilter}`;
    if (allVendors !== null && lastFetchedKeyRef.current === key) return;
    lastFetchedKeyRef.current = key;
    const seq = ++fetchSeqRef.current;
    setAllVendorsLoading(true);
    setAllVendorsError(null);
    void fetchAllVendors({
      page: 1,
      pageSize: ALL_VENDORS_PAGE_SIZE,
      search: debouncedSearch,
      category: categoryFilter,
      state: stateFilter,
      city: cityFilter,
    }).then((result) => {
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
  }, [isOpen, rfq, tab, debouncedSearch, categoryFilter, stateFilter, cityFilter]);

  const loadMoreAllVendors = () => {
    if (!allVendorsPagination || allVendorsLoadingMore) return;
    const nextPage = allVendorsPagination.page + 1;
    if (nextPage > allVendorsPagination.totalPages) return;
    const seq = ++fetchSeqRef.current;
    setAllVendorsLoadingMore(true);
    void fetchAllVendors({
      page: nextPage,
      pageSize: ALL_VENDORS_PAGE_SIZE,
      search: debouncedSearch,
      category: categoryFilter,
      state: stateFilter,
      city: cityFilter,
    }).then((result) => {
      if (seq !== fetchSeqRef.current) return;
      if (result.success) {
        setAllVendors((prev) => {
          const existingIds = new Set((prev || []).map((v) => v.id));
          const newCandidates = stampInvited(result.candidates).filter((v) => !existingIds.has(v.id));
          return [...(prev || []), ...newCandidates];
        });
        setAllVendorsPagination(result.pagination);
      } else {
        setAllVendorsError(result.error || S.allVendorsLoadFailed);
      }
      setAllVendorsLoadingMore(false);
    });
  };

  const categorySignals = useMemo(() => (rfq ? rfqCategorySignals(rfq) : []), [rfq]);

  const effectiveCategoryOptions = useMemo(() => {
    const set = new Set<string>();

    const baseOptions = categoryOptions.length > 0 ? categoryOptions : getMajorCategories();
    baseOptions.forEach((cat) => {
      if (cat && cat.trim()) set.add(cat.trim());
    });

    if (Array.isArray(categoryTaxonomy)) {
      categoryTaxonomy.forEach((c) => {
        if (c?.majorCategory?.trim()) set.add(c.majorCategory.trim());
      });
    }

    if (rfq?.category?.trim()) set.add(rfq.category.trim());
    if (Array.isArray(rfq?.extractedEntities)) {
      rfq.extractedEntities.forEach((ent) => {
        if (ent.majorCategory?.trim()) set.add(ent.majorCategory.trim());
        if (ent.category?.trim()) set.add(ent.category.trim());
      });
    }

    (allVendors || []).forEach((v) => {
      if (v?.majorCategory?.trim()) set.add(v.majorCategory.trim());
    });
    candidates.forEach((v) => {
      if (v?.majorCategory?.trim()) set.add(v.majorCategory.trim());
    });

    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [categoryOptions, categoryTaxonomy, rfq, allVendors, candidates]);

  // Dynamic available states from taxonomy + loaded vendors
  const availableStates = useMemo(() => {
    const set = new Set<string>();
    getIndianStates().forEach((s) => set.add(s));
    candidates.forEach((v) => {
      if (v.state?.trim()) set.add(v.state.trim());
    });
    (allVendors || []).forEach((v) => {
      if (v.state?.trim()) set.add(v.state.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [candidates, allVendors]);

  // Dynamic available cities based on selected state
  const availableCities = useMemo(() => {
    if (!stateFilter) return [];
    const set = new Set<string>();
    getCitiesForState(stateFilter).forEach((c) => set.add(c));
    const pool = [...candidates, ...(allVendors || [])];
    pool.forEach((v) => {
      const matchesState =
        (v.state && v.state.toLowerCase() === stateFilter.toLowerCase()) ||
        (v.location && v.location.toLowerCase().includes(stateFilter.toLowerCase()));
      if (matchesState && v.city?.trim()) {
        set.add(v.city.trim());
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [stateFilter, candidates, allVendors]);

  const handleStateChange = (newState: string) => {
    setStateFilter(newState);
    setCityFilter('');
  };

  // Filter candidates in Category Matches tab by search, category, state, and city
  const filteredCategoryCandidates = useMemo(() => {
    return candidates.filter((c) => {
      // 1. Search by vendor name or email address
      if (debouncedSearch.trim()) {
        const q = debouncedSearch.trim().toLowerCase();
        const matchName = String(c.name || '').toLowerCase().includes(q);
        const matchEmail = String(c.email || '').toLowerCase().includes(q);
        const matchContact = String(c.contactPerson || '').toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchContact) return false;
      }
      // 2. Category filter
      if (categoryFilter.trim()) {
        const cat = categoryFilter.trim().toLowerCase();
        const matchMajor = String(c.majorCategory || '').toLowerCase() === cat;
        const matchMinors = Array.isArray(c.minorCategories) && c.minorCategories.some((m) => String(m || '').toLowerCase() === cat);
        if (!matchMajor && !matchMinors) return false;
      }
      // 3. State filter
      if (stateFilter.trim()) {
        const st = stateFilter.trim().toLowerCase();
        const matchState = String(c.state || '').toLowerCase() === st;
        const matchLoc = String(c.location || '').toLowerCase().includes(st);
        if (!matchState && !matchLoc) return false;
      }
      // 4. City filter
      if (cityFilter.trim()) {
        const ct = cityFilter.trim().toLowerCase();
        const aliasMatch = ct.match(/^([^(]+)\s*\(([^)]+)\)$/);
        const p1 = aliasMatch ? aliasMatch[1].trim() : ct;
        const p2 = aliasMatch ? aliasMatch[2].trim() : null;
        const vCity = String(c.city || '').toLowerCase().trim();
        const vLoc = String(c.location || '').toLowerCase();
        const matchCity = p2 ? (vCity === ct || vCity === p1 || vCity === p2) : (vCity === ct);
        const matchLoc = p2 ? (vLoc.includes(p1) || vLoc.includes(p2)) : vLoc.includes(ct);
        if (!matchCity && !matchLoc) return false;
      }
      return true;
    });
  }, [candidates, debouncedSearch, categoryFilter, stateFilter, cityFilter]);

  const visibleVendors = tab === 'category' ? filteredCategoryCandidates : allVendors || [];
  const hasMoreAllVendors = !!allVendorsPagination && allVendorsPagination.page < allVendorsPagination.totalPages;

  if (!isOpen || !rfq) return null;

  const invitable = visibleVendors.filter((c) => !c.alreadyInvited);
  const selectableIds = invitable.map((c) => c.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= MAX_INVITE_VENDORS) {
          showToast('Limit Reached', formatString(S.maxSelectionWarning, { max: MAX_INVITE_VENDORS }), 'warning');
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  };

  const removeSelectedVendor = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const clearAllSelected = () => {
    setSelected(new Set());
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        selectableIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        let reachedLimit = false;
        for (const id of selectableIds) {
          if (!next.has(id)) {
            if (next.size >= MAX_INVITE_VENDORS) {
              reachedLimit = true;
              break;
            }
            next.add(id);
          }
        }
        if (reachedLimit) {
          showToast('Limit Reached', formatString(S.maxSelectionWarning, { max: MAX_INVITE_VENDORS }), 'warning');
        }
        return next;
      });
    }
  };

  const handleSubmit = async () => {
    if (selected.size === 0) return;

    // Duplicate-invitation prevention: filter out already invited vendors
    const invitedIds = new Set((rfq.assignedVendors || []).map((v) => v.id));
    const toInvite = Array.from(selected).filter((id) => !invitedIds.has(id));

    if (toInvite.length === 0) {
      showToast('Already Invited', 'All selected vendors have already been invited to this RFQ.', 'warning');
      return;
    }

    if (toInvite.length > MAX_INVITE_VENDORS) {
      showToast('Limit Reached', formatString(S.maxSelectionWarning, { max: MAX_INVITE_VENDORS }), 'warning');
      return;
    }

    setSubmitting(true);
    const result = await inviteVendorsToRFQ(rfq.id, toInvite);
    setSubmitting(false);

    if (result.success) {
      if (result.invitedCount > 0) {
        showToast(
          S.successTitle,
          formatString(S.successMessage, { count: result.invitedCount, rfqNumber: rfq.rfqNumber }),
          'success'
        );
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
        city: newVendorCity.trim() || undefined,
        state: newVendorState.trim() || undefined,
        pincode: newVendorPincode.trim() || undefined,
        location: [newVendorCity.trim(), newVendorState.trim()].filter(Boolean).join(', ') || 'India',
        rating: 4.8,
        source: 'procucev_network',
        alreadyInvited: false,
      };

      knownVendorsRef.current.set(candidateId, newCandidate);
      setCandidates((prev) => [newCandidate, ...prev]);
      if (allVendors) {
        setAllVendors((prev) => (prev ? [newCandidate, ...prev] : null));
      }

      setSelected((prev) => {
        const next = new Set(prev);
        if (next.size < MAX_INVITE_VENDORS) {
          next.add(candidateId);
        }
        return next;
      });

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

  // Resolved list of selected vendors for the removable chips display
  const selectedVendorsList = Array.from(selected).map((id) => {
    const found = knownVendorsRef.current.get(id);
    return {
      id,
      name: found?.name || id,
    };
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 backdrop-blur-sm p-3 sm:p-5 md:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-vendors-modal-title"
      data-testid="invite-vendors-modal"
    >
      <div className="w-full max-w-4xl lg:max-w-5xl rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-slate-200 dark:border-gray-800 my-auto flex flex-col max-h-[92vh] overflow-hidden animate-scale-up">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-200 dark:border-gray-800 shrink-0">
          <div>
            <h2 id="invite-vendors-modal-title" className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Users size={18} className="text-indigo-600 dark:text-indigo-400" /> {S.title}
            </h2>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              {formatString(S.subtitle, { rfqNumber: rfq.rfqNumber })}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label={S.closeAria}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-40 transition-colors"
          >
            <X size={20} />
          </button>
        </header>

        {/* Navigation Tabs & Add Vendor Button */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-3 pb-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="invite-tab-category"
              onClick={() => setTab('category')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                tab === 'category'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-200'
              }`}
            >
              {S.categoryMatchesTab}
            </button>
            <button
              type="button"
              data-testid="invite-tab-all"
              onClick={() => setTab('all')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                tab === 'all'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-200'
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
                setNewVendorMajorCategory(rfq?.category || effectiveCategoryOptions[0] || 'Mechanical & Fluid Equipment');
                setNewVendorMinorCategory(rfq?.extractedEntities?.[0]?.minorCategory || '');
                setNewVendorCity('');
                setNewVendorState('');
                setNewVendorPincode('');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors"
            >
              <UserPlus size={14} />
              <span>Add New Vendor</span>
            </button>
          )}
        </div>

        {/* Responsive Multi-Criteria Filter Bar */}
        <div className="px-6 py-3 bg-slate-50/80 dark:bg-gray-950/40 border-y border-slate-200 dark:border-gray-800 shrink-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5">
            {/* Search Bar: Name or Email */}
            <div className="relative sm:col-span-1 lg:col-span-4">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                data-testid="invite-vendors-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={S.searchPlaceholder}
                className="w-full pl-8 pr-8 py-2 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm transition-all"
              />
              {search && (
                <button
                  type="button"
                  data-testid="clear-search-btn"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
                  aria-label="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Category Filter */}
            <div className="sm:col-span-1 lg:col-span-3">
              <select
                data-testid="invite-vendors-category-filter"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label={S.categoryLabel}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm transition-all"
              >
                <option value="">{S.allCategories}</option>
                {effectiveCategoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* State Filter */}
            <div className="sm:col-span-1 lg:col-span-3">
              <select
                data-testid="invite-vendors-state-filter"
                value={stateFilter}
                onChange={(e) => handleStateChange(e.target.value)}
                aria-label={S.stateLabel}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm transition-all"
              >
                <option value="">{S.stateFilterPlaceholder}</option>
                {availableStates.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            {/* City Filter: Updates based on selected State */}
            <div className="sm:col-span-1 lg:col-span-2">
              <select
                data-testid="invite-vendors-city-filter"
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                disabled={!stateFilter}
                aria-label={S.cityLabel}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm transition-all disabled:opacity-50 disabled:bg-slate-100 dark:disabled:bg-gray-800"
              >
                <option value="">{stateFilter ? S.cityFilterPlaceholder : S.selectStateFirst}</option>
                {availableCities.map((ct) => (
                  <option key={ct} value={ct}>
                    {ct}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Selected Vendors Removable Bar & Counter */}
        {selected.size > 0 && (
          <div
            className="mx-6 mt-3 p-3 rounded-xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 flex flex-col gap-2 shrink-0"
            data-testid="selected-vendors-bar"
          >
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-indigo-900 dark:text-indigo-300">
                  Selected Vendors:
                </span>
                <span
                  data-testid="selected-vendor-count"
                  className="px-2.5 py-0.5 rounded-full bg-indigo-600 text-white text-[11px] font-extrabold shadow-sm"
                >
                  {formatString(S.selectedRatio, { count: selected.size, max: MAX_INVITE_VENDORS })}
                </span>
                {selected.size >= MAX_INVITE_VENDORS && (
                  <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 rounded-md border border-amber-300 dark:border-amber-800">
                    {S.limitReachedNotice}
                  </span>
                )}
              </div>
              <button
                type="button"
                data-testid="clear-all-selected-btn"
                onClick={clearAllSelected}
                className="text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:underline inline-flex items-center gap-1"
              >
                <Trash2 size={12} />
                {S.clearSelection}
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto pr-1">
              {selectedVendorsList.map((v) => (
                <span
                  key={v.id}
                  className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-lg bg-white dark:bg-gray-900 border border-indigo-200 dark:border-indigo-800 text-[11px] text-slate-800 dark:text-gray-200 shadow-sm"
                >
                  <span className="truncate max-w-[140px] font-medium">✓ {v.name}</span>
                  <button
                    type="button"
                    data-testid={`remove-selected-${v.id}`}
                    onClick={() => removeSelectedVendor(v.id)}
                    className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 p-0.5 rounded transition-colors"
                    aria-label={formatString(S.removeVendorAria, { name: v.name })}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Vendors List Body */}
        <div className="flex-1 p-6 space-y-3 overflow-y-auto min-h-[220px]">
          {tab === 'category' && loading && (
            <p className="text-sm text-slate-500 dark:text-gray-450 py-10 text-center flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin text-indigo-600" /> {S.loading}
            </p>
          )}

          {tab === 'category' && !loading && error && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <AlertTriangle size={24} className="text-rose-500" />
              <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
            </div>
          )}

          {tab === 'category' && !loading && !error && candidates.length === 0 && (
            <div className="py-10 text-center space-y-2">
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

          {tab === 'category' && !loading && !error && candidates.length > 0 && visibleVendors.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-gray-450 py-10 text-center">{S.noMatchingVendors}</p>
          )}

          {tab === 'all' && allVendorsLoading && (
            <p className="text-sm text-slate-500 dark:text-gray-450 py-10 text-center flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin text-indigo-600" /> {S.loading}
            </p>
          )}

          {tab === 'all' && !allVendorsLoading && allVendorsError && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <AlertTriangle size={24} className="text-rose-500" />
              <p className="text-sm text-rose-600 dark:text-rose-400">{allVendorsError}</p>
            </div>
          )}

          {tab === 'all' && !allVendorsLoading && !allVendorsError && visibleVendors.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-gray-450 py-10 text-center">{S.noVendorsFound}</p>
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

                <div className="space-y-2">
                  {visibleVendors.map((c) => {
                    const outsideCategory = tab === 'all' && !vendorCoversAnySignal(c, categorySignals);
                    const missingEmail = !c.email;
                    return (
                      <label
                        key={c.id}
                        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                          c.alreadyInvited
                            ? 'bg-slate-50 dark:bg-gray-800/40 border-slate-200 dark:border-gray-700/50 opacity-60 cursor-default'
                            : selected.has(c.id)
                            ? 'bg-indigo-50/90 dark:bg-indigo-950/50 border-indigo-400 dark:border-indigo-600 shadow-sm'
                            : missingEmail
                            ? 'bg-rose-50/40 dark:bg-rose-950/20 border-rose-300 dark:border-rose-800 hover:border-rose-400'
                            : 'bg-white dark:bg-gray-900 border-slate-200 dark:border-gray-800 hover:border-indigo-300 dark:hover:border-indigo-700 shadow-sm'
                        }`}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={c.alreadyInvited || selected.has(c.id)}
                            disabled={c.alreadyInvited}
                            onChange={() => toggle(c.id)}
                          />
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                              c.alreadyInvited || selected.has(c.id)
                                ? 'bg-indigo-600 border-indigo-600 text-white'
                                : 'border-slate-300 dark:border-gray-600'
                            }`}
                          >
                            {(c.alreadyInvited || selected.has(c.id)) && <CheckCircle2 size={12} />}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-slate-900 dark:text-gray-100 truncate">{c.name}</span>
                              {c.email && (
                                <span className="text-[11px] text-slate-500 dark:text-gray-400 truncate">
                                  {c.email}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-gray-400 flex-wrap mt-0.5">
                              <span className="font-medium text-indigo-600 dark:text-indigo-400">{c.majorCategory}</span>
                              {(c.city || c.state || c.location) && (
                                <span className="inline-flex items-center gap-0.5 text-slate-500 dark:text-gray-400">
                                  <MapPin size={10} className="shrink-0" />
                                  <span className="truncate max-w-[220px]">
                                    {[c.city, c.state].filter(Boolean).join(', ') || c.location}
                                  </span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                          {outsideCategory && !c.alreadyInvited && (
                            <span
                              data-testid="outside-category-badge"
                              className="text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded-md border border-amber-200 dark:border-amber-800"
                            >
                              {S.outsideCategoryBadge}
                            </span>
                          )}
                          {c.alreadyInvited && (
                            <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800">
                              {S.alreadyInvitedBadge}
                            </span>
                          )}
                        </div>
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
                    className="w-full mt-2 py-2 rounded-xl border border-dashed border-slate-300 dark:border-gray-700 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 disabled:opacity-50 inline-flex items-center justify-center gap-1.5 transition-colors"
                  >
                    {allVendorsLoadingMore ? (
                      <>
                        <Loader2 size={13} className="animate-spin" /> {S.loading}
                      </>
                    ) : (
                      formatString(S.loadMoreVendors, { pageSize: ALL_VENDORS_PAGE_SIZE })
                    )}
                  </button>
                )}
              </>
            )}
        </div>

        {/* Footer with Clear Count and Action Buttons */}
        <div className="p-4 px-6 border-t border-slate-200 dark:border-gray-800 bg-slate-50/60 dark:bg-gray-950/30 flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500 dark:text-gray-400 font-medium">
            {selected.size > 0 ? (
              <span className="text-indigo-600 dark:text-indigo-400 font-bold">
                {formatString(S.selectedVendorCount, { count: selected.size, max: MAX_INVITE_VENDORS })}
              </span>
            ) : (
              <span>Select up to {MAX_INVITE_VENDORS} vendors</span>
            )}
          </div>
          <div className="flex items-center gap-2">
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
              data-testid="invite-selected-vendors-btn"
              onClick={() => void handleSubmit()}
              disabled={submitting || selected.size === 0}
              className="btn btn-primary text-xs px-4 py-2 font-bold inline-flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
            >
              {submitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {formatString(S.inviteAction, { count: selected.size })}
            </button>
          </div>
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
                    {effectiveCategoryOptions.map((c) => (
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
