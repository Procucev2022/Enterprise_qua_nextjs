'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  UserRole,
  SourcingMode,
  RFQItem,
  AIBotFeedItem,
  VendorOpportunity,
  AuditLogEntry,
  AzureServiceHealth,
  SystemConfig,
  QuoteComparison,
  VendorEvaluationRecord,
  VendorSubscriptionPlan,
  VendorEntry,
  StandardRFQEmailPayload,
  VendorOnboardingEmailPayload,
  VendorProfileReminderPayload,
  HistoricalPurchaseVendorRecord,
  ExtractedEntity,
  BuyerAccount,
  VendorRatingRevisionRecord,
  VendorRatingRevisionEmailPayload,
} from './types';
import {
  SOURCING_MODES,
  INITIAL_SYSTEM_CONFIG,
  INITIAL_AZURE_HEALTH,
} from './constants';

interface AppContextType {
  currentRole: UserRole;
  setCurrentRole: (role: UserRole) => void;
  isLoggedIn: boolean;
  setIsLoggedIn: (loggedIn: boolean) => void;
  currentMode: SourcingMode;
  setCurrentMode: (mode: SourcingMode) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  rfqs: RFQItem[];
  aiFeed: AIBotFeedItem[];
  vendorOpportunities: VendorOpportunity[];
  auditLogs: AuditLogEntry[];
  azureHealth: AzureServiceHealth[];
  systemConfig: SystemConfig;
  setSystemConfig: React.Dispatch<React.SetStateAction<SystemConfig>>;
  isLoadingDB: boolean;
  dbConnected: boolean;
  refreshFromDB: () => Promise<void>;
  
  // Integrated Buyer Accounts & Public System Database
  buyerAccounts: BuyerAccount[];
  activeBuyerAccount: BuyerAccount | null;
  addBuyerAccount: (account: Omit<BuyerAccount, 'id' | 'syncTimestamp' | 'createdDate'>) => BuyerAccount;
  updateBuyerAccount: (id: string, updates: Partial<BuyerAccount>) => void;
  deleteBuyerAccount: (id: string) => void;
  alignActiveBuyerAccount: (accountId: string) => void;
  importPublicBuyerDatabase: (accounts: Omit<BuyerAccount, 'id' | 'syncTimestamp' | 'createdDate'>[]) => number;

  // Initial Setup & Historical Purchase Data Ingestion (1, 2, or 3 Years)
  initialSetupModalOpen: boolean;
  setInitialSetupModalOpen: (open: boolean) => void;
  initialSetupCompleted: boolean;
  setInitialSetupCompleted: (completed: boolean) => void;
  historicalPurchaseDataPeriod: '1_year' | '2_years' | '3_years';
  setHistoricalPurchaseDataPeriod: (period: '1_year' | '2_years' | '3_years') => void;
  processHistoricalPurchaseData: (period: '1_year' | '2_years' | '3_years', vendors: HistoricalPurchaseVendorRecord[]) => number;

  // Buyer Uploaded Vendors, Database Check & Automated Onboarding Emails
  buyerVendors: VendorEntry[];
  addBuyerVendor: (vendor: Omit<VendorEntry, 'id'>) => VendorEntry;
  importBuyerVendors: (vendorsToImport: Omit<VendorEntry, 'id'>[]) => number;
  deleteBuyerVendor: (vendorId: string) => void;
  matchSuitableVendors: (entities: ExtractedEntity[], mode: SourcingMode, customList?: VendorEntry[]) => VendorEntry[];
  generateVendorOnboardingEmail: (vendor: VendorEntry, isExisting: boolean, tempPassword?: string) => VendorOnboardingEmailPayload;
  selectedOnboardingEmail: VendorOnboardingEmailPayload | null;
  setSelectedOnboardingEmail: (email: VendorOnboardingEmailPayload | null) => void;
  onboardingEmailModalOpen: boolean;
  setOnboardingEmailModalOpen: (open: boolean) => void;
  openOnboardingEmailModal: (vendor: VendorEntry) => void;
  triggerVendorReminder: (vendorId: string) => void;
  completeVendorProfile: (vendorEmail: string, updatedCategories?: string[]) => void;

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
  reviseVendorRating: (vendorId: string, qualityScore: number, costScore: number, deliveryScore: number, remarks: string) => VendorRatingRevisionRecord;
  selectedRatingRevisionEmail: VendorRatingRevisionEmailPayload | null;
  setSelectedRatingRevisionEmail: (email: VendorRatingRevisionEmailPayload | null) => void;
  ratingRevisionEmailModalOpen: boolean;
  setRatingRevisionEmailModalOpen: (open: boolean) => void;
  openRatingRevisionEmailModal: (revision: VendorRatingRevisionRecord) => void;

  // Actions
  addNewRFQ: (rfq: Omit<RFQItem, 'id' | 'createdAt' | 'quotes' | 'quotesCount' | 'status' | 'chasingActive'>, customMatchedVendors?: VendorEntry[]) => RFQItem;
  triggerWhatsAppChaser: (rfqNumber: string, vendorName?: string) => void;
  triggerChannelChaser: (rfqNumber: string, channel: 'call' | 'whatsapp' | 'sms' | 'email', vendorName?: string, customNote?: string) => void;
  triggerBatchChannelChaser: (rfqNumber: string, channels: ('call' | 'whatsapp' | 'sms')[]) => void;
  submitVendorBid: (rfqNumber: string, unitPrice: number, leadTimeDays: number, remarks: string) => void;
  approvePO: (rfqNumber: string, vendorName: string, amount: number) => void;
  addAuditLog: (action: string, rfqNumber?: string, user?: string) => void;
  addFeedItem: (title: string, message: string, type: AIBotFeedItem['type'], rfqNumber?: string, recipient?: string, channel?: 'call' | 'whatsapp' | 'sms' | 'email' | 'system', channelDetails?: AIBotFeedItem['channelDetails']) => void;
  selectedRFQForMatrix: RFQItem | null;
  setSelectedRFQForMatrix: (rfq: RFQItem | null) => void;
  selectedRFQForDeepDive: RFQItem | null;
  setSelectedRFQForDeepDive: (rfq: RFQItem | null) => void;
  deepDiveModalOpen: boolean;
  setDeepDiveModalOpen: (open: boolean) => void;
  openRFQDeepDive: (rfq: RFQItem) => void;
  vendorEvaluations: VendorEvaluationRecord[];
  addVendorEvaluation: (record: VendorEvaluationRecord) => void;
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

  // Sourcing Free Tier RFQ Limits (Max 5 for Version 1 Free Trial)
  remainingFreeRFQs: number;
  setRemainingFreeRFQs: React.Dispatch<React.SetStateAction<number>>;
  activeSubscription: 'free_trial' | 'version_1' | 'version_2' | 'version_3' | 'none';
  setActiveSubscription: React.Dispatch<React.SetStateAction<'free_trial' | 'version_1' | 'version_2' | 'version_3' | 'none'>>;
  vendorSubscription: VendorSubscriptionPlan;
  setVendorSubscription: React.Dispatch<React.SetStateAction<VendorSubscriptionPlan>>;
  vendorRfqDownloadsUsed: number;
  setVendorRfqDownloadsUsed: React.Dispatch<React.SetStateAction<number>>;
  vendorCatalogue: any[];
  setVendorCatalogue: React.Dispatch<React.SetStateAction<any[]>>;

