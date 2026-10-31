'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
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
  Settings,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  GripVertical,
  RotateCcw,
} from 'lucide-react';
import { useApp } from '@/lib/store';
import BuyerDossierDrawer from './components/BuyerDossierDrawer';

export function isPendingBuyer(buyer?: { status?: string; verificationStatus?: string } | null): boolean {
  if (!buyer) return false;
  const s = String(buyer.status || '').toUpperCase().trim();
  const vs = String(buyer.verificationStatus || '').toUpperCase().trim();
  return (
    s === 'PENDING_VERIFICATION' ||
    s === 'PENDING_ONBOARDING' ||
    s === 'PENDING' ||
    s === 'PENDING_ALIGNMENT' ||
    s === 'PENDING_EMAIL_VERIFICATION' ||
    s === 'AWAITING_APPROVAL' ||
    s.includes('AWAITING') ||
    s === 'NEW' ||
    s.includes('PENDING') ||
    vs.includes('PENDING') ||
    vs.includes('AWAITING')
  );
}

export function isVerifiedBuyer(buyer?: { status?: string; verificationStatus?: string } | null): boolean {
  if (!buyer || isPendingBuyer(buyer)) return false;
  const s = String(buyer.status || '').toUpperCase().trim();
  const vs = String(buyer.verificationStatus || '').toUpperCase().trim();
  return (
    s === 'ACTIVE_VERIFIED' ||
    s === 'ACTIVE' ||
    s === 'VERIFIED' ||
    vs === 'VERIFIED' ||
    vs === 'ACTIVE'
  );
}

import type { BuyerAccount, RFQItem, AuditLogEntry, BuyerDirectoryColumnKey, BuyerDirectoryColumnConfig, BuyerCommunicationItem, BuyerPaymentTransaction } from '@/lib/types';
import {
  RFQ_MODES,
  RFQ_MODE_LABELS,
  SOURCING_MODES,
  formatCurrency,
  formatIndianDateTime,
  DEFAULT_BUYER_DIRECTORY_COLUMNS,
  BUYER_DIRECTORY_COLUMN_PREF_KEY,
} from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { exportReportToExcel } from '@/lib/reportsClient';

interface BuyersDirectoryProps {
  onSelectRFQ?: (rfq: RFQItem) => void;
  initialBuyerId?: string;
  initialTab?: 'profile' | 'rfqs' | 'credits' | 'communications' | 'payments';
}

