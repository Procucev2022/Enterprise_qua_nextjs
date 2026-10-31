'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Truck,
  Search,
  Filter,
  Layers,
  FileCheck,
  CreditCard,
  MessageSquare,
  Receipt,
  History,
  ChevronRight,
  ChevronLeft,
  X,
  Phone,
  Mail,
  MapPin,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Sparkles,
  Download,
  AlertCircle,
  TrendingUp,
  Star,
  Award,
  Zap,
  Building2,
  Loader2,
  Settings,
  GripVertical,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  RotateCcw,
} from 'lucide-react';
import { useApp } from '@/lib/store';
import type {
  RFQItem,
  RFQVendorCandidate,
  VendorEntry,
  SellerDirectoryColumnKey,
  SellerDirectoryColumnConfig,
} from '@/lib/types';
import {
  formatCurrency,
  formatIndianDateTime,
  SELLER_DIRECTORY_COLUMN_PREF_KEY,
  DEFAULT_SELLER_DIRECTORY_COLUMNS,
} from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';
import { exportReportToExcel } from '@/lib/reportsClient';
import { fetchAllVendors } from '@/lib/rfqClient';
import SupplierDossierDrawer from './components/SupplierDossierDrawer';

interface SellersDirectoryProps {
  onSelectRFQ?: (rfq: RFQItem) => void;
}

/**
 * Returns authentic last login timestamp for a seller if available.
 * If no genuine authentication timestamp exists, returns '' so the UI renders 'Never'.
 */
function getSellerActualLastLogin(
  seller: {
    id?: string;
    email?: string;
    name?: string;
    lastLogin?: string;
    last_login_at?: string;
    lastLoginDate?: string;
    loginDateTime?: string;
    createdAt?: string;
    created_at?: string;
  },
  _rfqs: RFQItem[] = [],
  _auditLogs: unknown[] = []
): string {
  const rawLogin =
    seller.lastLogin ||
    seller.last_login_at ||
    seller.lastLoginDate ||
    (seller as any).loginDateTime;

  if (rawLogin && typeof rawLogin === 'string' && rawLogin.trim()) {
    try {
      const parsed = new Date(rawLogin);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    } catch {
      // Ignore invalid date strings
    }
  }

  return '';
}