  // Vendor 360° AI Self-Evaluation & Infra Fee ($5 or $0 with Connect/Select)
  vendorSelfEvaluationCompleted: boolean;
  setVendorSelfEvaluationCompleted: (completed: boolean) => void;
  vendorSelfEvaluationScore: number;
  setVendorSelfEvaluationScore: (score: number) => void;
  isVendorEvaluationFeeWaived: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// Helper to generate realistic SHA-256 format strings
function generateShaHash(): string {
  const chars = '0123456789abcdef';
  let hash = '';
  for (let i = 0; i < 64; i++) {
    hash += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return hash;
}

const INITIAL_VENDOR_OPPORTUNITIES: VendorOpportunity[] = [
  {
    id: 'opp-1',
    rfqNumber: 'RFQ-2026-00421',
    title: 'Centrifugal Water Pump Package (15 HP)',
    buyer: 'Larsen & Toubro Ltd. (L&T)',
    deadline: '2026-09-15',
    daysRemaining: 7,
    type: 'direct_invitation',
    estimatedValue: '$150,000',
    deliveryLocation: 'Navi Mumbai Hub',
    status: 'pending_bid',
    lineItems: [
      { id: 'li-1', description: 'Centrifugal industrial water pump 15HP', quantity: 10, unitPrice: 0, leadTimeDays: 7, marketBandStatus: 'optimal', paymentTerms: 'Net 60' }
    ]
  },
  {
    id: 'opp-2',
    rfqNumber: 'RFQ-2026-00423',
    title: 'High Pressure Gate Valve System',
    buyer: 'Tata Projects Ltd.',
    deadline: '2026-09-20',
    daysRemaining: 12,
    type: 'direct_invitation',
    estimatedValue: '$85,000',
    deliveryLocation: 'Pune Facility',
    status: 'pending_bid',
    lineItems: [
      { id: 'li-2', description: 'SS316 high pressure gate valves', quantity: 25, unitPrice: 0, leadTimeDays: 14, marketBandStatus: 'optimal', paymentTerms: 'Net 30' }
    ]
  },
  {
    id: 'opp-3',
    rfqNumber: 'RFQ-2026-00501',
    title: 'HVAC Air Handling Unit & Smart Chiller Control',
    buyer: 'NTPC Limited',
    deadline: '2026-09-25',
    daysRemaining: 17,
    type: 'network_marketplace',
    estimatedValue: '$220,000',
    deliveryLocation: 'Delhi Enterprise Logistics',
    status: 'pending_bid',
    lineItems: [
      { id: 'li-3', description: 'Commercial building automation HVAC controller', quantity: 5, unitPrice: 0, leadTimeDays: 21, marketBandStatus: 'optimal', paymentTerms: 'Net 45' }
    ]
  },
  {
    id: 'opp-4',
    rfqNumber: 'RFQ-2026-00502',
    title: 'Structural Steel Beams & Pipe Fittings',
    buyer: 'BHEL Power Sector',
    deadline: '2026-09-30',
    daysRemaining: 22,
    type: 'network_marketplace',
    estimatedValue: '$310,000',
    deliveryLocation: 'Chennai Logistics Site',
    status: 'pending_bid',
    lineItems: [
      { id: 'li-4', description: 'Standard carbon steel flanged connector pipe adapter fitting', quantity: 50, unitPrice: 0, leadTimeDays: 10, marketBandStatus: 'optimal', paymentTerms: 'Net 60' }
    ]
  }
];

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [currentRole, setCurrentRole] = useState<UserRole>('buyer');
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(true);
  const [currentMode, setCurrentMode] = useState<SourcingMode>('mode_2');
  const [activeTab, setActiveTab] = useState<string>('command_center');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Subscription State
  const [remainingFreeRFQs, setRemainingFreeRFQs] = useState<number>(5);
  const [activeSubscription, setActiveSubscription] = useState<'free_trial' | 'version_1' | 'version_2' | 'version_3' | 'none'>('free_trial');
  const [vendorSubscription, setVendorSubscription] = useState<VendorSubscriptionPlan>('premium');
  const [vendorRfqDownloadsUsed, setVendorRfqDownloadsUsed] = useState<number>(3);

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
  const [dbConnected, setDbConnected] = useState<boolean>(false);

const INITIAL_BUYER_ACCOUNTS: BuyerAccount[] = [
  {
    id: 'ba-1',
    organizationName: 'Larsen & Toubro Ltd. (L&T)',
    contactPerson: 'Rajesh Nair',
    corporateEmail: 'rajesh.nair@larsentoubro.com',
    mobileNumber: '+919820011223',
    gstin: '27AABCL1234F1Z5',
    industrySector: 'Heavy Engineering',
    sourcingMode: 'mode_2',
    subscriptionPlan: 'version_2',
    remainingFreeRFQs: 0,
    accountSource: 'public_system',
    status: 'ACTIVE_VERIFIED',
    primaryPlantLocation: 'Mumbai',
    supportedMajorCategories: ['Mechanical & Fluid Equipment'],
    totalRFQsCreated: 12,
    totalSpend: '$1,250,000',
    syncTimestamp: '2026-08-30 00:00:00 UTC',
    createdDate: '2026-01-01',
  },
  {
    id: 'ba-2',
    organizationName: 'Tata Projects Ltd.',
    contactPerson: 'Amit Kumar Tata',
    corporateEmail: 'amit.kumar@tataprojects.com',
    mobileNumber: '+919820044556',
    gstin: '27AABCT5678F1Z9',
    industrySector: 'Infrastructure',
    sourcingMode: 'mode_1',
    subscriptionPlan: 'version_1',
    remainingFreeRFQs: 0,
    accountSource: 'public_system',
    status: 'ACTIVE_VERIFIED',
    primaryPlantLocation: 'Pune',
    supportedMajorCategories: ['Mechanical & Fluid Equipment'],
    totalRFQsCreated: 8,
    totalSpend: '$850,000',
    syncTimestamp: '2026-08-30 00:00:00 UTC',
    createdDate: '2026-01-01',
  }
];

  const [rfqs, setRfqs] = useState<RFQItem[]>([]);
  const [aiFeed, setAiFeed] = useState<AIBotFeedItem[]>([]);
  const [vendorOpportunities, setVendorOpportunities] = useState<VendorOpportunity[]>(INITIAL_VENDOR_OPPORTUNITIES);
  const [buyerVendors, setBuyerVendors] = useState<VendorEntry[]>([]);
  const [buyerAccounts, setBuyerAccounts] = useState<BuyerAccount[]>(INITIAL_BUYER_ACCOUNTS);
  const [activeBuyerAccount, setActiveBuyerAccount] = useState<BuyerAccount | null>(null);
  const [selectedEmailForModal, setSelectedEmailForModal] = useState<StandardRFQEmailPayload | null>(null);
  const [emailModalOpen, setEmailModalOpen] = useState<boolean>(false);

  // Vendor 360° AI Self-Evaluation & Infra Fee State
  const [vendorSelfEvaluationCompleted, setVendorSelfEvaluationCompleted] = useState<boolean>(false);
  const [vendorSelfEvaluationScore, setVendorSelfEvaluationScore] = useState<number>(94.5);

  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [azureHealth, setAzureHealth] = useState<AzureServiceHealth[]>(INITIAL_AZURE_HEALTH);
  const [systemConfig, setSystemConfig] = useState<SystemConfig>(INITIAL_SYSTEM_CONFIG);
  const [selectedRFQForMatrix, setSelectedRFQForMatrix] = useState<RFQItem | null>(null);
  const [selectedRFQForDeepDive, setSelectedRFQForDeepDive] = useState<RFQItem | null>(null);
  const [deepDiveModalOpen, setDeepDiveModalOpen] = useState<boolean>(false);

  const [vendorEvaluations, setVendorEvaluations] = useState<VendorEvaluationRecord[]>([]);
  const [selectedVendorEvaluation, setSelectedVendorEvaluation] = useState<VendorEvaluationRecord | null>(null);
  const [evaluationModalOpen, setEvaluationModalOpen] = useState<boolean>(false);

  // Hydrate all platform data directly from PostgreSQL database
  const refreshFromDB = async () => {
    setIsLoadingDB(true);
    try {
      const res = await fetch('/api/bootstrap');
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        if (d.buyerAccounts && d.buyerAccounts.length > 0) {
          setBuyerAccounts(d.buyerAccounts);
          setActiveBuyerAccount((prev) => {
            if (!prev) return d.buyerAccounts[0];
            const matched = d.buyerAccounts.find((a: BuyerAccount) => a.id === prev.id);
            return matched || d.buyerAccounts[0];
          });
        }
        if (d.vendors && d.vendors.length > 0) {
          setBuyerVendors(d.vendors);
        }
        if (d.rfqs && d.rfqs.length > 0) {
          setRfqs(d.rfqs);
          setSelectedRFQForMatrix((prev) => prev || d.rfqs[0]);
          setSelectedRFQForDeepDive((prev) => prev || d.rfqs[0]);

          const mappedOpps: VendorOpportunity[] = d.rfqs.map((rfq: RFQItem) => ({
            id: `opp-${rfq.id}`,
            rfqNumber: rfq.rfqNumber,
            title: rfq.title,
            buyer: 'Enterprise Procurement Division',
            deadline: rfq.targetDeliveryDate || '2026-09-15',
            daysRemaining: 7,
            type: rfq.sourcingMode === 'mode_3' ? 'network_marketplace' : 'direct_invitation',
            estimatedValue: rfq.budget ? `$${rfq.budget.toLocaleString()}` : '$150,000',
            deliveryLocation: 'Pune / Mumbai Plant Site',
            status: rfq.quotes && rfq.quotes.length > 0 ? 'under_review' : 'pending_bid',
            lineItems: (rfq.extractedEntities || []).map((ent: ExtractedEntity, idx: number) => ({
              id: ent.id || `item-${idx}`,
              description: ent.itemName,
              quantity: ent.quantity,
              unitPrice: 0,
              leadTimeDays: 14,
              marketBandStatus: 'optimal',
              paymentTerms: '45 Days Net',
            })),
          }));
          setVendorOpportunities(mappedOpps);
        }
        if (d.evaluations && d.evaluations.length > 0) {
          setVendorEvaluations(d.evaluations);
          setSelectedVendorEvaluation((prev) => prev || d.evaluations[0]);
        }
        if (d.auditLogs && d.auditLogs.length > 0) {
          setAuditLogs(d.auditLogs);
        }
        if (d.aiFeed && d.aiFeed.length > 0) {
          setAiFeed(d.aiFeed);
        }
        if (d.systemConfig) {
          setSystemConfig(d.systemConfig);
        }
        setDbConnected(true);
      }
    } catch (err) {
      console.error('Failed to load data from PostgreSQL DB:', err);
      setDbConnected(false);
    } finally {
      setIsLoadingDB(false);
    }
  };

  useEffect(() => {
    refreshFromDB();
  }, []);

  // Integrated Buyer Accounts Management & Public Database Sync
  const addBuyerAccount = (account: Omit<BuyerAccount, 'id' | 'syncTimestamp' | 'createdDate'>): BuyerAccount => {
    const newAcc: BuyerAccount = {
      ...account,
      id: `buyer-acc-${Date.now().toString().slice(-4)}`,
      totalRFQsCreated: 0,
      totalSpend: '$0',
      syncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
      createdDate: new Date().toISOString().substring(0, 10),
    };
    setBuyerAccounts((prev) => [newAcc, ...prev]);

    // Persist to PostgreSQL
    fetch('/api/buyer-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newAcc),
    }).catch((e) => console.error('Failed to save buyer account to DB:', e));

