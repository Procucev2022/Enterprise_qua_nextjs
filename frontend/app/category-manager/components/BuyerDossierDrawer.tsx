'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  Calendar,
  Paperclip,
  Sparkles,
  ChevronDown,
  Upload,
  Users,
  ArrowLeft,
} from 'lucide-react';
import { getScenariosForEntityType, interpolateScenarioTemplate, getScenarioForCallOutcome } from '@/lib/emailScenarioTemplates';
import { fetchDocuments } from '@/lib/documentVaultClient';
import type {
  BuyerAccount,
  ActionCenterAttachment,
  DocumentVaultItem,
  RFQItem,
  BuyerCreditSummary,
  BuyerCreditTransaction,
  BuyerCommunicationItem,
  BuyerPaymentSummary,
  BuyerPaymentTransaction,
  InternalTeamMember,
  BuyerUploadedVendorItem,
} from '@/lib/types';
import {
  formatCurrency,
  formatIndianDateTime,
  RFQ_MODE_LABELS,
  CALL_OUTCOMES,
  FOLLOWUP_PRIORITIES,
  BUYER_PROFILE_REQUEST_TYPES,
  type BuyerProfileRequestType,
  calculateDiscountBreakdown,
  getStandardDiscountPlanPrice,
  DISCOUNT_SOURCING_MODES,
  DISCOUNT_BILLING_DURATIONS,
  OFFLINE_PAYMENT_TYPES,
  type OfflinePaymentType,
  BUYER_SOURCING_MODES,
  APPROVER_CONFIG,
  TRIAL_PERIOD_SOURCING_MODES,
  calculateTrialDaysFromDates,
  CREDIT_APPROVAL_APPROVERS,
  INTERNAL_TASK_USERS,
} from '@/lib/constants';
import {
  fetchApprovalApprovers,
  fetchApprovalUsers,
  type ApprovalApproverOption,
  type ApprovalUserOption,
} from '@/lib/approvalClient';
import { OFFLINE_PAYMENT_UPLOAD_SCHEMA } from '@/lib/validationSchemas';
import { fetchSubscriptionPricing, type SubscriptionPricingResponse } from '@/lib/subscriptionPaymentClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { logger } from '@/lib/logger';
import {
  fetchBuyerCreditHistory,
  updateBuyerCategories,
  fetchBuyerCommunications,
  recordBuyerCommunication,
  fetchBuyerPaymentHistory,
  fetchCategoryTaxonomy,
  fetchBuyerUploadedVendors,
} from '@/lib/buyerProfileClient';
import { fetchInternalAssignees } from '@/lib/internalTaskClient';
import { getMajorCategories, getAllUniqueMinorCategories, findMajorForMinor, setCategoryTaxonomy } from '@/lib/categoryTaxonomy';
import { authClient } from '@/lib/authClient';
import { createCreditApprovalIdempotencyKey, requestBuyerCreditApproval, type RequestBuyerCreditApprovalPayload } from '@/lib/accountDocumentsClient';
import AccountDocumentsTab from './AccountDocumentsTab';

interface BuyerDossierDrawerProps {
  buyer: BuyerAccount;
  onClose: () => void;
  onSelectRFQ?: (rfq: RFQItem) => void;
  buyerRfqs?: RFQItem[];
  initialCommunications?: BuyerCommunicationItem[];
  initialTab?: 'profile' | 'rfqs' | 'credits' | 'communications' | 'payments' | 'documents' | 'uploaded-vendors';
  onTabChange?: (tab: 'profile' | 'rfqs' | 'credits' | 'communications' | 'payments' | 'documents' | 'uploaded-vendors') => void;
}

// Shown wherever a value is missing from the record. Never a substitute value.
const EMPTY_VALUE = UI_STRINGS.dataLoad.emptyCell;

function resolveUserOrApprover(
  val: string,
  primaryList: readonly { id?: string; name?: string }[],
  fallbackList: readonly { id?: string; name?: string }[] = []
): { name: string; id: string } {
  const match = primaryList.find((item) => item.id === val || item.name === val) ??
    fallbackList.find((item) => item.id === val || item.name === val);
  return {
    name: match?.name ?? val,
    id: match?.id ?? '',
  };
}

const DEFAULT_CREDIT_APPROVAL = { ...UI_STRINGS.buyerDirectory.dossier.creditApproval };
const DEFAULT_DISCOUNT_WORKFLOW = { ...DEFAULT_CREDIT_APPROVAL.discountWorkflow };
const DEFAULT_OFFLINE_PAYMENT_WORKFLOW = { ...DEFAULT_CREDIT_APPROVAL.offlinePaymentWorkflow };

