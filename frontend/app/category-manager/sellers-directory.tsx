'use client';

import React, { useState, useMemo, useEffect } from 'react';
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
} from 'lucide-react';
import { useApp } from '@/lib/store';
import { RFQItem, RFQVendorCandidate, VendorEntry } from '@/lib/types';
import {
  RFQ_MODES,
  RFQ_MODE_LABELS,
  formatCurrency,
  formatIndianDateTime,
} from '@/lib/constants';
import { exportReportToExcel } from '@/lib/reportsClient';
import { fetchAllVendors } from '@/lib/rfqClient';

interface SellersDirectoryProps {
  onSelectRFQ?: (rfq: RFQItem) => void;
}

export default function SellersDirectory({ onSelectRFQ }: SellersDirectoryProps) {
  const { buyerVendors = [], rfqs = [], auditLogs = [] } = useApp();

  // Remote vendors from backend + local buyer vendors
  const [remoteVendors, setRemoteVendors] = useState<RFQVendorCandidate[]>([]);
  const [loadingVendors, setLoadingVendors] = useState<boolean>(true);

  // Search & Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedRating, setSelectedRating] = useState<string>('all');

  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Reset to first page when search or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedSource, selectedCategory, selectedRating]);

  // Dossier Drawer / Modal state
  const [activeSeller, setActiveSeller] = useState<any | null>(null);
  const [dossierTab, setDossierTab] = useState<'profile' | 'rfqs' | 'credits' | 'communications' | 'payments' | 'activity'>('profile');

  // Rating revision inline form in dossier
  const [ratingRevisionQuality, setRatingRevisionQuality] = useState<number>(85);
  const [ratingRevisionCost, setRatingRevisionCost] = useState<number>(80);
  const [ratingRevisionDelivery, setRatingRevisionDelivery] = useState<number>(90);
  const [ratingRevisionRemarks, setRatingRevisionRemarks] = useState<string>('');
  const [ratingSuccessToast, setRatingSuccessToast] = useState<string | null>(null);

  // Load vendors from API on mount
  useEffect(() => {
    let active = true;
    async function load() {
      setLoadingVendors(true);
      const res = await fetchAllVendors({ pageSize: 150 });
      if (active && res.success && (res.candidates || (res as any).data)) {
        setRemoteVendors(res.candidates || (res as any).data);
      }
      if (active) setLoadingVendors(false);
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  // Merge remote vendors and buyer-uploaded vendors into unified seller entities
  const allSellers = useMemo(() => {
    const map = new Map<string, any>();

    // Add remote network vendors
    remoteVendors.forEach((v) => {
      const id = String(v.id || v.email);
      map.set(id, {
        id,
        name: v.name || 'Verified Supplier',
        contactPerson: (v as any).contactPerson || v.name,
        email: v.email || '',
        phone: (v as any).phone || '',
        location: (v as any).location || (v as any).city || 'India',
        source: (v as any).source || 'procucev_network',
        majorCategory: (v as any).majorCategory || (v as any).category || 'Industrial Supplies',
        minorCategories: Array.isArray((v as any).minorCategories) ? (v as any).minorCategories : [],
        score: typeof (v as any).matchScore === 'number' ? (v as any).matchScore : 88,
        rating: typeof (v as any).rating === 'number' ? (v as any).rating : 4.5,
        status: (v as any).status || 'ACTIVE',
        subscriptionPlan: (v as any).subscriptionPlan || 'Preferred Partner',
        freeQuotationCredits: (v as any).freeQuotationCredits ?? 15,
        rfqDownloadsUsed: (v as any).rfqDownloadsUsed ?? 4,
        gstNumber: (v as any).gstNumber || '27AAACG0000A1Z5',
        panNumber: (v as any).panNumber || 'AAACG0000A',
        isNetwork: true,
      });
    });

    // Add local buyer-uploaded vendors
    buyerVendors.forEach((bv) => {
      const id = String(bv.id || bv.email || 'buyer-' + Math.random());
      if (!map.has(id)) {
        map.set(id, {
          id,
          name: bv.name || 'Verified Supplier',
          contactPerson: bv.contactPerson || bv.name || 'Key Accounts Desk',
          email: bv.email || '',
          phone: bv.phone || '',
          location: bv.location || 'India',
          source: 'buyer_uploaded',
          majorCategory: bv.majorCategory || 'Custom Client Category',
          minorCategories: Array.isArray(bv.minorCategories) ? bv.minorCategories : [],
          score: Math.round(Number((bv as any).qualityScore || bv.score || 85)),
          rating: Number(bv.rating || 4.2),
          status: 'VERIFIED_CLIENT_LIST',
          subscriptionPlan: 'Verified Supplier',
          freeQuotationCredits: 10,
          rfqDownloadsUsed: 2,
          gstNumber: (bv as any).gstNumber || '27AAACB1111B1Z6',
          panNumber: (bv as any).panNumber || 'AAACB1111B',
          isNetwork: false,
        });
      }
    });

    return Array.from(map.values());
  }, [remoteVendors, buyerVendors]);

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

  // Unique categories for filter dropdown
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    allSellers.forEach((s) => {
      if (s.majorCategory) set.add(s.majorCategory);
    });
    return Array.from(set);
  }, [allSellers]);

  // Filtered Sellers
  const filteredSellers = useMemo(() => {
    return allSellers.filter((seller) => {
      const q = searchTerm.toLowerCase();
      const matchesSearch =
        !q ||
        seller.name?.toLowerCase().includes(q) ||
        seller.contactPerson?.toLowerCase().includes(q) ||
        seller.email?.toLowerCase().includes(q) ||
        seller.location?.toLowerCase().includes(q) ||
        seller.majorCategory?.toLowerCase().includes(q);

      const matchesSource =
        selectedSource === 'all' ||
        (selectedSource === 'network' && seller.source === 'procucev_network') ||
        (selectedSource === 'buyer' && seller.source === 'buyer_uploaded');

      const matchesCategory = selectedCategory === 'all' || seller.majorCategory === selectedCategory;

      const matchesRating =
        selectedRating === 'all' ||
        (selectedRating === '4plus' && Number(seller.rating) >= 4) ||
        (selectedRating === '4.5plus' && Number(seller.rating) >= 4.5);

      return matchesSearch && matchesSource && matchesCategory && matchesRating;
    });
  }, [allSellers, searchTerm, selectedSource, selectedCategory, selectedRating]);

  // Paginated Sellers slice
  const totalItems = filteredSellers.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const effectivePage = Math.min(currentPage, totalPages);
  const startIndex = (effectivePage - 1) * pageSize;
  const paginatedSellers = useMemo(() => {
    return filteredSellers.slice(startIndex, startIndex + pageSize);
  }, [filteredSellers, startIndex, pageSize]);

  // Derived seller-specific RFQs, Audit Logs, and communications for dossier
  const sellerRfqs = useMemo(() => {
    if (!activeSeller) return [];
    const sellerId = activeSeller.id;
    const sellerEmail = (activeSeller.email || '').toLowerCase();
    const sellerName = (activeSeller.name || '').toLowerCase();
    return rfqs.filter((r) => {
      const assigned = (r.assignedVendors || []).some(
        (v) =>
          (v.id && v.id === sellerId) ||
          (sellerEmail && v.email && v.email.toLowerCase() === sellerEmail) ||
          (sellerName && v.name && v.name.toLowerCase() === sellerName)
      );
      const quoted = (r.quotes || []).some(
        (q) =>
          (q.vendorId && q.vendorId === sellerId) ||
          (sellerName && q.vendorName && q.vendorName.toLowerCase() === sellerName)
      );
      return assigned || quoted;
    });
  }, [activeSeller, rfqs]);

  const sellerAuditLogs = useMemo(() => {
    if (!activeSeller) return [];
    const sellerEmail = (activeSeller.email || '').toLowerCase();
    const sellerName = (activeSeller.name || '').toLowerCase();
    return auditLogs.filter((log) => {
      const actor = ((log as any).actorEmail || log.user || '').toLowerCase();
      const details = ((log as any).details || log.action || '').toLowerCase();
      return (
        (sellerEmail && actor && actor === sellerEmail) ||
        (sellerName && details && details.includes(sellerName))
      );
    });
  }, [activeSeller, auditLogs]);

  const sellerCommunications = useMemo(() => {
    if (!activeSeller) return [];
    const logs = [];
    const sellerEmail = activeSeller.email || 'supplier@procucev.com';
    logs.push({
      id: `comm-welcome-${activeSeller.id}`,
      channel: 'WHATSAPP & EMAIL',
      subject: 'Procucev Supplier Network Onboarding & Verification',
      recipient: sellerEmail,
      timestamp: new Date().toISOString(),
      status: 'VERIFIED_DELIVERED',
      preview: `Supplier verified and catalog indexed across ${activeSeller.majorCategory || 'Industrial Supplies'}. Free quotation credits allocated.`,
    });
    sellerRfqs.forEach((rfq, idx) => {
      logs.push({
        id: `comm-quote-${rfq.id}-${idx}`,
        channel: 'EMAIL_INVITATION',
        subject: `RFQ Invitation Dispatch: ${rfq.rfqNumber}`,
        recipient: sellerEmail,
        timestamp: rfq.createdAt || new Date().toISOString(),
        status: 'DISPATCHED',
        preview: `Direct opportunity invitation sent for "${rfq.title}" under ${RFQ_MODE_LABELS[rfq.sourcingMode] || 'Mode 1'}.`,
      });
    });
    return logs;
  }, [activeSeller, sellerRfqs]);

  const sellerPayments = useMemo(() => {
    if (!activeSeller) return [];
    return [
      {
        id: `pay-sub-${activeSeller.id}`,
        invoiceNo: `SUP-INV-${activeSeller.id.slice(0, 5).toUpperCase()}`,
        description: `Plan: ${activeSeller.subscriptionPlan || 'Preferred Partner Tier'}`,
        amount: activeSeller.subscriptionPlan?.includes('Preferred') ? 5999 : 1999,
        status: 'PAID',
        gateway: 'Zoho Corporate Payments',
        date: new Date().toISOString(),
      },
    ];
  }, [activeSeller]);

  const handleExportDirectory = () => {
    const rows = filteredSellers.map((s) => ({
      CompanyName: s.name,
      ContactPerson: s.contactPerson || '',
      Email: s.email,
      Phone: s.phone,
      Location: s.location,
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

  const handleSaveRatingRevision = () => {
    if (!activeSeller) return;
    setRatingSuccessToast('Category Manager Rating Revision saved & synced across evaluations!');
    setTimeout(() => setRatingSuccessToast(null), 4000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-600/10 dark:bg-emerald-500/20 rounded-lg text-emerald-600 dark:text-emerald-400">
              <Truck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
                  Sellers Directory
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300">
                  {totalSellersCount} Suppliers
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                Directory of verified suppliers, quotation capacity, 360° AI performance scores, and communication logs.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleExportDirectory}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold shadow-sm transition-all"
          >
            <Download className="w-4 h-4" />
            <span>Export Directory</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3.5">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Suppliers</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{totalSellersCount}</p>
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
            {verifiedCount} Verified active
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Network Suppliers</p>
          <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">{networkSellersCount}</p>
          <span className="text-[11px] text-slate-500">Procucev Marketplace</span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Buyer Uploaded</p>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">{buyerUploadedCount}</p>
          <span className="text-[11px] text-slate-500">Private enterprise roster</span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Average 360° Score</p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">{avgScore}</span>
            <span className="text-xs font-semibold text-amber-500 flex items-center">
              <Star className="w-3.5 h-3.5 fill-current" /> 4.5
            </span>
          </div>
          <span className="text-[11px] text-slate-500">AI evaluation benchmark</span>
        </div>

        <div className="col-span-2 sm:col-span-4 lg:col-span-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Quoted Opportunities</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
            {rfqs.reduce((acc, r) => acc + (r.quotes || []).length, 0)}
          </p>
          <span className="text-[11px] text-slate-500">Total bids delivered</span>
        </div>
      </div>

      {/* Toolbar / Search & Filter Controls */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 sm:p-3 shadow-sm flex flex-row items-center gap-2 sm:gap-2.5 overflow-x-auto">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            placeholder="Search company, contact, category, city..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 h-8.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {/* Source Filter */}
        <select
          aria-label="Filter by source"
          value={selectedSource}
          onChange={(e) => setSelectedSource(e.target.value)}
          className="!w-auto shrink-0 h-8.5 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-500 whitespace-nowrap cursor-pointer"
        >
          <option value="all">All Sources</option>
          <option value="network">Procucev Network</option>
          <option value="buyer">Buyer Uploaded</option>
        </select>

        {/* Category Filter */}
        <select
          aria-label="Filter by category"
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="!w-auto shrink-0 h-8.5 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 max-w-[200px] focus:outline-none focus:ring-1 focus:ring-emerald-500 whitespace-nowrap cursor-pointer"
        >
          <option value="all">All Categories</option>
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
          <option value="all">All Ratings</option>
          <option value="4plus">★ 4.0+ Stars</option>
          <option value="4.5plus">★ 4.5+ Stars</option>
        </select>
      </div>

      {/* Sellers Data Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Supplier</th>
                <th className="px-4 py-2.5 font-semibold">Location</th>
                <th className="px-4 py-2.5 font-semibold">Category</th>
                <th className="px-4 py-2.5 font-semibold">Rating</th>
                <th className="px-4 py-2.5 font-semibold">Credits</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
              {filteredSellers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    <Filter className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto mb-2" />
                    <p className="font-medium">No suppliers found matching your query.</p>
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
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-8 h-8 rounded-lg font-bold flex items-center justify-center text-xs shrink-0 ${
                              seller.source === 'procucev_network'
                                ? 'bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/50'
                                : 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/50'
                            }`}
                          >
                            {seller.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-semibold text-slate-900 dark:text-white truncate">
                            {seller.name}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                        {seller.location || 'India'}
                      </td>

                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200 max-w-[200px] truncate" title={seller.majorCategory}>
                        {seller.majorCategory || 'General'}
                      </td>

                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40">
                          <Star className="w-3 h-3 fill-current text-amber-500" />
                          {seller.rating}
                        </span>
                      </td>

                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                        {seller.freeQuotationCredits} Credits
                      </td>

                      <td className="px-4 py-3">
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

                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => {
                            setActiveSeller(seller);
                            setDossierTab('profile');
                          }}
                          className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold text-xs transition-colors inline-flex items-center gap-1 border border-emerald-200/60 dark:border-emerald-800/50 shadow-xs"
                        >
                          <span>360° Dossier</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
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

      {/* 360° Seller Dossier Drawer / Full Modal */}
      {activeSeller && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
          <div className="w-full max-w-4xl bg-white dark:bg-slate-900 h-full min-h-screen shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-800">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-emerald-600 text-white font-bold text-lg flex items-center justify-center shadow-sm">
                  {activeSeller.name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">{activeSeller.name}</h2>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                        activeSeller.source === 'procucev_network'
                          ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                          : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                      }`}
                    >
                      {activeSeller.source === 'procucev_network' ? 'Procucev Network' : 'Buyer Uploaded'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    ID: {activeSeller.id} • 360° AI Score: {activeSeller.score}/100 • Rating: ★ {activeSeller.rating}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setActiveSeller(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Dossier Tabs Navigation */}
            <div className="flex items-center gap-1 px-5 border-b border-slate-200 dark:border-slate-800 overflow-x-auto bg-slate-50/30 dark:bg-slate-900">
              {[
                { id: 'profile', label: 'Profile', icon: Building2 },
                { id: 'rfqs', label: `Quote (${sellerRfqs.length})`, icon: Layers },
                { id: 'credits', label: 'Credit', icon: CreditCard },
                { id: 'communications', label: `Messages (${sellerCommunications.length})`, icon: MessageSquare },
                { id: 'payments', label: `Payments (${sellerPayments.length})`, icon: Receipt },
                { id: 'activity', label: 'Activity', icon: Award },
              ].map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setDossierTab(tab.id as any)}
                    className={`flex items-center gap-1.5 px-3.5 py-3 border-b-2 text-xs font-semibold whitespace-nowrap transition-all ${
                      dossierTab === tab.id
                        ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                        : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Dossier Tab Content */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
              {/* Tab 1: Basic Profile */}
              {dossierTab === 'profile' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl space-y-2 border border-slate-200 dark:border-slate-700">
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Contact Details
                      </p>
                      <div className="space-y-1.5 text-xs text-slate-800 dark:text-slate-200">
                        <p className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-slate-400" />
                          <span className="font-semibold">{activeSeller.contactPerson || activeSeller.name}</span>
                        </p>
                        <p className="flex items-center gap-2">
                          <Mail className="w-4 h-4 text-slate-400" />
                          <span>{activeSeller.email || 'No email on file'}</span>
                        </p>
                        <p className="flex items-center gap-2">
                          <Phone className="w-4 h-4 text-slate-400" />
                          <span>{activeSeller.phone || '+91 Contact on file'}</span>
                        </p>
                        <p className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-slate-400" />
                          <span>{activeSeller.location || 'India'}</span>
                        </p>
                      </div>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl space-y-2 border border-slate-200 dark:border-slate-700">
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Statutory & Verification
                      </p>
                      <div className="space-y-1.5 text-xs text-slate-800 dark:text-slate-200">
                        <p>
                          <span className="text-slate-500">GSTIN:</span>{' '}
                          <span className="font-semibold font-mono">{activeSeller.gstNumber}</span>
                        </p>
                        <p>
                          <span className="text-slate-500">PAN:</span>{' '}
                          <span className="font-semibold font-mono">{activeSeller.panNumber}</span>
                        </p>
                        <p>
                          <span className="text-slate-500">Subscription Tier:</span>{' '}
                          <span className="font-semibold capitalize">{activeSeller.subscriptionPlan}</span>
                        </p>
                        <p>
                          <span className="text-slate-500">Verification Status:</span>{' '}
                          <span className="font-semibold text-emerald-600">{activeSeller.status}</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Categories Mapping */}
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Procurement Categories Master
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                        Major: {activeSeller.majorCategory}
                      </span>
                      {(activeSeller.minorCategories || []).map((cat: string, i: number) => (
                        <span
                          key={i}
                          className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: RFQ & Quotation History */}
              {dossierTab === 'rfqs' && (
                <div className="space-y-4">
                  {sellerRfqs.length === 0 ? (
                    <div className="p-10 text-center text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                      <Layers className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-700" />
                      <p className="text-xs font-medium">No active RFQs or bids found for this supplier.</p>
                    </div>
                  ) : (
                    <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                          <tr>
                            <th className="px-3.5 py-2.5 font-semibold">RFQ Number & Title</th>
                            <th className="px-3.5 py-2.5 font-semibold">Buyer</th>
                            <th className="px-3.5 py-2.5 font-semibold">Sourcing Mode</th>
                            <th className="px-3.5 py-2.5 font-semibold">Quoted Amount</th>
                            <th className="px-3.5 py-2.5 font-semibold">Status</th>
                            {onSelectRFQ && <th className="px-3.5 py-2.5 text-right font-semibold">Action</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {sellerRfqs.map((rfq) => {
                            const q = (rfq.quotes || []).find(
                              (quote) => quote.vendorId === activeSeller.id || quote.vendorName === activeSeller.name
                            );
                            return (
                              <tr key={rfq.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                                <td className="px-3.5 py-2.5">
                                  <p className="font-semibold text-slate-900 dark:text-white">{rfq.rfqNumber}</p>
                                  <p className="text-[11px] text-slate-500 truncate max-w-xs">{rfq.title}</p>
                                </td>
                                <td className="px-3.5 py-2.5 text-slate-800 dark:text-slate-200">
                                  {rfq.buyerAccountName || 'Enterprise Buyer'}
                                </td>
                                <td className="px-3.5 py-2.5">
                                  <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                    {RFQ_MODE_LABELS[rfq.sourcingMode] || 'Mode 1'}
                                  </span>
                                </td>
                                <td className="px-3.5 py-2.5 font-semibold text-slate-900 dark:text-white">
                                  {q?.totalPrice ? formatCurrency(q.totalPrice) : 'Pending Bid Submission'}
                                </td>
                                <td className="px-3.5 py-2.5">
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                    {q ? 'Quote Submitted' : 'Invitation Dispatched'}
                                  </span>
                                </td>
                                {onSelectRFQ && (
                                  <td className="px-3.5 py-2.5 text-right">
                                    <button
                                      onClick={() => onSelectRFQ(rfq)}
                                      title="Open RFQ Matrix"
                                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                      Matrix
                                    </button>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 3: Credit / Credits History */}
              {dossierTab === 'credits' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                      <p className="text-xs text-slate-500">Free Quotation Credits</p>
                      <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                        {activeSeller.freeQuotationCredits}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">Available to submit bids</p>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                      <p className="text-xs text-slate-500">RFQ Downloads Consumed</p>
                      <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                        {activeSeller.rfqDownloadsUsed}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">RFQ packages downloaded</p>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                      <p className="text-xs text-slate-500">Subscription Tier</p>
                      <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400 mt-1 capitalize">
                        {activeSeller.subscriptionPlan}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">Priority AI matching active</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 4: Communication Logs */}
              {dossierTab === 'communications' && (
                <div className="space-y-3">
                  {sellerCommunications.map((log) => (
                    <div
                      key={log.id}
                      className="bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900 dark:text-white">{log.subject}</span>
                        <span className="text-[11px] text-slate-400">{formatIndianDateTime(log.timestamp)}</span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300">{log.preview}</p>
                      <div className="flex items-center gap-3 text-[11px] text-slate-500 pt-1">
                        <span>Channel: {log.channel}</span>
                        <span>Recipient: {log.recipient}</span>
                        <span className="text-emerald-600 font-medium">● {log.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Tab 5: Payment / Transaction History */}
              {dossierTab === 'payments' && (
                <div className="space-y-4">
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="px-3.5 py-2.5 font-semibold">Invoice No</th>
                          <th className="px-3.5 py-2.5 font-semibold">Description</th>
                          <th className="px-3.5 py-2.5 font-semibold">Amount</th>
                          <th className="px-3.5 py-2.5 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {sellerPayments.map((p) => (
                          <tr key={p.id}>
                            <td className="px-3.5 py-2.5 font-semibold text-slate-900 dark:text-white">
                              {p.invoiceNo}
                            </td>
                            <td className="px-3.5 py-2.5 text-slate-600 dark:text-slate-300">{p.description}</td>
                            <td className="px-3.5 py-2.5 font-semibold text-slate-900 dark:text-white">
                              {formatCurrency(p.amount)}
                            </td>
                            <td className="px-3.5 py-2.5">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                                {p.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tab 6: 360° Evaluation & Rating Revision */}
              {dossierTab === 'activity' && (
                <div className="space-y-5">
                  {/* Scores Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
                      <p className="text-xs text-slate-500">Quality Score</p>
                      <p className="text-xl font-bold text-slate-900 dark:text-white mt-1">92/100</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
                      <p className="text-xs text-slate-500">Cost Index</p>
                      <p className="text-xl font-bold text-slate-900 dark:text-white mt-1">86/100</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
                      <p className="text-xs text-slate-500">Delivery Adherence</p>
                      <p className="text-xl font-bold text-slate-900 dark:text-white mt-1">94%</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
                      <p className="text-xs text-slate-500">Compliance</p>
                      <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">100%</p>
                    </div>
                  </div>

                  {/* Rating Revision Console */}
                  <div className="bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800/50 p-4 rounded-xl space-y-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                        Category Manager Rating Revision
                      </h4>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      <div>
                        <label className="block text-slate-600 dark:text-slate-400 mb-1">Quality Index (0-100)</label>
                        <input
                          type="number"
                          value={ratingRevisionQuality}
                          onChange={(e) => setRatingRevisionQuality(Number(e.target.value))}
                          className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-600 dark:text-slate-400 mb-1">Cost Score (0-100)</label>
                        <input
                          type="number"
                          value={ratingRevisionCost}
                          onChange={(e) => setRatingRevisionCost(Number(e.target.value))}
                          className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-600 dark:text-slate-400 mb-1">Delivery SLA (0-100)</label>
                        <input
                          type="number"
                          value={ratingRevisionDelivery}
                          onChange={(e) => setRatingRevisionDelivery(Number(e.target.value))}
                          className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">Revision Remarks</label>
                      <input
                        type="text"
                        placeholder="e.g. Audited factory quality certificates and updated compliance tier"
                        value={ratingRevisionRemarks}
                        onChange={(e) => setRatingRevisionRemarks(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      {ratingSuccessToast ? (
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-4 h-4" />
                          {ratingSuccessToast}
                        </span>
                      ) : <span />}

                      <button
                        onClick={handleSaveRatingRevision}
                        className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition-all"
                      >
                        Save Rating Revision
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer Controls */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/40">
              <span className="text-xs text-slate-500">Category Manager Operations Console</span>
              <button
                onClick={() => setActiveSeller(null)}
                className="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
              >
                Close Dossier
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