export default function BuyersDirectory({ onSelectRFQ, initialBuyerId, initialTab }: BuyersDirectoryProps) {
  const { buyerAccounts = [], rfqs = [], auditLogs = [] } = useApp();

  // Search & Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMode, setSelectedMode] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedPlan, setSelectedPlan] = useState<string>('all');
  const [selectedSource, setSelectedSource] = useState<string>('all');

  // Sorting state
  const [sortColumn, setSortColumn] = useState<BuyerDirectoryColumnKey | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);



  // Context preservation: load saved directory state from sessionStorage on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('buyer_directory_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.searchTerm !== undefined) setSearchTerm(parsed.searchTerm);
        if (parsed.selectedMode !== undefined) setSelectedMode(parsed.selectedMode);
        if (parsed.selectedStatus !== undefined) setSelectedStatus(parsed.selectedStatus);
        if (parsed.selectedPlan !== undefined) setSelectedPlan(parsed.selectedPlan);
        if (parsed.selectedSource !== undefined) setSelectedSource(parsed.selectedSource);
        if (parsed.currentPage !== undefined) setCurrentPage(parsed.currentPage);
        if (parsed.sortColumn !== undefined) setSortColumn(parsed.sortColumn);
        if (parsed.sortOrder !== undefined) setSortOrder(parsed.sortOrder);
      }
    } catch {
      // ignore
    }
  }, []);

  // Context preservation: persist current state on updates
  useEffect(() => {
    try {
      sessionStorage.setItem(
        'buyer_directory_state',
        JSON.stringify({
          searchTerm,
          selectedMode,
          selectedStatus,
          selectedPlan,
          selectedSource,
          currentPage,
          sortColumn,
          sortOrder,
        })
      );
    } catch {
      // ignore
    }
  }, [searchTerm, selectedMode, selectedStatus, selectedPlan, selectedSource, currentPage, sortColumn, sortOrder]);

  // Column Customization state
  const [columns, setColumns] = useState<BuyerDirectoryColumnConfig[]>(DEFAULT_BUYER_DIRECTORY_COLUMNS);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  // Load column preferences from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(BUYER_DIRECTORY_COLUMN_PREF_KEY);
      if (saved) {
        const parsed: BuyerDirectoryColumnConfig[] = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const validKeys = new Set(DEFAULT_BUYER_DIRECTORY_COLUMNS.map((c) => c.key));
          const validated = parsed.filter((c) => validKeys.has(c.key));
          // Append any missing new columns from DEFAULT_BUYER_DIRECTORY_COLUMNS
          const presentKeys = new Set(validated.map((c) => c.key));
          DEFAULT_BUYER_DIRECTORY_COLUMNS.forEach((defCol) => {
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

  const saveColumns = useCallback((newCols: BuyerDirectoryColumnConfig[]) => {
    setColumns(newCols);
    try {
      localStorage.setItem(BUYER_DIRECTORY_COLUMN_PREF_KEY, JSON.stringify(newCols));
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleToggleColumn = useCallback(
    (key: BuyerDirectoryColumnKey) => {
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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedColIndex === null || draggedColIndex === targetIndex) return;
    const reordered = [...columns];
    const [moved] = reordered.splice(draggedColIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    setDraggedColIndex(null);
    saveColumns(reordered);
  };

  const handleResetColumns = useCallback(() => {
    saveColumns(DEFAULT_BUYER_DIRECTORY_COLUMNS);
  }, [saveColumns]);

  // Pagination state

  // Reset to first page when search, filters, or sorting change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedMode, selectedStatus, selectedPlan, selectedSource, sortColumn, sortOrder]);

  // Dossier Drawer / Modal state
  const [activeBuyer, setActiveBuyer] = useState<BuyerAccount | null>(null);

  useEffect(() => {
    if (initialBuyerId && buyerAccounts.length > 0) {
      const match = buyerAccounts.find((b) => b.id === initialBuyerId);
      if (match) {
        setActiveBuyer(match);
        if (initialTab) {
          setDossierTab(initialTab);
        }
      }
    }
  }, [initialBuyerId, initialTab, buyerAccounts]);
  const [dossierTab, setDossierTab] = useState<'profile' | 'rfqs' | 'credits' | 'communications' | 'payments' | 'activity'>('profile');

  // Pre-calculate per-buyer RFQ counts and actual spend from the live RFQs collection
  const buyerMetricsMap = useMemo(() => {
    const map = new Map<string, { rfqCount: number; spendNumeric: number; spendFormatted: string; rfqs: RFQItem[] }>();

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

      const rfqsSpend = matchingRfqs.reduce((sum, r) => {
        const val = Number(r.budget) || Number(r.awardedAmount) || (r.quotes?.[0]?.totalPrice ? Number(r.quotes[0].totalPrice) : 0);
        return sum + (isNaN(val) ? 0 : val);
      }, 0);

      const parsedHistoricalSpend = parseInt(String(buyer.totalSpend || '0').replace(/[^0-9]/g, ''), 10) || 0;
      const effectiveSpend = rfqsSpend > 0 ? rfqsSpend : parsedHistoricalSpend;
      const effectiveRfqCount = Math.max(buyer.totalRFQsCreated || 0, matchingRfqs.length);
      const spendDisplay = effectiveSpend > 0 ? formatCurrency(effectiveSpend) : String(buyer.totalSpend || '₹0').replace('$', '₹');

      map.set(buyer.id, {
        rfqCount: effectiveRfqCount,
        spendNumeric: effectiveSpend,
        spendFormatted: spendDisplay,
        rfqs: matchingRfqs,
      });
    });

    return map;
  }, [buyerAccounts, rfqs]);

  // Helper to determine whether an account is on a paid/active subscription tier
  const isSubscriptionBuyer = useCallback((b: BuyerAccount): boolean => {
    const plan = (b.subscriptionPlan || '').toLowerCase();
    return (
      plan === 'version_1' ||
      plan === 'version_2' ||
      plan === 'version_3' ||
      plan === 'unlimited' ||
      Boolean(b.unlimitedRfqAccess) ||
      Boolean(b.unlimitedAccess) ||
      plan.includes('growth') ||
      plan.includes('enterprise') ||
      plan.includes('custom')
    );
  }, []);

  // Helper to identify paid vs free RFQs
  const isPaidRFQ = useCallback(
    (rfq: RFQItem): boolean => {
      if ((rfq as any).isPaid || (rfq as any).isPaidPlan || (rfq as any).isPaidRfq) return true;
      const matchingBuyer = buyerAccounts.find(
        (b) =>
          (rfq.buyerAccountId && (b.id === rfq.buyerAccountId || (b as any).buyerAccountId === rfq.buyerAccountId)) ||
          (rfq.raisedByEmail && b.corporateEmail && b.corporateEmail.toLowerCase().trim() === rfq.raisedByEmail.toLowerCase().trim()) ||
          (rfq.buyerAccountName && b.organizationName && b.organizationName.toLowerCase().trim() === rfq.buyerAccountName.toLowerCase().trim())
      );
      return matchingBuyer ? isSubscriptionBuyer(matchingBuyer) : false;
    },
    [buyerAccounts, isSubscriptionBuyer]
  );

  // KPI Metrics Calculation (5 Summary Cards)
  const totalBuyers = buyerAccounts.length;
  const verifiedBuyers = useMemo(
    () => buyerAccounts.filter(isVerifiedBuyer).length,
    [buyerAccounts]
  );
  const subscriptionBuyers = useMemo(
    () => buyerAccounts.filter(isSubscriptionBuyer).length,
    [buyerAccounts, isSubscriptionBuyer]
  );
  const totalRFQs = rfqs.length;
  const paidRFQs = useMemo(
    () => rfqs.filter(isPaidRFQ).length,
    [rfqs, isPaidRFQ]
  );
  const freeRFQs = useMemo(
    () => Math.max(0, totalRFQs - paidRFQs),
    [totalRFQs, paidRFQs]
  );

  // Overall platform total sourcing spend
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
      [RFQ_MODES.MODE_0]: 0,
      [RFQ_MODES.MODE_1]: 0,
      [RFQ_MODES.MODE_2]: 0,
      [RFQ_MODES.MODE_3]: 0,
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
      const q = searchTerm.toLowerCase().trim();
      const matchesSearch =
        !q ||
        buyer.organizationName?.toLowerCase().includes(q) ||
        buyer.contactPerson?.toLowerCase().includes(q) ||
        buyer.corporateEmail?.toLowerCase().includes(q) ||
        buyer.city?.toLowerCase().includes(q) ||
        buyer.primaryPlantLocation?.toLowerCase().includes(q);

      const matchesMode = selectedMode === 'all' || buyer.sourcingMode === selectedMode;

            const matchesStatus =
        selectedStatus === 'all' ||
        (selectedStatus === 'ACTIVE_VERIFIED'
          ? isVerifiedBuyer(buyer)
          : selectedStatus === 'PENDING_VERIFICATION'
          ? isPendingBuyer(buyer)
          : (buyer.status as string) === selectedStatus);

      const buyerSource = String(buyer.sourceType || buyer.accountSource || '').toLowerCase();
      let matchesSource = true;
      if (selectedSource === 'Web App') {
        matchesSource = !buyerSource || buyerSource.includes('web') || buyerSource === 'public_system';
      } else if (selectedSource === 'WhatsApp') {
        matchesSource = buyerSource.includes('whatsapp');
      } else if (selectedSource === 'Email') {
        matchesSource = buyerSource.includes('email');
      } else if (selectedSource !== 'all') {
        matchesSource = buyerSource === selectedSource.toLowerCase();
      }

      const matchesPlan = selectedPlan === 'all' || buyer.subscriptionPlan === selectedPlan;

      return matchesSearch && matchesMode && matchesStatus && matchesPlan && matchesSource;
    });
  }, [buyerAccounts, searchTerm, selectedMode, selectedStatus, selectedPlan, selectedSource]);

  // Sorted Buyers
  const sortedBuyers = useMemo(() => {
    if (!sortColumn) return filteredBuyers;
    const sorted = [...filteredBuyers];
    const multiplier = sortOrder === 'desc' ? -1 : 1;

    sorted.sort((a, b) => {
      const metricsA = buyerMetricsMap.get(a.id);
      const metricsB = buyerMetricsMap.get(b.id);

      switch (sortColumn) {
        case 'organizationName': {
          const valA = (a.organizationName || '').toLowerCase();
          const valB = (b.organizationName || '').toLowerCase();
          return valA.localeCompare(valB) * multiplier;
        }
        case 'contactPerson': {
          const valA = (a.contactPerson || '').toLowerCase();
          const valB = (b.contactPerson || '').toLowerCase();
          return valA.localeCompare(valB) * multiplier;
        }
        case 'corporateEmail': {
          const valA = (a.corporateEmail || '').toLowerCase();
          const valB = (b.corporateEmail || '').toLowerCase();
          return valA.localeCompare(valB) * multiplier;
        }
        case 'mobileNumber': {
          const valA = (a.mobileNumber || '').toLowerCase();
          const valB = (b.mobileNumber || '').toLowerCase();
          return valA.localeCompare(valB) * multiplier;
        }
        case 'location': {
          const valA = (a.city || a.primaryPlantLocation || '').toLowerCase();
          const valB = (b.city || b.primaryPlantLocation || '').toLowerCase();
          return valA.localeCompare(valB) * multiplier;
        }
        case 'sourcingMode': {
          const valA = (a.sourcingMode || '').toLowerCase();
          const valB = (b.sourcingMode || '').toLowerCase();
          return valA.localeCompare(valB) * multiplier;
        }
        case 'subscriptionPlan': {
          const valA = (a.subscriptionPlan || '').toLowerCase();
          const valB = (b.subscriptionPlan || '').toLowerCase();
          return valA.localeCompare(valB) * multiplier;
        }
        case 'totalRFQsCreated': {
          const valA = metricsA?.rfqCount ?? (a.totalRFQsCreated || 0);
          const valB = metricsB?.rfqCount ?? (b.totalRFQsCreated || 0);
          return (valA - valB) * multiplier;
        }
        case 'remainingFreeRFQs': {
          const valA = a.remainingFreeRFQs ?? 5;
          const valB = b.remainingFreeRFQs ?? 5;
          return (valA - valB) * multiplier;
        }
        case 'totalSpend': {
          const valA = metricsA?.spendNumeric ?? 0;
          const valB = metricsB?.spendNumeric ?? 0;
          return (valA - valB) * multiplier;
        }
        case 'status': {
          const valA = (a.status || '').toLowerCase();
          const valB = (b.status || '').toLowerCase();
          return valA.localeCompare(valB) * multiplier;
        }
        case 'createdDate': {
          const timeA = a.createdDate ? Date.parse(a.createdDate) : 0;
          const timeB = b.createdDate ? Date.parse(b.createdDate) : 0;
          return (timeA - timeB) * multiplier;
        }
        default:
          return 0;
      }
    });

    return sorted;
  }, [filteredBuyers, sortColumn, sortOrder, buyerMetricsMap]);

  // Paginated Buyers slice
  const totalItems = sortedBuyers.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const effectivePage = Math.min(currentPage, totalPages);
  const startIndex = (effectivePage - 1) * pageSize;
  const paginatedBuyers = useMemo(() => {
    return sortedBuyers.slice(startIndex, startIndex + pageSize);
  }, [sortedBuyers, startIndex, pageSize]);

  // Derived buyer-specific RFQs, Audit Logs, and communications for dossier
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
  const buyerCommunications = useMemo<BuyerCommunicationItem[]>(() => {
    if (!activeBuyer) return [];
    const logs: BuyerCommunicationItem[] = [];
    if (activeBuyer.createdDate) {
      logs.push({
        id: `comm-reg-${activeBuyer.id}`,
        accountId: activeBuyer.id,
        channel: 'EMAIL',
        subject: 'Enterprise Onboarding Confirmation & API Key Generation',
        recipient: activeBuyer.corporateEmail || '',
        message: `Welcome ${activeBuyer.contactPerson || activeBuyer.organizationName} to the Procucev Enterprise Network. Initial free trial activated.`,
        preview: `Welcome ${activeBuyer.contactPerson || activeBuyer.organizationName} to the Procucev Enterprise Network. Initial free trial activated.`,
        deliveryStatus: 'DELIVERED',
        sentAt: activeBuyer.createdDate,
      });
    }
    buyerRfqs.forEach((rfq, idx) => {
      if (rfq.createdAt) {
        logs.push({
          id: `comm-rfq-${rfq.id}-${idx}`,
          accountId: activeBuyer.id,
          channel: 'SYSTEM_NOTIFICATION',
          subject: `RFQ Dispatch & Supplier Sourcing Match: ${rfq.rfqNumber}`,
          recipient: activeBuyer.corporateEmail || '',
          message: `RFQ for "${rfq.title}" dispatched across ${(rfq.assignedVendors || []).length} verified suppliers via ${RFQ_MODE_LABELS[rfq.sourcingMode] || 'Mode 1'}.`,
          preview: `RFQ for "${rfq.title}" dispatched across ${(rfq.assignedVendors || []).length} verified suppliers via ${RFQ_MODE_LABELS[rfq.sourcingMode] || 'Mode 1'}.`,
          deliveryStatus: 'DISPATCHED',
          sentAt: rfq.createdAt,
        });
      }
    });
    return logs;
  }, [activeBuyer, buyerRfqs]);

  const buyerPayments = useMemo<BuyerPaymentTransaction[]>(() => {
    if (!activeBuyer) return [];
    const payments: BuyerPaymentTransaction[] = [];
    if (activeBuyer.createdDate) {
      payments.push({
        id: `pay-init-${activeBuyer.id}`,
        paymentId: `PAY-${activeBuyer.id.slice(0, 5).toUpperCase()}`,
        invoiceNo: `INV-2026-${activeBuyer.id.slice(0, 5).toUpperCase()}`,
        description: `Plan: ${activeBuyer.subscriptionPlan || 'Free Enterprise Trial'}`,
        subscriptionPlan: activeBuyer.subscriptionPlan || 'Free Enterprise Trial',
        amount: activeBuyer.subscriptionPlan?.includes('growth') ? 14999 : activeBuyer.subscriptionPlan?.includes('custom') ? 49999 : 0,
        currency: 'INR',
        status: 'PAID',
        gateway: 'Zoho Payments (India UPI / NetBanking)',
        paymentMethod: 'Zoho Payments (India UPI / NetBanking)',
        transactionDate: activeBuyer.createdDate,
        date: activeBuyer.createdDate,
      });
    }
    return payments;
  }, [activeBuyer]);

  const handleExportDirectory = useCallback(() => {
    const rows = sortedBuyers.map((b) => {
      const metrics = buyerMetricsMap.get(b.id);
      const rfqCount = metrics?.rfqCount ?? (b.totalRFQsCreated || 0);
      const spendNumeric = metrics?.spendNumeric ?? 0;
      const spendDisplay = spendNumeric > 0 ? formatCurrency(spendNumeric) : String(b.totalSpend || '₹0').replace('$', '₹');
      return {
        OrganizationName: b.organizationName,
        ContactPerson: b.contactPerson || '',
        Email: b.corporateEmail,
        ...(b.mobileNumber ? { Phone: b.mobileNumber } : {}),
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
  }, [sortedBuyers, buyerMetricsMap]);

  // Handle column header sort click
  const handleSortClick = (key: BuyerDirectoryColumnKey) => {
    if (key === 'actions') return;
    if (sortColumn === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(key);
      setSortOrder('asc');
    }
  };

  const visibleColumns = useMemo(() => columns.filter((c) => c.visible), [columns]);

  return (
    <div className="space-y-4">
      {/* 5 KPI Summary Cards (In 1 horizontal row) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* Card 1: Total Buyers */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 sm:p-3.5 rounded-xl shadow-sm flex flex-col justify-between">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Buyers</p>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mt-1">{totalBuyers}</p>
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-1">
            {verifiedBuyers} Active Verified
          </span>
        </div>

        {/* Card 2: Subscription Buyers */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 sm:p-3.5 rounded-xl shadow-sm flex flex-col justify-between">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Subscription Buyers</p>
          <p className="text-xl sm:text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">{subscriptionBuyers}</p>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            {Math.max(0, totalBuyers - subscriptionBuyers)} Free Trial
          </span>
        </div>

        {/* Card 3: Total RFQs */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 sm:p-3.5 rounded-xl shadow-sm flex flex-col justify-between">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total RFQs</p>
          <p className="text-xl sm:text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">{totalRFQs}</p>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Across all enterprise accounts
          </span>
        </div>

        {/* Card 4: Free RFQs */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 sm:p-3.5 rounded-xl shadow-sm flex flex-col justify-between">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Free RFQs</p>
          <p className="text-xl sm:text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">{freeRFQs}</p>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Trial & promotional credits
          </span>
        </div>

        {/* Card 5: Paid RFQs */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 sm:p-3.5 rounded-xl shadow-sm flex flex-col justify-between">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Paid RFQs</p>
          <p className="text-xl sm:text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{paidRFQs}</p>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Subscription & enterprise
          </span>
        </div>
      </div>

      {/* Toolbar / Search & Filter Controls with Export and Gear Icon (Horizontal Row) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 sm:p-3 shadow-sm flex flex-row items-center gap-2 sm:gap-2.5 overflow-x-auto no-scrollbar">
        {/* Search input */}
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

        {/* Mode Filter in ascending order: Mode 0, Mode 1, Mode 2, Mode 3 */}
        <select
          value={selectedMode}
          onChange={(e) => setSelectedMode(e.target.value)}
          aria-label="Filter by sourcing mode"
          className="!w-auto shrink-0 h-8.5 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 whitespace-nowrap cursor-pointer"
        >
          <option value="all">All Sourcing Modes</option>
          <option value={RFQ_MODES.MODE_0}>{RFQ_MODE_LABELS[RFQ_MODES.MODE_0]}</option>
          <option value={RFQ_MODES.MODE_1}>{RFQ_MODE_LABELS[RFQ_MODES.MODE_1]}</option>
          <option value={RFQ_MODES.MODE_2}>{RFQ_MODE_LABELS[RFQ_MODES.MODE_2]}</option>
          <option value={RFQ_MODES.MODE_3}>{RFQ_MODE_LABELS[RFQ_MODES.MODE_3]}</option>
        </select>

        {/* Status Filter: All Statuses, Pending Verification, Active & Verified */}
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          aria-label="Filter by account status"
          className="!w-auto shrink-0 h-8.5 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 whitespace-nowrap cursor-pointer"
        >
          <option value="all">All Statuses</option>
          <option value="PENDING_VERIFICATION">Pending Verification</option>
          <option value="ACTIVE_VERIFIED">Active & Verified</option>
        </select>

        {/* Source Type Filter: All Sources, Web App, WhatsApp, Email */}
        <select
          value={selectedSource}
          onChange={(e) => setSelectedSource(e.target.value)}
          aria-label="Filter by source type"
          className="!w-auto shrink-0 h-8.5 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 whitespace-nowrap cursor-pointer"
        >
          <option value="all">{UI_STRINGS.buyerDirectory.allSources}</option>
          <option value="Web App">{UI_STRINGS.buyerDirectory.sourceWebApp}</option>
          <option value="WhatsApp">{UI_STRINGS.buyerDirectory.sourceWhatsApp}</option>
          <option value="Email">{UI_STRINGS.buyerDirectory.sourceEmail}</option>
        </select>

        {/* Export Directory and Gear icon aligned to right */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            onClick={handleExportDirectory}
            className="flex items-center gap-1.5 px-3 py-1.5 h-8.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-all shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Directory</span>
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

      {/* Column Customization Modal */}
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
                <Settings className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Column Settings</h3>
                  <p className="text-[11px] text-slate-500">Show, hide, and drag handles to reorder columns</p>
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
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, idx)}
                  className="flex items-center justify-between py-2 px-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg transition-colors cursor-move group"
                >
                  <div className="flex items-center gap-2.5">
                    <GripVertical className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 shrink-0" />
                    <input
                      type="checkbox"
                      id={`col-toggle-${col.key}`}
                      checked={col.visible}
                      disabled={col.required}
                      onChange={() => handleToggleColumn(col.key)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:opacity-50"
                    />
                    <label
                      htmlFor={`col-toggle-${col.key}`}
                      className="text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer select-none"
                    >
                      {col.label}
                      {col.required && <span className="ml-1 text-[10px] text-slate-400">(locked)</span>}
                    </label>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">#{idx + 1}</span>
                </div>
              ))}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
              <button
                type="button"
                onClick={handleResetColumns}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to Default</span>
              </button>
              <button
                type="button"
                onClick={() => setShowColumnSettings(false)}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition-all"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Buyers Data Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
              <tr>
                {visibleColumns.map((col) => {
                  const isSorted = sortColumn === col.key;
                  const isAction = col.key === 'actions';
                  return (
                    <th
                      key={col.key}
                      onClick={() => !isAction && handleSortClick(col.key)}
                      className={`px-4 py-2.5 font-semibold ${
                        isAction ? 'text-right' : 'cursor-pointer select-none hover:bg-slate-100/70 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className={`flex items-center gap-1.5 ${isAction ? 'justify-end' : ''}`}>
                        <span>{col.label}</span>
                        {!isAction && (
                          <span className="text-slate-400">
                            {isSorted ? (
                              sortOrder === 'asc' ? (
                                <ArrowUp className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                              ) : (
                                <ArrowDown className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-slate-300 dark:text-slate-600" />
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
              {sortedBuyers.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-4 py-12 text-center text-slate-500">
                    <Filter className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto mb-2" />
                    <p className="font-medium">No buyer accounts found matching your query.</p>
                  </td>
                </tr>
              ) : (
                paginatedBuyers.map((buyer) => {
                  const modeLabel = RFQ_MODE_LABELS[buyer.sourcingMode] || 'Mode 0';
                  const metrics = buyerMetricsMap.get(buyer.id);
                  const rfqCount = metrics?.rfqCount ?? (buyer.totalRFQsCreated || 0);
                  const spendNumeric = metrics?.spendNumeric ?? 0;
                  const spendDisplay = spendNumeric > 0 ? formatCurrency(spendNumeric) : String(buyer.totalSpend || '₹0').replace('$', '₹');

                  return (
                    <tr
                      key={buyer.id}
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest('button') || target.closest('a') || target.closest('input') || target.closest('select')) {
                          return;
                        }
                        setActiveBuyer(buyer);
                        setDossierTab('profile');
                      }}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                    >
                      {visibleColumns.map((col) => {
                        switch (col.key) {
                          case 'organizationName':
                            return (
                              <td key={col.key} className="px-4 py-3">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveBuyer(buyer);
                                    setDossierTab('profile');
                                  }}
                                  className="flex items-center gap-2.5 text-left group cursor-pointer focus:outline-none"
                                >
                                  <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 font-bold flex items-center justify-center text-xs shrink-0 group-hover:scale-105 transition-transform">
                                    {(buyer.organizationName || 'B').charAt(0)}
                                  </div>
                                  <span className="font-semibold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate">
                                    {buyer.organizationName}
                                  </span>
                                </button>
                              </td>
                            );
                          case 'contactPerson':
                            return (
                              <td key={col.key} className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                                {buyer.contactPerson || '–'}
                              </td>
                            );
                          case 'corporateEmail':
                            return (
                              <td key={col.key} className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">
                                {buyer.corporateEmail || '–'}
                              </td>
                            );
                          case 'mobileNumber':
                            return (
                              <td key={col.key} className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">
                                {buyer.mobileNumber || '–'}
                              </td>
                            );
                          case 'location':
                            return (
                              <td key={col.key} className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                                {buyer.city || buyer.primaryPlantLocation || 'India'}
                              </td>
                            );
                          case 'sourcingMode':
                            return (
                              <td key={col.key} className="px-4 py-3">
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                  {modeLabel}
                                </span>
                              </td>
                            );
                          case 'subscriptionPlan':
                            return (
                              <td key={col.key} className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200 capitalize">
                                {buyer.subscriptionPlan || 'Free Trial'}
                              </td>
                            );
                          case 'totalRFQsCreated':
                            return (
                              <td key={col.key} className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">
                                {rfqCount} {rfqCount === 1 ? 'RFQ' : 'RFQs'}
                              </td>
                            );
                          case 'remainingFreeRFQs':
                            return (
                              <td key={col.key} className="px-4 py-3 font-semibold text-emerald-600 dark:text-emerald-400">
                                {buyer.remainingFreeRFQs ?? 5} credits
                              </td>
                            );
                          case 'totalSpend':
                            return (
                              <td key={col.key} className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">
                                {spendDisplay}
                              </td>
                            );
                          case 'status':
                            return (
                              <td key={col.key} className="px-4 py-3">
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
                            );
                          case 'createdDate':
                            return (
                              <td key={col.key} className="px-4 py-3 text-slate-500 whitespace-nowrap">
                                {buyer.createdDate ? formatIndianDateTime(buyer.createdDate) : '–'}
                              </td>
                            );
                          case 'actions':
                            return (
                              <td key={col.key} className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveBuyer(buyer);
                                    setDossierTab('profile');
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-semibold text-xs transition-colors inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <span>360° Dossier</span>
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
        <BuyerDossierDrawer
          buyer={{
            ...activeBuyer,
            totalSpend: buyerMetricsMap.get(activeBuyer.id)?.spendFormatted || (activeBuyer.totalSpend ? activeBuyer.totalSpend.split("$").join("₹") : "₹0"),
            totalRFQsCreated: buyerMetricsMap.get(activeBuyer.id)?.rfqCount ?? activeBuyer.totalRFQsCreated,
          }}
          initialTab={dossierTab as any}
          onTabChange={(t) => setDossierTab(t as any)}
          onClose={() => setActiveBuyer(null)}
          onSelectRFQ={onSelectRFQ}
          buyerRfqs={buyerRfqs}
          initialCommunications={buyerCommunications}
          initialPayments={buyerPayments}
        />
      )}
    </div>
  );
}