export default function BuyerDossierDrawer({
  buyer,
  onClose,
  onSelectRFQ,
  buyerRfqs = [],
  initialCommunications = [],
  initialTab = 'profile',
  onTabChange,
}: BuyerDossierDrawerProps) {
  const strings = UI_STRINGS.buyerDirectory.dossier;
  const creditApprovalStrings = strings.creditApproval || DEFAULT_CREDIT_APPROVAL;
  const discountStrings = creditApprovalStrings.discountWorkflow || DEFAULT_DISCOUNT_WORKFLOW;
  const offlinePaymentStrings = creditApprovalStrings.offlinePaymentWorkflow || DEFAULT_OFFLINE_PAYMENT_WORKFLOW;

  // Active Main Tab with context preservation
  const [dossierTab, setDossierTabState] = useState<'profile' | 'rfqs' | 'credits' | 'communications' | 'payments' | 'documents' | 'uploaded-vendors'>(initialTab);
  const [docCount, setDocCount] = useState<number>(0);
  const setDossierTab = useCallback((tab: 'profile' | 'rfqs' | 'credits' | 'communications' | 'payments' | 'documents' | 'uploaded-vendors') => {
    setDossierTabState(tab);
    if (onTabChange) onTabChange(tab);
  }, [onTabChange]);

  // Buyer Uploaded Vendors state
  const [uploadedVendors, setUploadedVendors] = useState<BuyerUploadedVendorItem[]>([]);
  const [loadingUploadedVendors, setLoadingUploadedVendors] = useState<boolean>(false);
  const [uploadedVendorsError, setUploadedVendorsError] = useState<string | null>(null);
  const [uploadedVendorSearch, setUploadedVendorSearch] = useState<string>('');
  const [uploadedVendorStatusFilter, setUploadedVendorStatusFilter] = useState<string>('ALL');
  const [selectedVendorForModal, setSelectedVendorForModal] = useState<BuyerUploadedVendorItem | null>(null);

  const loadUploadedVendors = useCallback(async () => {
    if (!buyer?.id) return;
    setLoadingUploadedVendors(true);
    setUploadedVendorsError(null);
    try {
      const res = await fetchBuyerUploadedVendors(buyer.id);
      if (res.success && Array.isArray(res.data)) {
        setUploadedVendors(res.data);
      } else {
        setUploadedVendorsError(res.error || strings.uploadedVendors.loadError);
      }
    } catch (err: unknown) {
      setUploadedVendorsError(err instanceof Error ? err.message : strings.uploadedVendors.loadError);
    } finally {
      setLoadingUploadedVendors(false);
    }
  }, [buyer?.id, strings.uploadedVendors.loadError]);

  useEffect(() => {
    void loadUploadedVendors();
  }, [loadUploadedVendors]);

  const filteredUploadedVendors = useMemo(() => {
    return uploadedVendors.filter((v) => {
      if (uploadedVendorStatusFilter !== 'ALL' && (v.status || '').toUpperCase() !== uploadedVendorStatusFilter.toUpperCase()) {
        return false;
      }
      if (uploadedVendorSearch.trim()) {
        const q = uploadedVendorSearch.toLowerCase();
        const matchName = (v.name || '').toLowerCase().includes(q);
        const matchComp = (v.companyName || '').toLowerCase().includes(q);
        const matchContact = (v.contactPerson || '').toLowerCase().includes(q);
        const matchEmail = (v.email || '').toLowerCase().includes(q);
        const matchPhone = (v.phone || '').toLowerCase().includes(q);
        return matchName || matchComp || matchContact || matchEmail || matchPhone;
      }
      return true;
    });
  }, [uploadedVendors, uploadedVendorSearch, uploadedVendorStatusFilter]);

  // Active Communications Sub-Tab
  const [commSubTab, setCommSubTab] = useState<'all' | 'email' | 'sms' | 'whatsapp' | 'call'>('all');
  const [isComposeOpen, setIsComposeOpen] = useState<boolean>(false);
  const [composeChannel, setComposeChannel] = useState<'EMAIL' | 'SMS' | 'WHATSAPP' | 'CALL'>('EMAIL');
  const [composeSubject, setComposeSubject] = useState<string>('');
  const [composeMessage, setComposeMessage] = useState<string>('');
  const [composeRecipient, setComposeRecipient] = useState<string>(buyer.corporateEmail || buyer.mobileNumber || '');
  const [composeCallOutcome, setComposeCallOutcome] = useState<string>('');
  const [composeDuration, setComposeDuration] = useState<string>('');
  const [composeNextFollowupDate, setComposeNextFollowupDate] = useState<string>('');
  const [composeFollowupPriority, setComposeFollowupPriority] = useState<'Low' | 'Medium' | 'High' | 'Critical'>('Medium');
  const [composeFollowupAssigneeId, setComposeFollowupAssigneeId] = useState<string>('');
  const [composeFollowupAssigneeName, setComposeFollowupAssigneeName] = useState<string>('');
  const [assignees, setAssignees] = useState<InternalTeamMember[]>([]);
  const [assigneesError, setAssigneesError] = useState<string | null>(null);
  const [majorCategoryOptions, setMajorCategoryOptions] = useState<string[]>(() => getMajorCategories());
  const [majorCategoryError, setMajorCategoryError] = useState<string | null>(null);
  const [composeFollowupNotes, setComposeFollowupNotes] = useState<string>('');
  const [composeScenarioId, setComposeScenarioId] = useState<string>('');
  const [availableVaultDocs, setAvailableVaultDocs] = useState<DocumentVaultItem[]>([]);
  // Why the vault document list could not be read. Null when it loaded, or while it is loading.
  const [vaultLoadError, setVaultLoadError] = useState<string | null>(null);
  const [composeAttachments, setComposeAttachments] = useState<ActionCenterAttachment[]>([]);
  const [isVaultDropdownOpen, setIsVaultDropdownOpen] = useState<boolean>(false);

  useEffect(() => {
    let isSubscribed = true;
    fetchDocuments({ activeOnly: true })
      .then((docs: DocumentVaultItem[]) => {
        if (!isSubscribed) return;
        setAvailableVaultDocs(docs);
        setVaultLoadError(null);
      })
      .catch((err: unknown) => {
        if (!isSubscribed) return;
        setVaultLoadError(
          err instanceof Error && err.message
            ? err.message
            : formatString(UI_STRINGS.dataLoad.networkFailed, { resource: UI_STRINGS.dataLoad.resources.documentVault })
        );
      });
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

  const handleBuyerScenarioChange = useCallback((scId: string) => {
    setComposeScenarioId(scId);
    if (!scId || scId === 'custom') return;
    const scenarios = getScenariosForEntityType('BUYER');
    const sc = scenarios.find((s) => s.id === scId);
    if (!sc) return;
    // Each token holds only what the buyer record, the user, or the form supplies.
    // A token without a value renders as an empty string in the template.
    const tokens: Record<string, string | number | undefined> = {
      contactName: buyer.contactPerson,
      companyName: buyer.organizationName,
      entityId: buyer.id,
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
  }, [buyer, composeNextFollowupDate, composeFollowupNotes, composeFollowupAssigneeName, composeMessage, availableVaultDocs]);

  const handleDraftEmailForCallOutcome = useCallback((outcome: string) => {
    setComposeChannel('EMAIL');
    setComposeRecipient(buyer.corporateEmail || '');
    setCommSubTab('email');
    const matchedScenario = getScenarioForCallOutcome('BUYER', outcome);
    if (matchedScenario) {
      handleBuyerScenarioChange(matchedScenario.id);
    } else {
      handleBuyerScenarioChange('buyer_conversion_followup');
    }
  }, [buyer.corporateEmail, handleBuyerScenarioChange]);

  const handleConvertCallToFollowupEmail = useCallback(() => {
    setComposeChannel('EMAIL');
    setComposeRecipient(buyer.corporateEmail || '');
    setCommSubTab('email');
    handleBuyerScenarioChange('buyer_conversion_followup');
  }, [buyer.corporateEmail, handleBuyerScenarioChange]);

  const [isSendingComm, setIsSendingComm] = useState<boolean>(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isComposeOpen) {
        setIsComposeOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isComposeOpen]);

  // Toast feedback
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // A local attachment gets its id from the platform's secure random source. Math.random is not used.
  // Without randomUUID the file is not attached, and the user is told why.
  const handleLocalBuyerFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (typeof globalThis.crypto?.randomUUID !== 'function') {
      showToast(UI_STRINGS.dataLoad.secureIdUnavailable, 'error');
      e.target.value = '';
      return;
    }
    const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    const newAtt: ActionCenterAttachment = {
      id: `local_${globalThis.crypto.randomUUID()}`,
      documentName: `${cleanName} (Local Upload)`,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'application/octet-stream',
      category: 'local_upload',
    };
    setComposeAttachments((prev) => [...prev, newAtt]);
    e.target.value = '';
  }, [showToast]);

  // ---------------------------------------------------------------------------
  // 1. CATEGORIES MANAGEMENT (Tab 1: Profile)
  // ---------------------------------------------------------------------------
  const [isEditCategoriesOpen, setIsEditCategoriesOpen] = useState<boolean>(false);
  const [currentCategories, setCurrentCategories] = useState<string[]>(buyer.supportedMajorCategories || []);
  const [selectedCategoriesDraft, setSelectedCategoriesDraft] = useState<string[]>(currentCategories);
  const [newCategoryInput, setNewCategoryInput] = useState<string>('');
  const [showCategorySuggestions, setShowCategorySuggestions] = useState<boolean>(false);
  const [isSubmittingCategories, setIsSubmittingCategories] = useState<boolean>(false);

  const allAvailableMinorCategories = useMemo(() => {
    return getAllUniqueMinorCategories();
  }, []);

  const filteredCategorySuggestions = useMemo(() => {
    const q = newCategoryInput.trim().toLowerCase();
    if (q.length < 3) return [];
    return allAvailableMinorCategories.filter((cat) => cat.toLowerCase().includes(q));
  }, [newCategoryInput, allAvailableMinorCategories]);

  useEffect(() => {
    setCurrentCategories(buyer.supportedMajorCategories || []);
    setSelectedCategoriesDraft(buyer.supportedMajorCategories || []);
  }, [buyer.supportedMajorCategories]);

  const handleToggleCategory = (cat: string) => {
    setSelectedCategoriesDraft((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleAddCategoryTag = (cat: string) => {
    const clean = cat.trim();
    if (clean && !selectedCategoriesDraft.includes(clean)) {
      setSelectedCategoriesDraft((prev) => [...prev, clean]);
    }
    setNewCategoryInput('');
    setShowCategorySuggestions(false);
  };

  const handleAddNewCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (filteredCategorySuggestions.length > 0 && showCategorySuggestions) {
      handleAddCategoryTag(filteredCategorySuggestions[0]);
    } else if (newCategoryInput.trim()) {
      handleAddCategoryTag(newCategoryInput.trim());
    }
  };

  const handleSaveCategories = async () => {
    setIsSubmittingCategories(true);
    try {
      const res = await updateBuyerCategories(buyer.id, selectedCategoriesDraft);
      if (res.success) {
        setCurrentCategories(selectedCategoriesDraft);
        setIsEditCategoriesOpen(false);
        showToast('Supported divisions updated successfully.');
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
  const [creditHistoryAvailable, setCreditHistoryAvailable] = useState<boolean | null>(null);
  const [loadingCredit, setLoadingCredit] = useState<boolean>(false);
  const [creditSearch, setCreditSearch] = useState<string>('');
  const [creditTypeFilter, setCreditTypeFilter] = useState<string>('all');
  const [creditSortOrder, setCreditSortOrder] = useState<'asc' | 'desc'>('desc');
  const [creditPage, setCreditPage] = useState<number>(1);
  const creditPageSize = 10;

  // Add Credit / Request Type modal states
  const [isAddCreditModalOpen, setIsAddCreditModalOpen] = useState<boolean>(false);
  const [selectedRequestType, setSelectedRequestType] = useState<BuyerProfileRequestType>('Buyer Credit Addition');
  const [isRequestTypeDropdownOpen, setIsRequestTypeDropdownOpen] = useState<boolean>(false);
  const requestTypeDropdownRef = useRef<HTMLDivElement>(null);
  const [applicationUsers, setApplicationUsers] = useState<ApprovalUserOption[]>([
    { id: 'usr-govardhan', name: 'Govardhan', email: 'govardhan@procucev.com' },
    { id: 'usr-krishna', name: 'Krishna', email: 'krishna@procucev.com' },
    { id: 'session-user-1', name: 'Session Initiator', email: 'initiator@example.com' },
    { id: 'usr-buyer-001', name: 'Test Buyer', email: 'test.buyer@example.com' },
  ]);
  const [authorizedApprovers, setAuthorizedApprovers] = useState<ApprovalApproverOption[]>([
    { id: 'appr-srinu', name: 'Srinu Sir', title: 'VP Sourcing' },
    { id: 'appr-rao', name: 'Rao Sir', title: 'Director' },
    { id: 'appr-sudheer', name: 'Sudheer Sir', title: 'Head of Procurement' },
  ]);
  const [creditApprover, setCreditApprover] = useState<string>('Srinu Sir');
  const [creditApproverId, setCreditApproverId] = useState<string>('appr-srinu');
  const [creditInitiator, setCreditInitiator] = useState<string>(() => {
    const session = authClient.getSessionUser();
    if (!session) return '';
    return (session.name && session.name.toLowerCase() !== 'category manager') ? session.name : 'Govardhan';
  });
  const [creditInitiatorId, setCreditInitiatorId] = useState<string>(() => authClient.getSessionUser()?.id ?? '');

  useEffect(() => {
    const session = authClient.getSessionUser();
    if (session?.name && session.name.toLowerCase() !== 'category manager' && !creditInitiator) {
      setCreditInitiator(session.name);
      setCreditInitiatorId(session.id || '');
    }
  }, [creditInitiator]);

  const internalTaskUserOptions = useMemo(() => {
    const list: string[] = [...INTERNAL_TASK_USERS];
    for (const a of assignees) {
      if (a?.name && !list.some((name) => name.toLowerCase() === a.name.toLowerCase())) {
        list.push(a.name);
      }
    }
    return list;
  }, [assignees]);
  const [addCreditAmount, setAddCreditAmount] = useState<number>(0);
  const [paymentReference, setPaymentReference] = useState<string>('');
  const [addCreditReason, setAddCreditReason] = useState<string>('');
  const [isSubmittingCredit, setIsSubmittingCredit] = useState<boolean>(false);
  const [creditHistoryError, setCreditHistoryError] = useState<string | null>(null);
  const creditApprovalRequestKey = useRef<string>('');
  const creditApprovalRequestFingerprint = useRef<string>('');

  // Trial Period Workflow state
  const [trialPeriodStep, setTrialPeriodStep] = useState<1 | 2>(1);
  const [selectedTrialMode, setSelectedTrialMode] = useState<string>('Mode 1');
  const [trialStartDate, setTrialStartDate] = useState<string>('');
  const [trialEndDate, setTrialEndDate] = useState<string>('');
  const [trialDays, setTrialDays] = useState<number>(0);
  const [trialDateError, setTrialDateError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    void fetchApprovalUsers().then((res) => {
      if (isMounted && res.users && res.users.length > 0) {
        setApplicationUsers(res.users);
        const currentUser = authClient.getSessionUser();
        if (currentUser?.name) {
          const match = res.users.find((u) => u.id === currentUser?.id || u.name === currentUser?.name);
          const initialUser = match || { id: currentUser.id, name: currentUser.name };
          setOfflineInitiatorName((prev) => prev || initialUser.name);
          setOfflineInitiatorId((prev) => prev || initialUser.id || '');
        }
      }
    });
    void fetchApprovalApprovers().then((res) => {
      if (isMounted && res.approvers && res.approvers.length > 0) {
        setAuthorizedApprovers(res.approvers);
        setCreditApprover((prev) => prev || res.approvers[0].name);
        setCreditApproverId((prev) => prev || res.approvers[0].id);
        setOfflineApproverName((prev) => prev || res.approvers[0].name);
        setOfflineApproverId((prev) => prev || res.approvers[0].id);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

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
      setTrialDateError(strings.creditApproval?.trialPeriodWorkflow?.validationEndBeforeStart || 'Ending date cannot be earlier than starting date.');
      setTrialDays(0);
    } else {
      setTrialDateError(null);
      setTrialDays(days);
    }
  };

  const handleTrialDaysChange = (days: number) => {
    setTrialDays(days);
    if (trialStartDate && trialEndDate) {
      const calcDays = calculateTrialDaysFromDates(trialStartDate, trialEndDate);
      if (calcDays > 0 && days !== calcDays) {
        setTrialDateError(
          formatString(strings.creditApproval?.trialPeriodWorkflow?.validationDaysMismatch || 'The entered number of days ({trialDays}) does not match the selected date range ({calculatedDays} days).', {
            trialDays: days,
            calculatedDays: calcDays,
          })
        );
      } else if (calcDays <= 0) {
        setTrialDateError(strings.creditApproval?.trialPeriodWorkflow?.validationEndBeforeStart || 'Ending date cannot be earlier than starting date.');
      } else {
        setTrialDateError(null);
      }
    }
  };

  // Offline Payment Workflow state
  const [offlinePaymentDate, setOfflinePaymentDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [offlinePaymentType, setOfflinePaymentType] = useState<OfflinePaymentType>('NEFT / RTGS');
  const [offlineTransactionId, setOfflineTransactionId] = useState<string>('');
  const [offlinePaymentAmount, setOfflinePaymentAmount] = useState<number>(0);
  const [offlineBuyerSourceMode, setOfflineBuyerSourceMode] = useState<string>(() => RFQ_MODE_LABELS[buyer.sourcingMode] || 'Mode 2');
  const [offlineProofFile, setOfflineProofFile] = useState<File | null>(null);
  const [offlineProofPreviewUrl, setOfflineProofPreviewUrl] = useState<string | null>(null);
  const [offlineProofFileName, setOfflineProofFileName] = useState<string>('');
  const [offlineProofFileDataUrl, setOfflineProofFileDataUrl] = useState<string>('');
  const [offlineProofFileSize, setOfflineProofFileSize] = useState<number>(0);
  const [offlineProofFileType, setOfflineProofFileType] = useState<string>('');
  const [offlineInitiatorName, setOfflineInitiatorName] = useState<string>(authClient.getSessionUser()?.name ?? '');
  const [offlineInitiatorId, setOfflineInitiatorId] = useState<string>(authClient.getSessionUser()?.id ?? '');
  const [offlineApproverName, setOfflineApproverName] = useState<string>(APPROVER_CONFIG[0]?.name || 'Srinu Sir');
  const [offlineApproverId, setOfflineApproverId] = useState<string>(APPROVER_CONFIG[0]?.id || 'srinu_sir');
  const [offlineRemarks, setOfflineRemarks] = useState<string>('');
  const offlineFileInputRef = useRef<HTMLInputElement>(null);

  const buyerInitiatorSelectOptions = useMemo(() => {
    const primaryOrder = ['Govardhan', 'Chandan', 'Krishna Chaitanya', 'Sudheer'];
    const list: string[] = [...primaryOrder];
    const extras = [
      ...internalTaskUserOptions,
      'Session Initiator',
      'Category Manager',
    ];
    for (const u of applicationUsers) {
      if (u?.name) extras.push(u.name);
      if (u?.id) extras.push(u.id);
    }
    for (const a of assignees) {
      if (a?.name) extras.push(a.name);
      if (a?.id) extras.push(a.id);
    }
    if (creditInitiator) extras.push(creditInitiator);
    if (offlineInitiatorName) extras.push(offlineInitiatorName);

    for (const item of extras) {
      if (!list.some((u) => u.toLowerCase() === item.toLowerCase())) {
        list.push(item);
      }
    }
    return list;
  }, [internalTaskUserOptions, applicationUsers, assignees, creditInitiator, offlineInitiatorName]);

  const buyerApproverSelectOptions = useMemo(() => {
    return ['Srinu Sir', 'Rao Sir', 'Sudheer Sir'];
  }, []);

  useEffect(() => {
    if (assignees.length > 0) {
      if (!offlineInitiatorName) {
        setOfflineInitiatorName(assignees[0].name);
        setOfflineInitiatorId(assignees[0].id || '');
      }
    }
  }, [assignees, offlineInitiatorName]);

  // Discount Workflow state
  const [discountStep, setDiscountStep] = useState<1 | 2 | 3>(1);
  const [selectedDiscountMode, setSelectedDiscountMode] = useState<string>('Mode 1');
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
    if (selectedDiscountMode === 'Mode 2') return 'version_2';
    if (selectedDiscountMode === 'Mode 3') return 'version_3';
    return 'version_1';
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

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (requestTypeDropdownRef.current && !requestTypeDropdownRef.current.contains(e.target as Node)) {
        setIsRequestTypeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadCreditHistory = useCallback(async () => {
    setLoadingCredit(true);
    setCreditHistoryError(null);
    try {
      const res = await fetchBuyerCreditHistory(buyer.id);
      if (res.success) {
        setCreditSummary(res.summary || null);
        setCreditTransactions(res.transactions || []);
        setCreditHistoryAvailable(res.historyAvailable ?? (res.transactions || []).length > 0);
      } else {
        setCreditSummary(null);
        setCreditTransactions([]);
        setCreditHistoryError(res.error || strings.credit.loadFailure);
      }
    } catch (error) {
      logger.error('Buyer credit history request failed', { buyerId: buyer.id, error }, 'BUYER_DOSSIER');
      setCreditSummary(null);
      setCreditTransactions([]);
      setCreditHistoryError(strings.credit.loadFailure);
    } finally {
      setLoadingCredit(false);
    }
  }, [buyer.id, strings.credit.loadFailure]);

  useEffect(() => {
    if (dossierTab === 'credits') {
      loadCreditHistory();
    }
  }, [dossierTab, loadCreditHistory]);

  const handleConfirmAddCredit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingCredit) return;
    if (selectedRequestType === 'Discounts') {
      if (isNaN(discountPercentage) || discountPercentage < 0 || discountPercentage > 100) {
        showToast(strings.creditApproval.discountWorkflow.validationInvalidDiscount, 'error');
        return;
      }
    } else if (selectedRequestType === 'Trial Periods') {
      if (trialDays <= 0 || trialDays > 365) {
        showToast('Please enter a valid trial extension period (1-365 days).', 'error');
        return;
      }
      if (trialStartDate && trialEndDate) {
        const calcDays = calculateTrialDaysFromDates(trialStartDate, trialEndDate);
        if (calcDays <= 0) {
          showToast(strings.creditApproval?.trialPeriodWorkflow?.validationEndBeforeStart || 'Ending date cannot be earlier than starting date.', 'error');
          return;
        }
        if (trialDays !== calcDays) {
          showToast(
            formatString(strings.creditApproval?.trialPeriodWorkflow?.validationDaysMismatch || 'The entered number of days ({trialDays}) does not match the selected date range ({calculatedDays} days).', {
              trialDays,
              calculatedDays: calcDays,
            }),
            'error'
          );
          return;
        }
      }
    } else if (selectedRequestType === 'Offline Payments') {
      if (addCreditAmount <= 0) {
        showToast('Please enter a valid offline payment amount.', 'error');
        return;
      }
      if (!paymentReference.trim()) {
        showToast('Please enter the payment reference or UTR number.', 'error');
        return;
      }
    } else if (selectedRequestType === 'Buyer Credit Deletion') {
      if (addCreditAmount <= 0) {
        showToast(strings.creditApproval.invalidAmount, 'error');
        return;
      }
      const available = creditSummary?.remainingFreeCredits ?? buyer.remainingFreeRFQs ?? 0;
      if (addCreditAmount > available) {
        showToast(`Cannot deduct ${addCreditAmount} credits. Available balance is ${available}.`, 'error');
        return;
      }
    } else {
      if (addCreditAmount <= 0) {
        showToast(strings.creditApproval.invalidAmount, 'error');
        return;
      }
    }

    const effectiveInitiator = creditInitiator;
    if (!creditApprover.trim() || !effectiveInitiator.trim()) {
      showToast(
        selectedRequestType === 'Discounts'
          ? strings.creditApproval.discountWorkflow.validationApproverRequired
          : strings.creditApproval.approverRequired,
        'error'
      );
      return;
    }
    setIsSubmittingCredit(true);
    const requestFingerprint = JSON.stringify([
      buyer.id,
      buyer.organizationName,
      selectedRequestType,
      selectedRequestType === 'Discounts' ? discountPercentage : (selectedRequestType === 'Trial Periods' ? trialDays : addCreditAmount),
      selectedDiscountMode,
      selectedBillingDuration,
      selectedTrialMode,
      trialStartDate,
      trialEndDate,
      trialDays,
      paymentReference,
      addCreditReason,
      creditApprover,
      creditInitiator,
    ]);
    if (creditApprovalRequestFingerprint.current !== requestFingerprint || !creditApprovalRequestKey.current) {
      creditApprovalRequestFingerprint.current = requestFingerprint;
      creditApprovalRequestKey.current = createCreditApprovalIdempotencyKey();
    }
    try {
      const payload: RequestBuyerCreditApprovalPayload = {
        requestType: selectedRequestType,
        amount: selectedRequestType === 'Discounts' ? discountPercentage : (selectedRequestType === 'Trial Periods' ? trialDays : addCreditAmount),
        discountPercentage: selectedRequestType === 'Discounts' ? discountPercentage : undefined,
        durationDays: selectedRequestType === 'Trial Periods' ? trialDays : undefined,
        startDate: selectedRequestType === 'Trial Periods' ? trialStartDate : undefined,
        endDate: selectedRequestType === 'Trial Periods' ? trialEndDate : undefined,
        paymentReference: selectedRequestType === 'Offline Payments' ? paymentReference.trim() : undefined,
        selectedMode: selectedRequestType === 'Discounts' ? selectedDiscountMode : (selectedRequestType === 'Trial Periods' ? selectedTrialMode : undefined),
        billingDuration: selectedRequestType === 'Discounts' ? selectedBillingDuration : undefined,
        originalPrice: selectedRequestType === 'Discounts' ? discountBreakdown.originalPlanPrice : undefined,
        discountAmount: selectedRequestType === 'Discounts' ? discountBreakdown.discountAmount : undefined,
        remainingAmount: selectedRequestType === 'Discounts' ? discountBreakdown.remainingAmount : undefined,
        gstAmount: selectedRequestType === 'Discounts' ? discountBreakdown.gstAmount : undefined,
        finalPayableAmount: selectedRequestType === 'Discounts' ? discountBreakdown.finalPayableAmount : undefined,
        reason: addCreditReason.trim(),
        approverName: creditApprover.trim(),
        initiatorName: effectiveInitiator,
        idempotencyKey: creditApprovalRequestKey.current,
      };
      const res = await requestBuyerCreditApproval(buyer.id, payload);
      if (res.success) {
        creditApprovalRequestKey.current = '';
        creditApprovalRequestFingerprint.current = '';
        showToast(
          res.message ||
            (selectedRequestType === 'Discounts'
              ? formatString(strings.creditApproval.discountWorkflow.toastSuccess, {
                  approverName: creditApprover,
                })
              : selectedRequestType === 'Trial Periods'
              ? formatString(strings.creditApproval?.trialPeriodWorkflow?.toastSuccess || 'Trial period request submitted for approval to {approverName}. Status: Pending Approval.', {
                  approverName: creditApprover,
                })
              : formatString(strings.creditApproval?.toastSuccess || strings.creditApproval?.successToast || 'Credit request submitted for approval to {approverName}. Status: Pending Approval.', {
                  approverName: creditApprover,
                })),
          'success'
        );
        setIsAddCreditModalOpen(false);
        setAddCreditAmount(0);
        setDiscountPercentage(0);
        setDiscountStep(1);
        setTrialPeriodStep(1);
        setTrialStartDate('');
        setTrialEndDate('');
        setTrialDays(0);
        setTrialDateError(null);
        setPaymentReference('');
        setAddCreditReason('');
      } else {
        showToast(
          res.error ||
            (selectedRequestType === 'Discounts'
              ? strings.creditApproval.discountWorkflow.toastError
              : selectedRequestType === 'Trial Periods'
              ? (strings.creditApproval?.trialPeriodWorkflow?.toastError || 'Failed to submit trial period approval request.')
              : strings.creditApproval?.toastError || strings.creditApproval?.errorToast || 'Failed to submit credit approval request.'),
          'error'
        );
      }
    } catch {
      showToast(
        selectedRequestType === 'Discounts'
          ? strings.creditApproval.discountWorkflow.toastError
          : selectedRequestType === 'Trial Periods'
          ? (strings.creditApproval?.trialPeriodWorkflow?.toastError || 'Failed to submit trial period approval request.')
          : strings.creditApproval?.toastError || strings.creditApproval?.errorToast || 'Failed to submit credit approval request.',
        'error'
      );
    } finally {
      setIsSubmittingCredit(false);
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
      showToast(offlinePaymentStrings?.validationProofFormat || 'Please upload an image file in JPG, JPEG, or PNG format.', 'error');
      if (offlineFileInputRef.current) offlineFileInputRef.current.value = '';
      return;
    }

    if (file.size > OFFLINE_PAYMENT_UPLOAD_SCHEMA.maxFileSize) {
      showToast(offlinePaymentStrings?.validationProofSize || 'Payment proof file must be smaller than 10MB.', 'error');
      if (offlineFileInputRef.current) offlineFileInputRef.current.value = '';
      return;
    }

    setOfflineProofFile(file);
    setOfflineProofFileName(file.name);
    setOfflineProofFileSize(file.size);
    setOfflineProofFileType(file.type || 'image/jpeg');

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
    if (isSubmittingCredit) return;
    if (!offlinePaymentDate) {
      showToast(offlinePaymentStrings?.validationPaymentDateRequired || 'Payment date is mandatory.', 'error');
      return;
    }
    if (!offlinePaymentType) {
      showToast(offlinePaymentStrings?.validationPaymentTypeRequired || 'Payment type is mandatory.', 'error');
      return;
    }
    if (offlinePaymentType !== 'Cash' && !offlineTransactionId.trim()) {
      showToast(
        formatString(offlinePaymentStrings?.validationTransactionIdRequired || 'Transaction ID is mandatory for {paymentType}.', {
          paymentType: offlinePaymentType,
        }),
        'error'
      );
      return;
    }
    if (offlinePaymentAmount <= 0) {
      showToast(offlinePaymentStrings?.validationAmountRequired || 'Please enter a valid payment amount greater than 0.', 'error');
      return;
    }
    if (!offlineInitiatorName.trim()) {
      showToast(offlinePaymentStrings?.validationInitiatorRequired || 'Initiated by user is mandatory.', 'error');
      return;
    }
    if (!offlineApproverName.trim()) {
      showToast(offlinePaymentStrings?.validationApproverRequired || 'Assigned approver is mandatory.', 'error');
      return;
    }

    setIsSubmittingCredit(true);
    const requestFingerprint = JSON.stringify([
      buyer.id,
      buyer.organizationName,
      'Offline Payments',
      offlinePaymentAmount,
      offlinePaymentDate,
      offlinePaymentType,
      offlineTransactionId,
      offlineBuyerSourceMode,
      offlineProofFileName,
      offlineRemarks,
      offlineApproverName,
      offlineInitiatorName,
    ]);
    if (creditApprovalRequestFingerprint.current !== requestFingerprint || !creditApprovalRequestKey.current) {
      creditApprovalRequestFingerprint.current = requestFingerprint;
      creditApprovalRequestKey.current = createCreditApprovalIdempotencyKey();
    }
    try {
      const payload: RequestBuyerCreditApprovalPayload = {
        requestType: 'Offline Payments',
        amount: offlinePaymentAmount,
        paymentAmount: offlinePaymentAmount,
        paymentDate: offlinePaymentDate,
        paymentType: offlinePaymentType,
        transactionId: offlinePaymentType !== 'Cash' ? offlineTransactionId.trim() : undefined,
        paymentReference: offlinePaymentType !== 'Cash' ? offlineTransactionId.trim() : undefined,
        buyerSourceMode: offlineBuyerSourceMode,
        proofFileName: offlineProofFileName || undefined,
        proofFileUrl: offlineProofFileDataUrl || undefined,
        proofFileType: offlineProofFileType || undefined,
        proofFileSize: offlineProofFileSize || undefined,
        reason: offlineRemarks.trim(),
        approverName: offlineApproverName.trim(),
        approverId: offlineApproverId || undefined,
        initiatorName: offlineInitiatorName.trim(),
        initiatorId: offlineInitiatorId || undefined,
        idempotencyKey: creditApprovalRequestKey.current,
      };

      const res = await requestBuyerCreditApproval(buyer.id, payload);
      if (res.success) {
        creditApprovalRequestKey.current = '';
        creditApprovalRequestFingerprint.current = '';
        showToast(
          res.message ||
            formatString(offlinePaymentStrings?.toastSuccess || 'Offline payment request submitted for approval to {approverName}. Status: Pending Approval.', {
              approverName: offlineApproverName,
            }),
          'success'
        );
        setIsAddCreditModalOpen(false);
        setOfflinePaymentAmount(0);
        setOfflineTransactionId('');
        handleRemoveOfflineProof();
        setOfflineRemarks('');
      } else {
        showToast(
          res.error || offlinePaymentStrings?.toastError || 'Failed to submit offline payment approval request.',
          'error'
        );
      }
    } catch {
      showToast(
        offlinePaymentStrings?.toastError || 'Failed to submit offline payment approval request.',
        'error'
      );
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
  const [communicationsError, setCommunicationsError] = useState<string | null>(null);
  const [commSearch, setCommSearch] = useState<string>('');
  const [commDateFilter, setCommDateFilter] = useState<string>('');
  const [selectedEmailModal, setSelectedEmailModal] = useState<BuyerCommunicationItem | null>(null);

  const handleSendCommunication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!composeMessage.trim()) return;
    setIsSendingComm(true);
    try {
      const res = await recordBuyerCommunication(buyer.id, {
        channel: composeChannel,
        recipient: composeRecipient || buyer.corporateEmail || buyer.mobileNumber || '',
        subject: composeSubject || `Buyer Communication: ${composeChannel}`,
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
        showToast(res.error || strings.compose.errorToast, 'error');
      }
    } catch {
      showToast(strings.compose.errorToast, 'error');
    } finally {
      setIsSendingComm(false);
    }
  };

  const loadCommunications = useCallback(async () => {
    setLoadingComms(true);
    setCommunicationsError(null);
    try {
      const res = await fetchBuyerCommunications(buyer.id);
      if (res && res.success && Array.isArray(res.data)) {
        setCommunications(res.data);
      } else {
        setCommunicationsError(res?.error || strings.compose.loadFailure);
      }
    } catch (error) {
      logger.error('Buyer communications request failed', { buyerId: buyer.id, error }, 'BUYER_DOSSIER');
      setCommunicationsError(strings.compose.loadFailure);
    } finally {
      setLoadingComms(false);
    }
  }, [buyer.id, strings.compose.loadFailure]);

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
      if (commSubTab === 'all') {
        matchChannel = true;
      } else if (commSubTab === 'email') {
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
  const [payments, setPayments] = useState<BuyerPaymentTransaction[]>([]);
  const [paymentHistoryError, setPaymentHistoryError] = useState<string | null>(null);

  const [loadingPayments, setLoadingPayments] = useState<boolean>(false);
  const [paymentSearch, setPaymentSearch] = useState<string>('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>('all');
  const [paymentSortOrder, setPaymentSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedPaymentModal, setSelectedPaymentModal] = useState<BuyerPaymentTransaction | null>(null);
  const [paymentPage, setPaymentPage] = useState<number>(1);
  const paymentPageSize = 10;

  const loadPayments = useCallback(async () => {
    setLoadingPayments(true);
    setPaymentSummary(null);
    setPayments([]);
    setPaymentHistoryError(null);
    try {
      const res = await fetchBuyerPaymentHistory(buyer.id);
      if (res.success) {
        setPaymentSummary(res.summary || null);
        setPayments(res.payments || []);
      } else {
        logger.error('Buyer payment history API returned an unsuccessful response', {
          buyerId: buyer.id,
          error: res.error,
        }, 'BUYER_DOSSIER');
        setPaymentHistoryError(res.error || strings.payments.loadFailure);
      }
    } catch (error) {
      logger.error('Buyer payment history request failed', { buyerId: buyer.id, error }, 'BUYER_DOSSIER');
      setPaymentHistoryError(strings.payments.loadFailure);
    } finally {
      setLoadingPayments(false);
    }
  }, [buyer.id, strings.payments.loadFailure]);

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
        if (isAddCreditModalOpen) {
          setIsAddCreditModalOpen(false);
        } else if (isRequestTypeDropdownOpen) {
          setIsRequestTypeDropdownOpen(false);
        } else if (selectedRfqForModal) {
          setSelectedRfqForModal(null);
        } else if (isEditCategoriesOpen) {
          setIsEditCategoriesOpen(false);
        } else if (selectedEmailModal) {
          setSelectedEmailModal(null);
        } else if (selectedPaymentModal) {
          setSelectedPaymentModal(null);
        } else if (isComposeOpen) {
          setIsComposeOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isRequestTypeDropdownOpen, selectedRfqForModal, isAddCreditModalOpen, isEditCategoriesOpen, selectedEmailModal, selectedPaymentModal, isComposeOpen]);

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
                  {RFQ_MODE_LABELS[buyer.sourcingMode] || EMPTY_VALUE}
                </span>
                <div className="relative inline-block text-left" ref={requestTypeDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setIsRequestTypeDropdownOpen((prev) => !prev)}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition cursor-pointer"
                    title={strings.requestTypeTitle || 'Request Type'}
                    aria-label={strings.requestTypeTitle || 'Request Type'}
                    aria-haspopup="true"
                    aria-expanded={isRequestTypeDropdownOpen}
                    data-testid="request-type-dropdown-btn"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{strings.requestTypeDropdown || 'Request Type'}</span>
                    <ChevronDown className="w-3 h-3 ml-0.5 opacity-70" />
                  </button>

                  {isRequestTypeDropdownOpen && (
                    <div
                      role="menu"
                      aria-orientation="vertical"
                      className="absolute left-0 mt-1 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 py-1 text-xs divide-y divide-slate-100 dark:divide-slate-800"
                    >
                      {BUYER_PROFILE_REQUEST_TYPES.map((type) => (
                        <button
                          key={type}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setSelectedRequestType(type);
                            setIsRequestTypeDropdownOpen(false);
                            if (type === 'Discounts') {
                              setDiscountStep(1);
                              setSelectedDiscountMode('Mode 1');
                              setSelectedBillingDuration('12 Months');
                              setDiscountPercentage(0);
                            } else if (type === 'Trial Periods') {
                              setTrialPeriodStep(1);
                              setSelectedTrialMode('Mode 1');
                              setTrialStartDate('');
                              setTrialEndDate('');
                              setTrialDays(0);
                              setTrialDateError(null);
                              setAddCreditReason('');
                            } else if (type === 'Offline Payments') {
                              setOfflinePaymentDate(new Date().toISOString().split('T')[0]);
                              setOfflinePaymentType('NEFT / RTGS');
                              setOfflineTransactionId('');
                              setOfflinePaymentAmount(0);
                              setOfflineBuyerSourceMode(RFQ_MODE_LABELS[buyer.sourcingMode] || 'Mode 2');
                              handleRemoveOfflineProof();
                              setOfflineRemarks('');
                              if (assignees.length > 0) {
                                setOfflineInitiatorName(assignees[0].name);
                                setOfflineInitiatorId(assignees[0].id || '');
                              }
                              setOfflineApproverName(APPROVER_CONFIG[0]?.name || 'Srinu Sir');
                              setOfflineApproverId(APPROVER_CONFIG[0]?.id || 'srinu_sir');
                            }
                            setIsAddCreditModalOpen(true);
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
              <p className="text-xs text-slate-500 mt-0.5">
                {formatString(strings.registered, {
                  date: formatIndianDateTime(buyer.createdDate) || EMPTY_VALUE,
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
            { id: 'profile', label: strings.profileTab },
            { id: 'rfqs', label: `${strings.rfqsTab} (${buyerRfqs.length})` },
            { id: 'credits', label: strings.creditTab },
            { id: 'communications', label: `${strings.communicationsTab} (${communications.length})` },
            { id: 'payments', label: `${strings.paymentsTab} (${payments.length})` },
            { id: 'documents', label: `${strings.documentsTab} (${docCount})` },
            { id: 'uploaded-vendors', label: `${strings.uploadedVendorsTab} (${uploadedVendors.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setDossierTab(tab.id as any)}
              className={`px-3.5 py-3 border-b-2 text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                dossierTab === tab.id
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Dossier Content Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* TAB 1: PROFILE TAB */}
          {dossierTab === 'profile' && (
            <div className="space-y-6">
              {/* Snapshot Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-indigo-50/50 dark:bg-indigo-950/30 p-3.5 rounded-xl border border-indigo-100 dark:border-indigo-900/50">
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{strings.totalSpendLabel || 'Total spend'}</p>
                  <p className="text-xl font-bold text-indigo-700 dark:text-indigo-300 mt-0.5">
                    {buyer.totalSpend ? String(buyer.totalSpend).replace(/\$/g, '₹') : EMPTY_VALUE}
                  </p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{strings.totalRfqLabel || 'Total RFQ'}</p>
                  <p className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">
                    {buyer.totalRFQsCreated || buyerRfqs.length}
                  </p>
                  <p className="text-[10px] text-slate-400">Active enterprise scope</p>
                </div>
                <div className="bg-emerald-50/50 dark:bg-emerald-950/30 p-3.5 rounded-xl border border-emerald-100 dark:border-emerald-900/50">
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Available Quota</p>
                  <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300 mt-0.5">
                    {buyer.remainingFreeRFQs ?? EMPTY_VALUE}
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
                      <span className="font-semibold">{buyer.contactPerson || EMPTY_VALUE}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                      <span>{buyer.corporateEmail}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                      <span>{buyer.mobileNumber || EMPTY_VALUE}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                      <span>
                        {buyer.city ? `${buyer.city}, ` : ''}
                        {buyer.primaryPlantLocation || EMPTY_VALUE}
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
                      <span className="font-semibold">{RFQ_MODE_LABELS[buyer.sourcingMode] || EMPTY_VALUE}</span>
                    </p>
                    <p>
                      <span className="text-slate-500">Subscription Tier:</span>{' '}
                      <span className="font-semibold capitalize">{buyer.subscriptionPlan || EMPTY_VALUE}</span>
                    </p>
                    <p>
                      <span className="text-slate-500">Status:</span>{' '}
                      <span className="font-semibold text-emerald-600">{buyer.status || EMPTY_VALUE}</span>
                    </p>
                    <p>
                      <span className="text-slate-500">Last Synced:</span>{' '}
                      <span>{formatIndianDateTime(buyer.syncTimestamp) || EMPTY_VALUE}</span>
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
                              {RFQ_MODE_LABELS[rfq.sourcingMode] || EMPTY_VALUE}
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
                              {rfq.status || EMPTY_VALUE}
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
                    {creditSummary?.totalCreditsAllocated ?? EMPTY_VALUE}
                  </p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-[11px] font-medium text-slate-500">{strings.credit.totalConsumed}</p>
                  <p className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                    {creditSummary?.totalCreditsConsumed ?? EMPTY_VALUE}
                  </p>
                </div>
                <div className="bg-emerald-50/50 dark:bg-emerald-950/30 p-3.5 rounded-xl border border-emerald-100 dark:border-emerald-900/50">
                  <p className="text-[11px] font-medium text-slate-500">{strings.credit.remainingFree}</p>
                  <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300 mt-0.5">
                    {creditSummary?.remainingFreeCredits ?? EMPTY_VALUE}
                  </p>
                </div>
                <div className="bg-indigo-50/50 dark:bg-indigo-950/30 p-3.5 rounded-xl border border-indigo-100 dark:border-indigo-900/50">
                  <p className="text-[11px] font-medium text-slate-500">{strings.credit.entitlementMode}</p>
                  <p className="text-lg font-bold text-indigo-700 dark:text-indigo-300 mt-0.5">
                    {RFQ_MODE_LABELS[buyer.sourcingMode] || EMPTY_VALUE}
                  </p>
                </div>
              </div>

              {creditHistoryAvailable === false && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200" role="status">
                  {strings.credit.historyUnavailable}
                </div>
              )}
              {creditHistoryError && (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
                  {creditHistoryError}
                </div>
              )}

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
                            {tx.updatedBalance ?? EMPTY_VALUE}
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
              {/* Compact Sub-tabs in one horizontal row */}
              <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                {[
                  { id: 'all', label: strings.subTabs.all || 'All', icon: Layers },
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

              {/* Search, Filter & Record Action */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setComposeChannel(commSubTab === 'sms' ? 'SMS' : commSubTab === 'whatsapp' ? 'WHATSAPP' : commSubTab === 'call' ? 'CALL' : 'EMAIL');
                    setIsComposeOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 h-8 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
                >
                  <Plus size={13} />
                  <span>{strings.compose?.title || 'Record Communication'}</span>
                </button>
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={commSearch}
                    onChange={(e) => setCommSearch(e.target.value)}
                    placeholder={commSubTab === 'all' ? 'Search communications...' : `Search ${commSubTab} communications...`}
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
              {communicationsError && (
                <div role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
                  {communicationsError}
                </div>
              )}
              {loadingComms ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                  <Loader2 className="animate-spin text-indigo-500" size={24} />
                  <span className="text-xs">Loading communication records...</span>
                </div>
              ) : filteredCommunications.length === 0 ? (
                <div className="p-8 text-center text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <p className="text-xs font-medium">No recorded {commSubTab === 'all' ? '' : commSubTab.toUpperCase() + ' '}communications found for this buyer.</p>
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
                              {comm.deliveryStatus || EMPTY_VALUE}
                            </span>
                            {comm.acknowledgementStatus && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                                {comm.acknowledgementStatus}
                              </span>
                            )}
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
                        {(commSubTab === 'email' || comm.channel === 'EMAIL') && (
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


          {/* TAB 6: DOCUMENTS TAB */}
          {dossierTab === 'documents' && (
            <AccountDocumentsTab
              accountType="buyer"
              accountId={buyer.id}
              accountName={buyer.organizationName}
              onDocumentCountChange={setDocCount}
            />
          )}
          {/* TAB 5: PAYMENTS TAB */}
          {dossierTab === 'payments' && (
            <div className="space-y-5">
              {/* Payment Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-[10px] font-medium text-slate-500 uppercase">{strings.payments.totalPaid}</p>
                  <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {paymentSummary?.totalAmountPaid != null ? formatCurrency(paymentSummary.totalAmountPaid) : EMPTY_VALUE}
                  </p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-[10px] font-medium text-slate-500 uppercase">{strings.payments.successful}</p>
                  <p className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                    {paymentSummary?.totalSuccessfulPayments ?? EMPTY_VALUE}
                  </p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-[10px] font-medium text-slate-500 uppercase">{strings.payments.pending}</p>
                  <p className="text-lg font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                    {paymentSummary?.pendingPayments ?? EMPTY_VALUE}
                  </p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-[10px] font-medium text-slate-500 uppercase">{strings.payments.failed}</p>
                  <p className="text-lg font-bold text-rose-600 dark:text-rose-400 mt-0.5">
                    {paymentSummary?.failedPayments ?? EMPTY_VALUE}
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
                    aria-label="Filter payments by status"
                    className="h-8 px-2.5 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 min-w-[130px] shrink-0"
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
              ) : paymentHistoryError ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200" role="alert">
                  <p className="text-xs">{paymentHistoryError}</p>
                  <button
                    type="button"
                    onClick={() => { void loadPayments(); }}
                    className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-800"
                  >
                    {strings.payments.retry}
                  </button>
                </div>
              ) : paginatedPayments.length === 0 ? (
                <div className="p-8 text-center text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <p className="text-xs">{strings.payments.noRecords}</p>
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
                            {typeof p.amount === 'number' && Number.isFinite(p.amount) ? formatCurrency(p.amount) : EMPTY_VALUE}
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

          {/* TAB 7: BUYER UPLOADED VENDORS TAB */}
          {dossierTab === 'uploaded-vendors' && (
            <div className="space-y-4">
              {/* Header / Search Controls */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={uploadedVendorSearch}
                    onChange={(e) => setUploadedVendorSearch(e.target.value)}
                    placeholder={strings.uploadedVendors.searchPlaceholder}
                    className="w-full pl-9 pr-4 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={uploadedVendorStatusFilter}
                    onChange={(e) => setUploadedVendorStatusFilter(e.target.value)}
                    aria-label="Filter by vendor status"
                    className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="ALL">{strings.uploadedVendors.statusFilterAll}</option>
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="PENDING">PENDING</option>
                    <option value="VERIFIED">VERIFIED</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void loadUploadedVendors()}
                    title={strings.uploadedVendors.retry}
                    aria-label={strings.uploadedVendors.retry}
                    className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                  >
                    <RotateCcw className={`w-4 h-4 ${loadingUploadedVendors ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Content states */}
              {loadingUploadedVendors ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <Loader2 className="w-8 h-8 animate-spin mb-2 text-indigo-600" />
                  <p className="text-xs">{UI_STRINGS.dataLoad.loading}</p>
                </div>
              ) : uploadedVendorsError ? (
                <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                    <span className="text-xs">{uploadedVendorsError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadUploadedVendors()}
                    className="px-3 py-1 text-xs font-semibold rounded bg-rose-600 text-white hover:bg-rose-700 cursor-pointer"
                  >
                    {strings.uploadedVendors.retry}
                  </button>
                </div>
              ) : filteredUploadedVendors.length === 0 ? (
                <div className="text-center py-16 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/40">
                  <Users className="w-10 h-10 mx-auto text-slate-400 mb-2" />
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                    {strings.uploadedVendors.emptyMessage}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">{strings.uploadedVendors.subtitle}</p>
                </div>
              ) : (
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
                      <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] uppercase font-bold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="py-3 px-4 whitespace-nowrap">{strings.uploadedVendors.colVendorName}</th>
                          <th className="py-3 px-4 whitespace-nowrap">{strings.uploadedVendors.colCompanyName}</th>
                          <th className="py-3 px-4 whitespace-nowrap">{strings.uploadedVendors.colContactPerson}</th>
                          <th className="py-3 px-4 whitespace-nowrap">{strings.uploadedVendors.colEmail}</th>
                          <th className="py-3 px-4 whitespace-nowrap">{strings.uploadedVendors.colPhone}</th>
                          <th className="py-3 px-4 whitespace-nowrap">{strings.uploadedVendors.colUploadDate}</th>
                          <th className="py-3 px-4 whitespace-nowrap">{strings.uploadedVendors.colStatus}</th>
                          <th className="py-3 px-4 text-right whitespace-nowrap">{strings.uploadedVendors.colActions}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredUploadedVendors.map((vendor) => (
                          <tr key={vendor.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors">
                            <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {vendor.name || EMPTY_VALUE}
                            </td>
                            <td className="py-3 px-4 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                              {vendor.companyName || EMPTY_VALUE}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              {vendor.contactPerson || EMPTY_VALUE}
                            </td>
                            <td className="py-3 px-4 text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                              {vendor.email || EMPTY_VALUE}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              {vendor.phone || EMPTY_VALUE}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              {vendor.createdAt ? formatIndianDateTime(vendor.createdAt) : EMPTY_VALUE}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                (vendor.status || '').toUpperCase().includes('ACTIVE') || (vendor.status || '').toUpperCase().includes('VERIFIED')
                                  ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                              }`}>
                                {vendor.status || EMPTY_VALUE}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => setSelectedVendorForModal(vendor)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                {strings.uploadedVendors.viewDetails}
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
      {/* MODAL 1: REQUEST TYPE MODAL (WITH APPROVAL WORKFLOW) */}
      {/* ------------------------------------------------------------------------ */}
      {isAddCreditModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            e.stopPropagation();
            if (e.target === e.currentTarget) setIsAddCreditModalOpen(false);
          }}
        >
          <div
            className={`w-full ${
              (selectedRequestType === 'Discounts' && discountStep === 3) || selectedRequestType === 'Offline Payments'
                ? 'max-w-2xl'
                : 'max-w-lg'
            } bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-4 sm:p-5 space-y-3 max-h-[90vh] overflow-y-auto`}
            onClick={(e) => e.stopPropagation()}
          >
            {selectedRequestType === 'Discounts' ? (
              <>
                {/* Step 1: Select Sourcing Mode */}
                {discountStep === 1 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                          {discountStrings.step1Title}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {discountStrings.step1Subtitle}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsAddCreditModalOpen(false);
                        }}
                        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
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
                        {DISCOUNT_SOURCING_MODES.map((mode) => (
                          <button
                            key={mode.id}
                            type="button"
                            onClick={() => {
                              setSelectedDiscountMode(mode.label);
                              setDiscountStep(2);
                            }}
                            className={`p-3.5 rounded-xl border text-left transition flex items-center justify-between group cursor-pointer ${
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
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsAddCreditModalOpen(false);
                        }}
                        className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                      >
                        {discountStrings.cancelBtn}
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 2: Select Billing Duration */}
                {discountStep === 2 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                          {discountStrings.step2Title}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {formatString(discountStrings.step2Subtitle, {
                            mode: selectedDiscountMode,
                          })}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsAddCreditModalOpen(false);
                        }}
                        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
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
                            className={`p-3.5 rounded-xl border text-left transition flex items-center justify-between group cursor-pointer ${
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
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                      >
                        <ArrowLeft size={14} />
                        {discountStrings.backBtn}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsAddCreditModalOpen(false);
                        }}
                        className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                      >
                        {discountStrings.cancelBtn}
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 3: Enter Discount Percentage & Review Breakdown */}
                {discountStep === 3 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                          {discountStrings.step3Title}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {discountStrings.step3Subtitle}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsAddCreditModalOpen(false);
                        }}
                        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        aria-label="Close"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    <form onSubmit={handleConfirmAddCredit} className="space-y-3 text-xs">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                        {/* Left column: form inputs */}
                        <div className="space-y-2.5">
                          {/* Buyer Name (Read-Only) */}
                          <div>
                            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                              {discountStrings.buyerNameLabel}
                            </label>
                            <input
                              type="text"
                              readOnly
                              value={buyer.organizationName}
                              className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-semibold cursor-not-allowed text-xs"
                            />
                          </div>

                          {/* Selected Mode & Billing Duration (Read-Only) */}
                          <div className="grid grid-cols-2 gap-2.5">
                            <div>
                              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                {discountStrings.selectedModeLabel}
                              </label>
                              <input
                                type="text"
                                readOnly
                                value={selectedDiscountMode}
                                className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-semibold cursor-not-allowed text-xs"
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
                                className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-semibold cursor-not-allowed text-xs"
                              />
                            </div>
                          </div>

                          {/* Original Plan Price & Discount Percentage (2 cols) */}
                          <div className="grid grid-cols-2 gap-2.5">
                            <div>
                              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                {discountStrings.originalPlanPriceLabel}
                              </label>
                              <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-bold text-xs">
                                ₹{originalDiscountPlanPrice.toLocaleString('en-IN')}
                              </div>
                            </div>

                            <div>
                              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                {discountStrings.discountPercentageLabel} <span className="text-rose-500">*</span>
                              </label>
                              <input
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
                                className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                                required
                              />
                            </div>
                          </div>

                          {/* Initiated By & Approver (2 cols) */}
                          <div className="grid grid-cols-2 gap-2.5">
                            <div>
                              <label htmlFor="discount-initiator" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                {discountStrings.initiatedByLabel} <span className="text-rose-500">*</span>
                              </label>
                              <select
                                id="discount-initiator"
                                value={creditInitiator}
                                onChange={(e) => {
                                  const { name, id } = resolveUserOrApprover(e.target.value, applicationUsers, assignees);
                                  setCreditInitiator(name);
                                  setCreditInitiatorId(id);
                                }}
                                className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer text-xs"
                                required
                              >
                                <option value="">{UI_STRINGS.actionCenter.tasks.selectAssignee || 'Select Initiator...'}</option>
                                {buyerInitiatorSelectOptions.map((user) => (
                                  <option key={user} value={user}>
                                    {user}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label htmlFor="discount-approver" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                {discountStrings.assignedApproverLabel} <span className="text-rose-500">*</span>
                              </label>
                              <select
                                id="discount-approver"
                                value={creditApprover}
                                onChange={(e) => {
                                  const { name, id } = resolveUserOrApprover(e.target.value, authorizedApprovers, APPROVER_CONFIG);
                                  setCreditApprover(name);
                                  setCreditApproverId(id);
                                }}
                                className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer text-xs"
                                required
                              >
                                <option value="">{discountStrings.approverPlaceholder}</option>
                                {buyerApproverSelectOptions.map((appr) => (
                                  <option key={appr} value={appr}>
                                    {appr}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* Request Reason / Justification - Optional Text */}
                          <div>
                            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                              {discountStrings.reasonLabel}
                            </label>
                            <textarea
                              rows={1.5}
                              value={addCreditReason}
                              onChange={(e) => setAddCreditReason(e.target.value)}
                              placeholder={discountStrings.reasonPlaceholder}
                              className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                            />
                          </div>
                        </div>

                        {/* Right column: Clear Price Breakdown Table */}
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

                      {/* Step 5: Submission & Navigation Controls */}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                        <button
                          type="button"
                          onClick={() => setDiscountStep(2)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                        >
                          <ArrowLeft size={14} />
                          {discountStrings.backBtn}
                        </button>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsAddCreditModalOpen(false);
                            }}
                            className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                          >
                            {discountStrings.cancelBtn}
                          </button>
                          <button
                            type="submit"
                            disabled={isSubmittingCredit || discountPercentage < 0 || discountPercentage > 100 || !creditApprover.trim()}
                            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition disabled:opacity-50 cursor-pointer"
                          >
                            {isSubmittingCredit
                              ? (discountStrings.submittingBtn)
                              : (discountStrings.submitBtn)}
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                )}
              </>
            ) : selectedRequestType === 'Trial Periods' ? (
              // Trial Period 2-Step Workflow
              <>
                {trialPeriodStep === 1 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                          {strings.creditApproval?.trialPeriodWorkflow?.step1Title || 'Select Sourcing Mode'}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {strings.creditApproval?.trialPeriodWorkflow?.step1Subtitle || 'Step 1 of 2: Select sourcing mode for trial period request.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
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
                        {strings.creditApproval?.trialPeriodWorkflow?.step1SectionLabel || 'Select Sourcing Mode'}
                      </label>
                      <div className="grid grid-cols-1 gap-2.5">
                        {TRIAL_PERIOD_SOURCING_MODES.map((mode) => (
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
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsAddCreditModalOpen(false);
                        }}
                        className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition cursor-pointer"
                      >
                        {strings.creditApproval?.trialPeriodWorkflow?.cancelBtn || 'Cancel'}
                      </button>
                    </div>
                  </div>
                )}

                {trialPeriodStep === 2 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                          {strings.creditApproval?.trialPeriodWorkflow?.step2Title || 'Request Trial Period Approval'}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {strings.creditApproval?.trialPeriodWorkflow?.step2Subtitle || 'Submit trial period extension for authorization by the approver you select below.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsAddCreditModalOpen(false);
                        }}
                        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                        aria-label="Close"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    <form onSubmit={handleConfirmAddCredit} className="space-y-3 text-xs">
                      {/* Buyer Name & Selected Mode (2 cols) */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {strings.creditApproval?.trialPeriodWorkflow?.buyerNameLabel || 'Buyer Name'}
                          </label>
                          <input
                            type="text"
                            readOnly
                            value={buyer.organizationName}
                            className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-semibold cursor-not-allowed text-xs"
                          />
                        </div>

                        <div>
                          <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {strings.creditApproval?.trialPeriodWorkflow?.selectedModeLabel || 'Selected Mode'}
                          </label>
                          <input
                            type="text"
                            readOnly
                            value={selectedTrialMode}
                            className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-semibold cursor-not-allowed text-xs"
                          />
                        </div>
                      </div>

                      {/* Trial Days & Dates (3 cols) */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <div>
                          <label htmlFor="trial-days-input" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {strings.creditApproval?.trialPeriodWorkflow?.trialDaysLabel || 'Number of Trial Days'} <span className="text-rose-500">*</span>
                          </label>
                          <input
                            id="trial-days-input"
                            type="number"
                            value={trialDays || ''}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              handleTrialDaysChange(isNaN(val) ? 0 : val);
                            }}
                            placeholder={strings.creditApproval?.trialPeriodWorkflow?.trialDaysPlaceholder || 'e.g. 30'}
                            className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                            min="1"
                            max="365"
                            required
                          />
                        </div>

                        <div>
                          <label htmlFor="trial-start-date" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {strings.creditApproval?.trialPeriodWorkflow?.startDateLabel || 'Starting Date'}
                          </label>
                          <input
                            id="trial-start-date"
                            type="date"
                            value={trialStartDate}
                            onChange={(e) => handleTrialDateChange(e.target.value, trialEndDate)}
                            className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                          />
                        </div>

                        <div>
                          <label htmlFor="trial-end-date" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {strings.creditApproval?.trialPeriodWorkflow?.endDateLabel || 'Ending Date'}
                          </label>
                          <input
                            id="trial-end-date"
                            type="date"
                            value={trialEndDate}
                            onChange={(e) => handleTrialDateChange(trialStartDate, e.target.value)}
                            className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                          />
                        </div>
                      </div>

                      {/* Date Validation Alert Message */}
                      {trialDateError && (
                        <div role="alert" className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-1.5">
                          <AlertTriangle size={14} className="shrink-0" />
                          <span>{trialDateError}</span>
                        </div>
                      )}

                      {/* Initiated By & Assigned Approver (2 cols) */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label htmlFor="trial-initiator" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {strings.creditApproval?.trialPeriodWorkflow?.initiatedByLabel || 'Initiated By'} <span className="text-rose-500">*</span>
                          </label>
                          <select
                            id="trial-initiator"
                            value={creditInitiator}
                            onChange={(e) => {
                              const { name, id } = resolveUserOrApprover(e.target.value, applicationUsers, assignees);
                              setCreditInitiator(name);
                              setCreditInitiatorId(id);
                            }}
                            className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer text-xs"
                            required
                          >
                            <option value="">{strings.creditApproval?.trialPeriodWorkflow?.selectUserPlaceholder || 'Select Initiator...'}</option>
                            {buyerInitiatorSelectOptions.map((user) => (
                              <option key={user} value={user}>
                                {user}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label htmlFor="trial-approver" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {strings.creditApproval?.trialPeriodWorkflow?.assignedApproverLabel || 'Assigned Approver'} <span className="text-rose-500">*</span>
                          </label>
                          <select
                            id="trial-approver"
                            value={creditApprover}
                            onChange={(e) => {
                              const { name, id } = resolveUserOrApprover(e.target.value, authorizedApprovers, APPROVER_CONFIG);
                              setCreditApprover(name);
                              setCreditApproverId(id);
                            }}
                            className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer text-xs"
                            required
                          >
                            <option value="">{strings.creditApproval?.trialPeriodWorkflow?.selectApproverPlaceholder || 'Select Authorized Approver...'}</option>
                            {buyerApproverSelectOptions.map((appr) => (
                              <option key={appr} value={appr}>
                                {appr}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Request Reason / Remarks */}
                      <div>
                        <label htmlFor="trial-remarks" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          {strings.creditApproval?.trialPeriodWorkflow?.reasonLabel || 'Request Reason / Remarks'}
                        </label>
                        <textarea
                          id="trial-remarks"
                          rows={1.5}
                          value={addCreditReason}
                          onChange={(e) => setAddCreditReason(e.target.value)}
                          placeholder={strings.creditApproval?.trialPeriodWorkflow?.reasonPlaceholder || 'Reason for trial period extension...'}
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
                          {strings.creditApproval?.trialPeriodWorkflow?.backBtn || 'Back'}
                        </button>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsAddCreditModalOpen(false);
                            }}
                            className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition cursor-pointer"
                          >
                            {strings.creditApproval?.trialPeriodWorkflow?.cancelBtn || 'Cancel'}
                          </button>
                          <button
                            type="submit"
                            disabled={isSubmittingCredit || trialDays <= 0 || !creditApprover.trim() || !creditInitiator.trim() || Boolean(trialDateError)}
                            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition disabled:opacity-50 cursor-pointer"
                          >
                            {isSubmittingCredit
                              ? (strings.creditApproval?.trialPeriodWorkflow?.submittingBtn || 'Submitting Request...')
                              : (strings.creditApproval?.trialPeriodWorkflow?.submitBtn || 'Submit for Approval')}
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
                    <p className="text-xs text-slate-500 mt-0.5">
                      {offlinePaymentStrings.modalSubtitle}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsAddCreditModalOpen(false);
                    }}
                    className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>

                <form onSubmit={handleConfirmOfflinePayment} className="space-y-3 text-xs">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                    {/* Left Column: Payment Details */}
                    <div className="space-y-2.5">
                      {/* Buyer Name & Mode (2 cols) */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {offlinePaymentStrings.buyerNameLabel}
                          </label>
                          <input
                            type="text"
                            readOnly
                            value={buyer.organizationName}
                            className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-semibold cursor-not-allowed text-xs"
                          />
                        </div>

                        <div>
                          <label htmlFor="offline-sourcing-mode-select" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {offlinePaymentStrings.buyerSourcingModeLabel}
                          </label>
                          <select
                            id="offline-sourcing-mode-select"
                            value={offlineBuyerSourceMode}
                            onChange={(e) => setOfflineBuyerSourceMode(e.target.value)}
                            className="w-full px-3 py-1.5 bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-800 dark:text-emerald-200 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                          >
                            {BUYER_SOURCING_MODES.map((mode) => (
                              <option key={mode} value={mode}>{mode}</option>
                            ))}
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
                            value={offlinePaymentType}
                            onChange={(e) => {
                              const newType = e.target.value as OfflinePaymentType;
                              setOfflinePaymentType(newType);
                              if (newType === 'Cash') {
                                setOfflineTransactionId('');
                              }
                            }}
                            className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                            required
                          >
                            {OFFLINE_PAYMENT_TYPES.map((ptype) => (
                              <option key={ptype} value={ptype}>{ptype}</option>
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
                      {/* Payment Proof Upload */}
                      <div>
                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          {offlinePaymentStrings.paymentProofLabel}
                        </label>
                        <input
                          ref={offlineFileInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/jpg"
                          className="hidden"
                          onChange={handleOfflineProofFileSelect}
                          data-testid="offline-proof-file-input"
                        />
                        {offlineProofPreviewUrl ? (
                          <div className="space-y-1.5 p-2 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 truncate max-w-[220px]">
                                <FileText size={14} className="text-emerald-500 shrink-0" />
                                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                                  {offlineProofFileName}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => offlineFileInputRef.current?.click()}
                                  className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                                >
                                  {offlinePaymentStrings.changeFileBtn}
                                </button>
                                <span className="text-slate-300 dark:text-slate-600">•</span>
                                <button
                                  type="button"
                                  onClick={handleRemoveOfflineProof}
                                  className="text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                                >
                                  {offlinePaymentStrings.removeFileBtn}
                                </button>
                              </div>
                            </div>
                            <div className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 max-h-24 flex items-center justify-center bg-black/5">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={offlineProofPreviewUrl}
                                alt="Payment Proof Preview"
                                className="object-contain max-h-24 w-auto"
                              />
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => offlineFileInputRef.current?.click()}
                            className="w-full py-2.5 px-3 border border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-emerald-500 rounded-xl bg-slate-50/50 dark:bg-slate-800/40 flex flex-col items-center justify-center gap-1 text-center transition group cursor-pointer"
                          >
                            <Upload size={18} className="text-slate-400 group-hover:text-emerald-500 transition" />
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 group-hover:text-emerald-600">
                              {offlinePaymentStrings.uploadFileBtn}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {offlinePaymentStrings.paymentProofHelp}
                            </span>
                          </button>
                        )}
                      </div>

                      {/* Initiated By & Approver (2 cols) */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label htmlFor="offline-initiator-select" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {offlinePaymentStrings.initiatedByLabel} <span className="text-rose-500">*</span>
                          </label>
                          <select
                            id="offline-initiator-select"
                            value={offlineInitiatorName}
                            onChange={(e) => {
                              const { name, id } = resolveUserOrApprover(e.target.value, applicationUsers, assignees);
                              setOfflineInitiatorName(name);
                              setOfflineInitiatorId(id);
                            }}
                            className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer text-xs"
                            required
                          >
                            <option value="">{offlinePaymentStrings.selectInitiatorPlaceholder}</option>
                            {buyerInitiatorSelectOptions.map((user) => (
                              <option key={user} value={user}>
                                {user}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label htmlFor="offline-approver-select" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            {offlinePaymentStrings.assignedApproverLabel} <span className="text-rose-500">*</span>
                          </label>
                          <select
                            id="offline-approver-select"
                            value={offlineApproverName}
                            onChange={(e) => {
                              const { name, id } = resolveUserOrApprover(e.target.value, authorizedApprovers, APPROVER_CONFIG);
                              setOfflineApproverName(name);
                              setOfflineApproverId(id);
                            }}
                            className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer text-xs"
                            required
                          >
                            <option value="">{offlinePaymentStrings.selectApproverPlaceholder}</option>
                            {buyerApproverSelectOptions.map((appr) => (
                              <option key={appr} value={appr}>
                                {appr}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Remarks */}
                      <div>
                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          {offlinePaymentStrings.reasonLabel}
                        </label>
                        <textarea
                          rows={1.5}
                          value={offlineRemarks}
                          onChange={(e) => setOfflineRemarks(e.target.value)}
                          placeholder={offlinePaymentStrings.reasonPlaceholder}
                          className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsAddCreditModalOpen(false);
                      }}
                      className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition cursor-pointer"
                    >
                      {offlinePaymentStrings.cancelBtn}
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingCredit || offlinePaymentAmount <= 0 || !offlinePaymentDate || !offlineApproverName || !offlineInitiatorName || (offlinePaymentType !== 'Cash' && !offlineTransactionId.trim())}
                      className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition disabled:opacity-50 cursor-pointer"
                    >
                      {isSubmittingCredit
                        ? (offlinePaymentStrings.submittingBtn)
                        : (offlinePaymentStrings.submitBtn)}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              // Existing modal for other request types
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      {strings.creditApproval?.types?.[selectedRequestType]?.title || strings.creditApproval?.modalTitle || 'Request Buyer Credit Approval'}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsAddCreditModalOpen(false);
                    }}
                    className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    <X size={18} />
                  </button>
                </div>

                <form onSubmit={handleConfirmAddCredit} className="space-y-2.5 text-xs">
                  {/* Row 1: Buyer Name & Current Context / Available Credits (2 cols) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {strings.creditApproval?.buyerNameLabel || 'Buyer Organization'}
                      </label>
                      <input
                        type="text"
                        readOnly
                        value={buyer.organizationName}
                        className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-semibold cursor-not-allowed text-xs"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {strings.creditApproval?.availableCreditsLabel || 'Available Sourcing Credits'}
                      </label>
                      <div className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-700 dark:text-emerald-300 font-bold text-xs">
                        {creditSummary?.remainingFreeCredits != null ? `${creditSummary.remainingFreeCredits} Credits` : EMPTY_VALUE}
                      </div>
                    </div>
                  </div>

                  {/* Row 2: Value Field & Initiated By (2 cols) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {creditApprovalStrings.types?.[selectedRequestType]?.valueLabel ||
                          creditApprovalStrings.requestedCreditsLabel ||
                          'Requested Credits'} <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        min="1"
                        max={100000000}
                        value={addCreditAmount}
                        onChange={(e) => setAddCreditAmount(isNaN(parseInt(e.target.value, 10)) ? 0 : parseInt(e.target.value, 10))}
                        placeholder={creditApprovalStrings.types?.[selectedRequestType]?.placeholder || '0'}
                        className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="credit-initiator" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {creditApprovalStrings.initiatorLabel || 'Initiated By'} <span className="text-rose-500">*</span>
                      </label>
                      <select
                        id="credit-initiator"
                        value={creditInitiator}
                        onChange={(e) => {
                          const { name, id } = resolveUserOrApprover(e.target.value, applicationUsers, assignees);
                          setCreditInitiator(name);
                          setCreditInitiatorId(id);
                        }}
                        className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer text-xs"
                        required
                      >
                        <option value="">{UI_STRINGS.actionCenter.tasks.selectAssignee || 'Select Initiator...'}</option>
                        {buyerInitiatorSelectOptions.map((user) => (
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
                      <label htmlFor="credit-approver" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {creditApprovalStrings.approverLabel || 'Assigned Approver'} <span className="text-rose-500">*</span>
                      </label>
                      <select
                        id="credit-approver"
                        value={creditApprover}
                        onChange={(e) => {
                          const { name, id } = resolveUserOrApprover(e.target.value, authorizedApprovers, APPROVER_CONFIG);
                          setCreditApprover(name);
                          setCreditApproverId(id);
                        }}
                        className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer text-xs"
                        required
                      >
                        <option value="">{creditApprovalStrings.approverPlaceholder || 'Select Authorized Approver...'}</option>
                        {buyerApproverSelectOptions.map((appr) => (
                          <option key={appr} value={appr}>
                            {appr}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {creditApprovalStrings.reasonLabel || 'Business Justification / Reason'}
                      </label>
                      <textarea
                        rows={1.5}
                        value={addCreditReason}
                        onChange={(e) => setAddCreditReason(e.target.value)}
                        placeholder={creditApprovalStrings.types?.[selectedRequestType]?.reasonPlaceholder || creditApprovalStrings.reasonPlaceholder || 'Enter business justification...'}
                        className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsAddCreditModalOpen(false);
                      }}
                      className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingCredit || addCreditAmount <= 0}
                      className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition disabled:opacity-50"
                    >
                      {isSubmittingCredit
                        ? (creditApprovalStrings.submittingBtn || 'Submitting Request...')
                        : (creditApprovalStrings.submitBtn || 'Submit for Approval')}
                    </button>
                  </div>
                </form>
              </div>
            )}
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
            e.stopPropagation();
            if (e.target === e.currentTarget) setIsEditCategoriesOpen(false);
          }}
        >
          <div
            className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Edit Supported Divisions
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

            {majorCategoryError && (
              <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 p-2.5 rounded-lg border border-rose-200 dark:border-rose-900/50">
                {majorCategoryError}
              </p>
            )}

            {/* Minor Category Autocomplete Search (>= 3 chars) */}
            <div className="space-y-2 relative">
              <label htmlFor="buyer-dossier-category-search-input" className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                {UI_STRINGS.vendorCategorySelect.categoryLabel}
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    id="buyer-dossier-category-search-input"
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
                  className="px-3.5 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg cursor-pointer shrink-0"
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
                    <span className="text-[9px] text-indigo-600 dark:text-indigo-400 font-semibold">{UI_STRINGS.vendorCategorySelect.masterCountBadge}</span>
                  </div>
                  {filteredCategorySuggestions.length > 0 ? (
                    filteredCategorySuggestions.map((category) => (
                      <button
                        key={category}
                        type="button"
                        role="option"
                        aria-selected={selectedCategoriesDraft.includes(category)}
                        onClick={() => handleAddCategoryTag(category)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-indigo-50 dark:hover:bg-indigo-950/60 flex items-center justify-between text-slate-700 dark:text-gray-200 transition-colors cursor-pointer"
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
                        className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
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
          aria-label="RFQ Details"
          className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            e.stopPropagation();
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
                    {RFQ_MODE_LABELS[selectedRfqForModal.sourcingMode] || EMPTY_VALUE}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                    {selectedRfqForModal.status || EMPTY_VALUE}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{selectedRfqForModal.title}</p>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedRfqForModal(null);
                }}
                aria-label="Close RFQ popup"
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer"
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
                    {selectedRfqForModal.deliveryLocation || EMPTY_VALUE}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Delivery Date</span>
                  <span className="font-extrabold text-slate-900 dark:text-white mt-0.5 block truncate">
                    {selectedRfqForModal.targetDeliveryDate ? formatIndianDateTime(selectedRfqForModal.targetDeliveryDate) : EMPTY_VALUE}
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
                            <td className="p-2.5 font-semibold">{q.vendorName || EMPTY_VALUE}</td>
                            <td className="p-2.5 font-bold text-emerald-600 dark:text-emerald-400">
                              {q.totalPrice != null ? formatCurrency(q.totalPrice) : EMPTY_VALUE}
                            </td>
                            <td className="p-2.5 text-slate-500">{q.leadTimeDays != null ? `${q.leadTimeDays} days` : EMPTY_VALUE}</td>
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
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedRfqForModal(null);
                }}
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
            e.stopPropagation();
            if (e.target === e.currentTarget) setSelectedEmailModal(null);
          }}
        >
          <div
            className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
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
      {/* MODAL: RECORD COMMUNICATION & ACTIVITY MODAL */}
      {/* ------------------------------------------------------------------------ */}
      {isComposeOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            e.stopPropagation();
            if (e.target === e.currentTarget) setIsComposeOpen(false);
          }}
        >
          <div
            className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <MessageSquare className="w-4.5 h-4.5 text-indigo-600 dark:text-indigo-400" />
                <span>{strings.compose.title}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsComposeOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X size={18} />
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
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { id: 'CALL', label: 'Call Log', icon: PhoneCall },
                    { id: 'EMAIL', label: 'Email', icon: Mail },
                    { id: 'SMS', label: 'SMS', icon: Smartphone },
                    { id: 'WHATSAPP', label: 'WhatsApp', icon: MessageSquare },
                  ].map((ch) => {
                    const Icon = ch.icon;
                    const isSelected = composeChannel === ch.id;
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => {
                          setComposeChannel(ch.id as any);
                          if (ch.id === 'CALL' || ch.id === 'SMS' || ch.id === 'WHATSAPP') {
                            setComposeRecipient(buyer.mobileNumber || buyer.corporateEmail || '');
                          } else {
                            setComposeRecipient(buyer.corporateEmail || buyer.mobileNumber || '');
                          }
                        }}
                        className={`flex flex-col items-center justify-center gap-1 p-2 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-500 text-indigo-700 dark:text-indigo-300'
                            : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                        }`}
                      >
                        <Icon size={16} />
                        <span>{ch.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.compose.recipientLabel}
                </label>
                <input
                  type="text"
                  value={composeRecipient}
                  onChange={(e) => setComposeRecipient(e.target.value)}
                  placeholder={strings.compose.recipientPlaceholder}
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
                        <option value="">{UI_STRINGS.dataLoad.emptyCell}</option>
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
                      <span>Email Follow-up Call Schedule to Buyer</span>
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
                      onChange={(e) => handleBuyerScenarioChange(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                    >
                      <option value="">-- Choose a sales / conversion scenario --</option>
                      {getScenariosForEntityType('BUYER').map((sc) => (
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
                          onChange={handleLocalBuyerFileSelect}
                          className="hidden"
                        />
                      </label>
                    </div>

                    {vaultLoadError && (
                      <div role="alert" className="flex items-start gap-1.5 p-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-300">
                        <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                        <div className="space-y-0.5">
                          <p>{strings.vaultLoadFailed}</p>
                          <p className="font-mono text-[10px] opacity-80">{vaultLoadError}</p>
                        </div>
                      </div>
                    )}

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
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Calendar size={13} className="text-indigo-600" />
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
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  {isSendingComm && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{strings.compose.sendBtn}</span>
                </button>
              </div>
            </form>
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
            e.stopPropagation();
            if (e.target === e.currentTarget) setSelectedPaymentModal(null);
          }}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
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
                    {typeof selectedPaymentModal.amount === 'number' && Number.isFinite(selectedPaymentModal.amount) ? formatCurrency(selectedPaymentModal.amount) : EMPTY_VALUE}
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

      {/* Vendor Details Modal */}
      {selectedVendorForModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedVendorForModal(null);
          }}
        >
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {selectedVendorForModal.name || selectedVendorForModal.companyName || EMPTY_VALUE}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {strings.uploadedVendors.vendorDetailsTitle}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedVendorForModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                aria-label={strings.uploadedVendors.closeModal}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.uploadedVendors.colCompanyName}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedVendorForModal.companyName || EMPTY_VALUE}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.uploadedVendors.colContactPerson}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedVendorForModal.contactPerson || EMPTY_VALUE}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.uploadedVendors.colEmail}</span>
                <span className="text-indigo-600 dark:text-indigo-400 font-medium break-all">{selectedVendorForModal.email || EMPTY_VALUE}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.uploadedVendors.colPhone}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedVendorForModal.phone || EMPTY_VALUE}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.uploadedVendors.categoryLabel}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedVendorForModal.majorCategory || EMPTY_VALUE}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.uploadedVendors.locationLabel}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedVendorForModal.location || selectedVendorForModal.city || EMPTY_VALUE}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.uploadedVendors.gstinLabel}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">
                  {selectedVendorForModal.gstin || selectedVendorForModal.gst || (selectedVendorForModal as any).gstNumber || EMPTY_VALUE}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.uploadedVendors.panLabel}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedVendorForModal.pan || EMPTY_VALUE}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.uploadedVendors.colUploadDate}</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">
                  {selectedVendorForModal.createdAt ? formatIndianDateTime(selectedVendorForModal.createdAt) : EMPTY_VALUE}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{strings.uploadedVendors.colStatus}</span>
                <span className="text-emerald-600 font-semibold">{selectedVendorForModal.status || EMPTY_VALUE}</span>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setSelectedVendorForModal(null)}
                className="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors cursor-pointer"
              >
                {strings.uploadedVendors.closeModal}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------------ */}
    </div>
  );
}
