'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import categoriesData from '@/lib/categories.json';
import {
  Layers,
  TrendingUp,
  Building2,
  Truck,
  FileText,
  Calendar,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  Users,
  PieChart,
  BarChart3,
  ShieldCheck,
  CheckCircle2,
  Zap,
} from 'lucide-react';
import CompanyHoverTooltip from '@/app/components/CompanyHoverTooltip';

type TimeframeOption = '7d' | '30d' | '90d' | '180d' | '1y';

interface CategoryMetric {
  majorCategory: string;
  minorCount: number;
  rfqsCount: Record<TimeframeOption, number>;
  rfqsDownloadedCount: Record<TimeframeOption, number>;
  activeBuyers: string[];
  availableVendorsCount: number;
  featuredVendors: string[];
  growthPercentage: Record<TimeframeOption, number>;
  demandStatus: 'High Demand' | 'Optimal' | 'Growing' | 'Emerging';
}

export default function CategorySummaryDashboard() {
  const { rfqs, addAuditLog, showToast } = useApp();

  const [timeframe, setTimeframe] = useState<TimeframeOption>('30d');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedMajor, setExpandedMajor] = useState<Record<string, boolean>>({
    'Engineering Spares - Mechanical': true,
    'Civil Works': true,
    'Engineering Spares - Electrical': false,
    'IT': false,
  });

  // Mock Category Analytics Data aligned with lib/categories.json
  const categoryMetrics: CategoryMetric[] = [
    {
      majorCategory: 'Engineering Spares - Mechanical',
      minorCount: 67,
      rfqsCount: { '7d': 5, '30d': 18, '90d': 42, '180d': 84, '1y': 156 },
      rfqsDownloadedCount: { '7d': 32, '30d': 114, '90d': 268, '180d': 540, '1y': 990 },
      activeBuyers: ['Larsen & Toubro Ltd.', 'Tata Projects Ltd.', 'Reliance Industries'],
      availableVendorsCount: 42,
      featuredVendors: ['Apex Supplies Ltd.', 'WPIL Pumps Ltd.', 'Kirloskar Brothers', 'Flowserve Corp'],
      growthPercentage: { '7d': 12.4, '30d': 24.8, '90d': 18.2, '180d': 31.5, '1y': 45.2 },
      demandStatus: 'High Demand',
    },
    {
      majorCategory: 'Civil Works',
      minorCount: 21,
      rfqsCount: { '7d': 3, '30d': 12, '90d': 28, '180d': 56, '1y': 110 },
      rfqsDownloadedCount: { '7d': 20, '30d': 78, '90d': 182, '180d': 364, '1y': 715 },
      activeBuyers: ['Shapoorji Pallonji', 'Larsen & Toubro Ltd.', 'AFCONS Infrastructure'],
      availableVendorsCount: 34,
      featuredVendors: ['Hindustan Precast', 'Structural Solutions', 'Everest Steel PEB'],
      growthPercentage: { '7d': 8.1, '30d': 15.6, '90d': 12.0, '180d': 22.4, '1y': 38.0 },
      demandStatus: 'Optimal',
    },
    {
      majorCategory: 'Engineering Spares - Electrical',
      minorCount: 28,
      rfqsCount: { '7d': 4, '30d': 14, '90d': 34, '180d': 68, '1y': 132 },
      rfqsDownloadedCount: { '7d': 26, '30d': 92, '90d': 221, '180d': 442, '1y': 858 },
      activeBuyers: ['BHEL', 'Siemens Energy', 'Tata Projects Ltd.'],
      availableVendorsCount: 38,
      featuredVendors: ['Havells Switchgear', 'ABB India', 'Schneider Electric', 'Polycab Cables'],
      growthPercentage: { '7d': 15.2, '30d': 28.4, '90d': 24.1, '180d': 35.8, '1y': 52.0 },
      demandStatus: 'High Demand',
    },
    {
      majorCategory: 'IT',
      minorCount: 12,
      rfqsCount: { '7d': 2, '30d': 8, '90d': 22, '180d': 42, '1y': 88 },
      rfqsDownloadedCount: { '7d': 14, '30d': 52, '90d': 143, '180d': 273, '1y': 572 },
      activeBuyers: ['Wipro Enterprise', 'Infosys Procurement', 'Reliance Industries'],
      availableVendorsCount: 29,
      featuredVendors: ['Dell Enterprise', 'Cisco Systems', 'HP Commercial', 'Fortinet Network'],
      growthPercentage: { '7d': 6.5, '30d': 11.2, '90d': 14.8, '180d': 19.2, '1y': 29.5 },
      demandStatus: 'Optimal',
    },
    {
      majorCategory: 'Packing Material',
      minorCount: 22,
      rfqsCount: { '7d': 2, '30d': 7, '90d': 16, '180d': 32, '1y': 64 },
      rfqsDownloadedCount: { '7d': 12, '30d': 45, '90d': 104, '180d': 208, '1y': 416 },
      activeBuyers: ['Hindustan Unilever', 'Godrej Consumer', 'Nestle India'],
      availableVendorsCount: 26,
      featuredVendors: ['Uflex Packaging', 'TCPL Packaging', 'Manjushree Polymers'],
      growthPercentage: { '7d': 4.2, '30d': 9.8, '90d': 11.5, '180d': 16.0, '1y': 24.1 },
      demandStatus: 'Growing',
    },
    {
      majorCategory: 'CAPEX - Equipment & Machinery',
      minorCount: 44,
      rfqsCount: { '7d': 3, '30d': 10, '90d': 24, '180d': 48, '1y': 96 },
      rfqsDownloadedCount: { '7d': 18, '30d': 65, '90d': 156, '180d': 312, '1y': 624 },
      activeBuyers: ['Jindal Steel & Power', 'Larsen & Toubro Ltd.', 'Adani Ports'],
      availableVendorsCount: 31,
      featuredVendors: ['ACE Cranes Ltd.', 'JCB India', 'Godrej Material Handling', 'Atlas Copco'],
      growthPercentage: { '7d': 9.6, '30d': 19.2, '90d': 21.0, '180d': 28.5, '1y': 41.0 },
      demandStatus: 'High Demand',
    },
    {
      majorCategory: 'Raw Material',
      minorCount: 20,
      rfqsCount: { '7d': 2, '30d': 6, '90d': 15, '180d': 30, '1y': 58 },
      rfqsDownloadedCount: { '7d': 14, '30d': 39, '90d': 98, '180d': 195, '1y': 377 },
      activeBuyers: ['Tata Steel', 'JSW Steel', 'Hindalco Industries'],
      availableVendorsCount: 22,
      featuredVendors: ['Vedanta Metals', 'NALCO Aluminium', 'Gujarat Chemical Corp'],
      growthPercentage: { '7d': 3.5, '30d': 7.4, '90d': 10.2, '180d': 14.8, '1y': 21.0 },
      demandStatus: 'Growing',
    },
    {
      majorCategory: 'Professional Services',
      minorCount: 13,
      rfqsCount: { '7d': 1, '30d': 4, '90d': 10, '180d': 20, '1y': 40 },
      rfqsDownloadedCount: { '7d': 6, '30d': 26, '90d': 65, '180d': 130, '1y': 260 },
      activeBuyers: ['Larsen & Toubro Ltd.', 'Reliance Industries'],
      availableVendorsCount: 19,
      featuredVendors: ['TUV SUD India', 'Bureau Veritas', 'SIS Security Services'],
      growthPercentage: { '7d': 2.1, '30d': 6.2, '90d': 8.5, '180d': 12.0, '1y': 18.4 },
      demandStatus: 'Emerging',
    },
    {
      majorCategory: 'Logistics',
      minorCount: 4,
      rfqsCount: { '7d': 1, '30d': 5, '90d': 12, '180d': 24, '1y': 48 },
      rfqsDownloadedCount: { '7d': 8, '30d': 32, '90d': 78, '180d': 156, '1y': 312 },
      activeBuyers: ['Mahindra Logistics', 'Larsen & Toubro Ltd.'],
      availableVendorsCount: 18,
      featuredVendors: ['TCI Express', 'DHL Supply Chain', 'Blue Dart Express'],
      growthPercentage: { '7d': 5.0, '30d': 10.5, '90d': 13.2, '180d': 18.0, '1y': 26.8 },
      demandStatus: 'Growing',
    },
    {
      majorCategory: 'Occuptional Health and Safety',
      minorCount: 9,
      rfqsCount: { '7d': 1, '30d': 3, '90d': 8, '180d': 16, '1y': 32 },
      rfqsDownloadedCount: { '7d': 5, '30d': 19, '90d': 52, '180d': 104, '1y': 208 },
      activeBuyers: ['Larsen & Toubro Ltd.', 'Tata Motors'],
      availableVendorsCount: 15,
      featuredVendors: ['3M Safety India', 'Karam Safety Ltd.', 'Mallcom India'],
      growthPercentage: { '7d': 1.8, '30d': 5.1, '90d': 7.6, '180d': 11.2, '1y': 17.0 },
      demandStatus: 'Emerging',
    },
    {
      majorCategory: 'Retail Repair & Maintenance',
      minorCount: 16,
      rfqsCount: { '7d': 1, '30d': 4, '90d': 9, '180d': 18, '1y': 36 },
      rfqsDownloadedCount: { '7d': 6, '30d': 24, '90d': 58, '180d': 116, '1y': 234 },
      activeBuyers: ['Reliance Retail', 'Trent Hypermarket', 'Shoppers Stop'],
      availableVendorsCount: 14,
      featuredVendors: ['Urban Maintenance Solutions', 'Facility Tech India'],
      growthPercentage: { '7d': 3.0, '30d': 7.0, '90d': 9.2, '180d': 13.5, '1y': 19.8 },
      demandStatus: 'Emerging',
    },
    {
      majorCategory: 'New Category-Product',
      minorCount: 42,
      rfqsCount: { '7d': 1, '30d': 3, '90d': 7, '180d': 14, '1y': 28 },
      rfqsDownloadedCount: { '7d': 5, '30d': 18, '90d': 44, '180d': 88, '1y': 176 },
      activeBuyers: ['Adani Green Energy', 'ReNew Power'],
      availableVendorsCount: 16,
      featuredVendors: ['CleanTech Innovations', 'EcoSolutions India'],
      growthPercentage: { '7d': 7.2, '30d': 14.0, '90d': 18.5, '180d': 24.0, '1y': 35.2 },
      demandStatus: 'Growing',
    },
    {
      majorCategory: 'New Category-Service',
      minorCount: 8,
      rfqsCount: { '7d': 0, '30d': 2, '90d': 5, '180d': 10, '1y': 20 },
      rfqsDownloadedCount: { '7d': 2, '30d': 12, '90d': 30, '180d': 60, '1y': 120 },
      activeBuyers: ['Larsen & Toubro Ltd.'],
      availableVendorsCount: 12,
      featuredVendors: ['DroneSurvey Tech', 'EcoWaste Management'],
      growthPercentage: { '7d': 4.0, '30d': 8.5, '90d': 11.0, '180d': 15.2, '1y': 22.0 },
      demandStatus: 'Emerging',
    },
  ];

  // Calculate totals for chosen timeframe
  const totalRfqsInTimeframe = categoryMetrics.reduce((sum, c) => sum + c.rfqsCount[timeframe], 0);
  const totalRfqsDownloadedInTimeframe = categoryMetrics.reduce((sum, c) => sum + c.rfqsDownloadedCount[timeframe], 0);
  const totalAvailableVendors = categoryMetrics.reduce((sum, c) => sum + c.availableVendorsCount, 0);

  // Timeframe Labels
  const timeframeLabels: Record<TimeframeOption, string> = {
    '7d': 'Last 7 Days',
    '30d': 'Last 30 Days',
    '90d': 'Last 90 Days (Quarterly)',
    '180d': 'Last 180 Days (Half Yearly)',
    '1y': 'Last 1 Year (Annual)',
  };

  // Filter Categories
  const filteredMetrics = categoryMetrics.filter((c) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const matchesMajor = c.majorCategory.toLowerCase().includes(term);
    const catDetail = categoriesData.find((cd) => cd.majorCategory === c.majorCategory);
    const matchesMinor = catDetail?.minorCategories.some((m) => m.toLowerCase().includes(term));
    const matchesBuyer = c.activeBuyers.some((b) => b.toLowerCase().includes(term));
    const matchesVendor = c.featuredVendors.some((v) => v.toLowerCase().includes(term));
    return matchesMajor || matchesMinor || matchesBuyer || matchesVendor;
  });

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Title & Timeframe Selector Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Layers className="text-indigo-600 dark:text-indigo-400" /> Category Governance &amp; Demand-Supply Analytics
            </h1>
            <span className="badge badge-purple font-mono">Screen 2.6</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
            Comprehensive summary of buyer procurement demand, vendor supply density, and RFQ volume trends across all 13 Major &amp; 306 Minor categories.
          </p>
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

      {/* Top Analytics Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        <div className="glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">Active Categories</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-slate-900 dark:text-white mono">13 Major</span>
            <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold">306 Minor</span>
          </div>
        </div>

        <div className="glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">RFQs Raised ({timeframe.toUpperCase()})</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-slate-900 dark:text-white mono">{totalRfqsInTimeframe} RFQs</span>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center">
              <ArrowUpRight size={11} /> +18.4%
            </span>
          </div>
        </div>

        <div className="glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">RFQs Downloaded</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-sky-600 dark:text-cyan-400 mono">{totalRfqsDownloadedInTimeframe} RFQs</span>
            <span className="text-[10px] text-sky-600 dark:text-cyan-400 font-bold">{(totalRfqsDownloadedInTimeframe / totalRfqsInTimeframe).toFixed(1)} / RFQ</span>
          </div>
        </div>

        <div className="glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">Active Buyers</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-purple-600 dark:text-purple-400 mono">14 Buyers</span>
            <span className="text-[10px] text-purple-600 dark:text-purple-300 font-bold">100% Active</span>
          </div>
        </div>

        <div className="glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between col-span-2 sm:col-span-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">Verified Vendors</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 mono">{totalAvailableVendors} Suppliers</span>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">94.8% Match</span>
          </div>
        </div>
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
              Showing trends for <strong className="text-indigo-600 dark:text-indigo-300">{timeframeLabels[timeframe]}</strong> across all active buyer organizations and available vendor capacity.
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
                <th className="p-3 text-center">RFQs Downloaded</th>
                <th className="p-3 text-center">Trend &amp; Growth</th>
                <th className="p-3">Active Enterprise Buyers</th>
                <th className="p-3 text-center">Available Vendors</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gray-800/80">
              {filteredMetrics.map((item) => {
                const catDetail = categoriesData.find((cd) => cd.majorCategory === item.majorCategory);
                const isExpanded = expandedMajor[item.majorCategory] || false;
                const rfqsInTf = item.rfqsCount[timeframe];
                const downloadsInTf = item.rfqsDownloadedCount[timeframe];
                const growthInTf = item.growthPercentage[timeframe];

                return (
                  <React.Fragment key={item.majorCategory}>
                    <tr className="hover:bg-slate-50/80 dark:hover:bg-gray-900/60 transition-colors">
                      {/* Major Category */}
                      <td className="p-3 font-semibold text-slate-900 dark:text-white">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedMajor((prev) => ({ ...prev, [item.majorCategory]: !prev[item.majorCategory] }))
                            }
                            className="p-1 rounded text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300"
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

                      {/* RFQs Downloaded */}
                      <td className="p-3 text-center">
                        <span className="font-extrabold text-sky-600 dark:text-cyan-400 mono text-sm">
                          {downloadsInTf} RFQs
                        </span>
                        <span className="block text-[10px] text-slate-400 dark:text-gray-500 font-mono">
                          {(downloadsInTf / (rfqsInTf || 1)).toFixed(1)} / RFQ
                        </span>
                      </td>

                      {/* Trend & Growth */}
                      <td className="p-3 text-center">
                        <span className="inline-flex items-center gap-0.5 text-xs font-black text-emerald-600 dark:text-emerald-400 mono">
                          <ArrowUpRight size={13} /> +{growthInTf}%
                        </span>
                        <span className="block text-[9px] text-slate-400 dark:text-gray-500">
                          vs previous {timeframe}
                        </span>
                      </td>

                      {/* Active Buyers */}
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
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
                          onClick={() => {
                            addAuditLog(`Category Manager inspected deep analytics for ${item.majorCategory}`);
                            showToast('Category Telemetry', `Inspecting scope analytics for ${item.majorCategory}`, 'info');
                          }}
                          className="btn btn-secondary btn-sm text-[10px] font-semibold"
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
                              Vendor capability matching active
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
                                  {Math.floor(2 + (mIdx % 5))} RFQs
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
    </div>
  );
}
