'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  ArrowLeft,
  Percent,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  PhoneCall,
  Smartphone,
  Sparkles,
  ShieldCheck,
  Calendar,
  Paperclip,
  ChevronDown,
  Check,
  Upload,
  Plus,
  FileText,
  Users,
  Layers,
  Eye,
  RotateCcw,
} from 'lucide-react';
import { getScenariosForEntityType, interpolateScenarioTemplate, getScenarioForCallOutcome } from '@/lib/emailScenarioTemplates';
import { fetchDocuments } from '@/lib/documentVaultClient';
import type {
  RFQItem,
  ActionCenterAttachment,
  DocumentVaultItem,
  RFQVendorCandidate,
  VendorEntry,
  SupplierCreditSummary,
  SupplierCreditTransaction,
  SupplierCommunicationItem,
  SupplierPaymentSummary,
  SupplierPaymentTransaction,
  InternalTeamMember,
  SellerBuyerUploadItem,
  SellerActiveRFQItem,
} from '@/lib/types';
import {
  formatCurrency,
  formatIndianDateTime,
  CALL_OUTCOMES,
  FOLLOWUP_PRIORITIES,
  getVendorCreditBalance,
  VENDOR_PLAN_RFQ_QUOTA,
  SELLER_QUOTE_CREDITS_ALLOWED,
  SELLER_PROFILE_REQUEST_TYPES,
  APPROVER_CONFIG,
  CREDIT_APPROVAL_APPROVERS,
  INTERNAL_TASK_USERS,
  SELLER_DISCOUNT_MODES,
  SELLER_TRIAL_PERIOD_MODES,
  DISCOUNT_BILLING_DURATIONS,
  OFFLINE_PAYMENT_TYPES,
  calculateDiscountBreakdown,
  calculateTrialDaysFromDates,
  getStandardDiscountPlanPrice,
  type SellerProfileRequestType,
  type OfflinePaymentType,
} from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { usablePan, OFFLINE_PAYMENT_UPLOAD_SCHEMA } from '@/lib/validationSchemas';
import { fetchSubscriptionPricing, type SubscriptionPricingResponse } from '@/lib/subscriptionPaymentClient';
import {
  fetchSupplierCreditHistory,
  updateSupplierCategories,
  fetchSupplierCommunications,
  recordSupplierCommunication,
  fetchSupplierPaymentHistory,
  fetchSellerBuyerUploads,
  fetchSellerActiveRFQs,
} from '@/lib/supplierProfileClient';
import { fetchCategoryTaxonomy } from '@/lib/buyerProfileClient';
import { fetchInternalAssignees } from '@/lib/internalTaskClient';
import { getMajorCategories, getAllUniqueMinorCategories, findMajorForMinor, setCategoryTaxonomy } from '@/lib/categoryTaxonomy';
import { authClient } from '@/lib/authClient';
import { logger } from '@/lib/logger';
import {
  addSellerQuoteCredits,
  createCreditApprovalIdempotencyKey,
  requestSellerQuoteCreditApproval,
  type RequestSellerQuoteCreditApprovalPayload,
} from '@/lib/accountDocumentsClient';
import AccountDocumentsTab from './AccountDocumentsTab';

export interface SupplierDossierSeller {
  id: string;
  name?: string;
  companyName?: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  location?: string;
  pincode?: string;
  deliveryLocation?: string;
  category?: string;
  majorCategory?: string;
  minorCategories?: string[];
  categories?: string[];
  gstin?: string;
  pan?: string;
  gstNumber?: string;
  panNumber?: string;
  subscriptionPlan?: string;
  verificationStatus?: string;
  status?: string;
  source?: 'buyer_uploaded' | 'procucev_network' | string;
  rating?: number;
  score360?: number;
  freeQuotationCredits?: number;
  createdAt?: string;
  created_at?: string;
  lastLogin?: string;
  [key: string]: any;
}

export interface SupplierDossierDrawerProps {
  seller: SupplierDossierSeller;
  onClose: () => void;
  onSelectRFQ?: (rfq: RFQItem) => void;
  sellerRfqs?: RFQItem[];
  rfqs?: RFQItem[];
  initialTab?: 'profile' | 'quotes' | 'credit' | 'communications' | 'payments' | 'documents' | 'buyer-uploads' | 'active-rfqs';
  onTabChange?: (tab: 'profile' | 'quotes' | 'credit' | 'communications' | 'payments' | 'documents' | 'buyer-uploads' | 'active-rfqs') => void;
}

// Shown wherever a value is missing from the record. Never a substitute value.
const EMPTY_VALUE = UI_STRINGS.dataLoad.emptyCell;