    addAuditLog(`Created buyer account for ${newAcc.organizationName} (${newAcc.corporateEmail}) with source ${newAcc.accountSource}`);
    showToast('Buyer Account Created', `${newAcc.organizationName} registered and added to buyer master database.`, 'success');
    return newAcc;
  };

  const updateBuyerAccount = (id: string, updates: Partial<BuyerAccount>) => {
    const target = buyerAccounts.find((a) => a.id === id);
    const updatedAcc = target
      ? { ...target, ...updates, syncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC' }
      : null;

    setBuyerAccounts((prev) =>
      prev.map((acc) => {
        if (acc.id !== id) return acc;
        return updatedAcc || { ...acc, ...updates };
      })
    );

    if (activeBuyerAccount?.id === id && updatedAcc) {
      setActiveBuyerAccount(updatedAcc);
    }

    if (updatedAcc) {
      fetch('/api/buyer-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedAcc),
      }).catch((e) => console.error('Failed to update buyer account in DB:', e));
    }

    addAuditLog(`Updated account specifications for buyer ID ${id}`);
    showToast('Account Updated', 'Buyer account details successfully saved.', 'info');
  };

  const deleteBuyerAccount = (id: string) => {
    setBuyerAccounts((prev) => prev.filter((acc) => acc.id !== id));
    addAuditLog(`Deleted buyer account record ID ${id}`);
    showToast('Account Removed', 'Buyer account removed from database.', 'info');
  };

  const alignActiveBuyerAccount = (accountId: string) => {
    const acc = buyerAccounts.find((a) => a.id === accountId);
    if (!acc) return;
    setActiveBuyerAccount(acc);
    setCurrentMode(acc.sourcingMode);
    setActiveSubscription(acc.subscriptionPlan);
    setRemainingFreeRFQs(acc.remainingFreeRFQs);
    addAuditLog(`Switched active buyer session context to ${acc.organizationName} (${acc.corporateEmail})`);
    showToast('Session Aligned', `Active session aligned to: ${acc.organizationName} (${acc.corporateEmail})`, 'success');
  };

  const importPublicBuyerDatabase = (accounts: Omit<BuyerAccount, 'id' | 'syncTimestamp' | 'createdDate'>[]): number => {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC';
    const dateStr = new Date().toISOString().substring(0, 10);
    const created: BuyerAccount[] = accounts.map((a, i) => ({
      ...a,
      id: `buyer-acc-sync-${Date.now()}-${i}`,
      totalRFQsCreated: a.totalRFQsCreated || 0,
      totalSpend: a.totalSpend || '$0',
      syncTimestamp: timestamp,
      createdDate: dateStr,
    }));
    setBuyerAccounts((prev) => [...created, ...prev]);

    // Persist batch to DB
    created.forEach((acc) => {
      fetch('/api/buyer-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(acc),
      }).catch((e) => console.error('Failed to sync buyer account to DB:', e));
    });

    addAuditLog(`Synced and imported ${created.length} legacy buyer accounts from Public System Database.`);
    showToast('Database Synced', `${created.length} existing buyer accounts aligned from public system.`, 'success');
    return created.length;
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

  const addVendorEvaluation = (record: VendorEvaluationRecord) => {
    setVendorEvaluations((prev) => [record, ...prev.filter((r) => r.id !== record.id)]);
    fetch('/api/evaluations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    }).catch((e) => console.error('Failed to save evaluation to DB:', e));
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

  // Helper to generate a realistic first-time temporary password
  const generateTempPassword = (name?: string): string => {
    const clean = (name || 'Vendor').replace(/[^a-zA-Z]/g, '').slice(0, 5) || 'Vendor';
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `${clean}@Procucev${rand}#`;
  };

  // Vendor Onboarding Email Generator Engine
  // Vendor Onboarding Email Generator Engine with Highlighted Assigned Categories & Unmapped Fallback
  const generateVendorOnboardingEmail = (
    vendor: VendorEntry,
    isExisting: boolean,
    tempPassword?: string
  ): VendorOnboardingEmailPayload => {
    const buyerCompany = activeBuyerAccount?.organizationName || 'Larsen & Toubro Limited';
    const buyerContact = activeBuyerAccount?.contactPerson || 'Rajesh Sharma (CPO)';
    const buyerEmail = activeBuyerAccount?.corporateEmail || 'client@procucev.com';
    const passwordToUse = tempPassword || vendor.tempPassword || generateTempPassword(vendor.name);
    const emailId = `EML-ONBOARD-${Date.now().toString().slice(-6)}-${vendor.id}`;
    const nextDate = vendor.nextReminderDate || new Date(Date.now() + 3 * 86400000).toISOString().substring(0, 10) + ' (Day 3)';

    const hasMappedCategories = Boolean(
      vendor.majorCategory &&
      vendor.majorCategory !== 'Uncategorized (No Past POs)' &&
      vendor.majorCategory !== '(None Assigned by Buyer)' &&
      vendor.minorCategories &&
      vendor.minorCategories.length > 0
    );

    const assignedMajor = hasMappedCategories ? vendor.majorCategory! : '(None Assigned by Buyer)';
    const assignedMinors = hasMappedCategories ? vendor.minorCategories! : [];

    let subject = '';
    let authInstructions = '';
    let profileUpdateInstructions = '';
    let categoryUpdateInstructions = '';
    let unmappedSelfServiceMessage = '';

    if (!hasMappedCategories) {
      subject = `[Action Required] Set Up Categories: ${buyerCompany} added you to their Preferred Vendor Network`;
      authInstructions = `You have been added by ${buyerContact} from ${buyerCompany} into their private preferred vendor network from their vendor master records. Because no past purchase orders were found in their historical dump, the buyer did not map any product categories for your company. Please log in with your Email ID as User Name and the First-Time Temporary Password provided below. For all subsequent logins, authentication is performed via a 4-digit OTP sent directly to your registered email inbox.`;
      profileUpdateInstructions = `Please log in to complete your enterprise compliance profile (factory specs, GSTIN/PAN, plant location, capacity).`;
      categoryUpdateInstructions = `ATTENTION: The buyer didn't map any categories for you because no historical PO items were found in their purchase dump. Please log in and map your categories yourself across our 13 Major Categories and 280+ Minor Category taxonomy in order to receive enquiries and RFQ opportunities.`;
      unmappedSelfServiceMessage = `The buyer didn't map any categories for you, so please map yourself in order to receive enquiries.`;
    } else if (isExisting) {
      subject = `[Network Association] ${buyerCompany} has added you to their Preferred Vendor Network on Procucev`;
      authInstructions = `A buyer from ${buyerCompany} has associated your verified enterprise profile into their private preferred supplier network. You can sign in using your existing credentials, or use the temporary first-time password (${passwordToUse}), or sign in directly with your registered Email ID and Instant Email OTP.`;
      profileUpdateInstructions = `Please log in to review the buyer association and verify that your plant locations, operational capabilities, and statutory certifications are up to date.`;
      categoryUpdateInstructions = `The buyer (${buyerCompany}) analyzed their past purchase records and mapped your company to the following taxonomy:\n• 1st Set (Primary Major Category): ${assignedMajor}\n• 2nd Set (Minor Categories & Product Lines): ${assignedMinors.join(', ')}\nPlease log in to review, confirm, or expand your category specializations across our 280+ standard minor categories.`;
    } else {
      subject = `[Action Required] Welcome to Procucev: ${buyerCompany} has added you to their Preferred Vendor Network`;
      authInstructions = `You have been added by ${buyerContact} from ${buyerCompany} into their private preferred vendor network based on their past purchase orders. Please log in with your Email ID as User Name and the First-Time Temporary Password provided below. For all subsequent logins, authentication is performed via a 4-digit OTP sent directly to your registered email inbox.`;
      profileUpdateInstructions = `Please log in and complete your enterprise profile, including plant location, turnover, machinery, and statutory tax credentials (GSTIN / PAN).`;
      categoryUpdateInstructions = `The buyer (${buyerCompany}) analyzed their purchase history and assigned your company to:\n• 1st Set (Primary Major Category): ${assignedMajor}\n• 2nd Set (Minor Categories & Product Lines): ${assignedMinors.join(', ')}\nPlease confirm these categories upon login so you receive incoming RFQ invitations matching your product lines.`;
    }

    return {
      emailId,
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
      tempPassword: passwordToUse,
      authInstructions,
      profileUpdateInstructions,
      categoryUpdateInstructions,
      assignedMajorCategory: assignedMajor,
      assignedMinorCategories: assignedMinors,
      assignedSecondaryMajors: hasMappedCategories ? ['Engineering Spares - Electrical', 'Civil Works'] : [],
      reminderScheduleNote: `Automated recurring reminders are scheduled on every 3rd day until your profile completion and category taxonomy updates are confirmed.`,
      dispatchedAt: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
      nextReminderDate: nextDate,
      portalLoginUrl: 'http://localhost:3000',
      shaSignature: generateShaHash(),
      reminderCount: vendor.remindersSentCount || 0,
    };
  };

  const [selectedOnboardingEmail, setSelectedOnboardingEmail] = useState<VendorOnboardingEmailPayload | null>(null);
  const [onboardingEmailModalOpen, setOnboardingEmailModalOpen] = useState<boolean>(false);

  // Initial Setup State & Purchase Data Ingestion
  const [initialSetupModalOpen, setInitialSetupModalOpen] = useState<boolean>(false);
  const [initialSetupCompleted, setInitialSetupCompleted] = useState<boolean>(false);
  const [historicalPurchaseDataPeriod, setHistoricalPurchaseDataPeriod] = useState<'1_year' | '2_years' | '3_years'>('1_year');

  const processHistoricalPurchaseData = (
    period: '1_year' | '2_years' | '3_years',
    vendors: HistoricalPurchaseVendorRecord[]
  ): number => {
    const buyerCompany = activeBuyerAccount?.organizationName || 'Larsen & Toubro Limited';
    const buyerContact = activeBuyerAccount?.contactPerson || 'Rajesh Sharma (CPO)';
    const nextDate = new Date(Date.now() + 3 * 86400000).toISOString().substring(0, 10) + ' (Day 3)';
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC';

    let existingInDbCount = 0;
    let newVendorsCount = 0;
    let mappedCount = 0;
    let unmappedCount = 0;

    const newEntries: VendorEntry[] = vendors.map((v, i) => {
      const isExisting = checkVendorInPlatformDatabase(v);
      if (isExisting) existingInDbCount++;
      else newVendorsCount++;

      if (v.categoriesMappedByBuyer) mappedCount++;
      else unmappedCount++;

      const tempPassword = v.tempPassword || generateTempPassword(v.companyName);

      return {
        id: `v-hist-${Date.now()}-${i}`,
        name: v.companyName,
        contactPerson: v.contactPerson || 'Sales & Accounts Manager',
        email: v.email,
        phone: v.phone,
        location: v.address,
        majorCategory: v.categoriesMappedByBuyer ? (v.firstSetMajorCategory || 'Engineering Spares - Mechanical') : 'Uncategorized (No Past POs)',
        minorCategories: v.categoriesMappedByBuyer && v.secondSetMinorCategories && v.secondSetMinorCategories.length > 0 ? v.secondSetMinorCategories : [],
        rating: v.vendorRatingScore ? Number((v.vendorRatingScore / 20).toFixed(1)) : 4.5,
        score: v.vendorRatingScore || null,
        source: 'buyer_excel',
        status: v.vendorRatingScore && v.vendorRatingScore >= 80 ? 'PREFERRED ENTERPRISE SUPPLIER' : 'REGISTERED / NOT EVALUATED',
        evaluated: !!v.vendorRatingScore,
        hasRecord: true,
        isExistingInDatabase: isExisting,
        onboardingEmailStatus: 'sent',
        onboardingEmailDispatchedAt: timestamp,
        tempPassword,
        firstLoginCompleted: false,
        reminderCadence: 'every_3_days',
        nextReminderDate: nextDate,
        remindersSentCount: 0,
        addedByBuyerCompany: buyerCompany,
        addedByBuyerName: buyerContact,
        profileCompletionStatus: 'pending',
      };
    });

    setBuyerVendors((prev) => [...newEntries, ...prev]);
    setInitialSetupCompleted(true);
    setInitialSetupModalOpen(false);

    const periodLabel = period === '1_year' ? 'Last 1 Year (12 Months)' : period === '2_years' ? 'Last 2 Years (24 Months)' : 'Last 3 Years (36 Months)';

    addFeedItem(
      `Historical Purchase & Vendor Master Ingestion Complete: ${newEntries.length} Vendors`,
      `Processed separate Vendor Master & ${periodLabel} PO dumps. ${mappedCount} suppliers categorized into 1st/2nd sets. ${unmappedCount} suppliers notified to self-map categories. Onboarding credentials dispatched.`,
      'invitation',
      undefined,
      `${newEntries.length} Ingested Vendors`,
      'email'
    );

    addAuditLog(
      `Ingested separate Vendor Master & ${periodLabel} PO files (${newEntries.length} total: ${mappedCount} PO-mapped, ${unmappedCount} self-mapping required). Dispatched onboarding emails with credentials & category notifications.`
    );

    showToast(
      'Initial Setup Completed',
      `Processed ${periodLabel} PO dump & Vendor Master. ${mappedCount} categorized, ${unmappedCount} requested to self-map.`,
      'success'
    );

    return newEntries.length;
  };

  const openOnboardingEmailModal = (vendor: VendorEntry) => {
    const isExisting = vendor.isExistingInDatabase ?? checkVendorInPlatformDatabase(vendor);
    const payload = generateVendorOnboardingEmail(vendor, isExisting, vendor.tempPassword);
    setSelectedOnboardingEmail(payload);
    setOnboardingEmailModalOpen(true);
  };

  const triggerVendorReminder = (vendorId: string) => {
    const targetVendor = buyerVendors.find((v) => v.id === vendorId);
    if (!targetVendor) return;

    const nextCount = (targetVendor.remindersSentCount || 0) + 1;
    const dayNumber = nextCount * 3;
    const nextDate = new Date(Date.now() + 3 * 86400000).toISOString().substring(0, 10) + ` (Day ${dayNumber + 3})`;

    setBuyerVendors((prev) =>
      prev.map((v) =>
        v.id === vendorId
          ? {
              ...v,
              remindersSentCount: nextCount,
              nextReminderDate: nextDate,
            }
          : v
      )
    );

    addFeedItem(
      `Every-3rd-Day Reminder Dispatched: ${targetVendor.name}`,
      `Automated Day-${dayNumber} profile & category update reminder email dispatched to ${targetVendor.email} on behalf of ${targetVendor.addedByBuyerCompany || 'Larsen & Toubro Limited'}.`,
      'reminder',
      undefined,
      targetVendor.name,
      'email'
    );

    addAuditLog(
      `Dispatched automated Day-${dayNumber} profile & category reminder email to ${targetVendor.name} (${targetVendor.email})`,
      undefined,
      targetVendor.email
    );

    showToast(
      'Day-3 Reminder Sent',
      `Sent Day ${dayNumber} profile & category reminder to ${targetVendor.email}. Next reminder: Day ${dayNumber + 3}.`,
      'info'
    );
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
        if (v.email.toLowerCase() === email.toLowerCase() || v.name.toLowerCase().includes('apex')) {
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

    addFeedItem(
      `Vendor Category Reconciliation Saved: ${email}`,
      `Client Mapped: [${clientCats.join(', ')}] | Vendor Selected (Max 10): [${limitedVendorCats.join(', ')}]. ${isAligned ? 'Status: 100% Aligned.' : `Status: Dual-Stream Stored (${common.length} matching, ${vendorOnly.length} vendor-extended). RFQs will be dispatched across both sets.`}`,
      'system',
      undefined,
      email,
      'system'
    );

    addAuditLog(
      `Vendor Category Taxonomy Updated for ${email}: Client Mapped (${clientCats.length}) vs Vendor Selected (${limitedVendorCats.length}). Alignment Status: ${isAligned ? 'ALIGNED' : 'DISCREPANCY PRESERVED (Both Streams Saved)'}`,
      undefined,
      email
    );

    showToast(
      isAligned ? 'Categories Aligned & Saved' : 'Dual Categories Saved & Reconciled',
      isAligned
        ? `Both client mapped and vendor profile categories match (${common.length} categories).`
        : `Stored both Client Mapped (${clientCats.length}) and Vendor Profile (${limitedVendorCats.length}) categories. RFQs will be routed across both sets!`,
      'success'
    );
  };

  const completeVendorProfile = (vendorEmail: string, updatedCategories?: string[]) => {
    if (updatedCategories && updatedCategories.length > 0) {
      saveVendorProfileCategories(vendorEmail, clientMappedCategories, updatedCategories);
      return;
    }

    setBuyerVendors((prev) =>
      prev.map((v) =>
        v.email.toLowerCase() === vendorEmail.toLowerCase()
          ? {
              ...v,
              profileCompletionStatus: 'completed',
              firstLoginCompleted: true,
              minorCategories: updatedCategories || v.minorCategories,
            }
          : v
      )
    );

    addFeedItem(
      `Vendor Profile & Taxonomy Updated: ${vendorEmail}`,
      `Supplier updated minor category specializations and compliance credentials. Automated 3-day reminder schedule terminated.`,
      'system',
      undefined,
      vendorEmail,
      'system'
    );

    addAuditLog(`Vendor ${vendorEmail} completed category taxonomy & compliance profile update.`);
    showToast('Profile Updated', `Supplier profile & minor categories verified. 3-day reminders deactivated.`, 'success');
  };

  const [selectedRatingRevisionEmail, setSelectedRatingRevisionEmail] = useState<VendorRatingRevisionEmailPayload | null>(null);
  const [ratingRevisionEmailModalOpen, setRatingRevisionEmailModalOpen] = useState<boolean>(false);

  const openRatingRevisionEmailModal = (revision: VendorRatingRevisionRecord) => {
    setSelectedRatingRevisionEmail({
      vendorName: revision.vendorName,
      vendorEmail: revision.buyerEmail ? 'rajesh@apexsupplies.in' : 'vendor@apex.com',
      vendorContactPerson: 'Rajesh Nair',
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

  const reviseVendorRating = (
    vendorId: string,
    qualityScore: number,
    costScore: number,
    deliveryScore: number,
    remarks: string
  ): VendorRatingRevisionRecord => {
    const buyerCompany = activeBuyerAccount?.organizationName || 'Larsen & Toubro Limited';
    const buyerName = activeBuyerAccount?.contactPerson || 'Rajesh Sharma (CPO)';
    const buyerEmail = activeBuyerAccount?.corporateEmail || 'buyer@procucev.com';
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC';

    // 1. Calculate Buyer Input Average across Quality, Cost, Delivery
    const buyerAverage = Math.round((qualityScore + costScore + deliveryScore) / 3);

    // 2. Find target vendor and calculate composite average with actual existing rating
    const targetVendor = buyerVendors.find((v) => v.id === vendorId) || buyerVendors[0];
    const previousScore = targetVendor?.score || (targetVendor?.rating ? Math.round(targetVendor.rating * 20) : 88);
    const previousRating = targetVendor?.rating || Number((previousScore / 20).toFixed(1));

    // 3. Average between buyer evaluation and actual vendor rating
    const newCompositeScore = Math.round((previousScore + buyerAverage) / 2);
    const newRating = Number((newCompositeScore / 20).toFixed(1));
    const newStatus = newCompositeScore >= 80 ? 'PREFERRED ENTERPRISE SUPPLIER' : 'CONDITIONAL / UNDER REVIEW';

    const shaSignature = '0xREV' + Math.random().toString(36).substring(2, 10).toUpperCase() + Date.now().toString(36).toUpperCase();

    const revisionRecord: VendorRatingRevisionRecord = {
      id: `rev-${Date.now()}`,
      vendorId: targetVendor?.id || vendorId,
      vendorName: targetVendor?.name || 'Apex Supplies Ltd.',
      buyerCompany,
      buyerName,
      buyerEmail,
      timestamp,
      qualityScore,
      costScore,
      deliveryScore,
      buyerAverage,
      previousScore,
      newCompositeScore,
      previousRating,
      newRating,
      remarks: remarks.trim() || 'Quarterly operational performance review & ratings alignment.',
      emailDispatched: true,
      shaSignature,
    };

    // Update in buyerVendors list (accessible across all buyer accounts & directories)
    const updatedTargetVendor: VendorEntry = {
      ...targetVendor,
      rating: newRating,
      score: newCompositeScore,
      status: newStatus,
      latestRatingRevision: revisionRecord,
      ratingRevisionHistory: [revisionRecord, ...(targetVendor?.ratingRevisionHistory || [])],
    };

    setBuyerVendors((prev) =>
      prev.map((v) => {
        if (v.id === vendorId || v.name === targetVendor?.name) {
          return updatedTargetVendor;
        }
        return v;
      })
    );

    // Persist rating revision to PostgreSQL
    fetch('/api/vendors', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'rating_revision',
        vendor: updatedTargetVendor,
        revision: revisionRecord,
      }),
    }).catch((e) => console.error('Failed to save rating revision to DB:', e));

    // Update in vendorEvaluations list as well
    setVendorEvaluations((prev) =>
      prev.map((e) => {
        if (e.vendorId === vendorId || e.vendorName === targetVendor?.name) {
          const modScores = e.moduleScores || {
            commercial: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
            technical: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
            quality: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
            delivery: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
            financial: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
            governance: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
          };
          return {
            ...e,
            overallScore: newCompositeScore,
            status: newStatus,
            moduleScores: {
              ...modScores,
              quality: { ...modScores.quality, score: Number((qualityScore / 20).toFixed(1)), remarks: `Buyer Score: ${qualityScore}/100` },
              commercial: { ...modScores.commercial, score: Number((costScore / 20).toFixed(1)), remarks: `Buyer Score: ${costScore}/100` },
              delivery: { ...modScores.delivery, score: Number((deliveryScore / 20).toFixed(1)), remarks: `Buyer Score: ${deliveryScore}/100` },
            },
          };
        }
        return e;
      })
    );

    // AI Bot Feed item
    addFeedItem(
      `Vendor Rating Revised: ${targetVendor?.name}`,
      `Buyer ${buyerName} (${buyerCompany}) revised performance rating. Quality: ${qualityScore}/100, Cost: ${costScore}/100, Delivery: ${deliveryScore}/100 (Buyer Avg: ${buyerAverage}%). New Platform Aggregate Rating: ${newRating} / 5.0 (${newCompositeScore}%). Remarks: "${remarks}". Notification email dispatched to ${targetVendor?.email}.`,
      'system',
      undefined,
      targetVendor?.name,
      'email'
    );

    // Immutable Audit Log
    addAuditLog(
      `Buyer Rating Revision for ${targetVendor?.name}: Q=${qualityScore}, C=${costScore}, D=${deliveryScore} (Buyer Avg: ${buyerAverage}%). Previous: ${previousScore}% (${previousRating}★) -> New Composite: ${newCompositeScore}% (${newRating}★). Remarks: "${remarks}". Dispatched notification email to ${targetVendor?.email}.`,
      undefined,
      buyerEmail
    );

    // Set email payload and open preview modal
    setSelectedRatingRevisionEmail({
      vendorName: targetVendor?.name || 'Apex Supplies Ltd.',
      vendorEmail: targetVendor?.email || 'rajesh@apexsupplies.in',
      vendorContactPerson: targetVendor?.contactPerson || 'Rajesh Nair',
      buyerCompany,
      buyerContactName: buyerName,
      buyerContactEmail: buyerEmail,
      dispatchedAt: timestamp,
      qualityScore,
      costScore,
      deliveryScore,
      buyerAverage,
      previousScore,
      newCompositeScore,
      newRating,
      remarks: remarks.trim() || 'Quarterly operational performance review & ratings alignment.',
      shaSignature,
    });
    setRatingRevisionEmailModalOpen(true);

    showToast(
      'Vendor Rating Revised & Email Dispatched',
      `Updated ${targetVendor?.name} rating to ${newRating}★ (${newCompositeScore}%). Performance notification email dispatched.`,
      'success'
    );

    return revisionRecord;
  };

  // Buyer Vendor Management with Automated Database Verification & Email Dispatch
  const addBuyerVendor = (vendor: Omit<VendorEntry, 'id'>): VendorEntry => {
    const isExisting = checkVendorInPlatformDatabase(vendor);
    const tempPassword = generateTempPassword(vendor.name);
    const buyerCompany = activeBuyerAccount?.organizationName || 'Larsen & Toubro Limited';
    const buyerName = activeBuyerAccount?.contactPerson || 'Rajesh Sharma (CPO)';
    const nextDate = new Date(Date.now() + 3 * 86400000).toISOString().substring(0, 10) + ' (Day 3)';

    const newV: VendorEntry = {
      ...vendor,
      id: `v-${Date.now()}`,
      source: vendor.source || 'buyer_manual',
      isExistingInDatabase: isExisting,
      onboardingEmailStatus: 'sent',
      onboardingEmailDispatchedAt: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
      tempPassword,
      firstLoginCompleted: false,
      reminderCadence: 'every_3_days',
      nextReminderDate: nextDate,
      remindersSentCount: 0,
      addedByBuyerCompany: buyerCompany,
      addedByBuyerName: buyerName,
      profileCompletionStatus: 'pending',
    };

    setBuyerVendors((prev) => [newV, ...prev]);

    // Dispatch Feed & Audit Log
    addFeedItem(
      isExisting
        ? `Existing Supplier Added: ${newV.name}`
        : `New Supplier Onboarding Dispatched: ${newV.name}`,
      isExisting
        ? `Supplier exists in Procucev database. Association email dispatched to ${newV.email} with credentials (temp password: ${tempPassword}) and scheduled every 3rd day profile reminders.`
        : `Supplier is NOT in database. Welcome onboarding invitation dispatched to ${newV.email} with first-time temporary password (${tempPassword}) and scheduled every 3rd day profile reminders.`,
      'invitation',
      undefined,
      newV.name,
      'email'
    );

    addAuditLog(
      `Added vendor ${newV.name} (${newV.email}) — ${isExisting ? 'Existing in DB' : 'New Vendor'}; Dispatched onboarding email with first-time login credentials & 3-day reminder schedule.`
    );

    showToast(
      isExisting ? 'Existing Vendor Associated' : 'New Vendor Added & Invited',
      isExisting
        ? `${newV.name} is in our database. Network association email sent to ${newV.email} with login details.`
        : `${newV.name} is new to Procucev. Invitation email sent to ${newV.email} with temporary password and OTP instructions.`,
      'success'
    );

    return newV;
  };

  const importBuyerVendors = (vendorsToImport: Omit<VendorEntry, 'id'>[]): number => {
    const buyerCompany = activeBuyerAccount?.organizationName || 'Larsen & Toubro Limited';
    const buyerName = activeBuyerAccount?.contactPerson || 'Rajesh Sharma (CPO)';
    const nextDate = new Date(Date.now() + 3 * 86400000).toISOString().substring(0, 10) + ' (Day 3)';
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC';

    let existingCount = 0;
    let newCount = 0;

    const created: VendorEntry[] = vendorsToImport.map((v, i) => {
      const isExisting = checkVendorInPlatformDatabase(v);
      if (isExisting) existingCount++;
      else newCount++;
      const tempPassword = generateTempPassword(v.name);

      return {
        ...v,
        id: `v-bulk-${Date.now()}-${i}`,
        source: 'buyer_excel',
        rating: v.rating || 4.5,
        isExistingInDatabase: isExisting,
        onboardingEmailStatus: 'sent',
        onboardingEmailDispatchedAt: timestamp,
        tempPassword,
        firstLoginCompleted: false,
        reminderCadence: 'every_3_days',
        nextReminderDate: nextDate,
        remindersSentCount: 0,
        addedByBuyerCompany: buyerCompany,
        addedByBuyerName: buyerName,
        profileCompletionStatus: 'pending',
      };
    });

    setBuyerVendors((prev) => [...created, ...prev]);

    addFeedItem(
      `Batch Vendor Upload: ${created.length} Suppliers Processed`,
      `Verified against Procucev Database: ${existingCount} Existing Suppliers + ${newCount} New Unregistered Suppliers. Onboarding emails with temporary passwords, OTP instructions, and 3-day reminder schedules dispatched to all.`,
      'invitation',
      undefined,
      `${created.length} Vendors`,
      'email'
    );

    addAuditLog(
      `Imported ${created.length} vendors via Excel (${existingCount} existing in database, ${newCount} new); Dispatched onboarding emails with login credentials and every-3-day reminder pipelines.`
    );

    showToast(
      'Vendors Processed & Emails Dispatched',
      `${created.length} vendors processed (${existingCount} in DB, ${newCount} new). Onboarding emails & 3-day reminders active.`,
      'success'
    );

    return created.length;
  };

  const deleteBuyerVendor = (vendorId: string) => {
    setBuyerVendors((prev) => prev.filter((v) => v.id !== vendorId));
    addAuditLog(`Removed vendor record ID ${vendorId} from buyer vendor master.`);
    showToast('Vendor Removed', 'Vendor deleted from directory.', 'info');
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

    const isCategoryMatch = (v: VendorEntry) => {
      const vMajor = (v.majorCategory || '').toLowerCase();
      
      // Dual-Stream resolution
      const clientMapped = (v.clientMappedCategories && v.clientMappedCategories.length > 0 
        ? v.clientMappedCategories 
        : (v.email.includes('apex') ? clientMappedCategories : v.minorCategories || [])).map(m => m.toLowerCase().trim());
        
      const vendorSelected = (v.vendorSelectedCategories && v.vendorSelectedCategories.length > 0 
        ? v.vendorSelectedCategories 
        : (v.email.includes('apex') ? vendorSelectedCategories : [])).map(m => m.toLowerCase().trim());
      
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
          v.categoryMatchSource = 'Aligned Buyer & Vendor Category Match';
        } else if (isClientMappedMatch) {
          v.categoryMatchSource = 'Buyer Empanelled Category Match';
        } else {
          v.categoryMatchSource = 'Vendor Profile Self-Declared Category Match';
        }
        return true;
      }

      const hasMajorMatch = targetMajorCategories.some(tMaj => 
        vMajor.includes(tMaj) || tMaj.includes(vMajor)
      );
      if (hasMajorMatch) return true;

      return entities.some(e => {
        const itemLower = (e.itemName + ' ' + (e.technicalSpecs || '')).toLowerCase();
        return allMinors.some(m => itemLower.includes(m)) || (vMajor && itemLower.includes(vMajor));
      });
    };

    if (mode === 'mode_1') {
      const matched = vendorPool.filter(v => 
        (v.source === 'buyer_manual' || v.source === 'buyer_excel' || v.source === 'manual' || v.source === 'excel') &&
        isCategoryMatch(v)
      );
      return (matched.length > 0 ? matched : vendorPool.slice(0, 3)).map(v => {
        const loc = v.location || '';
        return {
          ...v,
          matchReason: 'Buyer Approved Roster (Minor Category Match)',
          proximity: loc.includes('MH') || loc.includes('Mumbai') || loc.includes('Pune') ? 'Local Hub (<250km)' : 'Regional Hub (<600km)',
          proximityMatch: true,
        };
      });
    } else if (mode === 'mode_2') {
      const matchedBuyer = vendorPool.filter(v => isCategoryMatch(v)).map(v => {
        const loc = v.location || '';
        return {
          ...v,
          matchReason: 'Buyer Roster (Minor Category Match)',
          proximity: loc.includes('MH') || loc.includes('Mumbai') || loc.includes('Pune') ? 'Local Hub (<250km)' : 'Regional Hub (<600km)',
          proximityMatch: true,
        };
      });

      const networkVendors: VendorEntry[] = [
        { id: 'v-net-1', name: 'Global Pipe Solutions', contactPerson: 'John Doe', email: 'john@globalpipes.com', phone: '+1 415 555 2671', majorCategory: 'Engineering Spares - Mechanical', minorCategories: ['Pipes & Pipe Fittings', 'Hoses, Valves & Fittings'], location: 'Houston, TX', rating: 4.5, source: 'procucev_network' as const, matchReason: 'Procucev Base Network (Minor Category Match)', proximity: 'International / US Hub', proximityMatch: false },
        { id: 'v-net-2', name: 'Titanium Castings Corp', contactPerson: 'Sarah Jenkins', email: 'sarah@titaniumcast.com', phone: '+44 20 7946 0958', majorCategory: 'Engineering Spares - Mechanical', minorCategories: ['Machinery Parts', 'Customised Parts'], location: 'Sheffield, UK', rating: 4.7, source: 'procucev_network' as const, matchReason: 'Procucev Base Network (Minor Category Match)', proximity: 'International / UK Hub', proximityMatch: false },
      ].filter(v => isCategoryMatch(v));

      const combined = [...matchedBuyer, ...networkVendors];
      const rawList = combined.length > 0 ? combined : vendorPool.slice(0, 4);
      const seen = new Set<string>();
      const deduplicated = rawList.filter((v) => {
        const key = (v.email || v.name).toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // 1st Priority Rule: Evaluated vendors are given first priority automatically irrespective of rating
      return deduplicated.sort((a, b) => {
        const aEval = Boolean(a.rating || a.name.includes('Apex'));
        const bEval = Boolean(b.rating || b.name.includes('Apex'));
        if (aEval && !bEval) return -1;
        if (!aEval && bEval) return 1;
        return 0;
      });
    } else {
      const matched = vendorPool.filter(v => 
        (v.source === 'buyer_manual' || v.source === 'buyer_excel' || v.source === 'manual' || v.source === 'excel') &&
        isCategoryMatch(v)
      );
      const rawList = (matched.length > 0 ? matched : vendorPool.slice(0, 3)).map(v => {
        const loc = v.location || '';
        return {
          ...v,
          matchReason: 'Buyer Approved Roster (360° Qualification & RFQ)',
          proximity: loc.includes('MH') || loc.includes('Mumbai') || loc.includes('Pune') ? 'Local Hub (<250km)' : 'Regional Hub (<600km)',
          proximityMatch: true,
        };
      });
      const seen = new Set<string>();
      const deduplicated = rawList.filter((v) => {
        const key = (v.email || v.name).toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // 1st Priority Rule: Evaluated vendors are given first priority automatically irrespective of rating
      return deduplicated.sort((a, b) => {
        const aEval = Boolean(a.rating || a.name.includes('Apex'));
        const bEval = Boolean(b.rating || b.name.includes('Apex'));
        if (aEval && !bEval) return -1;
        if (!aEval && bEval) return 1;
        return 0;
      });
    }
  };

  // Standard RFQ Email Generator Engine
  const generateStandardRFQEmail = (rfq: RFQItem, vendor: VendorEntry): StandardRFQEmailPayload => {
    const modeDetail = SOURCING_MODES.find(m => m.id === rfq.sourcingMode) || SOURCING_MODES[0];
    const emailId = `EML-${rfq.rfqNumber}-${vendor.id || Date.now()}`;
    const shaSignature = generateShaHash();
    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' IST';
    const major = vendor.majorCategory || rfq.extractedEntities[0]?.majorCategory || rfq.category || 'Industrial Procurement';
    const minors = vendor.minorCategories && vendor.minorCategories.length > 0 
      ? vendor.minorCategories 
      : rfq.extractedEntities.map(e => e.minorCategory || e.category).filter(Boolean);

    let specialInstructions = '';
    if (rfq.sourcingMode === 'mode_1') {
      specialInstructions = 'Strict Single-Roster Submission: As an approved enterprise partner in our private roster, please submit your competitive line-item quotation directly against the enclosed BOQ. Pre-negotiated corporate rates & frame agreements apply.';
    } else if (rfq.sourcingMode === 'mode_2') {
      specialInstructions = 'Hybrid Competitive Sourcing: Your quotation will be benchmarked side-by-side on unit prices, verified lead time, and warranty terms. Pre-negotiated payment terms (Net 30/60) apply.';
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
      buyerCompany: 'Larsen & Toubro Limited (Heavy Engineering)',
      buyerContactName: 'Rajesh Sharma (CPO)',
      buyerContactEmail: 'buyer@procucev.com',
      buyerContactPhone: '+91 98201 44820',
      recipientVendorName: vendor.name,
      recipientContactPerson: vendor.contactPerson,
      recipientEmail: vendor.email,
      subject: `[RFQ Invitation] ${rfq.rfqNumber}: ${rfq.title} | Larsen & Toubro Sourcing (${modeDetail.code})`,
      matchedMajorCategory: major,
      matchedMinorCategories: minors,
      requisitionDate: rfq.createdAt || new Date().toISOString().slice(0, 10),
      submissionDeadline: rfq.targetDeliveryDate,
      targetDeliveryDate: rfq.targetDeliveryDate,
      deliveryLocation: 'Enterprise Logistics Hub (Navi Mumbai CIF Site)',
      paymentTerms: 'Net 30 / 60 Days from Inspection & Acceptance',
      lineItems: rfq.extractedEntities.map((e, idx) => ({
        itemNumber: idx + 1,
        itemName: e.itemName,
        technicalSpecs: e.technicalSpecs,
        quantity: e.quantity,
        unit: e.unit,
        minorCategory: e.minorCategory || 'General Industrial Item',
        targetDate: e.targetDate,
      })),
      specialInstructions,
      complianceChecklist: [
        'Mandatory GST Tax Invoice with HSN / SAC breakdown',
        'Manufacturer Test Certificate (MTC) / Certificate of Analysis (COA)',
        'Minimum 24 to 36 Months Comprehensive Warranty Undertaking',
        'Guaranteed Delivery SLA commitment with transit insurance included',
        rfq.sourcingMode === 'mode_3' ? 'Mandatory ISO 9001:2015 & Statutory KYC documents upload' : 'Roster Compliance verification',
      ],
      replyInstructions: 'Please reply directly to this RFQ email with your quotation attachment (PDF/Excel). DO NOT alter or change the subject line to ensure automated AI parsing into the comparative matrix.',
      replyToEmail: 'client@procucev.com',
      shaSignature,
      dispatchedAt: timeNow,
    };
  };

  const openStandardEmailModal = (rfq: RFQItem, vendor?: VendorEntry) => {
    const targetVendor = vendor || buyerVendors.find(v => v.name === rfq.followUpData?.vendors[0]?.vendorName) || buyerVendors[0];
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

  const addAuditLog = (action: string, rfqNumber?: string, user?: string) => {
    const defaultUser =
      currentRole === 'buyer'
        ? 'client@procucev.com (Enterprise Buyer)'
        : currentRole === 'category_manager'
        ? 'catmanager@procucev.com (Category Manager)'
        : currentRole === 'vendor'
        ? 'vendor@apex.com (Apex Supplies Ltd.)'
        : 'admin@procucev.com (System Admin)';

    const newLog: AuditLogEntry = {
      id: `aud-${Date.now()}`,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
      user: user || defaultUser,
      action,
      rfqNumber,
      shaSignature: generateShaHash(),
      status: 'VERIFIED',
      ipAddress: '104.42.189.44',
    };
    setAuditLogs((prev) => [newLog, ...prev]);

    fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newLog),
    }).catch((e) => console.error('Failed to save audit log to DB:', e));
  };

  const addFeedItem = (
    title: string,
    message: string,
    type: AIBotFeedItem['type'],
    rfqNumber?: string,
    recipient?: string,
    channel?: 'call' | 'whatsapp' | 'sms' | 'email' | 'system',
    channelDetails?: AIBotFeedItem['channelDetails']
  ) => {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const newFeed: AIBotFeedItem = {
      id: `feed-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: timeStr,
      timeAgo: 'Just now',
      type,
      channel: channel || (type === 'call' || type === 'whatsapp' || type === 'sms' || type === 'email' ? type : undefined),
      title,
      message,
      recipient,
      rfqNumber,
      status: 'completed',
      channelDetails,
    };
    setAiFeed((prev) => [newFeed, ...prev]);

    fetch('/api/ai-feed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newFeed),
    }).catch((e) => console.error('Failed to save AI feed item to DB:', e));
  };

  const triggerChannelChaser = (
    rfqNumber: string,
    channel: 'call' | 'whatsapp' | 'sms' | 'email',
    vendorName = 'Apex Supplies Ltd.',
    customNote?: string
  ) => {
    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let title = '';
    let message = '';
    let toastTitle = '';
    let toastDesc = '';

    if (channel === 'call') {
      title = `AI Voice Bot Call Dispatched`;
      message = `Autonomous AI Voice Agent placed telephonic outreach to ${vendorName} for ${rfqNumber}. Line connected; confirmed quote turnaround SLA.`;
      toastTitle = `AI Voice Call Initiated!`;
      toastDesc = `Outbound phone call connected to ${vendorName} for ${rfqNumber}.`;
    } else if (channel === 'whatsapp') {
      title = `WhatsApp Interactive Chaser Dispatched`;
      message = `Automated WhatsApp quotation prompt with 1-click bid link delivered to ${vendorName} for ${rfqNumber}.`;
      toastTitle = `WhatsApp Chaser Sent!`;
      toastDesc = `Vendor accessed the interactive 1-click bid link.`;
    } else if (channel === 'sms') {
      title = `Priority SMS Notice Dispatched`;
      message = `DLT-verified priority SMS alert sent to ${vendorName} for ${rfqNumber}.`;
      toastTitle = `SMS Alert Dispatched!`;
      toastDesc = `Priority SMS notice delivered to ${vendorName}.`;
    } else {
      title = `24h Escalation Email Sent`;
      message = `Standard RFQ reminder email with BOQ re-attached delivered to ${vendorName}.`;
      toastTitle = `24h Email Reminder Sent!`;
      toastDesc = `Escalation notice with BOQ specs delivered to ${vendorName}.`;
    }

    if (customNote) {
      message += ` (Note: "${customNote}")`;
    }

    addFeedItem(title, message, channel, rfqNumber, vendorName, channel, {
      duration: channel === 'call' ? '1m 30s' : undefined,
      transcriptSummary: channel === 'call' ? `Vendor confirmed RFQ receipt and will submit bid before deadline.` : undefined,
      actionOutcome: channel === 'whatsapp' ? 'Link delivered' : channel === 'sms' ? 'Carrier delivered' : channel === 'email' ? 'BOQ Specs re-attached · Immediate bid requested' : 'Voice connected',
    });

    addAuditLog(
      `Triggered ${channel.toUpperCase()} automated follow-up for ${rfqNumber} to ${vendorName}`,
      rfqNumber
    );

    setRfqs((prev) =>
      prev.map((r) => {
        if (r.rfqNumber === rfqNumber && r.followUpData) {
          const updatedVendors = r.followUpData.vendors.map((v) => {
            if (v.vendorName.toLowerCase().includes(vendorName.toLowerCase()) || vendorName.toLowerCase().includes(v.vendorName.toLowerCase())) {
              return {
                ...v,
                attemptsCount: v.attemptsCount + 1,
                lastInteraction: timeNow,
                overallStatus: 'Follow-up Active' as const,
                call: channel === 'call' ? {
                  ...v.call,
                  status: 'completed' as const,
                  lastAttempt: timeNow,
                  duration: '1m 30s',
                  summary: 'AI Voice Call connected with sales coordinator. Acknowledged RFQ requirements.',
                } : v.call,
                whatsapp: channel === 'whatsapp' ? {
                  ...v.whatsapp,
                  status: 'read' as const,
                  lastAttempt: timeNow,
                  messagePreview: 'Urgent RFQ follow-up link delivered.',
                  linkClicked: true,
                } : v.whatsapp,
                sms: channel === 'sms' ? {
                  ...v.sms,
                  status: 'delivered' as const,
                  lastAttempt: timeNow,
                } : v.sms,
                email24h: channel === 'email' ? {
                  status: 'reminded_24h' as const,
                  lastAttempt: timeNow,
                  is24hReminderSent: true,
                  subject: `URGENT REMINDER: Quotation Request for ${rfqNumber}`,
                } : v.email24h,
              };
            }
            return v;
          });

          const callTotal = channel === 'call' ? r.followUpData.callStats.total + 1 : r.followUpData.callStats.total;
          const callConnected = channel === 'call' ? r.followUpData.callStats.connected + 1 : r.followUpData.callStats.connected;
          const waTotal = channel === 'whatsapp' ? r.followUpData.whatsappStats.total + 1 : r.followUpData.whatsappStats.total;
          const waDelivered = channel === 'whatsapp' ? r.followUpData.whatsappStats.delivered + 1 : r.followUpData.whatsappStats.delivered;
          const waRead = channel === 'whatsapp' ? r.followUpData.whatsappStats.read + 1 : r.followUpData.whatsappStats.read;
          const smsTotal = channel === 'sms' ? r.followUpData.smsStats.total + 1 : r.followUpData.smsStats.total;
          const smsDelivered = channel === 'sms' ? r.followUpData.smsStats.delivered + 1 : r.followUpData.smsStats.delivered;
          const emailSent24h = channel === 'email' ? (r.followUpData.emailStats?.sent24h || 0) + 1 : (r.followUpData.emailStats?.sent24h || 0);

          const updatedRfq = {
            ...r,
            followUpData: {
              ...r.followUpData,
              callStats: { ...r.followUpData.callStats, total: callTotal, connected: callConnected },
              whatsappStats: { ...r.followUpData.whatsappStats, total: waTotal, delivered: waDelivered, read: waRead },
              smsStats: { ...r.followUpData.smsStats, total: smsTotal, delivered: smsDelivered },
              emailStats: { total: r.followUpData.emailStats?.total || 5, sent24h: emailSent24h, opened: (r.followUpData.emailStats?.opened || 1) },
              vendors: updatedVendors,
            },
          };

          setSelectedRFQForDeepDive((cur) => (cur && cur.rfqNumber === rfqNumber ? updatedRfq : cur));
          return updatedRfq;
        }
        return r;
      })
    );

    showToast(toastTitle, toastDesc, 'success');
  };

  const triggerBatchChannelChaser = (rfqNumber: string, channels: ('call' | 'whatsapp' | 'sms')[]) => {
    channels.forEach((ch) => {
      triggerChannelChaser(rfqNumber, ch, 'All Pending Suppliers');
    });
    showToast(
      'Multi-Channel Batch Broadcast Active!',
      `AI chasing dispatched across ${channels.map((c) => c.toUpperCase()).join(' + ')} for ${rfqNumber}.`,
      'success'
    );
  };

  const triggerWhatsAppChaser = (rfqNumber: string, vendorName = 'Apex Supplies Ltd.') => {
    triggerChannelChaser(rfqNumber, 'whatsapp', vendorName);
  };

  const submitVendorBid = (
    rfqNumber: string,
    unitPrice: number,
    leadTimeDays: number,
    remarks: string
  ) => {
    const newQuote: QuoteComparison = {
      vendorId: `v-${Date.now()}`,
      vendorName: 'Apex Supplies Ltd. (Verified)',
      vendorCategory: 'Procucev - AI Rec',
      unitPrice,
      totalPrice: unitPrice * 12,
      leadTimeDays,
      aiMatchScore: 95,
      isBestPrice: true,
      isPreferred: true,
      warrantyYears: 3,
      complianceStatus: 'Fully Compliant',
      paymentTerms: 'Net 30 Days',
      remarks,
    };

    setRfqs((prev) =>
      prev.map((r) => {
        if (r.rfqNumber === rfqNumber) {
          const updatedQuotes = [...r.quotes.map(q => ({ ...q, isBestPrice: false, isPreferred: false })), newQuote];
          return {
            ...r,
            quotesCount: updatedQuotes.length,
            status: 'AI Recommended',
            quotes: updatedQuotes,
            aiScore: 95,
          };
        }
        return r;
      })
    );

    setVendorOpportunities((prev) =>
      prev.map((o) => (o.rfqNumber === rfqNumber ? { ...o, status: 'submitted' } : o))
    );

    addFeedItem(
      `Bid Submitted by Apex Supplies Ltd.`,
      `Apex Supplies submitted line-item quotation ($${unitPrice.toLocaleString()}/unit, ${leadTimeDays}d lead time). AI Score: 95%.`,
      'scoring',
      rfqNumber,
      'Apex Supplies Ltd.'
    );

    addAuditLog(
      `Apex Supplies Ltd. submitted verified quotation for ${rfqNumber} ($${unitPrice.toLocaleString()})`,
      rfqNumber,
      'vendor@apex.com'
    );

    showToast(
      'Quotation Submitted Successfully!',
      `Your bid for ${rfqNumber} has been validated and injected into the Buyer Comparative Matrix.`,
      'success'
    );
  };

  const approvePO = (rfqNumber: string, vendorName: string, amount: number) => {
    setRfqs((prev) =>
      prev.map((r) => (r.rfqNumber === rfqNumber ? { ...r, status: 'PO Generated' } : r))
    );

    addFeedItem(
      `Purchase Order Generated: ${rfqNumber}`,
      `Approved PO generated for ${vendorName} totaling $${amount.toLocaleString()}. Dispatched to ERP & Vendor Portal.`,
      'approval',
      rfqNumber
    );

    addAuditLog(
      `Approved PO Generation & Dispatched Contract for ${rfqNumber} to ${vendorName} ($${amount.toLocaleString()})`,
      rfqNumber
    );

    showToast(
      'Purchase Order Issued!',
      `Official PO contract generated and signed with SHA-256 digital stamp for ${vendorName}.`,
      'success'
    );
  };

  const addNewRFQ = (
    rfqData: Omit<RFQItem, 'id' | 'createdAt' | 'quotes' | 'quotesCount' | 'status' | 'chasingActive'>,
    customMatchedVendors?: VendorEntry[]
  ) => {
    // Subscription Limits Validation
    if (activeSubscription === 'none') {
      showToast('Subscription Upgrade Required', 'Your organization domain has already claimed its free trial. You must subscribe to a sourcing mode to dispatch RFQs.', 'warning');
      throw new Error('Subscription required');
    }

    if (activeSubscription === 'free_trial') {
      // Free Account grants 5 Free RFQs usable across ANY Version (Version 1, Version 2, Version 3)
      if (remainingFreeRFQs <= 0) {
        showToast('Free RFQ Quota Exhausted', 'You have used all 5 free RFQs. Please activate a sourcing plan to continue dispatching.', 'warning');
        throw new Error('Free account quota exhausted');
      }
      setRemainingFreeRFQs(prev => {
        const next = Math.max(0, prev - 1);
        const modeName = rfqData.sourcingMode === 'mode_1' ? 'Version 1 (Client Roster)' : rfqData.sourcingMode === 'mode_2' ? 'Version 2 (Hybrid Network)' : 'Version 3 (Autonomous AI)';
        showToast('Free RFQ Dispatched', `Used 1 Free RFQ via ${modeName}. You have ${next} free RFQs remaining across all versions.`, 'success');
        return next;
      });
    } else {
      if (rfqData.sourcingMode === 'mode_2' && activeSubscription === 'version_1') {
        showToast('Upgrade Required', 'Version 2 (Mode 2) Sourcing requires a Version 2 (Hybrid Network) Plan subscription.', 'warning');
        throw new Error('Subscription required');
      }
      if (rfqData.sourcingMode === 'mode_3' && activeSubscription !== 'version_3') {
        showToast('Upgrade Required', 'Version 3 (Mode 3) Sourcing requires a Version 3 (Autonomous AI) Plan subscription.', 'warning');
        throw new Error('Subscription required');
      }
    }

    // Dynamic Working Hours calculation
    const addWorkingHours = (startDate: Date, hoursToAdd: number): Date => {
      const START_HOUR = 8;
      const END_HOUR = 19;
      let currentDate = new Date(startDate.getTime());

      if (currentDate.getDay() === 0) {
        currentDate.setDate(currentDate.getDate() + 1);
        currentDate.setHours(START_HOUR, 0, 0, 0);
      }

      const curHour = currentDate.getHours();
      if (curHour >= END_HOUR) {
        currentDate.setDate(currentDate.getDate() + 1);
        if (currentDate.getDay() === 0) currentDate.setDate(currentDate.getDate() + 1);
        currentDate.setHours(START_HOUR, 0, 0, 0);
      } else if (curHour < START_HOUR) {
        currentDate.setHours(START_HOUR, 0, 0, 0);
      }

      let remainingHours = hoursToAdd;
      while (remainingHours > 0) {
        const currentHour = currentDate.getHours();
        const currentMinutes = currentDate.getMinutes();
        const remainingWorkHoursInDay = (END_HOUR - currentHour) - (currentMinutes / 60);

        if (remainingHours <= remainingWorkHoursInDay) {
          const newTime = currentDate.getTime() + remainingHours * 60 * 60 * 1000;
          currentDate = new Date(newTime);
          remainingHours = 0;
        } else {
          remainingHours -= remainingWorkHoursInDay;
          currentDate.setDate(currentDate.getDate() + 1);
          if (currentDate.getDay() === 0) currentDate.setDate(currentDate.getDate() + 1);
          currentDate.setHours(START_HOUR, 0, 0, 0);
        }
      }
      return currentDate;
    };

    const formatDateIST = (date: Date) => {
      const pad = (n: number) => n.toString().padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[date.getMonth()];
      const day = date.getDate();
      let hours = date.getHours();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      const minutes = pad(date.getMinutes());
      return `${day}-${month} ${hours}:${minutes} ${ampm} IST`;
    };

    const createdAtTime = new Date();
    const createdAtStr = createdAtTime.toISOString().replace('T', ' ').substring(0, 19);

    const emailSentTime = createdAtTime;
    const smsScheduledTime = new Date(createdAtTime.getTime() + 5 * 60 * 1000);
    const callScheduledTime = addWorkingHours(smsScheduledTime, 6);
    const whatsappScheduledTime = addWorkingHours(smsScheduledTime, 12);

    const emailSentStr = formatDateIST(emailSentTime);
    const smsScheduledStr = formatDateIST(smsScheduledTime);
    const callScheduledStr = formatDateIST(callScheduledTime);
    const whatsappScheduledStr = formatDateIST(whatsappScheduledTime);

    // Strict Deduplication Guardrail: Ensure each vendor email/ID receives ONLY ONE email and one entry
    const rawMatchedVendors = customMatchedVendors && customMatchedVendors.length > 0
      ? customMatchedVendors
      : matchSuitableVendors(rfqData.extractedEntities, rfqData.sourcingMode);

    const seenKeys = new Set<string>();
    const matchedVendors: VendorEntry[] = [];
    for (const v of rawMatchedVendors) {
      const key = (v.email || v.name || v.id).toLowerCase().trim();
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        matchedVendors.push(v);
      }
    }

    const followUpVendorRecords = matchedVendors.map((v, idx) => ({
      vendorId: v.id || `v-auto-${idx + 1}`,
      vendorName: v.name,
      phone: v.phone || '+91 98201 44820',
      contactPerson: v.contactPerson || 'Sales Desk',
      call: { status: 'scheduled' as const, lastAttempt: `Scheduled: ${callScheduledStr} (+6 Working Hours from SMS)` },
      whatsapp: { status: 'pending' as const, lastAttempt: `Scheduled: ${whatsappScheduledStr} (+12 Working Hours from SMS)` },
      sms: { status: 'pending' as const, lastAttempt: `Scheduled: ${smsScheduledStr} (5m post-dispatch)` },
      overallStatus: 'Pending' as const,
      lastInteraction: 'Just created',
      attemptsCount: 0,
      bidStatus: 'Pending' as const,
    }));

    const id = `rfq-${Date.now().toString().slice(-5)}`;
    const newRFQ: RFQItem = {
      ...rfqData,
      id,
      createdAt: createdAtStr,
      source: rfqData.source || 'web_portal',
      autoCirculated: rfqData.autoCirculated ?? (rfqData.source === 'email_gateway'),
      quotesCount: 0,
      status: 'Quotes Pending',
      chasingActive: true,
      chaserMethod: 'Multi-Channel',
      quotes: [],
      followUpData: {
        rfqNumber: rfqData.rfqNumber,
        totalInvited: matchedVendors.length,
        respondedCount: 0,
        callStats: { total: 0, connected: 0, avgDuration: '0m 00s' },
        whatsappStats: { total: 0, delivered: 0, read: 0, replied: 0 },
        smsStats: { total: 0, delivered: 0, clicked: 0 },
        nextScheduledChaser: `Standard RFQ Email: Sent (${emailSentStr}) • SMS: Scheduled 5m later at ${smsScheduledStr}`,
        autoChasingEnabled: true,
        vendors: followUpVendorRecords,
      },
    };

    setRfqs((prev) => [newRFQ, ...prev]);

    // Persist new RFQ to PostgreSQL
    fetch('/api/rfqs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newRFQ),
    }).catch((e) => console.error('Failed to save RFQ to DB:', e));
    
    // Create opportunity in vendor portal
    const newOpp: VendorOpportunity = {
      id: `opp-${Date.now()}`,
      rfqNumber: newRFQ.rfqNumber,
      title: newRFQ.title,
      buyer: 'Larsen & Toubro Limited (Heavy Engineering)',
      deadline: newRFQ.targetDeliveryDate,
      daysRemaining: 7,
      type: newRFQ.sourcingMode === 'mode_1' ? 'direct_invitation' : 'network_marketplace',
      estimatedValue: newRFQ.budget > 0 ? `$${(newRFQ.budget / 1000).toFixed(0)}k` : undefined,
      deliveryLocation: 'Enterprise Logistics Hub (Navi Mumbai)',
      status: 'pending_bid',
      lineItems: newRFQ.extractedEntities.map((e, idx) => ({
        id: `li-new-${idx}`,
        description: `${e.itemName} [${e.minorCategory || 'Minor Spec'}] (${e.technicalSpecs})`,
        quantity: e.quantity,
        unitPrice: 0,
        leadTimeDays: 14,
        marketBandStatus: 'optimal',
        paymentTerms: 'Net 30 Days',
      })),
    };
    setVendorOpportunities((prev) => [newOpp, ...prev]);

    // Dispatch Standard RFQ Email Package to each suitable vendor
    matchedVendors.forEach((v) => {
      const emailPayload = generateStandardRFQEmail(newRFQ, v);
      addFeedItem(
        `Standard RFQ Email Dispatched: ${v.name}`,
        `Standard procurement RFQ email package sent to ${v.contactPerson} (${v.email}) for ${newRFQ.rfqNumber}. Categorized under ${emailPayload.matchedMajorCategory} > [${emailPayload.matchedMinorCategories.join(', ')}].`,
        'email',
        newRFQ.rfqNumber,
        v.name,
        'email'
      );
    });

    addFeedItem(
      `RFQ Dispatched: ${newRFQ.rfqNumber}`,
      `Dispatched to ${matchedVendors.length} suitable vendors matching Minor Categories under ${SOURCING_MODES.find(m => m.id === newRFQ.sourcingMode)?.shortLabel}. Multi-channel automated chasing active across Call, WhatsApp & SMS.`,
      'whatsapp',
      newRFQ.rfqNumber,
      'Target Vendor Pool'
    );

    addAuditLog(
      `Created and dispatched Standard RFQ Email for ${newRFQ.rfqNumber} to ${matchedVendors.length} suitable vendors (${matchedVendors.map(v => v.name).join(', ')})`,
      newRFQ.rfqNumber
    );

    showToast(
      'Standard RFQ Email Dispatched!',
      `${newRFQ.rfqNumber} dispatched to ${matchedVendors.length} suitable vendors with automated AI Call, WhatsApp & SMS chasing enabled.`,
      'success'
    );

    if (rfqData.sourcingMode === 'mode_1') {
      // Step 0: Immediate Email Dispatched
      addFeedItem(
        'Standard RFQ Specification Email Dispatched',
        `AI Sourcing System sent the formal Standard RFQ email package with categorized BOQ items to Rajesh Nair (rajesh@apexsupplies.in) at ${emailSentStr}.`,
        'system',
        newRFQ.rfqNumber,
        'Apex Supplies Ltd.'
      );

      // Sequence: SMS -> Call -> WhatsApp -> Email Ingestion
      setTimeout(() => {
        triggerChannelChaser(newRFQ.rfqNumber, 'sms', 'Apex Supplies Ltd.', `Asking for quote. (Production Target: ${smsScheduledStr})`);
        setRfqs((prev) =>
          prev.map((r) => {
            if (r.rfqNumber === newRFQ.rfqNumber && r.followUpData) {
              return {
                ...r,
                followUpData: {
                  ...r.followUpData,
                  nextScheduledChaser: `SMS: Sent (${smsScheduledStr}) • Call: Scheduled at ${callScheduledStr} (+6 Working Hrs)`,
                  vendors: r.followUpData.vendors.map((v) =>
                    v.vendorName === 'Apex Supplies Ltd.'
                      ? { ...v, sms: { status: 'delivered', lastAttempt: 'Sent: ' + smsScheduledStr } }
                      : v
                  ),
                },
              };
            }
            return r;
          })
        );
      }, 4000);

      setTimeout(() => {
        triggerChannelChaser(newRFQ.rfqNumber, 'call', 'Apex Supplies Ltd.', `AI agent quote follow-up call. (Production Target: ${callScheduledStr})`);
        setRfqs((prev) =>
          prev.map((r) => {
            if (r.rfqNumber === newRFQ.rfqNumber && r.followUpData) {
              return {
                ...r,
                followUpData: {
                  ...r.followUpData,
                  nextScheduledChaser: `Call: Placed (${callScheduledStr}) • WA: Scheduled at ${whatsappScheduledStr} (+12 Working Hrs)`,
                  vendors: r.followUpData.vendors.map((v) =>
                    v.vendorName === 'Apex Supplies Ltd.'
                      ? { ...v, call: { status: 'completed', lastAttempt: 'Placed: ' + callScheduledStr, duration: '1m 30s', summary: 'AI Voice Call connected with sales coordinator.' } }
                      : v
                  ),
                },
              };
            }
            return r;
          })
        );
      }, 9500);

      setTimeout(() => {
        triggerChannelChaser(newRFQ.rfqNumber, 'whatsapp', 'Apex Supplies Ltd.', `Official procurement channel dispatch. (Production Target: ${whatsappScheduledStr})`);
        setRfqs((prev) =>
          prev.map((r) => {
            if (r.rfqNumber === newRFQ.rfqNumber && r.followUpData) {
              return {
                ...r,
                followUpData: {
                  ...r.followUpData,
                  nextScheduledChaser: `WA: Sent (${whatsappScheduledStr}) • Awaiting Email Response`,
                  vendors: r.followUpData.vendors.map((v) =>
                    v.vendorName === 'Apex Supplies Ltd.'
                      ? { ...v, whatsapp: { status: 'read', lastAttempt: 'Delivered: ' + whatsappScheduledStr, messagePreview: 'RFQ bid link delivered.', linkClicked: true } }
                      : v
                  ),
                },
              };
            }
            return r;
          })
        );
      }, 15000);

      setTimeout(() => {
        const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        addFeedItem(
          'Email Ingestion Gateway: Quote Received',
          `AI parser scanned quote attachment (Centrifugal_Pump_Quote_Apex.pdf) from Rajesh Nair (rajesh@apexsupplies.in). Successfully parsed pricing & lead times. Completed at ${timeNow}.`,
          'system',
          newRFQ.rfqNumber,
          'Apex Supplies Ltd.'
        );

        addAuditLog(
          `AI Ingested email quotation from Apex Supplies Ltd. for ${newRFQ.rfqNumber}. Automated follow-up halted.`,
          newRFQ.rfqNumber,
          'ai-gateway@procucev.com'
        );

        setRfqs((prev) =>
          prev.map((r) => {
            if (r.rfqNumber === newRFQ.rfqNumber) {
              const newQuote: QuoteComparison = {
                vendorId: 'v-auto-1',
                vendorName: 'Apex Supplies Ltd.',
                vendorCategory: 'Procucev - AI Rec',
                unitPrice: 5200,
                totalPrice: 5200 * 12,
                leadTimeDays: 12,
                aiMatchScore: 94,
                isBestPrice: true,
                isPreferred: true,
                warrantyYears: 2,
                complianceStatus: 'Fully Compliant',
                paymentTerms: 'Net 60 Days (Email Response)',
                remarks: 'Ingested via email attachment Centrifugal_Pump_Quote.pdf. Fixed price for 12 months.'
              };

              const updatedVendors = r.followUpData ? r.followUpData.vendors.map((v) => {
                if (v.vendorName === 'Apex Supplies Ltd.' || v.vendorName.includes('Apex')) {
                  return {
                    ...v,
                    bidStatus: 'Submitted' as const,
                    overallStatus: 'Responded' as const,
                    lastInteraction: timeNow,
                  };
                }
                return v;
              }) : [];

              return {
                ...r,
                status: 'In Evaluation' as const,
                quotesCount: r.quotesCount + 1,
                chasingActive: false,
                quotes: [...r.quotes, newQuote],
                followUpData: r.followUpData ? {
                  ...r.followUpData,
                  respondedCount: r.followUpData.respondedCount + 1,
                  nextScheduledChaser: 'Halted (Quote Received)',
                  vendors: updatedVendors,
                } : undefined,
              };
            }
            return r;
          })
        );

        setSelectedRFQForDeepDive((cur) => {
          if (cur && cur.rfqNumber === newRFQ.rfqNumber) {
            const newQuote: QuoteComparison = {
              vendorId: 'v-auto-1',
              vendorName: 'Apex Supplies Ltd.',
              vendorCategory: 'Procucev - AI Rec',
              unitPrice: 5200,
              totalPrice: 5200 * 12,
              leadTimeDays: 12,
              aiMatchScore: 94,
              isBestPrice: true,
              isPreferred: true,
              warrantyYears: 2,
              complianceStatus: 'Fully Compliant',
              paymentTerms: 'Net 60 Days (Email Response)',
              remarks: 'Ingested via email attachment Centrifugal_Pump_Quote.pdf. Fixed price for 12 months.'
            };
            return {
              ...cur,
              status: 'In Evaluation',
              quotesCount: cur.quotesCount + 1,
              chasingActive: false,
              quotes: [...cur.quotes, newQuote],
            };
          }
          return cur;
        });

        showToast(
          'Email Quote Ingested!',
          'Apex Supplies Ltd. quote updated. AI Chasing follow-up halted.',
          'success'
        );
      }, 19000);
    }

    if (rfqData.sourcingMode === 'mode_3') {
      addFeedItem(
        'Standard RFQ Dispatched to Private Roster',
        `AI Sourcing System dispatched Standard RFQ package via Email to Approved Private Roster (Apex Supplies, Global Industrial) at ${emailSentStr}.`,
        'system',
        newRFQ.rfqNumber,
        'Private Roster Pool'
      );

      addFeedItem(
        'Procucev Database Match: 10 Recommended Vendors Found',
        `AI matching engine scanned the Procucev vendor pool and recommended 10 verified suppliers (Delta Valve Systems, Dynamic Flow Controls, ElectroMech Pumps, etc.) matching the '${newRFQ.extractedEntities[0]?.minorCategory || 'Mechanical'}' minor category.`,
        'system',
        newRFQ.rfqNumber,
        'AI Sourcing Desk'
      );

      addFeedItem(
        'Double-Blind Sourcing Initiated: 10 Evaluation Invites Dispatched',
        `Anonymous Standard RFQ email and SMS messages dispatched with 360° qualification survey link and BOQ specifications to the 10 recommended database partners. Buyer identity is withheld until qualified.`,
        'system',
        newRFQ.rfqNumber,
        'Procucev Partner Pool'
      );

      addAuditLog(
        `Dispatched anonymous double-blind vendor qualification requests to 10 recommended database partners for ${newRFQ.rfqNumber}. Buyer identity withheld.`,
        newRFQ.rfqNumber,
        'ai-sourcing@procucev.com'
      );
    }

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
        currentMode,
        setCurrentMode,
        activeTab,
        setActiveTab,
        rfqs,
        aiFeed,
        vendorOpportunities,
        auditLogs,
        azureHealth,
        systemConfig,
        setSystemConfig,
        isLoadingDB,
        dbConnected,
        refreshFromDB,
        addNewRFQ,
        triggerWhatsAppChaser,
        triggerChannelChaser,
        triggerBatchChannelChaser,
        submitVendorBid,
        approvePO,
        addAuditLog,
        addFeedItem,
        selectedRFQForMatrix,
        setSelectedRFQForMatrix,
        selectedRFQForDeepDive,
        setSelectedRFQForDeepDive,
        deepDiveModalOpen,
        setDeepDiveModalOpen,
        openRFQDeepDive,
        vendorEvaluations,
        addVendorEvaluation,
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
        vendorRfqDownloadsUsed,
        setVendorRfqDownloadsUsed,
        vendorCatalogue,
        setVendorCatalogue,
        buyerAccounts,
        activeBuyerAccount,
        addBuyerAccount,
        updateBuyerAccount,
        deleteBuyerAccount,
        alignActiveBuyerAccount,
        importPublicBuyerDatabase,
        initialSetupModalOpen,
        setInitialSetupModalOpen,
        initialSetupCompleted,
        setInitialSetupCompleted,
        historicalPurchaseDataPeriod,
        setHistoricalPurchaseDataPeriod,
        processHistoricalPurchaseData,
        buyerVendors,
        addBuyerVendor,
        importBuyerVendors,
        deleteBuyerVendor,
        matchSuitableVendors,
        generateVendorOnboardingEmail,
        selectedOnboardingEmail,
        setSelectedOnboardingEmail,
        onboardingEmailModalOpen,
        setOnboardingEmailModalOpen,
        openOnboardingEmailModal,
        triggerVendorReminder,
        completeVendorProfile,
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
