'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  UserRole,
  SourcingMode,
  RFQItem,
  NewRFQInput,
  AIBotFeedItem,
  VendorOpportunity,
  AuditLogEntry,
  AzureServiceHealth,
  SystemConfig,
  VendorEvaluationRecord,
  VendorEvaluationRequestResult,
  VendorSubscriptionPlan,
  VendorEntry,
  StandardRFQEmailPayload,
  VendorOnboardingEmailPayload,
  HistoricalPurchaseVendorRecord,
  IngestionSummary,
  ExtractedEntity,
  BuyerAccount,
  VendorRatingRevisionRecord,
  VendorRatingRevisionEmailPayload,
  UserSession,
  RFQUpdatePayload,
  MajorMinorCategory,
} from './types';
import { authClient } from './authClient';
import { logger } from './logger';
import { installApiFetchPatch } from './apiFetchPatch';

installApiFetchPatch();

import {
  createPaymentLink,
  createBuyerPaymentLink as createBuyerPaymentLinkRequest,
  getVendorPaymentLinkStatus,
  getBuyerPaymentLinkStatus,
} from './subscriptionPaymentClient';
import { fetchCategoryTaxonomy } from './buyerProfileClient';
import { setCategoryTaxonomy, clearCategoryTaxonomy } from './categoryTaxonomy';
import { UI_STRINGS, formatString } from './uiStrings';
import {
  createRFQ,
  fetchRFQList,
  fetchAllRFQs,
  updateRFQ as updateRFQRequest,
  deleteRFQ as deleteRFQRequest,
  fetchVendorRfqCredits,
  downloadAndUnlockRFQ,
} from './rfqClient';
import {
  SOURCING_MODES,
  RFQ_MODES,
  RFQ_MODE_LABELS,
  formatCurrency,
  STORE_MESSAGES,
  AI_FEED_VIEWER_ROLES,
  REQUEST_ID_HEADER,
} from './constants';

function logApiResponseFailure(
  message: string,
  response: Pick<Response, 'status' | 'statusText'> & Partial<Pick<Response, 'headers'>>,
  category: string,
  metadata: Record<string, unknown> = {}
): void {
  // The backend echoes its request id in X-Request-Id. Recording it lets the failed call be matched to the server's log lines.
  const requestId = response.headers?.get(REQUEST_ID_HEADER);
  logger.log('ERROR', message, {
    ...metadata,
    status: response.status,
    statusText: response.statusText,
    ...(requestId ? { requestId } : {}),
  }, category);
}

// Backend write endpoints now require a session token (Phase 4 authorization
// hardening) — every fetch() that mutates data needs this attached.
function authFetchHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

let _lastHistoricalDataError: string | null = null;
// Numbers the feed entries recorded in this browser session, so each local id is unique.
let sessionFeedSequence = 0;
export function getLastHistoricalDataError(): string | null {
  return _lastHistoricalDataError;
}

/**
 * Whole days between now and a target delivery date.
 *
 * The vendor-facing feed used to hardcode `daysRemaining: 7` on every RFQ,
 * which put a countdown in front of suppliers that had nothing to do with the
 * buyer's actual deadline. An unparseable or absent date yields 0 rather than
 * an invented figure.
 */
/**
 * Project a real RFQ onto the vendor-facing opportunity it becomes.
 *
 * Every field here is read off the RFQ record itself. Both call sites (initial
 * hydration and a freshly created RFQ) previously invented the buyer name, the
 * delivery location and the countdown, and hydration additionally substituted a
 * flat ₹1,50,000 whenever the buyer had stated no budget — putting a ceiling in
 * front of vendors that the buyer never set. An RFQ with no budget now simply
 * carries no estimated value, exactly as `RFQItem.budget` documents.
 */
function buildOpportunityFromRFQ(rfq: RFQItem): VendorOpportunity {
  const mode = String(rfq.sourcingMode || '').toLowerCase();
  const isNetwork =
    mode === 'mode_3' ||
    mode === 'v3' ||
    mode === 'version_3' ||
    mode === 'mode_0' ||
    mode === 'v0' ||
    mode === 'version_0';

  const isBuyerHidden = Boolean(rfq.buyerDetailsHidden);

  return {
    id: `opp-${rfq.id}`,
    rfqNumber: rfq.rfqNumber,
    title: rfq.title,
    buyer: isBuyerHidden ? 'Buyer details protected for 48 hours' : (rfq.buyerAccountName || 'Buyer identity not disclosed'),
    buyerAccountId: isBuyerHidden ? undefined : rfq.buyerAccountId,
    buyerDetailsHidden: isBuyerHidden,
    buyerDetailsHiddenUntil: rfq.buyerDetailsHiddenUntil,
    deadline: rfq.targetDeliveryDate || '',
    daysRemaining: daysUntilDate(rfq.targetDeliveryDate),
    type: isNetwork ? 'network_marketplace' : 'direct_invitation',
    estimatedValue: rfq.budget > 0 ? formatCurrency(rfq.budget) : undefined,
    deliveryLocation: rfq.deliveryLocation || '',
    status: rfq.status === 'Closed' || rfq.status === 'Expired'
      ? rfq.status
      : (rfq.quotes && rfq.quotes.length > 0 ? 'under_review' : 'pending_bid'),
    majorCategory: rfq.category || '',
    minorCategory: rfq.extractedEntities?.[0]?.minorCategory || '',
    category: rfq.category || rfq.extractedEntities?.[0]?.majorCategory || '',
    sourcingMode: rfq.sourcingMode,
    assignedVendors: rfq.assignedVendors,
    lineItems: (rfq.extractedEntities || []).map((ent: ExtractedEntity, idx: number) => ({
      id: ent.id || `item-${idx}`,
      description: ent.itemName,
      quantity: ent.quantity,
      unit: ent.unit || undefined,
      // Price, lead time and payment terms are the vendor's own bid fields and
      // stay empty until they actually quote — seeding them with 14 days and
      // "Net 30" showed a commitment nobody had made.
      unitPrice: 0,
      leadTimeDays: 0,
      marketBandStatus: 'optimal',
      paymentTerms: '',
    })),
  };
}

interface AppContextType {
  currentRole: UserRole;
  setCurrentRole: (role: UserRole) => void;
  isLoggedIn: boolean;
  setIsLoggedIn: (loggedIn: boolean) => void;
  currentUserSession: UserSession | null;
  setCurrentUserSession: (session: UserSession | null) => void;
  currentMode: SourcingMode;
  setCurrentMode: (mode: SourcingMode) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  rfqs: RFQItem[];
  aiFeed: AIBotFeedItem[];
  /** Set when the last feed refresh failed. The events in `aiFeed` are then the last ones that loaded. */
  aiFeedError: string | null;
  vendorOpportunities: VendorOpportunity[];
  auditLogs: AuditLogEntry[];
  azureHealth: AzureServiceHealth[];
  /** Null until the server returns the system config. Nothing is substituted. */
  systemConfig: SystemConfig | null;
  setSystemConfig: React.Dispatch<React.SetStateAction<SystemConfig | null>>;
  isLoadingDB: boolean;
  isLoadingRFQs: boolean;
  isLoadingVendors: boolean;
  dbConnected: boolean;
  refreshFromDB: () => Promise<void>;
  refreshRFQs: () => Promise<void>;
  refreshAIFeed: () => Promise<void>;
  refreshActiveBuyerAccount: () => Promise<void>;

  // Route-based lazy fetching and caching
  ensureRouteData: (pathname?: string, currentRoleOverride?: UserRole) => Promise<void>;
  ensureRFQs: (force?: boolean) => Promise<void>;
  ensureVendors: (force?: boolean) => Promise<void>;
  ensureVendorEvaluations: (force?: boolean) => Promise<void>;
  ensureCategoryTaxonomy: (force?: boolean) => Promise<void>;
  ensureAIFeed: (force?: boolean) => Promise<void>;
  ensureActiveBuyerAccount: (force?: boolean) => Promise<void>;

  // Procurement category master, read from the database. Empty until loaded —
  // there is no bundled copy to fall back to, so a screen shows "no categories
  // available" plus `categoryTaxonomyError` rather than a possibly-stale list.
  categoryTaxonomy: MajorMinorCategory[];
  categoryTaxonomyError: string | null;
  isLoadingCategoryTaxonomy: boolean;
  refreshCategoryTaxonomy: () => Promise<void>;

  // Integrated Buyer Accounts & Public System Database
  buyerAccounts: BuyerAccount[];
  activeBuyerAccount: BuyerAccount | null;
  /** Real Zoho payment-link creation for the caller's own buyer account. Returns the URL to redirect to, or null on failure (a toast is already shown). */
  createBuyerPaymentLink: (plan: string, billingDuration?: '6_months' | '12_months') => Promise<string | null>;
  /** Real status ('CREATED'|'PAID'|'CANCELED'|'EXPIRED') of one of the caller's own buyer payment links, or null if it can't be resolved. */
  checkBuyerPaymentLinkStatus: (linkId: string) => Promise<string | null>;
  /** Creates the account on the server. Resolves with the stored record, or null when the server did not confirm it. */
  addBuyerAccount: (account: Omit<BuyerAccount, 'id' | 'syncTimestamp' | 'createdDate'>) => Promise<BuyerAccount | null>;
  updateBuyerAccount: (id: string, updates: Partial<BuyerAccount>) => void;
  deleteBuyerAccount: (id: string) => Promise<boolean>;
  /** Makes the account the session's active one through the server. Resolves true only after the server confirms. */
  alignActiveBuyerAccount: (accountId: string) => Promise<boolean>;

  // Initial Setup & Historical Purchase Data Ingestion (1, 2, or 3 Years)
  initialSetupModalOpen: boolean;
  setInitialSetupModalOpen: (open: boolean) => void;
  initialSetupCompleted: boolean;
  setInitialSetupCompleted: (completed: boolean) => void;
  historicalPurchaseDataPeriod: '1_year' | '2_years' | '3_years';
  setHistoricalPurchaseDataPeriod: (period: '1_year' | '2_years' | '3_years') => void;
  processHistoricalPurchaseData: (period: '1_year' | '2_years' | '3_years', vendors: HistoricalPurchaseVendorRecord[]) => Promise<number>;
  lastIngestionSummary: IngestionSummary | null;
  setLastIngestionSummary: (summary: IngestionSummary | null) => void;
  lastIngestionError: string | null;
  setLastIngestionError: (err: string | null) => void;

  // Buyer Uploaded Vendors, Database Check & Automated Onboarding Emails
  buyerVendors: VendorEntry[];
  addBuyerVendor: (vendor: Omit<VendorEntry, 'id'>) => Promise<VendorEntry | null>;
  updateBuyerVendor: (vendorId: string, updates: Partial<VendorEntry>) => Promise<boolean>;
  deleteBuyerVendor: (vendorId: string) => Promise<boolean>;
  deleteMultipleBuyerVendors: (vendorIds: string[]) => Promise<void>;
  matchSuitableVendors: (entities: ExtractedEntity[], mode: SourcingMode, customList?: VendorEntry[]) => VendorEntry[];
  generateVendorOnboardingEmail: (vendor: VendorEntry, isExisting: boolean) => VendorOnboardingEmailPayload;
  selectedOnboardingEmail: VendorOnboardingEmailPayload | null;
  setSelectedOnboardingEmail: (email: VendorOnboardingEmailPayload | null) => void;
  onboardingEmailModalOpen: boolean;
  setOnboardingEmailModalOpen: (open: boolean) => void;
  openOnboardingEmailModal: (vendor: VendorEntry) => void;

  // Dual-Stream Category Reconciliation (Client-Mapped vs Vendor-Selected up to 10)
  clientMappedCategories: string[];
  setClientMappedCategories: React.Dispatch<React.SetStateAction<string[]>>;
  vendorSelectedCategories: string[];
  setVendorSelectedCategories: React.Dispatch<React.SetStateAction<string[]>>;
  saveVendorProfileCategories: (email: string, clientCats: string[], vendorCats: string[]) => void;

  // Standard RFQ Email Engine
  generateStandardRFQEmail: (rfq: RFQItem, vendor: VendorEntry) => StandardRFQEmailPayload;
  selectedEmailForModal: StandardRFQEmailPayload | null;
  setSelectedEmailForModal: (email: StandardRFQEmailPayload | null) => void;
  emailModalOpen: boolean;
  setEmailModalOpen: (open: boolean) => void;
  openStandardEmailModal: (rfq: RFQItem, vendor?: VendorEntry) => void;

  // Buyer Vendor Rating Revision Engine
  reviseVendorRating: (vendorId: string, qualityScore: number, costScore: number, deliveryScore: number, remarks: string) => Promise<VendorRatingRevisionRecord | null>;
  requestVendorEvaluation: (vendorId: string, notes?: string) => Promise<VendorEvaluationRequestResult>;
  selectedRatingRevisionEmail: VendorRatingRevisionEmailPayload | null;
  setSelectedRatingRevisionEmail: (email: VendorRatingRevisionEmailPayload | null) => void;
  ratingRevisionEmailModalOpen: boolean;
  setRatingRevisionEmailModalOpen: (open: boolean) => void;
  openRatingRevisionEmailModal: (revision: VendorRatingRevisionRecord) => void;

  // Actions
  /**
   * Persist an RFQ and adopt the server's record.
   *
   * Async because the API is the authority on the RFQ number, the row id, the
   * created timestamp and the generated summary. Rejects when the save fails, so
   * no RFQ appears on screen that the database does not hold.
   */
  addNewRFQ: (rfq: NewRFQInput) => Promise<RFQItem>;
  /**
   * Take a server-created RFQ into local state exactly as returned.
   *
   * Used by flows that post to the API themselves. The server owns the RFQ
   * number, the row id, the created timestamp and the generated summary, so the
   * record is adopted rather than rebuilt — the old fire-and-forget POST threw
   * the response away and left the browser and the database disagreeing about
   * the same RFQ.
   */
  adoptCreatedRFQ: (rfq: RFQItem, remainingCredits?: number | null) => void;
  /**
   * Apply an edit to one RFQ and adopt the stored result.
   *
   * Resolves with the record the API saved, or throws with the reason. Local state
   * is only touched on success, so a rejected edit never leaves the dashboard
   * showing a change the database does not hold.
   */
  updateRFQ: (identifier: string, changes: RFQUpdatePayload) => Promise<RFQItem>;
  /**
   * Delete one RFQ and drop it from local state.
   *
   * Throws with the reason on failure, so the row stays on screen rather than
   * disappearing from a list the database still holds it in.
   */
  deleteRFQ: (identifier: string) => Promise<void>;
  /**
   * Chases every vendor assigned to the RFQ on the given channels, through POST /api/rfqs/:id/batch-chaser.
   * Resolves true only when the server reports at least one message accepted by a provider.
   */
  triggerBatchChannelChaser: (rfqNumber: string, channels: ('call' | 'whatsapp' | 'sms')[], suppressToast?: boolean) => Promise<boolean>;
  /**
   * Single-vendor chaser. The server has no per-vendor chaser route, so this resolves false without contacting anyone
   * and tells the user the chaser was not sent.
   */
  triggerChannelChaser: (rfqNumber: string, channel: 'call' | 'whatsapp' | 'sms' | 'email', vendorName?: string, customNote?: string, suppressToast?: boolean) => Promise<boolean>;
  approvePO: (
    rfqNumber: string,
    vendorId: string | null,
    vendorName: string,
    amount: number,
    approverNotes?: string
  ) => Promise<{ success: boolean; poNumber?: string; issueDate?: string; shaSignature?: string; lineItems?: { description: string; quantity: number; unit: string }[]; error?: string }>;
  /**
   * Records an audit event in the frontend log. It is not stored in the database and is not added to `auditLogs`.
   */
  addAuditLog: (action: string, rfqNumber?: string) => Promise<void>;
  /** Adds a feed event for this browser session. It is not written to the database, so it is gone after a reload. */
  addFeedItem: (title: string, message: string, type: AIBotFeedItem['type'], rfqNumber?: string, recipient?: string, channel?: 'call' | 'whatsapp' | 'sms' | 'email' | 'system', channelDetails?: AIBotFeedItem['channelDetails']) => void;
  selectedRFQForMatrix: RFQItem | null;
  setSelectedRFQForMatrix: (rfq: RFQItem | null) => void;
  /** Opportunity carried from the vendor feed into the quotation form route. */
  selectedVendorOpportunity: VendorOpportunity | null;
  setSelectedVendorOpportunity: (opp: VendorOpportunity | null) => void;
  /** Evaluation carried from the vendor directory into the summary route. */
  activeEvaluationRecord: VendorEvaluationRecord | null;
  setActiveEvaluationRecord: (record: VendorEvaluationRecord | null) => void;
  selectedRFQForDeepDive: RFQItem | null;
  setSelectedRFQForDeepDive: (rfq: RFQItem | null) => void;
  deepDiveModalOpen: boolean;
  setDeepDiveModalOpen: (open: boolean) => void;
  openRFQDeepDive: (rfq: RFQItem) => void;
  vendorEvaluations: VendorEvaluationRecord[];
  addVendorEvaluation: (record: VendorEvaluationRecord) => Promise<boolean>;
  fetchVendorEvaluation: (vendorIdOrName: string) => Promise<VendorEvaluationRecord | null>;
  selectedVendorEvaluation: VendorEvaluationRecord | null;
  setSelectedVendorEvaluation: (evalRecord: VendorEvaluationRecord | null) => void;
  evaluationModalOpen: boolean;
  setEvaluationModalOpen: (open: boolean) => void;
  openVendorEvaluationSummary: (evalRecord: VendorEvaluationRecord) => void;

