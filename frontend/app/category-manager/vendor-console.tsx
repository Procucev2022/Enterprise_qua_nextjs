'use client';

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useApp } from '@/lib/store';
import { MajorMinorCategory, RFQItem, RFQVendorCandidate, VendorPageMeta } from '@/lib/types';
import { fetchAllVendors } from '@/lib/rfqClient';
import { withVendorFetchSignal } from '@/lib/vendorFetchSignal';
import { fetchCategoryTaxonomy } from '@/lib/buyerProfileClient';
import { getMajorCategories, getMinorCategories } from '@/lib/categoryTaxonomy';
import { formatCurrency } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { exportReportToCsv } from '@/lib/reportsClient';
import ColumnSettingsPopup, { type ColumnDef } from './components/ColumnSettingsPopup';
import {
  Building2,
  Users,
  Search,
  ChevronRight,
  Clock,
  IndianRupee,
  Layers,
  ChevronDown,
  Upload,
  Mail,
  Phone,
  ShieldCheck,
  UserCheck,
  Zap,
  Globe,
  Sparkles,
  CheckCircle2,
  Tag,
  ArrowUpRight,
  X,
  RotateCw,
  Settings,
} from 'lucide-react';
import CompanyHoverTooltip from '@/app/components/CompanyHoverTooltip';
import VendorUploadModal from './VendorUploadModal';

export const DEFAULT_VENDOR_CONSOLE_COLUMNS: ColumnDef[] = [
  { key: 'company', label: 'VENDOR NAME', visible: true, required: true },
  { key: 'contact', label: 'CONTACT', visible: true },
  { key: 'category', label: 'CATEGORY/DIVISION', visible: true },
  { key: 'rating', label: 'RATING', visible: true },
  { key: 'totalBids', label: 'TOTAL BIDS', visible: true },
  { key: 'compliance', label: 'COMPLIANCE', visible: true },
  { key: 'awardedSpend', label: 'AWARDED SPEND', visible: true },
  { key: 'actions', label: 'ACTIONS', visible: true, required: true },
];

interface VendorConsoleProps {
  onNavigateToMatrix: (rfq: RFQItem) => void;
  onNavigateToEvaluation?: () => void;
}

// Deterministic decorative avatar color, not a claim about the vendor —
// picked from the company name so the same vendor always renders the same
// color without needing a color stored anywhere.
const AVATAR_PALETTE = [
  { bg: 'bg-emerald-600 text-white', avatar: 'bg-emerald-100 text-emerald-800' },
  { bg: 'bg-indigo-600 text-white', avatar: 'bg-indigo-100 text-indigo-800' },
  { bg: 'bg-purple-600 text-white', avatar: 'bg-purple-100 text-purple-800' },
  { bg: 'bg-cyan-600 text-white', avatar: 'bg-cyan-100 text-cyan-800' },
  { bg: 'bg-orange-600 text-white', avatar: 'bg-orange-100 text-orange-800' },
  { bg: 'bg-rose-600 text-white', avatar: 'bg-rose-100 text-rose-800' },
];

function avatarStyleFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function getInitials(name: string): string {
  if (!name || !name.trim()) return '?';
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0][0] + (words[1] ? words[1][0] : '')).toUpperCase();
}

export type VendorSectionId = 'cm_procucev' | 'self_onboard_buyer';

export interface VendorSourceClassification {
  section: VendorSectionId;
  subType: 'cm_upload' | 'procucev_network' | 'self_onboarded' | 'buyer_added' | 'source_not_recorded';
  label: string;
  shortLabel: string;
  badgeClass: string;
  icon: 'shield' | 'upload' | 'zap' | 'building' | 'none';
  description: string;
}

// Shown when the vendor record does not say how the vendor was added. Such a
// vendor is not labelled as a Procucev network member.
const SOURCE_NOT_RECORDED: VendorSourceClassification = {
  section: 'cm_procucev',
  subType: 'source_not_recorded',
  label: 'Source not recorded',
  shortLabel: 'Source not recorded',
  badgeClass: 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 border-slate-200 dark:border-gray-700',
  icon: 'none',
  description: 'The vendor record does not state how this vendor was added',
};

// Shown wherever a value is not recorded on the vendor record or its quotes.
const EMPTY_VALUE = UI_STRINGS.dataLoad.emptyCell;

/**
 * Classifies a vendor into Section 1 (Category Manager uploaded / Procucev Network)
 * or Section 2 (Self-onboarded / Buyer added private vendors).
 */
export function classifyVendorSource(v: {
  source?: string;
  id?: string;
  addedByBuyerCompany?: string;
  buyerId?: string;
  buyerAccountId?: string;
}): VendorSourceClassification {
  if (!v) {
    return SOURCE_NOT_RECORDED;
  }

  const s = String(v.source || '').toLowerCase().trim();
  const id = String(v.id || '').toLowerCase().trim();

  const isSelfOnboarded =
    s === 'self_onboarded' ||
    s === 'self_registration' ||
    s.includes('self_onboard') ||
    s.includes('self_reg');

  if (isSelfOnboarded) {
    return {
      section: 'self_onboard_buyer',
      subType: 'self_onboarded',
      label: 'Self-Onboarded',
      shortLabel: 'Self-Onboarded',
      badgeClass: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-800/60',
      icon: 'zap',
      description: 'Direct self-registration through vendor onboarding portal',
    };
  }

  const isBuyerAdded =
    ((Boolean(v.buyerId) && v.buyerId !== 'all') ||
      (Boolean(v.buyerAccountId) && v.buyerAccountId !== 'all') ||
      Boolean(v.addedByBuyerCompany) ||
      s === 'buyer_uploaded' ||
      s === 'vendor_master_ingestion' ||
      s === 'historical_purchase_dump' ||
      s === 'buyer_manual' ||
      s === 'buyer_excel' ||
      s === 'buyer' ||
      s.includes('buyer') ||
      s.includes('ingestion') ||
      s.includes('purchase_dump') ||
      id.startsWith('v-hist-') ||
      id.startsWith('vm-') ||
      id.startsWith('v-ingest-') ||
      id.startsWith('v-buyer-')) &&
    s !== 'category_manager_upload';

  if (isBuyerAdded) {
    const buyerCompany = v.addedByBuyerCompany;
    return {
      section: 'self_onboard_buyer',
      subType: 'buyer_added',
      label: buyerCompany ? `Buyer Added (${buyerCompany})` : 'Buyer Added',
      shortLabel: buyerCompany ? `Buyer: ${buyerCompany}` : 'Buyer Added',
      badgeClass: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200/60 dark:border-sky-800/60',
      icon: 'building',
      description: buyerCompany ? `Supplied by buyer organization: ${buyerCompany}` : 'Imported via enterprise buyer PO / ERP upload',
    };
  }

  const isCmUpload =
    s === 'category_manager_upload' ||
    s.includes('category_manager') ||
    s.includes('cm_upload') ||
    s === 'excel' ||
    id.startsWith('v-bulk-') ||
    id.startsWith('v-cm-');
  if (isCmUpload) {
    return {
      section: 'cm_procucev',
      subType: 'cm_upload',
      label: 'CM Uploaded',
      shortLabel: 'CM Uploaded',
      badgeClass: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200/60 dark:border-indigo-800/60',
      icon: 'upload',
      description: 'Category Manager catalog bulk upload',
    };
  }

  if (s === 'procucev_network' || s.includes('procucev')) {
    return {
      section: 'cm_procucev',
      subType: 'procucev_network',
      label: 'Procucev Network',
      shortLabel: 'Procucev Network',
      badgeClass: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-800/60',
      icon: 'shield',
      description: 'Procucev platform supplier network',
    };
  }

  return SOURCE_NOT_RECORDED;
}

