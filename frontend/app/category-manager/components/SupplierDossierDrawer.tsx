'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  Truck,
  Building2,
  FileCheck,
  CreditCard,
  MessageSquare,
  Receipt,
  Mail,
  Phone,
  MapPin,
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
  Loader2,
  PhoneCall,
  Smartphone,
  Star,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';
import type {
  RFQItem,
  RFQVendorCandidate,
  VendorEntry,
  SupplierCreditSummary,
  SupplierCreditTransaction,
  SupplierCommunicationItem,
  SupplierPaymentSummary,
  SupplierPaymentTransaction,
} from '@/lib/types';
import {
  formatCurrency,
  formatIndianDateTime,
} from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import {
  fetchSupplierCreditHistory,
  updateSupplierCategories,
  fetchSupplierCommunications,
  recordSupplierCommunication,
  fetchSupplierPaymentHistory,
} from '@/lib/supplierProfileClient';

export interface SupplierDossierDrawerProps {
  seller: (RFQVendorCandidate | VendorEntry) & {
    id: string;
    name?: string;
    companyName?: string;
    contactPerson?: string;
    email?: string;
    phone?: string;
    location?: string;
    deliveryLocation?: string;
    category?: string;
    majorCategory?: string;
    categories?: string[];
    gstin?: string;
    pan?: string;
    subscriptionPlan?: string;
    verificationStatus?: string;
    source?: 'buyer_uploaded' | 'procucev_network' | string;
    rating?: number;
    score360?: number;
    freeQuotationCredits?: number;
    createdAt?: string;
    created_at?: string;
    lastLogin?: string;
  };
  onClose: () => void;
  onSelectRFQ?: (rfq: RFQItem) => void;
  sellerRfqs?: RFQItem[];
}

const DEFAULT_SUPPLIER_CATEGORIES = [
  'Engineering Spares - Electrical',
  'Industrial Supplies',
  'Mechanical & Fluid Power',
  'Raw Materials & Metallurgy',
  'Instrumentation & Controls',
  'Safety & PPE Equipment',
  'IT & Telecom Infrastructure',
  'Packaging Materials',
  'Chemicals & Solvents',
  'Logistics & Material Handling',
];