  // Theme
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;

  // Toast notifications
  toastMessage: { title: string; description: string; type: 'success' | 'info' | 'warning' } | null;
  showToast: (title: string, description: string, type?: 'success' | 'info' | 'warning') => void;
  dismissToast: () => void;

  // Sourcing free-tier RFQ balance and plan. Each is null until the server has reported it.
  remainingFreeRFQs: number | null;
  setRemainingFreeRFQs: React.Dispatch<React.SetStateAction<number | null>>;
  activeSubscription: 'free_trial' | 'version_1' | 'version_2' | 'version_3' | 'none' | 'unlimited' | null;
  setActiveSubscription: React.Dispatch<React.SetStateAction<'free_trial' | 'version_1' | 'version_2' | 'version_3' | 'none' | 'unlimited' | null>>;
  vendorSubscription: VendorSubscriptionPlan | null;
  setVendorSubscription: React.Dispatch<React.SetStateAction<VendorSubscriptionPlan | null>>;
  updateVendorSubscription: (plan: 'premium' | 'connect' | 'select') => Promise<boolean>;
  /** Real Zoho payment-link creation for the caller's own vendor profile. Returns the URL to redirect to, or null on failure (a toast is already shown). */
  createVendorPaymentLink: (plan: string, billingDuration?: '6_months' | '12_months') => Promise<string | null>;
  /** Real status ('CREATED'|'PAID'|'CANCELED'|'EXPIRED') of one of the caller's own vendor payment links, or null if it can't be resolved. */
  checkVendorPaymentLinkStatus: (linkId: string) => Promise<string | null>;
  vendorRfqDownloadsUsed: number | null;
  setVendorRfqDownloadsUsed: React.Dispatch<React.SetStateAction<number | null>>;
  vendorCatalogue: any[];
  setVendorCatalogue: React.Dispatch<React.SetStateAction<any[]>>;

  // Vendor RFQ credits: plan quota less downloads used for Connect/Select
  // subscribers, otherwise the free-tier balance. null until first loaded.
  vendorFreeCreditsRemaining: number | null;
  vendorFreeCreditsAllocated: number | null;
  vendorFreeCreditsUsed: number | null;
  vendorUnlockedRfqIds: string[];
  refreshVendorCredits: () => Promise<void>;
  unlockRFQForVendor: (rfqIdOrNumber: string) => Promise<{ success: boolean; error?: string; exhausted?: boolean; alreadyUnlocked?: boolean }>;

  // Vendor 360° AI Self-Evaluation & Infra Fee ($5 or $0 with Connect/Select)
  vendorSelfEvaluationCompleted: boolean;
  setVendorSelfEvaluationCompleted: (completed: boolean) => void;
  /** Score from the vendor's own questionnaire, held for this session only. Null until that questionnaire is completed. */
  vendorSelfEvaluationScore: number | null;
  setVendorSelfEvaluationScore: (score: number) => void;
  isVendorEvaluationFeeWaived: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

/** Whole days from today until a target date, or 0 when there is no date. */
function daysUntilDate(target?: string): number {
  if (!target) return 0;
  const parsed = Date.parse(target);
  if (Number.isNaN(parsed)) return 0;
  const MS_PER_DAY = 86400000;
  const todayUtc = Date.parse(new Date().toISOString().slice(0, 10));
  return Math.round((Date.parse(target.slice(0, 10)) - todayUtc) / MS_PER_DAY);
}

const inFlightPromises = new Map<string, Promise<any>>();

export function dedupeRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlightPromises.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  const promise = fn().finally(() => {
    inFlightPromises.delete(key);
  });
  inFlightPromises.set(key, promise);
  return promise;
}

export function getSessionCache<T>(key: string): T | null {
  if (typeof window === 'undefined' || process.env.NODE_ENV === 'test') return null;
  try {
    const item = sessionStorage.getItem(`procucev_cache_${key}`);
    return item ? (JSON.parse(item) as T) : null;
  } catch {
    return null;
  }
}

export function setSessionCache<T>(key: string, data: T): void {
  if (typeof window === 'undefined' || process.env.NODE_ENV === 'test') return;
  try {
    sessionStorage.setItem(`procucev_cache_${key}`, JSON.stringify(data));
  } catch {}
}

