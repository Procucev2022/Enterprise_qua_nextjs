'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  Building2,
  Layers,
  CreditCard,
  MessageSquare,
  Receipt,
  Mail,
  Phone,
  MapPin,
  Plus,
  Pencil,
  ExternalLink,
  Search,
  Download,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileText,
  Check,
  RotateCcw,
  Loader2,
  PhoneCall,
  Smartphone,
  Eye,
} from 'lucide-react';
import type {
  BuyerAccount,
  RFQItem,
  BuyerCreditSummary,
  BuyerCreditTransaction,
  BuyerCommunicationItem,
  BuyerPaymentSummary,
  BuyerPaymentTransaction,
} from '@/lib/types';
import {
  formatCurrency,
  formatIndianDateTime,
  RFQ_MODE_LABELS,
} from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import {
  fetchBuyerCreditHistory,
  addBuyerCredit,
  updateBuyerCategories,
  fetchBuyerCommunications,
  fetchBuyerPaymentHistory,
} from '@/lib/buyerProfileClient';

interface BuyerDossierDrawerProps {
  buyer: BuyerAccount;
  onClose: () => void;
  onSelectRFQ?: (rfq: RFQItem) => void;
  buyerRfqs?: RFQItem[];
  initialCommunications?: BuyerCommunicationItem[];
  initialPayments?: BuyerPaymentTransaction[];
}

const DEFAULT_MAJOR_CATEGORIES = [
  'General Procurement',
  'Raw Materials',
  'Spares',
  'Capital Equipment',
  'IT & Telecom',
  'Logistics & Supply Chain',
  'Services & Maintenance',
  'Packaging Materials',
  'Electrical Components',
  'Chemicals & Solvents',
];