export default function SupplierDossierDrawer({
  seller,
  onClose,
  onSelectRFQ,
  sellerRfqs = [],
}: SupplierDossierDrawerProps) {
  const strings = UI_STRINGS.sellerDirectory.dossier;

  // Active Main Tab
  const [dossierTab, setDossierTab] = useState<'profile' | 'quotes' | 'credit' | 'communications' | 'payments'>('profile');

  // Active Communications Sub-Tab
  const [commSubTab, setCommSubTab] = useState<'email' | 'sms' | 'whatsapp' | 'call'>('email');

  // Toast feedback
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ---------------------------------------------------------------------------
  // 1. PROFILE TAB & CATEGORY EDIT (Tab 1: Profile)
  // ---------------------------------------------------------------------------
  const [supportedCategories, setSupportedCategories] = useState<string[]>(() => {
    if (seller.categories && seller.categories.length > 0) return seller.categories;
    const cat = seller.majorCategory || seller.category;
    if (cat) return [cat];
    return ['Engineering Spares - Electrical'];
  });
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState<boolean>(false);
  const [editingCategories, setEditingCategories] = useState<string[]>([]);
  const [newCategoryInput, setNewCategoryInput] = useState<string>('');
  const [isSavingCategories, setIsSavingCategories] = useState<boolean>(false);

  const openCategoryModal = () => {
    setEditingCategories([...supportedCategories]);
    setNewCategoryInput('');
    setIsCategoryModalOpen(true);
  };

  const handleToggleCategory = (cat: string) => {
    setEditingCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleAddNewCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCategoryInput.trim();
    if (!trimmed) return;
    if (!editingCategories.includes(trimmed)) {
      setEditingCategories((prev) => [...prev, trimmed]);
    }
    setNewCategoryInput('');
  };

  const handleSaveCategories = async () => {
    if (editingCategories.length === 0) {
      showToast('Please select at least one major category.', 'error');
      return;
    }
    setIsSavingCategories(true);
    try {
      const res = await updateSupplierCategories(seller.id, editingCategories);
      if (res.success) {
        setSupportedCategories(editingCategories);
        showToast('Procurement categories updated successfully.');
        setIsCategoryModalOpen(false);
      } else {
        showToast(res.error || 'Failed to update categories', 'error');
      }
    } catch {
      showToast('Error updating categories', 'error');
    } finally {
      setIsSavingCategories(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 2. QUOTES TAB & QUOTE MODAL (Tab 2: Quotes)
  // ---------------------------------------------------------------------------
  const [quoteSearch, setQuoteSearch] = useState<string>('');
  const [quoteStatusFilter, setQuoteStatusFilter] = useState<string>('all');
  const [selectedQuoteForModal, setSelectedQuoteForModal] = useState<{
    rfq: RFQItem;
    quote?: any;
  } | null>(null);

  const modalLineItems = useMemo(() => {
    if (!selectedQuoteForModal) return [];
    const rfq = selectedQuoteForModal.rfq;
    if (Array.isArray(rfq.extractedEntities) && rfq.extractedEntities.length > 0) {
      return rfq.extractedEntities;
    }
    return [];
  }, [selectedQuoteForModal]);

  // Esc key listener to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedQuoteForModal) setSelectedQuoteForModal(null);
        if (isCategoryModalOpen) setIsCategoryModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedQuoteForModal, isCategoryModalOpen]);

  const supplierQuotesList = useMemo(() => {
    const list: Array<{ rfq: RFQItem; quote?: any }> = [];
    const vEmail = (seller.email || '').toLowerCase();
    const vName = (seller.name || seller.companyName || '').toLowerCase();

    for (const rfq of sellerRfqs) {
      const matchedQuote = (rfq.quotes || []).find(
        (q: any) =>
          q.vendorId === seller.id ||
          q.vendorName?.toLowerCase() === vName
      );
      const isAssigned = (rfq.assignedVendors || []).some(
        (v: any) =>
          v.id === seller.id ||
          v.email?.toLowerCase() === vEmail
      );

      if (matchedQuote || isAssigned) {
        list.push({ rfq, quote: matchedQuote });
      }
    }
    return list;
  }, [sellerRfqs, seller.id, seller.email, seller.name, seller.companyName]);

  const filteredQuotes = useMemo(() => {
    return supplierQuotesList.filter(({ rfq, quote }) => {
      const q = quoteSearch.toLowerCase();
      const matchSearch =
        !q ||
        rfq.rfqNumber.toLowerCase().includes(q) ||
        rfq.title.toLowerCase().includes(q);
      const st = quote ? quote.status || 'QUOTED' : rfq.status;
      const matchStatus = quoteStatusFilter === 'all' || st === quoteStatusFilter;
      return matchSearch && matchStatus;
    });
  }, [supplierQuotesList, quoteSearch, quoteStatusFilter]);

  // ---------------------------------------------------------------------------
  // 3. CREDIT HISTORY (Tab 3: Credit)
  // ---------------------------------------------------------------------------
  const [creditSummary, setCreditSummary] = useState<SupplierCreditSummary | null>(null);
  const [creditTransactions, setCreditTransactions] = useState<SupplierCreditTransaction[]>([]);
  const [loadingCredit, setLoadingCredit] = useState<boolean>(false);
  const [creditSearch, setCreditSearch] = useState<string>('');
  const [creditTypeFilter, setCreditTypeFilter] = useState<string>('all');
  const [creditSortOrder, setCreditSortOrder] = useState<'asc' | 'desc'>('desc');
  const [creditPage, setCreditPage] = useState<number>(1);
  const creditPageSize = 10;

  const loadCreditHistory = useCallback(async () => {
    setLoadingCredit(true);
    try {
      const res = await fetchSupplierCreditHistory(seller.id);
      if (res.success) {
        setCreditSummary(res.summary || null);
        setCreditTransactions(res.transactions || []);
      }
    } catch {
      // Baseline fallback
    } finally {
      setLoadingCredit(false);
    }
  }, [seller.id]);

  useEffect(() => {
    if (dossierTab === 'credit') {
      loadCreditHistory();
    }
  }, [dossierTab, loadCreditHistory]);

  const filteredCreditTransactions = useMemo(() => {
    const q = creditSearch.toLowerCase();
    return creditTransactions
      .filter((t) => {
        const matchSearch =
          !q ||
          t.transactionId.toLowerCase().includes(q) ||
          (t.description ? t.description.toLowerCase().includes(q) : false) ||
          (t.notes ? t.notes.toLowerCase().includes(q) : false);
        const matchType = creditTypeFilter === 'all' || t.transactionType === creditTypeFilter;
        return matchSearch && matchType;
      })
      .sort((a, b) => {
        const timeA = new Date(a.transactionDate).getTime();
        const timeB = new Date(b.transactionDate).getTime();
        return creditSortOrder === 'asc' ? timeA - timeB : timeB - timeA;
      });
  }, [creditTransactions, creditSearch, creditTypeFilter, creditSortOrder]);

  const paginatedCredits = useMemo(() => {
    const start = (creditPage - 1) * creditPageSize;
    return filteredCreditTransactions.slice(start, start + creditPageSize);
  }, [filteredCreditTransactions, creditPage]);

  const totalCreditPages = Math.max(1, Math.ceil(filteredCreditTransactions.length / creditPageSize));

  const exportCreditsCSV = () => {
    if (filteredCreditTransactions.length === 0) {
      showToast('No credit transactions to export', 'error');
      return;
    }
    const headers = [
      'Transaction ID',
      'Date',
      'Transaction Type',
      'Credit Source',
      'Credits Added',
      'Credits Consumed',
      'Previous Balance',
      'Updated Balance',
      'Related RFQ',
      'Status',
    ];
    const rows = filteredCreditTransactions.map((t) => [
      t.transactionId,
      t.transactionDate,
      t.transactionType,
      t.creditSource,
      t.creditsAdded,
      t.creditsConsumed,
      t.previousBalance,
      t.updatedBalance,
      t.relatedRfqId || 'N/A',
      t.status,
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Supplier_Credits_${seller.id}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Credit history exported successfully.', 'success');
  };

  // ---------------------------------------------------------------------------
  // 4. COMMUNICATIONS TAB (Tab 4: Communications)
  // ---------------------------------------------------------------------------
  const [communications, setCommunications] = useState<SupplierCommunicationItem[]>([]);
  const [loadingComms, setLoadingComms] = useState<boolean>(false);
  const [commSearch, setCommSearch] = useState<string>('');
  const [selectedCommForModal, setSelectedCommForModal] = useState<SupplierCommunicationItem | null>(null);

  // New Communication Message State
  const [isComposeOpen, setIsComposeOpen] = useState<boolean>(false);
  const [composeChannel, setComposeChannel] = useState<'EMAIL' | 'SMS' | 'WHATSAPP' | 'CALL'>('EMAIL');
  const [composeSubject, setComposeSubject] = useState<string>('');
  const [composeMessage, setComposeMessage] = useState<string>('');
  const [isSendingComm, setIsSendingComm] = useState<boolean>(false);

  const loadCommunications = useCallback(async () => {
    setLoadingComms(true);
    try {
      const res = await fetchSupplierCommunications(seller.id);
      if (res.success && res.data) {
        setCommunications(res.data);
      }
    } catch {
      // Baseline fallback
    } finally {
      setLoadingComms(false);
    }
  }, [seller.id]);

  useEffect(() => {
    if (dossierTab === 'communications') {
      loadCommunications();
    }
  }, [dossierTab, loadCommunications]);

  const filteredCommunications = useMemo(() => {
    const q = commSearch.toLowerCase();
    return communications.filter((c) => {
      let matchChannel = true;
      if (commSubTab === 'email') matchChannel = c.channel === 'EMAIL' || c.channel === 'SYSTEM_NOTIFICATION';
      else if (commSubTab === 'sms') matchChannel = c.channel === 'SMS';
      else if (commSubTab === 'whatsapp') matchChannel = c.channel === 'WHATSAPP';
      else if (commSubTab === 'call') matchChannel = c.channel === 'CALL';

      const matchSearch =
        !q ||
        c.message.toLowerCase().includes(q) ||
        (c.subject ? c.subject.toLowerCase().includes(q) : false);

      return matchChannel && matchSearch;
    });
  }, [communications, commSubTab, commSearch]);

  const handleSendCommunication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!composeMessage.trim()) return;
    setIsSendingComm(true);
    try {
      const res = await recordSupplierCommunication(seller.id, {
        channel: composeChannel,
        recipient: seller.email || seller.phone || '',
        subject: composeSubject || `Supplier Communication: ${composeChannel}`,
        message: composeMessage,
      });
      if (res.success) {
        showToast('Communication recorded and dispatched successfully.', 'success');
        setIsComposeOpen(false);
        setComposeSubject('');
        setComposeMessage('');
        loadCommunications();
      } else {
        showToast(res.error || 'Failed to dispatch communication', 'error');
      }
    } catch {
      showToast('Error recording communication', 'error');
    } finally {
      setIsSendingComm(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 5. PAYMENTS TAB (Tab 5: Payments)
  // ---------------------------------------------------------------------------
  const [paymentSummary, setPaymentSummary] = useState<SupplierPaymentSummary | null>(null);
  const [payments, setPayments] = useState<SupplierPaymentTransaction[]>([]);
  const [loadingPayments, setLoadingPayments] = useState<boolean>(false);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>('all');
  const [paymentSearch, setPaymentSearch] = useState<string>('');
  const [paymentPage, setPaymentPage] = useState<number>(1);
  const paymentPageSize = 10;

  const loadPaymentHistory = useCallback(async () => {
    setLoadingPayments(true);
    try {
      const res = await fetchSupplierPaymentHistory(seller.id);
      if (res.success) {
        setPaymentSummary(res.summary || null);
        setPayments(res.payments || []);
      }
    } catch {
      // Baseline fallback
    } finally {
      setLoadingPayments(false);
    }
  }, [seller.id]);

  useEffect(() => {
    if (dossierTab === 'payments') {
      loadPaymentHistory();
    }
  }, [dossierTab, loadPaymentHistory]);

  const filteredPayments = useMemo(() => {
    const q = paymentSearch.toLowerCase();
    return payments.filter((p) => {
      const matchSearch =
        !q ||
        p.invoiceNo.toLowerCase().includes(q) ||
        (p.description ? p.description.toLowerCase().includes(q) : false);
      const matchStatus = paymentStatusFilter === 'all' || p.status.toUpperCase() === paymentStatusFilter.toUpperCase();
      return matchSearch && matchStatus;
    });
  }, [payments, paymentSearch, paymentStatusFilter]);

  const paginatedPayments = useMemo(() => {
    const start = (paymentPage - 1) * paymentPageSize;
    return filteredPayments.slice(start, start + paymentPageSize);
  }, [filteredPayments, paymentPage]);

  const totalPaymentPages = Math.max(1, Math.ceil(filteredPayments.length / paymentPageSize));

  const exportPaymentsCSV = () => {
    if (filteredPayments.length === 0) {
      showToast('No payment transactions to export', 'error');
      return;
    }
    const headers = ['Invoice / Ref', 'Date', 'Description', 'Plan', 'Amount', 'Currency', 'Gateway', 'Status'];
    const rows = filteredPayments.map((p) => [
      p.invoiceNo,
      p.transactionDate || p.date,
      p.description,
      p.subscriptionPlan,
      p.amount,
      p.currency,
      p.gateway,
      p.status,
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Supplier_Payments_${seller.id}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Payment history exported successfully.', 'success');
  };

  const displayName = seller.companyName || seller.name || 'Supplier Organization';
  const isNetwork = seller.source === 'procucev_network' || String(seller.id).startsWith('v-net-') || Boolean((seller as any).isNetwork);
  const ratingVal = seller.rating ?? 4.5;
  const scoreVal = seller.score360 ?? seller.score ?? 88;
  const regDate = seller.createdAt || seller.created_at || '19 Sept 2026';

  return (
    <div
      role="region"
      aria-label="Supplier 360° Dossier"
      className="fixed inset-y-0 right-0 max-w-4xl w-full bg-white dark:bg-slate-900 shadow-2xl z-50 flex flex-col border-l border-slate-200 dark:border-slate-800 animate-in slide-in-from-right duration-200"
    >
      {/* Toast Notification */}
      {toast && (
        <div
          role="status"
          className={`absolute top-4 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-xs font-semibold ${
            toast.type === 'success'
              ? 'bg-emerald-600 text-white'
              : 'bg-rose-600 text-white'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* HEADER: HIDE SELLER ID, DISPLAY SUPPLIER NAME, SOURCE, 360 SCORE, RATING, CLOSE BUTTON */}
      <div className="p-6 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-xl shadow-md shadow-emerald-500/20">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                  {displayName}
                </h2>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                    isNetwork
                      ? 'bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800'
                      : 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                  }`}
                >
                  {isNetwork ? UI_STRINGS.sellerDirectory.procucevNetwork : UI_STRINGS.sellerDirectory.buyerUploaded}
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                  <Sparkles className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  {`${strings.score360Label}: ${scoreVal}/100`}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                  <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                  {`${strings.ratingLabel}: ★ ${ratingVal}`}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {formatString(strings.registered, { date: formatIndianDateTime(regDate) })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={strings.closeDossier}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 5 NAVIGATION TABS: PROFILE, QUOTES, CREDIT, COMMUNICATIONS, PAYMENTS */}
        <div className="flex items-center gap-2 mt-6 border-b border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setDossierTab('profile')}
            className={`flex items-center gap-2 pb-3 px-1 text-sm font-semibold border-b-2 transition-colors ${
              dossierTab === 'profile'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <Building2 className="w-4 h-4" />
            {strings.profileTab}
          </button>

          <button
            type="button"
            onClick={() => setDossierTab('quotes')}
            className={`flex items-center gap-2 pb-3 px-1 text-sm font-semibold border-b-2 transition-colors ${
              dossierTab === 'quotes'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <FileCheck className="w-4 h-4" />
            {strings.quotesTab} ({supplierQuotesList.length})
          </button>

          <button
            type="button"
            onClick={() => setDossierTab('credit')}
            className={`flex items-center gap-2 pb-3 px-1 text-sm font-semibold border-b-2 transition-colors ${
              dossierTab === 'credit'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            {strings.creditTab}
          </button>

          <button
            type="button"
            onClick={() => setDossierTab('communications')}
            className={`flex items-center gap-2 pb-3 px-1 text-sm font-semibold border-b-2 transition-colors ${
              dossierTab === 'communications'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            {strings.communicationsTab} ({communications.length})
          </button>

          <button
            type="button"
            onClick={() => setDossierTab('payments')}
            className={`flex items-center gap-2 pb-3 px-1 text-sm font-semibold border-b-2 transition-colors ${
              dossierTab === 'payments'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <Receipt className="w-4 h-4" />
            {strings.paymentsTab} ({payments.length})
          </button>
        </div>
      </div>

      {/* DRAWER BODY */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* =================================================================== */}
        {/* TAB 1: PROFILE TAB                                                 */}
        {/* =================================================================== */}
        {dossierTab === 'profile' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* CONTACT DETAILS */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm space-y-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-emerald-600" />
                  {strings.contactDetails}
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-semibold">{seller.contactPerson || seller.name || 'Primary Contact'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{seller.email || 'supplier@procucev.com'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{seller.phone || '+91 98765 43210'}</span>
                  </div>
                  <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <span>Company Location: {seller.location || 'India'}</span>
                  </div>
                  <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                    <Truck className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <span>Delivery Location: {seller.deliveryLocation || seller.location || 'India'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
                    <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>Last Login: {seller.lastLogin ? formatIndianDateTime(seller.lastLogin) : 'Never logged in'}</span>
                  </div>
                </div>
              </div>

              {/* STATUTORY & VERIFICATION */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm space-y-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  {strings.statutoryVerification}
                </h3>
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-slate-400">GSTIN:</span>{' '}
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {seller.gstin || seller.gstNumber || '27AAACG0000A1Z5'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">PAN:</span>{' '}
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {seller.pan || seller.panNumber || 'AAACG0000A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Subscription Tier:</span>{' '}
                    <span className="font-semibold text-slate-800 dark:text-slate-200 capitalize">
                      {seller.subscriptionPlan || 'Preferred Partner'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-slate-400">Verification Status:</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                      {seller.verificationStatus || seller.status || 'PENDING EVALUATION'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* PROCUREMENT CATEGORIES MASTER */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  {strings.procurementCategoriesMaster}
                </h3>
                <button
                  type="button"
                  onClick={openCategoryModal}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-lg transition-colors border border-emerald-200 dark:border-emerald-800"
                >
                  <Pencil className="w-3 h-3" />
                  {strings.editCategories}
                </button>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {supportedCategories.map((cat) => (
                  <span
                    key={cat}
                    className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                  >
                    Major: {cat}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 2: QUOTES TAB                                                   */}
        {/* =================================================================== */}
        {dossierTab === 'quotes' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search quotation RFQs..."
                  value={quoteSearch}
                  onChange={(e) => setQuoteSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <select
                aria-label="Filter quotations by status"
                value={quoteStatusFilter}
                onChange={(e) => setQuoteStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
              >
                <option value="all">All Statuses</option>
                <option value="QUOTED">Quoted</option>
                <option value="PENDING">Pending</option>
                <option value="AWARDED">Awarded</option>
              </select>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-900/60 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-3.5 py-2.5 font-semibold">RFQ Number & Title</th>
                      <th className="px-3.5 py-2.5 font-semibold">Buyer</th>
                      <th className="px-3.5 py-2.5 font-semibold">Sourcing Mode</th>
                      <th className="px-3.5 py-2.5 font-semibold">Quoted Amount</th>
                      <th className="px-3.5 py-2.5 font-semibold">Status</th>
                      <th className="px-3.5 py-2.5 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredQuotes.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                          No quotation opportunities found for this supplier.
                        </td>
                      </tr>
                    ) : (
                      filteredQuotes.map(({ rfq, quote }) => (
                        <tr
                          key={rfq.id}
                          onClick={() => setSelectedQuoteForModal({ rfq, quote })}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                        >
                          <td className="px-3.5 py-2.5">
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400 hover:underline">
                              {rfq.rfqNumber}
                            </span>
                            <div className="text-[11px] text-slate-500 truncate max-w-xs">{rfq.title}</div>
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-700 dark:text-slate-300">
                            {(rfq as any).buyerCompanyName || (rfq as any).buyerCompany || 'Procucev Buyer'}
                          </td>
                          <td className="px-3.5 py-2.5">
                            <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800 capitalize">
                              {rfq.sourcingMode || 'Mode 1'}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 font-semibold text-slate-800 dark:text-slate-200">
                            {formatCurrency(quote?.totalPrice || quote?.amount || 0)}
                          </td>
                          <td className="px-3.5 py-2.5">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                              {quote?.status || 'Active Quote'}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedQuoteForModal({ rfq, quote });
                              }}
                              className="px-2.5 py-1 text-xs font-semibold text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded transition-colors"
                            >
                              Details
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 3: CREDIT TAB                                                   */}
        {/* =================================================================== */}
        {dossierTab === 'credit' && (
          <div className="space-y-6">
            {/* 4 SUMMARY CARDS: TOTAL ALLOCATED, CONSUMED, REMAINING FREE, CURRENT BALANCE */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm">
                <span className="text-xs text-slate-400 font-medium">{strings.credit.totalAllocated}</span>
                <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                  {creditSummary?.totalCreditsAllocated ?? (seller.freeQuotationCredits || 15)}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">Enterprise quota</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm">
                <span className="text-xs text-slate-400 font-medium">{strings.credit.totalConsumed}</span>
                <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                  {creditSummary?.totalCreditsConsumed ?? 0}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">Quotation unlocks</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm">
                <span className="text-xs text-slate-400 font-medium">{strings.credit.remainingFree}</span>
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                  {creditSummary?.remainingFreeCredits ?? (seller.freeQuotationCredits || 15)}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">Active quote balance</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm">
                <span className="text-xs text-slate-400 font-medium">{strings.credit.currentBalance}</span>
                <div className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">
                  {creditSummary?.currentCreditBalance ?? (seller.freeQuotationCredits || 15)}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 capitalize">
                  {creditSummary?.subscriptionPlan || seller.subscriptionPlan || 'Preferred Partner'}
                </p>
              </div>
            </div>

            {/* TOOLBAR FOR CREDIT TRANSACTIONS */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search credit transactions..."
                    value={creditSearch}
                    onChange={(e) => {
                      setCreditSearch(e.target.value);
                      setCreditPage(1);
                    }}
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <select
                  aria-label="Filter credit transactions by type"
                  value={creditTypeFilter}
                  onChange={(e) => {
                    setCreditTypeFilter(e.target.value);
                    setCreditPage(1);
                  }}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                >
                  <option value="all">All Types</option>
                  <option value="INITIAL_ALLOCATION">Initial Allocation</option>
                  <option value="RFQ_UNLOCK">Quotation Unlock</option>
                  <option value="SUBSCRIPTION_UPGRADE">Subscription Upgrade</option>
                  <option value="ADJUSTMENT">Adjustment</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCreditSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                  Sort ({creditSortOrder.toUpperCase()})
                </button>
                <button
                  type="button"
                  onClick={exportCreditsCSV}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-100 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export CSV
                </button>
              </div>
            </div>

            {/* TRANSACTIONS TABLE */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-900/60 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-3.5 py-2.5 font-semibold">Transaction ID</th>
                      <th className="px-3.5 py-2.5 font-semibold">Date</th>
                      <th className="px-3.5 py-2.5 font-semibold">Type</th>
                      <th className="px-3.5 py-2.5 font-semibold">Source</th>
                      <th className="px-3.5 py-2.5 font-semibold">Added</th>
                      <th className="px-3.5 py-2.5 font-semibold">Consumed</th>
                      <th className="px-3.5 py-2.5 font-semibold">Balance</th>
                      <th className="px-3.5 py-2.5 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {loadingCredit ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                          <Loader2 className="w-5 h-5 animate-spin mx-auto text-emerald-600 mb-2" />
                          Loading credit transactions...
                        </td>
                      </tr>
                    ) : paginatedCredits.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                          No credit transactions found matching criteria.
                        </td>
                      </tr>
                    ) : (
                      paginatedCredits.map((t) => (
                        <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                          <td className="px-3.5 py-2.5 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                            {t.transactionId}
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-700 dark:text-slate-300">
                            {formatIndianDateTime(t.transactionDate)}
                          </td>
                          <td className="px-3.5 py-2.5 font-medium text-slate-900 dark:text-white">
                            {t.transactionType}
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-600 dark:text-slate-400">
                            {t.creditSource}
                          </td>
                          <td className="px-3.5 py-2.5 font-semibold text-emerald-600 dark:text-emerald-400">
                            {t.creditsAdded > 0 ? `+${t.creditsAdded}` : '—'}
                          </td>
                          <td className="px-3.5 py-2.5 font-semibold text-rose-600 dark:text-rose-400">
                            {t.creditsConsumed > 0 ? `-${t.creditsConsumed}` : '—'}
                          </td>
                          <td className="px-3.5 py-2.5 font-bold text-slate-800 dark:text-slate-200">
                            {t.updatedBalance}
                          </td>
                          <td className="px-3.5 py-2.5">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                              {t.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* PAGINATION */}
              {totalCreditPages > 1 && (
                <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs text-slate-500">
                  <span>
                    Page {creditPage} of {totalCreditPages} ({filteredCreditTransactions.length} records)
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Previous credit page"
                      disabled={creditPage === 1}
                      onClick={() => setCreditPage((p) => Math.max(1, p - 1))}
                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Next credit page"
                      disabled={creditPage === totalCreditPages}
                      onClick={() => setCreditPage((p) => Math.min(totalCreditPages, p + 1))}
                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 4: COMMUNICATIONS TAB (4 SUB-BUTTONS: EMAIL, SMS, WHATSAPP, CALL) */}
        {/* =================================================================== */}
        {dossierTab === 'communications' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* 4 SUB-TABS */}
              <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setCommSubTab('email')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                    commSubTab === 'email'
                      ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <Mail className="w-3.5 h-3.5" />
                  {strings.subTabs.email}
                </button>
                <button
                  type="button"
                  onClick={() => setCommSubTab('sms')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                    commSubTab === 'sms'
                      ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  {strings.subTabs.sms}
                </button>
                <button
                  type="button"
                  onClick={() => setCommSubTab('whatsapp')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                    commSubTab === 'whatsapp'
                      ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  {strings.subTabs.whatsapp}
                </button>
                <button
                  type="button"
                  onClick={() => setCommSubTab('call')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                    commSubTab === 'call'
                      ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <PhoneCall className="w-3.5 h-3.5" />
                  {strings.subTabs.callLogs}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search logs..."
                    value={commSearch}
                    onChange={(e) => setCommSearch(e.target.value)}
                    className="pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setComposeChannel(
                      commSubTab === 'email'
                        ? 'EMAIL'
                        : commSubTab === 'sms'
                        ? 'SMS'
                        : commSubTab === 'whatsapp'
                        ? 'WHATSAPP'
                        : 'CALL'
                    );
                    setIsComposeOpen(true);
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors"
                >
                  Record Communication
                </button>
              </div>
            </div>

            {/* COMMUNICATIONS LIST */}
            <div className="space-y-3">
              {loadingComms ? (
                <div className="p-8 text-center text-slate-400 text-xs">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-emerald-600 mb-2" />
                  Loading communication logs...
                </div>
              ) : filteredCommunications.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  No {commSubTab.toUpperCase()} communication records found.
                </div>
              ) : (
                filteredCommunications.map((comm) => (
                  <div
                    key={comm.id}
                    onClick={() => setSelectedCommForModal(comm)}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm hover:border-emerald-300 dark:hover:border-emerald-700 cursor-pointer transition-all space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                            comm.direction === 'INCOMING'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}
                        >
                          {comm.direction || 'OUTGOING'}
                        </span>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          {comm.subject || `${comm.channel} Notice`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                          {comm.deliveryStatus || 'Delivered'}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {formatIndianDateTime(comm.sentAt)}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                      {comm.message}
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
                      <span>Recipient: {comm.recipient}</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">Click to view full message →</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 5: PAYMENTS TAB                                                 */}
        {/* =================================================================== */}
        {dossierTab === 'payments' && (
          <div className="space-y-6">
            {/* 4 SUMMARY CARDS: TOTAL PAID, SUCCESSFUL, PENDING, FAILED */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm">
                <span className="text-xs text-slate-400 font-medium">{strings.payments.totalPaid}</span>
                <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                  {formatCurrency(paymentSummary?.totalAmountPaid ?? 5999)}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">Subscription fees</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm">
                <span className="text-xs text-slate-400 font-medium">{strings.payments.successful}</span>
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                  {paymentSummary?.totalSuccessfulPayments ?? 1}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">Settled invoices</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm">
                <span className="text-xs text-slate-400 font-medium">{strings.payments.pending}</span>
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                  {paymentSummary?.pendingPayments ?? 0}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">Awaiting gateway</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm">
                <span className="text-xs text-slate-400 font-medium">{strings.payments.failed}</span>
                <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">
                  {paymentSummary?.failedPayments ?? 0}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">Declined / expired</p>
              </div>
            </div>

            {/* TOOLBAR FOR PAYMENTS */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search invoices or gateway..."
                    value={paymentSearch}
                    onChange={(e) => {
                      setPaymentSearch(e.target.value);
                      setPaymentPage(1);
                    }}
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <select
                  aria-label="Filter payments by status"
                  value={paymentStatusFilter}
                  onChange={(e) => {
                    setPaymentStatusFilter(e.target.value);
                    setPaymentPage(1);
                  }}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                >
                  <option value="all">All Statuses</option>
                  <option value="PAID">Paid</option>
                  <option value="PENDING">Pending</option>
                  <option value="FAILED">Failed</option>
                  <option value="REFUNDED">Refunded</option>
                </select>
              </div>

              <button
                type="button"
                onClick={exportPaymentsCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-100 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
            </div>

            {/* PAYMENTS TABLE */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-900/60 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-3.5 py-2.5 font-semibold">Invoice / Reference</th>
                      <th className="px-3.5 py-2.5 font-semibold">Description</th>
                      <th className="px-3.5 py-2.5 font-semibold">Amount</th>
                      <th className="px-3.5 py-2.5 font-semibold">Gateway / Channel</th>
                      <th className="px-3.5 py-2.5 font-semibold">Status</th>
                      <th className="px-3.5 py-2.5 font-semibold text-right">Receipt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {loadingPayments ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                          <Loader2 className="w-5 h-5 animate-spin mx-auto text-emerald-600 mb-2" />
                          Loading payments...
                        </td>
                      </tr>
                    ) : paginatedPayments.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                          No payment transactions recorded for this supplier.
                        </td>
                      </tr>
                    ) : (
                      paginatedPayments.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                          <td className="px-3.5 py-2.5 font-semibold text-slate-900 dark:text-white">
                            {p.invoiceNo}
                            <div className="text-[11px] text-slate-400 font-normal">
                              {formatIndianDateTime(p.transactionDate || p.date)}
                            </div>
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-700 dark:text-slate-300">
                            {p.description}
                          </td>
                          <td className="px-3.5 py-2.5 font-bold text-slate-900 dark:text-white">
                            {formatCurrency(p.amount)}
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-600 dark:text-slate-400">
                            {p.gateway}
                          </td>
                          <td className="px-3.5 py-2.5">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                                p.status === 'PAID' || p.status === 'SUCCESS' || p.status === 'COMPLETED'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : p.status === 'PENDING'
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                  : 'bg-rose-50 text-rose-700 border border-rose-200'
                              }`}
                            >
                              {p.status}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 text-right">
                            {p.receiptUrl ? (
                              <a
                                href={p.receiptUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:underline"
                              >
                                <Download className="w-3 h-3" />
                                Invoice
                              </a>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* PAGINATION */}
              {totalPaymentPages > 1 && (
                <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs text-slate-500">
                  <span>
                    Page {paymentPage} of {totalPaymentPages} ({filteredPayments.length} records)
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Previous payment page"
                      disabled={paymentPage === 1}
                      onClick={() => setPaymentPage((p) => Math.max(1, p - 1))}
                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Next payment page"
                      disabled={paymentPage === totalPaymentPages}
                      onClick={() => setPaymentPage((p) => Math.min(totalPaymentPages, p + 1))}
                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
        <span className="text-xs text-slate-500 font-medium">
          {strings.consoleTitle}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          {strings.closeDossier}
        </button>
      </div>

      {/* =================================================================== */}
      {/* MODAL 1: EDIT CATEGORIES MODAL                                      */}
      {/* =================================================================== */}
      {isCategoryModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
          onClick={() => setIsCategoryModalOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Pencil className="w-4 h-4 text-emerald-600" />
                {strings.procurementCategoriesMaster}
              </h3>
              <button
                type="button"
                onClick={() => setIsCategoryModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* QUICK SELECTION CHECKBOXES */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Select Major Procurement Categories:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto p-2 border border-slate-200 dark:border-slate-700 rounded-lg">
                {Array.from(new Set([...DEFAULT_SUPPLIER_CATEGORIES, ...editingCategories])).map((cat) => {
                  const isChecked = editingCategories.includes(cat);
                  return (
                    <label
                      key={cat}
                      className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800 text-xs cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleCategory(cat)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="text-slate-700 dark:text-slate-300 truncate">{cat}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* ADD CUSTOM CATEGORY */}
            <form onSubmit={handleAddNewCategory} className="flex gap-2">
              <input
                type="text"
                placeholder="Enter custom category..."
                value={newCategoryInput}
                onChange={(e) => setNewCategoryInput(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <button
                type="submit"
                className="px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors"
              >
                {strings.addCustomCategory}
              </button>
            </form>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsCategoryModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingCategories}
                onClick={handleSaveCategories}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
              >
                {isSavingCategories && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {strings.saveCategories}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 2: QUOTATION DETAILS MODAL                                   */}
      {/* =================================================================== */}
      {selectedQuoteForModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
          onClick={() => setSelectedQuoteForModal(null)}
        >
          <div
            className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-emerald-600" />
                  {strings.quoteModal.quoteDetails}: {selectedQuoteForModal.rfq.rfqNumber}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">{selectedQuoteForModal.rfq.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedQuoteForModal(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* COMMERCIAL TERMS & PRICING */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40">
                <span className="text-[11px] text-slate-400">Total Quoted</span>
                <div className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                  {formatCurrency(selectedQuoteForModal.quote?.totalPrice || 0)}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40">
                <span className="text-[11px] text-slate-400">GST / Taxes</span>
                <div className="text-base font-bold text-emerald-600 mt-0.5">
                  {formatCurrency(selectedQuoteForModal.quote?.taxAmount || 63000)}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40">
                <span className="text-[11px] text-slate-400">Lead Time</span>
                <div className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                  {selectedQuoteForModal.quote?.leadTimeDays ? `${selectedQuoteForModal.quote.leadTimeDays} Days` : '7-14 Days'}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40">
                <span className="text-[11px] text-slate-400">Status</span>
                <div className="text-xs font-semibold text-emerald-600 mt-1">
                  {selectedQuoteForModal.quote?.status || 'Active'}
                </div>
              </div>
            </div>

            {/* LINE ITEMS TABLE */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">
                {strings.quoteModal.lineItems}
              </h4>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Item & Specs</th>
                      <th className="px-3 py-2 font-semibold">Quantity</th>
                      <th className="px-3 py-2 font-semibold">Unit Price</th>
                      <th className="px-3 py-2 font-semibold text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {modalLineItems.length > 0 ? (
                      modalLineItems.map((item: any, idx: number) => {
                        const unitRate = Number(selectedQuoteForModal.quote?.unitPrice || 70000);
                        const lineTotal = Number(item.quantity || 1) * unitRate;
                        return (
                          <tr key={item.id || idx}>
                            <td className="px-3 py-2">
                              <span className="font-semibold text-slate-900 dark:text-white">
                                {item.itemName || item.description || `Item #${idx + 1}`}
                              </span>
                              {item.technicalSpecs && (
                                <p className="text-[11px] text-slate-400 truncate max-w-xs">{item.technicalSpecs}</p>
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                              {item.quantity} {item.unit || 'Nos'}
                            </td>
                            <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                              {formatCurrency(unitRate)}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-900 dark:text-white">
                              {formatCurrency(lineTotal)}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-slate-400">
                          Single lump-sum procurement requirement.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ACTION LINKS */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setSelectedQuoteForModal(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                Close
              </button>
              {onSelectRFQ && (
                <button
                  type="button"
                  onClick={() => {
                    const target = selectedQuoteForModal.rfq;
                    setSelectedQuoteForModal(null);
                    onSelectRFQ(target);
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {strings.quoteModal.viewFullDetails}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 3: VIEW COMMUNICATION MODAL                                  */}
      {/* =================================================================== */}
      {selectedCommForModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
          onClick={() => setSelectedCommForModal(null)}
        >
          <div
            className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-emerald-600" />
                  {selectedCommForModal.subject || `${selectedCommForModal.channel} Notification`}
                </h3>
                <span className="text-[11px] text-slate-400">
                  {formatIndianDateTime(selectedCommForModal.sentAt)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCommForModal(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800">
                <span><strong>Channel:</strong> {selectedCommForModal.channel}</span>
                <span><strong>Status:</strong> {selectedCommForModal.deliveryStatus}</span>
              </div>
              <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800">
                <strong>Recipient:</strong> {selectedCommForModal.recipient}
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 leading-relaxed">
                {selectedCommForModal.message}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelectedCommForModal(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 4: RECORD / DISPATCH COMMUNICATION MODAL                      */}
      {/* =================================================================== */}
      {isComposeOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
          onClick={() => setIsComposeOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-emerald-600" />
                Record Supplier Communication
              </h3>
              <button
                type="button"
                onClick={() => setIsComposeOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSendCommunication} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Communication Channel
                </label>
                <select
                  value={composeChannel}
                  onChange={(e) => setComposeChannel(e.target.value as any)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                >
                  <option value="EMAIL">Email</option>
                  <option value="SMS">SMS</option>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="CALL">Call Logs</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Subject / Summary
                </label>
                <input
                  type="text"
                  placeholder="e.g. RFQ Quotation Deadline Follow-up"
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Message Content / Call Notes
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="Type message content or summary of call..."
                  value={composeMessage}
                  onChange={(e) => setComposeMessage(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsComposeOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSendingComm}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
                >
                  {isSendingComm && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Dispatch & Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}