export default function SupplierDossierDrawer({
  seller,
  onClose,
  onSelectRFQ,
  sellerRfqs = [],
  rfqs = [],
  initialTab = 'profile',
  onTabChange,
}: SupplierDossierDrawerProps) {
  const strings = UI_STRINGS.sellerDirectory.dossier;

  const effectiveRfqs = useMemo(() => (sellerRfqs.length > 0 ? sellerRfqs : (rfqs || [])), [sellerRfqs, rfqs]);

  // Active Main Tab
  const [dossierTab, setDossierTabState] = useState<'profile' | 'quotes' | 'credit' | 'communications' | 'payments' | 'documents' | 'buyer-uploads' | 'active-rfqs'>(initialTab || 'profile');
  const setDossierTab = useCallback((tab: 'profile' | 'quotes' | 'credit' | 'communications' | 'payments' | 'documents' | 'buyer-uploads' | 'active-rfqs') => {
    setDossierTabState(tab);
    if (onTabChange) onTabChange(tab);
  }, [onTabChange]);

  // Buyer Uploads state
  const [buyerUploads, setBuyerUploads] = useState<SellerBuyerUploadItem[]>([]);
  const [loadingBuyerUploads, setLoadingBuyerUploads] = useState<boolean>(false);
  const [buyerUploadsError, setBuyerUploadsError] = useState<string | null>(null);
  const [buyerUploadSearch, setBuyerUploadSearch] = useState<string>('');
  const [selectedBuyerForModal, setSelectedBuyerForModal] = useState<SellerBuyerUploadItem | null>(null);

  // Active RFQs state
  const [activeRfqs, setActiveRfqs] = useState<SellerActiveRFQItem[]>([]);
  const [loadingActiveRfqs, setLoadingActiveRfqs] = useState<boolean>(false);
  const [activeRfqsError, setActiveRfqsError] = useState<string | null>(null);
  const [activeRfqSearch, setActiveRfqSearch] = useState<string>('');
  const [selectedActiveRfqForModal, setSelectedActiveRfqForModal] = useState<SellerActiveRFQItem | null>(null);

  const loadBuyerUploads = useCallback(async () => {
    if (!seller?.id) return;
    setLoadingBuyerUploads(true);
    setBuyerUploadsError(null);
    try {
      const res = await fetchSellerBuyerUploads(seller.id);
      if (res.success && Array.isArray(res.data)) {
        setBuyerUploads(res.data);
      } else {
        setBuyerUploadsError(res.error || strings.buyerUploads.loadError);
      }
    } catch (err: unknown) {
      setBuyerUploadsError(err instanceof Error ? err.message : strings.buyerUploads.loadError);
    } finally {
      setLoadingBuyerUploads(false);
    }
  }, [seller?.id, strings.buyerUploads.loadError]);

  const loadActiveRfqs = useCallback(async () => {
    if (!seller?.id) return;
    setLoadingActiveRfqs(true);
    setActiveRfqsError(null);
    try {
      const res = await fetchSellerActiveRFQs(seller.id);
      if (res.success && Array.isArray(res.data)) {
        setActiveRfqs(res.data);
      } else {
        setActiveRfqsError(res.error || strings.activeRfqs.loadError);
      }
    } catch (err: unknown) {
      setActiveRfqsError(err instanceof Error ? err.message : strings.activeRfqs.loadError);
    } finally {
      setLoadingActiveRfqs(false);
    }
  }, [seller?.id, strings.activeRfqs.loadError]);

  useEffect(() => {
    void loadBuyerUploads();
    void loadActiveRfqs();
  }, [loadBuyerUploads, loadActiveRfqs]);

  const filteredBuyerUploads = useMemo(() => {
    return buyerUploads.filter((b) => {
      if (buyerUploadSearch.trim()) {
        const q = buyerUploadSearch.toLowerCase();
        const matchName = (b.name || '').toLowerCase().includes(q);
        const matchComp = (b.companyName || '').toLowerCase().includes(q);
        const matchContact = (b.contactPerson || '').toLowerCase().includes(q);
        const matchEmail = (b.email || '').toLowerCase().includes(q);
        const matchPhone = (b.phone || '').toLowerCase().includes(q);
        return matchName || matchComp || matchContact || matchEmail || matchPhone;
      }
      return true;
    });
  }, [buyerUploads, buyerUploadSearch]);

  const filteredActiveRfqs = useMemo(() => {
    return activeRfqs.filter((r) => {
      if (activeRfqSearch.trim()) {
        const q = activeRfqSearch.toLowerCase();
        const matchId = (r.rfqNumber || r.id || '').toLowerCase().includes(q);
        const matchTitle = (r.title || '').toLowerCase().includes(q);
        const matchBuyer = (r.buyerCompanyName || r.buyerCompany || r.buyerName || '').toLowerCase().includes(q);
        const matchCat = (r.category || r.procurementCategory || '').toLowerCase().includes(q);
        const matchLoc = (r.location || '').toLowerCase().includes(q);
        return matchId || matchTitle || matchBuyer || matchCat || matchLoc;
      }
      return true;
    });
  }, [activeRfqs, activeRfqSearch]);
  const [docCount, setDocCount] = useState<number>(0);
  const [isAddQuoteCreditsModalOpen, setIsAddQuoteCreditsModalOpen] = useState<boolean>(false);
  const [isAddCreditModalOpen, setIsAddCreditModalOpen] = useState<boolean>(false);
  const [selectedRequestType, setSelectedRequestType] = useState<SellerProfileRequestType>('Seller Credit Addition');
  const [isRequestTypeDropdownOpen, setIsRequestTypeDropdownOpen] = useState<boolean>(false);
  const requestTypeDropdownRef = useRef<HTMLDivElement>(null);

  const [selectedQuoteCredits, setSelectedQuoteCredits] = useState<number>(0);
  const [requestedQuoteCredits, setRequestedQuoteCredits] = useState<number>(0);
  const [quoteCreditInitiator, setQuoteCreditInitiator] = useState<string>(() => {
    const name = authClient.getSessionUser()?.name;
    return name && name.toLowerCase() !== 'category manager' ? name : 'Govardhan';
  });
  const [quoteCreditApprover, setQuoteCreditApprover] = useState<string>('');

  useEffect(() => {
    const name = authClient.getSessionUser()?.name;
    if (name && name.toLowerCase() !== 'category manager' && !quoteCreditInitiator) {
      setQuoteCreditInitiator(name);
    }
  }, [quoteCreditInitiator]);
  const [quoteCreditsReason, setQuoteCreditsReason] = useState<string>('');
  const [isSubmittingQuoteCredits, setIsSubmittingQuoteCredits] = useState<boolean>(false);

  // Discount Workflow state
  const [discountStep, setDiscountStep] = useState<1 | 2 | 3>(1);
  const [selectedDiscountMode, setSelectedDiscountMode] = useState<string>('Connect Model');
  const [selectedBillingDuration, setSelectedBillingDuration] = useState<string>('12 Months');
  const [discountPercentage, setDiscountPercentage] = useState<number>(0);
  const [pricingConfig, setPricingConfig] = useState<SubscriptionPricingResponse | null>(null);

  useEffect(() => {
    let isMounted = true;
    void fetchSubscriptionPricing().then((config) => {
      if (isMounted && config) {
        setPricingConfig(config);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const discountPlanId = useMemo(() => {
    if (selectedDiscountMode === 'Select Model' || selectedDiscountMode === 'select') return 'select';
    return 'connect';
  }, [selectedDiscountMode]);

  const discountDurationId = useMemo(() => {
    return selectedBillingDuration === '6 Months' ? '6_months' : '12_months';
  }, [selectedBillingDuration]);

  const originalDiscountPlanPrice = useMemo(() => {
    return getStandardDiscountPlanPrice(pricingConfig, discountPlanId, discountDurationId);
  }, [pricingConfig, discountPlanId, discountDurationId]);

  const discountBreakdown = useMemo(() => {
    return calculateDiscountBreakdown(originalDiscountPlanPrice, discountPercentage, pricingConfig?.gstRate ?? 0.18);
  }, [originalDiscountPlanPrice, discountPercentage, pricingConfig?.gstRate]);

  // Trial Period Workflow state
  const [trialPeriodStep, setTrialPeriodStep] = useState<1 | 2>(1);
  const [selectedTrialMode, setSelectedTrialMode] = useState<string>('Connect Model');
  const [trialStartDate, setTrialStartDate] = useState<string>('');
  const [trialEndDate, setTrialEndDate] = useState<string>('');
  const [trialDays, setTrialDays] = useState<number>(0);
  const [trialDateError, setTrialDateError] = useState<string | null>(null);

  useEffect(() => {
    if (trialStartDate && trialEndDate) {
      const days = calculateTrialDaysFromDates(trialStartDate, trialEndDate);
      if (days < 0) {
        setTrialDateError('End date cannot be earlier than start date.');
        setTrialDays(0);
      } else if (days === 0) {
        setTrialDateError('Trial period must be at least 1 day.');
        setTrialDays(0);
      } else if (days > 365) {
        setTrialDateError('Trial extension cannot exceed 365 days.');
        setTrialDays(days);
      } else {
        setTrialDateError(null);
        setTrialDays(days);
      }
    } else {
      setTrialDateError(null);
    }
  }, [trialStartDate, trialEndDate]);

  const handleTrialDateChange = (start: string, end: string) => {
    setTrialStartDate(start);
    setTrialEndDate(end);
    if (!start || !end) {
      setTrialDateError(null);
      setTrialDays(0);
      return;
    }
    const days = calculateTrialDaysFromDates(start, end);
    if (days <= 0) {
      setTrialDateError(trialPeriodStrings.validationEndBeforeStart);
      setTrialDays(0);
    } else {
      setTrialDateError(null);
      setTrialDays(days);
    }
  };

  const handleTrialStartDateChange = (val: string) => {
    setTrialStartDate(val);
    handleTrialDateChange(val, trialEndDate);
  };

  const handleTrialEndDateChange = (val: string) => {
    setTrialEndDate(val);
    handleTrialDateChange(trialStartDate, val);
  };

  // Offline Payment Workflow state
  const [offlinePaymentDate, setOfflinePaymentDate] = useState<string>('');
  const [offlinePaymentType, setOfflinePaymentType] = useState<OfflinePaymentType>('NEFT / RTGS');
  const [offlineTransactionId, setOfflineTransactionId] = useState<string>('');
  const [offlinePaymentAmount, setOfflinePaymentAmount] = useState<number>(0);
  const [offlineSellerSourceMode, setOfflineSellerSourceMode] = useState<string>('Connect Model');
  const [offlineRemarks, setOfflineRemarks] = useState<string>('');
  const [offlineProofFile, setOfflineProofFile] = useState<File | null>(null);
  const [offlineProofFileName, setOfflineProofFileName] = useState<string>('');
  const [offlineProofFileDataUrl, setOfflineProofFileDataUrl] = useState<string>('');
  const [offlineProofFileSize, setOfflineProofFileSize] = useState<number>(0);
  const [offlineProofFileType, setOfflineProofFileType] = useState<string>('');
  const [offlineProofPreviewUrl, setOfflineProofPreviewUrl] = useState<string | null>(null);
  const offlineFileInputRef = useRef<HTMLInputElement>(null);
  const [offlineInitiatorName, setOfflineInitiatorName] = useState<string>('');
  const [offlineApproverName, setOfflineApproverName] = useState<string>('Srinu Sir');

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (requestTypeDropdownRef.current && !requestTypeDropdownRef.current.contains(e.target as Node)) {
        setIsRequestTypeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const creditApprovalStrings = UI_STRINGS.buyerDirectory.dossier.creditApproval;
  const discountStrings = creditApprovalStrings.discountWorkflow;
  const trialPeriodStrings = creditApprovalStrings.trialPeriodWorkflow;
  const offlinePaymentStrings = creditApprovalStrings.offlinePaymentWorkflow;

  // Active Communications Sub-Tab
  const [commSubTab, setCommSubTab] = useState<'all' | 'email' | 'sms' | 'whatsapp' | 'call'>('all');

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
    // No category is recorded for this supplier. The list stays empty rather than showing a placeholder category.
    return [];
  });
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState<boolean>(false);
  const [editingCategories, setEditingCategories] = useState<string[]>([]);
  const [newCategoryInput, setNewCategoryInput] = useState<string>('');
  const [showCategorySuggestions, setShowCategorySuggestions] = useState<boolean>(false);
  const [isSavingCategories, setIsSavingCategories] = useState<boolean>(false);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);

  const allAvailableMinorCategories = useMemo(() => {
    return getAllUniqueMinorCategories();
  }, []);

  const filteredCategorySuggestions = useMemo(() => {
    const q = newCategoryInput.trim().toLowerCase();
    if (q.length < 3) return [];
    return allAvailableMinorCategories.filter((cat) => cat.toLowerCase().includes(q));
  }, [newCategoryInput, allAvailableMinorCategories]);

  useEffect(() => {
    const handleCategoryClickOutside = (e: MouseEvent) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target as Node)) {
        setShowCategorySuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleCategoryClickOutside);
    return () => document.removeEventListener('mousedown', handleCategoryClickOutside);
  }, []);

  const openCategoryModal = () => {
    setEditingCategories([...supportedCategories]);
    setNewCategoryInput('');
    setShowCategorySuggestions(false);
    setIsCategoryModalOpen(true);
  };

  const handleToggleCategory = (cat: string) => {
    setEditingCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleAddCategoryTag = (cat: string) => {
    const clean = cat.trim();
    if (clean && !editingCategories.includes(clean)) {
      setEditingCategories((prev) => [...prev, clean]);
    }
    setNewCategoryInput('');
    setShowCategorySuggestions(false);
  };

  const handleAddNewCategory = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (filteredCategorySuggestions.length > 0 && showCategorySuggestions) {
      handleAddCategoryTag(filteredCategorySuggestions[0]);
    } else if (newCategoryInput.trim()) {
      handleAddCategoryTag(newCategoryInput.trim());
    }
  };

  const handleSaveCategories = async () => {
    if (editingCategories.length === 0) {
      showToast('Please select at least one division.', 'error');
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
        if (isAddQuoteCreditsModalOpen) setIsAddQuoteCreditsModalOpen(false);
        if (isAddCreditModalOpen) setIsAddCreditModalOpen(false);
        if (isRequestTypeDropdownOpen) setIsRequestTypeDropdownOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedQuoteForModal, isCategoryModalOpen, isAddQuoteCreditsModalOpen, isAddCreditModalOpen, isRequestTypeDropdownOpen]);

  const supplierQuotesList = useMemo(() => {
    const list: Array<{ rfq: RFQItem; quote?: any }> = [];
    const vEmail = (seller.email || '').toLowerCase();
    const vName = (seller.name || seller.companyName || '').toLowerCase();

    for (const rfq of effectiveRfqs) {
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
  }, [effectiveRfqs, seller.id, seller.email, seller.name, seller.companyName]);

  const filteredQuotes = useMemo(() => {
    return supplierQuotesList.filter(({ rfq, quote }) => {
      const q = quoteSearch.toLowerCase();
      const matchSearch =
        !q ||
        rfq.rfqNumber.toLowerCase().includes(q) ||
        rfq.title.toLowerCase().includes(q);
      const st = quote ? quote.status : rfq.status;
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
  const [creditHistoryError, setCreditHistoryError] = useState<string | null>(null);
  const [creditSearch, setCreditSearch] = useState<string>('');
  const [creditTypeFilter, setCreditTypeFilter] = useState<string>('all');
  const [creditSortOrder, setCreditSortOrder] = useState<'asc' | 'desc'>('desc');
  const [creditPage, setCreditPage] = useState<number>(1);
  const creditPageSize = 10;
  const creditApprovalRequestKey = useRef<string>('');
  const creditApprovalRequestFingerprint = useRef<string>('');
  const localAttachmentSeqRef = useRef<number>(0);

  const handleAddQuoteCreditsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingQuoteCredits) return;

    const isDiscount = selectedRequestType === 'Discount' || selectedRequestType === 'Discounts';
    const isTrial = selectedRequestType === 'Trial Period' || selectedRequestType === 'Trial Periods';
    const isDeletion = selectedRequestType === 'Seller Credit Deletion';

    const currentBalance = creditSummary?.remainingFreeCredits ?? getVendorCreditBalance(seller) ?? 0;

    if (isDiscount) {
      if (isNaN(discountPercentage) || discountPercentage < 0 || discountPercentage > 100) {
        showToast(discountStrings.validationInvalidDiscount, 'error');
        return;
      }
    } else if (isTrial) {
      if (trialDays <= 0 || trialDays > 365) {
        showToast('Please enter a valid trial extension period (1-365 days).', 'error');
        return;
      }
      if (trialStartDate && trialEndDate) {
        const days = calculateTrialDaysFromDates(trialStartDate, trialEndDate);
        if (days <= 0 || days > 365) {
          showToast(trialDateError || 'End date must be after start date and not exceed 365 days.', 'error');
          return;
        }
      }
    } else if (isDeletion) {
      const amount = requestedQuoteCredits > 0 ? requestedQuoteCredits : selectedQuoteCredits;
      if (amount <= 0) {
        showToast(UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.invalidCreditsError, 'error');
        return;
      }
      if (amount > currentBalance) {
        showToast(`Cannot delete ${amount} credits: ${displayName} only has ${currentBalance} credits available.`, 'error');
        return;
      }
    } else {
      const amount = requestedQuoteCredits > 0 ? requestedQuoteCredits : selectedQuoteCredits;
      if (amount <= 0) {
        showToast(UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.invalidCreditsError, 'error');
        return;
      }
    }

    if (!quoteCreditApprover.trim() || !quoteCreditInitiator) {
      showToast(UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.approverRequired, 'error');
      return;
    }

    setIsSubmittingQuoteCredits(true);
    const amountVal = isDiscount ? discountPercentage : (isTrial ? trialDays : (requestedQuoteCredits > 0 ? requestedQuoteCredits : selectedQuoteCredits));

    const requestFingerprint = JSON.stringify([
      seller.id,
      seller.name,
      selectedRequestType,
      amountVal,
      selectedDiscountMode,
      selectedBillingDuration,
      selectedTrialMode,
      trialStartDate,
      trialEndDate,
      trialDays,
      quoteCreditsReason,
      quoteCreditApprover,
      quoteCreditInitiator,
    ]);
    if (creditApprovalRequestFingerprint.current !== requestFingerprint || !creditApprovalRequestKey.current) {
      creditApprovalRequestFingerprint.current = requestFingerprint;
      creditApprovalRequestKey.current = createCreditApprovalIdempotencyKey();
    }
    try {
      const payload: RequestSellerQuoteCreditApprovalPayload = {
        amount: amountVal,
        reason: quoteCreditsReason.trim(),
        approverName: quoteCreditApprover.trim(),
        initiatorName: quoteCreditInitiator,
        idempotencyKey: creditApprovalRequestKey.current,
        ...(selectedRequestType !== 'Seller Credit Addition' ? { requestType: selectedRequestType } : {}),
        discountPercentage: isDiscount ? discountPercentage : undefined,
        durationDays: isTrial ? trialDays : undefined,
        startDate: isTrial ? trialStartDate : undefined,
        endDate: isTrial ? trialEndDate : undefined,
        selectedMode: isDiscount ? selectedDiscountMode : (isTrial ? selectedTrialMode : undefined),
        billingDuration: isDiscount ? selectedBillingDuration : undefined,
        originalPrice: isDiscount ? discountBreakdown.originalPlanPrice : undefined,
        discountAmount: isDiscount ? discountBreakdown.discountAmount : undefined,
        remainingAmount: isDiscount ? discountBreakdown.remainingAmount : undefined,
        gstAmount: isDiscount ? discountBreakdown.gstAmount : undefined,
        finalPayableAmount: isDiscount ? discountBreakdown.finalPayableAmount : undefined,
      };

      const res = await requestSellerQuoteCreditApproval(seller.id, payload);
      if (res.success) {
        creditApprovalRequestKey.current = '';
        creditApprovalRequestFingerprint.current = '';
        showToast(
          res.message ||
            (isDiscount
              ? formatString(discountStrings.toastSuccess, {
                  approverName: quoteCreditApprover,
                })
              : isTrial
              ? formatString(trialPeriodStrings.toastSuccess, {
                  approverName: quoteCreditApprover,
                })
              : isDeletion
              ? formatString('Credit deduction request submitted for approval to {approverName}. Status: Pending Approval.', {
                  approverName: quoteCreditApprover,
                })
              : formatString(
                  UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.toastSuccess ||
                    'Quote credit request submitted for approval to {approverName}. Status: Pending Approval.',
                  { approverName: quoteCreditApprover }
                )),
          'success'
        );
        setIsAddQuoteCreditsModalOpen(false);
        setIsAddCreditModalOpen(false);
        setRequestedQuoteCredits(0);
        setSelectedQuoteCredits(0);
        setDiscountPercentage(0);
        setDiscountStep(1);
        setTrialPeriodStep(1);
        setTrialStartDate('');
        setTrialEndDate('');
        setTrialDays(0);
        setTrialDateError(null);
        setQuoteCreditsReason('');
        loadCreditHistory();
      } else {
        showToast(res.error || UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.toastError, 'error');
      }
    } catch {
      showToast(UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.toastError, 'error');
    } finally {
      setIsSubmittingQuoteCredits(false);
    }
  };

  const handleOfflineProofFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    const isValidFormat =
      OFFLINE_PAYMENT_UPLOAD_SCHEMA.allowedExtensions.some((ext) => lowerName.endsWith(ext)) ||
      OFFLINE_PAYMENT_UPLOAD_SCHEMA.allowedMimeTypes.includes(file.type as 'image/jpeg' | 'image/png' | 'image/jpg');
    if (!isValidFormat) {
      showToast(offlinePaymentStrings.validationProofFormat, 'error');
      if (offlineFileInputRef.current) offlineFileInputRef.current.value = '';
      return;
    }

    if (file.size > OFFLINE_PAYMENT_UPLOAD_SCHEMA.maxFileSize) {
      showToast(offlinePaymentStrings.validationProofSize, 'error');
      if (offlineFileInputRef.current) offlineFileInputRef.current.value = '';
      return;
    }

    setOfflineProofFile(file);
    setOfflineProofFileName(file.name);
    setOfflineProofFileSize(file.size);
    setOfflineProofFileType(file.type || 'image/jpeg');
    setOfflineProofPreviewUrl('data:image/png;base64,placeholder');

    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      setOfflineProofPreviewUrl(result);
      setOfflineProofFileDataUrl(result);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveOfflineProof = () => {
    setOfflineProofFile(null);
    setOfflineProofPreviewUrl(null);
    setOfflineProofFileName('');
    setOfflineProofFileDataUrl('');
    setOfflineProofFileSize(0);
    setOfflineProofFileType('');
    if (offlineFileInputRef.current) {
      offlineFileInputRef.current.value = '';
    }
  };

  const handleConfirmOfflinePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingQuoteCredits) return;
    if (!offlinePaymentDate) {
      showToast(offlinePaymentStrings.validationPaymentDateRequired, 'error');
      return;
    }
    if (!offlinePaymentType) {
      showToast(offlinePaymentStrings.validationPaymentTypeRequired, 'error');
      return;
    }
    if (offlinePaymentType !== 'Cash' && !offlineTransactionId.trim()) {
      showToast(
        formatString(offlinePaymentStrings.validationTransactionIdRequired, {
          paymentType: offlinePaymentType,
        }),
        'error'
      );
      return;
    }
    if (offlinePaymentAmount <= 0) {
      showToast(offlinePaymentStrings.validationAmountRequired, 'error');
      return;
    }
    const effectiveInitiator = offlineInitiatorName.trim();
    if (!effectiveInitiator) {
      showToast(offlinePaymentStrings.validationInitiatorRequired, 'error');
      return;
    }
    const effectiveApprover = offlineApproverName.trim();
    if (!effectiveApprover) {
      showToast(offlinePaymentStrings.validationApproverRequired, 'error');
      return;
    }

    setIsSubmittingQuoteCredits(true);
    const requestFingerprint = JSON.stringify([
      seller.id,
      seller.name,
      'Offline Payments',
      offlinePaymentAmount,
      offlinePaymentDate,
      offlinePaymentType,
      offlineTransactionId,
      offlineSellerSourceMode,
      offlineProofFileName,
      offlineRemarks,
      effectiveApprover,
      effectiveInitiator,
    ]);
    if (creditApprovalRequestFingerprint.current !== requestFingerprint || !creditApprovalRequestKey.current) {
      creditApprovalRequestFingerprint.current = requestFingerprint;
      creditApprovalRequestKey.current = createCreditApprovalIdempotencyKey();
    }
    try {
      const payload: RequestSellerQuoteCreditApprovalPayload = {
        requestType: 'Offline Payments',
        amount: offlinePaymentAmount,
        paymentAmount: offlinePaymentAmount,
        paymentDate: offlinePaymentDate,
        paymentType: offlinePaymentType,
        transactionId: offlinePaymentType !== 'Cash' ? offlineTransactionId.trim() : undefined,
        paymentReference: offlinePaymentType !== 'Cash' ? offlineTransactionId.trim() : undefined,
        sellerSourceMode: offlineSellerSourceMode,
        selectedMode: offlineSellerSourceMode,
        proofFileName: offlineProofFileName || undefined,
        proofFileUrl: offlineProofFileDataUrl || undefined,
        proofFileType: offlineProofFileType || undefined,
        proofFileSize: offlineProofFileSize || undefined,
        reason: offlineRemarks.trim(),
        approverName: effectiveApprover,
        initiatorName: effectiveInitiator,
        idempotencyKey: creditApprovalRequestKey.current,
      };

      const res = await requestSellerQuoteCreditApproval(seller.id, payload);
      if (res.success) {
        creditApprovalRequestKey.current = '';
        creditApprovalRequestFingerprint.current = '';
        showToast(
          res.message ||
            formatString(offlinePaymentStrings.toastSuccess, {
              approverName: effectiveApprover,
            }),
          'success'
        );
        setIsAddCreditModalOpen(false);
        setIsAddQuoteCreditsModalOpen(false);
        setOfflinePaymentAmount(0);
        setOfflineTransactionId('');
        handleRemoveOfflineProof();
        setOfflineRemarks('');
      } else {
        showToast(
          res.error || offlinePaymentStrings.toastError,
          'error'
        );
      }
    } catch {
      showToast(
        offlinePaymentStrings.toastError,
        'error'
      );
    } finally {
      setIsSubmittingQuoteCredits(false);
    }
  };

  const loadCreditHistory = useCallback(async () => {
    setLoadingCredit(true);
    setCreditHistoryError(null);
    try {
      const res = await fetchSupplierCreditHistory(seller.id);
      if (res.success) {
        setCreditSummary(res.summary || null);
        setCreditTransactions(res.transactions || []);
      } else {
        setCreditSummary(null);
        setCreditTransactions([]);
        setCreditHistoryError(res.error || UI_STRINGS.sellerDirectory.dossier.credit.loadFailure);
      }
    } catch (error) {
      logger.error('Supplier credit history request failed', { sellerId: seller.id, error }, 'SUPPLIER_DOSSIER');
      setCreditSummary(null);
      setCreditTransactions([]);
      setCreditHistoryError(UI_STRINGS.sellerDirectory.dossier.credit.loadFailure);
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
      t.relatedRfqId || EMPTY_VALUE,
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
  const [communicationsError, setCommunicationsError] = useState<string | null>(null);
  const [commSearch, setCommSearch] = useState<string>('');
  const [selectedCommForModal, setSelectedCommForModal] = useState<SupplierCommunicationItem | null>(null);

  // New Communication Message State
  const [isComposeOpen, setIsComposeOpen] = useState<boolean>(false);
  const [composeChannel, setComposeChannel] = useState<'EMAIL' | 'SMS' | 'WHATSAPP' | 'CALL'>('EMAIL');
  const [composeRecipient, setComposeRecipient] = useState<string>(seller.email || seller.phone || '');
  const [composeSubject, setComposeSubject] = useState<string>('');
  const [composeMessage, setComposeMessage] = useState<string>('');
  const [composeCallOutcome, setComposeCallOutcome] = useState<string>('');
  const [composeDuration, setComposeDuration] = useState<string>('');
  const [composeNextFollowupDate, setComposeNextFollowupDate] = useState<string>('');
  const [composeFollowupPriority, setComposeFollowupPriority] = useState<'Low' | 'Medium' | 'High' | 'Critical'>('Medium');
  const [composeFollowupAssigneeId, setComposeFollowupAssigneeId] = useState<string>('');
  const [composeFollowupAssigneeName, setComposeFollowupAssigneeName] = useState<string>('');
  const [assignees, setAssignees] = useState<InternalTeamMember[]>([]);
  const [assigneesError, setAssigneesError] = useState<string | null>(null);
  const internalTaskUserOptions = useMemo(() => {
    const list: string[] = [...INTERNAL_TASK_USERS];
    for (const a of assignees) {
      if (a?.name && !list.some((name) => name.toLowerCase() === a.name.toLowerCase())) {
        list.push(a.name);
      }
    }
    return list;
  }, [assignees]);

  const sellerInitiatorSelectOptions = useMemo(() => {
    const primaryOrder = ['Govardhan', 'Chandan', 'Krishna Chaitanya', 'Sudheer'];
    const list: string[] = [...primaryOrder];
    const extras = [
      ...internalTaskUserOptions,
      'Session Initiator',
      'Category Manager',
    ];
    if (quoteCreditInitiator) extras.push(quoteCreditInitiator);
    if (offlineInitiatorName) extras.push(offlineInitiatorName);

    for (const item of extras) {
      if (!list.some((u) => u.toLowerCase() === item.toLowerCase())) {
        list.push(item);
      }
    }
    return list;
  }, [internalTaskUserOptions, quoteCreditInitiator, offlineInitiatorName]);

  const sellerApproverSelectOptions = useMemo(() => {
    return ['Srinu Sir', 'Rao Sir', 'Sudheer Sir'];
  }, []);
  const [majorCategoryOptions, setMajorCategoryOptions] = useState<string[]>(() => getMajorCategories());
  const [majorCategoryError, setMajorCategoryError] = useState<string | null>(null);
  const [composeFollowupNotes, setComposeFollowupNotes] = useState<string>('');
  const [composeScenarioId, setComposeScenarioId] = useState<string>('');
  const [availableVaultDocs, setAvailableVaultDocs] = useState<DocumentVaultItem[]>([]);
  const [composeAttachments, setComposeAttachments] = useState<ActionCenterAttachment[]>([]);
  const [isVaultDropdownOpen, setIsVaultDropdownOpen] = useState<boolean>(false);

  useEffect(() => {
    let isSubscribed = true;
    fetchDocuments({ activeOnly: true })
      .then((docs: DocumentVaultItem[]) => {
        if (isSubscribed) setAvailableVaultDocs(docs);
      })
      .catch(() => {});
    return () => {
      isSubscribed = false;
    };
  }, []);

  // Follow-up assignees and the major category list come from the API. Nothing is preselected.
  useEffect(() => {
    let isSubscribed = true;
    void fetchInternalAssignees().then((result) => {
      if (!isSubscribed) return;
      setAssignees(result.assignees);
      setAssigneesError(result.error ?? null);
    });
    void fetchCategoryTaxonomy()
      .then((result) => {
        if (!isSubscribed) return;
        if (result.success && Array.isArray(result.data) && result.data.length > 0) {
          setCategoryTaxonomy(result.data);
          setMajorCategoryOptions(result.data.map((c) => c.majorCategory).filter(Boolean));
          setMajorCategoryError(null);
        } else {
          setMajorCategoryError(result.error || UI_STRINGS.buyerProfile.taxonomyEmpty);
        }
      })
      .catch(() => {
        if (isSubscribed) setMajorCategoryError(UI_STRINGS.buyerProfile.taxonomyEmpty);
      });
    return () => {
      isSubscribed = false;
    };
  }, []);

  const handleSellerScenarioChange = useCallback((scId: string) => {
    setComposeScenarioId(scId);
    if (!scId || scId === 'custom') return;
    const scenarios = getScenariosForEntityType('SELLER');
    const sc = scenarios.find((s) => s.id === scId);
    if (!sc) return;
    // Each token holds only what the supplier record, the user, or the form supplies.
    // A token without a value renders as an empty string in the template.
    const tokens: Record<string, string | number | undefined> = {
      contactName: seller.contactPerson,
      companyName: seller.name,
      entityId: seller.id,
      followupDate: composeNextFollowupDate,
      followupNotes: composeFollowupNotes,
      assigneeName: composeFollowupAssigneeName,
      senderName: authClient.getSessionUser()?.name,
      dueDate: composeNextFollowupDate,
      notes: composeMessage,
    };
    if (sc.subjectTemplate) setComposeSubject(interpolateScenarioTemplate(sc.subjectTemplate, tokens));
    if (sc.bodyTemplate) setComposeMessage(interpolateScenarioTemplate(sc.bodyTemplate, tokens));
    if (Array.isArray(sc.suggestedVaultTags) && sc.suggestedVaultTags.length > 0 && availableVaultDocs.length > 0) {
      const matched = availableVaultDocs.filter((d) => sc.suggestedVaultTags.includes(d.category));
      if (matched.length > 0) {
        setComposeAttachments((prev) => {
          const existing = new Set(prev.map((a) => a.id));
          const toAdd = matched.filter((d) => !existing.has(d.id)).map((d) => ({
            id: d.id,
            documentName: d.documentName,
            fileName: d.fileName,
            fileSize: d.fileSize,
            mimeType: d.mimeType,
            category: d.category,
          }));
          return [...prev, ...toAdd];
        });
      }
    }
  }, [seller, composeNextFollowupDate, composeFollowupNotes, composeFollowupAssigneeName, composeMessage, availableVaultDocs]);

  const handleDraftEmailForCallOutcome = useCallback((outcome: string) => {
    setComposeChannel('EMAIL');
    setComposeRecipient(seller.email || '');
    setCommSubTab('email');
    const matchedScenario = getScenarioForCallOutcome('SELLER', outcome);
    if (matchedScenario) {
      handleSellerScenarioChange(matchedScenario.id);
    } else {
      handleSellerScenarioChange('seller_conversion_followup');
    }
  }, [seller.email, handleSellerScenarioChange]);

  const handleConvertCallToFollowupEmail = useCallback(() => {
    setComposeChannel('EMAIL');
    setComposeRecipient(seller.email || '');
    setCommSubTab('email');
    handleSellerScenarioChange('seller_conversion_followup');
  }, [seller.email, handleSellerScenarioChange]);

  const handleLocalSellerFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      localAttachmentSeqRef.current += 1;
      const newAtt: ActionCenterAttachment = {
        id: `local_${Date.now()}_${localAttachmentSeqRef.current}`,
        documentName: `${cleanName} (Local Upload)`,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        category: 'local_upload',
      };
      setComposeAttachments((prev) => [...prev, newAtt]);
      e.target.value = '';
    }
  }, []);
  const [isSendingComm, setIsSendingComm] = useState<boolean>(false);

  // Esc key listener to close compose modal or comm details modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isComposeOpen) setIsComposeOpen(false);
        if (selectedCommForModal) setSelectedCommForModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isComposeOpen, selectedCommForModal]);

  const loadCommunications = useCallback(async () => {
    setLoadingComms(true);
    setCommunicationsError(null);
    try {
      const res = await fetchSupplierCommunications(seller.id);
      if (res.success && res.data) {
        setCommunications(res.data);
      } else {
        setCommunicationsError(res.error || UI_STRINGS.sellerDirectory.dossier.compose.loadFailure);
      }
    } catch (error) {
      logger.error('Supplier communications request failed', { sellerId: seller.id, error }, 'SUPPLIER_DOSSIER');
      setCommunicationsError(UI_STRINGS.sellerDirectory.dossier.compose.loadFailure);
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
        recipient: composeRecipient || seller.email || '',
        subject: composeSubject || `Supplier Communication: ${composeChannel}`,
        message: composeMessage,
        callOutcome: composeChannel === 'CALL' ? composeCallOutcome : undefined,
        duration: composeChannel === 'CALL' ? composeDuration : undefined,
        nextFollowupDate: composeNextFollowupDate || undefined,
        followupPriority: composeFollowupPriority,
        followupAssigneeId: composeFollowupAssigneeId,
        followupAssigneeName: composeFollowupAssigneeName,
        followupNotes: composeFollowupNotes || undefined,
        scenarioId: composeScenarioId || undefined,
        attachments: composeAttachments.length > 0 ? composeAttachments : undefined,
      });
      if (res.success) {
        showToast(
          composeNextFollowupDate
            ? (strings.compose?.successToast || 'Communication recorded, completed task created, and follow-up scheduled.')
            : (strings.compose?.successToast || 'Communication recorded and completed task created.'),
          'success'
        );
        setIsComposeOpen(false);
        setComposeSubject('');
        setComposeMessage('');
        setComposeDuration('');
        setComposeNextFollowupDate('');
        setComposeFollowupNotes('');
        loadCommunications();
      } else {
        showToast(res.error || strings.compose?.errorToast || 'Failed to dispatch communication', 'error');
      }
    } catch {
      showToast(strings.compose?.errorToast || 'Error recording communication', 'error');
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
  const [paymentHistoryError, setPaymentHistoryError] = useState<string | null>(null);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>('all');
  const [paymentSearch, setPaymentSearch] = useState<string>('');
  const [paymentPage, setPaymentPage] = useState<number>(1);
  const paymentPageSize = 10;

  const loadPaymentHistory = useCallback(async () => {
    setLoadingPayments(true);
    setPaymentHistoryError(null);
    try {
      const res = await fetchSupplierPaymentHistory(seller.id);
      if (res.success) {
        setPaymentSummary(res.summary || null);
        setPayments(res.payments || []);
      } else {
        setPaymentSummary(null);
        setPayments([]);
        setPaymentHistoryError(res.error || UI_STRINGS.sellerDirectory.dossier.payments.loadFailure);
      }
    } catch (error) {
      logger.error('Supplier payment history request failed', { sellerId: seller.id, error }, 'SUPPLIER_DOSSIER');
      setPaymentSummary(null);
      setPayments([]);
      setPaymentHistoryError(UI_STRINGS.sellerDirectory.dossier.payments.loadFailure);
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

  const displayName = seller.companyName || seller.name || EMPTY_VALUE;
  const isNetwork = seller.source === 'procucev_network' || String(seller.id).startsWith('v-net-') || Boolean((seller as any).isNetwork);
  const scoreVal = seller.score360 ?? seller.score ?? null;
  const regDate = seller.createdAt || seller.created_at || null;

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
                  {scoreVal === null ? `${strings.score360Label}: ${EMPTY_VALUE}` : `${strings.score360Label}: ${scoreVal}/100`}
                </span>
                <div className="relative inline-block text-left" ref={requestTypeDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setIsRequestTypeDropdownOpen((prev) => !prev)}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition cursor-pointer"
                    title={UI_STRINGS.buyerDirectory.dossier.requestTypeTitle}
                    aria-label={UI_STRINGS.buyerDirectory.dossier.requestTypeTitle}
                    aria-haspopup="true"
                    aria-expanded={isRequestTypeDropdownOpen}
                    data-testid="request-type-dropdown-btn"
                  >
                    <Plus className="w-3 h-3" />
                    <span>{UI_STRINGS.buyerDirectory.dossier.requestTypeDropdown}</span>
                    <ChevronDown className="w-3 h-3 ml-0.5 opacity-70" />
                  </button>

                  {isRequestTypeDropdownOpen && (
                    <div
                      role="menu"
                      aria-orientation="vertical"
                      className="absolute left-0 mt-1 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 py-1 text-xs divide-y divide-slate-100 dark:divide-slate-800"
                    >
                      {SELLER_PROFILE_REQUEST_TYPES.map((type) => (
                        <button
                          key={type}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setSelectedRequestType(type);
                            setIsRequestTypeDropdownOpen(false);
                            if (type === 'Discount' || (type as string) === 'Discounts') {
                              setDiscountStep(1);
                              setSelectedDiscountMode('Connect Model');
                              setSelectedBillingDuration('12 Months');
                              setDiscountPercentage(0);
                            } else if (type === 'Trial Period' || (type as string) === 'Trial Periods') {
                              setTrialPeriodStep(1);
                              setSelectedTrialMode('Connect Model');
                              setTrialStartDate('');
                              setTrialEndDate('');
                              setTrialDays(0);
                              setTrialDateError(null);
                              setQuoteCreditsReason('');
                            } else if (type === 'Offline Payments') {
                              setOfflinePaymentDate('');
                              setOfflinePaymentType('NEFT / RTGS');
                              setOfflineTransactionId('');
                              setOfflinePaymentAmount(0);
                              setOfflineSellerSourceMode('Connect Model');
                              handleRemoveOfflineProof();
                              setOfflineRemarks('');
                              setOfflineInitiatorName(quoteCreditInitiator);
                              setOfflineApproverName(APPROVER_CONFIG[0]?.name || 'Srinu Sir');
                            }
                            setIsAddQuoteCreditsModalOpen(true);
                          }}
                          className="w-full text-left px-3.5 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-emerald-600 dark:hover:text-emerald-400 font-medium transition cursor-pointer flex items-center justify-between"
                        >
                          <span>{type}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {formatString(strings.registered, { date: regDate ? formatIndianDateTime(regDate) : EMPTY_VALUE })}
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

        {/* 8 NAVIGATION TABS: PROFILE, QUOTES, CREDIT, COMMUNICATIONS, PAYMENTS, DOCUMENTS, BUYER UPLOADS, ACTIVE RFQS */}
        <div className="flex items-center gap-1 mt-6 border-b border-slate-200 dark:border-slate-700 overflow-x-auto scrollbar-thin">
          <button
            type="button"
            onClick={() => setDossierTab('profile')}
            className={`px-3 py-2.5 text-xs sm:text-sm font-semibold border-b-2 whitespace-nowrap transition-colors shrink-0 cursor-pointer ${
              dossierTab === 'profile'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <span>{strings.profileTab}</span>
          </button>

          <button
            type="button"
            onClick={() => setDossierTab('quotes')}
            className={`px-3 py-2.5 text-xs sm:text-sm font-semibold border-b-2 whitespace-nowrap transition-colors shrink-0 cursor-pointer ${
              dossierTab === 'quotes'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <span>{strings.quotesTab} ({supplierQuotesList.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setDossierTab('credit')}
            className={`px-3 py-2.5 text-xs sm:text-sm font-semibold border-b-2 whitespace-nowrap transition-colors shrink-0 cursor-pointer ${
              dossierTab === 'credit'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <span>{strings.creditTab}</span>
          </button>

          <button
            type="button"
            onClick={() => setDossierTab('communications')}
            className={`px-3 py-2.5 text-xs sm:text-sm font-semibold border-b-2 whitespace-nowrap transition-colors shrink-0 cursor-pointer ${
              dossierTab === 'communications'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <span>{strings.communicationsTab} ({communications.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setDossierTab('payments')}
            className={`px-3 py-2.5 text-xs sm:text-sm font-semibold border-b-2 whitespace-nowrap transition-colors shrink-0 cursor-pointer ${
              dossierTab === 'payments'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <span>{strings.paymentsTab} ({payments.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setDossierTab('documents')}
            className={`px-3 py-2.5 text-xs sm:text-sm font-semibold border-b-2 whitespace-nowrap transition-colors shrink-0 cursor-pointer ${
              dossierTab === 'documents'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <span>{strings.documentsTab || 'Documents'} ({docCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setDossierTab('buyer-uploads')}
            className={`px-3 py-2.5 text-xs sm:text-sm font-semibold border-b-2 whitespace-nowrap transition-colors shrink-0 cursor-pointer ${
              dossierTab === 'buyer-uploads'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <span>{strings.buyerUploadsTab} ({buyerUploads.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setDossierTab('active-rfqs')}
            className={`px-3 py-2.5 text-xs sm:text-sm font-semibold border-b-2 whitespace-nowrap transition-colors shrink-0 cursor-pointer ${
              dossierTab === 'active-rfqs'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <span>{strings.activeRfqsTab} ({activeRfqs.length})</span>
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
                    <span className="font-semibold">{seller.contactPerson || seller.name || EMPTY_VALUE}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{seller.email || EMPTY_VALUE}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{seller.phone || EMPTY_VALUE}</span>
                  </div>
                  <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <span>Company Location: {seller.location || EMPTY_VALUE}</span>
                  </div>
                  <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300" data-testid="dossier-vendor-pincode">
                    <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                    <span>{strings.pincodeLabel}: {seller.pincode || EMPTY_VALUE}</span>
                  </div>
                  <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                    <Truck className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <span>Delivery Location: {seller.deliveryLocation || seller.location || EMPTY_VALUE}</span>
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
                      {seller.gstin || seller.gstNumber || seller.gst || EMPTY_VALUE}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">PAN:</span>{' '}
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {usablePan(seller.pan) || usablePan(seller.panNumber) || EMPTY_VALUE}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Subscription Tier:</span>{' '}
                    <span className="font-semibold text-slate-800 dark:text-slate-200 capitalize">
                      {seller.subscriptionPlan || EMPTY_VALUE}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-slate-400">Verification Status:</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                      {seller.verificationStatus || seller.status || EMPTY_VALUE}
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
                    {cat}
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
                            {(rfq as any).buyerCompanyName || (rfq as any).buyerCompany || EMPTY_VALUE}
                          </td>
                          <td className="px-3.5 py-2.5">
                            <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800 capitalize">
                              {rfq.sourcingMode || EMPTY_VALUE}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 font-semibold text-slate-800 dark:text-slate-200">
                            {(quote?.totalPrice || quote?.amount) ? formatCurrency(quote.totalPrice || quote.amount || 0) : EMPTY_VALUE}
                          </td>
                          <td className="px-3.5 py-2.5">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                              {quote?.status || EMPTY_VALUE}
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
                  {creditSummary?.totalCreditsAllocated ?? EMPTY_VALUE}
                </div>
                
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm">
                <span className="text-xs text-slate-400 font-medium">{strings.credit.totalConsumed}</span>
                <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                  {creditSummary?.totalCreditsConsumed ?? EMPTY_VALUE}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">Quotation unlocks</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm">
                <span className="text-xs text-slate-400 font-medium">{strings.credit.remainingFree}</span>
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                  {creditSummary?.remainingFreeCredits ?? getVendorCreditBalance(seller) ?? EMPTY_VALUE}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">Active quote balance</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm">
                <span className="text-xs text-slate-400 font-medium">{strings.credit.currentBalance}</span>
                <div className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">
                  {creditSummary?.currentCreditBalance ?? getVendorCreditBalance(seller) ?? EMPTY_VALUE}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 capitalize">
                  {creditSummary?.subscriptionPlan || seller.subscriptionPlan || EMPTY_VALUE}
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
                    {creditHistoryError && (
                      <tr>
                        <td colSpan={8} role="alert" className="px-4 py-3 text-xs text-rose-600 dark:text-rose-400">
                          {creditHistoryError}
                        </td>
                      </tr>
                    )}
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
              {/* SUB-TABS */}
              <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setCommSubTab('all')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                    commSubTab === 'all'
                      ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  {strings.subTabs.all || 'All'}
                </button>
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
                        : commSubTab === 'call'
                        ? 'CALL'
                        : 'EMAIL'
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
              {communicationsError && (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
                  {communicationsError}
                </div>
              )}
              {loadingComms ? (
                <div className="p-8 text-center text-slate-400 text-xs">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-emerald-600 mb-2" />
                  Loading communication logs...
                </div>
              ) : filteredCommunications.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  No {commSubTab === 'all' ? '' : commSubTab.toUpperCase() + ' '}communication records found.
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
                          {comm.direction || EMPTY_VALUE}
                        </span>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          {comm.subject || `${comm.channel} Notice`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                          {comm.deliveryStatus || EMPTY_VALUE}
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
        {/* TAB 6: DOCUMENTS TAB                                               */}
        {/* =================================================================== */}
        {dossierTab === 'documents' && (
          <AccountDocumentsTab
            accountType="seller"
            accountId={seller.id}
            accountName={displayName}
            onDocumentCountChange={setDocCount}
          />
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
                  {paymentSummary?.totalAmountPaid != null ? formatCurrency(paymentSummary.totalAmountPaid) : EMPTY_VALUE}
                </div>
                
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm">
                <span className="text-xs text-slate-400 font-medium">{strings.payments.successful}</span>
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                  {paymentSummary?.totalSuccessfulPayments ?? EMPTY_VALUE}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">Settled invoices</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm">
                <span className="text-xs text-slate-400 font-medium">{strings.payments.pending}</span>
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                  {paymentSummary?.pendingPayments ?? EMPTY_VALUE}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">Awaiting gateway</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm">
                <span className="text-xs text-slate-400 font-medium">{strings.payments.failed}</span>
                <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">
                  {paymentSummary?.failedPayments ?? EMPTY_VALUE}
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
                    {paymentHistoryError && (
                      <tr>
                        <td colSpan={6} role="alert" className="px-4 py-3 text-xs text-rose-600 dark:text-rose-400">
                          {paymentHistoryError}
                        </td>
                      </tr>
                    )}
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

        {/* =================================================================== */}
        {/* TAB 7: BUYER UPLOADS TAB                                            */}
        {/* =================================================================== */}
        {dossierTab === 'buyer-uploads' && (
          <div className="space-y-4">
            {/* Header / Search Controls */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={buyerUploadSearch}
                  onChange={(e) => setBuyerUploadSearch(e.target.value)}
                  placeholder={strings.buyerUploads.searchPlaceholder}
                  className="w-full pl-9 pr-4 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <button
                type="button"
                onClick={() => void loadBuyerUploads()}
                title={strings.buyerUploads.retry}
                aria-label={strings.buyerUploads.retry}
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer self-end sm:self-auto"
              >
                <RotateCcw className={`w-4 h-4 ${loadingBuyerUploads ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Content states */}
            {loadingBuyerUploads ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin mb-2 text-emerald-600" />
                <p className="text-xs">{UI_STRINGS.dataLoad.loading}</p>
              </div>
            ) : buyerUploadsError ? (
              <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                  <span className="text-xs">{buyerUploadsError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void loadBuyerUploads()}
                  className="px-3 py-1 text-xs font-semibold rounded bg-rose-600 text-white hover:bg-rose-700 cursor-pointer"
                >
                  {strings.buyerUploads.retry}
                </button>
              </div>
            ) : filteredBuyerUploads.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/40">
                <Users className="w-10 h-10 mx-auto text-slate-400 mb-2" />
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                  {strings.buyerUploads.emptyMessage}
                </p>
                <p className="text-xs text-slate-400 mt-1">{strings.buyerUploads.subtitle}</p>
              </div>
            ) : (
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
                    <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] uppercase font-bold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="py-3 px-4 whitespace-nowrap">{strings.buyerUploads.colBuyerName}</th>
                        <th className="py-3 px-4 whitespace-nowrap">{strings.buyerUploads.colCompanyName}</th>
                        <th className="py-3 px-4 whitespace-nowrap">{strings.buyerUploads.colContactPerson}</th>
                        <th className="py-3 px-4 whitespace-nowrap">{strings.buyerUploads.colEmail}</th>
                        <th className="py-3 px-4 whitespace-nowrap">{strings.buyerUploads.colPhone}</th>
                        <th className="py-3 px-4 whitespace-nowrap">{strings.buyerUploads.colUploadDate}</th>
                        <th className="py-3 px-4 whitespace-nowrap">{strings.buyerUploads.colStatus}</th>
                        <th className="py-3 px-4 text-right whitespace-nowrap">{strings.buyerUploads.colActions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredBuyerUploads.map((buyerItem) => (
                        <tr key={buyerItem.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors">
                          <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {buyerItem.name || EMPTY_VALUE}
                          </td>
                          <td className="py-3 px-4 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {buyerItem.companyName || EMPTY_VALUE}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {buyerItem.contactPerson || EMPTY_VALUE}
                          </td>
                          <td className="py-3 px-4 text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                            {buyerItem.email || EMPTY_VALUE}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {buyerItem.phone || EMPTY_VALUE}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {buyerItem.uploadDate ? formatIndianDateTime(buyerItem.uploadDate) : EMPTY_VALUE}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              (buyerItem.status || '').toUpperCase().includes('ACTIVE') || (buyerItem.status || '').toUpperCase().includes('VERIFIED')
                                ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                            }`}>
                              {buyerItem.status || EMPTY_VALUE}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setSelectedBuyerForModal(buyerItem)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              {strings.buyerUploads.viewDetails}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 8: ACTIVE RFQS TAB                                              */}
        {/* =================================================================== */}
        {dossierTab === 'active-rfqs' && (
          <div className="space-y-4">
            {/* Header / Search Controls */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={activeRfqSearch}
                  onChange={(e) => setActiveRfqSearch(e.target.value)}
                  placeholder={strings.activeRfqs.searchPlaceholder}
                  className="w-full pl-9 pr-4 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <button
                type="button"
                onClick={() => void loadActiveRfqs()}
                title={strings.activeRfqs.retry}
                aria-label={strings.activeRfqs.retry}
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer self-end sm:self-auto"
              >
                <RotateCcw className={`w-4 h-4 ${loadingActiveRfqs ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Content states */}
            {loadingActiveRfqs ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin mb-2 text-emerald-600" />
                <p className="text-xs">{UI_STRINGS.dataLoad.loading}</p>
              </div>
            ) : activeRfqsError ? (
              <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                  <span className="text-xs">{activeRfqsError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void loadActiveRfqs()}
                  className="px-3 py-1 text-xs font-semibold rounded bg-rose-600 text-white hover:bg-rose-700 cursor-pointer"
                >
                  {strings.activeRfqs.retry}
                </button>
              </div>
            ) : filteredActiveRfqs.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/40">
                <Layers className="w-10 h-10 mx-auto text-slate-400 mb-2" />
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                  {strings.activeRfqs.emptyMessage}
                </p>
                <p className="text-xs text-slate-400 mt-1">{strings.activeRfqs.subtitle}</p>
              </div>
            ) : (
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
                    <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] uppercase font-bold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="py-3 px-4 whitespace-nowrap">{strings.activeRfqs.colRfqId}</th>
                        <th className="py-3 px-4 whitespace-nowrap">{strings.activeRfqs.colRfqTitle}</th>
                        <th className="py-3 px-4 whitespace-nowrap">{strings.activeRfqs.colCategory}</th>
                        <th className="py-3 px-4 whitespace-nowrap">{strings.activeRfqs.colBuyerCompany}</th>
                        <th className="py-3 px-4 whitespace-nowrap">{strings.activeRfqs.colLocation}</th>
                        <th className="py-3 px-4 whitespace-nowrap">{strings.activeRfqs.colPublishedDate}</th>
                        <th className="py-3 px-4 whitespace-nowrap">{strings.activeRfqs.colClosingDate}</th>
                        <th className="py-3 px-4 whitespace-nowrap">{strings.activeRfqs.colStatus}</th>
                        <th className="py-3 px-4 text-right whitespace-nowrap">{strings.activeRfqs.colActions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredActiveRfqs.map((rfq) => (
                        <tr key={rfq.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors">
                          <td className="py-3 px-4 font-mono font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                            {rfq.rfqNumber || rfq.id || EMPTY_VALUE}
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100 max-w-xs truncate whitespace-nowrap">
                            {rfq.title || EMPTY_VALUE}
                          </td>
                          <td className="py-3 px-4 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {rfq.procurementCategory || rfq.category || EMPTY_VALUE}
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                            {rfq.buyerCompanyName || rfq.buyerCompany || rfq.buyerName || EMPTY_VALUE}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {rfq.location || EMPTY_VALUE}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {rfq.publishedDate ? formatIndianDateTime(rfq.publishedDate) : EMPTY_VALUE}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {rfq.closingDate ? formatIndianDateTime(rfq.closingDate) : EMPTY_VALUE}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                              {rfq.status || EMPTY_VALUE}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setSelectedActiveRfqForModal(rfq)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              {strings.activeRfqs.viewDetails}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={(e) => {
            e.stopPropagation();
            if (e.target === e.currentTarget) setIsCategoryModalOpen(false);
          }}
        >
          <div
            className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {strings.procurementCategoriesMaster || 'Procurement Categories Master'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Select, add, or remove procurement categories for {displayName}.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close categories modal"
                onClick={() => setIsCategoryModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {majorCategoryError && (
              <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 p-2.5 rounded-lg border border-rose-200 dark:border-rose-900/50">
                {majorCategoryError}
              </p>
            )}

            {/* Minor Category Autocomplete Search (>= 3 chars) */}
            <div className="space-y-2 relative" ref={categoryDropdownRef}>
              <label htmlFor="seller-dossier-category-search-input" className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                {UI_STRINGS.vendorCategorySelect.categoryLabel}
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    id="seller-dossier-category-search-input"
                    type="text"
                    value={newCategoryInput}
                    onChange={(e) => {
                      setNewCategoryInput(e.target.value);
                      setShowCategorySuggestions(true);
                    }}
                    onFocus={() => {
                      if (newCategoryInput.trim().length >= 3) {
                        setShowCategorySuggestions(true);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (filteredCategorySuggestions.length > 0 && showCategorySuggestions) {
                          handleAddCategoryTag(filteredCategorySuggestions[0]);
                        } else if (newCategoryInput.trim()) {
                          handleAddCategoryTag(newCategoryInput.trim());
                        }
                      } else if (e.key === 'Escape') {
                        e.stopPropagation();
                        setShowCategorySuggestions(false);
                      }
                    }}
                    placeholder={UI_STRINGS.vendorCategorySelect.searchPlaceholder}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                  />
                  {newCategoryInput && (
                    <button
                      type="button"
                      aria-label="Clear category input"
                      onClick={() => {
                        setNewCategoryInput('');
                        setShowCategorySuggestions(false);
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (filteredCategorySuggestions.length > 0 && showCategorySuggestions) {
                      handleAddCategoryTag(filteredCategorySuggestions[0]);
                    } else if (newCategoryInput.trim()) {
                      handleAddCategoryTag(newCategoryInput.trim());
                    }
                  }}
                  className="px-3.5 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg cursor-pointer shrink-0"
                >
                  {strings.addCustomCategory}
                </button>
              </div>

              {newCategoryInput.trim().length > 0 && newCategoryInput.trim().length < 3 && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                  {UI_STRINGS.vendorCategorySelect.minCharsHint}
                </p>
              )}

              {showCategorySuggestions && newCategoryInput.trim().length >= 3 && (
                <div
                  role="listbox"
                  aria-label={UI_STRINGS.vendorCategorySelect.matchingCategories}
                  className="absolute z-30 left-0 right-0 mt-1 max-h-52 overflow-y-auto rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl divide-y divide-slate-100 dark:divide-gray-700/60"
                >
                  <div className="px-3 py-1.5 bg-slate-50 dark:bg-gray-900/80 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 flex items-center justify-between">
                    <span>{UI_STRINGS.vendorCategorySelect.matchingCategories} ({filteredCategorySuggestions.length})</span>
                    <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-semibold">{UI_STRINGS.vendorCategorySelect.masterCountBadge}</span>
                  </div>
                  {filteredCategorySuggestions.length > 0 ? (
                    filteredCategorySuggestions.map((category) => (
                      <button
                        key={category}
                        type="button"
                        role="option"
                        aria-selected={editingCategories.includes(category)}
                        onClick={() => handleAddCategoryTag(category)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-emerald-50 dark:hover:bg-emerald-950/60 flex items-center justify-between text-slate-700 dark:text-gray-200 transition-colors cursor-pointer"
                      >
                        <span className="font-medium text-slate-800 dark:text-slate-100">{category}</span>
                        <span className="text-[10px] text-slate-400 italic">{findMajorForMinor(category)}</span>
                      </button>
                    ))
                  ) : (
                    <div className="p-3 text-center">
                      <p className="text-xs text-slate-500 dark:text-gray-400 mb-1.5">{UI_STRINGS.vendorCategorySelect.noMatches}</p>
                      <button
                        type="button"
                        onClick={() => handleAddCategoryTag(newCategoryInput.trim())}
                        className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                      >
                        {UI_STRINGS.vendorCategorySelect.addCustomTag}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Currently Selected Summary */}
            <div className="pt-2">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">
                Selected Categories ({editingCategories.length})
              </span>
              <div className="flex flex-wrap gap-1.5">
                {editingCategories.map((cat) => (
                  <span
                    key={cat}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                  >
                    <span>{cat}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${cat}`}
                      onClick={() => handleToggleCategory(cat)}
                      className="hover:text-rose-600 ml-0.5 cursor-pointer"
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
                onClick={() => setIsCategoryModalOpen(false)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingCategories}
                onClick={handleSaveCategories}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer"
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
                  {selectedQuoteForModal.quote?.totalPrice != null ? formatCurrency(selectedQuoteForModal.quote.totalPrice) : EMPTY_VALUE}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40">
                <span className="text-[11px] text-slate-400">GST / Taxes</span>
                <div className="text-base font-bold text-emerald-600 mt-0.5">
                  {selectedQuoteForModal.quote?.taxAmount != null ? formatCurrency(selectedQuoteForModal.quote.taxAmount) : EMPTY_VALUE}
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
                  {selectedQuoteForModal.quote?.status || EMPTY_VALUE}
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
                        const unitRate = selectedQuoteForModal.quote?.unitPrice != null ? Number(selectedQuoteForModal.quote.unitPrice) : null;
                        const lineTotal = unitRate !== null && item.quantity != null ? Number(item.quantity) * unitRate : null;
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
                              {item.quantity} {item.unit || EMPTY_VALUE}
                            </td>
                            <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                              {unitRate !== null ? formatCurrency(unitRate) : EMPTY_VALUE}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-900 dark:text-white">
                              {lineTotal !== null ? formatCurrency(lineTotal) : EMPTY_VALUE}
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
            className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <MessageSquare className="w-4.5 h-4.5 text-emerald-600" />
                <span>{strings.compose.title}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsComposeOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 -mt-2">
              {strings.compose.subtitle}
            </p>

            <form onSubmit={handleSendCommunication} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.compose.channelLabel}
                </label>
                <select
                  value={composeChannel}
                  onChange={(e) => {
                    const ch = e.target.value as any;
                    setComposeChannel(ch);
                    if (ch === 'CALL' || ch === 'SMS' || ch === 'WHATSAPP') {
                      setComposeRecipient(seller.phone || seller.email || '');
                    } else {
                      setComposeRecipient(seller.email || seller.phone || '');
                    }
                  }}
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
                  {strings.compose.recipientLabel}
                </label>
                <input
                  type="text"
                  value={composeRecipient}
                  onChange={(e) => setComposeRecipient(e.target.value)}
                  placeholder="e.g. supplier@company.com or +91 9876543210"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                />
              </div>

              {composeChannel === 'CALL' && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 p-3 bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {strings.compose.callOutcomeLabel}
                      </label>
                      <select
                        value={composeCallOutcome}
                        onChange={(e) => setComposeCallOutcome(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                      >
                        <option value="">{EMPTY_VALUE}</option>
                        {CALL_OUTCOMES.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {strings.compose.callDurationLabel}
                      </label>
                      <input
                        type="text"
                        value={composeDuration}
                        onChange={(e) => setComposeDuration(e.target.value)}
                        placeholder={strings.compose.callDurationPlaceholder}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                      />
                    </div>
                    <div className="col-span-2 pt-1 border-t border-amber-200/60 dark:border-amber-800/60">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1">
                          <Sparkles size={11} className="text-amber-600" />
                          <span>Draft Conversion Email for Call Outcome:</span>
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {CALL_OUTCOMES.map((o) => (
                          <button
                            key={o.value}
                            type="button"
                            onClick={() => handleDraftEmailForCallOutcome(o.value)}
                            className="text-[10px] px-2 py-0.5 rounded bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-amber-200 dark:border-amber-800 hover:border-indigo-400 hover:text-indigo-600 font-medium transition cursor-pointer"
                          >
                            Draft for {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {composeNextFollowupDate && (
                    <button
                      type="button"
                      onClick={handleConvertCallToFollowupEmail}
                      className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 rounded-lg text-xs font-semibold hover:bg-indigo-100 transition cursor-pointer"
                    >
                      <Mail size={13} />
                      <span>Email Follow-up Call Schedule to Vendor</span>
                    </button>
                  )}
                </div>
              )}

              {composeChannel === 'EMAIL' && (
                <div className="p-3 bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 rounded-xl space-y-2.5">
                  <div>
                    <label className="block text-xs font-semibold text-indigo-950 dark:text-indigo-300 flex items-center gap-1.5 mb-1">
                      <Sparkles size={13} className="text-indigo-600" />
                      <span>Select Conversion Scenario</span>
                    </label>
                    <select
                      value={composeScenarioId}
                      onChange={(e) => handleSellerScenarioChange(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                    >
                      <option value="">-- Choose a sales / conversion scenario --</option>
                      {getScenariosForEntityType('SELLER').map((sc) => (
                        <option key={sc.id} value={sc.id}>
                          {sc.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Document Vault + Local File Attachments */}
                  <div className="pt-2 border-t border-indigo-100 dark:border-indigo-900/40 space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                      <span className="flex items-center gap-1.5">
                        <Paperclip size={13} className="text-indigo-600" />
                        <span>Attachments (Vault or Local File)</span>
                      </span>
                      <span className="text-[11px] text-slate-400 font-normal">
                        {composeAttachments.length} attached
                      </span>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <div className="relative flex-1">
                        <button
                          type="button"
                          onClick={() => setIsVaultDropdownOpen((prev) => !prev)}
                          className="w-full flex items-center justify-between px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
                        >
                          <span className="truncate">
                            {composeAttachments.length > 0
                              ? `${composeAttachments.length} document(s) attached`
                              : 'Select collateral from Document Vault...'}
                          </span>
                          <ChevronDown size={14} className="text-slate-400 shrink-0 ml-2" />
                        </button>

                        {isVaultDropdownOpen && (
                          <div className="absolute top-full left-0 right-0 mt-1 z-30 max-h-48 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl p-1 space-y-1">
                            {availableVaultDocs.map((doc) => {
                              const isSelected = composeAttachments.some((a) => a.id === doc.id);
                              return (
                                <button
                                  key={doc.id}
                                  type="button"
                                  onClick={() => {
                                    if (isSelected) {
                                      setComposeAttachments((prev) => prev.filter((a) => a.id !== doc.id));
                                    } else {
                                      setComposeAttachments((prev) => [
                                        ...prev,
                                        {
                                          id: doc.id,
                                          documentName: doc.documentName,
                                          fileName: doc.fileName,
                                          fileSize: doc.fileSize,
                                          mimeType: doc.mimeType,
                                          category: doc.category,
                                        },
                                      ]);
                                    }
                                  }}
                                  className="w-full flex items-center justify-between p-1.5 rounded text-xs text-left hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                                >
                                  <span className="truncate">{doc.documentName}</span>
                                  {isSelected && <Check size={13} className="text-indigo-600 font-bold" />}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <label className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer shrink-0">
                        <Upload size={12} className="text-indigo-600" />
                        <span>Attach Local File</span>
                        <input
                          type="file"
                          onChange={handleLocalSellerFileSelect}
                          className="hidden"
                        />
                      </label>
                    </div>

                    {composeAttachments.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {composeAttachments.map((att) => (
                          <span
                            key={att.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[10px]"
                          >
                            <Paperclip size={10} />
                            <span className="truncate max-w-[160px]">{att.documentName}</span>
                            <button
                              type="button"
                              onClick={() => setComposeAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                              className="hover:text-rose-600 cursor-pointer"
                            >
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.compose.subjectLabel}
                </label>
                <input
                  type="text"
                  placeholder={strings.compose.subjectPlaceholder}
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.compose.messageLabel}
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder={strings.compose.messagePlaceholder}
                  value={composeMessage}
                  onChange={(e) => setComposeMessage(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Calendar size={13} className="text-emerald-600" />
                    <span>{strings.compose.nextFollowupLabel}</span>
                  </span>
                  {composeNextFollowupDate && (
                    <button
                      type="button"
                      onClick={() => setComposeNextFollowupDate('')}
                      className="text-[10px] text-slate-400 hover:text-rose-500 underline cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <input
                      type="datetime-local"
                      value={composeNextFollowupDate}
                      onChange={(e) => setComposeNextFollowupDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <select
                      value={composeFollowupPriority}
                      onChange={(e) => setComposeFollowupPriority(e.target.value as any)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                    >
                      {FOLLOWUP_PRIORITIES.map((p) => (
                        <option key={p.value} value={p.value}>Priority: {p.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {composeNextFollowupDate && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-0.5">
                        {strings.compose.followupAssigneeLabel}
                      </label>
                      <select
                        value={composeFollowupAssigneeId}
                        onChange={(e) => {
                          setComposeFollowupAssigneeId(e.target.value);
                          const m = assignees.find((mem) => mem.id === e.target.value);
                          setComposeFollowupAssigneeName(m?.name ?? '');
                        }}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                      >
                        <option value="">{UI_STRINGS.actionCenter.tasks.selectAssignee}</option>
                        {assignees.map((m) => (
                          <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                        ))}
                      </select>
                      {assigneesError && (
                        <p role="alert" className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{assigneesError}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-0.5">
                        {strings.compose.followupNotesLabel}
                      </label>
                      <input
                        type="text"
                        value={composeFollowupNotes}
                        onChange={(e) => setComposeFollowupNotes(e.target.value)}
                        placeholder={strings.compose.followupNotesPlaceholder}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsComposeOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                >
                  {strings.compose.cancelBtn}
                </button>
                <button
                  type="submit"
                  disabled={isSendingComm}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  {isSendingComm && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{strings.compose.sendBtn}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: REQUEST SELLER APPROVAL WORKFLOWS                            */}
      {/* =================================================================== */}
      {(isAddQuoteCreditsModalOpen || isAddCreditModalOpen) && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsAddQuoteCreditsModalOpen(false);
              setIsAddCreditModalOpen(false);
            }
          }}
        >
          <div
            className={`w-full ${
              (selectedRequestType === 'Discount' || selectedRequestType === 'Discounts') && discountStep === 3
                ? 'max-w-2xl'
                : selectedRequestType === 'Offline Payments'
                ? 'max-w-2xl'
                : 'max-w-lg'
            } bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-4 sm:p-5 space-y-3 max-h-[90vh] overflow-y-auto`}
          >
            {selectedRequestType === 'Discount' || selectedRequestType === 'Discounts' ? (
              <>
                {/* Step 1: Select Sourcing Mode (Connect Model & Select Model ONLY) */}
                {discountStep === 1 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                          {discountStrings.step1Title}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">{discountStrings.step1Subtitle}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddQuoteCreditsModalOpen(false);
                          setIsAddCreditModalOpen(false);
                        }}
                        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                        aria-label="Close"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    <div className="space-y-2 text-xs">
                      <label className="block font-semibold text-slate-700 dark:text-slate-300">
                        {discountStrings.step1SectionLabel}
                      </label>
                      <div className="grid grid-cols-1 gap-2.5">
                        {SELLER_DISCOUNT_MODES.map((mode) => (
                          <button
                            key={mode.id}
                            type="button"
                            onClick={() => {
                              setSelectedDiscountMode(mode.label);
                              setDiscountStep(2);
                            }}
                            className={`p-3 rounded-xl border text-left transition flex items-center justify-between group cursor-pointer ${
                              selectedDiscountMode === mode.label
                                ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-950 dark:text-emerald-100 ring-1 ring-emerald-500'
                                : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                            }`}
                          >
                            <div className="space-y-0.5">
                              <span className="font-bold text-sm text-slate-900 dark:text-white block group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                                {mode.label}
                              </span>
                              <span className="text-xs text-slate-500 dark:text-slate-400 block">
                                {mode.description}
                              </span>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-500 transition" />
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddQuoteCreditsModalOpen(false);
                          setIsAddCreditModalOpen(false);
                        }}
                        className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition cursor-pointer"
                      >
                        {discountStrings.cancelBtn}
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 2: Select Billing Duration */}
                {discountStep === 2 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                          {discountStrings.step2Title}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {formatString(discountStrings.step2Subtitle, { mode: selectedDiscountMode })}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddQuoteCreditsModalOpen(false);
                          setIsAddCreditModalOpen(false);
                        }}
                        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                        aria-label="Close"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    <div className="space-y-2 text-xs">
                      <label className="block font-semibold text-slate-700 dark:text-slate-300">
                        {discountStrings.step2SectionLabel}
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {DISCOUNT_BILLING_DURATIONS.map((dur) => (
                          <button
                            key={dur.id}
                            type="button"
                            onClick={() => {
                              setSelectedBillingDuration(dur.label);
                              setDiscountStep(3);
                            }}
                            className={`p-3 rounded-xl border text-left transition flex items-center justify-between group cursor-pointer ${
                              selectedBillingDuration === dur.label
                                ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-950 dark:text-emerald-100 ring-1 ring-emerald-500'
                                : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                            }`}
                          >
                            <div className="space-y-0.5">
                              <span className="font-bold text-sm text-slate-900 dark:text-white block group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                                {dur.label}
                              </span>
                              <span className="text-xs text-slate-500 dark:text-slate-400 block">
                                {dur.months} Months
                              </span>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-500 transition" />
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => setDiscountStep(1)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition cursor-pointer"
                      >
                        <ArrowLeft size={14} />
                        {discountStrings.backBtn}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddQuoteCreditsModalOpen(false);
                          setIsAddCreditModalOpen(false);
                        }}
                        className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition cursor-pointer"
                      >
                        {discountStrings.cancelBtn}
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 3: Enter Discount Percentage & Review Price Breakdown */}
                {discountStep === 3 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                          {discountStrings.step3Title}
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddQuoteCreditsModalOpen(false);
                          setIsAddCreditModalOpen(false);
                        }}
                        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                        aria-label="Close"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    <form onSubmit={handleAddQuoteCreditsSubmit} className="space-y-3 text-xs">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                        {/* Form Inputs (Left Column on Desktop) */}
                        <div className="space-y-2.5">
                          {/* Seller Name (Read-Only) */}
                          <div>
                            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                              Seller Name
                            </label>
                            <input
                              type="text"
                              readOnly
                              value={displayName}
                              className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-semibold cursor-not-allowed"
                            />
                          </div>

                          {/* Selected Mode & Billing Duration (Read-Only) */}
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                {discountStrings.selectedModeLabel}
                              </label>
                              <input
                                type="text"
                                readOnly
                                value={selectedDiscountMode}
                                className="w-full px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-semibold cursor-not-allowed truncate"
                              />
                            </div>
                            <div>
                              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                {discountStrings.billingDurationLabel}
                              </label>
                              <input
                                type="text"
                                readOnly
                                value={selectedBillingDuration}
                                className="w-full px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-semibold cursor-not-allowed"
                              />
                            </div>
                          </div>

                          {/* Original Plan Price & Discount Percentage */}
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                {discountStrings.originalPlanPriceLabel}
                              </label>
                              <div className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-bold">
                                ₹{originalDiscountPlanPrice.toLocaleString('en-IN')}
                              </div>
                            </div>
                            <div>
                              <label htmlFor="seller-discount-percentage" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                {discountStrings.discountPercentageLabel} <span className="text-rose-500">*</span>
                              </label>
                              <input
                                id="seller-discount-percentage"
                                type="number"
                                min="0"
                                max="100"
                                step="any"
                                value={discountPercentage}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value);
                                  setDiscountPercentage(isNaN(val) ? 0 : val);
                                }}
                                placeholder="0"
                                className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                                required
                              />
                            </div>
                          </div>

                          {/* Initiated By & Assigned Approver */}
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label htmlFor="discount-initiator" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                {discountStrings.initiatedByLabel} <span className="text-rose-500">*</span>
                              </label>
                              <select
                                id="discount-initiator"
                                value={quoteCreditInitiator}
                                onChange={(e) => setQuoteCreditInitiator(e.target.value)}
                                className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer"
                                required
                              >
                                <option value="">{UI_STRINGS.actionCenter.tasks.selectAssignee}</option>
                                {sellerInitiatorSelectOptions.map((user) => (
                                  <option key={user} value={user}>
                                    {user}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label htmlFor="quote-credit-approver" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                {discountStrings.assignedApproverLabel} <span className="text-rose-500">*</span>
                              </label>
                              <select
                                id="quote-credit-approver"
                                value={quoteCreditApprover}
                                onChange={(e) => setQuoteCreditApprover(e.target.value)}
                                className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer"
                                required
                              >
                                <option value="">{discountStrings.approverPlaceholder}</option>
                                {sellerApproverSelectOptions.map((appr) => (
                                  <option key={appr} value={appr}>
                                    {appr}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* Request Reason / Justification */}
                          <div>
                            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                              {discountStrings.reasonLabel}
                            </label>
                            <textarea
                              rows={1.5}
                              value={quoteCreditsReason}
                              onChange={(e) => setQuoteCreditsReason(e.target.value)}
                              placeholder={discountStrings.reasonPlaceholder}
                              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                            />
                          </div>
                        </div>

                        {/* Price Breakdown Table (Right Column on Desktop) */}
                        <div className="space-y-1.5">
                          <span className="block font-semibold text-slate-700 dark:text-slate-300">
                            {discountStrings.priceBreakdownHeading}
                          </span>
                          <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-slate-50/60 dark:bg-slate-800/40">
                            <table className="w-full text-xs">
                              <thead className="bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                <tr>
                                  <th className="px-3 py-1.5 text-left">{discountStrings.colDescription}</th>
                                  <th className="px-3 py-1.5 text-right">{discountStrings.colAmount}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                <tr>
                                  <td className="px-3 py-1 text-slate-700 dark:text-slate-300 font-medium">
                                    {discountStrings.rowOriginalPrice}
                                  </td>
                                  <td className="px-3 py-1 text-right font-medium text-slate-900 dark:text-white">
                                    ₹{originalDiscountPlanPrice.toLocaleString('en-IN')}
                                  </td>
                                </tr>
                                <tr>
                                  <td className="px-3 py-1 text-slate-700 dark:text-slate-300 font-medium">
                                    {discountStrings.rowDiscountPercent}
                                  </td>
                                  <td className="px-3 py-1 text-right font-medium text-slate-900 dark:text-white">
                                    {discountBreakdown.discountPercentage}%
                                  </td>
                                </tr>
                                <tr>
                                  <td className="px-3 py-1 text-rose-600 dark:text-rose-400 font-medium">
                                    {discountStrings.rowDiscountAmount}
                                  </td>
                                  <td className="px-3 py-1 text-right font-semibold text-rose-600 dark:text-rose-400">
                                    −₹{discountBreakdown.discountAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                </tr>
                                <tr>
                                  <td className="px-3 py-1 text-slate-700 dark:text-slate-300 font-medium">
                                    {discountStrings.rowRemainingAmount}
                                  </td>
                                  <td className="px-3 py-1 text-right font-medium text-slate-900 dark:text-white">
                                    ₹{discountBreakdown.remainingAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                </tr>
                                <tr>
                                  <td className="px-3 py-1 text-indigo-600 dark:text-indigo-400 font-medium">
                                    {discountStrings.rowGst}
                                  </td>
                                  <td className="px-3 py-1 text-right font-semibold text-indigo-600 dark:text-indigo-400">
                                    +₹{discountBreakdown.gstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                </tr>
                                <tr className="bg-emerald-50 dark:bg-emerald-950/50 font-bold border-t border-emerald-200 dark:border-emerald-800/60">
                                  <td className="px-3 py-1.5 text-emerald-900 dark:text-emerald-100">
                                    {discountStrings.rowFinalPayable}
                                  </td>
                                  <td className="px-3 py-1.5 text-right text-emerald-700 dark:text-emerald-300 font-extrabold">
                                    ₹{discountBreakdown.finalPayableAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>

                      {/* Controls */}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                        <button
                          type="button"
                          onClick={() => setDiscountStep(2)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition cursor-pointer"
                        >
                          <ArrowLeft size={14} />
                          {discountStrings.backBtn}
                        </button>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setIsAddQuoteCreditsModalOpen(false);
                              setIsAddCreditModalOpen(false);
                            }}
                            className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition cursor-pointer"
                          >
                            {discountStrings.cancelBtn}
                          </button>
                          <button
                            type="submit"
                            disabled={isSubmittingQuoteCredits || discountPercentage < 0 || discountPercentage > 100 || !quoteCreditApprover.trim()}
                            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition disabled:opacity-50 cursor-pointer"
                          >
                            {isSubmittingQuoteCredits
                              ? (discountStrings.submittingBtn)
                              : (discountStrings.submitBtn)}
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                )}
              </>
            ) : selectedRequestType === 'Trial Period' || selectedRequestType === 'Trial Periods' ? (
              // Trial Period 2-Step Workflow (Connect Model & Select Model ONLY)
              <>
                {trialPeriodStep === 1 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                          {trialPeriodStrings.step1Title}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">{trialPeriodStrings.step1Subtitle}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddQuoteCreditsModalOpen(false);
                          setIsAddCreditModalOpen(false);
                        }}
                        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                        aria-label="Close"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    <div className="space-y-2 text-xs">
                      <label className="block font-semibold text-slate-700 dark:text-slate-300">
                        {trialPeriodStrings.step1SectionLabel}
                      </label>
                      <div className="grid grid-cols-1 gap-2.5">
                        {SELLER_TRIAL_PERIOD_MODES.map((mode) => (
                          <button
                            key={mode.id}
                            type="button"
                            onClick={() => {
                              setSelectedTrialMode(mode.label);
                              setTrialPeriodStep(2);
                            }}
                            className={`p-3.5 rounded-xl border text-left transition flex items-center justify-between group cursor-pointer ${
                              selectedTrialMode === mode.label
                                ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-950 dark:text-emerald-100 ring-1 ring-emerald-500'
                                : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                            }`}
                          >
                            <div className="space-y-0.5">
                              <span className="font-bold text-sm text-slate-900 dark:text-white block group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                                {mode.label}
                              </span>
                              <span className="text-xs text-slate-500 dark:text-slate-400 block">
                                {mode.description}
                              </span>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-500 transition" />
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddQuoteCreditsModalOpen(false);
                          setIsAddCreditModalOpen(false);
                        }}
                        className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition cursor-pointer"
                      >
                        {trialPeriodStrings.cancelBtn}
                      </button>
                    </div>
                  </div>
                )}

                {trialPeriodStep === 2 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                          {trialPeriodStrings.step2Title}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {trialPeriodStrings.step2Subtitle}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddQuoteCreditsModalOpen(false);
                          setIsAddCreditModalOpen(false);
                        }}
                        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                        aria-label="Close"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    <form onSubmit={handleAddQuoteCreditsSubmit} className="space-y-3 text-xs">
                      {/* 1. Seller Name & Mode (2 cols) */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            Seller Name
                          </label>
                          <input
                            type="text"
                            readOnly
                            value={displayName}
                            className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-semibold cursor-not-allowed text-xs"
                          />
                        </div>
                        <div>
                          <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {trialPeriodStrings.selectedModeLabel}
                          </label>
                          <input
                            type="text"
                            readOnly
                            value={selectedTrialMode}
                            className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-semibold cursor-not-allowed text-xs"
                          />
                        </div>
                      </div>

                      {/* Starting Date & Ending Date */}
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label htmlFor="trial-start-date" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {trialPeriodStrings.startDateLabel}
                          </label>
                          <input
                            id="trial-start-date"
                            type="date"
                            value={trialStartDate}
                            onChange={(e) => handleTrialStartDateChange(e.target.value)}
                            className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                          />
                        </div>
                        <div>
                          <label htmlFor="trial-end-date" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {trialPeriodStrings.endDateLabel}
                          </label>
                          <input
                            id="trial-end-date"
                            type="date"
                            value={trialEndDate}
                            onChange={(e) => handleTrialEndDateChange(e.target.value)}
                            className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                          />
                        </div>
                      </div>

                      {trialDateError && (
                        <div className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs">
                          {trialDateError}
                        </div>
                      )}

                      {/* Initiated By & Assigned Approver (2 cols) */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label htmlFor="trial-initiator" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {trialPeriodStrings.initiatedByLabel} <span className="text-rose-500">*</span>
                          </label>
                          <select
                            id="trial-initiator"
                            value={quoteCreditInitiator}
                            onChange={(e) => setQuoteCreditInitiator(e.target.value)}
                            className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer text-xs"
                            required
                          >
                            <option value="">{trialPeriodStrings.selectUserPlaceholder}</option>
                            {sellerInitiatorSelectOptions.map((user) => (
                              <option key={user} value={user}>
                                {user}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="quote-credit-approver" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {trialPeriodStrings.assignedApproverLabel} <span className="text-rose-500">*</span>
                          </label>
                          <select
                            id="quote-credit-approver"
                            value={quoteCreditApprover}
                            onChange={(e) => setQuoteCreditApprover(e.target.value)}
                            className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer text-xs"
                            required
                          >
                            <option value="">{trialPeriodStrings.selectApproverPlaceholder}</option>
                            {sellerApproverSelectOptions.map((appr) => (
                              <option key={appr} value={appr}>
                                {appr}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Remarks */}
                      <div>
                        <label htmlFor="trial-remarks" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          {trialPeriodStrings.reasonLabel}
                        </label>
                        <textarea
                          id="trial-remarks"
                          rows={1.5}
                          value={quoteCreditsReason}
                          onChange={(e) => setQuoteCreditsReason(e.target.value)}
                          placeholder={trialPeriodStrings.reasonPlaceholder}
                          className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                        />
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                        <button
                          type="button"
                          onClick={() => setTrialPeriodStep(1)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition cursor-pointer"
                        >
                          <ArrowLeft size={14} />
                          {trialPeriodStrings.backBtn}
                        </button>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setIsAddQuoteCreditsModalOpen(false);
                              setIsAddCreditModalOpen(false);
                            }}
                            className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition cursor-pointer"
                          >
                            {trialPeriodStrings.cancelBtn}
                          </button>
                          <button
                            type="submit"
                            disabled={isSubmittingQuoteCredits || trialDays <= 0 || !quoteCreditApprover.trim() || !quoteCreditInitiator.trim() || Boolean(trialDateError)}
                            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition disabled:opacity-50 cursor-pointer"
                          >
                            {isSubmittingQuoteCredits
                              ? (trialPeriodStrings.submittingBtn)
                              : (trialPeriodStrings.submitBtn)}
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                )}
              </>
            ) : selectedRequestType === 'Offline Payments' ? (
              // Dedicated Offline Payment Approval Form
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      {offlinePaymentStrings.modalTitle}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddQuoteCreditsModalOpen(false);
                      setIsAddCreditModalOpen(false);
                    }}
                    className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>

                <form onSubmit={handleConfirmOfflinePayment} className="space-y-3 text-xs">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                    {/* Left Column: Payment Details */}
                    <div className="space-y-2.5">
                      {/* Seller Name & Mode (2 cols) */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            Seller Name
                          </label>
                          <input
                            type="text"
                            readOnly
                            value={displayName}
                            className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-semibold cursor-not-allowed text-xs"
                          />
                        </div>

                        <div>
                          <label htmlFor="offline-sourcing-mode-select" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            Seller Sourcing Mode
                          </label>
                          <select
                            id="offline-sourcing-mode-select"
                            value={offlineSellerSourceMode}
                            onChange={(e) => setOfflineSellerSourceMode(e.target.value)}
                            className="w-full px-3 py-1.5 bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-800 dark:text-emerald-200 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                          >
                            <option value="Connect Model">Connect Model</option>
                            <option value="Select Model">Select Model</option>
                          </select>
                        </div>
                      </div>

                      {/* Payment Date & Type (2 cols) */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label htmlFor="offline-payment-date" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {offlinePaymentStrings.paymentDateLabel} <span className="text-rose-500">*</span>
                          </label>
                          <input
                            id="offline-payment-date"
                            type="date"
                            value={offlinePaymentDate}
                            onChange={(e) => setOfflinePaymentDate(e.target.value)}
                            className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                            required
                          />
                        </div>

                        <div>
                          <label htmlFor="offline-payment-type-select" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {offlinePaymentStrings.paymentTypeLabel} <span className="text-rose-500">*</span>
                          </label>
                          <select
                            id="offline-payment-type-select"
                            data-testid="offline-payment-type-select"
                            value={offlinePaymentType}
                            onChange={(e) => setOfflinePaymentType(e.target.value as OfflinePaymentType)}
                            className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                            required
                          >
                            {OFFLINE_PAYMENT_TYPES.map((type) => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Transaction ID */}
                      {offlinePaymentType !== 'Cash' && (
                        <div>
                          <label htmlFor="offline-transaction-id" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {offlinePaymentStrings.transactionIdLabel} <span className="text-rose-500">*</span>
                          </label>
                          <input
                            id="offline-transaction-id"
                            type="text"
                            value={offlineTransactionId}
                            onChange={(e) => setOfflineTransactionId(e.target.value)}
                            placeholder={offlinePaymentStrings.transactionIdPlaceholder}
                            className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                            required
                          />
                        </div>
                      )}

                      {/* Payment Amount */}
                      <div>
                        <label htmlFor="offline-payment-amount" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          {offlinePaymentStrings.paymentAmountLabel} <span className="text-rose-500">*</span>
                        </label>
                        <input
                          id="offline-payment-amount"
                          type="number"
                          min="1"
                          step="any"
                          value={offlinePaymentAmount || ''}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setOfflinePaymentAmount(isNaN(val) ? 0 : val);
                          }}
                          placeholder={offlinePaymentStrings.paymentAmountPlaceholder}
                          className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                          required
                        />
                      </div>
                    </div>

                    {/* Right Column: Upload Proof, Initiator, Approver, Remarks */}
                    <div className="space-y-2.5">
                      {/* Payment Image Proof Upload */}
                      <div>
                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          {offlinePaymentStrings.paymentProofLabel}
                        </label>
                        <input
                          ref={offlineFileInputRef}
                          type="file"
                          accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                          onChange={handleOfflineProofFileSelect}
                          className="hidden"
                          id="seller-offline-proof-file-input"
                          data-testid="offline-proof-file-input"
                        />

                        {offlineProofPreviewUrl ? (
                          <div className="p-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-slate-700 dark:text-slate-300 truncate max-w-[200px]" title={offlineProofFileName}>
                                {offlineProofFileName}
                              </span>
                              <button
                                type="button"
                                onClick={handleRemoveOfflineProof}
                                className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition cursor-pointer"
                                title="Remove attachment"
                              >
                                <X size={14} />
                              </button>
                            </div>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={offlineProofPreviewUrl}
                              alt="Proof preview"
                              className="max-h-24 w-auto rounded border border-slate-200 dark:border-slate-700 object-contain mx-auto"
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => offlineFileInputRef.current?.click()}
                            className="w-full py-2.5 px-3 border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-emerald-500 rounded-xl bg-slate-50/50 dark:bg-slate-800/30 text-center transition cursor-pointer flex flex-col items-center justify-center gap-1"
                          >
                            <Upload className="w-4 h-4 text-slate-400" />
                            <span className="text-slate-600 dark:text-slate-300 font-medium text-[11px]">
                              {offlinePaymentStrings.paymentProofHelp}
                            </span>
                          </button>
                        )}
                      </div>

                      {/* Initiated By & Approver (2 cols) */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label htmlFor="offline-initiator" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {offlinePaymentStrings.initiatedByLabel} <span className="text-rose-500">*</span>
                          </label>
                          <select
                            id="offline-initiator"
                            value={offlineInitiatorName}
                            onChange={(e) => {
                              const val = e.target.value;
                              setOfflineInitiatorName(val);
                            }}
                            className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer text-xs"
                            required
                          >
                            <option value="">{offlinePaymentStrings.selectInitiatorPlaceholder}</option>
                            {sellerInitiatorSelectOptions.map((user) => (
                              <option key={user} value={user}>
                                {user}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label htmlFor="offline-approver" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {offlinePaymentStrings.assignedApproverLabel} <span className="text-rose-500">*</span>
                          </label>
                          <select
                            id="offline-approver"
                            value={offlineApproverName}
                            onChange={(e) => {
                              const val = e.target.value;
                              setOfflineApproverName(val);
                            }}
                            className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer text-xs"
                            required
                          >
                            <option value="">{offlinePaymentStrings.selectApproverPlaceholder}</option>
                            {sellerApproverSelectOptions.map((appr) => (
                              <option key={appr} value={appr}>
                                {appr}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Remarks */}
                      <div>
                        <label htmlFor="offline-remarks" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          {offlinePaymentStrings.reasonLabel}
                        </label>
                        <textarea
                          id="offline-remarks"
                          rows={1.5}
                          value={offlineRemarks}
                          onChange={(e) => setOfflineRemarks(e.target.value)}
                          placeholder={offlinePaymentStrings.reasonPlaceholder}
                          className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddQuoteCreditsModalOpen(false);
                        setIsAddCreditModalOpen(false);
                      }}
                      className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition cursor-pointer"
                    >
                      {offlinePaymentStrings.cancelBtn}
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingQuoteCredits}
                      className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition disabled:opacity-50 cursor-pointer"
                    >
                      {isSubmittingQuoteCredits
                        ? (offlinePaymentStrings.submittingBtn)
                        : (offlinePaymentStrings.submitBtn)}
                    </button>
                  </div>
                </form>
              </div>
            ) : selectedRequestType === 'Seller Credit Deletion' ? (
              // Seller Credit Deletion Modal
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      Request Seller Credit Deletion
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddQuoteCreditsModalOpen(false);
                      setIsAddCreditModalOpen(false);
                    }}
                    className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>

                <form onSubmit={handleAddQuoteCreditsSubmit} className="space-y-2.5 text-xs">
                  {/* Row 1: Seller Name & Available Credits (2 cols) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.sellerNameLabel}
                      </label>
                      <input
                        type="text"
                        readOnly
                        value={displayName}
                        className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-semibold cursor-not-allowed text-xs"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.currentCreditsLabel}
                      </label>
                      <div className="px-3 py-1.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg text-rose-700 dark:text-rose-300 font-bold text-xs">
                        {creditSummary?.remainingFreeCredits ?? getVendorCreditBalance(seller) ?? EMPTY_VALUE} Credits Available
                      </div>
                    </div>
                  </div>

                  {/* Row 2: Deduction Credits & Initiated By (2 cols) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Credits to Deduct <span className="text-rose-500">*</span>
                      </label>
                      <input
                        id="quote-credits-requested"
                        type="number"
                        min="1"
                        max={creditSummary?.remainingFreeCredits ?? getVendorCreditBalance(seller) ?? 1000}
                        value={requestedQuoteCredits}
                        onChange={(e) => setRequestedQuoteCredits(isNaN(parseInt(e.target.value, 10)) ? 0 : parseInt(e.target.value, 10))}
                        placeholder="0"
                        className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-bold focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 text-xs"
                        required
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.initiatorLabel} <span className="text-rose-500">*</span>
                      </label>
                      <select
                        id="quote-credit-initiator"
                        value={quoteCreditInitiator}
                        onChange={(e) => setQuoteCreditInitiator(e.target.value)}
                        className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 cursor-pointer text-xs"
                        required
                      >
                        <option value="">{UI_STRINGS.actionCenter.tasks.selectAssignee}</option>
                        {sellerInitiatorSelectOptions.map((user) => (
                          <option key={user} value={user}>
                            {user}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Row 3: Assigned Approver & Remarks (2 cols) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.approverLabel} <span className="text-rose-500">*</span>
                      </label>
                      <select
                        id="quote-credit-approver"
                        value={quoteCreditApprover}
                        onChange={(e) => setQuoteCreditApprover(e.target.value)}
                        className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 cursor-pointer text-xs"
                        required
                      >
                        <option value="">{UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.approverPlaceholder}</option>
                        {sellerApproverSelectOptions.map((appr) => (
                          <option key={appr} value={appr}>
                            {appr}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.reasonLabel}
                      </label>
                      <textarea
                        rows={1.5}
                        value={quoteCreditsReason}
                        onChange={(e) => setQuoteCreditsReason(e.target.value)}
                        placeholder="Reason for credit deletion..."
                        className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddQuoteCreditsModalOpen(false);
                        setIsAddCreditModalOpen(false);
                      }}
                      className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingQuoteCredits || requestedQuoteCredits <= 0}
                      className="px-4 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition disabled:opacity-50 cursor-pointer"
                    >
                      {isSubmittingQuoteCredits
                        ? UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.submittingBtn
                        : 'Submit for Approval'}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              // Default: Seller Credit Addition Modal
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      {UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.modalTitle}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddQuoteCreditsModalOpen(false);
                      setIsAddCreditModalOpen(false);
                    }}
                    className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>

                <form onSubmit={handleAddQuoteCreditsSubmit} className="space-y-2.5 text-xs">
                  {/* Row 1: Seller Name & Current Available Credits (2 cols) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.sellerNameLabel}
                      </label>
                      <input
                        type="text"
                        readOnly
                        value={displayName}
                        className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-semibold cursor-not-allowed text-xs"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.currentCreditsLabel}
                      </label>
                      <div className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-700 dark:text-emerald-300 font-bold text-xs">
                        {creditSummary?.remainingFreeCredits ?? getVendorCreditBalance(seller) ?? EMPTY_VALUE} Credits
                      </div>
                    </div>
                  </div>

                  {/* Row 2: Requested Credits & Initiated By (2 cols) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.requestedCreditsLabel} <span className="text-rose-500">*</span>
                      </label>
                      <input
                        id="quote-credits-requested"
                        type="number"
                        min="1"
                        max="1000"
                        value={requestedQuoteCredits}
                        onChange={(e) => setRequestedQuoteCredits(isNaN(parseInt(e.target.value, 10)) ? 0 : parseInt(e.target.value, 10))}
                        className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                        required
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.initiatorLabel} <span className="text-rose-500">*</span>
                      </label>
                      <select
                        id="quote-credit-initiator"
                        value={quoteCreditInitiator}
                        onChange={(e) => setQuoteCreditInitiator(e.target.value)}
                        className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer text-xs"
                        required
                      >
                        <option value="">{UI_STRINGS.actionCenter.tasks.selectAssignee}</option>
                        {sellerInitiatorSelectOptions.map((user) => (
                          <option key={user} value={user}>
                            {user}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Row 3: Assigned Approver & Remarks (2 cols) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.approverLabel} <span className="text-rose-500">*</span>
                      </label>
                      <select
                        id="quote-credit-approver"
                        value={quoteCreditApprover}
                        onChange={(e) => setQuoteCreditApprover(e.target.value)}
                        className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer text-xs"
                        required
                      >
                        <option value="">{UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.approverPlaceholder}</option>
                        {sellerApproverSelectOptions.map((appr) => (
                          <option key={appr} value={appr}>
                            {appr}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.reasonLabel}
                      </label>
                      <textarea
                        rows={1.5}
                        value={quoteCreditsReason}
                        onChange={(e) => setQuoteCreditsReason(e.target.value)}
                        placeholder={UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.reasonPlaceholder}
                        className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddQuoteCreditsModalOpen(false);
                        setIsAddCreditModalOpen(false);
                      }}
                      className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingQuoteCredits || requestedQuoteCredits <= 0}
                      className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition disabled:opacity-50 cursor-pointer"
                    >
                      {isSubmittingQuoteCredits
                        ? UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.submittingBtn
                        : 'Submit for Approval'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Buyer Details Modal */}
      {selectedBuyerForModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedBuyerForModal(null);
          }}
        >
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {selectedBuyerForModal.companyName || selectedBuyerForModal.name || EMPTY_VALUE}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {strings.buyerUploads.buyerDetailsTitle}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBuyerForModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                aria-label={strings.buyerUploads.closeModal}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.buyerUploads.colBuyerName}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedBuyerForModal.name || EMPTY_VALUE}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.buyerUploads.colCompanyName}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedBuyerForModal.companyName || EMPTY_VALUE}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.buyerUploads.colContactPerson}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedBuyerForModal.contactPerson || EMPTY_VALUE}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.buyerUploads.colEmail}</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-medium break-all">{selectedBuyerForModal.email || EMPTY_VALUE}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.buyerUploads.colPhone}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedBuyerForModal.phone || EMPTY_VALUE}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.buyerUploads.sourcingModeLabel}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedBuyerForModal.sourcingMode || EMPTY_VALUE}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.buyerUploads.locationLabel}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedBuyerForModal.location || EMPTY_VALUE}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.buyerUploads.subscriptionPlanLabel}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedBuyerForModal.subscriptionPlan || EMPTY_VALUE}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.buyerUploads.colUploadDate}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">
                  {selectedBuyerForModal.uploadDate ? formatIndianDateTime(selectedBuyerForModal.uploadDate) : EMPTY_VALUE}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.buyerUploads.colStatus}</span>
                <span className="text-emerald-600 font-semibold">{selectedBuyerForModal.status || EMPTY_VALUE}</span>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setSelectedBuyerForModal(null)}
                className="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors cursor-pointer"
              >
                {strings.buyerUploads.closeModal}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active RFQ Details Modal */}
      {selectedActiveRfqForModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedActiveRfqForModal(null);
          }}
        >
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xl max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {selectedActiveRfqForModal.rfqNumber || selectedActiveRfqForModal.id} — {selectedActiveRfqForModal.title || EMPTY_VALUE}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {strings.activeRfqs.rfqDetailsTitle}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedActiveRfqForModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                aria-label={strings.activeRfqs.closeModal}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.activeRfqs.colCategory}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedActiveRfqForModal.procurementCategory || selectedActiveRfqForModal.category || EMPTY_VALUE}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.activeRfqs.colBuyerCompany}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedActiveRfqForModal.buyerCompanyName || selectedActiveRfqForModal.buyerCompany || selectedActiveRfqForModal.buyerName || EMPTY_VALUE}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.activeRfqs.colLocation}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedActiveRfqForModal.location || EMPTY_VALUE}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.activeRfqs.budgetLabel}</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                  {selectedActiveRfqForModal.budget != null && selectedActiveRfqForModal.budget > 0
                    ? formatCurrency(selectedActiveRfqForModal.budget)
                    : EMPTY_VALUE}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.activeRfqs.colPublishedDate}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">
                  {selectedActiveRfqForModal.publishedDate ? formatIndianDateTime(selectedActiveRfqForModal.publishedDate) : EMPTY_VALUE}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.activeRfqs.colClosingDate}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">
                  {selectedActiveRfqForModal.closingDate ? formatIndianDateTime(selectedActiveRfqForModal.closingDate) : EMPTY_VALUE}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.activeRfqs.sourcingModeLabel}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedActiveRfqForModal.sourcingMode || EMPTY_VALUE}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.activeRfqs.colStatus}</span>
                <span className="text-emerald-600 font-semibold">{selectedActiveRfqForModal.status || EMPTY_VALUE}</span>
              </div>
            </div>

            {/* Line items if available */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                {strings.activeRfqs.lineItemsLabel}
              </span>
              {Array.isArray(selectedActiveRfqForModal.extractedEntities) && selectedActiveRfqForModal.extractedEntities.length > 0 ? (
                <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] uppercase text-slate-500 font-bold">
                      <tr>
                        <th className="p-2">Item Description</th>
                        <th className="p-2">Qty</th>
                        <th className="p-2">Unit</th>
                        <th className="p-2">Target Price</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {selectedActiveRfqForModal.extractedEntities.map((ent, i) => (
                        <tr key={i} className="text-slate-700 dark:text-slate-300">
                          <td className="p-2 font-medium">{ent.itemName || ent.itemDescription || ent.rawText || ent.technicalSpecs || EMPTY_VALUE}</td>
                          <td className="p-2">{ent.quantity ?? EMPTY_VALUE}</td>
                          <td className="p-2">{ent.unit || EMPTY_VALUE}</td>
                          <td className="p-2">{ent.targetPrice != null ? formatCurrency(ent.targetPrice) : EMPTY_VALUE}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic p-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                  {strings.activeRfqs.noLineItems}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
              {onSelectRFQ ? (
                <button
                  type="button"
                  onClick={() => {
                    const rfqToSelect = selectedActiveRfqForModal as unknown as RFQItem;
                    setSelectedActiveRfqForModal(null);
                    onSelectRFQ(rfqToSelect);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open in RFQ Workspace</span>
                </button>
              ) : (
                <div />
              )}
              <button
                type="button"
                onClick={() => setSelectedActiveRfqForModal(null)}
                className="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors cursor-pointer"
              >
                {strings.activeRfqs.closeModal}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