export default function BuyerDossierDrawer({
  buyer,
  onClose,
  onSelectRFQ,
  buyerRfqs = [],
  initialCommunications = [],
  initialPayments = [],
}: BuyerDossierDrawerProps) {
  const strings = UI_STRINGS.buyerDirectory.dossier;

  // Active Main Tab
  const [dossierTab, setDossierTab] = useState<'profile' | 'rfqs' | 'credits' | 'communications' | 'payments'>('profile');

  // Active Communications Sub-Tab
  const [commSubTab, setCommSubTab] = useState<'email' | 'sms' | 'whatsapp' | 'call'>('email');

  // Toast feedback
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ---------------------------------------------------------------------------
  // 1. CATEGORIES MANAGEMENT (Tab 1: Profile)
  // ---------------------------------------------------------------------------
  const [isEditCategoriesOpen, setIsEditCategoriesOpen] = useState<boolean>(false);
  const [currentCategories, setCurrentCategories] = useState<string[]>(
    buyer.supportedMajorCategories || ['General Procurement', 'Raw Materials', 'Spares']
  );
  const [selectedCategoriesDraft, setSelectedCategoriesDraft] = useState<string[]>(currentCategories);
  const [newCategoryInput, setNewCategoryInput] = useState<string>('');
  const [isSubmittingCategories, setIsSubmittingCategories] = useState<boolean>(false);

  useEffect(() => {
    setCurrentCategories(buyer.supportedMajorCategories || ['General Procurement', 'Raw Materials', 'Spares']);
    setSelectedCategoriesDraft(buyer.supportedMajorCategories || ['General Procurement', 'Raw Materials', 'Spares']);
  }, [buyer.supportedMajorCategories]);

  const handleToggleCategory = (cat: string) => {
    setSelectedCategoriesDraft((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleAddNewCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newCategoryInput.trim();
    if (clean && !selectedCategoriesDraft.includes(clean)) {
      setSelectedCategoriesDraft((prev) => [...prev, clean]);
      setNewCategoryInput('');
    }
  };

  const handleSaveCategories = async () => {
    setIsSubmittingCategories(true);
    try {
      const res = await updateBuyerCategories(buyer.id, selectedCategoriesDraft);
      if (res.success) {
        setCurrentCategories(selectedCategoriesDraft);
        setIsEditCategoriesOpen(false);
        showToast('Supported major categories updated successfully.');
      } else {
        showToast(res.error || 'Failed to update categories', 'error');
      }
    } catch {
      showToast('An error occurred while saving categories', 'error');
    } finally {
      setIsSubmittingCategories(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 2. RFQ TAB & RFQ MODAL (Tab 2: RFQs)
  // ---------------------------------------------------------------------------
  const [rfqSearch, setRfqSearch] = useState<string>('');
  const [rfqStatusFilter, setRfqStatusFilter] = useState<string>('all');
  const [selectedRfqForModal, setSelectedRfqForModal] = useState<RFQItem | null>(null);

  const filteredRfqs = useMemo(() => {
    return buyerRfqs.filter((rfq) => {
      const matchSearch =
        !rfqSearch ||
        rfq.rfqNumber.toLowerCase().includes(rfqSearch.toLowerCase()) ||
        rfq.title.toLowerCase().includes(rfqSearch.toLowerCase());
      const matchStatus = rfqStatusFilter === 'all' || rfq.status === rfqStatusFilter;
      return matchSearch && matchStatus;
    });
  }, [buyerRfqs, rfqSearch, rfqStatusFilter]);

  // ---------------------------------------------------------------------------
  // 3. CREDIT HISTORY & ADD CREDIT (Tab 3: Credit)
  // ---------------------------------------------------------------------------
  const [creditSummary, setCreditSummary] = useState<BuyerCreditSummary | null>(null);
  const [creditTransactions, setCreditTransactions] = useState<BuyerCreditTransaction[]>([]);
  const [loadingCredit, setLoadingCredit] = useState<boolean>(false);
  const [creditSearch, setCreditSearch] = useState<string>('');
  const [creditTypeFilter, setCreditTypeFilter] = useState<string>('all');
  const [creditSortOrder, setCreditSortOrder] = useState<'asc' | 'desc'>('desc');
  const [creditPage, setCreditPage] = useState<number>(1);
  const creditPageSize = 10;

  // Add Credit modal states
  const [isAddCreditModalOpen, setIsAddCreditModalOpen] = useState<boolean>(false);
  const [addCreditAmount, setAddCreditAmount] = useState<number>(5);
  const [addCreditReason, setAddCreditReason] = useState<string>('');
  const [isSubmittingCredit, setIsSubmittingCredit] = useState<boolean>(false);

  const loadCreditHistory = useCallback(async () => {
    setLoadingCredit(true);
    try {
      const res = await fetchBuyerCreditHistory(buyer.id);
      if (res.success) {
        setCreditSummary(res.summary || null);
        setCreditTransactions(res.transactions || []);
      }
    } catch {
      // Fallback baseline
    } finally {
      setLoadingCredit(false);
    }
  }, [buyer.id]);

  useEffect(() => {
    if (dossierTab === 'credits') {
      loadCreditHistory();
    }
  }, [dossierTab, loadCreditHistory]);

  const handleConfirmAddCredit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (addCreditAmount <= 0) return;
    setIsSubmittingCredit(true);
    try {
      const res = await addBuyerCredit(buyer.id, {
        amount: addCreditAmount,
        reason: addCreditReason || 'Category Manager console allocation',
        source: 'Category Manager Console',
      });
      if (res.success) {
        showToast(res.message || `Successfully added ${addCreditAmount} credits.`, 'success');
        setIsAddCreditModalOpen(false);
        setAddCreditAmount(5);
        setAddCreditReason('');
        loadCreditHistory();
      } else {
        showToast(res.error || 'Failed to add credit', 'error');
      }
    } catch {
      showToast('Error allocating credits', 'error');
    } finally {
      setIsSubmittingCredit(false);
    }
  };

  const filteredCreditTransactions = useMemo(() => {
    const list = creditTransactions;
    return list
      .filter((t) => {
        const matchSearch =
          !creditSearch ||
          t.transactionId.toLowerCase().includes(creditSearch.toLowerCase()) ||
          (t.relatedRfqId && t.relatedRfqId.toLowerCase().includes(creditSearch.toLowerCase())) ||
          t.description.toLowerCase().includes(creditSearch.toLowerCase());
        const matchType = creditTypeFilter === 'all' || t.transactionType === creditTypeFilter;
        return matchSearch && matchType;
      })
      .sort((a, b) => {
        const timeA = new Date(a.transactionDate).getTime();
        const timeB = new Date(b.transactionDate).getTime();
        return creditSortOrder === 'asc' ? timeA - timeB : timeB - timeA;
      });
  }, [creditTransactions, creditSearch, creditTypeFilter, creditSortOrder]);

  const paginatedCreditTransactions = useMemo(() => {
    const start = (creditPage - 1) * creditPageSize;
    return filteredCreditTransactions.slice(start, start + creditPageSize);
  }, [filteredCreditTransactions, creditPage]);

  // ---------------------------------------------------------------------------
  // 4. COMMUNICATIONS TAB (Tab 4: Communications with 4 Sub-Tabs)
  // ---------------------------------------------------------------------------
  const [communications, setCommunications] = useState<BuyerCommunicationItem[]>(initialCommunications);


  const [loadingComms, setLoadingComms] = useState<boolean>(false);
  const [commSearch, setCommSearch] = useState<string>('');
  const [commDateFilter, setCommDateFilter] = useState<string>('');
  const [selectedEmailModal, setSelectedEmailModal] = useState<BuyerCommunicationItem | null>(null);

  const loadCommunications = useCallback(async () => {
    setLoadingComms(true);
    try {
      const res = await fetchBuyerCommunications(buyer.id);
      if (res && res.success && Array.isArray(res.data)) {
        setCommunications(res.data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingComms(false);
    }
  }, [buyer.id]);

  useEffect(() => {
    if (dossierTab === 'communications') {
      loadCommunications();
    }
  }, [dossierTab, loadCommunications]);

  const filteredCommunications = useMemo(() => {
    const list = communications;
    return list.filter((item) => {
      // Match active sub-tab
      let matchChannel = false;
      if (commSubTab === 'email') {
        matchChannel = item.channel === 'EMAIL' || item.channel === 'SYSTEM_NOTIFICATION';
      } else if (commSubTab === 'sms') {
        matchChannel = item.channel === 'SMS';
      } else if (commSubTab === 'whatsapp') {
        matchChannel = item.channel === 'WHATSAPP';
      } else if (commSubTab === 'call') {
        matchChannel = item.channel === 'CALL';
      }

      if (!matchChannel) return false;

      // Match search
      const matchSearch =
        !commSearch ||
        (item.subject && item.subject.toLowerCase().includes(commSearch.toLowerCase())) ||
        item.message.toLowerCase().includes(commSearch.toLowerCase()) ||
        item.recipient.toLowerCase().includes(commSearch.toLowerCase());

      // Match date
      const matchDate = !commDateFilter || item.sentAt.includes(commDateFilter);

      return matchSearch && matchDate;
    });
  }, [communications, commSubTab, commSearch, commDateFilter]);

  // ---------------------------------------------------------------------------
  // 5. PAYMENTS TAB (Tab 5: Payments)
  // ---------------------------------------------------------------------------
  const [paymentSummary, setPaymentSummary] = useState<BuyerPaymentSummary | null>(null);
  const [payments, setPayments] = useState<BuyerPaymentTransaction[]>(initialPayments);


  const [loadingPayments, setLoadingPayments] = useState<boolean>(false);
  const [paymentSearch, setPaymentSearch] = useState<string>('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>('all');
  const [paymentSortOrder, setPaymentSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedPaymentModal, setSelectedPaymentModal] = useState<BuyerPaymentTransaction | null>(null);
  const [paymentPage, setPaymentPage] = useState<number>(1);
  const paymentPageSize = 10;

  const loadPayments = useCallback(async () => {
    setLoadingPayments(true);
    try {
      const res = await fetchBuyerPaymentHistory(buyer.id);
      if (res.success) {
        setPaymentSummary(res.summary || null);
        setPayments(res.payments || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingPayments(false);
    }
  }, [buyer.id]);

  useEffect(() => {
    if (dossierTab === 'payments') {
      loadPayments();
    }
  }, [dossierTab, loadPayments]);

  const filteredPayments = useMemo(() => {
    return payments
      .filter((p) => {
        const matchSearch =
          !paymentSearch ||
          p.invoiceNo.toLowerCase().includes(paymentSearch.toLowerCase()) ||
          p.description.toLowerCase().includes(paymentSearch.toLowerCase()) ||
          p.paymentId.toLowerCase().includes(paymentSearch.toLowerCase());
        const matchStatus = paymentStatusFilter === 'all' || p.status.toUpperCase() === paymentStatusFilter.toUpperCase();
        return matchSearch && matchStatus;
      })
      .sort((a, b) => {
        const timeA = new Date(a.transactionDate || a.date || 0).getTime();
        const timeB = new Date(b.transactionDate || b.date || 0).getTime();
        return paymentSortOrder === 'asc' ? timeA - timeB : timeB - timeA;
      });
  }, [payments, paymentSearch, paymentStatusFilter, paymentSortOrder]);

  const paginatedPayments = useMemo(() => {
    const start = (paymentPage - 1) * paymentPageSize;
    return filteredPayments.slice(start, start + paymentPageSize);
  }, [filteredPayments, paymentPage]);

  // Keyboard Escape listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedRfqForModal) {
          setSelectedRfqForModal(null);
        } else if (isAddCreditModalOpen) {
          setIsAddCreditModalOpen(false);
        } else if (isEditCategoriesOpen) {
          setIsEditCategoriesOpen(false);
        } else if (selectedEmailModal) {
          setSelectedEmailModal(null);
        } else if (selectedPaymentModal) {
          setSelectedPaymentModal(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, selectedRfqForModal, isAddCreditModalOpen, isEditCategoriesOpen, selectedEmailModal, selectedPaymentModal]);

  // CSV Exporter for Credit History
  const exportCreditCsv = () => {
    const rows = filteredCreditTransactions.map((t) => ({
      TransactionID: t.transactionId,
      Date: t.transactionDate,
      Type: t.transactionType,
      Source: t.creditSource,
      Added: t.creditsAdded,
      Consumed: t.creditsConsumed,
      PreviousBalance: t.previousBalance,
      UpdatedBalance: t.updatedBalance,
      RelatedRFQ: t.relatedRfqId || '',
      Status: t.status,
      Description: t.description,
    }));
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [
        Object.keys(rows[0]).join(','),
        ...rows.map((r) => Object.values(r).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')),
      ].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `credit_history_${buyer.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // CSV Exporter for Payments
  const exportPaymentsCsv = () => {
    const rows = filteredPayments.map((p) => ({
      PaymentID: p.paymentId,
      InvoiceNo: p.invoiceNo,
      Date: p.transactionDate,
      Description: p.description,
      Plan: p.subscriptionPlan,
      Amount: p.amount,
      Currency: p.currency,
      Gateway: p.gateway,
      Method: p.paymentMethod,
      Status: p.status,
    }));
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [
        Object.keys(rows[0]).join(','),
        ...rows.map((r) => Object.values(r).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')),
      ].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `payment_history_${buyer.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="buyer-dossier-heading"
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-sm flex justify-end animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div className="w-full max-w-4xl bg-white dark:bg-slate-900 h-full min-h-screen shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-800" onClick={(e) => e.stopPropagation()}>
        {/* Toast Alert */}
        {toast && (
          <div
            className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl shadow-lg border text-xs font-semibold flex items-center gap-2 animate-in fade-in duration-150 ${
              toast.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800'
                : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/80 dark:text-rose-300 dark:border-rose-800'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span>{toast.message}</span>
          </div>
        )}

        {/* 1. Buyer Profile Header */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-indigo-600 text-white font-bold text-lg flex items-center justify-center shadow-sm">
              {buyer.organizationName.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="buyer-dossier-heading" className="text-lg font-bold text-slate-900 dark:text-white">
                  {buyer.organizationName}
                </h2>
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  {RFQ_MODE_LABELS[buyer.sourcingMode] || 'Mode 0'}
                </span>
                <button
                  type="button"
                  onClick={() => setIsAddCreditModalOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition cursor-pointer"
                  title="Add RFQ Sourcing Credits"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{strings.addCredit}</span>
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {formatString(strings.registered, {
                  date: formatIndianDateTime(buyer.createdDate) || 'Verified Enterprise',
                })}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close dossier"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 8. Final Buyer Profile Navigation Tabs in exact required order */}
        <div className="flex items-center gap-1 px-5 border-b border-slate-200 dark:border-slate-800 overflow-x-auto bg-slate-50/30 dark:bg-slate-900">
          {[
            { id: 'profile', label: strings.profileTab, icon: Building2 },
            { id: 'rfqs', label: `${strings.rfqsTab} (${buyerRfqs.length})`, icon: Layers },
            { id: 'credits', label: strings.creditTab, icon: CreditCard },
            { id: 'communications', label: `${strings.communicationsTab} (${communications.length})`, icon: MessageSquare },
            { id: 'payments', label: `${strings.paymentsTab} (${payments.length})`, icon: Receipt },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setDossierTab(tab.id as any)}
                className={`flex items-center gap-1.5 px-3.5 py-3 border-b-2 text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
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

        {/* Dossier Content Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* TAB 1: PROFILE TAB */}
          {dossierTab === 'profile' && (
            <div className="space-y-6">
              {/* Snapshot Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-indigo-50/50 dark:bg-indigo-950/30 p-3.5 rounded-xl border border-indigo-100 dark:border-indigo-900/50">
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Total Sourced Spend</p>
                  <p className="text-xl font-bold text-indigo-700 dark:text-indigo-300 mt-0.5">
                    {String(buyer.totalSpend || '₹0').replace(/\$/g, '₹')}
                  </p>
                  <p className="text-[10px] text-slate-400">Procurement run-rate</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Total RFQs Sourced</p>
                  <p className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">
                    {buyer.totalRFQsCreated || buyerRfqs.length}
                  </p>
                  <p className="text-[10px] text-slate-400">Active enterprise scope</p>
                </div>
                <div className="bg-emerald-50/50 dark:bg-emerald-950/30 p-3.5 rounded-xl border border-emerald-100 dark:border-emerald-900/50">
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Available Quota</p>
                  <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300 mt-0.5">
                    {buyer.remainingFreeRFQs ?? 5}
                  </p>
                  <p className="text-[10px] text-slate-400">Free RFQ credits remaining</p>
                </div>
              </div>

              {/* Corporate Contact & Governance */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl space-y-2 border border-slate-200 dark:border-slate-700">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {strings.corporateContact}
                  </p>
                  <div className="space-y-1.5 text-xs text-slate-800 dark:text-slate-200">
                    <p className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="font-semibold">{buyer.contactPerson || 'Procurement Executive'}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                      <span>{buyer.corporateEmail}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                      <span>{buyer.mobileNumber || '+91 Not provided'}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                      <span>
                        {buyer.city ? `${buyer.city}, ` : ''}
                        {buyer.primaryPlantLocation || 'India'}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl space-y-2 border border-slate-200 dark:border-slate-700">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {strings.statutoryGovernance}
                  </p>
                  <div className="space-y-1.5 text-xs text-slate-800 dark:text-slate-200">
                    <p>
                      <span className="text-slate-500">Sourcing Mode:</span>{' '}
                      <span className="font-semibold">{RFQ_MODE_LABELS[buyer.sourcingMode] || 'Mode 0'}</span>
                    </p>
                    <p>
                      <span className="text-slate-500">Subscription Tier:</span>{' '}
                      <span className="font-semibold capitalize">{buyer.subscriptionPlan || 'Enterprise Trial'}</span>
                    </p>
                    <p>
                      <span className="text-slate-500">Status:</span>{' '}
                      <span className="font-semibold text-emerald-600">{buyer.status || 'ACTIVE'}</span>
                    </p>
                    <p>
                      <span className="text-slate-500">Last Synced:</span>{' '}
                      <span>{formatIndianDateTime(buyer.syncTimestamp) || 'Real-time'}</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Supported Major Categories with EDIT Button */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {strings.supportedMajorCategories}
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategoriesDraft(currentCategories);
                      setIsEditCategoriesOpen(true);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>{strings.editCategories}</span>
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {currentCategories.map((cat, i) => (
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

          {/* TAB 2: RFQS TAB */}
          {dossierTab === 'rfqs' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={rfqSearch}
                    onChange={(e) => setRfqSearch(e.target.value)}
                    placeholder="Search RFQs by number or title..."
                    className="w-full pl-9 pr-3 h-8 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <select
                  value={rfqStatusFilter}
                  onChange={(e) => setRfqStatusFilter(e.target.value)}
                  className="h-8 px-2.5 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300"
                >
                  <option value="all">All Statuses</option>
                  <option value="Quotes Pending">Quotes Pending</option>
                  <option value="Ready for Evaluation">Ready for Evaluation</option>
                  <option value="Awarded">Awarded</option>
                  <option value="Closed">Closed</option>
                </select>
              </div>

              {filteredRfqs.length === 0 ? (
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
                      {filteredRfqs.map((rfq) => (
                        <tr key={rfq.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="px-3.5 py-2.5">
                            {/* Clickable RFQ ID opens full details popup */}
                            <button
                              type="button"
                              onClick={() => setSelectedRfqForModal(rfq)}
                              className="font-bold text-indigo-600 dark:text-indigo-400 hover:underline text-left cursor-pointer"
                              title="Click to view complete RFQ details popup"
                            >
                              {rfq.rfqNumber}
                            </button>
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
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => setSelectedRfqForModal(rfq)}
                                className="p-1 text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 cursor-pointer"
                                title="View RFQ Popup"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </button>
                              {onSelectRFQ && (
                                <button
                                  type="button"
                                  onClick={() => onSelectRFQ(rfq)}
                                  className="p-1 text-slate-500 hover:text-indigo-600 dark:text-slate-400 cursor-pointer"
                                  title="Open RFQ Matrix"
                                >
                                  <Layers className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: CREDIT HISTORY TAB */}
          {dossierTab === 'credits' && (
            <div className="space-y-5">
              {/* Credit Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-[11px] font-medium text-slate-500">{strings.credit.totalAllocated}</p>
                  <p className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">
                    {creditSummary?.totalCreditsAllocated ?? 5}
                  </p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-[11px] font-medium text-slate-500">{strings.credit.totalConsumed}</p>
                  <p className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                    {creditSummary?.totalCreditsConsumed ?? Math.max(0, 5 - (buyer.remainingFreeRFQs ?? 5))}
                  </p>
                </div>
                <div className="bg-emerald-50/50 dark:bg-emerald-950/30 p-3.5 rounded-xl border border-emerald-100 dark:border-emerald-900/50">
                  <p className="text-[11px] font-medium text-slate-500">{strings.credit.remainingFree}</p>
                  <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300 mt-0.5">
                    {creditSummary?.remainingFreeCredits ?? (buyer.remainingFreeRFQs ?? 5)}
                  </p>
                </div>
                <div className="bg-indigo-50/50 dark:bg-indigo-950/30 p-3.5 rounded-xl border border-indigo-100 dark:border-indigo-900/50">
                  <p className="text-[11px] font-medium text-slate-500">{strings.credit.entitlementMode}</p>
                  <p className="text-lg font-bold text-indigo-700 dark:text-indigo-300 mt-0.5">
                    {RFQ_MODE_LABELS[buyer.sourcingMode] || 'Mode 0'}
                  </p>
                </div>
              </div>

              {/* Toolbar & Filters */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={creditSearch}
                      onChange={(e) => {
                        setCreditSearch(e.target.value);
                        setCreditPage(1);
                      }}
                      placeholder="Search by transaction ID or RFQ ID..."
                      className="w-full pl-9 pr-3 h-8 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg"
                    />
                  </div>
                  <select
                    value={creditTypeFilter}
                    onChange={(e) => {
                      setCreditTypeFilter(e.target.value);
                      setCreditPage(1);
                    }}
                    className="h-8 px-2.5 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300"
                  >
                    <option value="all">All Types</option>
                    <option value="Free Credits Allocated">Free Credits Allocated</option>
                    <option value="Credits Consumed">Credits Consumed</option>
                    <option value="Admin Credit Addition">Admin Credit Addition</option>
                    <option value="Purchased Credits">Purchased Credits</option>
                    <option value="Credit Adjustment">Credit Adjustment</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCreditSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                    className="h-8 flex items-center gap-1 px-2.5 text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
                  >
                    <ArrowUpDown size={13} />
                    <span>{creditSortOrder === 'asc' ? 'Oldest First' : 'Newest First'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={exportCreditCsv}
                    className="h-8 flex items-center gap-1.5 px-3 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg cursor-pointer"
                  >
                    <Download size={13} />
                    <span>Export CSV</span>
                  </button>
                </div>
              </div>

              {/* Transaction History Table */}
              {loadingCredit ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                  <Loader2 className="animate-spin text-indigo-500" size={24} />
                  <span className="text-xs">Loading complete credit history from database...</span>
                </div>
              ) : paginatedCreditTransactions.length === 0 ? (
                <div className="p-8 text-center text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <p className="text-xs">No credit transactions recorded matching filters.</p>
                </div>
              ) : (
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[700px]">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="px-3.5 py-2.5 font-semibold">Transaction ID & Date</th>
                        <th className="px-3.5 py-2.5 font-semibold">Type</th>
                        <th className="px-3.5 py-2.5 font-semibold">Source</th>
                        <th className="px-3.5 py-2.5 font-semibold text-center">+ Added</th>
                        <th className="px-3.5 py-2.5 font-semibold text-center">- Consumed</th>
                        <th className="px-3.5 py-2.5 font-semibold text-right">Balance</th>
                        <th className="px-3.5 py-2.5 font-semibold">Related RFQ</th>
                        <th className="px-3.5 py-2.5 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {paginatedCreditTransactions.map((tx) => (
                        <tr key={tx.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="px-3.5 py-2.5">
                            <span className="font-semibold text-slate-900 dark:text-white block">{tx.transactionId}</span>
                            <span className="text-[10px] text-slate-400">{formatIndianDateTime(tx.transactionDate)}</span>
                          </td>
                          <td className="px-3.5 py-2.5">
                            <span className="font-medium text-slate-800 dark:text-slate-200">{tx.transactionType}</span>
                            <span className="text-[10px] text-slate-400 block truncate max-w-[140px]">{tx.description}</span>
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-600 dark:text-slate-300">{tx.creditSource}</td>
                          <td className="px-3.5 py-2.5 text-center font-bold text-emerald-600 dark:text-emerald-400">
                            {tx.creditsAdded > 0 ? `+${tx.creditsAdded}` : '-'}
                          </td>
                          <td className="px-3.5 py-2.5 text-center font-bold text-rose-600 dark:text-rose-400">
                            {tx.creditsConsumed > 0 ? `-${tx.creditsConsumed}` : '-'}
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-extrabold text-slate-900 dark:text-white">
                            {tx.updatedBalance}
                          </td>
                          <td className="px-3.5 py-2.5 text-indigo-600 dark:text-indigo-400 font-medium">
                            {tx.relatedRfqId || '-'}
                          </td>
                          <td className="px-3.5 py-2.5">
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                              {tx.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {filteredCreditTransactions.length > creditPageSize && (
                <div className="flex items-center justify-between text-xs text-slate-500 pt-2">
                  <span>
                    Showing {(creditPage - 1) * creditPageSize + 1} to{' '}
                    {Math.min(creditPage * creditPageSize, filteredCreditTransactions.length)} of{' '}
                    {filteredCreditTransactions.length} transactions
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={creditPage === 1}
                      onClick={() => setCreditPage((p) => Math.max(1, p - 1))}
                      className="p-1.5 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={creditPage * creditPageSize >= filteredCreditTransactions.length}
                      onClick={() => setCreditPage((p) => p + 1)}
                      className="p-1.5 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: COMMUNICATIONS TAB (EMAIL, SMS, WHATSAPP, CALL LOGS) */}
          {dossierTab === 'communications' && (
            <div className="space-y-4">
              {/* 4 Compact Sub-tabs in one horizontal row */}
              <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                {[
                  { id: 'email', label: strings.subTabs.email, icon: Mail },
                  { id: 'sms', label: strings.subTabs.sms, icon: Smartphone },
                  { id: 'whatsapp', label: strings.subTabs.whatsapp, icon: MessageSquare },
                  { id: 'call', label: strings.subTabs.callLogs, icon: PhoneCall },
                ].map((st) => {
                  const Icon = st.icon;
                  const isActive = commSubTab === st.id;
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setCommSubTab(st.id as any)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        isActive
                          ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <Icon size={14} />
                      <span>{st.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Search & Date Filter */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={commSearch}
                    onChange={(e) => setCommSearch(e.target.value)}
                    placeholder={`Search ${commSubTab} communications...`}
                    className="w-full pl-9 pr-3 h-8 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <input
                  type="date"
                  value={commDateFilter}
                  onChange={(e) => setCommDateFilter(e.target.value)}
                  className="h-8 px-2.5 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300"
                />
              </div>

              {/* Communication Items */}
              {loadingComms ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                  <Loader2 className="animate-spin text-indigo-500" size={24} />
                  <span className="text-xs">Loading communication records...</span>
                </div>
              ) : filteredCommunications.length === 0 ? (
                <div className="p-8 text-center text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <p className="text-xs font-medium">No recorded {commSubTab.toUpperCase()} communications found for this buyer.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredCommunications.map((comm) => (
                    <div
                      key={comm.id}
                      className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2 text-xs"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 dark:text-white">
                              {comm.subject || `${comm.channel} Dispatch`}
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                              {comm.deliveryStatus || 'Delivered'}
                            </span>
                          </div>
                          <p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{comm.message}</p>
                        </div>
                        <span className="text-[11px] text-slate-400 whitespace-nowrap">
                          {formatIndianDateTime(comm.sentAt)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 dark:border-slate-700/60 text-[11px] text-slate-500">
                        <div className="flex items-center gap-3">
                          <span>To: <strong className="text-slate-700 dark:text-slate-300">{comm.recipient}</strong></span>
                          {comm.sender && <span>From: {comm.sender}</span>}
                          {comm.duration && <span>Duration: {comm.duration}</span>}
                        </div>
                        {commSubTab === 'email' && (
                          <button
                            type="button"
                            onClick={() => setSelectedEmailModal(comm)}
                            className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline font-semibold cursor-pointer"
                          >
                            <Eye size={12} />
                            <span>View Full Content</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 5: PAYMENTS TAB */}
          {dossierTab === 'payments' && (
            <div className="space-y-5">
              {/* Payment Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-[10px] font-medium text-slate-500 uppercase">{strings.payments.totalPaid}</p>
                  <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {formatCurrency(paymentSummary?.totalAmountPaid ?? (payments[0]?.amount || 0))}
                  </p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-[10px] font-medium text-slate-500 uppercase">{strings.payments.successful}</p>
                  <p className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                    {paymentSummary?.totalSuccessfulPayments ?? payments.filter((p) => p.status === 'PAID').length}
                  </p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-[10px] font-medium text-slate-500 uppercase">{strings.payments.pending}</p>
                  <p className="text-lg font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                    {paymentSummary?.pendingPayments ?? 0}
                  </p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-[10px] font-medium text-slate-500 uppercase">{strings.payments.failed}</p>
                  <p className="text-lg font-bold text-rose-600 dark:text-rose-400 mt-0.5">
                    {paymentSummary?.failedPayments ?? 0}
                  </p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-[10px] font-medium text-slate-500 uppercase">{strings.payments.refunded}</p>
                  <p className="text-lg font-bold text-slate-600 dark:text-slate-400 mt-0.5">
                    {formatCurrency(paymentSummary?.totalRefundedAmount ?? 0)}
                  </p>
                </div>
              </div>

              {/* Toolbar */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={paymentSearch}
                      onChange={(e) => {
                        setPaymentSearch(e.target.value);
                        setPaymentPage(1);
                      }}
                      placeholder="Search payments by invoice or description..."
                      className="w-full pl-9 pr-3 h-8 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg"
                    />
                  </div>
                  <select
                    value={paymentStatusFilter}
                    onChange={(e) => {
                      setPaymentStatusFilter(e.target.value);
                      setPaymentPage(1);
                    }}
                    className="h-8 px-2.5 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300"
                  >
                    <option value="all">All Statuses</option>
                    <option value="PAID">Paid</option>
                    <option value="PENDING">Pending</option>
                    <option value="FAILED">Failed</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                    className="h-8 flex items-center gap-1 px-2.5 text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
                  >
                    <ArrowUpDown size={13} />
                    <span>{paymentSortOrder === 'asc' ? 'Oldest First' : 'Newest First'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={exportPaymentsCsv}
                    className="h-8 flex items-center gap-1.5 px-3 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg cursor-pointer"
                  >
                    <Download size={13} />
                    <span>Export CSV</span>
                  </button>
                </div>
              </div>

              {/* Payments Table */}
              {loadingPayments ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                  <Loader2 className="animate-spin text-indigo-500" size={24} />
                  <span className="text-xs">Loading complete payment history...</span>
                </div>
              ) : paginatedPayments.length === 0 ? (
                <div className="p-8 text-center text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <p className="text-xs">No payment records found.</p>
                </div>
              ) : (
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[700px]">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="px-3.5 py-2.5 font-semibold">{strings.payments.invoiceRef}</th>
                        <th className="px-3.5 py-2.5 font-semibold">{strings.payments.description}</th>
                        <th className="px-3.5 py-2.5 font-semibold">{strings.payments.amount}</th>
                        <th className="px-3.5 py-2.5 font-semibold">{strings.payments.gatewayChannel}</th>
                        <th className="px-3.5 py-2.5 font-semibold">{strings.payments.status}</th>
                        <th className="px-3.5 py-2.5 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {paginatedPayments.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="px-3.5 py-2.5">
                            <span className="font-semibold text-slate-900 dark:text-white block">{p.invoiceNo}</span>
                            <span className="text-[10px] text-slate-400">
                              {formatIndianDateTime(p.transactionDate || p.date)}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-600 dark:text-slate-300">{p.description}</td>
                          <td className="px-3.5 py-2.5 font-bold text-slate-900 dark:text-white">
                            {formatCurrency(p.amount)}
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-500">
                            <span>{p.gateway}</span>
                            {p.paymentMethod && <span className="block text-[10px] text-slate-400">{p.paymentMethod}</span>}
                          </td>
                          <td className="px-3.5 py-2.5">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                p.status === 'PAID' || p.status === 'COMPLETED'
                                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                                  : p.status === 'PENDING'
                                  ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                                  : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                              }`}
                            >
                              {p.status}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => setSelectedPaymentModal(p)}
                              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-semibold cursor-pointer"
                            >
                              Details
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {filteredPayments.length > paymentPageSize && (
                <div className="flex items-center justify-between text-xs text-slate-500 pt-2">
                  <span>
                    Showing {(paymentPage - 1) * paymentPageSize + 1} to{' '}
                    {Math.min(paymentPage * paymentPageSize, filteredPayments.length)} of {filteredPayments.length} payments
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={paymentPage === 1}
                      onClick={() => setPaymentPage((p) => Math.max(1, p - 1))}
                      className="p-1.5 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={paymentPage * paymentPageSize >= filteredPayments.length}
                      onClick={() => setPaymentPage((p) => p + 1)}
                      className="p-1.5 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/40">
          <span className="text-xs text-slate-500">{strings.consoleTitle}</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors cursor-pointer"
          >
            {strings.closeDossier}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------------------ */}
      {/* MODAL 1: ADD CREDIT MODAL */}
      {/* ------------------------------------------------------------------------ */}
      {isAddCreditModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAddCreditModalOpen(false);
          }}
        >
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {strings.credit.addCreditTitle}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">{strings.credit.addCreditSubtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsAddCreditModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmAddCredit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.credit.creditAmount}
                </label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={addCreditAmount}
                  onChange={(e) => setAddCreditAmount(isNaN(parseInt(e.target.value, 10)) ? 0 : parseInt(e.target.value, 10))}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-bold"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.credit.reason}
                </label>
                <textarea
                  rows={3}
                  value={addCreditReason}
                  onChange={(e) => setAddCreditReason(e.target.value)}
                  placeholder="e.g., Enterprise relationship top-up / manual adjustment"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddCreditModalOpen(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCredit}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition disabled:opacity-50"
                >
                  {isSubmittingCredit ? 'Allocating...' : strings.credit.confirmAddCredit}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------------ */}
      {/* MODAL 2: EDIT SUPPORTED MAJOR CATEGORIES MODAL */}
      {/* ------------------------------------------------------------------------ */}
      {isEditCategoriesOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsEditCategoriesOpen(false);
          }}
        >
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Edit Supported Major Categories
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Select, add, or remove procurement categories for {buyer.organizationName}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsEditCategoriesOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={18} />
              </button>
            </div>

            {/* Standard Category Selection Badges */}
            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Standard Taxonomy Categories
              </span>
              <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-1">
                {DEFAULT_MAJOR_CATEGORIES.map((cat) => {
                  const isSelected = selectedCategoriesDraft.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => handleToggleCategory(cat)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition border cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {isSelected ? `✓ ${cat}` : `+ ${cat}`}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Add Custom Category Input */}
            <form onSubmit={handleAddNewCategory} className="flex items-center gap-2 pt-2">
              <input
                type="text"
                value={newCategoryInput}
                onChange={(e) => setNewCategoryInput(e.target.value)}
                placeholder="Type custom major category..."
                className="flex-1 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              />
              <button
                type="submit"
                className="px-3.5 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg cursor-pointer"
              >
                {strings.addCustomCategory}
              </button>
            </form>

            {/* Currently Selected Summary */}
            <div className="pt-2">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">
                Selected Categories ({selectedCategoriesDraft.length})
              </span>
              <div className="flex flex-wrap gap-1.5">
                {selectedCategoriesDraft.map((cat) => (
                  <span
                    key={cat}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                  >
                    <span>{cat}</span>
                    <button
                      type="button"
                      onClick={() => handleToggleCategory(cat)}
                      className="hover:text-rose-600 ml-0.5"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsEditCategoriesOpen(false)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCategories}
                disabled={isSubmittingCategories}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition disabled:opacity-50"
              >
                {isSubmittingCategories ? 'Saving...' : strings.saveCategories}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------------ */}
      {/* MODAL 3: RFQ DETAILS POPUP MODAL */}
      {/* ------------------------------------------------------------------------ */}
      {selectedRfqForModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedRfqForModal(null);
          }}
        >
          <div className="w-full max-w-2xl max-h-[90vh] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
            {/* Header */}
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {selectedRfqForModal.rfqNumber}
                  </h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                    {RFQ_MODE_LABELS[selectedRfqForModal.sourcingMode] || 'Mode 1'}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                    {selectedRfqForModal.status || 'Active'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{selectedRfqForModal.title}</p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedRfqForModal(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
              {/* Quick specs banner */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Budget</span>
                  <span className="font-extrabold text-slate-900 dark:text-white mt-0.5 block">
                    {selectedRfqForModal.budget > 0 ? formatCurrency(selectedRfqForModal.budget) : 'Open Budget'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Location</span>
                  <span className="font-extrabold text-slate-900 dark:text-white mt-0.5 block truncate">
                    {selectedRfqForModal.deliveryLocation || 'India'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Delivery Date</span>
                  <span className="font-extrabold text-slate-900 dark:text-white mt-0.5 block truncate">
                    {selectedRfqForModal.targetDeliveryDate ? formatIndianDateTime(selectedRfqForModal.targetDeliveryDate) : 'Standard'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Assigned / Quotes</span>
                  <span className="font-extrabold text-indigo-600 dark:text-indigo-400 mt-0.5 block">
                    {(selectedRfqForModal.assignedVendors || []).length} vendors / {(selectedRfqForModal.quotes || []).length} bids
                  </span>
                </div>
              </div>

              {/* Items Table */}
              <div>
                <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-2">
                  {strings.rfqModal.itemsTable}
                </h4>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      <tr>
                        <th className="p-2.5 font-semibold">Item & Specs</th>
                        <th className="p-2.5 font-semibold">Qty</th>
                        <th className="p-2.5 font-semibold">Target Price</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {(selectedRfqForModal.extractedEntities || []).map((item, idx) => (
                        <tr key={idx}>
                          <td className="p-2.5">
                            <span className="font-bold text-slate-900 dark:text-white block">{item.itemName}</span>
                            {item.technicalSpecs && (
                              <span className="text-[11px] text-slate-400">{item.technicalSpecs}</span>
                            )}
                          </td>
                          <td className="p-2.5 font-semibold">
                            {item.quantity} {item.unit || 'units'}
                          </td>
                          <td className="p-2.5 font-semibold">
                            {item.targetDate ? formatIndianDateTime(item.targetDate) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Quotations / Bids */}
              <div>
                <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-2">
                  {strings.rfqModal.assignedVendors}
                </h4>
                {(selectedRfqForModal.quotes || []).length === 0 ? (
                  <p className="text-slate-400 text-xs italic">Awaiting vendor quotation submissions.</p>
                ) : (
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        <tr>
                          <th className="p-2.5 font-semibold">Vendor</th>
                          <th className="p-2.5 font-semibold">Quoted Amount</th>
                          <th className="p-2.5 font-semibold">Delivery Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {selectedRfqForModal.quotes.map((q, idx) => (
                          <tr key={idx}>
                            <td className="p-2.5 font-semibold">{q.vendorName || `Vendor ${idx + 1}`}</td>
                            <td className="p-2.5 font-bold text-emerald-600 dark:text-emerald-400">
                              {formatCurrency(q.totalPrice || 0)}
                            </td>
                            <td className="p-2.5 text-slate-500">{q.leadTimeDays ? `${q.leadTimeDays} days` : 'Standard'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/40">
              {onSelectRFQ ? (
                <button
                  type="button"
                  onClick={() => {
                    const target = selectedRfqForModal;
                    setSelectedRfqForModal(null);
                    onSelectRFQ(target);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  <ExternalLink size={13} />
                  <span>{strings.rfqModal.viewFullDetails}</span>
                </button>
              ) : (
                <div />
              )}
              <button
                type="button"
                onClick={() => setSelectedRfqForModal(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-200 dark:bg-slate-700 rounded-lg hover:bg-slate-300 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------------ */}
      {/* MODAL 4: VIEW FULL EMAIL CONTENT MODAL */}
      {/* ------------------------------------------------------------------------ */}
      {selectedEmailModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedEmailModal(null);
          }}
        >
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Email Dispatch Details
              </h3>
              <button
                type="button"
                onClick={() => setSelectedEmailModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
              <p><strong>Subject:</strong> {selectedEmailModal.subject}</p>
              <p><strong>To:</strong> {selectedEmailModal.recipient}</p>
              {selectedEmailModal.sender && <p><strong>From:</strong> {selectedEmailModal.sender}</p>}
              <p><strong>Sent Date:</strong> {formatIndianDateTime(selectedEmailModal.sentAt)}</p>
              <p><strong>Status:</strong> <span className="text-emerald-600 font-semibold">{selectedEmailModal.deliveryStatus}</span></p>

              <div className="pt-2">
                <span className="font-semibold block mb-1">Message Body:</span>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 whitespace-pre-wrap text-slate-800 dark:text-slate-200 leading-relaxed">
                  {selectedEmailModal.message}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelectedEmailModal(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------------ */}
      {/* MODAL 5: VIEW PAYMENT DETAILS MODAL */}
      {/* ------------------------------------------------------------------------ */}
      {selectedPaymentModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedPaymentModal(null);
          }}
        >
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Payment Record Details
              </h3>
              <button
                type="button"
                onClick={() => setSelectedPaymentModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
              <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Invoice</span>
                  <span className="font-bold text-slate-900 dark:text-white">{selectedPaymentModal.invoiceNo}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Amount</span>
                  <span className="font-extrabold text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(selectedPaymentModal.amount)}
                  </span>
                </div>
              </div>

              <p><strong>Description:</strong> {selectedPaymentModal.description}</p>
              <p><strong>Subscription Plan:</strong> {selectedPaymentModal.subscriptionPlan}</p>
              <p><strong>Gateway:</strong> {selectedPaymentModal.gateway}</p>
              <p><strong>Channel / Method:</strong> {selectedPaymentModal.paymentMethod}</p>
              <p><strong>Status:</strong> <span className="font-semibold text-emerald-600">{selectedPaymentModal.status}</span></p>
              <p><strong>Date:</strong> {formatIndianDateTime(selectedPaymentModal.transactionDate || selectedPaymentModal.date)}</p>
            </div>

            <div className="flex items-center justify-between pt-2">
              {selectedPaymentModal.receiptUrl ? (
                <a
                  href={selectedPaymentModal.receiptUrl}
                  download
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:underline"
                >
                  <Download size={13} />
                  <span>Download Invoice</span>
                </a>
              ) : (
                <div />
              )}
              <button
                type="button"
                onClick={() => setSelectedPaymentModal(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200"
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