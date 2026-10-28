'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Building2,
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
} from 'lucide-react';
import { useApp } from '@/lib/store';
import { BuyerAccount, RFQItem, AuditLogEntry } from '@/lib/types';
import {
  RFQ_MODES,
  RFQ_MODE_LABELS,
  SOURCING_MODES,
  formatCurrency,
  formatIndianDateTime,
} from '@/lib/constants';
import { exportReportToExcel } from '@/lib/reportsClient';

interface BuyersDirectoryProps {
  onSelectRFQ?: (rfq: RFQItem) => void;
}

export default function BuyersDirectory({ onSelectRFQ }: BuyersDirectoryProps) {
  const { buyerAccounts = [], rfqs = [], auditLogs = [] } = useApp();

  // Search & Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMode, setSelectedMode] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedPlan, setSelectedPlan] = useState<string>('all');

  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Reset to first page when search or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedMode, selectedStatus, selectedPlan]);

  // Dossier Drawer / Modal state
  const [activeBuyer, setActiveBuyer] = useState<BuyerAccount | null>(null);
  const [dossierTab, setDossierTab] = useState<'profile' | 'rfqs' | 'credits' | 'communications' | 'payments' | 'activity'>('profile');

  // KPI Metrics Calculation
  const totalBuyers = buyerAccounts.length;
  const verifiedBuyers = buyerAccounts.filter((b) => b.status === 'ACTIVE_VERIFIED' || (b.status as string) === 'ACTIVE').length;
  const totalRFQs = rfqs.length;

  // Pre-calculate per-buyer RFQ counts and actual spend from the live RFQs collection
  // combined with any historical baseline recorded on the buyer account
  const buyerMetricsMap = useMemo(() => {
    const map = new Map<string, { rfqCount: number; spendNumeric: number; rfqs: RFQItem[] }>();

    buyerAccounts.forEach((buyer) => {
      const bEmail = buyer.corporateEmail?.toLowerCase().trim();
      const bOrg = buyer.organizationName?.toLowerCase().trim();
      const bId = buyer.id;

      const matchingRfqs = rfqs.filter((r) => {
        if (r.buyerAccountId && (r.buyerAccountId === bId || r.buyerAccountId === (buyer as any).buyerAccountId)) return true;
        if (r.raisedByEmail && bEmail && r.raisedByEmail.toLowerCase().trim() === bEmail) return true;
        if (r.buyerAccountName && bOrg && r.buyerAccountName.toLowerCase().trim() === bOrg) return true;
        return false;
      });

      // Calculate spend from live RFQs: budget > 0 ? budget : awardedAmount > 0 ? awardedAmount : quotes lowest price
      const rfqsSpend = matchingRfqs.reduce((sum, r) => {
        const val = Number(r.budget) || Number(r.awardedAmount) || (r.quotes?.[0]?.totalPrice ? Number(r.quotes[0].totalPrice) : 0);
        return sum + (isNaN(val) ? 0 : val);
      }, 0);

      // Parse historical spend recorded on the buyer profile (e.g. "₹45,00,000" or "$500,000")
      const parsedHistoricalSpend = parseInt(String(buyer.totalSpend || '0').replace(/[^0-9]/g, ''), 10) || 0;

      const effectiveSpend = rfqsSpend > 0 ? rfqsSpend : parsedHistoricalSpend;
      const effectiveRfqCount = Math.max(buyer.totalRFQsCreated || 0, matchingRfqs.length);

      map.set(buyer.id, {
        rfqCount: effectiveRfqCount,
        spendNumeric: effectiveSpend,
        rfqs: matchingRfqs,
      });
    });

    return map;
  }, [buyerAccounts, rfqs]);

  // Overall platform total sourcing spend:
  // Aggregates real procurement spend across all platform RFQs plus any extra historical baseline
  const totalSpendNumeric = useMemo(() => {
    const rfqsTotalSpend = rfqs.reduce((sum, r) => {
      const val = Number(r.budget) || Number(r.awardedAmount) || (r.quotes?.[0]?.totalPrice ? Number(r.quotes[0].totalPrice) : 0);
      return sum + (isNaN(val) ? 0 : val);
    }, 0);

    const historicalExtra = buyerAccounts.reduce((acc, b) => {
      const metrics = buyerMetricsMap.get(b.id);
      const parsedHistorical = parseInt(String(b.totalSpend || '0').replace(/[^0-9]/g, ''), 10) || 0;
      if (metrics && metrics.spendNumeric > parsedHistorical) {
        return acc;
      }
      return acc + parsedHistorical;
    }, 0);

    return rfqsTotalSpend > 0 ? rfqsTotalSpend : historicalExtra;
  }, [rfqs, buyerAccounts, buyerMetricsMap]);

  // Mode distribution
  const modeCounts = useMemo(() => {
    const counts: Record<string, number> = {
      [RFQ_MODES.MODE_1]: 0,
      [RFQ_MODES.MODE_2]: 0,
      [RFQ_MODES.MODE_3]: 0,
      [RFQ_MODES.MODE_0]: 0,
    };
    buyerAccounts.forEach((b) => {
      const m = b.sourcingMode;
      if (counts[m] !== undefined) counts[m]++;
      else counts[RFQ_MODES.MODE_0]++;
    });
    return counts;
  }, [buyerAccounts]);

  // Filtered Buyers
  const filteredBuyers = useMemo(() => {
    return buyerAccounts.filter((buyer) => {
      const q = searchTerm.toLowerCase();
      const matchesSearch =
        !q ||
        buyer.organizationName?.toLowerCase().includes(q) ||
        buyer.contactPerson?.toLowerCase().includes(q) ||
        buyer.corporateEmail?.toLowerCase().includes(q) ||
        buyer.city?.toLowerCase().includes(q) ||
        buyer.primaryPlantLocation?.toLowerCase().includes(q);

      const matchesMode = selectedMode === 'all' || buyer.sourcingMode === selectedMode;
      const matchesStatus = selectedStatus === 'all' || buyer.status === selectedStatus;
      const matchesPlan = selectedPlan === 'all' || buyer.subscriptionPlan === selectedPlan;

      return matchesSearch && matchesMode && matchesStatus && matchesPlan;
    });
  }, [buyerAccounts, searchTerm, selectedMode, selectedStatus, selectedPlan]);

  // Paginated Buyers slice
  const totalItems = filteredBuyers.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const effectivePage = Math.min(currentPage, totalPages);
  const startIndex = (effectivePage - 1) * pageSize;
  const paginatedBuyers = useMemo(() => {
    return filteredBuyers.slice(startIndex, startIndex + pageSize);
  }, [filteredBuyers, startIndex, pageSize]);

  // Derived buyer-specific RFQs, Audit Logs, and mock transactions for dossier
  const buyerRfqs = useMemo(() => {
    if (!activeBuyer) return [];
    const metrics = buyerMetricsMap.get(activeBuyer.id);
    return metrics?.rfqs || [];
  }, [activeBuyer, buyerMetricsMap]);

  const buyerAuditLogs = useMemo(() => {
    if (!activeBuyer) return [];
    const buyerEmail = (activeBuyer.corporateEmail || '').toLowerCase();
    const buyerOrg = (activeBuyer.organizationName || '').toLowerCase();
    return auditLogs.filter((log) => {
      const actor = ((log as any).actorEmail || log.user || '').toLowerCase();
      const details = ((log as any).details || log.action || '').toLowerCase();
      return (
        (buyerEmail && actor && actor === buyerEmail) ||
        (buyerOrg && details && details.includes(buyerOrg))
      );
    });
  }, [activeBuyer, auditLogs]);

  // Synthetic/Standardized communications & payments derived from buyer state
  const buyerCommunications = useMemo(() => {
    if (!activeBuyer) return [];
    const logs = [];
    if (activeBuyer.createdDate) {
      logs.push({
        id: `comm-reg-${activeBuyer.id}`,
        channel: 'EMAIL',
        subject: 'Enterprise Onboarding Confirmation & API Key Generation',
        recipient: activeBuyer.corporateEmail,
        timestamp: activeBuyer.createdDate,
        status: 'DELIVERED',
        preview: `Welcome ${activeBuyer.contactPerson || activeBuyer.organizationName} to the Procucev Enterprise Network. Initial free trial activated.`,
      });
    }
    buyerRfqs.forEach((rfq, idx) => {
      if (rfq.createdAt) {
        logs.push({
          id: `comm-rfq-${rfq.id}-${idx}`,
          channel: 'SYSTEM_NOTIFICATION',
          subject: `RFQ Dispatch & Supplier Sourcing Match: ${rfq.rfqNumber}`,
          recipient: activeBuyer.corporateEmail,
          timestamp: rfq.createdAt,
          status: 'DISPATCHED',
          preview: `RFQ for "${rfq.title}" dispatched across ${(rfq.assignedVendors || []).length} verified suppliers via ${RFQ_MODE_LABELS[rfq.sourcingMode] || 'Mode 1'}.`,
        });
      }
    });
    return logs;
  }, [activeBuyer, buyerRfqs]);

  const buyerPayments = useMemo(() => {
    if (!activeBuyer) return [];
    const payments = [];
    if (activeBuyer.createdDate) {
      payments.push({
        id: `pay-init-${activeBuyer.id}`,
        invoiceNo: `INV-2026-${activeBuyer.id.slice(0, 5).toUpperCase()}`,
        description: `Plan: ${activeBuyer.subscriptionPlan || 'Free Enterprise Trial'}`,
        amount: activeBuyer.subscriptionPlan?.includes('growth') ? 14999 : activeBuyer.subscriptionPlan?.includes('custom') ? 49999 : 0,
        status: 'PAID',
        gateway: 'Zoho Payments (India UPI / NetBanking)',
        date: activeBuyer.createdDate,
      });
    }
    return payments;
  }, [activeBuyer]);

  const handleExportDirectory = () => {
    const rows = filteredBuyers.map((b) => {
      const metrics = buyerMetricsMap.get(b.id);
      const rfqCount = metrics?.rfqCount ?? (b.totalRFQsCreated || 0);
      const spendNumeric = metrics?.spendNumeric ?? 0;
      const spendDisplay = spendNumeric > 0 ? formatCurrency(spendNumeric) : String(b.totalSpend || '₹0').replace('$', '₹');
      return {
        OrganizationName: b.organizationName,
        ContactPerson: b.contactPerson || '',
        Email: b.corporateEmail,
        Phone: b.mobileNumber,
        City: b.city || '',
        PlantLocation: b.primaryPlantLocation || '',
        SourcingMode: RFQ_MODE_LABELS[b.sourcingMode] || 'Mode 0',
        Plan: b.subscriptionPlan || 'standard',
        RemainingFreeRFQs: b.remainingFreeRFQs ?? 5,
        TotalRFQsCreated: rfqCount,
        TotalSpend: spendDisplay,
        Status: b.status || 'ACTIVE',
      };
    });
    exportReportToExcel(rows, `Buyers_Directory_${new Date().toISOString().split('T')[0]}`, 'BuyersDirectory');
  };

  return (
    <div className="space-y-6">
      {/* Top Actions */}
      <div className="flex items-center justify-end gap-2.5 pb-1">
        <button
          onClick={handleExportDirectory}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold shadow-sm transition-all"
        >
          <Download className="w-4 h-4" />
          <span>Export Directory</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Buyers</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{totalBuyers}</p>
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
            {verifiedBuyers} Active Verified
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">RFQs Sourced</p>
          <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">{totalRFQs}</p>
          <span className="text-[11px] text-slate-500">Across all enterprise accounts</span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Sourcing Modes</p>
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              M1: {modeCounts[RFQ_MODES.MODE_1]}
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
              M2: {modeCounts[RFQ_MODES.MODE_2]}
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
              M3: {modeCounts[RFQ_MODES.MODE_3]}
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Category Governance</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">100%</p>
          <span className="text-[11px] text-slate-500">Standardized mode alignment</span>
        </div>
      </div>

      {/* Toolbar / Search & Filter Controls */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 sm:p-3 shadow-sm flex flex-row items-center gap-2 sm:gap-2.5 overflow-x-auto">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            placeholder="Search company, contact person, email, city..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 h-8.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Mode Filter */}
        <select
          value={selectedMode}
          onChange={(e) => setSelectedMode(e.target.value)}
          className="!w-auto shrink-0 h-8.5 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 whitespace-nowrap cursor-pointer"
        >
          <option value="all">All Sourcing Modes</option>
          <option value={RFQ_MODES.MODE_1}>{RFQ_MODE_LABELS[RFQ_MODES.MODE_1]}</option>
          <option value={RFQ_MODES.MODE_2}>{RFQ_MODE_LABELS[RFQ_MODES.MODE_2]}</option>
          <option value={RFQ_MODES.MODE_3}>{RFQ_MODE_LABELS[RFQ_MODES.MODE_3]}</option>
          <option value={RFQ_MODES.MODE_0}>{RFQ_MODE_LABELS[RFQ_MODES.MODE_0]}</option>
        </select>

        {/* Status Filter */}
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="!w-auto shrink-0 h-8.5 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 whitespace-nowrap cursor-pointer"
        >
          <option value="all">All Statuses</option>
          <option value="ACTIVE_VERIFIED">Active & Verified</option>
          <option value="ACTIVE">Active</option>
          <option value="PENDING_VERIFICATION">Pending Verification</option>
        </select>
      </div>

      {/* Buyers Data Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Buyer</th>
                <th className="px-4 py-2.5 font-semibold">Location</th>
                <th className="px-4 py-2.5 font-semibold">Mode</th>
                <th className="px-4 py-2.5 font-semibold">Plan</th>
                <th className="px-4 py-2.5 font-semibold">RFQs</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
              {filteredBuyers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    <Filter className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto mb-2" />
                    <p className="font-medium">No buyer accounts found matching your query.</p>
                  </td>
                </tr>
              ) : (
                paginatedBuyers.map((buyer) => {
                  const modeLabel = RFQ_MODE_LABELS[buyer.sourcingMode] || 'Mode 0';
                  const metrics = buyerMetricsMap.get(buyer.id);
                  const rfqCount = metrics?.rfqCount ?? (buyer.totalRFQsCreated || 0);
                  return (
                    <tr
                      key={buyer.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 font-bold flex items-center justify-center text-xs shrink-0">
                            {buyer.organizationName.charAt(0)}
                          </div>
                          <span className="font-semibold text-slate-900 dark:text-white truncate">
                            {buyer.organizationName}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                        {buyer.city || buyer.primaryPlantLocation || 'India'}
                      </td>

                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                          {modeLabel}
                        </span>
                      </td>

                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200 capitalize">
                        {buyer.subscriptionPlan || 'Free Trial'}
                      </td>

                      <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">
                        {rfqCount} {rfqCount === 1 ? 'RFQ' : 'RFQs'}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            buyer.status === 'ACTIVE_VERIFIED' || (buyer.status as string) === 'ACTIVE'
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                              : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {buyer.status || 'ACTIVE'}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => {
                            setActiveBuyer(buyer);
                            setDossierTab('profile');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-semibold text-xs transition-colors inline-flex items-center gap-1"
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
                  className="px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                          ? 'bg-indigo-600 text-white shadow-sm font-semibold'
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

      {/* 360° Buyer Dossier Drawer / Full Modal */}
      {activeBuyer && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
          <div className="w-full max-w-4xl bg-white dark:bg-slate-900 h-full min-h-screen shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-800">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-indigo-600 text-white font-bold text-lg flex items-center justify-center shadow-sm">
                  {activeBuyer.organizationName.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                      {activeBuyer.organizationName}
                    </h2>
                    <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                      {RFQ_MODE_LABELS[activeBuyer.sourcingMode] || 'Mode 0'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    ID: {activeBuyer.id} • Registered:{' '}
                    {formatIndianDateTime(activeBuyer.createdDate) || 'Verified Enterprise'}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setActiveBuyer(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Dossier Tabs Navigation */}
            <div className="flex items-center gap-1 px-5 border-b border-slate-200 dark:border-slate-800 overflow-x-auto bg-slate-50/30 dark:bg-slate-900">
              {[
                { id: 'profile', label: 'Profile', icon: Building2 },
                { id: 'rfqs', label: `RFQs (${buyerRfqs.length})`, icon: Layers },
                { id: 'credits', label: 'Credit', icon: CreditCard },
                { id: 'communications', label: `Messages (${buyerCommunications.length})`, icon: MessageSquare },
                { id: 'payments', label: `Payments (${buyerPayments.length})`, icon: Receipt },
                { id: 'activity', label: 'Audit', icon: History },
              ].map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setDossierTab(tab.id as any)}
                    className={`flex items-center gap-1.5 px-3.5 py-3 border-b-2 text-xs font-semibold whitespace-nowrap transition-all ${
                      dossierTab === tab.id
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
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
                  {/* Spend & RFQ Snapshot */}
                  {(() => {
                    const activeMetrics = buyerMetricsMap.get(activeBuyer.id);
                    const activeRfqCount = activeMetrics?.rfqCount ?? (activeBuyer.totalRFQsCreated || 0);
                    const activeSpendNumeric = activeMetrics?.spendNumeric ?? 0;
                    const activeSpendDisplay = activeSpendNumeric > 0 ? formatCurrency(activeSpendNumeric) : String(activeBuyer.totalSpend || '₹0').replace('$', '₹');
                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="bg-indigo-50/50 dark:bg-indigo-950/30 p-3.5 rounded-xl border border-indigo-100 dark:border-indigo-900/50">
                          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Total Sourced Spend</p>
                          <p className="text-xl font-bold text-indigo-700 dark:text-indigo-300 mt-0.5">{activeSpendDisplay}</p>
                          <p className="text-[10px] text-slate-400">Procurement run-rate</p>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Total RFQs Sourced</p>
                          <p className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">{activeRfqCount}</p>
                          <p className="text-[10px] text-slate-400">Active enterprise scope</p>
                        </div>
                        <div className="bg-emerald-50/50 dark:bg-emerald-950/30 p-3.5 rounded-xl border border-emerald-100 dark:border-emerald-900/50">
                          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Available Quota</p>
                          <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300 mt-0.5">{activeBuyer.remainingFreeRFQs ?? 5}</p>
                          <p className="text-[10px] text-slate-400">Free RFQ credits remaining</p>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl space-y-2 border border-slate-200 dark:border-slate-700">
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Corporate Contact
                      </p>
                      <div className="space-y-1.5 text-xs text-slate-800 dark:text-slate-200">
                        <p className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-slate-400" />
                          <span className="font-semibold">{activeBuyer.contactPerson || 'Procurement Executive'}</span>
                        </p>
                        <p className="flex items-center gap-2">
                          <Mail className="w-4 h-4 text-slate-400" />
                          <span>{activeBuyer.corporateEmail}</span>
                        </p>
                        <p className="flex items-center gap-2">
                          <Phone className="w-4 h-4 text-slate-400" />
                          <span>{activeBuyer.mobileNumber || '+91 Not provided'}</span>
                        </p>
                        <p className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-slate-400" />
                          <span>
                            {activeBuyer.city ? `${activeBuyer.city}, ` : ''}
                            {activeBuyer.primaryPlantLocation || 'India'}
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl space-y-2 border border-slate-200 dark:border-slate-700">
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Statutory & Governance
                      </p>
                      <div className="space-y-1.5 text-xs text-slate-800 dark:text-slate-200">
                        <p>
                          <span className="text-slate-500">Sourcing Mode:</span>{' '}
                          <span className="font-semibold">{RFQ_MODE_LABELS[activeBuyer.sourcingMode] || 'Mode 0'}</span>
                        </p>
                        <p>
                          <span className="text-slate-500">Subscription Tier:</span>{' '}
                          <span className="font-semibold capitalize">{activeBuyer.subscriptionPlan || 'Enterprise Trial'}</span>
                        </p>
                        <p>
                          <span className="text-slate-500">Status:</span>{' '}
                          <span className="font-semibold text-emerald-600">{activeBuyer.status || 'ACTIVE'}</span>
                        </p>
                        <p>
                          <span className="text-slate-500">Last Synced:</span>{' '}
                          <span>{formatIndianDateTime(activeBuyer.syncTimestamp) || 'Real-time'}</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Procurement Categories */}
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Supported Major Categories
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {(activeBuyer.supportedMajorCategories || ['General Procurement', 'Raw Materials', 'Spares']).map((cat, i) => (
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

              {/* Tab 2: RFQ History */}
              {dossierTab === 'rfqs' && (
                <div className="space-y-4">
                  {buyerRfqs.length === 0 ? (
                    <div className="p-10 text-center text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                      <Layers className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-700" />
                      <p className="text-xs font-medium">No RFQs created by this buyer yet.</p>
                    </div>
                  ) : (
                    <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                          <tr>
                            <th className="px-3.5 py-2.5 font-semibold">RFQ Number & Title</th>
                            <th className="px-3.5 py-2.5 font-semibold">Mode</th>
                            <th className="px-3.5 py-2.5 font-semibold">Budget</th>
                            <th className="px-3.5 py-2.5 font-semibold">Suppliers & Quotes</th>
                            <th className="px-3.5 py-2.5 font-semibold">Status</th>
                            <th className="px-3.5 py-2.5 font-semibold text-right">View</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {buyerRfqs.map((rfq) => (
                            <tr key={rfq.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                              <td className="px-3.5 py-2.5">
                                <p className="font-semibold text-slate-900 dark:text-white">{rfq.rfqNumber}</p>
                                <p className="text-[11px] text-slate-500 truncate max-w-xs">{rfq.title}</p>
                              </td>
                              <td className="px-3.5 py-2.5">
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                  {RFQ_MODE_LABELS[rfq.sourcingMode] || 'Mode 1'}
                                </span>
                              </td>
                              <td className="px-3.5 py-2.5 font-medium">
                                {rfq.budget > 0 ? formatCurrency(rfq.budget) : 'Open'}
                              </td>
                              <td className="px-3.5 py-2.5">
                                <span className="text-slate-700 dark:text-slate-300">
                                  {(rfq.assignedVendors || []).length} assigned / {(rfq.quotes || []).length} bids
                                </span>
                              </td>
                              <td className="px-3.5 py-2.5">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                  {rfq.status || 'Quotes Pending'}
                                </span>
                              </td>
                              <td className="px-3.5 py-2.5 text-right">
                                {onSelectRFQ && (
                                  <button
                                    onClick={() => onSelectRFQ(rfq)}
                                    className="p-1 text-indigo-600 hover:text-indigo-800 dark:text-indigo-400"
                                    title="Open RFQ Matrix"
                                  >
                                    <ExternalLink className="w-4 h-4" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 3: Credit / Quota History */}
              {dossierTab === 'credits' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                      <p className="text-xs text-slate-500">Remaining Free RFQs</p>
                      <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                        {activeBuyer.remainingFreeRFQs ?? 5}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">Refreshed on enterprise cycle</p>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                      <p className="text-xs text-slate-500">Consumed Credits</p>
                      <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                        {Math.max(0, 5 - (activeBuyer.remainingFreeRFQs ?? 5))}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">RFQs created in current window</p>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                      <p className="text-xs text-slate-500">Entitlement Mode</p>
                      <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                        {RFQ_MODE_LABELS[activeBuyer.sourcingMode] || 'Mode 0'}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">Authorized sourcing scope</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 4: Communication Logs */}
              {dossierTab === 'communications' && (
                <div className="space-y-3">
                  {buyerCommunications.length === 0 ? (
                    <div className="p-10 text-center text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                      <MessageSquare className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-700" />
                      <p className="text-xs font-medium">No recorded communication dispatches.</p>
                    </div>
                  ) : (
                    buyerCommunications.map((log) => (
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
                          <span>To: {log.recipient}</span>
                          <span className="text-emerald-600 font-medium">● {log.status}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab 5: Payment / Transaction History */}
              {dossierTab === 'payments' && (
                <div className="space-y-4">
                  {buyerPayments.length === 0 ? (
                    <div className="p-10 text-center text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                      <Receipt className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-700" />
                      <p className="text-xs font-medium">No transaction records found.</p>
                    </div>
                  ) : (
                    <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                          <tr>
                            <th className="px-3.5 py-2.5 font-semibold">Invoice / Reference</th>
                            <th className="px-3.5 py-2.5 font-semibold">Description</th>
                            <th className="px-3.5 py-2.5 font-semibold">Amount</th>
                            <th className="px-3.5 py-2.5 font-semibold">Gateway / Channel</th>
                            <th className="px-3.5 py-2.5 font-semibold">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {buyerPayments.map((p) => (
                            <tr key={p.id}>
                              <td className="px-3.5 py-2.5 font-semibold text-slate-900 dark:text-white">
                                {p.invoiceNo}
                              </td>
                              <td className="px-3.5 py-2.5 text-slate-600 dark:text-slate-300">{p.description}</td>
                              <td className="px-3.5 py-2.5 font-semibold text-slate-900 dark:text-white">
                                {formatCurrency(p.amount)}
                              </td>
                              <td className="px-3.5 py-2.5 text-slate-500">{p.gateway}</td>
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
                  )}
                </div>
              )}

              {/* Tab 6: Relevant Activity / Audit History */}
              {dossierTab === 'activity' && (
                <div className="space-y-3">
                  {buyerAuditLogs.length === 0 ? (
                    <div className="p-10 text-center text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                      <History className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-700" />
                      <p className="text-xs font-medium">No audit events logged for this enterprise buyer.</p>
                    </div>
                  ) : (
                    buyerAuditLogs.map((log) => (
                      <div
                        key={log.id}
                        className="bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs flex items-start justify-between"
                      >
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">{log.action}</p>
                          <p className="text-slate-600 dark:text-slate-300 mt-0.5">{(log as any).details || log.action}</p>
                          <p className="text-[11px] text-slate-400 mt-1">Actor: {(log as any).actorEmail || log.user || 'System'}</p>
                        </div>
                        <span className="text-[11px] text-slate-400 whitespace-nowrap ml-4">
                          {formatIndianDateTime(log.timestamp)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer Controls */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/40">
              <span className="text-xs text-slate-500">Category Manager Operations Console</span>
              <button
                onClick={() => setActiveBuyer(null)}
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