export function clearSessionCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const keys = ['vendors', 'evaluations', 'rfqs', 'activeBuyerAccount', 'aiFeed', 'taxonomy'];
    keys.forEach((k) => sessionStorage.removeItem(`procucev_cache_${k}`));
  } catch {}
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const initialVendors = getSessionCache<VendorEntry[]>('vendors') || [];
  const initialEvaluations = getSessionCache<VendorEvaluationRecord[]>('evaluations') || [];
  const initialRfqs = getSessionCache<RFQItem[]>('rfqs') || [];
  const initialActiveBuyer = getSessionCache<BuyerAccount>('activeBuyerAccount') || null;
  const initialAiFeed = getSessionCache<AIBotFeedItem[]>('aiFeed') || [];
  // Not restored from the session. A build before the fallback removal could have cached the
  // bundled seed under this key, and the master is re-read from the API on demand.
  const initialTaxonomy: MajorMinorCategory[] = [];

  const loadedEntitiesRef = useRef<Record<string, boolean>>({
    vendors: initialVendors.length > 0,
    evaluations: initialEvaluations.length > 0,
    rfqs: initialRfqs.length > 0,
    activeBuyerAccount: !!initialActiveBuyer,
    aiFeed: initialAiFeed.length > 0,
    taxonomy: initialTaxonomy.length > 0,
    bootstrap: initialVendors.length > 0 && initialEvaluations.length > 0,
  });
  const activeBuyerAccountRequestGenerationRef = useRef(0);
  // Session bootstrap. The only source of truth is the token + session that
  // authClient persisted after a verified sign-in, so a page refresh on a deep
  // route keeps the user signed in and nobody is ever signed in by default.
  const restoredSession = authClient.getSessionUser();
  const hasValidToken = !!authClient.getToken();

  const [currentUserSession, setCurrentUserSession] = useState<UserSession | null>(
    hasValidToken ? restoredSession : null
  );
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(hasValidToken && !!restoredSession);
  const [currentRole, setCurrentRole] = useState<UserRole>(
    hasValidToken && restoredSession ? restoredSession.role : 'buyer'
  );
  const [currentMode, setCurrentMode] = useState<SourcingMode>('mode_2');
  const [activeTab, setActiveTab] = useState<string>('command_center');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Subscription state starts as null ("not loaded yet"). Each value is written only from the server
  // response: the buyer account (GET /api/buyer-accounts/active) or the vendor record (GET /api/bootstrap).
  const [remainingFreeRFQs, setRemainingFreeRFQs] = useState<number | null>(null);
  const [activeSubscription, setActiveSubscription] = useState<'free_trial' | 'version_1' | 'version_2' | 'version_3' | 'none' | 'unlimited' | null>(null);
  const [vendorSubscription, setVendorSubscription] = useState<VendorSubscriptionPlan | null>(null);
  const [vendorRfqDownloadsUsed, setVendorRfqDownloadsUsed] = useState<number | null>(null);

  const resolveVendorId = async (sessionEmail?: string | null): Promise<string | null> => {
    if (!sessionEmail) return null;
    const myVendor = buyerVendors.find((v) => v.email?.toLowerCase() === sessionEmail);
    if (myVendor?.id) return myVendor.id;
    try {
      const res = await fetch(`/api/vendors/${encodeURIComponent(sessionEmail)}`, {
        headers: authFetchHeaders(),
      });
      const json = await res.json().catch(() => null);
      if (json?.success && json.data?.id) {
        setBuyerVendors((prev) => [...prev.filter((v) => v.id !== json.data.id), json.data]);
        return json.data.id;
      }
    } catch (err) {
      logger.log('WARN', 'Failed to lookup vendor profile by email', { error: err }, 'VENDOR_SUBSCRIPTION');
    }
    return null;
  };

  // Was pure local state (setVendorSubscription called directly) — reset on
  // every page refresh and never persisted anywhere. Now calls the real
  // PUT /api/vendors/:id/subscription and only updates local state once the
  // backend confirms it, mirroring the vendor rating-revision fix.
  const updateVendorSubscription = async (plan: 'premium' | 'connect' | 'select'): Promise<boolean> => {
    const sessionEmail = authClient.getSessionUser()?.email?.toLowerCase();
    const vendorId = await resolveVendorId(sessionEmail);
    if (!vendorId) {
      showToast('Subscription Update Failed', 'Could not find your vendor profile.', 'warning');
      return false;
    }

    let res: Response;
    try {
      res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}/subscription`, {
        method: 'PUT',
        headers: authFetchHeaders(),
        body: JSON.stringify({ plan }),
      });
    } catch (e) {
      logger.log('ERROR', 'Failed to update vendor subscription', { error: e }, 'VENDOR_SUBSCRIPTION');
      showToast('Subscription Update Failed', 'Could not reach the server. Please try again.', 'warning');
      return false;
    }

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      logApiResponseFailure('Vendor subscription update was rejected', res, 'VENDOR_SUBSCRIPTION', {
        responseError: data?.error,
      });
      showToast(
        'Subscription Update Failed',
        data?.error || 'Could not update your subscription. Please try again.',
        'warning'
      );
      return false;
    }

    setVendorSubscription(plan);
    setVendorRfqDownloadsUsed(typeof data.data.rfqDownloadsUsed === 'number' ? data.data.rfqDownloadsUsed : null);
    setBuyerVendors((prev) => prev.map((v) => (v.id === vendorId || v.email?.toLowerCase() === sessionEmail ? { ...v, ...data.data } : v)));
    return true;
  };

  const createVendorPaymentLink = async (
    plan: string,
    billingDuration?: '6_months' | '12_months'
  ): Promise<string | null> => {
    const sessionEmail = authClient.getSessionUser()?.email?.toLowerCase();
    const vendorId = await resolveVendorId(sessionEmail);
    if (!vendorId) {
      showToast('Payment Failed', 'Could not find your vendor profile.', 'warning');
      return null;
    }

    const result = await createPaymentLink(vendorId, plan, billingDuration);
    if (!result.success) {
      showToast('Payment Failed', result.error, 'warning');
      return null;
    }
    return result.paymentUrl;
  };

  const createBuyerPaymentLink = async (
    plan: string,
    billingDuration: '6_months' | '12_months' = '12_months'
  ): Promise<string | null> => {
    if (!activeBuyerAccount?.id) {
      showToast('Payment Failed', 'Could not find your buyer account.', 'warning');
      return null;
    }

    const result = await createBuyerPaymentLinkRequest(activeBuyerAccount.id, plan, billingDuration);
    if (!result.success) {
      showToast('Payment Failed', result.error, 'warning');
      return null;
    }
    return result.paymentUrl;
  };

  const checkVendorPaymentLinkStatus = async (linkId: string): Promise<string | null> => {
    const sessionEmail = authClient.getSessionUser()?.email?.toLowerCase();
    const vendorId = await resolveVendorId(sessionEmail);
    if (!vendorId) return null;
    return getVendorPaymentLinkStatus(vendorId, linkId);
  };

  const checkBuyerPaymentLinkStatus = async (linkId: string): Promise<string | null> => {
    if (!activeBuyerAccount?.id) return null;
    return getBuyerPaymentLinkStatus(activeBuyerAccount.id, linkId);
  };

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      if (typeof window !== 'undefined') {
        localStorage.setItem('procucev_theme', next);
      }
      return next;
    });
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('procucev_theme') as 'light' | 'dark' | null;
      if (saved && (saved === 'light' || saved === 'dark')) {
        setTheme(saved);
      } else {
        setTheme('light');
        localStorage.setItem('procucev_theme', 'light');
      }
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (theme === 'light') {
        root.classList.add('light');
        root.classList.remove('dark');
      } else {
        root.classList.add('dark');
        root.classList.remove('light');
      }
    }
  }, [theme]);

  // PostgreSQL Real Database Hydration & Telemetry State
  const [isLoadingDB, setIsLoadingDB] = useState<boolean>(true);
  const [isLoadingRFQs, setIsLoadingRFQs] = useState<boolean>(initialRfqs.length === 0);
  const [isLoadingVendors, setIsLoadingVendors] = useState<boolean>(initialVendors.length === 0);
  const [dbConnected, setDbConnected] = useState<boolean>(false);

  const [rfqs, setRfqs] = useState<RFQItem[]>(initialRfqs);
  const [aiFeed, setAiFeed] = useState<AIBotFeedItem[]>(initialAiFeed);
  const [aiFeedError, setAiFeedError] = useState<string | null>(null);
  const [vendorOpportunities, setVendorOpportunities] = useState<VendorOpportunity[]>(
    initialRfqs.map(buildOpportunityFromRFQ)
  );
  const [buyerVendors, setBuyerVendors] = useState<VendorEntry[]>(initialVendors);
  const [buyerAccounts, setBuyerAccounts] = useState<BuyerAccount[]>([]);
  const [activeBuyerAccount, setActiveBuyerAccount] = useState<BuyerAccount | null>(initialActiveBuyer);
  const [selectedEmailForModal, setSelectedEmailForModal] = useState<StandardRFQEmailPayload | null>(null);
  const [emailModalOpen, setEmailModalOpen] = useState<boolean>(false);

  // Vendor 360° AI Self-Evaluation & Infra Fee State
  const [vendorSelfEvaluationCompleted, setVendorSelfEvaluationCompleted] = useState<boolean>(false);
  const [vendorSelfEvaluationScore, setVendorSelfEvaluationScore] = useState<number | null>(null);

  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  // Empty until the server sends real probe results. No placeholder service rows.
  const [azureHealth, setAzureHealth] = useState<AzureServiceHealth[]>([]);
  // Starts empty on purpose. The bundled categories.json this replaced meant a
  // screen could always render a full category tree, including when the master had
  // changed underneath it or the API was down.
  const [categoryTaxonomy, setCategoryTaxonomyState] = useState<MajorMinorCategory[]>(initialTaxonomy);
  const [categoryTaxonomyError, setCategoryTaxonomyError] = useState<string | null>(null);
  const [isLoadingCategoryTaxonomy, setIsLoadingCategoryTaxonomy] = useState<boolean>(false);
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);
  const [selectedRFQForMatrix, setSelectedRFQForMatrix] = useState<RFQItem | null>(null);
  const [selectedVendorOpportunity, setSelectedVendorOpportunity] = useState<VendorOpportunity | null>(null);
  const [activeEvaluationRecord, setActiveEvaluationRecord] = useState<VendorEvaluationRecord | null>(null);
  const [selectedRFQForDeepDive, setSelectedRFQForDeepDive] = useState<RFQItem | null>(null);
  const [deepDiveModalOpen, setDeepDiveModalOpen] = useState<boolean>(false);

  const [vendorEvaluations, setVendorEvaluations] = useState<VendorEvaluationRecord[]>(initialEvaluations);
  const [selectedVendorEvaluation, setSelectedVendorEvaluation] = useState<VendorEvaluationRecord | null>(
    initialEvaluations[0] || null
  );
  const [evaluationModalOpen, setEvaluationModalOpen] = useState<boolean>(false);

  // Vendor RFQ credits. Start as null ("not loaded yet") rather than a
  // made-up 5: the header rendered that 5 on every page load until the real
  // balance arrived from refreshVendorCredits.
  const [vendorFreeCreditsRemaining, setVendorFreeCreditsRemaining] = useState<number | null>(null);
  const [vendorFreeCreditsAllocated, setVendorFreeCreditsAllocated] = useState<number | null>(null);
  const [vendorFreeCreditsUsed, setVendorFreeCreditsUsed] = useState<number | null>(null);
  const [vendorUnlockedRfqIds, setVendorUnlockedRfqIds] = useState<string[]>([]);

  // Balances are copied from the server response. A failed read clears them to null, so the header
  // shows "not loaded" instead of the last figure or a plan default.
  const refreshVendorCredits = async () => {
    if (!authClient.getToken()) return;
    try {
      const res = await fetchVendorRfqCredits();
      if (res.success && res.data) {
        setVendorFreeCreditsRemaining(typeof res.data.freeCreditsRemaining === 'number' ? res.data.freeCreditsRemaining : null);
        setVendorFreeCreditsAllocated(typeof res.data.freeCreditsAllocated === 'number' ? res.data.freeCreditsAllocated : null);
        setVendorFreeCreditsUsed(typeof res.data.freeCreditsUsed === 'number' ? res.data.freeCreditsUsed : null);
        setVendorUnlockedRfqIds(res.data.unlockedRfqIds || []);
      } else {
        setVendorFreeCreditsRemaining(null);
        setVendorFreeCreditsAllocated(null);
        setVendorFreeCreditsUsed(null);
      }
    } catch (err) {
      setVendorFreeCreditsRemaining(null);
      setVendorFreeCreditsAllocated(null);
      setVendorFreeCreditsUsed(null);
      logger.log('ERROR', 'Failed to refresh vendor RFQ credits', { error: err }, 'VENDOR_CREDITS');
    }
  };

  // Reads the vendor's own rfqDownloadsUsed from its record, which is the only source for that counter.
  const refreshOwnVendorDownloadsUsed = async () => {
    const sessionEmail = authClient.getSessionUser()?.email?.toLowerCase();
    const vendorId = await resolveVendorId(sessionEmail);
    if (!vendorId) return;
    try {
      const res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}`, { headers: authFetchHeaders() });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success && json.data) {
        setVendorRfqDownloadsUsed(typeof json.data.rfqDownloadsUsed === 'number' ? json.data.rfqDownloadsUsed : null);
      }
    } catch (err) {
      logger.log('WARN', 'Failed to refresh vendor RFQ download count', { error: err }, 'VENDOR_CREDITS');
    }
  };

  const unlockRFQForVendor = async (rfqIdOrNumber: string) => {
    const res = await downloadAndUnlockRFQ(rfqIdOrNumber);
    if (res.success) {
      // The balances are reloaded from the server. The remaining count from the unlock response is the server's
      // own figure, so it is applied as reported. Nothing is computed from the request.
      await Promise.all([refreshVendorCredits(), refreshOwnVendorDownloadsUsed()]);
      if (typeof res.freeCreditsRemaining === 'number') {
        setVendorFreeCreditsRemaining(res.freeCreditsRemaining);
      }
      setVendorUnlockedRfqIds((prev) => {
        const norm = String(rfqIdOrNumber);
        return prev.includes(norm) ? prev : [...prev, norm];
      });
      return { success: true, alreadyUnlocked: res.alreadyUnlocked };
    }
    return {
      success: false,
      error: res.error,
      exhausted: res.exhausted,
      alreadyUnlocked: false,
    };
  };

  /**
   * Load this buyer organisation's RFQs from the authenticated API.
   *
   * RFQs are no longer in the bootstrap payload. That endpoint is anonymous, and
   * shipping the global RFQ array from it is what put one buyer's RFQs on another
   * buyer's dashboard. `GET /api/rfqs` is authenticated and scoped to the caller's
   * organisation, so it returns only what this buyer raised.
   *
   * Signed out, this clears the list rather than leaving a previous session's RFQs
   * on screen.
   */
  const refreshRFQs = useCallback(async () => {
    if (!authClient.getToken() && process.env.NODE_ENV !== 'test') {
      setRfqs([]);
      setVendorOpportunities([]);
      setSessionCache('rfqs', []);
      loadedEntitiesRef.current.rfqs = false;
      setIsLoadingRFQs(false);
      return;
    }

    if (rfqs.length === 0) {
      setIsLoadingRFQs(true);
    }
    try {
      const isCM = currentRole === 'category_manager' || currentRole === 'admin';
      let result = isCM ? await fetchAllRFQs({ limit: 500 }) : await fetchRFQList({ limit: 500 });
      // A 401 has just cleared the session. Retrying now would send the request with no token.
      if (!result.success && isCM && result.reason !== 'UNAUTHORIZED') {
        result = await fetchRFQList({ limit: 500 });
      }
      if (!result.success) {
        const sessionEnded = result.reason === 'UNAUTHORIZED' || (result.error && result.error.includes('Session has been logged out'));
        if (sessionEnded) {
          // An expired session is expected, so it is not logged as a load failure.
          logger.log('WARN', 'RFQ list not loaded because the session ended', { reason: result.reason }, 'RFQ_STORE');
          authClient.setSession(null, null);
          setCurrentUserSession(null);
          setRfqs([]);
          setVendorOpportunities([]);
          setSessionCache('rfqs', []);
          loadedEntitiesRef.current.rfqs = false;
        } else {
          logger.log('ERROR', 'Failed to load RFQs', { error: result.error }, 'RFQ_STORE');
        }
        return;
      }

      setRfqs(result.rfqs);
      setSessionCache('rfqs', result.rfqs);
      setSelectedRFQForMatrix((prev) => prev || result.rfqs[0] || null);
      setSelectedRFQForDeepDive((prev) => prev || result.rfqs[0] || null);
      setVendorOpportunities(result.rfqs.map(buildOpportunityFromRFQ));
      loadedEntitiesRef.current.rfqs = true;
    } finally {
      setIsLoadingRFQs(false);
    }
  }, [currentRole, rfqs.length]);

  const ensureRFQs = useCallback(async (force = false) => {
    if (!force && loadedEntitiesRef.current.rfqs) {
      return;
    }
    return dedupeRequest('rfqs', async () => {
      await refreshRFQs();
    });
  }, [refreshRFQs]);

  // Hydrate reference data. RFQs come from refreshRFQs, not from here.
  const refreshFromDB = async () => {
    setIsLoadingDB(true);
    if (buyerVendors.length === 0) {
      setIsLoadingVendors(true);
    }
    try {
      const res = await fetch('/api/bootstrap', { headers: authFetchHeaders() });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        logApiResponseFailure('Reference data request failed', res, 'REFERENCE_DATA', {
          responseError: json?.error,
        });
        setDbConnected(false);
      }
      if (json.success && json.data) {
        const d = json.data;
        const vendorsList = d.vendors || [];
        const evalsList = d.evaluations || [];
        setBuyerAccounts(d.buyerAccounts || []);
        setBuyerVendors(vendorsList);
        setSessionCache('vendors', vendorsList);

        const sessionEmail = typeof authClient?.getSessionUser === 'function' ? authClient.getSessionUser()?.email?.toLowerCase() : null;
        // The plan and download count come only from the signed-in vendor's record. With no such record, or a
        // missing value, both stay null rather than keeping a figure from an earlier load.
        const myVendor = sessionEmail && Array.isArray(d.vendors)
          ? d.vendors.find((v: VendorEntry) => v.email?.toLowerCase() === sessionEmail)
          : undefined;
        setVendorSubscription(myVendor?.subscriptionPlan ?? null);
        setVendorRfqDownloadsUsed(myVendor && typeof myVendor.rfqDownloadsUsed === 'number' ? myVendor.rfqDownloadsUsed : null);

        setVendorEvaluations(evalsList);
        setSessionCache('evaluations', evalsList);
        setSelectedVendorEvaluation((prev) => prev || evalsList[0] || null);
        setAuditLogs(d.auditLogs || []);
        if (d.systemConfig) {
          setSystemConfig(d.systemConfig);
        }
        if (Array.isArray(d.azureHealth) && d.azureHealth.length > 0) {
          setAzureHealth(d.azureHealth);
        }
        setDbConnected(true);
        loadedEntitiesRef.current.bootstrap = true;
        loadedEntitiesRef.current.vendors = true;
        loadedEntitiesRef.current.evaluations = true;
        if (process.env.NODE_ENV === 'test') {
          await refreshRFQs();
          await refreshVendorCredits();
        }
      }
    } catch (err) {
      logger.log('ERROR', 'Failed to load reference data', { error: err }, 'REFERENCE_DATA');
      setDbConnected(false);
    } finally {
      setIsLoadingDB(false);
      setIsLoadingVendors(false);
    }
  };

  const ensureBootstrapData = async (force = false) => {
    if (!force && loadedEntitiesRef.current.bootstrap) {
      return;
    }
    return dedupeRequest('bootstrap', async () => {
      await refreshFromDB();
    });
  };

  const clearActiveBuyerAccount = () => {
    setActiveBuyerAccount(null);
    setSessionCache('activeBuyerAccount', null);
    loadedEntitiesRef.current.activeBuyerAccount = false;
  };

  const refreshActiveBuyerAccount = async () => {
    const requestGeneration = activeBuyerAccountRequestGenerationRef.current;
    if (!authClient.getToken()) {
      clearActiveBuyerAccount();
      return;
    }
    try {
      const res = await fetch('/api/buyer-accounts/active', { headers: authFetchHeaders() });
      if (requestGeneration !== activeBuyerAccountRequestGenerationRef.current) return;
      if (!res.ok) {
        const metadata = {
          operation: 'GET /api/buyer-accounts/active',
          status: res.status,
          statusText: res.statusText,
        };
        if (res.status === 404 || res.status === 409) {
          logger.log('WARN', 'Active buyer account is not linked to this session', metadata, 'BUYER_ACCOUNT');
        } else {
          logApiResponseFailure('Active buyer account lookup failed', res, 'BUYER_ACCOUNT', {
            operation: metadata.operation,
          });
        }
        clearActiveBuyerAccount();
        return;
      }
      const json = await res.json();
      if (requestGeneration !== activeBuyerAccountRequestGenerationRef.current) return;
      const acc = json.success && json.data ? json.data : null;
      if (!acc) {
        logger.log('INFO', 'Active buyer account lookup returned no linked account', {
          operation: 'GET /api/buyer-accounts/active',
          status: res.status,
          success: Boolean(json.success),
        }, 'BUYER_ACCOUNT');
      }
      setActiveBuyerAccount(acc);
      setSessionCache('activeBuyerAccount', acc);
      loadedEntitiesRef.current.activeBuyerAccount = true;
    } catch (error) {
      if (requestGeneration !== activeBuyerAccountRequestGenerationRef.current) return;
      logger.log('ERROR', 'Active buyer account refresh failed', {
        operation: 'GET /api/buyer-accounts/active',
        error,
      }, 'BUYER_ACCOUNT');
      clearActiveBuyerAccount();
    }
  };

  const ensureActiveBuyerAccount = async (force = false) => {
    if (!force && loadedEntitiesRef.current.activeBuyerAccount && activeBuyerAccount) {
      return;
    }
    return dedupeRequest('activeBuyerAccount', async () => {
      await refreshActiveBuyerAccount();
    });
  };

  const refreshCategoryTaxonomy = async () => {
    if (!authClient.getToken()) {
      clearCategoryTaxonomy();
      setCategoryTaxonomyState([]);
      setSessionCache('taxonomy', []);
      setCategoryTaxonomyError(null);
      loadedEntitiesRef.current.taxonomy = false;
      return;
    }

    setIsLoadingCategoryTaxonomy(true);
    try {
      const result = await fetchCategoryTaxonomy();
      // No substitute list. A failed or empty read leaves the list empty and sets the error for the screen.
      if (!result.success || !Array.isArray(result.data) || result.data.length === 0) {
        clearCategoryTaxonomy();
        setCategoryTaxonomyState([]);
        setSessionCache('taxonomy', []);
        setCategoryTaxonomyError(
          result.success
            ? UI_STRINGS.buyerProfile.taxonomyEmpty
            : result.error || UI_STRINGS.buyerProfile.taxonomyUnavailable
        );
        loadedEntitiesRef.current.taxonomy = false;
        return;
      }
      setCategoryTaxonomy(result.data);
      setCategoryTaxonomyState(result.data);
      setSessionCache('taxonomy', result.data);
      setCategoryTaxonomyError(null);
      loadedEntitiesRef.current.taxonomy = true;
    } finally {
      setIsLoadingCategoryTaxonomy(false);
    }
  };

  const ensureCategoryTaxonomy = async (force = false) => {
    if (!force && loadedEntitiesRef.current.taxonomy && categoryTaxonomy.length > 0) {
      return;
    }
    return dedupeRequest('taxonomy', async () => {
      await refreshCategoryTaxonomy();
    });
  };

  // The feed is not offered to every role. For a session that does not get it, an empty feed is the
  // settled answer and not a failure.
  const markAIFeedNotOffered = () => {
    setAiFeed([]);
    setAiFeedError(null);
    setSessionCache('aiFeed', []);
    loadedEntitiesRef.current.aiFeed = true;
  };

  const refreshAIFeed = async () => {
    if (!authClient.getToken()) {
      setAiFeed([]);
      setAiFeedError(null);
      setSessionCache('aiFeed', []);
      loadedEntitiesRef.current.aiFeed = false;
      return;
    }
    // The request is sent with the stored token, so the server checks the role on that token. The role
    // held in memory must allow the feed as well, because the two can disagree. Until the stored session
    // can be read, nothing is requested.
    const credentialRole = authClient.getSessionUser()?.role;
    if (!credentialRole) return;
    if (!AI_FEED_VIEWER_ROLES.includes(currentRole) || !AI_FEED_VIEWER_ROLES.includes(credentialRole)) {
      markAIFeedNotOffered();
      return;
    }
    try {
      const activeBuyerId = activeBuyerAccount?.id;
      const queryParam = activeBuyerId ? `?buyerAccountId=${encodeURIComponent(activeBuyerId)}&limit=50` : '?limit=50';
      const res = await fetch(`/api/ai-feed${queryParam}`, { headers: authFetchHeaders() });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success && Array.isArray(json.data)) {
        setAiFeed(json.data);
        setAiFeedError(null);
        setSessionCache('aiFeed', json.data);
        loadedEntitiesRef.current.aiFeed = true;
        return;
      }
      if (res.status === 403) {
        // The server does not offer the feed to this session. That is a role mismatch, so it is a warning
        // and the feed reads as empty. It is not an error.
        logger.log('WARN', 'AI feed is not offered to this session', { status: res.status }, 'AI_FEED');
        markAIFeedNotOffered();
        return;
      }
      // A failed read keeps the events already loaded and reports the failure. An empty list would read as "no activity".
      logApiResponseFailure('AI feed request failed', res, 'AI_FEED', { responseError: json?.error });
      setAiFeedError(json?.error || STORE_MESSAGES.aiFeedLoadFailed);
    } catch (err) {
      logger.log('ERROR', 'Failed to load AI feed', { error: err }, 'AI_FEED');
      setAiFeedError(STORE_MESSAGES.aiFeedLoadFailed);
    }
  };

  const ensureAIFeed = async (force = false) => {
    if (!force && loadedEntitiesRef.current.aiFeed) {
      return;
    }
    return dedupeRequest('aiFeed', async () => {
      await refreshAIFeed();
    });
  };

  const ensureVendors = async (force = false) => {
    return ensureBootstrapData(force);
  };

  const ensureVendorEvaluations = async (force = false) => {
    return ensureBootstrapData(force);
  };

  // Keep effect/callback identities stable while always dispatching through
  // the latest provider render's loaders. Adding these render-created
  // functions directly to effect dependencies causes hydration to restart on
  // each state update.
  const dataLoadersRef = useRef({
    ensureActiveBuyerAccount,
    ensureRFQs,
    ensureAIFeed,
    ensureVendors,
    ensureVendorEvaluations,
    ensureCategoryTaxonomy,
    refreshVendorCredits,
    refreshFromDB,
    refreshActiveBuyerAccount,
    refreshCategoryTaxonomy,
    refreshRFQs,
    refreshAIFeed,
  });
  dataLoadersRef.current = {
    ensureActiveBuyerAccount,
    ensureRFQs,
    ensureAIFeed,
    ensureVendors,
    ensureVendorEvaluations,
    ensureCategoryTaxonomy,
    refreshVendorCredits,
    refreshFromDB,
    refreshActiveBuyerAccount,
    refreshCategoryTaxonomy,
    refreshRFQs,
    refreshAIFeed,
  };

  /**
   * Route-based lazy data fetcher.
   * On page load or route transition, only fetches endpoints required by the active view.
   * Previously visited pages are served instantly from memory cache.
   */
  const ensureRouteData = useCallback(async (pathname?: string, currentRoleOverride?: UserRole) => {
    if (!authClient.getToken()) return;
    const loaders = dataLoadersRef.current;

    const r = currentRoleOverride || currentRole || 'buyer';
    const path = pathname || (typeof window !== 'undefined' ? window.location.pathname : '');

    const tasks: Promise<unknown>[] = [];

    if (r === 'buyer') {
      tasks.push(loaders.ensureActiveBuyerAccount());

      if (path === '/buyer' || path === '/buyer/dashboard' || path.startsWith('/buyer/command-center')) {
        tasks.push(loaders.ensureRFQs());
        tasks.push(loaders.ensureAIFeed());
      } else if (path.startsWith('/buyer/rfq-summary') || path.startsWith('/buyer/rfqs') || path.startsWith('/buyer/rfq-details')) {
        tasks.push(loaders.ensureRFQs());
      } else if (path.startsWith('/buyer/quote-matrix')) {
        tasks.push(loaders.ensureRFQs());
        tasks.push(loaders.ensureVendors());
      } else if (path.startsWith('/buyer/vendor-summary')) {
        tasks.push(loaders.ensureVendors());
        tasks.push(loaders.ensureVendorEvaluations());
      } else if (path.startsWith('/buyer/vendor-evaluation-summary')) {
        tasks.push(loaders.ensureVendorEvaluations());
        tasks.push(loaders.ensureVendors());
      } else if (path.startsWith('/buyer/profile')) {
        tasks.push(loaders.ensureCategoryTaxonomy());
      } else if (path.startsWith('/buyer/ingestion-wizard')) {
        tasks.push(loaders.ensureRFQs());
        tasks.push(loaders.ensureCategoryTaxonomy());
        tasks.push(loaders.ensureVendors());
      } else if (path.startsWith('/buyer/buyer-directory')) {
        tasks.push(loaders.ensureVendors());
      } else if (path.startsWith('/buyer/subscription-center') || path.startsWith('/buyer/billing-history')) {
        // Essential activeBuyerAccount already queued
      } else {
        tasks.push(loaders.ensureRFQs());
      }
    } else if (r === 'vendor') {
      tasks.push(loaders.refreshVendorCredits());
      tasks.push(loaders.ensureRFQs());
      tasks.push(loaders.ensureVendors());
      tasks.push(loaders.ensureCategoryTaxonomy());
    } else if (r === 'category_manager' || r === 'admin') {
      tasks.push(loaders.ensureRFQs());
      tasks.push(loaders.ensureVendors());
      tasks.push(loaders.ensureVendorEvaluations());
      tasks.push(loaders.ensureCategoryTaxonomy());
      tasks.push(loaders.refreshFromDB());
    } else {
      tasks.push(loaders.ensureRFQs());
      tasks.push(loaders.refreshFromDB());
    }

    await Promise.allSettled(tasks);
  }, [currentRole]);

  useEffect(() => {
    // In unit test environment without browser routing shell, hydrate test fixtures:
    if (process.env.NODE_ENV === 'test') {
      void dataLoadersRef.current.refreshFromDB();
      void dataLoadersRef.current.refreshActiveBuyerAccount();
      void dataLoadersRef.current.refreshCategoryTaxonomy();
    }
  }, []);

  const lastUserSessionIdRef = useRef<string | null>(null);

  // Sync state when session identity changes.
  useEffect(() => {
    const loaders = dataLoadersRef.current;
    if (!isLoggedIn) {
      activeBuyerAccountRequestGenerationRef.current += 1;
      setRfqs([]);
      setVendorOpportunities([]);
      setActiveBuyerAccount(null);
      setAiFeed([]);
      setBuyerVendors([]);
      setVendorEvaluations([]);
      clearCategoryTaxonomy();
      setCategoryTaxonomyState([]);
      clearSessionCache();
      loadedEntitiesRef.current = {};
      lastUserSessionIdRef.current = null;
      return;
    }

    // Reset entity cache when user logs in or switches
    if (!lastUserSessionIdRef.current || lastUserSessionIdRef.current !== currentUserSession?.id) {
      activeBuyerAccountRequestGenerationRef.current += 1;
      clearActiveBuyerAccount();
      clearSessionCache();
      loadedEntitiesRef.current = {};
      void loaders.refreshFromDB();
    }
    lastUserSessionIdRef.current = currentUserSession?.id || null;

    void loaders.ensureActiveBuyerAccount(true);

    if (currentRole === 'vendor') {
      void loaders.refreshVendorCredits();
    }
    if (currentRole === 'category_manager' || currentRole === 'admin') {
      void loaders.ensureRFQs();
      void loaders.ensureVendors();
    }

    if (process.env.NODE_ENV === 'test') {
      void loaders.refreshRFQs();
      void loaders.refreshVendorCredits();
      void loaders.refreshAIFeed();
    }
  }, [isLoggedIn, currentUserSession?.id, currentRole]);

  useEffect(() => {
    if (rfqs.length > 0) {
      setSessionCache('rfqs', rfqs);
    }
  }, [rfqs]);

  // activeSubscription/remainingFreeRFQs used to be pure local state, defaulted
  // to free_trial/5 and never read back from anywhere real — a page refresh or
  // a real Zoho-purchased upgrade was invisible here. GET /api/buyer-accounts/active
  // now actually carries both fields (buyerAccountResolver merges them in from
  // the real buyer_accounts record), so this mirrors the same sync
  // refreshFromDB already does for vendorSubscription/vendorRfqDownloadsUsed.
  useEffect(() => {
    if (!activeBuyerAccount) return;
    if (activeBuyerAccount.subscriptionPlan) {
      setActiveSubscription(activeBuyerAccount.subscriptionPlan);
    }
    if (activeBuyerAccount.remainingFreeRFQs !== undefined) {
      setRemainingFreeRFQs(activeBuyerAccount.remainingFreeRFQs);
    }
  }, [activeBuyerAccount]);

  // Integrated Buyer Accounts Management & Public Database Sync
  // The record shown is the one the server stores. Its id, totals and timestamps are not made up here.
  const addBuyerAccount = async (
    account: Omit<BuyerAccount, 'id' | 'syncTimestamp' | 'createdDate'>
  ): Promise<BuyerAccount | null> => {
    let res: Response;
    try {
      res = await fetch('/api/buyer-accounts', {
        method: 'POST',
        headers: authFetchHeaders(),
        body: JSON.stringify(account),
      });
    } catch (e) {
      logger.log('ERROR', 'Failed to save buyer account to backend', { error: e }, 'BUYER_ACCOUNT');
      showToast(STORE_MESSAGES.buyerAccountCreateFailedTitle, STORE_MESSAGES.buyerAccountUnreachable, 'warning');
      return null;
    }

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success || !json.data) {
      logApiResponseFailure('Buyer account creation request failed', res, 'BUYER_ACCOUNT', {
        responseError: json?.error,
      });
      showToast(
        STORE_MESSAGES.buyerAccountCreateFailedTitle,
        json?.error || STORE_MESSAGES.buyerAccountCreateFailed,
        'warning'
      );
      return null;
    }

    const created: BuyerAccount = json.data;
    setBuyerAccounts((prev) => [created, ...prev]);
    setActiveBuyerAccount(created);
    loadedEntitiesRef.current.activeBuyerAccount = true;

    void addAuditLog(`Created buyer account for ${created.organizationName}`);
    showToast('Buyer Account Created', `${created.organizationName} registered and added to buyer master database.`, 'success');
    return created;
  };

  const updateBuyerAccount = (id: string, updates: Partial<BuyerAccount>) => {
    // Was POSTing the merged record to /api/buyer-accounts — the CREATE
    // endpoint, not an update route — and applying the local state change
    // unconditionally regardless of what (if anything) the server did with
    // it. createBuyerAccount has no subscriptionPlan restriction at all
    // (that gate only exists on PUT /api/buyer-accounts/:id's
    // sanitizeBuyerAccountUpdates), so any edit through this path — e.g. the
    // Buyer Directory's edit form — could set subscriptionPlan to a paid
    // tier directly, no Zoho payment involved, and it would actually
    // persist. Fixed to call the real, gated update route, and to only
    // reflect the change locally once the server has actually accepted it.
    fetch(`/api/buyer-accounts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: authFetchHeaders(),
      body: JSON.stringify(updates),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          logApiResponseFailure('Buyer account update request failed', res, 'BUYER_ACCOUNT', {
            accountId: id,
            responseError: json?.error,
          });
          showToast(
            'Update Failed',
            json?.error || 'Could not save buyer account changes. Please try again.',
            'warning'
          );
          return;
        }
        const updatedAcc: BuyerAccount = json.data;
        setBuyerAccounts((prev) => prev.map((acc) => (acc.id === id ? updatedAcc : acc)));
        if (activeBuyerAccount?.id === id) {
          setActiveBuyerAccount(updatedAcc);
        }
        addAuditLog(`Updated account specifications for buyer ID ${id}`);
        showToast('Account Updated', 'Buyer account details successfully saved.', 'info');
      })
      .catch((error) => {
        logger.log('ERROR', 'Buyer account update request could not reach the backend', {
          error,
          accountId: id,
        }, 'BUYER_ACCOUNT');
        showToast('Update Failed', 'Could not reach the server. Please try again.', 'warning');
      });
  };

  const deleteBuyerAccount = async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/buyer-accounts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authFetchHeaders(),
      });
      const json = await response.json().catch((error: unknown) => {
        logger.log('ERROR', 'Buyer account deletion response could not be parsed', {
          error,
          accountId: id,
          status: response.status,
        }, 'BUYER_ACCOUNT');
        return null;
      });
      if (!response.ok || !json?.success) {
        logApiResponseFailure('Buyer account deletion request failed', response, 'BUYER_ACCOUNT', {
          accountId: id,
          responseError: json?.error,
        });
        showToast(
          'Delete Failed',
          json?.error || 'The account was not confirmed as deleted. Refresh the buyer list and retry.',
          'warning'
        );
        return false;
      }

      const activeAccount = json.data?.activeAccount && typeof json.data.activeAccount === 'object'
        ? json.data.activeAccount as BuyerAccount
        : null;
      setBuyerAccounts((previous) => {
        const remainingAccounts = previous.filter((account) => account.id !== id);
        if (activeBuyerAccount?.id !== id || !activeAccount) return remainingAccounts;
        const replacementIndex = remainingAccounts.findIndex((account) => account.id === activeAccount.id);
        if (replacementIndex === -1) return [activeAccount, ...remainingAccounts];
        return remainingAccounts.map((account) => account.id === activeAccount.id ? activeAccount : account);
      });
      if (activeBuyerAccount?.id === id) {
        setActiveBuyerAccount(activeAccount);
        setSessionCache('activeBuyerAccount', activeAccount);
        loadedEntitiesRef.current.activeBuyerAccount = true;
      }

      addAuditLog(`Deleted buyer account record ID ${id}`);
      showToast('Account Removed', 'Buyer account deleted from the database.', 'info');
      return true;
    } catch (error) {
      logger.log('ERROR', 'Buyer account deletion request could not reach the backend', {
        error,
        accountId: id,
      }, 'BUYER_ACCOUNT');
      showToast(
        'Delete Failed',
        'Could not confirm the deletion with the server. Refresh the buyer list before retrying.',
        'warning'
      );
      return false;
    }
  };

  // Switching accounts is persisted by the server (POST /api/buyer-accounts/:id/activate). The local
  // active account is reloaded from the server afterwards, and the success notice only follows that.
  const alignActiveBuyerAccount = async (accountId: string): Promise<boolean> => {
    const acc = buyerAccounts.find((a) => a.id === accountId);
    let res: Response;
    try {
      res = await fetch(`/api/buyer-accounts/${encodeURIComponent(accountId)}/activate`, {
        method: 'POST',
        headers: authFetchHeaders(),
      });
    } catch (e) {
      logger.log('ERROR', 'Buyer account switch could not reach the backend', { error: e, accountId }, 'BUYER_ACCOUNT');
      showToast(STORE_MESSAGES.alignFailedTitle, STORE_MESSAGES.alignUnreachable, 'warning');
      return false;
    }
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      logApiResponseFailure('Buyer account switch request failed', res, 'BUYER_ACCOUNT', {
        accountId,
        responseError: json?.error,
      });
      showToast(STORE_MESSAGES.alignFailedTitle, json?.error || STORE_MESSAGES.alignFailed, 'warning');
      return false;
    }
    await refreshActiveBuyerAccount();
    if (acc) setCurrentMode(acc.sourcingMode);
    void addAuditLog(`Switched active buyer session context to ${acc?.organizationName || accountId}`);
    showToast('Session Aligned', formatString(STORE_MESSAGES.alignedMessage, { name: acc?.organizationName || accountId }), 'success');
    return true;
  };

  const [vendorCatalogue, setVendorCatalogue] = useState<any[]>([]);

  const openRFQDeepDive = (rfq: RFQItem) => {
    setSelectedRFQForDeepDive(rfq);
    setDeepDiveModalOpen(true);
  };

  const openVendorEvaluationSummary = (evalRecord: VendorEvaluationRecord) => {
    setSelectedVendorEvaluation(evalRecord);
    setEvaluationModalOpen(true);
  };

  // Was fire-and-forget (optimistic local update, response never checked) —
  // now awaits the real response and only updates local state on confirmed
  // success, so a caller can gate its own success UI on the actual outcome.
  const addVendorEvaluation = async (record: VendorEvaluationRecord): Promise<boolean> => {
    try {
      const res = await fetch('/api/evaluations', {
        method: 'POST',
        headers: authFetchHeaders(),
        body: JSON.stringify(record),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        logger.log('ERROR', 'Failed to save evaluation to backend', {
          responseError: data?.error || res.statusText,
          status: res.status,
        }, 'EVALUATION');
        return false;
      }
      setVendorEvaluations((prev) => [record, ...prev.filter((r) => r.id !== record.id)]);
      return true;
    } catch (e) {
      logger.log('ERROR', 'Failed to save evaluation to backend', { error: e }, 'EVALUATION');
      return false;
    }
  };

  const fetchVendorEvaluation = async (vendorIdOrName: string): Promise<VendorEvaluationRecord | null> => {
    if (!vendorIdOrName) return null;
    const norm = String(vendorIdOrName).trim().toLowerCase();
    const existing = vendorEvaluations.find(
      (e) => (e.vendorId && e.vendorId.toLowerCase() === norm) || (e.vendorName && e.vendorName.toLowerCase() === norm)
    );
    if (existing && typeof existing.overallScore === 'number') {
      return existing;
    }
    try {
      const res = await fetch(`/api/evaluations?vendorId=${encodeURIComponent(vendorIdOrName)}`, {
        headers: authFetchHeaders(),
      });
      if (res.ok) {
        const body = await res.json();
        if (body.success && Array.isArray(body.data) && body.data.length > 0) {
          const rec = body.data[0];
          if (rec && typeof rec.overallScore === 'number') {
            setVendorEvaluations((prev) => {
              const filtered = prev.filter((e) => e.id !== rec.id && e.vendorId !== rec.vendorId);
              return [rec, ...filtered];
            });
            return rec;
          }
        }
      }
    } catch (err) {
      logger.log('WARN', 'Failed to fetch vendor evaluation from database', { error: err, vendorIdOrName }, 'EVALUATION');
    }
    return null;
  };

  // Helper to check if vendor exists in platform central database
  const checkVendorInPlatformDatabase = (v: { email?: string; phone?: string; name?: string }): boolean => {
    const emailKey = (v.email || '').trim().toLowerCase();
    const phoneKey = (v.phone || '').trim();
    const nameKey = (v.name || '').trim().toLowerCase();

    return buyerVendors.some(
      (m) =>
        (m.email && m.email.toLowerCase() === emailKey) ||
        (phoneKey && m.phone && m.phone.replace(/\D/g, '').includes(phoneKey.replace(/\D/g, ''))) ||
        (m.name && m.name.toLowerCase() === nameKey)
    );
  };

  // Vendor Onboarding Email Generator Engine
  // Vendor Onboarding Email Generator Engine with Highlighted Assigned Categories & Unmapped Fallback
  const generateVendorOnboardingEmail = (
    vendor: VendorEntry,
    isExisting: boolean
  ): VendorOnboardingEmailPayload => {
    // Buyer identity comes only from the active account. A missing field stays empty; nothing is substituted.
    const buyerCompany = activeBuyerAccount?.organizationName ?? '';
    const buyerContact = activeBuyerAccount?.contactPerson ?? '';
    const buyerEmail = activeBuyerAccount?.corporateEmail ?? '';
    const nextDate = vendor.nextReminderDate ?? '';

    const hasMappedCategories = Boolean(
      vendor.majorCategory &&
      vendor.majorCategory !== 'Uncategorized (No Past POs)' &&
      vendor.majorCategory !== '(None Assigned by Buyer)' &&
      vendor.minorCategories &&
      vendor.minorCategories.length > 0
    );

    const assignedMajor = hasMappedCategories ? (vendor.majorCategory ?? '') : '(None Assigned by Buyer)';
    const assignedMinors = hasMappedCategories ? (vendor.minorCategories ?? []) : [];

    let subject = '';
    let authInstructions = '';
    let profileUpdateInstructions = '';
    let categoryUpdateInstructions = '';
    let unmappedSelfServiceMessage = '';

    if (!hasMappedCategories) {
      subject = `[Action Required] Set Up Categories: ${buyerCompany} added you to their Preferred Vendor Network`;
      authInstructions = `You have been added by ${buyerContact} from ${buyerCompany} into their private preferred vendor network from their vendor master records. Because no past pre-purchase orders were found in their historical dump, the buyer did not map any product categories for your company. Sign in with your registered email and follow the verification steps shown on the portal.`;
      profileUpdateInstructions = `Please log in to complete your enterprise compliance profile (factory specs, GSTIN/PAN, plant location, capacity).`;
      categoryUpdateInstructions = `ATTENTION: The buyer didn't map any categories for you because no historical PO items were found in their purchase dump. Please log in and map your categories yourself across the Major and Minor Category taxonomy in order to receive enquiries and RFQ opportunities.`;
      unmappedSelfServiceMessage = `The buyer didn't map any categories for you, so please map yourself in order to receive enquiries.`;
    } else if (isExisting) {
      subject = `[Network Association] ${buyerCompany} has added you to their Preferred Vendor Network on Procucev`;
      authInstructions = `A buyer from ${buyerCompany} has associated your verified enterprise profile into their private preferred supplier network. Sign in using your existing credentials or follow the account verification and password recovery steps on the portal.`;
      profileUpdateInstructions = `Please log in to review the buyer association and verify that your plant locations, operational capabilities, and statutory certifications are up to date.`;
      categoryUpdateInstructions = `The buyer (${buyerCompany}) analyzed their past purchase records and mapped your company to the following taxonomy:\n• 1st Set (Primary Major Category): ${assignedMajor}\n• 2nd Set (Minor Categories & Product Lines): ${assignedMinors.join(', ')}\nPlease log in to review, confirm, or expand your category specializations across the standard minor categories.`;
    } else {
      subject = `[Action Required] Welcome to Procucev: ${buyerCompany} has added you to their Preferred Vendor Network`;
      authInstructions = `You have been added by ${buyerContact} from ${buyerCompany} into their private preferred vendor network based on their past pre-purchase orders. Sign in with your registered email and follow the verification steps shown on the portal.`;
      profileUpdateInstructions = `Please log in and complete your enterprise profile, including plant location, turnover, machinery, and statutory tax credentials (GSTIN / PAN).`;
      categoryUpdateInstructions = `The buyer (${buyerCompany}) analyzed their purchase history and assigned your company to:\n• 1st Set (Primary Major Category): ${assignedMajor}\n• 2nd Set (Minor Categories & Product Lines): ${assignedMinors.join(', ')}\nPlease confirm these categories upon login so you receive incoming RFQ invitations matching your product lines.`;
    }

    return {
      // The preview has no server id or seal yet, so these stay empty rather than being generated here.
      emailId: '',
      vendorId: vendor.id,
      vendorName: vendor.name,
      recipientEmail: vendor.email,
      contactPerson: vendor.contactPerson,
      buyerCompanyName: buyerCompany,
      buyerContactName: buyerContact,
      buyerContactEmail: buyerEmail,
      isExistingInDatabase: isExisting,
      hasPoHistory: hasMappedCategories,
      categoriesMappedByBuyer: hasMappedCategories,
      unmappedSelfServiceMessage,
      subject,
      username: vendor.email,
      authInstructions,
      profileUpdateInstructions,
      categoryUpdateInstructions,
      assignedMajorCategory: assignedMajor,
      assignedMinorCategories: assignedMinors,
      assignedSecondaryMajors: [],
      reminderScheduleNote: `Automated recurring reminders are scheduled on every 3rd day until your profile completion and category taxonomy updates are confirmed.`,
      // This preview has not been sent, so no dispatch time and no server seal (sha) are shown.
      dispatchedAt: '',
      nextReminderDate: nextDate,
      // The portal is the app that produced this preview, so its own origin is the login link.
      portalLoginUrl: typeof window !== 'undefined' ? window.location.origin : '',
      shaSignature: '',
      reminderCount: vendor.remindersSentCount ?? 0,
    };
  };

  const [selectedOnboardingEmail, setSelectedOnboardingEmail] = useState<VendorOnboardingEmailPayload | null>(null);
  const [onboardingEmailModalOpen, setOnboardingEmailModalOpen] = useState<boolean>(false);

  // Initial Setup State & Purchase Data Ingestion
  const [initialSetupModalOpen, setInitialSetupModalOpen] = useState<boolean>(false);
  const [initialSetupCompleted, setInitialSetupCompleted] = useState<boolean>(false);
  const [historicalPurchaseDataPeriod, setHistoricalPurchaseDataPeriod] = useState<'1_year' | '2_years' | '3_years'>('1_year');
  const [lastIngestionSummary, setLastIngestionSummary] = useState<IngestionSummary | null>(null);
  const [lastIngestionError, setLastIngestionError] = useState<string | null>(null);

  const processHistoricalPurchaseData = async (
    period: '1_year' | '2_years' | '3_years',
    vendors: HistoricalPurchaseVendorRecord[]
  ): Promise<number> => {
    _lastHistoricalDataError = null;
    setLastIngestionError(null);
    // Used to build the full VendorEntry list purely client-side and never
    // call the backend at all — every "imported" vendor vanished on refresh
    // and the "onboarding credentials dispatched" claim was never true. A
    // real endpoint for exactly this already exists (POST
    // /api/buyer-accounts/historical-data -> storeService's own
    // processHistoricalPurchaseData, which dedupes by email/name and
    // persists real vendor records) — use it and refresh from the DB
    // afterwards instead of reconstructing vendor records by hand.
    const mappedCount = vendors.filter((v) => v.categoriesMappedByBuyer).length;
    const unmappedCount = vendors.length - mappedCount;
    const periodLabel =
      period === '1_year' ? 'Last 1 Year (12 Months)' : period === '2_years' ? 'Last 2 Years (24 Months)' : 'Last 3 Years (36 Months)';

    let res: Response;
    try {
      res = await fetch('/api/buyer-accounts/historical-data', {
        method: 'POST',
        headers: authFetchHeaders(),
        body: JSON.stringify({
          period,
          vendorRecords: vendors.map((v) => ({
            companyName: v.companyName,
            contactPerson: v.contactPerson,
            email: v.email,
            phone: v.phone,
            location: v.address,
            // Sent explicitly rather than left for the backend to infer from
            // majorCategory's sentinel string below — storeService branches
            // the onboarding email (Template A vs B) on this flag directly.
            categoriesMappedByBuyer: Boolean(v.categoriesMappedByBuyer),
            majorCategory: v.categoriesMappedByBuyer
              ? v.firstSetMajorCategory || ''
              : 'Uncategorized (No Past POs)',
            minorCategories: v.categoriesMappedByBuyer && v.secondSetMinorCategories?.length ? v.secondSetMinorCategories : [],
            rating: v.vendorRatingScore ? Number((v.vendorRatingScore / 20).toFixed(1)) : undefined,
            score: v.vendorRatingScore,
          })),
        }),
      });
    } catch (e: unknown) {
      logger.log('ERROR', 'Failed to ingest historical purchase data', { error: e }, 'HISTORICAL_INGESTION');
      const errText = e instanceof Error && e.message ? e.message : STORE_MESSAGES.historicalUnreachable;
      _lastHistoricalDataError = errText;
      setLastIngestionError(errText);
      showToast('Import Failed', errText, 'warning');
      return 0;
    }

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const errText = data?.error || data?.message || (res.status ? `Server error ${res.status}: ${res.statusText || 'Failed to process historical data'}` : 'Could not process the historical purchase data. Please try again.');
      _lastHistoricalDataError = errText;
      setLastIngestionError(errText);
      showToast(
        'Import Failed',
        errText,
        'warning'
      );
      return 0;
    }
    _lastHistoricalDataError = null;
    setLastIngestionError(null);

    // The server returns every count below on success (storeService.processHistoricalPurchaseData). Email
    // counts are read straight from it. A missing count is shown as 0 and never filled with the number of
    // rows submitted, because that would read as "sent" when no provider reported it.
    const summary: IngestionSummary = {
      importedCount: data.importedCount ?? 0,
      totalProcessed: data.totalProcessed ?? vendors.length,
      mappedCount: data.mappedCount ?? mappedCount,
      mappedEmailsSent: data.mappedEmailsSent ?? 0,
      mappedEmailsQueued: data.mappedEmailsQueued ?? 0,
      unmappedCount: data.unmappedCount ?? unmappedCount,
      unmappedEmailsSent: data.unmappedEmailsSent ?? 0,
      unmappedEmailsQueued: data.unmappedEmailsQueued ?? 0,
      failedEmailCount: data.failedEmailCount ?? (Array.isArray(data.failedEmails) ? data.failedEmails.length : 0),
      failedEmails: Array.isArray(data.failedEmails) ? data.failedEmails : [],
      skippedCount: data.skippedCount ?? 0,
      skipped: Array.isArray(data.skipped) ? data.skipped : [],
      period: data.period ?? period,
      totalVendors: data.totalVendors ?? vendors.length,
      overallStatus: data.overallStatus ?? 'FAILED',
    };
    setLastIngestionSummary(summary);

    await refreshFromDB();
    setInitialSetupCompleted(true);
    // Note: Modal remains open so InitialSetupModal can display the Completion Summary to the user

    const deliverySummary = formatString(UI_STRINGS.historicalIngestion.deliverySummary, {
      mappedSent: summary.mappedEmailsSent,
      mappedQueued: summary.mappedEmailsQueued,
      unmappedSent: summary.unmappedEmailsSent,
      unmappedQueued: summary.unmappedEmailsQueued,
      failed: summary.failedEmailCount,
    });

    void addFeedItem(
      `Historical Purchase & Vendor Master Ingestion Complete: ${summary.importedCount} Vendors`,
      formatString(UI_STRINGS.historicalIngestion.feedSummary, { periodLabel, deliverySummary }),
      'invitation',
      undefined,
      `${summary.importedCount} Ingested Vendors`,
      'email'
    );

    void addAuditLog(
      formatString(UI_STRINGS.historicalIngestion.auditSummary, {
        periodLabel,
        submitted: vendors.length,
        imported: summary.importedCount,
        deliverySummary,
      })
    );

    showToast(
      summary.failedEmailCount > 0 ? 'Setup Completed with Warnings' : 'Initial Setup Completed',
      formatString(UI_STRINGS.historicalIngestion.toastSummary, { periodLabel, deliverySummary }),
      summary.failedEmailCount > 0 ? 'warning' : 'success'
    );

    return data.importedCount;
  };

  const openOnboardingEmailModal = (vendor: VendorEntry) => {
    const isExisting = vendor.isExistingInDatabase ?? checkVendorInPlatformDatabase(vendor);
    const payload = generateVendorOnboardingEmail(vendor, isExisting);
    setSelectedOnboardingEmail(payload);
    setOnboardingEmailModalOpen(true);
  };

  const [clientMappedCategories, setClientMappedCategories] = useState<string[]>([]);
  const [vendorSelectedCategories, setVendorSelectedCategories] = useState<string[]>([]);

  const saveVendorProfileCategories = (email: string, clientCats: string[], vendorCats: string[]) => {
    // Limit to max 10 categories
    const limitedVendorCats = vendorCats.slice(0, 10);
    setClientMappedCategories(clientCats);
    setVendorSelectedCategories(limitedVendorCats);

    const clientLower = clientCats.map((c) => c.toLowerCase().trim());
    const vendorLower = limitedVendorCats.map((c) => c.toLowerCase().trim());

    const isAligned =
      clientLower.length > 0 &&
      vendorLower.length > 0 &&
      clientLower.every((c) => vendorLower.includes(c)) &&
      vendorLower.every((v) => clientLower.includes(v));

    const common = limitedVendorCats.filter((v) => clientLower.includes(v.toLowerCase().trim()));
    const clientOnly = clientCats.filter((c) => !vendorLower.includes(c.toLowerCase().trim()));
    const vendorOnly = limitedVendorCats.filter((v) => !clientLower.includes(v.toLowerCase().trim()));

    // Update in buyerVendors list
    setBuyerVendors((prev) =>
      prev.map((v) => {
        const vEmail = (v.email || '').toLowerCase();
        const targetEmail = (email || '').toLowerCase();
        if (vEmail && targetEmail && vEmail === targetEmail) {
          return {
            ...v,
            clientMappedCategories: clientCats,
            vendorSelectedCategories: limitedVendorCats,
            minorCategories: Array.from(new Set([...clientCats, ...limitedVendorCats])),
            isCategoryAligned: isAligned,
            categoryMismatchDetails: {
              common,
              clientOnly,
              vendorOnly,
            },
            profileCompletionStatus: 'completed',
            firstLoginCompleted: true,
          };
        }
        return v;
      })
    );

    // Called by the vendor profile page after its real categories save has succeeded, so this feed line
    // records a saved change. The page writes the audit line and the toast itself.
    void addFeedItem(
      `Vendor Category Reconciliation Saved: ${email}`,
      `Client Mapped: [${clientCats.join(', ')}] | Vendor Selected (Max 10): [${limitedVendorCats.join(', ')}]. ${isAligned ? 'Status: 100% Aligned.' : `Status: Dual-Stream Stored (${common.length} matching, ${vendorOnly.length} vendor-extended). RFQs will be dispatched across both sets.`}`,
      'system',
      undefined,
      email,
      'system'
    );

  };

  const [selectedRatingRevisionEmail, setSelectedRatingRevisionEmail] = useState<VendorRatingRevisionEmailPayload | null>(null);
  const [ratingRevisionEmailModalOpen, setRatingRevisionEmailModalOpen] = useState<boolean>(false);

  const openRatingRevisionEmailModal = (revision: VendorRatingRevisionRecord) => {
    // The revision record does not carry the vendor's contact details, so they come from the vendor record. A missing one stays empty.
    const vendorRecord = buyerVendors.find((v) => v.id === revision.vendorId);
    setSelectedRatingRevisionEmail({
      vendorName: revision.vendorName,
      vendorEmail: vendorRecord?.email ?? '',
      vendorContactPerson: vendorRecord?.contactPerson ?? '',
      buyerCompany: revision.buyerCompany,
      buyerContactName: revision.buyerName,
      buyerContactEmail: revision.buyerEmail,
      dispatchedAt: revision.timestamp,
      qualityScore: revision.qualityScore,
      costScore: revision.costScore,
      deliveryScore: revision.deliveryScore,
      buyerAverage: revision.buyerAverage,
      previousScore: revision.previousScore,
      newCompositeScore: revision.newCompositeScore,
      newRating: revision.newRating,
      remarks: revision.remarks,
      shaSignature: revision.shaSignature,
    });
    setRatingRevisionEmailModalOpen(true);
  };

  const reviseVendorRating = async (
    vendorId: string,
    qualityScore: number,
    costScore: number,
    deliveryScore: number,
    remarks: string
  ): Promise<VendorRatingRevisionRecord | null> => {
    const buyerCompany = activeBuyerAccount?.organizationName ?? '';
    const buyerName = activeBuyerAccount?.contactPerson ?? '';
    const buyerEmail = activeBuyerAccount?.corporateEmail ?? '';
    // Only the vendor that was asked for. There is no fallback to another vendor in the list.
    const targetVendor = buyerVendors.find((v) => v.id === vendorId);
    const trimmedRemarks = remarks.trim();

    // Persist rating revision to the backend and use ITS canonical result —
    // this used to PATCH '/api/vendors' with a client-computed payload; that
    // route/method doesn't exist (routes/vendors.js has no PATCH handler at
    // all), so it silently 404'd on every revision and nothing ever reached
    // the backend, while the UI unconditionally showed a client-recomputed
    // score as if it had saved. Worse, that client formula
    // (Math.round((previousScore + buyerAverage) / 2)) never matched the
    // server's real weighting (storeService.reviseVendorRating /
    // calculateRevisedRating: previousScore*0.6 + buyerAverage*0.4), so even
    // a successful save would have shown the wrong number. The real endpoint
    // is POST '/api/vendors/:id/rating-revision' — await it and use its
    // response as the source of truth for what actually got saved.
    let res: Response;
    try {
      res = await fetch(`/api/vendors/${encodeURIComponent(targetVendor?.id || vendorId)}/rating-revision`, {
        method: 'POST',
        headers: authFetchHeaders(),
        body: JSON.stringify({
          qualityScore,
          costScore,
          deliveryScore,
          remarks: trimmedRemarks,
          buyerCompany,
          buyerName,
          buyerEmail,
        }),
      });
    } catch (e) {
      logger.log('ERROR', 'Failed to save rating revision to backend', { error: e }, 'VENDOR_RATING');
      showToast('Rating Revision Failed', 'Could not reach the server. Please try again.', 'warning');
      return null;
    }

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      showToast(
        'Rating Revision Failed',
        data?.error || 'Could not save your rating revision. Please try again.',
        'warning'
      );
      return null;
    }

    const revisionRecord: VendorRatingRevisionRecord = data.data.revisionRecord;
    const updatedVendorFromServer = data.data.updatedVendor;

    // Update in buyerVendors list (accessible across all buyer accounts & directories)
    setBuyerVendors((prev) =>
      prev.map((v) => {
        if (v.id === vendorId || v.name === targetVendor?.name) {
          return { ...v, ...updatedVendorFromServer };
        }
        return v;
      })
    );

    // The feed and audit lines describe the saved revision only. The server queues the vendor notification
    // separately, and `emailDispatched` there is not a provider result, so no delivery is claimed here.
    void addFeedItem(
      `Vendor Rating Revised: ${revisionRecord.vendorName}`,
      `Buyer ${buyerName} (${buyerCompany}) revised the performance rating. Quality: ${qualityScore}/100, Cost: ${costScore}/100, Delivery: ${deliveryScore}/100 (Buyer Avg: ${revisionRecord.buyerAverage}%). Platform rating: ${revisionRecord.newRating} / 5.0 (${revisionRecord.newCompositeScore}%). Remarks: "${revisionRecord.remarks}".`,
      'system',
      undefined,
      revisionRecord.vendorName,
      'system'
    );

    void addAuditLog(
      `Buyer Rating Revision for ${revisionRecord.vendorName}: Q=${qualityScore}, C=${costScore}, D=${deliveryScore} (Buyer Avg: ${revisionRecord.buyerAverage}%). Previous: ${revisionRecord.previousScore}% (${revisionRecord.previousRating}★) -> New Composite: ${revisionRecord.newCompositeScore}% (${revisionRecord.newRating}★). Remarks: "${revisionRecord.remarks}".`
    );

    // Set email payload for review via "View Dispatched Email Notice" in the vendor table
    setSelectedRatingRevisionEmail({
      vendorName: revisionRecord.vendorName,
      vendorEmail: targetVendor?.email ?? '',
      vendorContactPerson: targetVendor?.contactPerson ?? '',
      buyerCompany,
      buyerContactName: buyerName,
      buyerContactEmail: buyerEmail,
      dispatchedAt: revisionRecord.timestamp || '',
      qualityScore,
      costScore,
      deliveryScore,
      buyerAverage: revisionRecord.buyerAverage,
      previousScore: revisionRecord.previousScore,
      newCompositeScore: revisionRecord.newCompositeScore,
      newRating: revisionRecord.newRating,
      remarks: revisionRecord.remarks,
      shaSignature: revisionRecord.shaSignature,
    });

    showToast(
      STORE_MESSAGES.ratingRevisionSavedTitle,
      formatString(STORE_MESSAGES.ratingRevisionSavedMessage, {
        vendorName: revisionRecord.vendorName,
        newRating: revisionRecord.newRating,
        newCompositeScore: revisionRecord.newCompositeScore,
      }),
      'success'
    );

    return revisionRecord;
  };

  const requestVendorEvaluation = async (
    vendorId: string,
    notes?: string
  ): Promise<VendorEvaluationRequestResult> => {
    const targetVendor = buyerVendors.find((v) => v.id === vendorId);
    if (!targetVendor) {
      showToast(UI_STRINGS.vendorEvaluationRequest.vendorNotFoundTitle, UI_STRINGS.vendorEvaluationRequest.vendorNotFoundBody, 'warning');
      return { success: false, message: 'Vendor not found' };
    }

    try {
      // The server looks for a saved evaluation before it sends any request. The
      // vendor's email is checked there too, after that lookup.
      const res = await fetch(`/api/vendors/${encodeURIComponent(targetVendor.id)}/request-evaluation`, {
        method: 'POST',
        headers: authFetchHeaders(),
        body: JSON.stringify({ notes: notes || '' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        // The server does not hold this supplier for the signed-in buyer. That needs a different message from a send that failed.
        if (res.status === 404) {
          showToast(UI_STRINGS.vendorEvaluationRequest.vendorNotFoundTitle, UI_STRINGS.vendorEvaluationRequest.vendorNotFoundBody, 'warning');
          return { success: false, message: UI_STRINGS.vendorEvaluationRequest.vendorNotFoundBody };
        }
        const errMessage = data?.error || UI_STRINGS.vendorEvaluationRequest.requestFailedFallback;
        showToast(UI_STRINGS.vendorEvaluationRequest.requestFailedTitle, errMessage, 'warning');
        return { success: false, message: errMessage };
      }

      if (data.evaluationExists && data.data?.evaluation) {
        // A saved evaluation exists, so no request went to the vendor. Keep the record
        // in the local list so the score and details can be shown without another fetch.
        const savedEvaluation: VendorEvaluationRecord = data.data.evaluation;
        setVendorEvaluations((prev) => {
          const filtered = prev.filter((e) => e.id !== savedEvaluation.id && e.vendorId !== savedEvaluation.vendorId);
          return [savedEvaluation, ...filtered];
        });
        logger.log('INFO', 'Saved vendor evaluation returned; no evaluation request sent', {
          vendorId,
          evaluationId: savedEvaluation.id,
        }, 'EVALUATION');
        showToast(
          UI_STRINGS.vendorEvaluationRequest.existingTitle,
          formatString(UI_STRINGS.vendorEvaluationRequest.existingBody, { vendorName: targetVendor.name }),
          'info'
        );
        return { success: true, message: data.message, evaluationExists: true, evaluation: savedEvaluation };
      }

      // The server's record of the request is the source for the time, the buyer and the status shown on the row.
      const sent = data.data && typeof data.data === 'object' ? data.data : {};
      const requestedAt = typeof sent.evaluationRequestedAt === 'string' ? sent.evaluationRequestedAt : new Date().toISOString();
      const requestedBy = typeof sent.evaluationRequestedBy === 'string' ? sent.evaluationRequestedBy : activeBuyerAccount?.organizationName || 'Buyer';
      setBuyerVendors((prev) =>
        prev.map((v) =>
          v.id === vendorId
            ? {
                ...v,
                evaluationRequested: true,
                evaluationRequestedAt: requestedAt,
                evaluationRequestedBy: requestedBy,
                status: typeof sent.status === 'string' ? sent.status : v.status,
              }
            : v
        )
      );

      void addFeedItem(
        `Evaluation Requested: ${targetVendor.name}`,
        `Sent 360° performance evaluation request to ${targetVendor.name} (${targetVendor.email}) on behalf of ${activeBuyerAccount?.organizationName || 'Buyer'}.`,
        'system',
        undefined,
        targetVendor.name,
        'system'
      );

      void addAuditLog(
        `Requested performance evaluation from vendor ${targetVendor.name} (${targetVendor.email}) by buyer ${activeBuyerAccount?.organizationName || 'Buyer'}.`
      );

      showToast(
        UI_STRINGS.vendorEvaluationRequest.successTitle,
        formatString(UI_STRINGS.vendorEvaluationRequest.successBody, { vendorName: targetVendor.name }),
        'success'
      );

      return { success: true, message: data.message };
    } catch (err: any) {
      logger.log('ERROR', 'Failed to request vendor evaluation', { error: err }, 'STORE');
      showToast(UI_STRINGS.vendorEvaluationRequest.requestFailedTitle, err?.message || UI_STRINGS.vendorEvaluationRequest.unreachableFallback, 'warning');
      return { success: false, message: err?.message };
    }
  };

  // Buyer Vendor Management — persists the vendor and waits for backend
  // onboarding so the success message accurately reflects credential delivery.
  const addBuyerVendor = async (vendor: Omit<VendorEntry, 'id'>): Promise<VendorEntry | null> => {
    let res: Response;
    try {
      res = await fetch('/api/vendors', {
        method: 'POST',
        headers: authFetchHeaders(),
        body: JSON.stringify(vendor),
      });
    } catch {
      showToast(
        'Could Not Add Vendor',
        'The vendor could not be saved — check your connection and try again.',
        'warning'
      );
      return null;
    }

    let body: { success?: boolean; data?: VendorEntry; error?: string; warning?: string } = {};
    try {
      body = await res.json();
    } catch {
      // body stays {}; handled by the !body.success check below
    }

    if (!res.ok || !body.success || !body.data) {
      showToast(
        'Could Not Add Vendor',
        body.error || 'The vendor could not be saved. No changes were made — try again.',
        'warning'
      );
      return null;
    }

    const newV = body.data;
    setBuyerVendors((prev) => {
      const updated = [newV, ...prev];
      setSessionCache('vendors', updated);
      return updated;
    });

    addFeedItem(
      `Vendor Added: ${newV.name}`,
      `${newV.name} was added to your vendor directory.`,
      'invitation',
      undefined,
      newV.name
    );
    addAuditLog(`Added vendor ${newV.name} (${newV.email})`);
    if (newV.onboardingEmailStatus === 'failed') {
      showToast(
        UI_STRINGS.vendorOnboarding.credentialsFailedTitle,
        body.warning || formatString(UI_STRINGS.vendorOnboarding.credentialsFailedMessage, { name: newV.name }),
        'warning'
      );
    } else if (newV.onboardingEmailStatus === 'account_exists') {
      showToast(
        UI_STRINGS.vendorOnboarding.addedTitle,
        formatString(UI_STRINGS.vendorOnboarding.accountExistsMessage, { name: newV.name }),
        'success'
      );
    } else if (newV.onboardingEmailStatus === 'pending') {
      showToast(
        UI_STRINGS.vendorOnboarding.credentialsQueuedTitle,
        formatString(UI_STRINGS.vendorOnboarding.credentialsQueuedMessage, { name: newV.name, email: newV.email || '' }),
        'success'
      );
    } else {
      showToast(
        UI_STRINGS.vendorOnboarding.addedTitle,
        formatString(UI_STRINGS.vendorOnboarding.credentialsSentMessage, { name: newV.name, email: newV.email || '' }),
        'success'
      );
    }

    return newV;
  };

  // The local list changes only after the server confirms the write, and it takes the record the server returns.
  const updateBuyerVendor = async (vendorId: string, updates: Partial<VendorEntry>): Promise<boolean> => {
    let res: Response;
    try {
      res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}`, {
        method: 'PUT',
        headers: authFetchHeaders(),
        body: JSON.stringify(updates),
      });
    } catch (err) {
      logger.log('ERROR', 'Failed to sync vendor update to backend', { error: err, vendorId }, 'VENDOR_PROFILE');
      showToast(STORE_MESSAGES.vendorUpdateFailedTitle, STORE_MESSAGES.vendorUnreachable, 'warning');
      return false;
    }

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      logApiResponseFailure('Vendor update request failed', res, 'VENDOR_PROFILE', { vendorId, responseError: json?.error });
      showToast(STORE_MESSAGES.vendorUpdateFailedTitle, json?.error || STORE_MESSAGES.vendorUpdateFailed, 'warning');
      return false;
    }

    const saved: Partial<VendorEntry> = json.data && typeof json.data === 'object' ? json.data : updates;
    setBuyerVendors((prev) => prev.map((v) => (v.id === vendorId ? { ...v, ...saved } : v)));
    void addAuditLog(`Updated vendor profile record for ID ${vendorId}.`);
    showToast('Vendor Profile Updated', 'Vendor information saved successfully.', 'success');
    return true;
  };

  // The vendor leaves the list only after the server confirms the delete.
  const deleteBuyerVendor = async (vendorId: string): Promise<boolean> => {
    let res: Response;
    try {
      res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}`, {
        method: 'DELETE',
        headers: authFetchHeaders(),
      });
    } catch (err) {
      logger.log('ERROR', 'Failed to sync vendor deletion to backend', { error: err, vendorId }, 'VENDOR_PROFILE');
      showToast(STORE_MESSAGES.vendorDeleteFailedTitle, STORE_MESSAGES.vendorUnreachable, 'warning');
      return false;
    }

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      logApiResponseFailure('Vendor deletion request failed', res, 'VENDOR_PROFILE', { vendorId, responseError: json?.error });
      showToast(STORE_MESSAGES.vendorDeleteFailedTitle, json?.error || STORE_MESSAGES.vendorDeleteFailed, 'warning');
      return false;
    }

    setBuyerVendors((prev) => {
      const updated = prev.filter((v) => v.id !== vendorId && v.email !== vendorId);
      setSessionCache('vendors', updated);
      return updated;
    });
    void addAuditLog(`Removed vendor record ID ${vendorId} from buyer vendor master.`);
    showToast('Vendor Removed', 'Vendor deleted from directory.', 'info');
    return true;
  };

  const deleteMultipleBuyerVendors = async (vendorIds: string[]) => {
    if (!Array.isArray(vendorIds) || vendorIds.length === 0) return;
    // Only the ids the server reports as deleted leave the list. A failed request leaves every row in place.
    let res: Response;
    try {
      res = await fetch('/api/vendors/bulk-delete', {
        method: 'POST',
        headers: authFetchHeaders(),
        body: JSON.stringify({ vendorIds }),
      });
    } catch (err) {
      logger.log('ERROR', 'Failed to sync bulk vendor deletion to backend', { error: err }, 'VENDOR_PROFILE');
      showToast(STORE_MESSAGES.vendorDeleteFailedTitle, STORE_MESSAGES.vendorUnreachable, 'warning');
      return;
    }

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      logApiResponseFailure('Bulk vendor deletion request failed', res, 'VENDOR_PROFILE', {
        requestedCount: vendorIds.length,
        responseError: json?.error,
      });
      showToast(STORE_MESSAGES.vendorDeleteFailedTitle, json?.error || STORE_MESSAGES.vendorDeleteFailed, 'warning');
      return;
    }

    const deletedIds: string[] = Array.isArray(json.deletedIds) ? json.deletedIds : [];
    const deletedSet = new Set(deletedIds);
    setBuyerVendors((prev) => {
      const updated = prev.filter((v) => !deletedSet.has(v.id) && !deletedSet.has(v.email || ''));
      setSessionCache('vendors', updated);
      return updated;
    });
    void addAuditLog(`Removed ${deletedIds.length} vendor record(s) from buyer vendor master.`);
    showToast(
      'Vendors Removed',
      formatString(STORE_MESSAGES.vendorsRemovedMessage, { count: deletedIds.length }),
      'info'
    );
  };

  // Dynamic Matching Logic based on Minor & Major Categories
  const matchSuitableVendors = (
    entities: ExtractedEntity[],
    mode: SourcingMode,
    customList?: VendorEntry[]
  ): VendorEntry[] => {
    const vendorPool = customList && customList.length > 0 ? customList : buyerVendors;
    const targetMinorCategories = entities.map(e => (e.minorCategory || '').toLowerCase().trim()).filter(Boolean);
    const targetMajorCategories = entities.map(e => (e.majorCategory || e.category || '').toLowerCase().trim()).filter(Boolean);

    const isRosterSource = (v: VendorEntry) =>
      v.source === 'buyer_manual' || v.source === 'buyer_excel' || v.source === 'manual' || v.source === 'excel';

    // Uses only the vendor's own category fields. A vendor with no category data does not match.
    const matchInfo = (v: VendorEntry): { matched: boolean; source?: VendorEntry['categoryMatchSource'] } => {
      const vMajor = (v.majorCategory || '').toLowerCase().trim();
      const clientMapped = (v.clientMappedCategories && v.clientMappedCategories.length > 0
        ? v.clientMappedCategories
        : v.minorCategories || []
      ).map(m => (m || '').toLowerCase().trim()).filter(Boolean);
      const vendorSelected = (v.vendorSelectedCategories || []).map(m => (m || '').toLowerCase().trim()).filter(Boolean);
      const allMinors = Array.from(new Set([...clientMapped, ...vendorSelected]));

      const isClientMappedMatch = targetMinorCategories.some(tMin =>
        clientMapped.some(vMin => vMin.includes(tMin) || tMin.includes(vMin))
      );
      const isVendorSelectedMatch = targetMinorCategories.some(tMin =>
        vendorSelected.some(vMin => vMin.includes(tMin) || tMin.includes(vMin))
      );
      const hasMinorMatch = isClientMappedMatch || isVendorSelectedMatch || targetMinorCategories.some(tMin =>
        allMinors.some(vMin => vMin.includes(tMin) || tMin.includes(vMin))
      );

      if (hasMinorMatch) {
        if (isClientMappedMatch && isVendorSelectedMatch) {
          return { matched: true, source: 'Aligned Buyer & Vendor Category Match' };
        }
        if (isClientMappedMatch) return { matched: true, source: 'Buyer Empanelled Category Match' };
        return { matched: true, source: 'Vendor Profile Self-Declared Category Match' };
      }

      // An empty major category never matches. An empty string is contained in every string.
      const hasMajorMatch = vMajor !== '' && targetMajorCategories.some(tMaj =>
        vMajor.includes(tMaj) || tMaj.includes(vMajor)
      );
      if (hasMajorMatch) return { matched: true };

      const hasItemMatch = entities.some(e => {
        const itemLower = (e.itemName + ' ' + (e.technicalSpecs || '')).toLowerCase();
        return allMinors.some(m => itemLower.includes(m)) || (vMajor !== '' && itemLower.includes(vMajor));
      });
      return { matched: hasItemMatch };
    };

    const withMatchReason = (v: VendorEntry, matchReason: string): VendorEntry => ({
      ...v,
      matchReason,
      categoryMatchSource: matchInfo(v).source,
    });

    // Evaluated vendors (those with a rating) come first. Duplicate records (same email, name or id) are dropped.
    const dedupeAndRank = (list: VendorEntry[]): VendorEntry[] => {
      const seen = new Set<string>();
      const deduplicated = list.filter((v) => {
        const key = ((v.email || v.name || v.id) || '').toLowerCase().trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return deduplicated.sort((a, b) => Number(Boolean(b.rating)) - Number(Boolean(a.rating)));
    };

    // No fallback list. When nothing matches, the result is empty, so an unmatched request never gets
    // unrelated vendors.
    if (mode === 'mode_1') {
      return vendorPool
        .filter(v => isRosterSource(v) && matchInfo(v).matched)
        .map(v => withMatchReason(v, 'Buyer Approved Roster (Minor Category Match)'));
    } else if (mode === 'mode_2') {
      // Buyer roster matches only. The hardcoded Procucev network vendors and the first-four fallback were removed.
      const matchedBuyer = vendorPool
        .filter(v => matchInfo(v).matched)
        .map(v => withMatchReason(v, 'Buyer Roster (Minor Category Match)'));
      return dedupeAndRank(matchedBuyer);
    } else {
      const matched = vendorPool
        .filter(v => isRosterSource(v) && matchInfo(v).matched)
        .map(v => withMatchReason(v, 'Buyer Approved Roster (360° Qualification & RFQ)'));
      return dedupeAndRank(matched);
    }
  };

  // Standard RFQ Email Generator Engine
  const generateStandardRFQEmail = (rfq: RFQItem, vendor: VendorEntry): StandardRFQEmailPayload => {
    const modeDetail = SOURCING_MODES.find(m => m.id === rfq.sourcingMode) || SOURCING_MODES[0];
    // This is a preview built from the RFQ and the vendor record. Nothing is sent here, so it has no server
    // seal (sha) and no dispatch time.
    const emailId = `EML-${rfq.rfqNumber}-${vendor.id}`;
    const major = vendor.majorCategory || rfq.extractedEntities[0]?.majorCategory || rfq.category || '';
    const minors = vendor.minorCategories && vendor.minorCategories.length > 0 
      ? vendor.minorCategories 
      : rfq.extractedEntities.map(e => e.minorCategory || e.category).filter(Boolean);

    let specialInstructions = '';
    if (rfq.sourcingMode === 'mode_1') {
      specialInstructions = 'Strict Single-Roster Submission: As an approved enterprise partner in our private roster, please submit your competitive line-item quotation directly against the enclosed BOQ.';
    } else if (rfq.sourcingMode === 'mode_2') {
      specialInstructions = 'Hybrid Competitive Sourcing: Your quotation will be benchmarked side-by-side on unit prices, lead time and the terms you state.';
    } else {
      specialInstructions = 'Mode 3 360-Degree Vendor Qualification Protocol: This RFQ is dispatched under high-governance double-blind compliance evaluation (M1 Commercial, M2 Technical, M3 Quality & Warranty, M4 Delivery, M5 Financial, M6 Governance/ESG). Please complete the linked qualification survey alongside your quotation.';
    }

    return {
      emailId,
      rfqNumber: rfq.rfqNumber,
      rfqTitle: rfq.title,
      sourcingMode: rfq.sourcingMode,
      sourcingModeName: modeDetail.name,
      sourcingModeCode: modeDetail.code,
      // Buyer identity comes from the active account. A missing field stays empty.
      buyerCompany: activeBuyerAccount?.organizationName ?? '',
      buyerContactName: activeBuyerAccount?.contactPerson ?? '',
      buyerContactEmail: activeBuyerAccount?.corporateEmail ?? '',
      buyerContactPhone: activeBuyerAccount?.mobileNumber ?? '',
      recipientVendorName: vendor.name,
      recipientContactPerson: vendor.contactPerson,
      recipientEmail: vendor.email ?? '',
      subject: [`[RFQ Invitation] ${rfq.rfqNumber}: ${rfq.title}`, activeBuyerAccount?.organizationName ? `| ${activeBuyerAccount.organizationName} Sourcing (${modeDetail.code})` : `(${modeDetail.code})`].join(' '),
      matchedMajorCategory: major,
      matchedMinorCategories: minors,
      requisitionDate: rfq.createdAt ?? '',
      submissionDeadline: rfq.targetDeliveryDate,
      targetDeliveryDate: rfq.targetDeliveryDate,
      deliveryLocation: rfq.deliveryLocation ?? '',
      // Payment terms are not stored on the RFQ, so none are stated here.
      paymentTerms: '',
      lineItems: rfq.extractedEntities.map((e, idx) => ({
        itemNumber: idx + 1,
        itemName: e.itemName,
        technicalSpecs: e.technicalSpecs,
        quantity: e.quantity,
        unit: e.unit,
        minorCategory: e.minorCategory || '',
        targetDate: e.targetDate,
      })),
      specialInstructions,
      // The RFQ does not store compliance requirements, so none are invented. The list stays empty.
      complianceChecklist: [],
      replyInstructions: 'Please reply directly to this RFQ email with your quotation attachment (PDF/Excel). DO NOT alter or change the subject line to ensure automated AI parsing into the comparative matrix.',
      replyToEmail: activeBuyerAccount?.corporateEmail ?? '',
      shaSignature: '',
      dispatchedAt: '',
    };
  };

  const openStandardEmailModal = (rfq: RFQItem, vendor?: VendorEntry) => {
    const targetVendor = vendor || buyerVendors.find(v => v.name === rfq.followUpData?.vendors[0]?.vendorName);
    // Without a recipient the email is not built. No vendor is picked at random from the directory.
    if (!targetVendor) {
      showToast(STORE_MESSAGES.emailNoRecipientTitle, STORE_MESSAGES.emailNoRecipient, 'warning');
      return;
    }
    const emailPayload = generateStandardRFQEmail(rfq, targetVendor);
    setSelectedEmailForModal(emailPayload);
    setEmailModalOpen(true);
  };
  
  const [toastMessage, setToastMessage] = useState<{ title: string; description: string; type: 'success' | 'info' | 'warning' } | null>(null);

  const showToast = (title: string, description: string, type: 'success' | 'info' | 'warning' = 'info') => {
    setToastMessage({ title, description, type });
    setTimeout(() => {
      setToastMessage((prev) => (prev?.title === title ? null : prev));
    }, 4500);
  };

  const dismissToast = () => {
    setToastMessage(null);
  };

  // Audit events raised in the browser are not stored in the database and do not join the server audit chain.
  // They go to the structured frontend log, which the backend writes to the console. The backend stamps the
  // signed-in user on each log line from the session token, so the event keeps its actor.
  const addAuditLog = async (action: string, rfqNumber?: string): Promise<void> => {
    logger.info(action, { rfqNumber: rfqNumber ?? null }, 'AUDIT_TRAIL');
  };

  // Feed entries raised in the browser are kept for this session only. They are not written to the database,
  // so they are not listed again after a reload. The server writes its own feed entries for the events it handles.
  const addFeedItem = (
    title: string,
    message: string,
    type: AIBotFeedItem['type'],
    rfqNumber?: string,
    recipient?: string,
    channel?: 'call' | 'whatsapp' | 'sms' | 'email' | 'system',
    channelDetails?: AIBotFeedItem['channelDetails']
  ): void => {
    const resolvedChannel = channel || (type === 'call' || type === 'whatsapp' || type === 'sms' || type === 'email' ? type : undefined);
    sessionFeedSequence += 1;
    const timestamp = new Date().toISOString();
    const item: AIBotFeedItem = {
      id: `session-feed-${Date.now()}-${sessionFeedSequence}`,
      timestamp,
      timeAgo: STORE_MESSAGES.feedJustNow,
      type,
      channel: resolvedChannel,
      title,
      message,
      recipient,
      rfqNumber,
      status: 'completed',
      channelDetails,
    };
    setAiFeed((prev) => [item, ...prev]);
  };

  // Sends the chasers through POST /api/rfqs/:id/batch-chaser. The server decides what reached a provider, per
  // vendor and per channel, and it records the feed and audit entries itself. Nothing here is reported as sent
  // unless the response counts it as sent.
  const triggerBatchChannelChaser = async (
    rfqNumber: string,
    channels: ('call' | 'whatsapp' | 'sms')[],
    suppressToast = false
  ): Promise<boolean> => {
    const requestedChannels = Array.from(new Set(channels));
    let res: Response;
    try {
      res = await fetch(`/api/rfqs/${encodeURIComponent(rfqNumber)}/batch-chaser`, {
        method: 'POST',
        headers: authFetchHeaders(),
        body: JSON.stringify({ channels: requestedChannels }),
      });
    } catch (e) {
      logger.log('ERROR', 'Batch chaser request could not reach the backend', { error: e, rfqNumber }, 'CHASER');
      if (!suppressToast) showToast(STORE_MESSAGES.chaserNotSentTitle, STORE_MESSAGES.chaserUnreachable, 'warning');
      return false;
    }

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      logApiResponseFailure('Batch chaser request failed', res, 'CHASER', { rfqNumber, responseError: json?.error });
      if (!suppressToast) {
        showToast(STORE_MESSAGES.chaserNotSentTitle, json?.error || STORE_MESSAGES.chaserRequestFailed, 'warning');
      }
      return false;
    }

    const results: Array<{ success?: boolean }> = Array.isArray(json?.results) ? json.results : [];
    const sentCount = typeof json?.sentCount === 'number' ? json.sentCount : results.filter((r) => r.success).length;

    // The server writes the RFQ follow-up outcome and the feed events, so both are reloaded from the server.
    void refreshRFQs();
    void refreshAIFeed();

    if (!suppressToast) {
      if (sentCount > 0) {
        showToast(
          STORE_MESSAGES.chaserSentTitle,
          formatString(STORE_MESSAGES.chaserSentMessage, {
            sent: sentCount,
            total: results.length,
            rfqNumber,
            channels: requestedChannels.map((c) => c.toUpperCase()).join(' + '),
          }),
          'success'
        );
      } else {
        showToast(STORE_MESSAGES.chaserNotSentTitle, json?.error || STORE_MESSAGES.chaserNoneSent, 'warning');
      }
    }
    return sentCount > 0;
  };

  // The server has no route that chases one vendor, and the batch route contacts every assigned vendor. So a
  // single-vendor chaser is never sent from here. It resolves false and tells the user nothing was sent.
  const triggerChannelChaser = async (
    rfqNumber: string,
    channel: 'call' | 'whatsapp' | 'sms' | 'email',
    vendorName = '',
    customNote?: string,
    suppressToast = false
  ): Promise<boolean> => {
    logger.log(
      'WARN',
      'Single-vendor chaser requested. No per-vendor chaser route exists, so nothing was sent.',
      { rfqNumber, channel, vendorName, hasNote: Boolean(customNote) },
      'CHASER'
    );
    if (!suppressToast) {
      showToast(STORE_MESSAGES.chaserNotSentTitle, STORE_MESSAGES.chaserVendorNotConnected, 'warning');
    }
    return false;
  };

  // Was entirely local-state — the real, already-working POST /:id/approve-po
  // endpoint was never called at all (BUGS.md #37), and the PO document shown
  // to the user (Modals.tsx) fabricated its own line items, vendor id, issue
  // date, and even a hardcoded "SHA-256" string that never changed no matter
  // what was actually approved (#36). Now calls the real endpoint and returns
  // its real response so the modal can render the real document instead.
  const approvePO = async (
    rfqNumber: string,
    vendorId: string | null,
    vendorName: string,
    amount: number,
    approverNotes?: string
  ): Promise<{ success: boolean; poNumber?: string; issueDate?: string; shaSignature?: string; lineItems?: { description: string; quantity: number; unit: string }[]; error?: string }> => {
    const effectiveVendorId = vendorId;
    const effectiveVendorName = vendorName;
    const effectiveAmount = amount;

    try {
      const res = await fetch(`/api/rfqs/${encodeURIComponent(rfqNumber)}/approve-po`, {
        method: 'POST',
        headers: authFetchHeaders(),
        body: JSON.stringify({ vendorId: effectiveVendorId, vendorName: effectiveVendorName, totalAmount: effectiveAmount, approverNotes }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast('PO Approval Failed', data.error || 'Could not approve the pre-purchase order.', 'warning');
        return { success: false, error: data.error };
      }

      setRfqs((prev) =>
        prev.map((r) =>
          r.rfqNumber === rfqNumber
            ? {
                ...r,
                status: 'PO Generated' as const,
                awardedVendor: effectiveVendorName,
                awardedAmount: effectiveAmount,
                awardedVendorId: effectiveVendorId || (r as any).awardedVendorId || null,
                poNumber: data.poNumber,
                poIssueDate: data.issueDate,
                poFinalised: true,
                poShaSignature: data.shaSignature,
                quotes: Array.isArray(r.quotes)
                  ? r.quotes.map((q) => {
                      const isAwarded = Boolean(
                        (effectiveVendorId && q.vendorId === effectiveVendorId) ||
                        (effectiveVendorName && q.vendorName && String(q.vendorName).toLowerCase().trim() === String(effectiveVendorName).toLowerCase().trim())
                      );
                      return { ...q, status: isAwarded ? 'Awarded' : q.status, awarded: isAwarded };
                    })
                  : r.quotes,
              }
            : r
        )
      );

      // The approval endpoint writes its own audit entry on the server. It does not dispatch to an ERP or a
      // vendor portal, so the feed line states only what was recorded.
      void addFeedItem(
        `Pre-Purchase Order Generated: ${rfqNumber}`,
        `Approved Pre-PO ${data.poNumber} generated for ${effectiveVendorName} totaling ${formatCurrency(effectiveAmount)}.`,
        'approval',
        rfqNumber
      );

      showToast(
        'Pre-Purchase Order Issued!',
        `Official Pre-Purchase Order ${data.poNumber} generated for ${effectiveVendorName}.`,
        'success'
      );

      return { success: true, poNumber: data.poNumber, issueDate: data.issueDate, shaSignature: data.shaSignature, lineItems: data.lineItems };
    } catch (err: unknown) {
      const message = err instanceof Error && err.message ? err.message : STORE_MESSAGES.poNetworkFailed;
      showToast('PO Approval Failed', message, 'warning');
      return { success: false, error: message };
    }
  };

  /**
   * Adopt a server-created RFQ, replacing any existing entry with the same RFQ
   * number so a refresh cannot leave two copies of one record.
   */
  const adoptCreatedRFQ = (rfq: RFQItem, remainingCredits?: number | null) => {
    setRfqs((prev) => {
      const exists = prev.some((r) => r.rfqNumber === rfq.rfqNumber || (rfq.id && r.id === rfq.id));
      if (exists) {
        return prev.map((r) => (r.rfqNumber === rfq.rfqNumber || (rfq.id && r.id === rfq.id) ? rfq : r));
      }
      return [rfq, ...prev];
    });
    setVendorOpportunities((prev) => {
      const opp = buildOpportunityFromRFQ(rfq);
      const exists = prev.some((o) => o.rfqNumber === rfq.rfqNumber);
      if (exists) {
        return prev.map((o) => (o.rfqNumber === rfq.rfqNumber ? opp : o));
      }
      return [opp, ...prev];
    });

    // Only a balance the server reported changes the count. If none was reported, the count is left as it was.
    // Nothing is decremented or derived here.
    if (typeof remainingCredits === 'number') {
      const serverRemaining = remainingCredits;
      setRemainingFreeRFQs(serverRemaining);
      setActiveBuyerAccount((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, remainingFreeRFQs: serverRemaining };
        setSessionCache('activeBuyerAccount', updated);
        return updated;
      });
    }

    addAuditLog(`Created ${rfq.rfqNumber} (${rfq.title})`, rfq.rfqNumber);
    void refreshAIFeed();
    void refreshActiveBuyerAccount();
  };

  /**
   * Persist an edit, then adopt what the API stored.
   *
   * The response is the authority: it carries the new `updatedAt` and any value the
   * server normalised. Patching the local copy from the request instead would let
   * the two drift, which is the failure the RFQ create path already had.
   */
  const updateRFQ = async (identifier: string, changes: RFQUpdatePayload): Promise<RFQItem> => {
    const result = await updateRFQRequest(identifier, changes);

    if (!result.success) {
      showToast(UI_STRINGS.rfqEdit.saveFailedTitle, result.error, 'warning');
      // Thrown rather than swallowed so the dialog stays open on the buyer's edits.
      throw new Error(result.error);
    }

    const saved: RFQItem = {
      ...result.rfq,
      assignedVendors:
        changes.assignedVendors &&
        Array.isArray(changes.assignedVendors) &&
        changes.assignedVendors.length >= (result.rfq.assignedVendors?.length || 0)
          ? (changes.assignedVendors as any)
          : result.rfq.assignedVendors || (changes.assignedVendors as any) || [],
    };
    setRfqs((prev) => prev.map((r) => (r.rfqNumber === saved.rfqNumber ? saved : r)));
    setVendorOpportunities((prev) =>
      prev.map((opp) => (opp.rfqNumber === saved.rfqNumber ? buildOpportunityFromRFQ(saved) : opp))
    );
    // Kept in step so a screen already holding this RFQ does not show the old terms.
    setSelectedRFQForMatrix((prev) => (prev?.rfqNumber === saved.rfqNumber ? saved : prev));
    setSelectedRFQForDeepDive((prev) => (prev?.rfqNumber === saved.rfqNumber ? saved : prev));

    addAuditLog(
      `Edited ${saved.rfqNumber}: ${Object.keys(changes).join(', ')}`,
      saved.rfqNumber
    );
    showToast(
      UI_STRINGS.rfqEdit.savedTitle,
      formatString(UI_STRINGS.rfqEdit.savedMessage, { rfqNumber: saved.rfqNumber }),
      'success'
    );
    return saved;
  };

  /**
   * Delete an RFQ, then drop it from every list holding it.
   *
   * Removed only after the API confirms, so a failed delete leaves the row on
   * screen instead of hiding a record the database still has.
   */
  const deleteRFQ = async (identifier: string): Promise<void> => {
    const result = await deleteRFQRequest(identifier);

    if (!result.success) {
      showToast(UI_STRINGS.rfqEdit.deleteFailedTitle, result.error, 'warning');
      throw new Error(result.error);
    }

    const { rfqNumber } = result;
    setRfqs((prev) => prev.filter((r) => r.rfqNumber !== rfqNumber));
    setVendorOpportunities((prev) => prev.filter((opp) => opp.rfqNumber !== rfqNumber));
    // A selection pointing at a deleted RFQ would render a stale record, so it is
    // cleared rather than left dangling.
    setSelectedRFQForMatrix((prev) => (prev?.rfqNumber === rfqNumber ? null : prev));
    setSelectedRFQForDeepDive((prev) => (prev?.rfqNumber === rfqNumber ? null : prev));

    addAuditLog(`Deleted ${rfqNumber}`, rfqNumber);
    showToast(
      UI_STRINGS.rfqEdit.deletedTitle,
      formatString(UI_STRINGS.rfqEdit.deletedMessage, { rfqNumber }),
      'success'
    );
  };

  const addNewRFQ = async (rfqData: NewRFQInput): Promise<RFQItem> => {
    // These gates refuse only what the loaded account already shows as refused. The server applies the same
    // limits inside the RFQ create transaction and returns the reason when it refuses. No count is decremented
    // here before the server has confirmed the RFQ.
    if (activeSubscription === 'none') {
      showToast('Subscription Upgrade Required', 'Your organization domain has already claimed its free trial. You must subscribe to a sourcing mode to dispatch RFQs.', 'warning');
      throw new Error('Subscription required');
    }

    if (
      activeSubscription === 'free_trial' &&
      rfqData.sourcingMode !== RFQ_MODES.MODE_0 &&
      remainingFreeRFQs !== null &&
      remainingFreeRFQs <= 0
    ) {
      showToast('Free RFQ Quota Exhausted', 'You have hit your limit on Mode 1, Mode 2, and Mode 3, but you can create multiple RFQs with Mode 0 (Procucev Network Vendors). Upgrade your plan to continue creating RFQs with Mode 1, Mode 2, or Mode 3.', 'warning');
      throw new Error('Free account quota exhausted');
    }

    if (activeSubscription !== null && activeSubscription !== 'free_trial') {
      if (rfqData.sourcingMode === RFQ_MODES.MODE_2 && activeSubscription === 'version_1') {
        showToast('Upgrade Required', `${RFQ_MODE_LABELS[RFQ_MODES.MODE_2]} Sourcing requires a ${RFQ_MODE_LABELS[RFQ_MODES.MODE_2]} (Hybrid Network) Plan subscription.`, 'warning');
        throw new Error('Subscription required');
      }
      if (rfqData.sourcingMode === RFQ_MODES.MODE_3 && activeSubscription !== 'version_3') {
        showToast('Upgrade Required', `${RFQ_MODE_LABELS[RFQ_MODES.MODE_3]} Sourcing requires a ${RFQ_MODE_LABELS[RFQ_MODES.MODE_3]} (Autonomous AI) Plan subscription.`, 'warning');
        throw new Error('Subscription required');
      }
    }

    // The RFQ is persisted first and the server's record is what goes into state.
    //
    // This used to be the other way round: a locally built RFQ was pushed into
    // `rfqs` immediately and the POST was fired without being awaited, its response
    // discarded. Two things broke as a result. The client kept a `rfqNumber` it had
    // minted itself with Math.random(), while the server allocated a different one
    // under the Java scheme — so opening the details page fetched a number that did
    // not exist and rendered neither line items nor the summary. And a failed save
    // still left the RFQ on screen as though it had been dispatched.
    const saved = await createRFQ({
      title: rfqData.title,
      category: rfqData.category,
      sourcingMode: rfqData.sourcingMode,
      status: 'Quotes Pending',
      source: rfqData.source || (rfqData.sourceFileName ? 'ai_extraction' : 'manual_entry'),
      sourceFileName: rfqData.sourceFileName,
      // Origin of an emailed requisition. Previously omitted here, so the sender
      // the wizard had already parsed was dropped before it ever reached the API.
      sourceEmail: rfqData.sourceEmail,
      budget: Number(rfqData.budget) || 0,
      targetDeliveryDate:
        rfqData.targetDeliveryDate ||
        (rfqData as any).target_delivery_date ||
        (rfqData as any).deadline ||
        rfqData.extractedEntities?.[0]?.targetDate ||
        '',
      deliveryLocation: rfqData.deliveryLocation || '',
      deliveryPincode: rfqData.deliveryPincode || '',
      extractedEntities: rfqData.extractedEntities,
      attachments: rfqData.attachments || [],
    });

    if (!saved.success) {
      // Thrown rather than swallowed: the caller shows the reason, and no phantom
      // RFQ is added to a list the database knows nothing about.
      throw new Error(saved.error);
    }

    const newRFQ: RFQItem = {
      ...saved.rfq,
      // Local-only presentation state the API does not model. Everything the
      // server owns — id, rfqNumber, createdAt, extractedEntities, aiSummary — is
      // taken from its response above and never overwritten here.
      autoCirculated: rfqData.autoCirculated ?? (rfqData.source === 'email_gateway'),
      aiScore: rfqData.aiScore,
      // No outreach telemetry. Nothing dispatches chasers yet, so a followUpData
      // block here could only report zeros against a schedule that no job runs —
      // and those zeros were being read as real by the portfolio KPIs.
      chasingActive: false,
      quotes: [],
    };

    // Replaces any entry with the same number so a concurrent refresh cannot leave
    // two copies of one RFQ.
    setRfqs((prev) => [newRFQ, ...prev.filter((r) => r.rfqNumber !== newRFQ.rfqNumber)]);

    // Built from the saved RFQ by the same mapper the list uses, so the vendor portal shows the buyer, location
    // and value the server stored.
    setVendorOpportunities((prev) => [buildOpportunityFromRFQ(newRFQ), ...prev]);

    // The server assigns the vendors and queues their invitations, so the count here is the one it stored.
    // No per-vendor send is reported, because the client cannot observe one.
    const assignedCount = Array.isArray(newRFQ.assignedVendors) ? newRFQ.assignedVendors.length : 0;
    void addFeedItem(
      formatString(STORE_MESSAGES.rfqCreatedFeedTitle, { rfqNumber: newRFQ.rfqNumber }),
      formatString(STORE_MESSAGES.rfqCreatedFeedMessage, { count: assignedCount }),
      'email',
      newRFQ.rfqNumber
    );

    void addAuditLog(`Created ${newRFQ.rfqNumber} (${newRFQ.title})`, newRFQ.rfqNumber);

    showToast(
      STORE_MESSAGES.rfqCreatedTitle,
      formatString(STORE_MESSAGES.rfqCreatedMessage, { rfqNumber: newRFQ.rfqNumber, count: assignedCount }),
      'success'
    );

    // Only the balance the server returned is applied. It is not computed from the request.
    if (typeof saved.remainingFreeRFQs === 'number') {
      const remainingNum = saved.remainingFreeRFQs;
      setRemainingFreeRFQs(remainingNum);
      setActiveBuyerAccount((prev) => (prev ? { ...prev, remainingFreeRFQs: remainingNum } : prev));
    }
    void refreshActiveBuyerAccount();

    return newRFQ;
  };

  // Sync role tab defaults
  useEffect(() => {
    if (currentRole === 'buyer') {
      setActiveTab('command_center');
    } else if (currentRole === 'category_manager') {
      setActiveTab('kanban_board');
    } else if (currentRole === 'vendor') {
      setActiveTab('vendor_feed');
    } else if (currentRole === 'admin') {
      setActiveTab('infra_control');
    }
  }, [currentRole]);

  return (
    <AppContext.Provider
      value={{
        currentRole,
        setCurrentRole,
        isLoggedIn,
        setIsLoggedIn,
        currentUserSession,
        setCurrentUserSession,
        currentMode,
        setCurrentMode,
        activeTab,
        setActiveTab,
        rfqs,
        aiFeed,
        aiFeedError,
        vendorOpportunities,
        auditLogs,
        azureHealth,
        systemConfig,
        setSystemConfig,
        isLoadingDB,
        isLoadingRFQs,
        isLoadingVendors,
        dbConnected,
        refreshFromDB,
        refreshRFQs,
        refreshAIFeed,
        refreshActiveBuyerAccount,
        ensureRouteData,
        ensureRFQs,
        ensureVendors,
        ensureVendorEvaluations,
        ensureCategoryTaxonomy,
        ensureAIFeed,
        ensureActiveBuyerAccount,
        categoryTaxonomy,
        categoryTaxonomyError,
        isLoadingCategoryTaxonomy,
        refreshCategoryTaxonomy,
        addNewRFQ,
        adoptCreatedRFQ,
        updateRFQ,
        deleteRFQ,
        triggerChannelChaser,
        triggerBatchChannelChaser,
        approvePO,
        addAuditLog,
        addFeedItem,
        selectedRFQForMatrix,
        selectedVendorOpportunity,
        setSelectedVendorOpportunity,
        activeEvaluationRecord,
        setActiveEvaluationRecord,
        setSelectedRFQForMatrix,
        selectedRFQForDeepDive,
        setSelectedRFQForDeepDive,
        deepDiveModalOpen,
        setDeepDiveModalOpen,
        openRFQDeepDive,
        vendorEvaluations,
        addVendorEvaluation,
        fetchVendorEvaluation,
        selectedVendorEvaluation,
        setSelectedVendorEvaluation,
        evaluationModalOpen,
        setEvaluationModalOpen,
        openVendorEvaluationSummary,
        theme,
        setTheme,
        toggleTheme,
        toastMessage,
        showToast,
        dismissToast,
        remainingFreeRFQs,
        setRemainingFreeRFQs,
        activeSubscription,
        setActiveSubscription,
        vendorSubscription,
        setVendorSubscription,
        updateVendorSubscription,
        createVendorPaymentLink,
        checkVendorPaymentLinkStatus,
        vendorFreeCreditsRemaining,
        vendorFreeCreditsAllocated,
        vendorFreeCreditsUsed,
        vendorUnlockedRfqIds,
        refreshVendorCredits,
        unlockRFQForVendor,
        vendorRfqDownloadsUsed,
        setVendorRfqDownloadsUsed,
        vendorCatalogue,
        setVendorCatalogue,
        buyerAccounts,
        activeBuyerAccount,
        createBuyerPaymentLink,
        checkBuyerPaymentLinkStatus,
        addBuyerAccount,
        updateBuyerAccount,
        deleteBuyerAccount,
        alignActiveBuyerAccount,
        initialSetupModalOpen,
        setInitialSetupModalOpen,
        initialSetupCompleted,
        setInitialSetupCompleted,
        historicalPurchaseDataPeriod,
        setHistoricalPurchaseDataPeriod,
        processHistoricalPurchaseData,
        lastIngestionSummary,
        setLastIngestionSummary,
        lastIngestionError,
        setLastIngestionError,
        buyerVendors,
        addBuyerVendor,
        updateBuyerVendor,
        deleteBuyerVendor,
        deleteMultipleBuyerVendors,
        matchSuitableVendors,
        generateVendorOnboardingEmail,
        selectedOnboardingEmail,
        setSelectedOnboardingEmail,
        onboardingEmailModalOpen,
        setOnboardingEmailModalOpen,
        openOnboardingEmailModal,
        clientMappedCategories,
        setClientMappedCategories,
        vendorSelectedCategories,
        setVendorSelectedCategories,
        saveVendorProfileCategories,
        generateStandardRFQEmail,
        selectedEmailForModal,
        setSelectedEmailForModal,
        emailModalOpen,
        setEmailModalOpen,
        openStandardEmailModal,
        vendorSelfEvaluationCompleted,
        setVendorSelfEvaluationCompleted,
        vendorSelfEvaluationScore,
        setVendorSelfEvaluationScore,
        isVendorEvaluationFeeWaived: vendorSubscription === 'connect' || vendorSubscription === 'select',
        reviseVendorRating,
        requestVendorEvaluation,
        selectedRatingRevisionEmail,
        setSelectedRatingRevisionEmail,
        ratingRevisionEmailModalOpen,
        setRatingRevisionEmailModalOpen,
        openRatingRevisionEmailModal,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