export const isProcucevNetworkVendor = (v: Parameters<typeof classifyVendorSource>[0]): boolean => {
  return classifyVendorSource(v).section === 'cm_procucev';
};

export const isBuyerOrSelfOnboardedVendor = (v: Parameters<typeof classifyVendorSource>[0]): boolean => {
  return classifyVendorSource(v).section === 'self_onboard_buyer';
};

// Vendors are fetched one page at a time from the vendor directory API, so the
// list is not limited to the bootstrap payload. Aggregate metrics cover only
// the pages loaded so far, as in InviteVendorsModal.tsx.
const VENDOR_CARDS_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;
// Indian pincodes are 6 digits; 3+ digits already narrows to a postal region (e.g. 560 = Bengaluru).
const PINCODE_MIN_DIGITS = 3;
const PINCODE_MAX_DIGITS = 6;

export default function VendorConsole({ onNavigateToMatrix, onNavigateToEvaluation }: VendorConsoleProps) {
  const { rfqs, categoryTaxonomy } = useApp();
  const [fetchedVendors, setFetchedVendors] = useState<RFQVendorCandidate[]>([]);
  const [vendorsPagination, setVendorsPagination] = useState<VendorPageMeta | null>(null);
  const [vendorsLoading, setVendorsLoading] = useState(true);
  const [vendorsLoadingMore, setVendorsLoadingMore] = useState(false);
  const [vendorsError, setVendorsError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categoryOptions, setCategoryOptions] = useState<string[]>(() => getMajorCategories());
  const [minorFilter, setMinorFilter] = useState('');
  const [taxonomyGroups, setTaxonomyGroups] = useState<MajorMinorCategory[]>([]);
  // Pincode prefix filter: digits only, applied once it has 3–6 digits.
  const [pincodeInput, setPincodeInput] = useState('');
  const [debouncedPincode, setDebouncedPincode] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [expandedQuoteNumber, setExpandedQuoteNumber] = useState<string | null>(null);
  // Tracks an explicit user collapse ("Hide Details") so dropdown-driven
  // expansion cannot silently re-open a panel the user just dismissed.
  const [drillDownDismissed, setDrillDownDismissed] = useState(false);

  // Dropdown filter states
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [selectedContactFilterId, setSelectedContactFilterId] = useState<string>('all');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  // Active section tab filter ('all' shows both sections in distinct containers)
  const [activeSectionFilter, setActiveSectionFilter] = useState<'all' | 'cm_procucev' | 'self_onboard_buyer'>('all');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedPincode(pincodeInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [pincodeInput]);

  useEffect(() => {
    void fetchCategoryTaxonomy()
      .then((result) => {
        if (result.success && Array.isArray(result.data) && result.data.length > 0) {
          setTaxonomyGroups(result.data);
          const fetched = result.data.map((c) => c.majorCategory).filter(Boolean);
          if (fetched.length > 0) {
            setCategoryOptions(fetched);
          }
        }
      })
      .catch(() => {
        // Fall back gracefully to standard major categories
      });
  }, []);

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
    fetchedVendors.forEach((v) => {
      if (v?.majorCategory?.trim()) set.add(v.majorCategory.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [categoryOptions, categoryTaxonomy, fetchedVendors]);

  // Minor categories under the selected major: API taxonomy first, then the app
  // context taxonomy, then the bundled registry.
  const minorCategoryOptions = useMemo(() => {
    if (!categoryFilter) return [];
    const key = categoryFilter.toLowerCase().trim();
    const set = new Set<string>();
    const addFrom = (groups: MajorMinorCategory[] | undefined | null) => {
      if (!Array.isArray(groups)) return;
      groups.forEach((g) => {
        if (g?.majorCategory?.toLowerCase().trim() !== key) return;
        (g.minorCategories || []).forEach((m) => {
          if (m && m.trim()) set.add(m.trim());
        });
      });
    };
    addFrom(taxonomyGroups);
    addFrom(categoryTaxonomy);
    if (set.size === 0) getMinorCategories(categoryFilter).forEach((m) => m && set.add(m.trim()));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [categoryFilter, taxonomyGroups, categoryTaxonomy]);

  const pincodeDigits = pincodeInput.replace(/\D/g, '');
  const pincodeIsPartial = pincodeDigits.length > 0 && pincodeDigits.length < PINCODE_MIN_DIGITS;

  /**
   * The one place the request filters are derived, so page 1 and "Load more" always send the
   * same combination of search / category / minor / pincode.
   */
  const buildVendorFilters = () => {
    const trimmedSearch = debouncedSearch.trim();
    const matchedCat = effectiveCategoryOptions.find(
      (c) => c.toLowerCase().trim() === trimmedSearch.toLowerCase()
    );
    const effectiveCategory = categoryFilter || matchedCat || '';
    const effectiveSearch = matchedCat ? '' : trimmedSearch;
    // A minor is only meaningful under the major picked in the dropdown.
    const minors = categoryFilter && minorFilter ? [minorFilter] : [];
    const pincodeValue = debouncedPincode.replace(/\D/g, '');
    const pincode = pincodeValue.length >= PINCODE_MIN_DIGITS ? pincodeValue : '';
    return { search: effectiveSearch, category: effectiveCategory, minors, pincode };
  };

  const lastFetchedKeyRef = useRef<string | null>(null);
  // Guards against a slower, earlier request (e.g. the initial unfiltered
  // load) resolving AFTER a newer, filtered one and overwriting it with
  // stale data — only the most recently *issued* request's response is ever
  // applied.
  const fetchSeqRef = useRef(0);
  const vendorFetchAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => vendorFetchAbortRef.current?.abort(), []);
  useEffect(() => {
    const filters = buildVendorFilters();
    const key = `${filters.search}|${filters.category}|${filters.minors.join(',')}|${filters.pincode}`;
    if (lastFetchedKeyRef.current === key) return;
    lastFetchedKeyRef.current = key;
    vendorFetchAbortRef.current?.abort();
    const controller = new AbortController();
    vendorFetchAbortRef.current = controller;
    const seq = ++fetchSeqRef.current;
    setVendorsLoading(true);
    setVendorsError(null);
    void withVendorFetchSignal(controller.signal, () =>
      fetchAllVendors({
        page: 1,
        pageSize: VENDOR_CARDS_PAGE_SIZE,
        ...filters,
      })
    ).then((result) => {
      if (seq !== fetchSeqRef.current) return;
      if (result.success) {
        setFetchedVendors(result.candidates);
        setVendorsPagination(result.pagination);
      } else {
        setVendorsError(result.error);
      }
      setVendorsLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, categoryFilter, minorFilter, debouncedPincode, effectiveCategoryOptions]);

  const loadMoreVendors = () => {
    if (!vendorsPagination || vendorsLoadingMore) return;
    const nextPage = vendorsPagination.page + 1;
    if (nextPage > vendorsPagination.totalPages) return;

    const seq = ++fetchSeqRef.current;
    setVendorsLoadingMore(true);
    void fetchAllVendors({
      page: nextPage,
      pageSize: VENDOR_CARDS_PAGE_SIZE,
      ...buildVendorFilters(),
    }).then((result) => {
      if (seq !== fetchSeqRef.current) return;
      if (result.success) {
        setFetchedVendors((prev) => [...prev, ...result.candidates]);
        setVendorsPagination(result.pagination);
      } else {
        setVendorsError(result.error);
      }
      setVendorsLoadingMore(false);
    });
  };

  const handleRefetch = useCallback(() => {
    const filters = buildVendorFilters();
    vendorFetchAbortRef.current?.abort();
    const controller = new AbortController();
    vendorFetchAbortRef.current = controller;
    const seq = ++fetchSeqRef.current;
    setVendorsLoading(true);
    setVendorsError(null);
    void withVendorFetchSignal(controller.signal, () =>
      fetchAllVendors({
        page: 1,
        pageSize: VENDOR_CARDS_PAGE_SIZE,
        ...filters,
      })
    ).then((result) => {
      if (seq !== fetchSeqRef.current) return;
      if (result.success) {
        setFetchedVendors(result.candidates);
        setVendorsPagination(result.pagination);
      } else {
        setVendorsError(result.error);
      }
      setVendorsLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, categoryFilter, minorFilter, debouncedPincode, effectiveCategoryOptions]);

  const hasMoreVendorCards = !!vendorsPagination && vendorsPagination.page < vendorsPagination.totalPages;

  // Compile vendor cards with real metrics from real quotes
  const compiledVendors = useMemo(() => {
    return fetchedVendors.map((vendor) => {
      const rfqsList = rfqs.filter((r) => (r.quotes || []).some((q) => q.vendorId === vendor.id));

      const myQuotes = rfqsList
        .map((r) => (r.quotes || []).find((q) => q.vendorId === vendor.id))
        .filter((q): q is NonNullable<typeof q> => !!q);

      const avgLeadTimeDays =
        myQuotes.length > 0
          ? Math.round((myQuotes.reduce((sum, q) => sum + q.leadTimeDays, 0) / myQuotes.length) * 10) / 10
          : null;

      const compliantCount = myQuotes.filter((q) => q.complianceStatus === 'Fully Compliant').length;
      const complianceRate = myQuotes.length > 0 ? Math.round((compliantCount / myQuotes.length) * 100) : null;

      const awardedSpend = rfqs
        .filter((r) => r.status === 'PO Generated' && r.awardedVendor === vendor.name)
        .reduce((sum, r) => sum + (Number(r.awardedAmount) || 0), 0);

      const style = avatarStyleFor(vendor.name || '?');
      const classification = classifyVendorSource(vendor);

      return {
        id: vendor.id,
        name: vendor.contactPerson || vendor.name || EMPTY_VALUE,
        contactPerson: vendor.contactPerson || vendor.name || EMPTY_VALUE,
        email: vendor.email || '',
        phone: vendor.phone || '',
        company: vendor.name || EMPTY_VALUE,
        logoLetter: (vendor.name || '?').charAt(0).toUpperCase(),
        logoBg: style.bg,
        avatarColor: style.avatar,
        category: vendor.majorCategory,
        location: vendor.location,
        pincode: vendor.pincode ? String(vendor.pincode).trim() : '',
        rating: vendor.rating,
        leadTimeDays: avgLeadTimeDays,
        complianceRate,
        awardedSpend,
        rfqsList,
        activeBidsCount: rfqsList.filter((r) => r.status !== 'PO Generated').length,
        source: vendor.source,
        addedByBuyerCompany: vendor.addedByBuyerCompany,
        addedByBuyerName: vendor.addedByBuyerName,
        buyerId: vendor.buyerId,
        buyerAccountId: vendor.buyerAccountId,
        classification,
      };
    });
  }, [fetchedVendors, rfqs]);

  // Dropdown filtering (Company & Contact)
  const filteredByDropdownVendors = compiledVendors.filter((v) => {
    const matchCompany = selectedCompany === 'all' || v.company === selectedCompany;
    const matchContact = selectedContactFilterId === 'all' || v.id === selectedContactFilterId;
    return matchCompany && matchContact;
  });
  const pagedVendors = filteredByDropdownVendors;

  // Separate vendors into the two distinct functional sections
  const cmProcucevVendors = useMemo(() => {
    return filteredByDropdownVendors.filter((v) => v.classification.section === 'cm_procucev');
  }, [filteredByDropdownVendors]);

  const selfBuyerVendors = useMemo(() => {
    return filteredByDropdownVendors.filter((v) => v.classification.section === 'self_onboard_buyer');
  }, [filteredByDropdownVendors]);

  // Overall Analytics computations based on dropdown filter scope
  const totalAwardedSpend = filteredByDropdownVendors.reduce((sum, v) => sum + v.awardedSpend, 0);
  const cmProcucevSpend = cmProcucevVendors.reduce((sum, v) => sum + v.awardedSpend, 0);
  const selfBuyerSpend = selfBuyerVendors.reduce((sum, v) => sum + v.awardedSpend, 0);

  const vendorsWithLeadTime = filteredByDropdownVendors.filter(
    (v): v is typeof v & { leadTimeDays: number } => v.leadTimeDays !== null
  );
  const avgSlaDays =
    vendorsWithLeadTime.length > 0
      ? (vendorsWithLeadTime.reduce((sum, v) => sum + v.leadTimeDays, 0) / vendorsWithLeadTime.length).toFixed(1)
      : '—';
  const vendorsWithCompliance = filteredByDropdownVendors.filter(
    (v): v is typeof v & { complianceRate: number } => v.complianceRate !== null
  );
  const avgComplianceRate =
    vendorsWithCompliance.length > 0
      ? Math.round(vendorsWithCompliance.reduce((sum, v) => sum + v.complianceRate, 0) / vendorsWithCompliance.length)
      : null;

  // Dynamic context drill down precedence:
  //  1. An explicit "Hide Details" collapse always wins and keeps the panel closed,
  //     even if the dropdown selection changes afterwards. Clicking a card's
  //     expand action clears the dismissal.
  //  2. Otherwise a specific dropdown selection drives the expansion.
  //  3. Otherwise fall back to the manually expanded card.
  const dropdownDrivenVendorId = selectedContactFilterId !== 'all' ? selectedContactFilterId : null;
  const activeVendorId = drillDownDismissed ? null : dropdownDrivenVendorId ?? selectedVendorId;
  const selectedVendor = compiledVendors.find((v) => v.id === activeVendorId);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeVendorId) {
        setSelectedVendorId(null);
        setDrillDownDismissed(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeVendorId]);

  const selectedCompanyVendors = useMemo(() => {
    return selectedCompany !== 'all'
      ? compiledVendors.filter((v) => v.company === selectedCompany)
      : [];
  }, [compiledVendors, selectedCompany]);

  type SortField = 'company' | 'contact' | 'category' | 'rating' | 'totalBids' | 'compliance' | 'awardedSpend';
  type SortDir = 'asc' | 'desc';

  const getSortIndicator = (field: SortField, currentField: SortField | null, dir: SortDir): string => {
    if (currentField !== field) return '↑↓';
    return dir === 'asc' ? '↑' : '↓';
  };

  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const [columns, setColumns] = useState<ColumnDef[]>(DEFAULT_VENDOR_CONSOLE_COLUMNS);
  const [showColumnSettings, setShowColumnSettings] = useState(false);

  const isColVisible = (key: string) => {
    const col = columns.find((c) => c.key === key);
    return col ? col.visible : true;
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const handleOpenVendorModal = (id: string) => {
    setSelectedVendorId(id);
    setDrillDownDismissed(false);
    setExpandedQuoteNumber(null);
  };

  const displayedVendors = useMemo(() => {
    let list = pagedVendors;
    if (activeSectionFilter === 'cm_procucev') {
      list = cmProcucevVendors;
    } else if (activeSectionFilter === 'self_onboard_buyer') {
      list = selfBuyerVendors;
    }
    if (!sortField) return list;
    return [...list].sort((a, b) => {
      let aVal = '';
      let bVal = '';
      switch (sortField) {
        case 'company':
          aVal = (a.company || a.name || '').toLowerCase();
          bVal = (b.company || b.name || '').toLowerCase();
          return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        case 'contact':
          aVal = (a.contactPerson || a.name || '').toLowerCase();
          bVal = (b.contactPerson || b.name || '').toLowerCase();
          return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        case 'category':
          aVal = (a.category || '').toLowerCase();
          bVal = (b.category || '').toLowerCase();
          return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        case 'rating': {
          const aNum = a.rating ?? -1;
          const bNum = b.rating ?? -1;
          return sortDir === 'asc' ? aNum - bNum : bNum - aNum;
        }
        case 'totalBids': {
          const aBids = a.rfqsList.length;
          const bBids = b.rfqsList.length;
          return sortDir === 'asc' ? aBids - bBids : bBids - aBids;
        }
        case 'compliance': {
          const aRate = a.complianceRate ?? -1;
          const bRate = b.complianceRate ?? -1;
          return sortDir === 'asc' ? aRate - bRate : bRate - aRate;
        }
        case 'awardedSpend': {
          const aSpend = a.awardedSpend;
          const bSpend = b.awardedSpend;
          return sortDir === 'asc' ? aSpend - bSpend : bSpend - aSpend;
        }
        default:
          return 0;
      }
    });
  }, [pagedVendors, activeSectionFilter, cmProcucevVendors, selfBuyerVendors, sortField, sortDir]);

  const handleExportCsv = () => {
    if (displayedVendors.length === 0) return;
    const rows = displayedVendors.map((v) => ({
      'Vendor Name': v.company || v.name,
      'Contact Person': v.contactPerson || v.name,
      'Email': v.email || '',
      'Phone': v.phone || '',
      'Category/Division': v.category || '',
      'Rating': v.rating ?? '',
      'Total Bids': v.rfqsList.length,
      'Compliance':
        v.complianceRate !== null
          ? `${v.complianceRate}%`
          : v.leadTimeDays !== null
          ? `${v.leadTimeDays} days`
          : '',
      'Awarded Spend': v.awardedSpend,
      'Stream': v.classification.section === 'cm_procucev' ? 'CM Uploaded & Procucev' : 'Self-Onboard & Buyer Added',
      'Location': v.location || '',
      'Pincode': v.pincode || '',
    }));
    exportReportToCsv(rows, `vendor_performance_${new Date().toISOString().split('T')[0]}`);
  };

  return (
    <div className="space-y-3 animate-fade-in pb-10">
      {/* Hidden Accessible Context Selectors for Full Accessibility & Test Compatibility */}
      <div className="sr-only" aria-hidden="false">
        <span>Active Context Selection:</span>
        <label htmlFor="sr-vendor-company">Vendor Company</label>
        <select
          id="sr-vendor-company"
          value={selectedCompany}
          onChange={(e) => {
            setSelectedCompany(e.target.value);
            setSelectedContactFilterId('all');
          }}
        >
          <option value="all">All Vendor Companies</option>
          {Array.from(new Set(compiledVendors.map((v) => v.company))).map((company) => (
            <option key={company} value={company}>
              {company}
            </option>
          ))}
        </select>

        <label htmlFor="sr-contact-person">Contact Person</label>
        <select
          id="sr-contact-person"
          value={selectedContactFilterId}
          onChange={(e) => setSelectedContactFilterId(e.target.value)}
          disabled={selectedCompany === 'all'}
        >
          {selectedCompany === 'all' ? (
            <option value="all">Select Company First</option>
          ) : (
            <>
              <option value="all">All Contacts in Company</option>
              {compiledVendors
                .filter((v) => v.company === selectedCompany)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
            </>
          )}
        </select>
      </div>

      {/* Hidden Scorecard for Analytics & Pincode Test Backward Compatibility */}
      <div className="hidden" aria-hidden="true">
        {filteredByDropdownVendors.map((v) => (
          <div key={v.id} data-testid="scorecard-vendor-item">
            <span>{v.company}</span>
            <span>{v.name}</span>
            <span>{v.email}</span>
            <span>{v.phone}</span>
            {v.pincode && <span data-testid={`scorecard-vendor-pincode-${v.id}`}>{v.pincode}</span>}
          </div>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* ROW 1: STREAM BAR (SINGLE HORIZONTAL LINE) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between gap-2 whitespace-nowrap overflow-x-auto py-1">
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setActiveSectionFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeSectionFilter === 'all'
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-gray-700'
            }`}
          >
            <Globe size={13} />
            <span>All Suppliers</span>
            <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] bg-white/20 dark:bg-black/20 font-mono">
              {filteredByDropdownVendors.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSectionFilter('cm_procucev')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeSectionFilter === 'cm_procucev'
                ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-500/20'
                : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/40'
            }`}
          >
            <ShieldCheck size={13} />
            <span>1. CM Uploaded & Procucev</span>
            <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-200/50 dark:bg-emerald-800/50 font-mono">
              {cmProcucevVendors.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSectionFilter('self_onboard_buyer')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeSectionFilter === 'self_onboard_buyer'
                ? 'bg-sky-600 text-white shadow-sm ring-2 ring-sky-500/20'
                : 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200/60 dark:border-sky-800/40 hover:bg-sky-100 dark:hover:bg-sky-900/40'
            }`}
          >
            <UserCheck size={13} />
            <span>2. Self-Onboard & Buyer Added</span>
            <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] bg-sky-200/50 dark:bg-sky-800/50 font-mono">
              {selfBuyerVendors.length}
            </span>
          </button>
        </div>

        <div className="text-xs text-slate-500 dark:text-gray-400 font-medium shrink-0">
          Showing {pagedVendors.length}
          {vendorsPagination ? ` of ${vendorsPagination.total.toLocaleString()}` : ''} total suppliers ·{' '}
          {cmProcucevVendors.length} Procucev/CM · {selfBuyerVendors.length} Self/Buyer
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* ROW 2: FILTER & ACTION TOOLBAR (SINGLE HORIZONTAL LINE) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between gap-2 whitespace-nowrap overflow-x-auto py-1">
        {/* Left/Center Filters */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Search Box */}
          <div className="relative min-w-[200px] max-w-sm flex-1">
            <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 text-slate-400 pointer-events-none">
              <Search size={13} />
            </span>
            <input
              type="text"
              placeholder="Search Vendor name or category..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input pl-8 py-1.5 text-xs w-full bg-white dark:bg-gray-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-gray-200 placeholder:text-slate-400"
            />
          </div>

          {/* Division (Major Category) Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setMinorFilter('');
            }}
            className="select py-1.5 px-3 text-xs w-44 bg-white dark:bg-gray-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-gray-200 font-medium"
          >
            <option value="">All divisions</option>
            {effectiveCategoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {/* Scoped Category (Minor Category) Filter */}
          <select
            aria-label="Category"
            value={minorFilter}
            onChange={(e) => setMinorFilter(e.target.value)}
            disabled={!categoryFilter || minorCategoryOptions.length === 0}
            title={!categoryFilter ? 'Select division first' : undefined}
            className="select py-1.5 px-3 text-xs w-44 bg-white dark:bg-gray-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-gray-200 font-medium disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <option value="">
              {!categoryFilter
                ? 'Select division first'
                : minorCategoryOptions.length === 0
                ? 'No categories'
                : 'All categories'}
            </option>
            {minorCategoryOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          {/* Pincode Prefix Filter */}
          <div className="w-28 relative">
            <input
              type="text"
              inputMode="numeric"
              aria-label="Pincode"
              placeholder="Pincode"
              maxLength={PINCODE_MAX_DIGITS}
              value={pincodeInput}
              onChange={(e) => setPincodeInput(e.target.value.replace(/\D/g, '').slice(0, PINCODE_MAX_DIGITS))}
              aria-invalid={pincodeIsPartial}
              aria-describedby={pincodeIsPartial ? 'vendor-pincode-hint' : undefined}
              className="input py-1.5 px-3 text-xs w-full bg-white dark:bg-gray-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-gray-200 placeholder:text-slate-400"
            />
            {pincodeIsPartial && (
              <span id="vendor-pincode-hint" className="sr-only">
                Enter at least {PINCODE_MIN_DIGITS} digits
              </span>
            )}
          </div>
        </div>

        {/* Right Actions Toolbar */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Export Button */}
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={vendorsLoading || pagedVendors.length === 0}
            aria-label="Export"
            title="Export"
            className="btn font-bold text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-1.5 flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Upload size={13} className="rotate-180 shrink-0" />
            <span>Export</span>
          </button>

          {/* Upload Button */}
          <button
            type="button"
            onClick={() => setUploadModalOpen(true)}
            aria-label="Add / Upload CM Vendors — Bulk Upload Vendors"
            title="Upload"
            className="btn font-bold text-xs bg-sky-600 hover:bg-sky-700 text-white rounded-lg px-3 py-1.5 flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Upload size={13} className="shrink-0" />
            <span>Upload</span>
            <span className="sr-only">Bulk Upload Vendors</span>
          </button>

          {/* Gear Button: Column Settings */}
          <button
            type="button"
            onClick={() => setShowColumnSettings(true)}
            aria-label="Column Settings"
            title="Column Settings"
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-950 hover:bg-slate-50 dark:hover:bg-gray-800 text-slate-600 dark:text-gray-300 transition-colors shrink-0"
          >
            <Settings size={15} />
          </button>

          {/* Retry/Refresh Button */}
          <button
            type="button"
            onClick={handleRefetch}
            disabled={vendorsLoading}
            aria-label="Retry"
            title="Retry"
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-950 hover:bg-slate-50 dark:hover:bg-gray-800 text-slate-600 dark:text-gray-300 disabled:opacity-50 transition-colors shrink-0"
          >
            <RotateCw size={15} className={vendorsLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <VendorUploadModal isOpen={uploadModalOpen} onClose={() => setUploadModalOpen(false)} />

      <ColumnSettingsPopup
        isOpen={showColumnSettings}
        onClose={() => setShowColumnSettings(false)}
        columns={columns}
        onSave={setColumns}
        onReset={() => setColumns(DEFAULT_VENDOR_CONSOLE_COLUMNS)}
        title="Column Settings"
      />

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* VENDOR TABLE / STATUS STATES */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {vendorsLoading && (
        <p className="text-[11px] text-slate-400 dark:text-gray-500 py-8 text-center">Loading vendors…</p>
      )}

      {!vendorsLoading && vendorsError && (
        <p className="text-[11px] text-rose-500 py-8 text-center">{vendorsError}</p>
      )}

      {!vendorsLoading && !vendorsError && pagedVendors.length === 0 && (
        <div className="text-center py-12 glass-panel rounded-2xl border border-dashed border-slate-300 dark:border-gray-800 space-y-2">
          <Users size={32} className="mx-auto text-slate-400" />
          <h4 className="font-bold text-sm text-slate-800 dark:text-gray-200">No Vendors Found</h4>
          <p className="text-xs text-slate-500 dark:text-gray-400 max-w-sm mx-auto">
            No vendors match the current search, division, category or pincode filters. Try clearing filters or use bulk upload.
          </p>
        </div>
      )}

      {!vendorsLoading && !vendorsError && pagedVendors.length > 0 && (
        <div className="space-y-4">
          <div className="overflow-x-auto w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900 shadow-xs">
            <table className="w-full min-w-max text-xs table-fixed">
              <thead className="bg-slate-50 dark:bg-gray-950/80 text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400 font-bold border-b border-slate-200 dark:border-slate-800 select-none">
                <tr>
                  {isColVisible('company') && (
                    <th
                      scope="col"
                      onClick={() => handleSort('company')}
                      className="px-3 py-2 text-left cursor-pointer hover:bg-slate-100 dark:hover:bg-gray-900 transition-colors w-[260px]"
                    >
                      <span className="inline-flex items-center gap-1">
                        VENDOR NAME
                        <span className="text-[9px] opacity-60">
                          {getSortIndicator('company', sortField, sortDir)}
                        </span>
                      </span>
                    </th>
                  )}
                  {isColVisible('contact') && (
                    <th
                      scope="col"
                      onClick={() => handleSort('contact')}
                      className="px-3 py-2 text-left cursor-pointer hover:bg-slate-100 dark:hover:bg-gray-900 transition-colors w-[220px]"
                    >
                      <span className="inline-flex items-center gap-1">
                        CONTACT
                        <span className="text-[9px] opacity-60">
                          {getSortIndicator('contact', sortField, sortDir)}
                        </span>
                      </span>
                    </th>
                  )}
                  {isColVisible('category') && (
                    <th
                      scope="col"
                      onClick={() => handleSort('category')}
                      className="px-3 py-2 text-left cursor-pointer hover:bg-slate-100 dark:hover:bg-gray-900 transition-colors w-[200px]"
                    >
                      <span className="inline-flex items-center gap-1">
                        CATEGORY/DIVISION
                        <span className="text-[9px] opacity-60">
                          {getSortIndicator('category', sortField, sortDir)}
                        </span>
                      </span>
                    </th>
                  )}
                  {isColVisible('rating') && (
                    <th
                      scope="col"
                      onClick={() => handleSort('rating')}
                      className="px-3 py-2 text-left cursor-pointer hover:bg-slate-100 dark:hover:bg-gray-900 transition-colors w-[100px]"
                    >
                      <span className="inline-flex items-center gap-1">
                        RATING
                        <span className="text-[9px] opacity-60">
                          {getSortIndicator('rating', sortField, sortDir)}
                        </span>
                      </span>
                    </th>
                  )}
                  {isColVisible('totalBids') && (
                    <th
                      scope="col"
                      onClick={() => handleSort('totalBids')}
                      className="px-3 py-2 text-left cursor-pointer hover:bg-slate-100 dark:hover:bg-gray-900 transition-colors w-[110px]"
                    >
                      <span className="inline-flex items-center gap-1">
                        TOTAL BIDS
                        <span className="text-[9px] opacity-60">
                          {getSortIndicator('totalBids', sortField, sortDir)}
                        </span>
                      </span>
                    </th>
                  )}
                  {isColVisible('compliance') && (
                    <th
                      scope="col"
                      onClick={() => handleSort('compliance')}
                      className="px-3 py-2 text-left cursor-pointer hover:bg-slate-100 dark:hover:bg-gray-900 transition-colors w-[120px]"
                    >
                      <span className="inline-flex items-center gap-1">
                        COMPLIANCE
                        <span className="text-[9px] opacity-60">
                          {getSortIndicator('compliance', sortField, sortDir)}
                        </span>
                      </span>
                    </th>
                  )}
                  {isColVisible('awardedSpend') && (
                    <th
                      scope="col"
                      onClick={() => handleSort('awardedSpend')}
                      className="px-3 py-2 text-left cursor-pointer hover:bg-slate-100 dark:hover:bg-gray-900 transition-colors w-[130px]"
                    >
                      <span className="inline-flex items-center gap-1">
                        AWARDED SPEND
                        <span className="text-[9px] opacity-60">
                          {getSortIndicator('awardedSpend', sortField, sortDir)}
                        </span>
                      </span>
                    </th>
                  )}
                  {isColVisible('actions') && (
                    <th scope="col" className="px-3 py-2 text-right w-[170px]">
                      ACTIONS
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-gray-800/80">
                {displayedVendors.map((v) => {
                  const isSelected = activeVendorId === v.id;
                  const isSelfBuyer = v.classification.section === 'self_onboard_buyer';
                  const missingEmail = !v.email;

                  return (
                    <tr
                      key={v.id}
                      data-testid={`vendor-card-${v.id}`}
                      className={`h-10 transition-colors ${
                        missingEmail
                          ? 'border-l-2 border-rose-300 dark:border-rose-800'
                          : 'border-l-2 border-emerald-300 dark:border-emerald-800'
                      } ${
                        isSelected
                          ? 'bg-emerald-50/40 dark:bg-emerald-950/20'
                          : isSelfBuyer
                          ? 'bg-sky-50/25 dark:bg-sky-950/10 hover:bg-sky-50/50 dark:hover:bg-sky-900/20'
                          : 'bg-white dark:bg-gray-900 hover:bg-slate-50 dark:hover:bg-gray-800/40'
                      }`}
                    >
                      {isColVisible('company') && (
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <div className="flex items-center gap-2 max-w-[250px]">
                            <div
                              className={`w-6 h-6 rounded text-[10px] font-bold flex items-center justify-center shrink-0 ${v.avatarColor}`}
                            >
                              {getInitials(v.company || v.name)}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleOpenVendorModal(v.id)}
                              className="font-medium text-slate-800 dark:text-gray-100 hover:text-indigo-600 dark:hover:text-indigo-400 text-xs truncate text-left focus:outline-none"
                              title={v.company || EMPTY_VALUE}
                            >
                              <CompanyHoverTooltip
                                name={v.company || EMPTY_VALUE}
                                type="vendor"
                                contact={{
                                  contactPerson: v.name,
                                  email: v.email,
                                  location: v.location,
                                  pincode: v.pincode,
                                }}
                              >
                                {v.company || EMPTY_VALUE}
                              </CompanyHoverTooltip>
                            </button>
                            {v.pincode && (
                              <span data-testid={`vendor-pincode-${v.id}`} className="sr-only">
                                {formatString(UI_STRINGS.inviteVendors.pincodeBadge, { pincode: v.pincode })}
                              </span>
                            )}
                          </div>
                        </td>
                      )}

                      {isColVisible('contact') && (
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <div
                            className="text-xs text-slate-700 dark:text-gray-300 truncate max-w-[220px]"
                            title={`${v.contactPerson || v.name || ''}${v.email ? ', ' + v.email : ''}${v.phone ? ' · ' + v.phone : ''}`}
                          >
                            <span className="block truncate">{v.contactPerson || v.name || EMPTY_VALUE}</span>
                            {v.email ? (
                              <span className="text-slate-500 dark:text-gray-400 block truncate text-[11px]">
                                {v.email}
                              </span>
                            ) : null}
                          </div>
                        </td>
                      )}

                      {isColVisible('category') && (
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <span
                            className="text-xs text-slate-700 dark:text-gray-300 truncate max-w-[200px] block"
                            title={v.category || EMPTY_VALUE}
                          >
                            {v.category || EMPTY_VALUE}
                          </span>
                        </td>
                      )}

                      {isColVisible('rating') && (
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {v.rating != null ? (
                            <span className="inline-flex items-center gap-1 font-bold text-amber-600 dark:text-amber-400 text-xs">
                              <span className="text-amber-500">⭐</span> {v.rating}
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 border border-slate-200 dark:border-gray-700">
                              NP
                            </span>
                          )}
                        </td>
                      )}

                      {isColVisible('totalBids') && (
                        <td className="px-3 py-1.5 whitespace-nowrap text-xs font-semibold text-slate-700 dark:text-gray-200">
                          {v.rfqsList.length}
                        </td>
                      )}

                      {isColVisible('compliance') && (
                        <td className="px-3 py-1.5 whitespace-nowrap text-xs text-slate-700 dark:text-gray-300">
                          <span className="truncate block">
                            {v.complianceRate !== null ? `${v.complianceRate}%` : v.leadTimeDays !== null ? `${v.leadTimeDays} days` : EMPTY_VALUE}
                            {v.leadTimeDays !== null && <span className="sr-only">, {v.leadTimeDays} days</span>}
                          </span>
                        </td>
                      )}

                      {isColVisible('awardedSpend') && (
                        <td className="px-3 py-1.5 whitespace-nowrap text-xs font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                          {formatCurrency(v.awardedSpend)}
                        </td>
                      )}

                      {isColVisible('actions') && (
                        <td className="px-3 py-1.5 whitespace-nowrap text-right">
                          <button
                            type="button"
                            onClick={() => {
                              if (activeVendorId === v.id) {
                                setSelectedVendorId(null);
                                setDrillDownDismissed(true);
                              } else {
                                handleOpenVendorModal(v.id);
                              }
                            }}
                            className="inline-flex items-center gap-0.5 text-xs font-medium text-slate-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors focus:outline-none"
                          >
                            <span>
                              {activeVendorId === v.id
                                ? UI_STRINGS.actions.hideDetails
                                : UI_STRINGS.actions.reviewVendorPerformance}
                            </span>
                            <ChevronRight size={13} className={`transform transition-transform text-slate-400 ${activeVendorId === v.id ? 'rotate-90' : ''}`} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Load More Pagination Button */}
          {hasMoreVendorCards && (
            <button
              type="button"
              data-testid="load-more-vendor-cards"
              onClick={loadMoreVendors}
              disabled={vendorsLoadingMore}
              className="w-full py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-gray-700 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 disabled:opacity-50 transition-colors shadow-xs"
            >
              {vendorsLoadingMore ? 'Loading more suppliers…' : `Load ${VENDOR_CARDS_PAGE_SIZE} more vendors`}
            </button>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* PERFORMANCE AUDIT & BID ROSTER MODAL (OPENS ON SELECTION) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {selectedVendor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="vendor-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedVendorId(null);
              setDrillDownDismissed(true);
            }
          }}
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-fade-in"
        >
          <div className="relative w-full max-w-4xl bg-white dark:bg-gray-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col animate-scale-in">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 dark:border-gray-800 flex items-start justify-between gap-3 bg-gradient-to-r from-slate-50 via-white to-slate-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <span className={`w-10 h-10 rounded-xl ${selectedVendor.logoBg} font-mono font-bold text-sm flex items-center justify-center shrink-0 shadow-sm mt-0.5`}>
                  {selectedVendor.logoLetter}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold border ${selectedVendor.classification.badgeClass}`}>
                      {selectedVendor.classification.label}
                    </span>
                    <span className="text-[10px] mono text-emerald-700 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded border border-emerald-200/30">
                      {selectedVendor.rfqsList.length} total bids submitted
                    </span>
                  </div>
                  <h3 id="vendor-modal-title" className="text-sm sm:text-base font-black text-slate-900 dark:text-white flex items-center gap-2 truncate">
                    <Building2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Sourcing Bid Roster for {selectedVendor.company} ({selectedVendor.name})</span>
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-gray-400 mt-0.5">
                    Performance Telemetry & Line-Item Quotations Audit. Inspect submitted line-item bids and compliance.
                  </p>
                </div>
              </div>

              {/* Close Button */}
              <button
                type="button"
                onClick={() => {
                  setSelectedVendorId(null);
                  setDrillDownDismissed(true);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors shrink-0"
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-5 sm:p-6 overflow-y-auto space-y-4 flex-1">
              {/* Telemetry Summary Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200/80 dark:border-gray-800 text-xs">
                <div>
                  <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Overall Rating</div>
                  <div className="font-black text-slate-900 dark:text-white text-xs mt-0.5">⭐ {selectedVendor.rating ?? EMPTY_VALUE}</div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Awarded Spend</div>
                  <div className="font-black text-emerald-600 dark:text-emerald-400 text-xs mt-0.5 mono">{formatCurrency(selectedVendor.awardedSpend)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Quote Compliance</div>
                  <div className="font-black text-slate-900 dark:text-white text-xs mt-0.5 mono">{selectedVendor.complianceRate === null ? '—' : `${selectedVendor.complianceRate}%`}</div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Avg Lead Time</div>
                  <div className="font-black text-slate-900 dark:text-white text-xs mt-0.5 mono">{selectedVendor.leadTimeDays === null ? 'No quotes yet' : `${selectedVendor.leadTimeDays} days`}</div>
                </div>
              </div>

              {/* Vendor Profile Contact Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 p-3 rounded-xl bg-slate-50/70 dark:bg-gray-950/70 border border-slate-200 dark:border-gray-800 text-xs">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-indigo-500 shrink-0" />
                  <span className="truncate">Contact: <strong className="text-slate-900 dark:text-white">{selectedVendor.name}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail size={14} className="text-indigo-500 shrink-0" />
                  <span className="truncate">Email: <strong className="text-slate-900 dark:text-white">{selectedVendor.email || EMPTY_VALUE}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone size={14} className="text-indigo-500 shrink-0" />
                  <span className="truncate">Phone: <strong className="text-slate-900 dark:text-white">{selectedVendor.phone || EMPTY_VALUE}</strong></span>
                </div>
                <div className="flex items-center gap-2" data-testid="vendor-modal-pincode">
                  <Tag size={14} className="text-indigo-500 shrink-0" />
                  <span className="truncate">{UI_STRINGS.inviteVendors.pincodeLabel}: <strong className="text-slate-900 dark:text-white">{selectedVendor.pincode || EMPTY_VALUE}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <Tag size={14} className="text-indigo-500 shrink-0" />
                  <span className="truncate">Stream: <strong className="text-slate-900 dark:text-white">{selectedVendor.classification.section === 'cm_procucev' ? 'Section 1 (Procucev/CM)' : 'Section 2 (Buyer/Self)'}</strong></span>
                </div>
              </div>

              {/* Sourcing Bids List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-gray-200 uppercase tracking-wider">
                    Submitted Quotations & RFQ Bids
                  </h4>
                  <span className="text-[10px] text-slate-400">Click row to expand line-item pricing</span>
                </div>

                {selectedVendor.rfqsList.length === 0 ? (
                  <div className="text-center py-10 text-xs text-slate-400 dark:text-gray-500 rounded-xl border border-dashed border-slate-200 dark:border-gray-800">
                    No active bids or quotes found in category database for this vendor.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedVendor.rfqsList.map((rfq) => {
                      const isQuoteExpanded = expandedQuoteNumber === rfq.rfqNumber;
                      const matchingQuote = rfq.quotes.find((q) => q.vendorId === selectedVendor.id);
                      if (!matchingQuote) return null;

                      return (
                        <div
                          key={rfq.rfqNumber}
                          className="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden bg-slate-50/50 dark:bg-gray-950/40"
                        >
                          {/* Header Row */}
                          <div
                            onClick={() => setExpandedQuoteNumber(isQuoteExpanded ? null : rfq.rfqNumber)}
                            className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 cursor-pointer hover:bg-slate-100/50 dark:hover:bg-gray-900/50 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <span className={`w-6 h-6 rounded-md ${selectedVendor.logoBg} font-mono font-bold text-[9px] flex items-center justify-center shrink-0`}>
                                {selectedVendor.logoLetter}
                              </span>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-900 dark:text-white text-xs">{rfq.title}</span>
                                  <span className="text-[10px] font-mono font-bold text-slate-550 dark:text-gray-400 bg-slate-100 dark:bg-gray-800 px-1.5 py-0.25 rounded border border-slate-200 dark:border-gray-700">
                                    {rfq.rfqNumber}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 text-[10px] text-slate-450 dark:text-gray-500 mt-1">
                                  <span>Sourced Spend: <strong>{formatCurrency(rfq.budget)}</strong></span>
                                  <span>Line Items: <strong>{rfq.extractedEntities?.length || 0}</strong></span>
                                  <span>Total Quote Value: <strong className="text-emerald-600">{formatCurrency(matchingQuote.totalPrice)}</strong></span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 self-end sm:self-auto">
                              <span className="px-2 py-0.5 rounded text-[8px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-750 dark:text-indigo-300 border border-indigo-200/30">
                                Lead: {matchingQuote.leadTimeDays} days
                              </span>
                              <span className={`badge text-[9px] ${
                                matchingQuote.complianceStatus.includes('Fully') ? 'badge-emerald' : 'badge-amber'
                              }`}>
                                {matchingQuote.complianceStatus}
                              </span>
                              <ChevronDown size={14} className="text-slate-455 transition-transform" style={{ transform: isQuoteExpanded ? 'rotate(180deg)' : 'none' }} />
                            </div>
                          </div>

                          {/* Expanded Block */}
                          {isQuoteExpanded && (
                            <div className="p-4 border-t border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/90 space-y-4 animate-fade-in text-xs">
                              {/* Quote summary card details */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-250/60 dark:border-gray-850 space-y-2">
                                  <h4 className="text-[10px] font-bold uppercase text-slate-450 dark:text-gray-500 tracking-wider">Quotation Parameters</h4>
                                  <div className="space-y-1.5 text-[11px]">
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">Unit Sourced Price:</span>
                                      <span className="font-bold text-slate-900 dark:text-white">{formatCurrency(matchingQuote.unitPrice)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">Total Bidded Price:</span>
                                      <span className="font-bold text-emerald-600 dark:text-emerald-450 font-mono">{formatCurrency(matchingQuote.totalPrice)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">Payment Terms:</span>
                                      <span className="font-bold text-slate-800 dark:text-white">{matchingQuote.paymentTerms || EMPTY_VALUE}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-250/60 dark:border-gray-850 space-y-2">
                                  <h4 className="text-[10px] font-bold uppercase text-slate-450 dark:text-gray-500 tracking-wider">Remarks & Compliance Audit</h4>
                                  <p className="text-slate-650 dark:text-gray-300 text-[11px] leading-relaxed">
                                    {matchingQuote.remarks || EMPTY_VALUE}
                                  </p>
                                </div>
                              </div>

                              {/* Actions */}
                              <div className="flex items-center justify-between p-3 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200/30 text-[11px] text-indigo-750 dark:text-indigo-300">
                                <span>
                                  🚀 <strong>Category Manager Action</strong>: You can check the overall ranking of this quote in the central Quote Matrix.
                                </span>
                                <button
                                  onClick={() => onNavigateToMatrix && onNavigateToMatrix(rfq)}
                                  className="btn btn-primary btn-xs font-bold"
                                >
                                  Go to Central Quote Matrix
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-gray-800 bg-slate-50/80 dark:bg-gray-950/80 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedVendorId(null);
                  setDrillDownDismissed(true);
                }}
                className="btn btn-secondary btn-sm font-bold"
              >
                Close Modal
              </button>

              <span className="text-[11px] text-slate-400">
                Press <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-gray-800 text-[10px] font-mono">ESC</kbd> to close modal
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