export default function SellersDirectory({ onSelectRFQ }: SellersDirectoryProps) {
  const { buyerVendors = [], rfqs = [], auditLogs = [], categoryTaxonomy = [] } = useApp();
  const strings = UI_STRINGS.sellerDirectory;

  // Remote vendors from backend + local buyer vendors
  const [remoteVendors, setRemoteVendors] = useState<RFQVendorCandidate[]>([]);
  const [loadingVendors, setLoadingVendors] = useState<boolean>(true);

  // Search & Filters (Single unified search field for company, contact, email, category, city)
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedRating, setSelectedRating] = useState<string>('all');

  // Sorting state
  const [sortColumn, setSortColumn] = useState<SellerDirectoryColumnKey | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Column Customization state
  const [columns, setColumns] = useState<SellerDirectoryColumnConfig[]>(DEFAULT_SELLER_DIRECTORY_COLUMNS);
  const [showColumnSettings, setShowColumnSettings] = useState<boolean>(false);
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Active Dossier Seller
  const [activeSeller, setActiveSeller] = useState<any | null>(null);

  // Load column preferences from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SELLER_DIRECTORY_COLUMN_PREF_KEY);
      if (saved) {
        const parsed: SellerDirectoryColumnConfig[] = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const validKeys = new Set(DEFAULT_SELLER_DIRECTORY_COLUMNS.map((c) => c.key));
          const validated = parsed.filter((c) => validKeys.has(c.key));
          const presentKeys = new Set(validated.map((c) => c.key));
          DEFAULT_SELLER_DIRECTORY_COLUMNS.forEach((defCol) => {
            if (!presentKeys.has(defCol.key)) {
              validated.push(defCol);
            }
          });
          setColumns(validated);
        }
      }
    } catch {
      // use defaults on parse error
    }
  }, []);

  const saveColumns = useCallback((newCols: SellerDirectoryColumnConfig[]) => {
    setColumns(newCols);
    try {
      localStorage.setItem(SELLER_DIRECTORY_COLUMN_PREF_KEY, JSON.stringify(newCols));
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleToggleColumn = useCallback(
    (key: SellerDirectoryColumnKey) => {
      const newCols = columns.map((col) => {
        if (col.key === key) {
          if (col.required) return col;
          return { ...col, visible: !col.visible };
        }
        return col;
      });
      saveColumns(newCols);
    },
    [columns, saveColumns]
  );

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedColIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedColIndex === null || draggedColIndex === dropIndex) return;
    const reordered = [...columns];
    const [moved] = reordered.splice(draggedColIndex, 1);
    reordered.splice(dropIndex, 0, moved);
    setDraggedColIndex(null);
    saveColumns(reordered);
  };

  const handleResetColumns = () => {
    saveColumns(DEFAULT_SELLER_DIRECTORY_COLUMNS);
  };

  // Reset to first page when search or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedSource, selectedCategory, selectedRating]);

  // Debounce search input for backend querying
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 350);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  // Load vendors from API dynamically (supports deep DB search across 600k+ vendors)
  const fetchSeqRef = useRef(0);
  useEffect(() => {
    let active = true;
    const query = debouncedSearch.trim();
    const seq = ++fetchSeqRef.current;
    setLoadingVendors(true);

    async function load() {
      try {
        const res = await fetchAllVendors({
          pageSize: 150,
          search: query || undefined,
          category: selectedCategory !== 'all' ? selectedCategory : undefined,
        });
        if (active && seq === fetchSeqRef.current && res.success && (res.candidates || (res as any).data)) {
          setRemoteVendors(res.candidates || (res as any).data);
        }
      } catch {
        // Keep current vendors on network error
      } finally {
        if (active && seq === fetchSeqRef.current) {
          setLoadingVendors(false);
        }
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [debouncedSearch, selectedCategory]);

  // Merge remote vendors and buyer-uploaded vendors into unified seller entities
  const allSellers = useMemo(() => {
    const map = new Map<string, any>();

    // Add remote network vendors
    remoteVendors.forEach((v) => {
      const id = String(v.id || v.email);
      const deliveryLocation =
        (typeof (v as any).deliveryLocation === 'string' && (v as any).deliveryLocation.trim()) ||
        (Array.isArray((v as any).deliveryLocation) && (v as any).deliveryLocation.length > 0 && (v as any).deliveryLocation.join(', ')) ||
        (Array.isArray((v as any).serviceLocations) && (v as any).serviceLocations.length > 0 && (v as any).serviceLocations.join(', ')) ||
        (Array.isArray((v as any).preferredLocations) && (v as any).preferredLocations.length > 0 && (v as any).preferredLocations.join(', ')) ||
        (v as any).location ||
        (v as any).city ||
        'India';
      const lastLogin = getSellerActualLastLogin(v, rfqs, auditLogs);
      map.set(id, {
        id,
        name: v.name || 'Verified Supplier',
        contactPerson: (v as any).contactPerson || v.name,
        email: v.email || '',
        phone: (v as any).phone || '',
        location: (v as any).location || (v as any).city || 'India',
        deliveryLocation: typeof deliveryLocation === 'string' ? deliveryLocation : 'India',
        lastLogin,
        source: (v as any).source || 'procucev_network',
        majorCategory: (v as any).majorCategory || (v as any).category || 'Industrial Supplies',
        category: (v as any).majorCategory || (v as any).category || 'Industrial Supplies',
        minorCategories: Array.isArray((v as any).minorCategories) ? (v as any).minorCategories : [],
        score: typeof (v as any).matchScore === 'number' ? (v as any).matchScore : 88,
        score360: typeof (v as any).matchScore === 'number' ? (v as any).matchScore : 88,
        rating: typeof (v as any).rating === 'number' ? (v as any).rating : 4.5,
        status: (v as any).status || 'ACTIVE',
        subscriptionPlan: (v as any).subscriptionPlan || 'Preferred Partner',
        freeQuotationCredits: (v as any).freeQuotationCredits ?? 0,
        rfqDownloadsUsed: (v as any).rfqDownloadsUsed ?? 4,
        gstNumber: (v as any).gstNumber || '27AAACG0000A1Z5',
        panNumber: (v as any).panNumber || 'AAACG0000A',
        isNetwork: true,
        createdAt: (v as any).createdAt || (v as any).created_at || '2026-03-01T10:00:00.000Z',
      });
    });

    // Add local buyer-uploaded vendors
    buyerVendors.forEach((bv) => {
      const id = String(bv.id || bv.email || 'buyer-' + Math.random());
      if (!map.has(id)) {
        const deliveryLocation =
          (typeof (bv as any).deliveryLocation === 'string' && (bv as any).deliveryLocation.trim()) ||
          (Array.isArray((bv as any).deliveryLocation) && (bv as any).deliveryLocation.length > 0 && (bv as any).deliveryLocation.join(', ')) ||
          (Array.isArray((bv as any).serviceLocations) && (bv as any).serviceLocations.length > 0 && (bv as any).serviceLocations.join(', ')) ||
          (Array.isArray((bv as any).preferredLocations) && (bv as any).preferredLocations.length > 0 && (bv as any).preferredLocations.join(', ')) ||
          bv.location ||
          'India';
        const lastLogin = getSellerActualLastLogin(bv, rfqs, auditLogs);
        map.set(id, {
          id,
          name: bv.name || 'Verified Supplier',
          contactPerson: bv.contactPerson || bv.name || 'Key Accounts Desk',
          email: bv.email || '',
          phone: bv.phone || '',
          location: bv.location || 'India',
          deliveryLocation: typeof deliveryLocation === 'string' ? deliveryLocation : 'India',
          lastLogin,
          source: 'buyer_uploaded',
          majorCategory: bv.majorCategory || 'Custom Client Category',
          category: bv.majorCategory || 'Custom Client Category',
          minorCategories: Array.isArray(bv.minorCategories) ? bv.minorCategories : [],
          score: Math.round(Number((bv as any).qualityScore || bv.score || 85)),
          score360: Math.round(Number((bv as any).qualityScore || bv.score || 85)),
          rating: Number(bv.rating || 4.2),
          status: 'VERIFIED_CLIENT_LIST',
          subscriptionPlan: 'Verified Supplier',
          freeQuotationCredits: 10,
          rfqDownloadsUsed: 2,
          gstNumber: (bv as any).gstNumber || '27AAACB1111B1Z6',
          panNumber: (bv as any).panNumber || 'AAACB1111B',
          isNetwork: false,
          createdAt: (bv as any).createdAt || (bv as any).created_at || '2026-03-01T10:00:00.000Z',
        });
      }
    });

    return Array.from(map.values());
  }, [remoteVendors, buyerVendors, rfqs, auditLogs]);

  // KPI Metrics Calculation
  const totalSellersCount = allSellers.length;
  const networkSellersCount = allSellers.filter((s) => s.source === 'procucev_network').length;
  const buyerUploadedCount = allSellers.filter((s) => s.source === 'buyer_uploaded').length;
  const verifiedCount = allSellers.filter((s) => s.status.includes('ACTIVE') || s.status.includes('VERIFIED')).length;

  const avgScore = useMemo(() => {
    if (allSellers.length === 0) return 85;
    const total = allSellers.reduce((acc, s) => acc + (Number(s.score) || 85), 0);
    return Math.round(total / allSellers.length);
  }, [allSellers]);

  // Unique categories for filter dropdown derived from taxonomy & catalogs rather than filtered list
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    if (Array.isArray(categoryTaxonomy)) {
      categoryTaxonomy.forEach((c) => {
        if (c && c.majorCategory) set.add(c.majorCategory);
      });
    }
    buyerVendors.forEach((bv) => {
      if (bv && bv.majorCategory) set.add(bv.majorCategory);
    });
    remoteVendors.forEach((rv: any) => {
      const cat = rv?.majorCategory || rv?.category;
      if (cat) set.add(cat);
    });
    if (selectedCategory && selectedCategory !== 'all') {
      set.add(selectedCategory);
    }
    return Array.from(set).sort();
  }, [categoryTaxonomy, buyerVendors, remoteVendors, selectedCategory]);

  // Filtered Sellers
  const filteredSellers = useMemo(() => {
    return allSellers.filter((seller) => {
      const q = searchTerm.toLowerCase().trim();

      const matchesSearch =
        !q ||
        seller.name?.toLowerCase().includes(q) ||
        seller.contactPerson?.toLowerCase().includes(q) ||
        seller.email?.toLowerCase().includes(q) ||
        seller.location?.toLowerCase().includes(q) ||
        seller.deliveryLocation?.toLowerCase().includes(q) ||
        (q.length <= 3
          ? String(seller.majorCategory || '').toLowerCase().split(/[\s,–—\-_/\\()]+/).includes(q)
          : seller.majorCategory?.toLowerCase().includes(q));

      const matchesSource =
        selectedSource === 'all' ||
        (selectedSource === 'network' && seller.source === 'procucev_network') ||
        (selectedSource === 'buyer' && seller.source === 'buyer_uploaded');

      const matchesCategory =
        selectedCategory === 'all' ||
        String(seller.majorCategory || '').toLowerCase().trim() === selectedCategory.toLowerCase().trim();

      const matchesRating =
        selectedRating === 'all' ||
        (selectedRating === '4plus' && Number(seller.rating) >= 4) ||
        (selectedRating === '4.5plus' && Number(seller.rating) >= 4.5);

      return matchesSearch && matchesSource && matchesCategory && matchesRating;
    });
  }, [allSellers, searchTerm, selectedSource, selectedCategory, selectedRating]);

  // Sorting Handler
  const handleSort = (columnKey: SellerDirectoryColumnKey) => {
    if (sortColumn === columnKey) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(columnKey);
      setSortOrder('asc');
    }
  };

  // Sorted Sellers
  const sortedSellers = useMemo(() => {
    if (!sortColumn) return filteredSellers;

    return [...filteredSellers].sort((a, b) => {
      let valA: any = a[sortColumn];
      let valB: any = b[sortColumn];

      if (sortColumn === 'supplierName') {
        valA = a.name || '';
        valB = b.name || '';
      } else if (sortColumn === 'category') {
        valA = a.majorCategory || a.category || '';
        valB = b.majorCategory || b.category || '';
      } else if (sortColumn === 'credits') {
        valA = Number(a.freeQuotationCredits || 0);
        valB = Number(b.freeQuotationCredits || 0);
      } else if (sortColumn === 'rating') {
        valA = Number(a.rating || 0);
        valB = Number(b.rating || 0);
      } else if (sortColumn === 'score360') {
        valA = Number(a.score || 0);
        valB = Number(b.score || 0);
      } else if (sortColumn === 'lastLogin') {
        valA = a.lastLogin ? new Date(a.lastLogin).getTime() : 0;
        valB = b.lastLogin ? new Date(b.lastLogin).getTime() : 0;
      } else if (sortColumn === 'registrationDate') {
        valA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        valB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      }

      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortOrder === 'asc' ? valA - valB : valB - valA;
      }

      const strA = String(valA || '').toLowerCase();
      const strB = String(valB || '').toLowerCase();
      return sortOrder === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
    });
  }, [filteredSellers, sortColumn, sortOrder]);

  // Paginated Sellers slice
  const totalItems = sortedSellers.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const effectivePage = Math.min(currentPage, totalPages);
  const startIndex = (effectivePage - 1) * pageSize;
  const paginatedSellers = useMemo(() => {
    return sortedSellers.slice(startIndex, startIndex + pageSize);
  }, [sortedSellers, startIndex, pageSize]);

  const handleExportDirectory = () => {
    const rows = sortedSellers.map((s) => ({
      CompanyName: s.name,
      ContactPerson: s.contactPerson || '',
      Email: s.email,
      Phone: s.phone,
      CompanyLocation: s.location,
      DeliveryLocation: s.deliveryLocation || s.location || 'All India',
      LastLogin: s.lastLogin ? formatIndianDateTime(s.lastLogin) : 'Never',
      Source: s.source === 'procucev_network' ? 'Procucev Network' : 'Buyer Uploaded',
      MajorCategory: s.majorCategory,
      AIScore: s.score,
      StarRating: s.rating,
      FreeQuotationCredits: s.freeQuotationCredits,
      RFQDownloadsUsed: s.rfqDownloadsUsed,
      Status: s.status,
    }));
    exportReportToExcel(rows, `Sellers_Directory_${new Date().toISOString().split('T')[0]}`, 'SellersDirectory');
  };

  const visibleColumns = useMemo(() => {
    return columns.filter((c) => c.visible);
  }, [columns]);

  return (
    <div className="space-y-4">
      {/* 5 SUMMARY CARDS IN ONE HORIZONTAL ROW: TOTAL SUPPLIERS, NETWORK SUPPLIERS, BUYER UPLOADED, AVG SCORE, QUOTED OPPORTUNITIES */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* Card 1: Total Suppliers */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 sm:p-3.5 rounded-xl shadow-sm flex flex-col justify-between">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{strings.totalSuppliers}</p>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mt-1">{totalSellersCount}</p>
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-1">
            {verifiedCount} Verified active
          </span>
        </div>

        {/* Card 2: Network Suppliers */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 sm:p-3.5 rounded-xl shadow-sm flex flex-col justify-between">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{strings.networkSuppliers}</p>
          <p className="text-xl sm:text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">{networkSellersCount}</p>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{strings.procucevMarketplace}</span>
        </div>

        {/* Card 3: Buyer Uploaded */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 sm:p-3.5 rounded-xl shadow-sm flex flex-col justify-between">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{strings.buyerUploadedCard}</p>
          <p className="text-xl sm:text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">{buyerUploadedCount}</p>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{strings.privateEnterpriseRoster}</span>
        </div>

        {/* Card 4: Average 360° Score */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 sm:p-3.5 rounded-xl shadow-sm flex flex-col justify-between">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{strings.avgScore}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">{avgScore}</span>
            <span className="text-xs font-semibold text-amber-500 flex items-center">
              <Star className="w-3.5 h-3.5 fill-current" /> 4.5
            </span>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{strings.aiEvaluationBenchmark}</span>
        </div>

        {/* Card 5: Quoted Opportunities */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 sm:p-3.5 rounded-xl shadow-sm flex flex-col justify-between col-span-2 sm:col-span-1">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{strings.quotedOpportunities}</p>
          <p className="text-xl sm:text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
            {rfqs.reduce((acc, r) => acc + (r.quotes || []).length, 0)}
          </p>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{strings.totalBidsDelivered}</span>
        </div>
      </div>

      {/* TOOLBAR: SEARCH, SOURCE FILTER, CATEGORY FILTER, RATING FILTER, EXPORT DIRECTORY & GEAR ICON IN ONE HORIZONTAL ROW */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 sm:p-3 shadow-sm flex flex-row items-center gap-2 sm:gap-2.5 overflow-x-auto no-scrollbar">
        {/* Search input with flexible width */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            placeholder={strings.searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-7 py-1.5 h-8.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              title="Clear search"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {loadingVendors && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 shrink-0 px-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span className="hidden sm:inline text-[11px] font-medium">Searching...</span>
          </div>
        )}

        {/* Source Filter */}
        <select
          aria-label="Filter by source"
          value={selectedSource}
          onChange={(e) => setSelectedSource(e.target.value)}
          className="!w-auto shrink-0 h-8.5 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-500 whitespace-nowrap cursor-pointer"
        >
          <option value="all">{strings.allSources}</option>
          <option value="network">{strings.procucevNetwork}</option>
          <option value="buyer">{strings.buyerUploaded}</option>
        </select>

        {/* Category Filter */}
        <select
          aria-label="Filter by category"
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="!w-auto shrink-0 h-8.5 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 max-w-[180px] focus:outline-none focus:ring-1 focus:ring-emerald-500 whitespace-nowrap cursor-pointer truncate"
        >
          <option value="all">{strings.allCategories}</option>
          {categoryOptions.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        {/* Rating Filter */}
        <select
          aria-label="Filter by rating"
          value={selectedRating}
          onChange={(e) => setSelectedRating(e.target.value)}
          className="!w-auto shrink-0 h-8.5 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-500 whitespace-nowrap cursor-pointer"
        >
          <option value="all">{strings.allRatings}</option>
          <option value="4plus">★ 4.0+ Stars</option>
          <option value="4.5plus">★ 4.5+ Stars</option>
        </select>

        {/* Export Directory and Gear icon aligned to right */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            onClick={handleExportDirectory}
            className="flex items-center gap-1.5 px-3 py-1.5 h-8.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-all shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{strings.exportDirectory}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowColumnSettings(true)}
            title="Customize Columns"
            aria-label="Customize Columns"
            className="p-2 h-8.5 w-8.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors flex items-center justify-center shrink-0 cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* DYNAMIC COLUMN SETTINGS MODAL */}
      {showColumnSettings && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Customize Columns"
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{strings.columnSettingsTitle}</h3>
                  <p className="text-[11px] text-slate-500">{strings.columnSettingsSubtitle}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowColumnSettings(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label="Close column settings"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-1 divide-y divide-slate-100 dark:divide-slate-800/60 flex-1">
              {columns.map((col, idx) => (
                <div
                  key={col.key}
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={(e) => handleDrop(e, idx)}
                  className={`pt-2 pb-2 first:pt-0 flex items-center justify-between gap-3 px-2 rounded-lg transition-colors cursor-move ${
                    draggedColIndex === idx
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 opacity-50'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <GripVertical className="w-4 h-4 text-slate-400 shrink-0 cursor-grab active:cursor-grabbing" />
                    <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none truncate">
                      <input
                        type="checkbox"
                        checked={col.visible}
                        disabled={col.required}
                        onChange={() => handleToggleColumn(col.key)}
                        className="rounded border-slate-300 dark:border-slate-700 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
                      />
                      <span className={col.required ? 'font-semibold text-slate-900 dark:text-slate-100' : ''}>
                        {col.label}
                      </span>
                    </label>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono shrink-0">#{idx + 1}</span>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
              <button
                type="button"
                onClick={handleResetColumns}
                className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 font-medium transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{strings.resetDefault}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowColumnSettings(false)}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SELLERS DATA TABLE */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
              <tr>
                {visibleColumns.map((col) => {
                  if (col.key === 'actions') {
                    return (
                      <th key={col.key} className="px-4 py-2.5 font-semibold text-right">
                        {col.label}
                      </th>
                    );
                  }

                  const isSorted = sortColumn === col.key;
                  return (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className="px-4 py-2.5 font-semibold cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors select-none"
                    >
                      <div className="flex items-center gap-1">
                        <span>{col.label}</span>
                        {isSorted ? (
                          sortOrder === 'asc' ? (
                            <ArrowUp className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <ArrowDown className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3 text-slate-400 opacity-60" />
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
              {paginatedSellers.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-4 py-12 text-center text-slate-400">
                    <p className="text-sm font-medium">{strings.noSellersFound}</p>
                    <p className="text-xs mt-1">Try adjusting search criteria or filter selections.</p>
                  </td>
                </tr>
              ) : (
                paginatedSellers.map((seller) => {
                  const isVerified =
                    seller.status?.includes('ACTIVE') ||
                    seller.status?.includes('VERIFIED');

                  return (
                    <tr
                      key={seller.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      {visibleColumns.map((col) => {
                        switch (col.key) {
                          case 'supplierName':
                            return (
                              <td key={col.key} className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                                <div
                                  className="flex items-center gap-2.5 cursor-pointer group"
                                  onClick={() => setActiveSeller(seller)}
                                >
                                  <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold text-xs flex items-center justify-center shrink-0 group-hover:bg-emerald-100 transition-colors border border-emerald-200/60 dark:border-emerald-800/50">
                                    {seller.name.charAt(0).toUpperCase()}
                                  </div>
                                  <span className="font-semibold text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                                    {seller.name}
                                  </span>
                                </div>
                              </td>
                            );
                          case 'location':
                            return (
                              <td key={col.key} className="px-4 py-3 text-slate-600 dark:text-slate-400">
                                {seller.location}
                              </td>
                            );
                          case 'deliveryLocation':
                            return (
                              <td key={col.key} className="px-4 py-3 text-slate-600 dark:text-slate-400">
                                <span className="flex items-center gap-1 truncate max-w-xs" title={seller.deliveryLocation}>
                                  <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                                  <span className="truncate">{seller.deliveryLocation}</span>
                                </span>
                              </td>
                            );
                          case 'category':
                            return (
                              <td key={col.key} className="px-4 py-3">
                                <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 truncate max-w-xs">
                                  {seller.majorCategory}
                                </span>
                              </td>
                            );
                          case 'lastLogin':
                            return (
                              <td key={col.key} className="px-4 py-3 text-slate-500 text-xs">
                                {seller.lastLogin ? (
                                  formatIndianDateTime(seller.lastLogin)
                                ) : (
                                  <span className="text-slate-400 text-[11px]">Never</span>
                                )}
                              </td>
                            );
                          case 'rating':
                            return (
                              <td key={col.key} className="px-4 py-3">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40">
                                  <Star className="w-3 h-3 fill-current text-amber-500" />
                                  {seller.rating}
                                </span>
                              </td>
                            );
                          case 'credits':
                            return (
                              <td key={col.key} className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                                {seller.freeQuotationCredits} Credits
                              </td>
                            );
                          case 'status':
                            return (
                              <td key={col.key} className="px-4 py-3">
                                <span
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                                    isVerified
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60'
                                      : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                                  }`}
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${
                                      isVerified ? 'bg-emerald-500' : 'bg-slate-400'
                                    }`}
                                  />
                                  <span>{seller.status || 'Active'}</span>
                                </span>
                              </td>
                            );
                          case 'contactPerson':
                            return (
                              <td key={col.key} className="px-4 py-3 text-slate-700 dark:text-slate-300">
                                {seller.contactPerson || '—'}
                              </td>
                            );
                          case 'email':
                            return (
                              <td key={col.key} className="px-4 py-3 text-slate-600 dark:text-slate-400">
                                {seller.email || '—'}
                              </td>
                            );
                          case 'phone':
                            return (
                              <td key={col.key} className="px-4 py-3 text-slate-600 dark:text-slate-400">
                                {seller.phone || '—'}
                              </td>
                            );
                          case 'score360':
                            return (
                              <td key={col.key} className="px-4 py-3 font-semibold text-emerald-600 dark:text-emerald-400">
                                {seller.score}/100
                              </td>
                            );
                          case 'registrationDate':
                            return (
                              <td key={col.key} className="px-4 py-3 text-slate-500 text-xs">
                                {seller.createdAt ? formatIndianDateTime(seller.createdAt) : '—'}
                              </td>
                            );
                          case 'actions':
                            return (
                              <td key={col.key} className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => setActiveSeller(seller)}
                                  className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold text-xs transition-colors inline-flex items-center gap-1 border border-emerald-200/60 dark:border-emerald-800/50 shadow-xs cursor-pointer"
                                >
                                  <span>{strings.dossierAction}</span>
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            );
                          default:
                            return null;
                        }
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {totalItems > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs text-slate-600 dark:text-slate-400">
            <div className="flex items-center gap-2">
              <span>Showing</span>
              <span className="font-semibold text-slate-900 dark:text-white">
                {startIndex + 1}
              </span>
              <span>to</span>
              <span className="font-semibold text-slate-900 dark:text-white">
                {Math.min(startIndex + pageSize, totalItems)}
              </span>
              <span>of</span>
              <span className="font-semibold text-slate-900 dark:text-white">
                {totalItems}
              </span>
              <span>entries</span>

              <div className="flex items-center gap-1.5 ml-3 pl-3 border-l border-slate-200 dark:border-slate-700">
                <span className="text-slate-500">Rows per page:</span>
                <select
                  aria-label="Rows per page"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-medium focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={effectivePage <= 1}
                className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1 font-medium"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Prev</span>
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                  if (
                    totalPages > 7 &&
                    page !== 1 &&
                    page !== totalPages &&
                    Math.abs(page - effectivePage) > 1
                  ) {
                    if (page === 2 || page === totalPages - 1) {
                      return (
                        <span key={page} className="px-1 text-slate-400">
                          ...
                        </span>
                      );
                    }
                    return null;
                  }
                  return (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`min-w-[28px] h-7 px-2 rounded-md font-medium text-xs transition-colors ${
                        effectivePage === page
                          ? 'bg-emerald-600 text-white shadow-sm font-semibold'
                          : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                      aria-label={`Page ${page}`}
                      aria-current={effectivePage === page ? 'page' : undefined}
                    >
                      {page}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={effectivePage >= totalPages}
                className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1 font-medium"
                aria-label="Next page"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 360° SUPPLIER DOSSIER DRAWER */}
      {activeSeller && (
        <SupplierDossierDrawer
          seller={activeSeller}
          onClose={() => setActiveSeller(null)}
          onSelectRFQ={onSelectRFQ}
          sellerRfqs={rfqs}
        />
      )}
    </div>
  );
}
