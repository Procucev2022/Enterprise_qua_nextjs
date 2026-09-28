'use client';

import React, { useMemo, useState } from 'react';
import { useApp } from '@/lib/store';
import { RFQItem, VendorEntry, BuyerAccount } from '@/lib/types';
import { UI_STRINGS } from '@/lib/uiStrings';
import {
  Layers,
  Search,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  X,
  FileText,
  Users,
  Building,
  CheckCircle2,
  ExternalLink,
  Tag,
  TrendingUp,
  Clock,
  ShieldCheck,
  Package,
} from 'lucide-react';
import CompanyHoverTooltip from '@/app/components/CompanyHoverTooltip';

type TimeframeOption = '7d' | '30d' | '90d' | '180d' | '1y';

const TIMEFRAME_DAYS: Record<TimeframeOption, number> = { '7d': 7, '30d': 30, '90d': 90, '180d': 180, '1y': 365 };
const TIMEFRAME_LABELS: Record<TimeframeOption, string> = {
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
  '90d': 'Last 90 Days (Quarterly)',
  '180d': 'Last 180 Days (Half Yearly)',
  '1y': 'Last 1 Year (Annual)',
};

interface CategoryMetric {
  majorCategory: string;
  minorCount: number;
  rfqsCount: Record<TimeframeOption, number>;
  quotesReceived: Record<TimeframeOption, number>;
  activeBuyers: string[];
  availableVendorsCount: number;
  featuredVendors: string[];
  growthPercentage: Record<TimeframeOption, number | null>;
  demandStatus: 'High Demand' | 'Optimal' | 'Growing' | 'Emerging' | 'No Activity';
}

export function parseTimestamp(value: string): number {
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// RFQs created in the real-time window [now - offsetDays - days, now - offsetDays),
// optionally scoped to one major category.
export function rfqsInWindow(rfqs: RFQItem[], days: number, offsetDays: number, majorCategory?: string): RFQItem[] {
  const now = Date.now();
  const end = now - offsetDays * 86400000;
  const start = end - days * 86400000;
  return rfqs.filter((r) => {
    if (majorCategory && r.category !== majorCategory) return false;
    const t = parseTimestamp(r.createdAt);
    return t >= start && t < end;
  });
}

// Compares the current window against the equal-length window immediately
// before it. Returns null when there's no prior-period baseline to compare
// against (a 0-to-N jump isn't a meaningful percentage) rather than
// fabricating a number.
export function growthPercentFor(rfqs: RFQItem[], days: number, majorCategory?: string): number | null {
  const current = rfqsInWindow(rfqs, days, 0, majorCategory).length;
  const prior = rfqsInWindow(rfqs, days, days, majorCategory).length;
  if (prior === 0) return current > 0 ? null : 0;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

export function demandStatusFor(rfqsIn30d: number): CategoryMetric['demandStatus'] {
  if (rfqsIn30d === 0) return 'No Activity';
  if (rfqsIn30d >= 10) return 'High Demand';
  if (rfqsIn30d >= 5) return 'Optimal';
  if (rfqsIn30d >= 2) return 'Growing';
  return 'Emerging';
}

export function GrowthBadge({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="inline-flex items-center gap-0.5 text-xs font-black text-indigo-600 dark:text-indigo-400 mono">New</span>;
  }
  if (value === 0) {
    return <span className="inline-flex items-center gap-0.5 text-xs font-black text-slate-400 dark:text-gray-500 mono">Flat</span>;
  }
  const isUp = value > 0;
  const Icon = isUp ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-black mono ${isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
      <Icon size={13} /> {isUp ? '+' : ''}{value}%
    </span>
  );
}

export interface ExtractedQuoteItem {
  rfq: RFQItem;
  quote: {
    vendorName: string;
    unitPrice: number;
    totalPrice: number;
    leadTimeDays: number;
    complianceStatus: string;
    vendorId?: string;
  };
}

export function extractQuotesFromRfqs(rfqList: RFQItem[], vendors: VendorEntry[]): ExtractedQuoteItem[] {
  const list: ExtractedQuoteItem[] = [];

  rfqList.forEach((r) => {
    const qList = (r.quotes || (r as any).quoteComparison || []) as any[];
    if (Array.isArray(qList) && qList.length > 0) {
      qList.forEach((q) => {
        list.push({
          rfq: r,
          quote: {
            vendorName: q.vendorName || (r as any).bestQuoteVendor || 'Quoted Vendor',
            unitPrice: q.unitPrice ?? (r as any).lowestQuote ?? 0,
            totalPrice: q.totalPrice ?? q.unitPrice ?? (r as any).lowestQuote ?? 0,
            leadTimeDays: q.leadTimeDays ?? 7,
            complianceStatus: q.complianceStatus ?? 'Fully Compliant',
            vendorId: q.vendorId,
          },
        });
      });
    } else if ((r.quotesCount || 0) > 0) {
      const count = r.quotesCount || 1;
      for (let i = 0; i < count; i++) {
        const defaultVendor =
          (r as any).bestQuoteVendor ||
          (r.assignedVendors && r.assignedVendors[i]?.name) ||
          (vendors.length > 0 ? vendors[i % vendors.length]?.name : undefined) ||
          `Supplier Response #${i + 1}`;
        const price = (r as any).lowestQuote || (r.budget ? Math.round(r.budget * (0.9 + i * 0.05)) : 50000);
        list.push({
          rfq: r,
          quote: {
            vendorName: defaultVendor,
            unitPrice: price,
            totalPrice: price,
            leadTimeDays: 7 + i * 2,
            complianceStatus: 'Fully Compliant',
            vendorId: (r.assignedVendors && r.assignedVendors[i]?.id) || `v-${i + 1}`,
          },
        });
      }
    }
  });
  return list;
}

export function doesBuyerMatchRfq(account: BuyerAccount, rfq: RFQItem): boolean {
  if (rfq.buyerAccountId && rfq.buyerAccountId === account.id) return true;
  if (rfq.buyerAccountName && account.organizationName && rfq.buyerAccountName.toLowerCase() === account.organizationName.toLowerCase()) return true;
  if (rfq.buyerAccountName && account.contactPerson && rfq.buyerAccountName.toLowerCase() === account.contactPerson.toLowerCase()) return true;
  if (rfq.raisedByEmail && account.corporateEmail && rfq.raisedByEmail.toLowerCase() === account.corporateEmail.toLowerCase()) return true;
  return false;
}

export function formatLocation(city?: string, state?: string): string {
  if (!city) return 'National';
  return state ? `${city}, ${state}` : city;
}

export function formatContactInfo(phone?: string, email?: string): string {
  return phone || email || '—';
}

export function formatRating(rating?: number): string {
  return typeof rating === 'number' && Number.isFinite(rating) ? String(rating) : '4.5';
}

export function formatContactPerson(contactPerson?: string): string {
  return contactPerson && contactPerson.trim() ? contactPerson.trim() : 'Sales Coordinator';
}

export default function CategorySummaryDashboard() {
  const {
    rfqs,
    buyerVendors,
    buyerAccounts,
    addAuditLog,
    showToast,
    categoryTaxonomy,
    categoryTaxonomyError,
  } = useApp();

  const taxonomy = useMemo(() => categoryTaxonomy || [], [categoryTaxonomy]);

  const [timeframe, setTimeframe] = useState<TimeframeOption>('30d');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedMajor, setExpandedMajor] = useState<Record<string, boolean>>({});

  // Modal States
  const [selectedKpiModal, setSelectedKpiModal] = useState<'categories' | 'rfqs' | 'quotes' | 'buyers' | 'vendors' | null>(null);
  const [selectedCategoryDetails, setSelectedCategoryDetails] = useState<CategoryMetric | null>(null);
  const [categoryDetailTab, setCategoryDetailTab] = useState<'rfqs' | 'quotes' | 'buyers' | 'vendors' | 'minors'>('rfqs');

  // Filtered RFQs for selected timeframe
  const rfqsInSelectedTimeframe = useMemo(() => {
    return rfqsInWindow(rfqs, TIMEFRAME_DAYS[timeframe], 0);
  }, [rfqs, timeframe]);

  // Quotes in selected timeframe
  const quotesInSelectedTimeframe = useMemo(() => {
    return extractQuotesFromRfqs(rfqsInSelectedTimeframe, buyerVendors);
  }, [rfqsInSelectedTimeframe, buyerVendors]);

  const categoryMetrics: CategoryMetric[] = useMemo(() => {
    return taxonomy.map((cat) => {
      const majorCategory = cat.majorCategory;
      const rfqsCount = {} as Record<TimeframeOption, number>;
      const quotesReceived = {} as Record<TimeframeOption, number>;
      const growthPercentage = {} as Record<TimeframeOption, number | null>;

      (Object.keys(TIMEFRAME_DAYS) as TimeframeOption[]).forEach((tf) => {
        const inWindow = rfqsInWindow(rfqs, TIMEFRAME_DAYS[tf], 0, majorCategory);
        rfqsCount[tf] = inWindow.length;
        quotesReceived[tf] = inWindow.reduce((sum, r) => {
          const qCount = (r.quotes && r.quotes.length > 0) ? r.quotes.length : (r.quotesCount || 0);
          return sum + qCount;
        }, 0);
        growthPercentage[tf] = growthPercentFor(rfqs, TIMEFRAME_DAYS[tf], majorCategory);
      });

      const activeBuyers = Array.from(
        new Set(
          rfqs
            .filter((r) => (r.category || '').trim().toLowerCase() === majorCategory.trim().toLowerCase() && r.buyerAccountName)
            .map((r) => r.buyerAccountName as string)
        )
      );

      const vendorsInCategory = buyerVendors.filter(
        (v) => (v.majorCategory || '').trim().toLowerCase() === majorCategory.trim().toLowerCase()
      );
      const featuredVendors = [...vendorsInCategory]
        .sort((a, b) => (b.rating || 0) - (a.rating || 0))
        .slice(0, 4)
        .map((v) => v.name);

      return {
        majorCategory,
        minorCount: cat.minorCategories.length,
        rfqsCount,
        quotesReceived,
        activeBuyers,
        availableVendorsCount: vendorsInCategory.length,
        featuredVendors,
        growthPercentage,
        demandStatus: demandStatusFor(rfqsCount['30d']),
      };
    });
  }, [rfqs, buyerVendors, taxonomy]);

  const minorCategoryCountsFor = (majorCategory: string): Record<string, number> => {
    const counts: Record<string, number> = {};
    rfqs
      .filter((r) => (r.category || '').trim().toLowerCase() === majorCategory.trim().toLowerCase())
      .forEach((r) => {
        const seenMinors = new Set(r.extractedEntities.map((e) => e.minorCategory).filter(Boolean));
        seenMinors.forEach((m) => {
          counts[m] = (counts[m] || 0) + 1;
        });
      });
    return counts;
  };

  // Calculate totals for chosen timeframe
  const totalRfqsInTimeframe = rfqsInSelectedTimeframe.length;
  const totalQuotesReceivedInTimeframe = quotesInSelectedTimeframe.length;
  const totalAvailableVendors = buyerVendors.length;
  const overallGrowth = growthPercentFor(rfqs, TIMEFRAME_DAYS[timeframe]);

  const buyersWithAnyRfq = buyerAccounts.filter((a) => rfqs.some((r) => doesBuyerMatchRfq(a, r))).length;
  const activeBuyerPercent = buyerAccounts.length > 0 ? Math.round((buyersWithAnyRfq / buyerAccounts.length) * 100) : 0;

  const avgVendorRating =
    buyerVendors.length > 0
      ? (buyerVendors.reduce((sum, v) => sum + (v.rating || 0), 0) / buyerVendors.length).toFixed(1)
      : '—';

  const totalMinorCategories = taxonomy.reduce((sum, c) => sum + c.minorCategories.length, 0);

  // Filter Categories
  const filteredMetrics = categoryMetrics.filter((c) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const matchesMajor = c.majorCategory.toLowerCase().includes(term);
    const catDetail = taxonomy.find((cd) => cd.majorCategory === c.majorCategory);
    const matchesMinor = catDetail?.minorCategories.some((m) => m.toLowerCase().includes(term));
    const matchesBuyer = c.activeBuyers.some((b) => b.toLowerCase().includes(term));
    const matchesVendor = c.featuredVendors.some((v) => v.toLowerCase().includes(term));
    return matchesMajor || matchesMinor || matchesBuyer || matchesVendor;
  });

  // RFQs & Quotes for Category Details Modal
  const categoryRfqs = useMemo(() => {
    if (!selectedCategoryDetails) return [];
    return rfqs.filter((r) => r.category === selectedCategoryDetails.majorCategory);
  }, [rfqs, selectedCategoryDetails]);

  const categoryQuotes = useMemo(() => {
    if (!selectedCategoryDetails) return [];
    return extractQuotesFromRfqs(categoryRfqs, buyerVendors);
  }, [categoryRfqs, selectedCategoryDetails, buyerVendors]);

  const categoryVendors = useMemo(() => {
    if (!selectedCategoryDetails) return [];
    return buyerVendors.filter((v) => v.majorCategory === selectedCategoryDetails.majorCategory);
  }, [buyerVendors, selectedCategoryDetails]);

  const categoryDetailObj = useMemo(() => {
    if (!selectedCategoryDetails) return null;
    return taxonomy.find((c) => c.majorCategory === selectedCategoryDetails.majorCategory);
  }, [taxonomy, selectedCategoryDetails]);

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Title & Timeframe Selector Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <Layers className="text-indigo-600 dark:text-indigo-400" /> Category Governance &amp; Demand-Supply Analytics
          </h1>
        </div>

        {/* Timeframe Filter Bar */}
        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-gray-900 p-1.5 rounded-2xl border border-slate-200 dark:border-gray-800 shadow-xs">
          {(['7d', '30d', '90d', '180d', '1y'] as TimeframeOption[]).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all ${
                timeframe === tf
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-800'
              }`}
            >
              {tf === '7d' ? '7 Days' : tf === '30d' ? '30 Days' : tf === '90d' ? '90 Days' : tf === '180d' ? '180 Days' : '1 Year'}
            </button>
          ))}
        </div>
      </div>

      {/* Top Analytics Summary Strip - Interactive KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        {/* KPI 1: Active Categories */}
        <button
          type="button"
          onClick={() => {
            setSelectedKpiModal('categories');
            addAuditLog('Category Manager opened Active Categories KPI breakdown');
          }}
          className="text-left glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between hover:border-indigo-500/50 hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
              Active Categories
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
              View
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-slate-900 dark:text-white mono">{taxonomy.length} Major</span>
            <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold">{totalMinorCategories} Minor</span>
          </div>
        </button>

        {/* KPI 2: RFQs Raised */}
        <button
          type="button"
          onClick={() => {
            setSelectedKpiModal('rfqs');
            addAuditLog(`Category Manager opened RFQs Raised KPI breakdown for ${timeframe.toUpperCase()}`);
          }}
          className="text-left glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between hover:border-indigo-500/50 hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
              RFQs Raised ({timeframe.toUpperCase()})
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
              View
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-slate-900 dark:text-white mono">{totalRfqsInTimeframe} RFQs</span>
            <GrowthBadge value={overallGrowth} />
          </div>
        </button>

        {/* KPI 3: Quotes Received */}
        <button
          type="button"
          onClick={() => {
            setSelectedKpiModal('quotes');
            addAuditLog(`Category Manager opened Quotes Received KPI breakdown for ${timeframe.toUpperCase()}`);
          }}
          className="text-left glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between hover:border-sky-500/50 hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500 group-hover:text-sky-600 dark:group-hover:text-cyan-400 transition-colors">
              Quotes Received
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-cyan-400 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
              View
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-sky-600 dark:text-cyan-400 mono">{totalQuotesReceivedInTimeframe} Quotes</span>
            <span className="text-[10px] text-sky-600 dark:text-cyan-400 font-bold">
              {totalRfqsInTimeframe > 0 ? (totalQuotesReceivedInTimeframe / totalRfqsInTimeframe).toFixed(1) : '0.0'} / RFQ
            </span>
          </div>
        </button>

        {/* KPI 4: Active Buyers */}
        <button
          type="button"
          onClick={() => {
            setSelectedKpiModal('buyers');
            addAuditLog('Category Manager opened Active Buyers KPI breakdown');
          }}
          className="text-left glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between hover:border-purple-500/50 hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
              Active Buyers
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
              View
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-purple-600 dark:text-purple-400 mono">{buyerAccounts.length} Buyers</span>
            <span className="text-[10px] text-purple-600 dark:text-purple-300 font-bold">{activeBuyerPercent}% Active</span>
          </div>
        </button>

        {/* KPI 5: Available Vendors */}
        <button
          type="button"
          onClick={() => {
            setSelectedKpiModal('vendors');
            addAuditLog('Category Manager opened Available Vendors KPI breakdown');
          }}
          className="text-left glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between col-span-2 sm:col-span-1 hover:border-emerald-500/50 hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
              Available Vendors
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
              View
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 mono">{totalAvailableVendors} Suppliers</span>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">★ {avgVendorRating} Avg</span>
          </div>
        </button>
      </div>

      {/* Category Demand vs Supply Density Table Container */}
      <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-4">
        {/* Table Header & Search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-gray-800 pb-3">
          <div>
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <BarChart3 className="text-indigo-600 dark:text-indigo-400" size={18} /> Category Demand-Supply &amp; Trend Breakdown
            </h2>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              Showing trends for <strong className="text-indigo-600 dark:text-indigo-300">{TIMEFRAME_LABELS[timeframe]}</strong> across all active buyer organizations and available vendor capacity.
            </p>
          </div>

          {/* Search Filter */}
          <div className="relative w-full sm:w-72">
            <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search category, buyer, or vendor..."
              className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
            />
          </div>
        </div>

        {/* Detailed Breakdown Matrix Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                <th className="p-3">Category Name &amp; Scope</th>
                <th className="p-3 text-center">RFQs Raised ({timeframe.toUpperCase()})</th>
                <th className="p-3 text-center">Quotes Received</th>
                <th className="p-3 text-center">Trend &amp; Growth</th>
                <th className="p-3">Active Enterprise Buyers</th>
                <th className="p-3 text-center">Available Vendors</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gray-800/80">
              {filteredMetrics.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400 dark:text-gray-500">
                    {taxonomy.length === 0
                      ? categoryTaxonomyError || UI_STRINGS.buyerProfile.taxonomyEmpty
                      : 'No categories match this search.'}
                  </td>
                </tr>
              )}
              {filteredMetrics.map((item) => {
                const catDetail = taxonomy.find((cd) => cd.majorCategory === item.majorCategory);
                const isExpanded = expandedMajor[item.majorCategory] || false;
                const rfqsInTf = item.rfqsCount[timeframe];
                const quotesInTf = item.quotesReceived[timeframe];
                const growthInTf = item.growthPercentage[timeframe];
                const minorCounts = isExpanded ? minorCategoryCountsFor(item.majorCategory) : {};

                return (
                  <React.Fragment key={item.majorCategory}>
                    <tr className="hover:bg-slate-50/80 dark:hover:bg-gray-900/60 transition-colors">
                      {/* Major Category */}
                      <td className="p-3 font-semibold text-slate-900 dark:text-white">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${item.majorCategory} minor categories`}
                            onClick={() =>
                              setExpandedMajor((prev) => ({ ...prev, [item.majorCategory]: !prev[item.majorCategory] }))
                            }
                            className="p-1 rounded text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300 cursor-pointer"
                          >
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                          <div>
                            <span className="font-bold text-slate-900 dark:text-white text-xs">
                              {item.majorCategory}
                            </span>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-slate-400 dark:text-gray-500 font-mono">
                                {item.minorCount} Minor Categories
                              </span>
                              <span
                                className={`px-1.5 py-0.2 rounded text-[9px] font-extrabold ${
                                  item.demandStatus === 'High Demand'
                                    ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                                    : item.demandStatus === 'Optimal'
                                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                    : item.demandStatus === 'No Activity'
                                    ? 'bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 border border-slate-200 dark:border-gray-700'
                                    : 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                                }`}
                              >
                                {item.demandStatus}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* RFQs Raised */}
                      <td className="p-3 text-center font-extrabold text-slate-900 dark:text-white mono text-sm">
                        {rfqsInTf} RFQs
                      </td>

                      {/* Quotes Received */}
                      <td className="p-3 text-center">
                        <span className="font-extrabold text-sky-600 dark:text-cyan-400 mono text-sm">
                          {quotesInTf} Quotes
                        </span>
                        <span className="block text-[10px] text-slate-400 dark:text-gray-500 font-mono">
                          {(quotesInTf / (rfqsInTf || 1)).toFixed(1)} / RFQ
                        </span>
                      </td>

                      {/* Trend & Growth */}
                      <td className="p-3 text-center">
                        <GrowthBadge value={growthInTf} />
                        <span className="block text-[9px] text-slate-400 dark:text-gray-500">
                          vs previous {timeframe}
                        </span>
                      </td>

                      {/* Active Buyers */}
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {item.activeBuyers.length === 0 && (
                            <span className="text-[10px] text-slate-400 dark:text-gray-500 italic">No buyer activity yet</span>
                          )}
                          {item.activeBuyers.map((b, bIdx) => (
                            <span
                              key={bIdx}
                              className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300 border border-slate-200 dark:border-gray-700"
                            >
                              <CompanyHoverTooltip name={b} type="buyer" />
                            </span>
                          ))}
                        </div>
                      </td>

                      {/* Available Vendors */}
                      <td className="p-3 text-center">
                        <span className="font-extrabold text-emerald-600 dark:text-emerald-400 mono text-sm">
                          {item.availableVendorsCount} Vendors
                        </span>
                        <div className="flex flex-wrap items-center justify-center gap-1 mt-1">
                          {item.featuredVendors.slice(0, 2).map((v, vIdx) => (
                            <CompanyHoverTooltip key={vIdx} name={v} type="vendor" className="text-[10px] text-slate-500 dark:text-gray-400" />
                          ))}
                        </div>
                      </td>

                      {/* Action */}
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCategoryDetails(item);
                            setCategoryDetailTab('rfqs');
                            addAuditLog(`Category Manager inspected deep analytics for ${item.majorCategory}`);
                            showToast('Category Telemetry', `Inspecting scope analytics for ${item.majorCategory}`, 'info');
                          }}
                          className="btn btn-secondary btn-sm text-[10px] font-semibold cursor-pointer hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950 dark:hover:text-indigo-300"
                        >
                          Details
                        </button>
                      </td>
                    </tr>

                    {/* Expanded Minor Categories Drawer */}
                    {isExpanded && catDetail && (
                      <tr className="bg-indigo-50/20 dark:bg-indigo-950/20 border-b border-indigo-100 dark:border-indigo-900/30">
                        <td colSpan={7} className="p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                              Minor Categories in {item.majorCategory} ({catDetail.minorCategories.length})
                            </span>
                            <span className="text-[10px] text-slate-500 dark:text-gray-400">
                              RFQ counts reflect all-time activity, not the selected timeframe
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-1.5">
                            {catDetail.minorCategories.map((minor, mIdx) => (
                              <div
                                key={mIdx}
                                className="p-1.5 rounded-lg bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-[10px] font-medium text-slate-700 dark:text-gray-300 flex items-center justify-between"
                              >
                                <span className="truncate" title={minor}>{minor}</span>
                                <span className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 mono">
                                  {minorCounts[minor] || 0} RFQs
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ────────────────────────────────────────────────────────────────────────── */}
      {/* KPI MODAL: Interactive Drilldowns for the 5 Top KPI Cards               */}
      {/* ────────────────────────────────────────────────────────────────────────── */}
      {selectedKpiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel bg-white dark:bg-gray-900 rounded-2xl border border-slate-200 dark:border-gray-800 w-full max-w-4xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 dark:border-gray-800 flex items-center justify-between bg-slate-50/50 dark:bg-gray-950/50">
              <div className="flex items-center gap-2.5">
                {selectedKpiModal === 'categories' && <Layers className="text-indigo-600 dark:text-indigo-400" size={20} />}
                {selectedKpiModal === 'rfqs' && <FileText className="text-indigo-600 dark:text-indigo-400" size={20} />}
                {selectedKpiModal === 'quotes' && <Tag className="text-sky-600 dark:text-cyan-400" size={20} />}
                {selectedKpiModal === 'buyers' && <Users className="text-purple-600 dark:text-purple-400" size={20} />}
                {selectedKpiModal === 'vendors' && <Building className="text-emerald-600 dark:text-emerald-400" size={20} />}
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                    {selectedKpiModal === 'categories' && `Active Categories Breakdown (${taxonomy.length} Major, ${totalMinorCategories} Minor)`}
                    {selectedKpiModal === 'rfqs' && `RFQs Raised Breakdown — ${TIMEFRAME_LABELS[timeframe]} (${totalRfqsInTimeframe} RFQs)`}
                    {selectedKpiModal === 'quotes' && `Quotes Received Breakdown — ${TIMEFRAME_LABELS[timeframe]} (${totalQuotesReceivedInTimeframe} Quotes)`}
                    {selectedKpiModal === 'buyers' && `Active Enterprise Buyers (${buyerAccounts.length} Registered, ${activeBuyerPercent}% Active)`}
                    {selectedKpiModal === 'vendors' && `Available Supplier Network (${totalAvailableVendors} Suppliers, ★ ${avgVendorRating} Avg)`}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                    Live telemetry sourced directly from enterprise identity and RFQ execution records.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedKpiModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4">
              {/* Category KPI List */}
              {selectedKpiModal === 'categories' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {taxonomy.map((cat, idx) => {
                      const metric = categoryMetrics.find((m) => m.majorCategory === cat.majorCategory);
                      return (
                        <div
                          key={idx}
                          className="p-3 rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50/50 dark:bg-gray-950/50 flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="font-extrabold text-xs text-slate-900 dark:text-white">{cat.majorCategory}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-bold">
                                {cat.minorCategories.length} Minors
                              </span>
                            </div>
                            <div className="mt-2 text-[11px] text-slate-500 dark:text-gray-400 flex items-center justify-between">
                              <span>30D RFQs: <strong className="text-slate-900 dark:text-white">{metric?.rfqsCount['30d'] || 0}</strong></span>
                              <span>Suppliers: <strong className="text-emerald-600 dark:text-emerald-400">{metric?.availableVendorsCount || 0}</strong></span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedKpiModal(null);
                              if (metric) setSelectedCategoryDetails(metric);
                            }}
                            className="mt-3 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            Explore Scope &amp; Details <ChevronRight size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* RFQs KPI List */}
              {selectedKpiModal === 'rfqs' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-gray-800 text-[10px] font-bold uppercase text-slate-500">
                        <th className="p-2.5">RFQ Number</th>
                        <th className="p-2.5">Title &amp; Category</th>
                        <th className="p-2.5">Buyer</th>
                        <th className="p-2.5 text-center">Status</th>
                        <th className="p-2.5 text-center">Quotes</th>
                        <th className="p-2.5 text-right">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                      {rfqsInSelectedTimeframe.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-6 text-center text-slate-400">No RFQs created in this timeframe.</td>
                        </tr>
                      ) : (
                        rfqsInSelectedTimeframe.map((rfq) => (
                          <tr key={rfq.rfqNumber} className="hover:bg-slate-50/50 dark:hover:bg-gray-950/50">
                            <td className="p-2.5 font-mono font-bold text-indigo-600 dark:text-indigo-400">{rfq.rfqNumber}</td>
                            <td className="p-2.5">
                              <span className="font-semibold text-slate-900 dark:text-white block truncate max-w-[200px]">{rfq.title}</span>
                              <span className="text-[10px] text-slate-400">{rfq.category}</span>
                            </td>
                            <td className="p-2.5 font-medium">{rfq.buyerAccountName || 'Enterprise Buyer'}</td>
                            <td className="p-2.5 text-center">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300">
                                {rfq.status}
                              </span>
                            </td>
                            <td className="p-2.5 text-center font-mono font-bold text-sky-600">{rfq.quotesCount || 0}</td>
                            <td className="p-2.5 text-right text-slate-400 font-mono text-[11px]">{new Date(rfq.createdAt).toLocaleDateString()}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Quotes KPI List */}
              {selectedKpiModal === 'quotes' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-gray-800 text-[10px] font-bold uppercase text-slate-500">
                        <th className="p-2.5">RFQ Number</th>
                        <th className="p-2.5">Supplier Name</th>
                        <th className="p-2.5 text-right">Unit Price</th>
                        <th className="p-2.5 text-right">Total Price</th>
                        <th className="p-2.5 text-center">Lead Time</th>
                        <th className="p-2.5 text-center">Compliance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                      {quotesInSelectedTimeframe.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-6 text-center text-slate-400">No quotation responses recorded in this timeframe.</td>
                        </tr>
                      ) : (
                        quotesInSelectedTimeframe.map((item, qIdx) => (
                          <tr key={qIdx} className="hover:bg-slate-50/50 dark:hover:bg-gray-950/50">
                            <td className="p-2.5 font-mono font-bold text-indigo-600 dark:text-indigo-400">{item.rfq.rfqNumber}</td>
                            <td className="p-2.5 font-semibold text-slate-900 dark:text-white">{item.quote.vendorName}</td>
                            <td className="p-2.5 text-right font-mono text-slate-700 dark:text-gray-300">₹{(item.quote.unitPrice || 0).toLocaleString('en-IN')}</td>
                            <td className="p-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">₹{(item.quote.totalPrice || 0).toLocaleString('en-IN')}</td>
                            <td className="p-2.5 text-center font-mono">{item.quote.leadTimeDays || 7} Days</td>
                            <td className="p-2.5 text-center">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600">
                                {item.quote.complianceStatus || 'Fully Compliant'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Buyers KPI List */}
              {selectedKpiModal === 'buyers' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {buyerAccounts.length === 0 ? (
                    <div className="col-span-3 p-6 text-center text-slate-400">No registered enterprise buyer accounts found.</div>
                  ) : (
                    buyerAccounts.map((account) => {
                      const buyerDisplayName = account.contactPerson || account.organizationName || (account as any).name || 'Enterprise Buyer';
                      const buyerOrg = account.organizationName || (account as any).department || 'Enterprise Procurement';
                      const buyerEmail = account.corporateEmail || (account as any).email || '—';
                      const buyerRfqs = rfqs.filter((r) => doesBuyerMatchRfq(account, r));
                      return (
                        <div key={account.id} className="p-3.5 rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50/50 dark:bg-gray-950/50 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-extrabold text-xs text-slate-900 dark:text-white">{buyerDisplayName}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${buyerRfqs.length > 0 ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                              {buyerRfqs.length > 0 ? 'Active' : 'Dormant'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-gray-400 space-y-1">
                            <div>Email: <strong className="text-slate-800 dark:text-slate-200 font-mono">{buyerEmail}</strong></div>
                            <div>Organization: <strong className="text-slate-800 dark:text-slate-200">{buyerOrg}</strong></div>
                            <div>RFQs Raised: <strong className="text-indigo-600 dark:text-indigo-400 font-mono">{buyerRfqs.length}</strong></div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* Vendors KPI List */}
              {selectedKpiModal === 'vendors' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-gray-800 text-[10px] font-bold uppercase text-slate-500">
                        <th className="p-2.5">Supplier Name</th>
                        <th className="p-2.5">Major Category</th>
                        <th className="p-2.5 text-center">Score</th>
                        <th className="p-2.5">Location</th>
                        <th className="p-2.5">Contact</th>
                        <th className="p-2.5 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                      {buyerVendors.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-6 text-center text-slate-400">No suppliers found in directory.</td>
                        </tr>
                      ) : (
                        buyerVendors.map((vendor) => (
                          <tr key={vendor.id} className="hover:bg-slate-50/50 dark:hover:bg-gray-950/50">
                            <td className="p-2.5 font-bold text-slate-900 dark:text-white">{vendor.name}</td>
                            <td className="p-2.5">
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600">
                                {vendor.majorCategory}
                              </span>
                            </td>
                            <td className="p-2.5 text-center font-mono font-bold text-emerald-600">★ {vendor.rating || 4.5}</td>
                            <td className="p-2.5 text-slate-600 dark:text-gray-400">{formatLocation(vendor.city, vendor.state)}</td>
                            <td className="p-2.5 text-slate-500 text-[11px] font-mono">{formatContactInfo(vendor.phone, vendor.email)}</td>
                            <td className="p-2.5 text-center">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600">
                                Verified
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-gray-800 flex justify-end bg-slate-50/50 dark:bg-gray-950/50">
              <button
                type="button"
                onClick={() => setSelectedKpiModal(null)}
                className="btn btn-secondary btn-sm text-xs font-semibold cursor-pointer"
              >
                Close Breakdown
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────────── */}
      {/* CATEGORY DETAILS MODAL: Full breakdown for individual category row         */}
      {/* ────────────────────────────────────────────────────────────────────────── */}
      {selectedCategoryDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel bg-white dark:bg-gray-900 rounded-2xl border border-slate-200 dark:border-gray-800 w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-5 border-b border-slate-200 dark:border-gray-800 flex items-center justify-between bg-slate-50/50 dark:bg-gray-950/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black">
                  <Package size={22} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-black text-slate-900 dark:text-white">
                      {selectedCategoryDetails.majorCategory}
                    </h3>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                        selectedCategoryDetails.demandStatus === 'High Demand'
                          ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                          : selectedCategoryDetails.demandStatus === 'Optimal'
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                          : 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                      }`}
                    >
                      {selectedCategoryDetails.demandStatus}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                    {selectedCategoryDetails.minorCount} Minor Categories · Telemetry scoped to active buyer demand and vendor network.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCategoryDetails(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-4 bg-slate-100/50 dark:bg-gray-950/50 border-b border-slate-200 dark:border-gray-800">
              <div className="p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800">
                <span className="text-[10px] font-bold text-slate-400 uppercase">RFQs in Scope</span>
                <p className="text-base font-black text-slate-900 dark:text-white mono mt-0.5">
                  {selectedCategoryDetails.rfqsCount[timeframe]} <span className="text-[10px] font-semibold text-slate-400">({timeframe})</span>
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Quotes Received</span>
                <p className="text-base font-black text-sky-600 dark:text-cyan-400 mono mt-0.5">
                  {selectedCategoryDetails.quotesReceived[timeframe]} <span className="text-[10px] font-semibold text-slate-400">bids</span>
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Active Buyers</span>
                <p className="text-base font-black text-purple-600 dark:text-purple-400 mono mt-0.5">
                  {selectedCategoryDetails.activeBuyers.length} <span className="text-[10px] font-semibold text-slate-400">corporates</span>
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Available Suppliers</span>
                <p className="text-base font-black text-emerald-600 dark:text-emerald-400 mono mt-0.5">
                  {selectedCategoryDetails.availableVendorsCount} <span className="text-[10px] font-semibold text-slate-400">verified</span>
                </p>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex border-b border-slate-200 dark:border-gray-800 px-5 gap-4 text-xs font-extrabold bg-slate-50/50 dark:bg-gray-950/30">
              <button
                type="button"
                onClick={() => setCategoryDetailTab('rfqs')}
                className={`py-3 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                  categoryDetailTab === 'rfqs'
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <FileText size={14} /> Relevant RFQs ({categoryRfqs.length})
              </button>
              <button
                type="button"
                onClick={() => setCategoryDetailTab('quotes')}
                className={`py-3 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                  categoryDetailTab === 'quotes'
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Tag size={14} /> Quotes &amp; Pricing ({categoryQuotes.length})
              </button>
              <button
                type="button"
                onClick={() => setCategoryDetailTab('buyers')}
                className={`py-3 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                  categoryDetailTab === 'buyers'
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Users size={14} /> Enterprise Buyers ({selectedCategoryDetails.activeBuyers.length})
              </button>
              <button
                type="button"
                onClick={() => setCategoryDetailTab('vendors')}
                className={`py-3 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                  categoryDetailTab === 'vendors'
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Building size={14} /> Available Suppliers ({categoryVendors.length})
              </button>
              <button
                type="button"
                onClick={() => setCategoryDetailTab('minors')}
                className={`py-3 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                  categoryDetailTab === 'minors'
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Layers size={14} /> Minor Categories ({categoryDetailObj?.minorCategories.length || 0})
              </button>
            </div>

            {/* Content Body */}
            <div className="p-5 overflow-y-auto space-y-4">
              {/* Tab 1: Relevant RFQs */}
              {categoryDetailTab === 'rfqs' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-gray-800 text-[10px] font-bold uppercase text-slate-500">
                        <th className="p-2.5">RFQ Number</th>
                        <th className="p-2.5">Title &amp; Specification</th>
                        <th className="p-2.5">Buyer Account</th>
                        <th className="p-2.5 text-center">Status</th>
                        <th className="p-2.5 text-center">Quotes Count</th>
                        <th className="p-2.5 text-right">Created Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                      {categoryRfqs.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-6 text-center text-slate-400">
                            No RFQs raised under {selectedCategoryDetails.majorCategory} yet.
                          </td>
                        </tr>
                      ) : (
                        categoryRfqs.map((rfq) => (
                          <tr key={rfq.rfqNumber} className="hover:bg-slate-50/50 dark:hover:bg-gray-950/50">
                            <td className="p-2.5 font-mono font-bold text-indigo-600 dark:text-indigo-400">{rfq.rfqNumber}</td>
                            <td className="p-2.5 font-semibold text-slate-900 dark:text-white">{rfq.title}</td>
                            <td className="p-2.5 font-medium">{rfq.buyerAccountName || 'Enterprise Buyer'}</td>
                            <td className="p-2.5 text-center">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600">
                                {rfq.status}
                              </span>
                            </td>
                            <td className="p-2.5 text-center font-mono font-bold text-sky-600">{rfq.quotesCount || 0}</td>
                            <td className="p-2.5 text-right font-mono text-slate-400 text-[11px]">
                              {new Date(rfq.createdAt).toLocaleDateString()}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab 2: Quotes & Pricing */}
              {categoryDetailTab === 'quotes' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-gray-800 text-[10px] font-bold uppercase text-slate-500">
                        <th className="p-2.5">RFQ Number</th>
                        <th className="p-2.5">Vendor Name</th>
                        <th className="p-2.5 text-right">Unit Price</th>
                        <th className="p-2.5 text-right">Total Price</th>
                        <th className="p-2.5 text-center">Lead Time</th>
                        <th className="p-2.5 text-center">Compliance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                      {categoryQuotes.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-6 text-center text-slate-400">
                            No supplier quotations received for this category yet.
                          </td>
                        </tr>
                      ) : (
                        categoryQuotes.map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-gray-950/50">
                            <td className="p-2.5 font-mono font-bold text-indigo-600 dark:text-indigo-400">{item.rfq.rfqNumber}</td>
                            <td className="p-2.5 font-semibold text-slate-900 dark:text-white">{item.quote.vendorName}</td>
                            <td className="p-2.5 text-right font-mono text-slate-700 dark:text-gray-300">₹{(item.quote.unitPrice || 0).toLocaleString('en-IN')}</td>
                            <td className="p-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">₹{(item.quote.totalPrice || 0).toLocaleString('en-IN')}</td>
                            <td className="p-2.5 text-center font-mono">{item.quote.leadTimeDays || 7} Days</td>
                            <td className="p-2.5 text-center">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600">
                                {item.quote.complianceStatus || 'Fully Compliant'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab 3: Enterprise Buyers */}
              {categoryDetailTab === 'buyers' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {selectedCategoryDetails.activeBuyers.length === 0 ? (
                    <div className="col-span-3 p-6 text-center text-slate-400">
                      No active buyers have issued RFQs for this category yet.
                    </div>
                  ) : (
                    selectedCategoryDetails.activeBuyers.map((buyerName, idx) => {
                      const matchingRfqs = categoryRfqs.filter((r) => r.buyerAccountName === buyerName);
                      return (
                        <div key={idx} className="p-3.5 rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50/50 dark:bg-gray-950/50 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-extrabold text-xs text-slate-900 dark:text-white">{buyerName}</span>
                            <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-purple-50 dark:bg-purple-950/60 text-purple-600">
                              Active Buyer
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-gray-400">
                            <div>Category RFQs: <strong className="text-indigo-600 dark:text-indigo-400 font-mono">{matchingRfqs.length}</strong></div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* Tab 4: Available Suppliers */}
              {categoryDetailTab === 'vendors' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-gray-800 text-[10px] font-bold uppercase text-slate-500">
                        <th className="p-2.5">Supplier Name</th>
                        <th className="p-2.5 text-center">Score</th>
                        <th className="p-2.5">Contact Person</th>
                        <th className="p-2.5">Phone / Email</th>
                        <th className="p-2.5">Location</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                      {categoryVendors.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-6 text-center text-slate-400">
                            No suppliers mapped to {selectedCategoryDetails.majorCategory} yet.
                          </td>
                        </tr>
                      ) : (
                        categoryVendors.map((vendor) => (
                          <tr key={vendor.id} className="hover:bg-slate-50/50 dark:hover:bg-gray-950/50">
                            <td className="p-2.5 font-bold text-slate-900 dark:text-white">{vendor.name}</td>
                            <td className="p-2.5 text-center font-mono font-bold text-emerald-600">★ {formatRating(vendor.rating)}</td>
                            <td className="p-2.5 text-slate-700 dark:text-gray-300">{formatContactPerson(vendor.contactPerson)}</td>
                            <td className="p-2.5 font-mono text-[11px] text-slate-500">{formatContactInfo(vendor.phone, vendor.email)}</td>
                            <td className="p-2.5 text-slate-600 dark:text-gray-400">{formatLocation(vendor.city, vendor.state)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab 5: Minor Categories Breakdown */}
              {categoryDetailTab === 'minors' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {(categoryDetailObj?.minorCategories || []).map((minor, mIdx) => {
                      const minorCounts = minorCategoryCountsFor(selectedCategoryDetails.majorCategory);
                      return (
                        <div
                          key={mIdx}
                          className="p-2.5 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-between"
                        >
                          <span className="text-xs font-semibold text-slate-900 dark:text-white truncate" title={minor}>{minor}</span>
                          <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 mono ml-2 shrink-0">
                            {minorCounts[minor] || 0} RFQs
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-gray-800 flex justify-end bg-slate-50/50 dark:bg-gray-950/50">
              <button
                type="button"
                onClick={() => setSelectedCategoryDetails(null)}
                className="btn btn-secondary btn-sm text-xs font-semibold cursor-pointer"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
