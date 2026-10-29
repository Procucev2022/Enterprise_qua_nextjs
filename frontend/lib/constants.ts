import type {
  SourcingModeDetail,
  SystemConfig,
  AzureServiceHealth,
  SidebarNavItem,
  RoleWorkspaceMeta,
  UserRole,
  OrganizationType,
  SourcingMode,
} from './types';
import { UI_STRINGS } from './uiStrings';

/**
 * Centralized RFQ Modes Enum / Constants
 * V1 → Mode 1
 * V2 → Mode 2
 * V3 → Mode 3
 * V0 → Mode 0
 */
export const RFQ_MODES = {
  MODE_0: 'mode_0',
  MODE_1: 'mode_1',
  MODE_2: 'mode_2',
  MODE_3: 'mode_3',
} as const;

export type RfqModeKey = keyof typeof RFQ_MODES;
export type RfqModeValue = (typeof RFQ_MODES)[RfqModeKey];

export const RFQ_MODE_LABELS: Record<SourcingMode, string> = {
  [RFQ_MODES.MODE_0]: 'Mode 0',
  [RFQ_MODES.MODE_1]: 'Mode 1',
  [RFQ_MODES.MODE_2]: 'Mode 2',
  [RFQ_MODES.MODE_3]: 'Mode 3',
};

export const RFQ_MODE_MAP: Record<string, SourcingMode> = {
  v0: RFQ_MODES.MODE_0,
  v1: RFQ_MODES.MODE_1,
  v2: RFQ_MODES.MODE_2,
  v3: RFQ_MODES.MODE_3,
  'mode 0': RFQ_MODES.MODE_0,
  'mode 1': RFQ_MODES.MODE_1,
  'mode 2': RFQ_MODES.MODE_2,
  'mode 3': RFQ_MODES.MODE_3,
  mode_0: RFQ_MODES.MODE_0,
  mode_1: RFQ_MODES.MODE_1,
  mode_2: RFQ_MODES.MODE_2,
  mode_3: RFQ_MODES.MODE_3,
  version_0: RFQ_MODES.MODE_0,
  version_1: RFQ_MODES.MODE_1,
  version_2: RFQ_MODES.MODE_2,
  version_3: RFQ_MODES.MODE_3,
};

export const SOURCING_MODES: SourcingModeDetail[] = [
  {
    id: RFQ_MODES.MODE_0,
    code: RFQ_MODE_LABELS[RFQ_MODES.MODE_0],
    name: `${RFQ_MODE_LABELS[RFQ_MODES.MODE_0]}: Free Starter Trial Plan`,
    shortLabel: RFQ_MODE_LABELS[RFQ_MODES.MODE_0],
    description:
      'Free Starter Trial mode. RFQs are circulated only to verified Procucev network vendors (0 credits deducted).',
    featureSummary: 'Procucev Network Vendors Only (Free Starter Plan - 0 credits deducted)',
    badgeColor: 'border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10',
  },
  {
    id: RFQ_MODES.MODE_1,
    code: RFQ_MODE_LABELS[RFQ_MODES.MODE_1],
    name: `${RFQ_MODE_LABELS[RFQ_MODES.MODE_1]}: Client Roster Sourcing Plan`,
    shortLabel: RFQ_MODE_LABELS[RFQ_MODES.MODE_1],
    description:
      'Private empanelled vendor network. RFQs are strictly circulated only to your pre-verified approved vendor list.',
    featureSummary: 'Private buyer roster only (Features of Mode 1)',
    badgeColor: 'border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/10',
  },
  {
    id: RFQ_MODES.MODE_2,
    code: RFQ_MODE_LABELS[RFQ_MODES.MODE_2],
    name: `${RFQ_MODE_LABELS[RFQ_MODES.MODE_2]}: Hybrid Sourcing Plan`,
    shortLabel: RFQ_MODE_LABELS[RFQ_MODES.MODE_2],
    description:
      'Circulate to your private empanelled list first. If quotes or responses are insufficient, AI expands to Procucev Base Network.',
    featureSummary: 'Buyer roster + Procucev Hybrid pool (Features of Mode 1 & 2)',
    badgeColor: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10',
  },
  {
    id: RFQ_MODES.MODE_3,
    code: RFQ_MODE_LABELS[RFQ_MODES.MODE_3],
    name: `${RFQ_MODE_LABELS[RFQ_MODES.MODE_3]}: AI Autonomous Sourcing Plan`,
    shortLabel: RFQ_MODE_LABELS[RFQ_MODES.MODE_3],
    description:
      'Autonomous Procucev Network Sourcing with double-blind supplier identity shielding, continuous AI evaluation, and best-fit routing.',
    featureSummary: 'Autonomous AI + 360° Qualification (Features of Mode 1, 2 & 3)',
    badgeColor: 'border-purple-500/40 text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/10',
  },
];

/**
 * Mapping between buyer subscription plans and their corresponding RFQ sourcing / version mode.
 * - version_0 / free_trial: mode_0 (Mode 0: Free Starter Trial Plan)
 * - version_1: mode_1 (Mode 1: Client Roster Sourcing Plan)
 * - version_2: mode_2 (Mode 2: Hybrid Sourcing Plan)
 * - version_3: mode_3 (Mode 3: AI Autonomous Sourcing Plan)
 */
export const BUYER_SUBSCRIPTION_TO_SOURCING_MODE: Record<string, SourcingMode> = {
  version_0: RFQ_MODES.MODE_0,
  mode_0: RFQ_MODES.MODE_0,
  v0: RFQ_MODES.MODE_0,
  version_1: RFQ_MODES.MODE_1,
  version_2: RFQ_MODES.MODE_2,
  version_3: RFQ_MODES.MODE_3,
  v1: RFQ_MODES.MODE_1,
  v2: RFQ_MODES.MODE_2,
  v3: RFQ_MODES.MODE_3,
  mode_1: RFQ_MODES.MODE_1,
  mode_2: RFQ_MODES.MODE_2,
  mode_3: RFQ_MODES.MODE_3,
  unlimited: RFQ_MODES.MODE_3,
};

/**
 * Resolves the RFQ version / sourcing mode based upon the subscription of the buyer.
 * If any buyer raises an RFQ through the RFQ email ID, it should be assigned to V0 by default.
 * However, if the buyer has an active subscription to V1, V2, or V3, the RFQ should be assigned
 * to the respective subscribed version. Otherwise, it should automatically go to V0.
 *
 * @param buyerAccountOrPlan - Buyer account object or subscription plan string
 * @param preferredMode - Optional requested mode
 * @returns Sourcing mode ('mode_0' | 'mode_1' | 'mode_2' | 'mode_3')
 */
export function resolveBuyerSourcingMode(
  buyerAccountOrPlan?: any,
  preferredMode?: string | null
): SourcingMode {
  let plan: string | null = null;
  let subscriptions: any[] = [];
  let isExpired = false;

  if (typeof buyerAccountOrPlan === 'object' && buyerAccountOrPlan !== null) {
    if (buyerAccountOrPlan.unlimitedRfqAccess || buyerAccountOrPlan.unlimitedAccess) {
      const requested = (preferredMode || buyerAccountOrPlan.sourcingMode || buyerAccountOrPlan.sourcing_mode || '').trim().toLowerCase();
      if (['mode_0', 'v0', 'version_0'].includes(requested)) return RFQ_MODES.MODE_0;
      if (['mode_1', 'v1', 'version_1'].includes(requested)) return RFQ_MODES.MODE_1;
      if (['mode_2', 'v2', 'version_2'].includes(requested)) return RFQ_MODES.MODE_2;
      if (['mode_3', 'v3', 'version_3'].includes(requested)) return RFQ_MODES.MODE_3;
      return RFQ_MODES.MODE_3;
    }

    plan = buyerAccountOrPlan.subscriptionPlan || buyerAccountOrPlan.activeSubscription || null;
    if (Array.isArray(buyerAccountOrPlan.subscriptions)) {
      subscriptions = buyerAccountOrPlan.subscriptions;
    }
    const status = String(buyerAccountOrPlan.subscriptionStatus || buyerAccountOrPlan.status || '').toLowerCase();
    if (status === 'expired' || status === 'inactive') {
      isExpired = true;
    }
    const expiry = buyerAccountOrPlan.subscriptionExpiry || buyerAccountOrPlan.expiresAt;
    if (expiry && !isNaN(new Date(expiry).getTime()) && new Date(expiry).getTime() < Date.now()) {
      isExpired = true;
    }
  } else if (typeof buyerAccountOrPlan === 'string') {
    plan = buyerAccountOrPlan;
  }

  // Handle multiple active subscriptions (V3 > V2 > V1 > V0)
  if (Array.isArray(subscriptions) && subscriptions.length > 0) {
    const activeSubs = subscriptions.filter((sub) => {
      if (!sub) return false;
      const subStatus = String(sub.status || '').toLowerCase();
      if (subStatus === 'expired' || subStatus === 'inactive' || sub.active === false) return false;
      const subExpiry = sub.expiresAt || sub.expiryDate || sub.validUntil;
      if (subExpiry && !isNaN(new Date(subExpiry).getTime()) && new Date(subExpiry).getTime() < Date.now()) {
        return false;
      }
      return true;
    });

    if (activeSubs.length > 0) {
      const activePlans = activeSubs.map((s) => String(s.plan || s.subscriptionPlan || s.id || '').trim().toLowerCase());
      if (activePlans.some((p) => p === 'unlimited' || p === 'version_3' || p === 'v3' || p === 'mode_3')) {
        return RFQ_MODES.MODE_3;
      }
      if (activePlans.some((p) => p === 'version_2' || p === 'v2' || p === 'mode_2')) {
        return RFQ_MODES.MODE_2;
      }
      if (activePlans.some((p) => p === 'version_1' || p === 'v1' || p === 'mode_1')) {
        return RFQ_MODES.MODE_1;
      }
      if (activePlans.some((p) => p === 'version_0' || p === 'v0' || p === 'mode_0')) {
        return RFQ_MODES.MODE_0;
      }
    }
  }

  // Expired or inactive subscriptions are not considered; default to mode_0
  if (isExpired) {
    return RFQ_MODES.MODE_0;
  }

  // Check single active subscription
  if (typeof plan === 'string') {
    const normalized = plan.trim().toLowerCase();
    if (normalized === 'unlimited') {
      return RFQ_MODES.MODE_3;
    }
    if (['version_1', 'v1', 'mode_1'].includes(normalized)) {
      return RFQ_MODES.MODE_1;
    }
    if (['version_2', 'v2', 'mode_2'].includes(normalized)) {
      return RFQ_MODES.MODE_2;
    }
    if (['version_3', 'v3', 'mode_3'].includes(normalized)) {
      return RFQ_MODES.MODE_3;
    }
    if (['version_0', 'v0', 'mode_0'].includes(normalized)) {
      return RFQ_MODES.MODE_0;
    }
  }

  // If no active subscription to V1, V2, or V3, default automatically to Mode 0 (V0)
  return RFQ_MODES.MODE_0;
}

/**
 * Short RFQ version tag for a sourcing mode: mode_0 → "Mode 0" … mode_3 → "Mode 3".
 * Centralized mapping ensuring consistency across Kanban, directories, and tables.
 */
export function rfqVersionLabel(mode?: SourcingMode | null): string {
  if (!mode) return RFQ_MODE_LABELS[RFQ_MODES.MODE_0];
  return RFQ_MODE_LABELS[mode] || RFQ_MODE_LABELS[RFQ_MODES.MODE_0];
}

/**
 * Mirrors backend/src/controllers/rfqController.js's SUBSCRIPTION_MODE_ENTITLEMENTS
 * exactly: each paid tier adds one mode on top of the last. The backend already
 * enforces this on POST /api/rfqs (a request for an un-entitled mode 403s), so
 * this is UI-side only — it stops a buyer from picking a mode they cannot use
 * and then hitting a rejection after filling out the whole form, rather than
 * being the source of truth for access control.
 */
export const SUBSCRIPTION_MODE_ENTITLEMENTS: Record<string, SourcingMode[]> = {
  free_trial: [RFQ_MODES.MODE_0, RFQ_MODES.MODE_1, RFQ_MODES.MODE_2, RFQ_MODES.MODE_3],
  version_0: [RFQ_MODES.MODE_0],
  v0: [RFQ_MODES.MODE_0],
  version_1: [RFQ_MODES.MODE_0, RFQ_MODES.MODE_1],
  version_2: [RFQ_MODES.MODE_0, RFQ_MODES.MODE_1, RFQ_MODES.MODE_2],
  version_3: [RFQ_MODES.MODE_0, RFQ_MODES.MODE_1, RFQ_MODES.MODE_2, RFQ_MODES.MODE_3],
  unlimited: [RFQ_MODES.MODE_0, RFQ_MODES.MODE_1, RFQ_MODES.MODE_2, RFQ_MODES.MODE_3],
};

/**
 * Sourcing modes a buyer's subscription plan actually entitles them to use.
 *
 * For free_trial:
 * - If remaining free RFQ credits > 0: entitled to V0, V1, V2, V3.
 * - If remaining free RFQ credits <= 0: entitled ONLY to V0 (mode_0).
 *
 * For paid plans:
 * - version_1: mode_0, mode_1
 * - version_2: mode_0, mode_1, mode_2
 * - version_3: mode_0, mode_1, mode_2, mode_3
 * - unlimited: mode_0, mode_1, mode_2, mode_3
 */
export function entitledSourcingModes(
  subscriptionPlan?: string | null,
  remainingFreeRFQs?: number,
  unlimitedRfqAccess?: boolean
): SourcingMode[] {
  if (unlimitedRfqAccess) {
    return [RFQ_MODES.MODE_0, RFQ_MODES.MODE_1, RFQ_MODES.MODE_2, RFQ_MODES.MODE_3];
  }
  if (!subscriptionPlan) return SUBSCRIPTION_MODE_ENTITLEMENTS.version_1;
  const plan = subscriptionPlan.trim().toLowerCase();
  if (plan === 'unlimited') {
    return [RFQ_MODES.MODE_0, RFQ_MODES.MODE_1, RFQ_MODES.MODE_2, RFQ_MODES.MODE_3];
  }
  if (plan === 'free_trial' && remainingFreeRFQs !== undefined && remainingFreeRFQs <= 0) {
    return ['mode_0'];
  }
  return SUBSCRIPTION_MODE_ENTITLEMENTS[plan] || SUBSCRIPTION_MODE_ENTITLEMENTS.version_1;
}

export const BUYER_SUBSCRIPTION_PLANS = [
  {
    id: 'buyer_starter',
    name: 'Starter Enterprise',
    rfqLimit: 50,
    pricePerMonth: 4999,
    features: ['Up to 50 active RFQs', 'Standard AI Chaser', 'Single Buyer Console'],
  },
  {
    id: 'buyer_growth',
    name: 'Growth Enterprise',
    rfqLimit: 250,
    pricePerMonth: 14999,
    features: ['Up to 250 active RFQs', 'Multi-channel Voice & WhatsApp', 'Category Governance'],
  },
  {
    id: 'buyer_custom',
    name: 'Unlimited Enterprise',
    rfqLimit: 99999,
    pricePerMonth: 49999,
    features: ['Unlimited RFQs', 'Dedicated Azure HSM Instance', 'Custom ERP Integrations'],
  },
];

export const VENDOR_SUBSCRIPTION_PLANS = [
  {
    id: 'vendor_standard',
    name: 'Verified Supplier',
    pricePerMonth: 1999,
    bidLimit: 30,
    features: ['30 Quote Submissions / Month', 'Direct Telemetry Feedback'],
  },
  {
    id: 'vendor_premium',
    name: 'Preferred Partner',
    pricePerMonth: 5999,
    bidLimit: 99999,
    features: ['Unlimited Quote Submissions', 'Top-tier AI Matching Priority', 'Dedicated Account Manager'],
  },
];

export const INITIAL_SYSTEM_CONFIG: SystemConfig = {
  ollamaModel: 'Llama 3 (8B Instruct)',
  ollamaActive: true,
  ocrExtractionThreshold: 85,
  whatsappAutoChaser: true,
  voiceCallAutoChaser: true,
  smsAutoChaser: true,
  escalationIntervalHours: 24,
  azureDbBackupFrequency: 'Daily',
  rbacEnforced: true,
};

export const INITIAL_AZURE_HEALTH: AzureServiceHealth[] = [
  {
    service: 'Azure PostgreSQL Flexible Server (Neon Pooler)',
    status: 'ONLINE',
    latency: '18ms',
    uptime: '99.99%',
    details: 'Read/Write Active, SSL Require, Automated HA Clustering',
  },
  {
    service: 'Azure OpenAI (Doc Intelligence OCR)',
    status: 'HEALTHY',
    latency: '42ms',
    uptime: '99.95%',
    details: 'Deployment: gpt-4o-procure-v2, TPS: 140/sec',
  },
  {
    service: 'Azure Cosmos DB (Chasing State Engine)',
    status: 'ONLINE',
    latency: '12ms',
    uptime: '99.999%',
    details: 'Multi-Region Replication, Automatic Partitioning',
  },
  {
    service: 'Azure Communication Services (WhatsApp / Voice Gateway)',
    status: 'ONLINE',
    latency: '65ms',
    uptime: '99.9%',
    details: 'Enterprise WhatsApp Business API & AI Voice SIP Trunking Active',
  },
  {
    service: 'Azure Key Vault & HSM Security (kv-procucev-prod)',
    status: 'HEALTHY',
    latency: '8ms',
    uptime: '100%',
    details: 'FIPS 140-2 Level 3 Hardware Security Module Active',
  },
];

export const AES_CONFIG = {
  ALGORITHM: 'AES-GCM',
  KEY_LENGTH_BITS: 256,
  IV_LENGTH_BYTES: 12,
  TAG_LENGTH_BITS: 128,
  SALT_LENGTH_BYTES: 16,
  PBKDF2_ITERATIONS: 100000,
  VERSION: 'v1',
  SERIALIZATION_PREFIX: 'enc:v1:aes-256-gcm:',
};

/**
 * ═══════════════════════════════════════════════════════════════════════
 * Sidebar Dashboard Navigation Configuration
 * ═══════════════════════════════════════════════════════════════════════
 * Declarative per-role module registry driving the collapsible workspace
 * sidebar. Icons are referenced by key so this module stays pure data and
 * free of React/JSX imports; labels resolve from the centralized
 * `UI_STRINGS` dictionary to remain i18n-ready.
 */
const NAV_ITEMS = UI_STRINGS.navigation.items;
const NAV_GROUPS = UI_STRINGS.navigation.groups;

export const ROLE_WORKSPACE_META: Record<UserRole, RoleWorkspaceMeta> = {
  buyer: {
    accentText: 'text-indigo-600 dark:text-indigo-400',
    accentActive: 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30',
    accentRing: 'group-hover:border-indigo-400 dark:group-hover:border-indigo-600',
  },
  category_manager: {
    accentText: 'text-sky-600 dark:text-sky-400',
    accentActive: 'bg-sky-600 text-white shadow-sm shadow-sky-600/30',
    accentRing: 'group-hover:border-sky-400 dark:group-hover:border-sky-600',
  },
  vendor: {
    accentText: 'text-emerald-600 dark:text-emerald-400',
    accentActive: 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30',
    accentRing: 'group-hover:border-emerald-400 dark:group-hover:border-emerald-600',
  },
  admin: {
    accentText: 'text-purple-600 dark:text-purple-400',
    accentActive: 'bg-purple-600 text-white shadow-sm shadow-purple-600/30',
    accentRing: 'group-hover:border-purple-400 dark:group-hover:border-purple-600',
  },
};

export const ROLE_SIDEBAR_NAV: Record<UserRole, SidebarNavItem[]> = {
  buyer: [
    {
      id: 'command_center',
      screenTag: 'Screen 1.1',
      label: NAV_ITEMS.commandCenter.label,
      description: NAV_ITEMS.commandCenter.description,
      icon: 'Layers',
      group: NAV_GROUPS.buyerSourcing,
      route: '/buyer/dashboard',
    },
    {
      id: 'ingestion_wizard',
      screenTag: 'Screen 1.2',
      label: NAV_ITEMS.ingestionWizard.label,
      description: NAV_ITEMS.ingestionWizard.description,
      icon: 'FileSpreadsheet',
      group: NAV_GROUPS.buyerSourcing,
      route: '/buyer/ingestion-wizard',
    },
    {
      id: 'rfq_summary',
      screenTag: 'Screen 1.3',
      label: NAV_ITEMS.rfqSummary.label,
      description: NAV_ITEMS.rfqSummary.description,
      icon: 'ClipboardList',
      group: NAV_GROUPS.buyerSourcing,
      route: '/buyer/rfq-summary',
    },
    {
      id: 'vendor_evaluation_summary',
      screenTag: 'Screen 1.4',
      label: NAV_ITEMS.buyerEvaluationSummary.label,
      description: NAV_ITEMS.buyerEvaluationSummary.description,
      icon: 'FileCheck',
      group: NAV_GROUPS.buyerEvaluation,
      route: '/buyer/vendor-evaluation-summary',
    },
    {
      id: 'vendor_summary',
      screenTag: 'Screen 1.5',
      label: NAV_ITEMS.vendorDirectory.label,
      description: NAV_ITEMS.vendorDirectory.description,
      icon: 'Building2',
      group: NAV_GROUPS.buyerEvaluation,
      route: '/buyer/vendor-summary',
    },
    {
      id: 'subscription_center',
      screenTag: 'Screen 1.6',
      label: NAV_ITEMS.sourcingSubscriptions.label,
      description: NAV_ITEMS.sourcingSubscriptions.description,
      icon: 'Sparkles',
      group: NAV_GROUPS.buyerAccount,
      route: '/buyer/subscription-center',
    },
    {
      id: 'buyer_profile',
      screenTag: 'Screen 1.8',
      label: NAV_ITEMS.buyerProfile.label,
      description: NAV_ITEMS.buyerProfile.description,
      icon: 'Building2',
      group: NAV_GROUPS.buyerAccount,
      route: '/buyer/profile',
    },
    // Temporarily hidden: Vendor Email Templates
    /*
    {
      id: 'vendor_email_templates',
      screenTag: 'Screen 1.8b',
      label: NAV_ITEMS.vendorEmailTemplates.label,
      description: NAV_ITEMS.vendorEmailTemplates.description,
      icon: 'Mail',
      group: NAV_GROUPS.buyerAccount,
      route: '/buyer/vendor-email-templates',
    },
    */
    // Temporarily hidden: Buyer Billing History
    /*
    {
      id: 'buyer_billing_history',
      screenTag: 'Screen 1.9',
      label: NAV_ITEMS.billingHistory.label,
      description: NAV_ITEMS.billingHistory.description,
      icon: 'Receipt',
      group: NAV_GROUPS.buyerAccount,
      route: '/buyer/billing-history',
    },
    */
    // Temporarily hidden: Buyer DB Sync
    /*
    {
      id: 'buyer_directory',
      screenTag: 'Screen 1.8',
      label: NAV_ITEMS.buyerDbSync.label,
      description: NAV_ITEMS.buyerDbSync.description,
      icon: 'Database',
      group: NAV_GROUPS.buyerAccount,
      route: '/buyer/buyer-directory',
    },
    */
  ],
  category_manager: [
    {
      id: 'kanban_board',
      screenTag: 'Screen 2.1',
      shortTag: '2.1',
      label: NAV_ITEMS.operationalKanban.label,
      description: NAV_ITEMS.operationalKanban.description,
      icon: 'Kanban',
      group: NAV_GROUPS.categoryOperations,
      route: '/category-manager/kanban-board',
    },
    {
      id: 'spend_dashboard',
      screenTag: 'Screen 2.2',
      shortTag: '2.2',
      label: NAV_ITEMS.spendAnalytics.label,
      description: NAV_ITEMS.spendAnalytics.description,
      icon: 'TrendingUp',
      group: NAV_GROUPS.categoryOperations,
      route: '/category-manager/spend-dashboard',
    },
    {
      id: 'buyer_console',
      screenTag: 'Screen 2.3',
      shortTag: '2.3',
      label: NAV_ITEMS.buyerRfqConsole.label,
      description: NAV_ITEMS.buyerRfqConsole.description,
      icon: 'Building2',
      group: NAV_GROUPS.categoryConsoles,
      route: '/category-manager/buyer-console',
    },
    {
      id: 'vendor_evaluation_summary',
      screenTag: 'Screen 2.4',
      shortTag: '2.4',
      label: NAV_ITEMS.modeEvaluations.label,
      description: NAV_ITEMS.modeEvaluations.description,
      icon: 'FileCheck',
      group: NAV_GROUPS.categoryConsoles,
      route: '/category-manager/vendor-evaluation-summary',
    },
    {
      id: 'vendor_console',
      screenTag: 'Screen 2.5',
      shortTag: '2.5',
      label: NAV_ITEMS.vendorPerformance.label,
      description: NAV_ITEMS.vendorPerformance.description,
      icon: 'Truck',
      group: NAV_GROUPS.categoryConsoles,
      route: '/category-manager/vendor-console',
    },
    {
      id: 'category_summary',
      screenTag: 'Screen 2.6',
      shortTag: '2.6',
      label: NAV_ITEMS.categoryTrends.label,
      description: NAV_ITEMS.categoryTrends.description,
      icon: 'Layers',
      group: NAV_GROUPS.categoryGovernance,
      route: '/category-manager/category-summary',
    },
    {
      id: 'all_rfqs',
      screenTag: 'Screen 2.7',
      shortTag: '2.7',
      label: NAV_ITEMS.allRfqsConsole.label,
      description: NAV_ITEMS.allRfqsConsole.description,
      icon: 'ClipboardList',
      group: NAV_GROUPS.categoryGovernance,
      route: '/category-manager/all-rfqs',
    },
    {
      id: 'enterprise_inquiries',
      screenTag: 'Screen 2.8',
      shortTag: '2.8',
      label: NAV_ITEMS.enterpriseInquiries.label,
      description: NAV_ITEMS.enterpriseInquiries.description,
      icon: 'Building2',
      group: NAV_GROUPS.categoryGovernance,
      route: '/category-manager/enterprise-inquiries',
    },
    {
      id: 'buyers_directory',
      screenTag: 'Screen 2.9',
      shortTag: '2.9',
      label: NAV_ITEMS.buyersDirectory.label,
      description: NAV_ITEMS.buyersDirectory.description,
      icon: 'Building2',
      group: NAV_GROUPS.categoryGovernance,
      route: '/category-manager/buyers-directory',
    },
    {
      id: 'sellers_directory',
      screenTag: 'Screen 2.10',
      shortTag: '2.10',
      label: NAV_ITEMS.sellersDirectory.label,
      description: NAV_ITEMS.sellersDirectory.description,
      icon: 'Truck',
      group: NAV_GROUPS.categoryGovernance,
      route: '/category-manager/sellers-directory',
    },
    {
      id: 'daily_reports',
      screenTag: 'Screen 2.11',
      shortTag: '2.11',
      label: NAV_ITEMS.dailyReports.label,
      description: NAV_ITEMS.dailyReports.description,
      icon: 'FileSpreadsheet',
      group: NAV_GROUPS.categoryGovernance,
      route: '/category-manager/daily-reports',
    },
  ],
  vendor: [
    {
      id: 'vendor_feed',
      screenTag: 'Screen 3.1',
      shortTag: '3.1',
      label: NAV_ITEMS.opportunityFeed.label,
      description: NAV_ITEMS.opportunityFeed.description,
      icon: 'Truck',
      group: NAV_GROUPS.vendorOpportunities,
      route: '/vendor/opportunity-feed',
    },
    {
      id: 'quotation_form',
      screenTag: 'Screen 3.2',
      shortTag: '3.2',
      label: NAV_ITEMS.bidQuotes.label,
      description: NAV_ITEMS.bidQuotes.description,
      icon: 'FileCheck',
      group: NAV_GROUPS.vendorOpportunities,
      route: '/vendor/quotation-form',
    },
    {
      id: 'qualification_form',
      screenTag: 'Screen 3.3',
      shortTag: '3.3',
      label: NAV_ITEMS.selfEvaluation.label,
      description: NAV_ITEMS.selfEvaluation.description,
      icon: 'Award',
      group: NAV_GROUPS.vendorQualification,
      route: '/vendor/qualification-form',
    },
    {
      id: 'item_catalogue',
      screenTag: 'Screen 3.4',
      shortTag: '3.4',
      label: NAV_ITEMS.itemCatalogue.label,
      description: NAV_ITEMS.itemCatalogue.description,
      icon: 'Layers',
      group: NAV_GROUPS.vendorQualification,
      route: '/vendor/item-catalogue',
    },
    {
      id: 'vendor_subscription',
      screenTag: 'Screen 3.5',
      shortTag: '3.5',
      label: NAV_ITEMS.subscriptionPlans.label,
      description: NAV_ITEMS.subscriptionPlans.description,
      icon: 'Sparkles',
      group: NAV_GROUPS.vendorAccount,
      route: '/vendor/vendor-subscription',
    },
    {
      id: 'vendor_billing_history',
      screenTag: 'Screen 3.7',
      shortTag: '3.7',
      label: NAV_ITEMS.billingHistory.label,
      description: NAV_ITEMS.billingHistory.description,
      icon: 'Receipt',
      group: NAV_GROUPS.vendorAccount,
      route: '/vendor/billing-history',
    },
    {
      id: 'vendor_profile',
      screenTag: 'Screen 3.6',
      shortTag: '3.6',
      label: NAV_ITEMS.supplierProfile.label,
      description: NAV_ITEMS.supplierProfile.description,
      icon: 'Truck',
      group: NAV_GROUPS.vendorAccount,
      route: '/vendor/vendor-profile',
    },
  ],
  admin: [
    {
      id: 'infra_control',
      screenTag: 'Screen 4.1',
      shortTag: '4.1',
      label: NAV_ITEMS.azureInfrastructure.label,
      description: NAV_ITEMS.azureInfrastructure.description,
      icon: 'Server',
      group: NAV_GROUPS.adminPlatform,
      route: '/admin/infra-control',
    },
    {
      id: 'audit_log',
      screenTag: 'Screen 4.2',
      shortTag: '4.2',
      label: NAV_ITEMS.immutableAuditLog.label,
      description: NAV_ITEMS.immutableAuditLog.description,
      icon: 'ShieldCheck',
      group: NAV_GROUPS.adminPlatform,
      route: '/admin/audit-log',
    },
  ],
};

/**
 * Flush edge-to-edge sidebar geometry. The rail is pinned directly beneath the
 * 64px sticky application header with zero top, left, or bottom gutters.
 */
export const SIDEBAR_LAYOUT = {
  WIDTH_CLASS: 'lg:w-[262px]',
  STICKY_OFFSET_CLASS: 'lg:top-16',
  HEIGHT_CLASS: 'lg:h-[calc(100vh-4rem)]',
};

/** Route the sign-in flow redirects to, chosen by the role on the user record. */
export const ROLE_LANDING_ROUTE: Record<UserRole, string> = {
  buyer: '/buyer/dashboard',
  category_manager: '/category-manager/kanban-board',
  vendor: '/vendor/opportunity-feed',
  admin: '/admin/infra-control',
};

/** Path of the sign-in screen. */
export const LOGIN_ROUTE = '/login';

/**
 * Email OTP shape, mirroring IDENTITY_OTP_CONFIG on the backend. Both trace back
 * to the shared `otp_store` table the Java p2pservices app writes, whose `otp`
 * column is six characters with a 15-minute expiry.
 */
export const OTP_CODE_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 15;

// PASSWORD_MIN_LENGTH is defined in ./validationSchemas and re-exported at the
// bottom of this file. It lives there because the change-password schema needs it
// to build its `minLength` rule, and importing it back from here would close a
// cycle: this module already imports from that one.

/**
 * Buyer organisation profile endpoints.
 *
 * These are the Next.js rewrite paths, which next.config.mjs forwards to the
 * Express backend, so the browser only ever calls same-origin URLs.
 */
export const BUYER_PROFILE_ENDPOINTS = {
  /** The signed-in buyer's own profile: GET to read, PUT to patch. */
  ME: '/api/buyer-profile/me',
  /** Shared major/minor procurement taxonomy the category tree renders. */
  CATEGORIES: '/api/buyer-profile/categories',
  /** The signed-in buyer's custom vendor-onboarding email templates (Template A/B). */
  DISPATCH_TEMPLATES: '/api/buyer-profile/dispatch-templates',
};

/**
 * Cardinality caps on a buyer's procurement scope, mirroring
 * BUYER_PROFILE_CONFIG on the backend, which in turn preserves the limits the
 * old Angular screen enforced for a ClientInitiator.
 *
 * Enforced in the browser so the buyer is stopped at the click that would exceed
 * the cap rather than at submit, and re-enforced server-side because a client
 * cannot be trusted to hold the line.
 */
export const BUYER_PROFILE_LIMITS = {
  MAX_MAJOR_CATEGORIES: 5,
  MAX_MINOR_CATEGORIES: 10,
};

/**
 * Global constraints for RFQ supporting document attachments and AI extraction.
 */
export const RFQ_DOCUMENT_LIMITS = {
  MAX_FILE_SIZE_BYTES: 15 * 1024 * 1024,
  MAX_FILE_SIZE_MB: 15,
  MAX_DOCUMENTS_PER_RFQ: 10,
  SUPPORTED_EXTENSIONS: '.xlsx,.xls,.csv,.pdf,.docx,.doc,.txt,.eml,.msg',
  SUPPORTED_FORMATS_LABEL:
    'Upload BOQ files (.xlsx, .xls, .csv, .pdf, .docx, .txt) or Forwarded Requisition Emails (.eml, .msg)',
} as const;

/** Legal constitutions offered by the buyer profile form. */
export const ORGANIZATION_TYPE_OPTIONS: OrganizationType[] = [
  'Public Limited',
  'Private Limited',
  'LLP',
  'Partnership',
  'Sole Proprietorship',
];

/**
 * Fallback used when an RFQ reaches dispatch without a target delivery date.
 *
 * A row the buyer adds by hand starts entirely blank — no quantity, unit,
 * category or date — because pre-filled values read as answers the buyer never
 * gave. This offset only backfills the RFQ header when no line item carries a
 * date, and mirrors DELIVERY_DATE_OFFSET_DAYS in RFQ_INGESTION_CONFIG on the
 * backend so a keyed RFQ and an ingested one land on the same default.
 */
export const MANUAL_LINE_ITEM_DEFAULTS = {
  TARGET_DATE_OFFSET_DAYS: 5,
} as const;

/**
 * Single currency the platform trades in. Amounts are grouped the Indian way
 * (1,45,000 rather than 145,000), so the symbol and the locale have to travel
 * together: pairing a rupee symbol with en-US grouping, or the reverse, is the
 * inconsistency this constant exists to prevent.
 */
export const CURRENCY = {
  SYMBOL: '₹',
  CODE: 'INR',
  LOCALE: 'en-IN',
} as const;

/**
 * Every state an RFQ can be in, in pipeline order.
 *
 * Listed here rather than inline in the edit dialog so the status dropdown and
 * the `RFQItem['status']` union cannot drift apart.
 */
export const RFQ_STATUSES = [
  'Parsing',
  'Quotes Pending',
  'In Evaluation',
  'AI Recommended',
  'PO Generated',
] as const;

/**
 * Format an amount for display, e.g. 145000 -> "₹1,45,000".
 *
 * Fractional paise are dropped because every amount the platform shows is a
 * budget, quote or purchase-order total quoted in whole rupees.
 */
export function formatCurrency(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${CURRENCY.SYMBOL}${Math.round(safe).toLocaleString(CURRENCY.LOCALE)}`;
}

/**
 * The timezone every RFQ timestamp is presented in.
 *
 * Records are stored in UTC, which is right for storage and wrong for display:
 * buyers, vendors and the procurement desk are all in India, and a raised-at of
 * "2026-09-04T09:25:21.000Z" reads as five and a half hours earlier than the
 * moment the buyer actually pressed save.
 */
export const DISPLAY_TIMEZONE = 'Asia/Kolkata';

/**
 * An RFQ timestamp as an Indian date and time, e.g. "04 Sep 2026, 02:55 pm IST".
 *
 * Accepts what the API actually returns: an ISO-8601 instant, or the
 * "YYYY-MM-DD HH:mm:ss" form MySQL hands back for a DATETIME column. The latter
 * carries no zone, so it is read as UTC — that is what the column stores.
 *
 * An unparseable or absent value is returned unchanged rather than rendered as
 * "Invalid Date", so a legacy record still shows whatever it holds.
 */
export function formatIndianDateTime(value?: string): string {
  if (!value || value.trim() === '') return '';

  // A bare MySQL DATETIME has no zone designator, so one is added before parsing;
  // without it the browser would read it in the viewer's local zone instead.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value.trim())
    ? `${value.trim().replace(' ', 'T')}Z`
    : value;

  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) return value;

  const formatted = new Intl.DateTimeFormat(CURRENCY.LOCALE, {
    timeZone: DISPLAY_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(parsed));

  // The zone is named explicitly: the same RFQ is read by vendors elsewhere, and
  // a bare time with no zone is ambiguous on a procurement deadline.
  return `${formatted} IST`;
}

/**
 * An RFQ date with no time, e.g. "30 Sep 2026".
 *
 * Used for target delivery dates, which are stored as a plain date. Parsed as UTC
 * so a date-only value cannot slip to the previous day for a viewer behind UTC.
 */
export function formatIndianDate(value?: string): string {
  if (!value || value.trim() === '') return '';

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  const parsed = Date.parse(dateOnly ? `${value.trim()}T00:00:00Z` : value);
  if (Number.isNaN(parsed)) return value;

  return new Intl.DateTimeFormat(CURRENCY.LOCALE, {
    timeZone: DISPLAY_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(parsed));
}

export const ALLOWED_EXTENSION_HOURS = [24, 48] as const;
export const DEFAULT_EXTENSION_HOURS = 24 as const;

/**
 * Calculates a revised RFQ deadline extended by 24 or 48 hours.
 * If the current deadline is in the past, extensions are measured from now.
 */
export function calculateExtendedDeadline(
  currentDeadline?: string,
  hours: 24 | 48 = 24,
  baseCreatedAt?: string
): string {
  let baseMs: number;
  if (currentDeadline && !Number.isNaN(Date.parse(currentDeadline))) {
    baseMs = Math.max(new Date(currentDeadline).getTime(), Date.now());
  } else if (baseCreatedAt && !Number.isNaN(Date.parse(baseCreatedAt))) {
    const createdMs = new Date(baseCreatedAt).getTime();
    const default7Days = createdMs + 7 * 24 * 60 * 60 * 1000;
    baseMs = Math.max(default7Days, Date.now());
  } else {
    baseMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
  }
  return new Date(baseMs + hours * 60 * 60 * 1000).toISOString();
}

/**
 * Normalizes any date value (Excel numeric serial, Date instance, ISO string, DD-MM-YYYY, etc.)
 * into a clean standard ISO date string (YYYY-MM-DD).
 * Prevents Excel date serial numbers (e.g. 45995.00011574074) from appearing as decimal numbers in the UI.
 */
export function normalizePoDate(value: unknown): string {
  if (value === null || value === undefined || value === '' || value === 0 || value === '0') return '';

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // If numeric (e.g. 45995 or 45995.00011574074 from Excel date serial)
  if (typeof value === 'number') {
    if (value >= 1 && value <= 100000) {
      const utcDays = Math.floor(value - 25569);
      const d = new Date(utcDays * 86400 * 1000);
      if (!isNaN(d.getTime())) {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
    }
    return '';
  }

  const str = String(value).trim();
  if (!str) return '';

  // Numeric string check (e.g. "45995.00011574074" or "45995")
  const num = Number(str);
  if (!isNaN(num) && isFinite(num) && !str.includes('-') && !str.includes('/') && !str.includes(':')) {
    if (num >= 1 && num <= 100000) {
      const utcDays = Math.floor(num - 25569);
      const d = new Date(utcDays * 86400 * 1000);
      if (!isNaN(d.getTime())) {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
    }
    return '';
  }

  // Already ISO format YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  // YYYY/MM/DD or YYYY.MM.DD
  const ymdMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymdMatch) {
    const y = ymdMatch[1];
    const m = String(Number(ymdMatch[2])).padStart(2, '0');
    const d = String(Number(ymdMatch[3])).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // DD-MM-YYYY or MM-DD-YYYY or DD/MM/YYYY
  const dmyMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmyMatch) {
    const p1 = Number(dmyMatch[1]);
    const p2 = Number(dmyMatch[2]);
    const y = dmyMatch[3];
    let day = p1;
    let month = p2;
    if (p1 > 12 && p2 <= 12) {
      day = p1;
      month = p2;
    } else if (p2 > 12 && p1 <= 12) {
      day = p2;
      month = p1;
    }
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Generic Date.parse fallback
  const parsed = Date.parse(str);
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  return str;
}


/**
 * Human-readable file size, e.g. 1536 -> "1.5 KB".
 *
 * Uses 1024-based units because that is what the browser and the server both
 * report, and keeps one decimal from KB upwards so a 1.4MB and a 1.9MB document
 * are distinguishable in a list.
 */
export function formatFileSize(bytes: number): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe < 1024) return `${safe} B`;

  const units = ['KB', 'MB', 'GB'];
  let value = safe / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/** URL prefix that scopes each role's workspace, used to guard route access. */
export const ROLE_ROUTE_PREFIX: Record<UserRole, string> = {
  buyer: '/buyer',
  category_manager: '/category-manager',
  vendor: '/vendor',
  admin: '/admin',
};

/** Vendor live presence threshold & polling intervals (ms) */
export const PRESENCE_ONLINE_THRESHOLD_MS = 10 * 60 * 1000;
export const PRESENCE_HEARTBEAT_INTERVAL_MS = 60 * 1000;
export const PRESENCE_POLL_INTERVAL_MS = 30 * 1000;

/** RFQ vendor assignment limits per category (configurable via env) */
export const VENDOR_ASSIGNMENT_LIMITS = {
  get MAX_CLIENT_PER_CATEGORY(): number {
    const envVal = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_MAX_CLIENT_VENDORS_PER_CATEGORY : undefined;
    const num = Number(envVal);
    return !Number.isNaN(num) && num > 0 ? num : 5;
  },
  get MAX_PROCUCEV_PER_CATEGORY(): number {
    const envVal = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_MAX_PROCUCEV_VENDORS_PER_CATEGORY : undefined;
    const num = Number(envVal);
    return !Number.isNaN(num) && num > 0 ? num : 5;
  },
};

export {
  FORM_SCHEMAS,
  validateFormData,
  EMAIL_PATTERN,
  GSTIN_PATTERN,
  PHONE_PATTERN,
  PINCODE_PATTERN,
  PASSWORD_MIN_LENGTH,
} from './validationSchemas';

export const UNLIMITED_ACCESS_EMAILS = new Set([
  'sudheer.kangala@procucev.com',
  'procucevvendor@gmail.com',
]);

export function hasUnlimitedAccess(emailOrSession?: { email?: string } | string | null): boolean {
  if (!emailOrSession) return false;
  const email = (typeof emailOrSession === 'string' ? emailOrSession : emailOrSession.email || '').trim().toLowerCase();
  return UNLIMITED_ACCESS_EMAILS.has(email);
}

export const QUA_AI_TRANSACTIONAL_EMAIL_TEMPLATES = {
  EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED: {
    id: 'EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED',
    number: 1,
    name: 'RFQ created from email, account auto-created',
    who: 'Unregistered buyer',
    trigger: 'An unknown email address writes to RFQ@procucev.com. Qua AI creates a profile with the email ID and dummy details, creates the RFQ, then sends this email.',
    subject: 'Congratulations, your RFQ {rfq_id} is live on Qua AI',
  },
  EMAIL_2_RFQ_CREATED: {
    id: 'EMAIL_2_RFQ_CREATED',
    number: 2,
    name: 'RFQ created',
    who: 'Registered buyer',
    trigger: "A logged-in buyer creates an RFQ on the platform, or a registered buyer's email to RFQ@procucev.com is converted into an RFQ.",
    subject: 'Congratulations, RFQ {rfq_id} is live. Qua AI is on it',
  },
  EMAIL_3_NEW_RFQ_INTIMATION: {
    id: 'EMAIL_3_NEW_RFQ_INTIMATION',
    number: 3,
    name: 'New RFQ intimation',
    who: 'Unregistered vendor',
    trigger: 'Qua AI matches an RFQ to a supplier in the Procucev network who has no account yet.',
    subject: 'New buyer enquiry for {category}: quote by {quote_deadline}',
  },
  EMAIL_4_NEW_RFQ_TO_QUOTE: {
    id: 'EMAIL_4_NEW_RFQ_TO_QUOTE',
    number: 4,
    name: 'New RFQ to quote',
    who: 'Registered vendor',
    trigger: "A new RFQ matches the categories on a registered vendor's profile.",
    subject: 'New RFQ {rfq_id}: {rfq_title}, quotes close {quote_deadline}',
  },
  EMAIL_5_QUOTATIONS_READY_TO_COMPARE: {
    id: 'EMAIL_5_QUOTATIONS_READY_TO_COMPARE',
    number: 5,
    name: 'Quotations ready to compare',
    who: 'Buyer (registered or auto-created)',
    trigger: 'First quotation received on an RFQ, then a final digest when the quote deadline passes.',
    subject: '{quote_count} quotes in for RFQ {rfq_id}: compare now',
  },
  EMAIL_6_ACTIVATE_YOUR_ACCOUNT: {
    id: 'EMAIL_6_ACTIVATE_YOUR_ACCOUNT',
    number: 6,
    name: 'Activate your account',
    who: 'Unregistered buyer (account auto-created in Email 1)',
    trigger: 'No login 24 hours after Email 1; repeat once at 72 hours.',
    subject: 'Suppliers are waiting on RFQ {rfq_id}',
  },
  EMAIL_7_RFQ_NEEDS_MORE_INFORMATION: {
    id: 'EMAIL_7_RFQ_NEEDS_MORE_INFORMATION',
    number: 7,
    name: 'RFQ needs more information',
    who: 'Buyer (registered or unregistered)',
    trigger: "Qua AI can't confirm a quantity, specification, delivery location or attachment from the buyer's email or upload.",
    subject: 'One detail needed to send RFQ {rfq_id} to suppliers',
  },
  EMAIL_8_NO_QUOTES_YET: {
    id: 'EMAIL_8_NO_QUOTES_YET',
    number: 8,
    name: 'No quotes yet',
    who: 'Buyer',
    trigger: 'Zero quotes received 48 hours before the quote deadline.',
    subject: "RFQ {rfq_id}: let's get you more quotes",
  },
  EMAIL_9_QUOTE_DEADLINE_REMINDER: {
    id: 'EMAIL_9_QUOTE_DEADLINE_REMINDER',
    number: 9,
    name: 'Quote deadline reminder',
    who: 'Vendor (registered or unregistered)',
    trigger: "24 hours before the quote deadline, to vendors who were notified or viewed the RFQ but haven't quoted.",
    subject: '24 hours left to quote on {rfq_title}',
  },
  EMAIL_10_LOW_OR_ZERO_CREDITS: {
    id: 'EMAIL_10_LOW_OR_ZERO_CREDITS',
    number: 10,
    name: 'Low or zero credits',
    who: 'Registered vendor',
    trigger: 'Credit balance falls below 2, or the vendor tries to open an RFQ with zero credits.',
    subject: "You have {credit_balance} credits left: don't miss the next RFQ",
  },
  EMAIL_11_QUOTE_SUBMITTED: {
    id: 'EMAIL_11_QUOTE_SUBMITTED',
    number: 11,
    name: 'Quote submitted',
    who: 'Vendor',
    trigger: 'Vendor submits a quotation on an RFQ.',
    subject: 'Your quote for RFQ {rfq_id} has been received',
  },
  EMAIL_12_RFQ_REVISED_BUYER_QUESTION: {
    id: 'EMAIL_12_RFQ_REVISED_BUYER_QUESTION',
    number: 12,
    name: 'RFQ revised / buyer question',
    who: 'Vendor (notified on or quoted on the RFQ)',
    trigger: 'Buyer edits the RFQ (quantity, spec, date) or posts a clarification question.',
    subject: 'Update on RFQ {rfq_id}: please review',
  },
  EMAIL_13_COMPLETE_YOUR_PROFILE: {
    id: 'EMAIL_13_COMPLETE_YOUR_PROFILE',
    number: 13,
    name: 'Complete your profile',
    who: 'Unregistered vendor (received Email 3)',
    trigger: 'Profile not completed 48 hours after Email 3.',
    subject: 'Your RFQ for {category} closes {quote_deadline}',
  },
} as const;

export const QUA_AI_EMAIL_SUPPORT = {
  PHONE: '+91 8247722944',
  EMAIL: 'info@procucev.com',
  TEAM_SIGNATURE: 'Team Qua AI',
  COMPANY_NAME: 'Procucev Enterprise Solutions',
} as const;




export const MAX_INVITE_VENDORS = 20;

export const INDIAN_STATES_AND_CITIES: Record<string, string[]> = {
  "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Guntur", "Tirupati", "Nellore", "Kurnool", "Kakinada", "Rajahmundry", "Kadapa", "Anantapur", "Eluru", "Ongole", "Chittoor", "Srikakulam", "Vizianagaram", "Machilipatnam", "Tenali", "Narasaraopet", "Chilakaluripet", "Bapatla", "Chirala", "Kavali", "Gudur", "Sullurpeta", "Naidupeta", "Venkatagiri", "Puttur", "Nagari", "Madanapalle", "Punganur", "Palamaner", "Pileru", "Rayachoti", "Proddatur", "Jammalamadugu", "Pulivendula", "Mydukur", "Nandyal", "Adoni", "Yemmiganur", "Dhone", "Atmakur", "Allagadda", "Banaganapalle", "Markapur", "Kanigiri", "Giddalur", "Podili", "Kandukur", "Addanki", "Parchur", "Repalle", "Ponnur", "Mangalagiri", "Tadepalli", "Sattenapalle", "Vinukonda", "Piduguralla", "Macherla", "Gurazala", "Amaravati", "Ibrahimpatnam", "Nuzvid", "Gudivada", "Pedana", "Vuyyuru", "Jaggayyapeta", "Nandigama", "Tiruvuru", "Kaikaluru", "Bhimavaram", "Tadepalligudem", "Tanuku", "Palakollu", "Narasapuram", "Nidadavole", "Kovvur", "Jangareddygudem", "Akividu", "Attili", "Amalapuram", "Mandapeta", "Ramachandrapuram", "Peddapuram", "Samalkot", "Pithapuram", "Tuni", "Yeleswaram", "Anakapalle", "Narsipatnam", "Yelamanchili", "Bheemunipatnam", "Pendurthi", "Parvathipuram", "Bobbili", "Salur", "Palasa", "Ichchapuram", "Tekkali", "Amadalavalasa", "Rajam", "Hindupur", "Dharmavaram", "Tadipatri", "Gooty", "Guntakal", "Rayadurg", "Kalyandurg", "Penukonda", "Puttaparthi", "Kadiri", "Palakonda"],
  "Arunachal Pradesh": ["Itanagar", "Naharlagun", "Pasighat", "Tawang", "Bomdila", "Ziro", "Along (Aalo)", "Tezu", "Roing", "Namsai", "Changlang", "Khonsa", "Seppa", "Daporijo", "Yingkiong", "Anini", "Koloriang", "Basar", "Jairampur", "Miao", "Deomali", "Bordumsa", "Lekang", "Wakro", "Dirang", "Rupa", "Bhalukpong", "Doimukh", "Nirjuli", "Yupia", "Sagalee", "Palin", "Mechuka", "Hawai", "Hayuliang", "Mariyang", "Tuting", "Boleng", "Likabali"],
  "Assam": ["Guwahati", "Dispur", "Silchar", "Dibrugarh", "Jorhat", "Tezpur", "Tinsukia", "Nagaon", "Sivasagar", "Bongaigaon", "Barpeta", "Barpeta Road", "Dhubri", "Goalpara", "Kokrajhar", "Karimganj", "Hailakandi", "Haflong", "Diphu", "North Lakhimpur", "Dhemaji", "Duliajan", "Digboi", "Margherita", "Naharkatia", "Moran", "Nazira", "Sonari", "Golaghat", "Dergaon", "Bokakhat", "Numaligarh", "Biswanath Chariali", "Rangia", "Nalbari", "Mangaldoi", "Pathsala", "Bajali", "Howly", "Sorbhog", "Abhayapuri", "Bilasipara", "Gauripur", "Chapar", "Lakhipur", "Hojai", "Lanka", "Lumding", "Doboka", "Kampur", "Raha", "Morigaon", "Jagiroad", "Sonapur", "Hajo", "Sualkuchi", "Palasbari", "North Guwahati", "Baihata Chariali", "Changsari", "Amingaon", "Titabor", "Mariani", "Sarupathar", "Furkating", "Doom Dooma", "Makum", "Chabua", "Ledo", "Namrup", "Simaluguri", "Amguri", "Gohpur", "Narayanpur", "Bihpuria", "Jonai", "Silapathar", "Dhekiajuli", "Rangapara", "Udalguri", "Tangla", "Gossaigaon", "Bijni", "Basugaon", "Kajalgaon", "Mushalpur", "Hamren", "Bokajan", "Badarpur", "Panchgram"],
  "Bihar": ["Patna", "Gaya", "Muzaffarpur", "Bhagalpur", "Darbhanga", "Purnia", "Bihar Sharif", "Ara", "Begusarai", "Katihar", "Munger", "Chapra", "Samastipur", "Hajipur", "Bettiah", "Motihari", "Sitamarhi", "Madhubani", "Saharsa", "Supaul", "Madhepura", "Araria", "Kishanganj", "Forbesganj", "Jogbani", "Khagaria", "Jamalpur", "Lakhisarai", "Sheikhpura", "Nawada", "Jamui", "Banka", "Buxar", "Sasaram", "Dehri", "Bhabua", "Mohania", "Aurangabad", "Jehanabad", "Arwal", "Hilsa", "Rajgir", "Islampur", "Bakhtiyarpur", "Barh", "Mokama", "Fatuha", "Danapur", "Phulwari Sharif", "Masaurhi", "Bihta", "Maner", "Dighwara", "Sonepur", "Revelganj", "Marhaura", "Siwan", "Maharajganj", "Gopalganj", "Mirganj", "Barauli", "Thawe", "Raxaul", "Narkatiaganj", "Bagaha", "Ramnagar", "Chanpatia", "Sugauli", "Chakia", "Dhaka", "Sheohar", "Bairgania", "Pupri", "Benipatti", "Jhanjharpur", "Jaynagar", "Rosera", "Dalsinghsarai", "Tajpur", "Hasanpur", "Mahnar", "Lalganj", "Mahua", "Patori", "Barhiya", "Barbigha", "Warisaliganj", "Hisua", "Sherghati", "Tekari", "Daudnagar", "Rafiganj", "Nabinagar", "Bikramganj", "Nokha", "Dinara", "Dumraon", "Naugachhia", "Kahalgaon", "Sultanganj", "Amarpur", "Bounsi", "Banmankhi", "Kasba", "Dhamdaha", "Bahadurganj", "Thakurganj", "Raniganj", "Triveniganj", "Birpur", "Simrahi"],
  "Chhattisgarh": ["Raipur", "Bhilai", "Durg", "Bilaspur", "Korba", "Rajnandgaon", "Jagdalpur", "Raigarh", "Ambikapur", "Dhamtari", "Mahasamund", "Kawardha", "Bhatapara", "Baloda Bazar", "Tilda Newra", "Arang", "Abhanpur", "Gobra Nawapara", "Kharora", "Kurud", "Magarlod", "Nagri", "Charama", "Kanker", "Bhanupratappur", "Antagarh", "Kondagaon", "Narayanpur", "Dantewada", "Geedam", "Sukma", "Konta", "Bijapur", "Bhopalpatnam", "Kirandul", "Bacheli", "Barsur", "Dongargarh", "Dongargaon", "Khairagarh", "Chhuikhadan", "Gandai", "Mohla", "Manpur", "Balod", "Dalli-Rajhara", "Gunderdehi", "Gurur", "Dondi", "Dondi Lohara", "Patan", "Utai", "Kumhari", "Ahiwara", "Jamul", "Berla", "Saja", "Bemetara", "Nawagarh", "Mungeli", "Lormi", "Takhatpur", "Ratanpur", "Kota", "Pendra", "Gaurela", "Marwahi", "Sakti", "Champa", "Janjgir", "Akaltara", "Naila Janjgir", "Baloda", "Pamgarh", "Shivrinarayan", "Kharod", "Sarangarh", "Baramkela", "Kharsia", "Dharamjaigarh", "Gharghoda", "Tamnar", "Pathalgaon", "Jashpur Nagar", "Kunkuri", "Bagicha", "Sitapur", "Surajpur", "Bishrampur", "Baikunthpur", "Manendragarh", "Chirmiri", "Pratappur", "Wadrafnagar", "Ramanujganj", "Balrampur"],
  "Goa": ["Panaji", "Margao", "Vasco da Gama", "Mapusa", "Ponda", "Bicholim", "Curchorem", "Sanquelim", "Valpoi", "Canacona", "Pernem", "Quepem", "Sanguem", "Cuncolim", "Navelim", "Fatorda", "Verna", "Cortalim", "Chicalim", "Dabolim", "Colva", "Calangute", "Candolim", "Anjuna", "Vagator", "Siolim", "Arpora", "Porvorim", "Aldona", "Saligao", "Reis Magos", "Bambolim", "Dona Paula", "Taleigao", "Ribandar", "Old Goa", "Mandrem", "Arambol", "Morjim", "Assagao", "Tivim", "Colvale", "Betim", "Nerul", "Betul", "Benaulim", "Varca", "Cavelossim", "Mobor", "Majorda", "Utorda", "Bogmalo", "Agonda", "Palolem", "Chaudi", "Shiroda", "Usgao", "Mollem", "Dharbandora"],
  "Gujarat": ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Gandhinagar", "Bhavnagar", "Jamnagar", "Junagadh", "Anand", "Nadiad", "Bharuch", "Ankleshwar", "Vapi", "Valsad", "Navsari", "Morbi", "Mehsana", "Patan", "Palanpur", "Deesa", "Siddhpur", "Unjha", "Visnagar", "Kadi", "Kalol", "Himmatnagar", "Modasa", "Idar", "Prantij", "Talod", "Khedbrahma", "Dahod", "Godhra", "Halol", "Lunawada", "Santrampur", "Zalod", "Limkheda", "Chhota Udaipur", "Bodeli", "Dabhoi", "Karjan", "Padra", "Savli", "Waghodia", "Petlad", "Borsad", "Khambhat", "Umreth", "Sojitra", "Dakor", "Kapadvanj", "Mahemdabad", "Kheda", "Dholka", "Bavla", "Sanand", "Viramgam", "Dhandhuka", "Botad", "Gadhada", "Barwala", "Palitana", "Mahuva", "Talaja", "Sihor", "Vallabhipur", "Amreli", "Savarkundla", "Rajula", "Jafrabad", "Bagasara", "Lathi", "Babra", "Dhari", "Kodinar", "Una", "Veraval", "Somnath", "Mangrol", "Keshod", "Manavadar", "Vanthali", "Visavadar", "Porbandar", "Ranavav", "Kutiyana", "Dwarka", "Khambhalia", "Bhanvad", "Jamjodhpur", "Kalavad", "Dhrol", "Lalpur", "Gondal", "Jetpur", "Dhoraji", "Upleta", "Jasdan", "Wankaner", "Tankara", "Halvad", "Surendranagar", "Wadhwan", "Limbdi", "Chotila", "Dhrangadhra", "Thangadh", "Bhuj", "Gandhidham", "Anjar", "Mandvi", "Mundra", "Rapar", "Bhachau", "Nakhatrana", "Adipur", "Kandla", "Vyara", "Songadh", "Bardoli", "Mandvi (Surat)", "Olpad", "Kamrej", "Palsana", "Bilimora", "Gandevi", "Chikhli", "Dharampur", "Pardi", "Umbergaon", "Silvassa (Union Territory)", "Rajpipla", "Kevadia (Ekta Nagar)", "Netrang", "Jambusar", "Amod", "Hansot", "Kosamba", "Kim"],
  "Haryana": ["Gurugram", "Faridabad", "Panipat", "Ambala", "Hisar", "Karnal", "Rohtak", "Sonipat", "Yamunanagar", "Panchkula", "Kurukshetra", "Rewari", "Sirsa", "Bhiwani", "Jind", "Kaithal", "Palwal", "Nuh", "Bahadurgarh", "Jhajjar", "Charkhi Dadri", "Mahendragarh", "Narnaul", "Fatehabad", "Hansi", "Tohana", "Ratia", "Ellenabad", "Dabwali", "Kalanwali", "Barwala", "Narwana", "Safidon", "Uchana", "Julana", "Gohana", "Ganaur", "Kharkhoda", "Samalkha", "Israna", "Assandh", "Gharaunda", "Nilokheri", "Indri", "Taraori", "Shahbad", "Ladwa", "Pehowa", "Thanesar", "Radaur", "Jagadhri", "Chhachhrauli", "Bilaspur", "Naraingarh", "Barara", "Mullana", "Kalka", "Pinjore", "Raipur Rani", "Sohna", "Pataudi", "Manesar", "Farrukhnagar", "Hodal", "Hathin", "Ballabhgarh", "Tigaon", "Punhana", "Ferozepur Jhirka", "Tauru", "Nangal Chaudhary", "Kanina", "Ateli", "Kosli", "Bawal", "Dharuhera", "Beri", "Kalanaur", "Meham", "Tosham", "Loharu", "Siwani", "Bawani Khera", "Pundri", "Cheeka", "Kalayat", "Nissing", "Babain"],
  "Himachal Pradesh": ["Shimla", "Dharamshala", "Solan", "Mandi", "Kullu", "Manali", "Hamirpur", "Una", "Bilaspur", "Chamba", "Nahan", "Baddi", "Nalagarh", "Parwanoo", "Kasauli", "Arki", "Theog", "Rohru", "Rampur Bushahr", "Narkanda", "Jubbal", "Kotkhai", "Chopal", "Kumarsain", "Sundernagar", "Jogindernagar", "Sarkaghat", "Ner Chowk", "Karsog", "Padhar", "Gohar", "Rewalsar", "Palampur", "Kangra", "Nurpur", "Dehra Gopipur", "Jawalamukhi", "Baijnath", "Paprola", "Nagrota Bagwan", "Shahpur", "Indora", "Fatehpur", "Dalhousie", "Khajjiar", "Bharmour", "Tissa", "Banikhet", "Paonta Sahib", "Rajgarh", "Renuka Ji", "Shillai", "Amb", "Gagret", "Mehatpur", "Bangana", "Haroli", "Nadaun", "Sujanpur Tira", "Barsar", "Bhota", "Ghumarwin", "Naina Devi", "Swarghat", "Keylong", "Kaza", "Reckong Peo", "Kalpa", "Sangla", "Pooh", "Udaipur (Lahaul)", "Tabo"],
  "Jharkhand": ["Ranchi", "Jamshedpur", "Dhanbad", "Bokaro Steel City", "Deoghar", "Hazaribagh", "Giridih", "Ramgarh", "Phusro", "Medininagar", "Chaibasa", "Dumka", "Sahibganj", "Pakur", "Godda", "Jamtara", "Madhupur", "Mihijam", "Chirkunda", "Nirsa", "Sindri", "Katras", "Jharia", "Gomoh", "Topchanchi", "Rajganj", "Tundi", "Chandrapura", "Bermo", "Gomia", "Petarwar", "Chas", "Chandankiyari", "Tenughat", "Ramgarh Cantonment", "Patratu", "Kuju", "Barkakana", "Gola", "Mandu", "Simdega", "Gumla", "Lohardaga", "Khunti", "Torpa", "Kolebira", "Jaldega", "Latehar", "Balumath", "Chandwa", "Manika", "Garhwa", "Nagar Untari", "Bhawnathpur", "Bishrampur", "Hussainabad", "Chhatarpur", "Hariharganj", "Panki", "Barwadih", "Daltonganj", "Chatra", "Hunterganj", "Itkhori", "Koderma", "Jhumri Telaiya", "Domchanch", "Barhi", "Barkatha", "Bishnugarh", "Bagodar", "Rajdhanwar", "Jamua", "Sarath", "Jasidih", "Basukinath", "Mahagama", "Pathargama", "Rajmahal", "Barharwa", "Barhait", "Tinpahar", "Chakradharpur", "Adityapur", "Gamharia", "Mango", "Jugsalai", "Ghatsila", "Musabani", "Baharagora", "Seraikela", "Kharsawan", "Chandil", "Ichagarh"],
  "Karnataka": ["Bengaluru", "Mysuru", "Mangaluru", "Hubballi", "Dharwad", "Belagavi", "Kalaburagi", "Davanagere", "Ballari", "Vijayapura", "Shivamogga", "Tumakuru", "Udupi", "Hassan", "Hosapete", "Raichur", "Bidar", "Chikkamagaluru", "Kolar", "Mandya", "Bagalkot", "Gadag", "Haveri", "Chitradurga", "Chikkaballapur", "Ramanagara", "Chamarajanagar", "Yadgir", "Koppal", "Karwar", "Sirsi", "Dandeli", "Kumta", "Honnavar", "Bhatkal", "Ankola", "Haliyal", "Yellapur", "Mundgod", "Siddapur", "Joida", "Gokarna", "Murdeshwar", "Kundapura", "Karkala", "Brahmavar", "Byndoor", "Kapu", "Hebri", "Puttur", "Bantwal", "Moodbidri", "Ullal", "Mulki", "Sullia", "Belthangady", "Dharmasthala", "Vittal", "Surathkal", "Kadaba", "Sakleshpur", "Belur", "Arsikere", "Channarayapatna", "Holenarasipura", "Alur", "Arkalgud", "Shravanabelagola", "Madikeri", "Kushalnagar", "Virajpet", "Somwarpet", "Gonikoppal", "Ponnampet", "Napoklu", "Kollegala", "Gundlupet", "Yelandur", "Hanur", "Nanjangud", "Hunsur", "Periyapatna", "T. Narasipura", "K.R. Nagar", "H.D. Kote", "Bannur", "Srirangapatna", "Maddur", "Malavalli", "Nagamangala", "Pandavapura", "K.R. Pet", "Channapatna", "Kanakapura", "Magadi", "Bidadi", "Harohalli", "Devanahalli", "Doddaballapura", "Nelamangala", "Hoskote", "Anekal", "Attibele", "Sarjapura", "Jigani", "Bommasandra", "Chandapura", "Kolar Gold Fields", "Bangarapet", "Malur", "Mulbagal", "Srinivaspur", "Chintamani", "Sidlaghatta", "Gauribidanur", "Bagepalli", "Gudibanda", "Tiptur", "Gubbi", "Kunigal", "Sira", "Madhugiri", "Pavagada", "Turuvekere", "Chikkanayakanahalli", "Koratagere", "Harihar", "Honnali", "Channagiri", "Jagalur", "Nyamathi", "Bhadravati", "Sagar", "Shikaripura", "Soraba", "Tirthahalli", "Hosanagara", "Ripponpet", "Kadur", "Tarikere", "Koppa", "Sringeri", "Mudigere", "Narasimharajapura", "Ajjampura", "Birur", "Siruguppa", "Sandur", "Kampli", "Kurugodu", "Kottur", "Kudligi", "Hagaribommanahalli", "Harapanahalli", "Hospet", "Gangavathi", "Kushtagi", "Yelburga", "Kanakagiri", "Karatagi", "Sindhanur", "Manvi", "Lingasugur", "Maski", "Devadurga", "Sirwar", "Sedam", "Chittapur", "Afzalpur", "Aland", "Jewargi", "Chincholi", "Shahabad", "Wadi", "Shahapur", "Shorapur", "Gurmitkal", "Hunasagi", "Basavakalyan", "Bhalki", "Humnabad", "Aurad", "Chitguppa", "Indi", "Sindagi", "Muddebihal", "Basavana Bagewadi", "Talikoti", "Devar Hippargi", "Tikota", "Chadchan", "Badami", "Jamkhandi", "Mudhol", "Bilgi", "Hungund", "Ilkal", "Rabkavi Banhatti", "Mahalingpur", "Teradal", "Guledgudd", "Gokak", "Athani", "Chikkodi", "Nipani", "Bailhongal", "Saundatti", "Ramdurg", "Hukkeri", "Khanapur", "Kittur", "Raibag", "Sankeshwar", "Mudalagi", "Betageri", "Ron", "Nargund", "Mundargi", "Shirahatti", "Lakshmeshwar", "Gajendragad", "Ranebennur", "Byadgi", "Hirekerur", "Savanur", "Shiggaon", "Hangal", "Bankapura", "Rattihalli", "Navalgund", "Kundgol", "Kalghatgi", "Annigeri", "Alnavar"],
  "Kerala": ["Thiruvananthapuram", "Kochi", "Kozhikode", "Thrissur", "Kollam", "Kannur", "Alappuzha", "Palakkad", "Kottayam", "Malappuram", "Manjeri", "Kasaragod", "Pathanamthitta", "Ponnani", "Tirur", "Perinthalmanna", "Nilambur", "Kondotty", "Tanur", "Kottakkal", "Valanchery", "Parappanangadi", "Feroke", "Ramanattukara", "Koyilandy", "Vadakara", "Payyoli", "Mukkom", "Thamarassery", "Balussery", "Koduvally", "Thalassery", "Taliparamba", "Payyanur", "Mattannur", "Iritty", "Panoor", "Koothuparamba", "Anthoor", "Sreekandapuram", "Kanhangad", "Nileshwaram", "Cheruvathur", "Uppala", "Manjeshwaram", "Bekal", "Hosdurg", "Sulthan Bathery", "Kalpetta", "Mananthavady", "Vythiri", "Meppadi", "Pulpally", "Ambalavayal", "Changanassery", "Pala", "Ettumanoor", "Vaikom", "Erattupetta", "Kanjirappally", "Mundakayam", "Ponkunnam", "Thodupuzha", "Muvattupuzha", "Kothamangalam", "Perumbavoor", "Aluva", "Angamaly", "Kalamassery", "Thrippunithura", "Maradu", "Eloor", "North Paravur", "Piravom", "Koothattukulam", "Cherthala", "Kayamkulam", "Mavelikkara", "Chengannur", "Haripad", "Ambalappuzha", "Kuttanad", "Adoor", "Thiruvalla", "Pandalam", "Ranni", "Konni", "Mallappally", "Punalur", "Kottarakkara", "Karunagappally", "Paravur", "Chavara", "Anchal", "Pathanapuram", "Varkala", "Attingal", "Neyyattinkara", "Nedumangad", "Kazhakkoottam", "Kovalam", "Balaramapuram", "Kattakada", "Vithura", "Ponmudi", "Guruvayur", "Chavakkad", "Kunnamkulam", "Irinjalakuda", "Chalakudy", "Kodungallur", "Wadakkanchery", "Ottapalam", "Shoranur", "Pattambi", "Mannarkkad", "Chittur", "Alathur", "Cherpulassery", "Kuzhalmannam", "Nenmara", "Kollengode", "Munnar", "Adimali", "Kumily", "Kattappana", "Nedumkandam", "Peermade", "Vandiperiyar", "Devikulam"],
  "Madhya Pradesh": ["Bhopal", "Indore", "Jabalpur", "Gwalior", "Ujjain", "Sagar", "Rewa", "Satna", "Ratlam", "Dewas", "Burhanpur", "Khandwa", "Chhindwara", "Morena", "Singrauli", "Vidisha", "Sehore", "Raisen", "Hoshangabad (Narmadapuram)", "Itarsi", "Harda", "Betul", "Multai", "Amla", "Sarni", "Pipariya", "Sohagpur", "Pachmarhi", "Babai", "Budhni", "Ashta", "Ichhawar", "Nasrullaganj (Bhairunda)", "Shujalpur", "Kalapipal", "Mandsaur", "Neemuch", "Jaora", "Nagda", "Khachrod", "Mahidpur", "Tarana", "Badnagar", "Agar Malwa", "Susner", "Nalkheda", "Shajapur", "Maksi", "Sonkatch", "Hatpipliya", "Kannod", "Khategaon", "Bagli", "Manawar", "Dhar", "Pithampur", "Badnawar", "Sardarpur", "Kukshi", "Rajgarh", "Biaora", "Narsinghgarh", "Sarangpur", "Pachore", "Khilchipur", "Jirapur", "Guna", "Raghogarh", "Chachoda", "Aron", "Ashoknagar", "Chanderi", "Mungaoli", "Shivpuri", "Karera", "Pichhore", "Kolaras", "Pohri", "Sheopur", "Vijaypur", "Baroda", "Datia", "Seondha", "Bhander", "Bhind", "Gohad", "Lahar", "Mehgaon", "Ambah", "Porsa", "Sabalgarh", "Joura", "Kailaras", "Dabra", "Bhitarwar", "Tekanpur", "Orchha", "Niwari", "Prithvipur", "Tikamgarh", "Jatara", "Palera", "Khargapur", "Chhatarpur", "Nowgong", "Maharajpur", "Rajnagar", "Bijawar", "Bada Malhera", "Panna", "Ajaygarh", "Pawai", "Devendranagar", "Katni", "Murwara", "Maihar", "Nagod", "Amarpatan", "Rampur Baghelan", "Sidhi", "Churhat", "Rampur Naikin", "Waidhan", "Bargawan", "Deosar", "Shahdol", "Burhar", "Dhanpuri", "Beohari", "Jaisinghnagar", "Umaria", "Pali", "Nowrozabad", "Anuppur", "Kotma", "Bijuri", "Amarkantak", "Dindori", "Shahpura", "Mandla", "Nainpur", "Bichhiya", "Niwas", "Seoni", "Lakhnadon", "Barghat", "Chhapara", "Keolari", "Balaghat", "Waraseoni", "Katangi", "Baihar", "Lanji", "Paraswada", "Pandhurna", "Sausar", "Amarwara", "Parasia", "Junnardeo", "Harrai", "Narsinghpur", "Gadarwara", "Kareli", "Gotegaon", "Tendukheda", "Damoh", "Hatta", "Patharia", "Jabera", "Khurai", "Bina", "Rehli", "Garhakota", "Rahatgarh", "Deori", "Banda", "Khargone", "Barwaha", "Sanawad", "Kasrawad", "Maheshwar", "Mandleshwar", "Bhikangaon", "Barwani", "Sendhwa", "Anjad", "Pansemal", "Rajpur", "Alirajpur", "Jobat", "Bhabra", "Jhabua", "Thandla", "Petlawad", "Meghnagar", "Ranapur", "Nepanagar", "Harsud"],
  "Maharashtra": ["Mumbai", "Pune", "Nagpur", "Nashik", "Thane", "Navi Mumbai", "Chhatrapati Sambhajinagar", "Solapur", "Kolhapur", "Amravati", "Akola", "Nanded", "Jalgaon", "Sangli", "Satara", "Latur", "Ahmednagar (Ahilyanagar)", "Ratnagiri", "Chandrapur", "Dhule", "Malegaon", "Bhiwandi", "Kalyan", "Dombivli", "Ulhasnagar", "Ambernath", "Badlapur", "Mira-Bhayandar", "Vasai", "Virar", "Palghar", "Boisar", "Dahanu", "Talasari", "Jawhar", "Mokhada", "Wada", "Vikramgad", "Shahapur", "Murbad", "Karjat", "Khopoli", "Panvel", "Uran", "Pen", "Alibag", "Roha", "Mahad", "Mangaon", "Shrivardhan", "Murud", "Matheran", "Lonavala", "Khandala", "Talegaon Dabhade", "Chakan", "Rajgurunagar", "Shirur", "Ranjangaon", "Baramati", "Daund", "Indapur", "Saswad", "Jejuri", "Junnar", "Narayangaon", "Manchar", "Bhor", "Velhe", "Mulshi", "Pimpri-Chinchwad", "Dehu", "Alandi", "Talegaon", "Phaltan", "Karad", "Wai", "Mahabaleshwar", "Panchgani", "Koregaon", "Rahimatpur", "Vaduj", "Dahiwadi", "Mhaswad", "Patan", "Koynanagar", "Islampur", "Ashta", "Tasgaon", "Vita", "Palus", "Kavathe Mahankal", "Jat", "Miraj", "Kupwad", "Ichalkaranji", "Jaysingpur", "Kurundwad", "Kagal", "Gadhinglaj", "Ajra", "Chandgad", "Panhala", "Malkapur", "Shahuwadi", "Radhanagari", "Gargoti", "Kankavli", "Kudal", "Sawantwadi", "Vengurla", "Malvan", "Devgad", "Vaibhavwadi", "Dodamarg", "Chiplun", "Khed", "Dapoli", "Guhagar", "Lanja", "Rajapur", "Sangameshwar", "Mandangad", "Ganpatipule", "Pandharpur", "Barshi", "Akkalkot", "Sangola", "Mangalwedha", "Karmala", "Madha", "Kurduwadi", "Mohol", "Akluj", "Malshiras", "Tembhurni", "Osmanabad (Dharashiv)", "Tuljapur", "Omerga", "Kalamb", "Paranda", "Bhoom", "Washi", "Naldurg", "Beed", "Georai", "Majalgaon", "Parli Vaijnath", "Ambajogai", "Kaij", "Ashti", "Patoda", "Shirur Kasar", "Dharur", "Wadwani", "Jalna", "Ambad", "Partur", "Bhokardan", "Jafrabad", "Badnapur", "Ghansawangi", "Mantha", "Paithan", "Gangapur", "Vaijapur", "Sillod", "Kannad", "Khuldabad", "Soygaon", "Phulambri", "Deglur", "Mukhed", "Kandhar", "Loha", "Hadgaon", "Himayatnagar", "Bhokar", "Biloli", "Naigaon", "Dharmabad", "Umri", "Kinwat", "Mahur", "Ardhapur", "Udgir", "Ausa", "Nilanga", "Ahmedpur", "Chakur", "Renapur", "Shirur Anantpal", "Jalkot", "Deoni", "Parbhani", "Gangakhed", "Jintur", "Selu", "Pathri", "Manwath", "Purna", "Sonpeth", "Palam", "Hingoli", "Kalamnuri", "Basmat", "Sengaon", "Aundha Nagnath", "Washim", "Karanja Lad", "Mangrulpir", "Risod", "Malegaon (Washim)", "Manora", "Akot", "Balapur", "Murtijapur", "Telhara", "Patur", "Barshitakli", "Buldhana", "Khamgaon", "Shegaon", "Nandura", "Jalgaon Jamod", "Chikhli", "Deulgaon Raja", "Mehkar", "Lonar", "Sindkhed Raja", "Motala", "Sangrampur", "Yavatmal", "Pusad", "Wani", "Digras", "Darwha", "Umarkhed", "Ghatanji", "Pandharkawada", "Ralegaon", "Arni", "Babhulgaon", "Ner", "Mahagaon", "Achalpur", "Paratwada", "Chandur Bazar", "Chandur Railway", "Daryapur", "Anjangaon Surji", "Warud", "Morshi", "Dhamangaon Railway", "Nandgaon Khandeshwar", "Chikhaldara", "Kamptee", "Hingna", "Butibori", "Umred", "Katol", "Narkhed", "Saoner", "Kalmeshwar", "Ramtek", "Parseoni", "Mouda", "Kuhi", "Bhiwapur", "Wardha", "Hinganghat", "Arvi", "Pulgaon", "Deoli", "Seloo", "Sindi", "Samudrapur", "Ballarpur", "Warora", "Bhadravati", "Rajura", "Mul", "Brahmapuri", "Nagbhid", "Chimur", "Sindewahi", "Gadchandur", "Gondpipri", "Korpana", "Gadchiroli", "Armori", "Desaiganj", "Chamorshi", "Aheri", "Sironcha", "Dhanora", "Kurkheda", "Bhamragad", "Etapalli", "Gondia", "Tirora", "Amgaon", "Deori", "Arjuni Morgaon", "Goregaon", "Salekasa", "Sadak Arjuni", "Bhandara", "Tumsar", "Pauni", "Sakoli", "Lakhandur", "Mohadi", "Lakhani", "Sinnar", "Igatpuri", "Trimbakeshwar", "Niphad", "Lasalgaon", "Yeola", "Nandgaon", "Manmad", "Satana", "Kalwan", "Dindori", "Pimpalgaon Baswant", "Ozar", "Chandwad", "Deola", "Surgana", "Peth", "Shirpur", "Dondaicha", "Sakri", "Sindkheda", "Nandurbar", "Shahada", "Taloda", "Akkalkuwa", "Navapur", "Dhadgaon", "Bhusawal", "Chalisgaon", "Pachora", "Amalner", "Chopda", "Raver", "Yawal", "Savda", "Faizpur", "Erandol", "Dharangaon", "Parola", "Bhadgaon", "Jamner", "Bodwad", "Muktainagar"],
  "Manipur": ["Imphal", "Thoubal", "Kakching", "Bishnupur", "Churachandpur", "Ukhrul", "Senapati", "Tamenglong", "Jiribam", "Moreh", "Moirang", "Nambol", "Wangoi", "Lilong", "Mayang Imphal", "Yairipok", "Wangkhem", "Heirok", "Sugnu", "Waikhong", "Hiyanglam", "Kumbi", "Oinam", "Ningthoukhong", "Khangabok", "Khongjom", "Sekmai", "Lamshang", "Lamlai", "Andro", "Yambem", "Porompat", "Lamlong", "Khurai", "Singjamei", "Wangjing", "Pallel", "Tengnoupal", "Machi", "Kasom Khullen", "Kamjong", "Phungyar", "Jessami", "Chandel", "Chakpikarong", "Pherzawl", "Parbung", "Thanlon", "Henglep", "Kangpokpi", "Saitu", "Saikul", "Motbung", "Noney", "Nungba", "Tamei", "Tousem", "Khoupum", "Mao", "Maram", "Tadubi", "Paomata"],
  "Meghalaya": ["Shillong", "Tura", "Jowai", "Nongstoin", "Williamnagar", "Baghmara", "Resubelpara", "Khliehriat", "Nongpoh", "Mairang", "Sohra", "Pynursla", "Mawphlang", "Mawkyrwat", "Ranikor", "Amlarem", "Dawki", "Sutnga", "Lad Rymbai", "Cherrapunji", "Shella", "Umsning", "Byrnihat", "Khanapara", "Umiam", "Ri Bhoi", "Mendipathar", "Bajengdoba", "Dadenggre", "Tikrikilla", "Phulbari", "Mahendraganj", "Ampati", "Salmanpara", "Dalu", "Rongram", "Selsella", "Chokpot", "Rongjeng", "Songsak", "Samanda", "Nartiang", "Shangpung", "Laskein", "Raliang", "Nongtalang", "Umkiang"],
  "Mizoram": ["Aizawl", "Lunglei", "Champhai", "Kolasib", "Serchhip", "Saiha", "Lawngtlai", "Mamit", "Saitual", "Khawzawl", "Hnahthial", "Vairengte", "Bairabi", "Bilkhawthlir", "Kawnpui", "Thingdawl", "Zawlnuam", "West Phaileng", "Lengpui", "Sairang", "Darlawn", "Seling", "Keifang", "Thenzawl", "North Vanlaiphai", "East Lungdar", "Hmuifang", "Hualngohmun", "Biate", "Khawhai", "Khawbung", "Zokhawthar", "Ngopa", "Farkawn", "Dungtlang", "Tlabung", "Bunghmun", "Chawngte", "Sangau", "Tuipang", "Phura", "Bualpui", "Demagiri"],
  "Nagaland": ["Kohima", "Dimapur", "Mokokchung", "Wokha", "Tuensang", "Mon", "Zunheboto", "Phek", "Kiphire", "Longleng", "Peren", "Chumoukedima", "Niuland", "Tseminyu", "Shamator", "Noklak", "Pfutsero", "Chozuba", "Meluri", "Jalukie", "Tening", "Medziphema", "Seithekema", "Sovima", "Diphupar", "Kuhuboto", "Dhansiripar", "Bhandari", "Sanis", "Wozhuro", "Aboi", "Tizit", "Naginimora", "Wakching", "Tobu", "Chen", "Mangkolemba", "Changtongya", "Tuli", "Longchem", "Akuluto", "Aghunato", "Satakha", "Suruhuto", "Seyochung", "Pungro", "Thonoknyu", "Chessore", "Noksen", "Longkhim", "Chare", "Chingmei", "Angjangyang"],
  "Odisha": ["Bhubaneswar", "Cuttack", "Rourkela", "Berhampur", "Sambalpur", "Puri", "Balasore", "Baripada", "Bhadrak", "Jharsuguda", "Jeypore", "Angul", "Dhenkanal", "Kendujhar", "Balangir", "Bargarh", "Bhawanipatna", "Rayagada", "Koraput", "Nabarangpur", "Malkangiri", "Paralakhemundi", "Chhatrapur", "Aska", "Hinjilicut", "Digapahandi", "Bhanjanagar", "Polasara", "Buguda", "Kodala", "Kabisuryanagar", "Gopalpur", "Rambha", "Khallikote", "Purushottampur", "Sorada", "Dharakote", "Patrapur", "Chikiti", "Sunabeda", "Semiliguda", "Kotpad", "Boipariguda", "Laxmipur", "Kundra", "Borigumma", "Umerkote", "Dabugam", "Papadahandi", "Tentulikhunti", "Jharigam", "Chandahandi", "Raighar", "Mathili", "Kalimela", "Chitrakonda", "Balimela", "Motu", "Muniguda", "Gunupur", "Gudari", "Bissam Cuttack", "Padmapur", "Kashipur", "Tikiri", "Therubali", "Kalyansinghpur", "Phulbani", "Baliguda", "G. Udayagiri", "Daringbadi", "Raikia", "Tikabali", "K. Nuagaon", "Kotagarh", "Boudh", "Kantamal", "Harabhanga", "Sonepur", "Binka", "Tarbha", "Dunguripali", "Ulunda", "Patnagarh", "Titlagarh", "Kantabanji", "Tusura", "Saintala", "Loisingha", "Khaprakhol", "Belpara", "Bangomunda", "Khariar", "Nuapada", "Sinapali", "Boden", "Komna", "Jonk", "Dharmagarh", "Junagarh", "Kesinga", "Narla", "Lanjigarh", "Kokasara", "Golamunda", "Jaipatna", "Thuamul Rampur", "Karlamunda", "Rengali", "Kuchinda", "Rairakhol", "Bamra", "Burla", "Hirakud", "Brajarajnagar", "Belpahar", "Lakhanpur", "Laikera", "Kolabira", "Sundargarh", "Rajgangpur", "Biramitrapur", "Bonai", "Lahunipara", "Koida", "Lathikata", "Kutra", "Talsara", "Hemgir", "Lephripara", "Deogarh", "Barkote", "Reamal", "Tileibani", "Talcher", "Athmallik", "Pallahara", "Banarpal", "Chhendipada", "Kaniha", "Kamakhyanagar", "Bhuban", "Hindol", "Gondia", "Parjang", "Odapada", "Jajpur", "Jajpur Road", "Vyasanagar", "Dharmasala", "Binjharpur", "Bari", "Dasarathpur", "Korei", "Sukinda", "Danagadi", "Kendrapara", "Pattamundai", "Rajnagar", "Aul", "Rajkanika", "Mahakalapada", "Marsaghai", "Derabish", "Jagatsinghpur", "Paradeep", "Kujang", "Tirtol", "Raghunathpur", "Balikuda", "Ersama", "Naugaon", "Nimapara", "Pipili", "Konark", "Satyabadi", "Brahmagiri", "Kakatpur", "Astaranga", "Delanga", "Khordha", "Jatni", "Banapur", "Balugaon", "Tangi", "Begunia", "Bolagarh", "Nayagarh", "Khandapada", "Daspalla", "Ranpur", "Odagaon", "Gania", "Bhapur", "Nilagiri", "Soro", "Jaleswar", "Basta", "Remuna", "Simulia", "Khaira", "Baliapal", "Bhograi", "Bahanaga", "Oupada", "Udala", "Rairangpur", "Karanjia", "Betnoti", "Bangriposi", "Bisoi", "Jashipur", "Thakurmunda", "Kaptipada", "Tiring", "Bahalda", "Champua", "Barbil", "Joda", "Anandapur", "Ghatagaon", "Harichandanpur", "Telkoi", "Patna", "Banspal", "Hatadihi", "Ghasipura"],
  "Punjab": ["Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda", "Mohali", "Hoshiarpur", "Pathankot", "Moga", "Batala", "Abohar", "Firozpur", "Kapurthala", "Sangrur", "Khanna", "Phagwara", "Barnala", "Malerkotla", "Rajpura", "Zirakpur", "Kharar", "Kurali", "Dera Bassi", "Banur", "Lalru", "Naya Gaon", "Rupnagar", "Anandpur Sahib", "Nangal", "Morinda", "Chamkaur Sahib", "Kiratpur Sahib", "Fatehgarh Sahib", "Sirhind", "Mandi Gobindgarh", "Bassi Pathana", "Amloh", "Nabha", "Samana", "Patran", "Ghanaur", "Sanaur", "Sunam", "Dhuri", "Lehragaga", "Moonak", "Bhawanigarh", "Dirba", "Ahmedgarh", "Longowal", "Cheema", "Sherpur", "Budhlada", "Mansa", "Sardulgarh", "Bareta", "Bhikhi", "Maur", "Rampura Phul", "Bhucho Mandi", "Goniana", "Talwandi Sabo", "Raman", "Bhagta Bhai Ka", "Kot Fatta", "Kot Shamir", "Muktsar", "Malout", "Gidderbaha", "Lambi", "Bariwala", "Faridkot", "Kotkapura", "Jaitu", "Bajakhana", "Sadiq", "Zira", "Makhu", "Talwandi Bhai", "Guru Har Sahai", "Mamdot", "Fazilka", "Jalalabad", "Arniwala", "Khuian Sarwar", "Balluana", "Sri Ganganagar (Rajasthan)", "Tarn Taran", "Patti", "Khem Karan", "Bhikhiwind", "Goindwal Sahib", "Khadoor Sahib", "Chohla Sahib", "Jandiala Guru", "Ajnala", "Majitha", "Rayya", "Beas", "Baba Bakala", "Ramdas", "Rajasansi", "Attari", "Gurdaspur", "Dhariwal", "Dinanagar", "Qadian", "Kalanaur", "Dera Baba Nanak", "Fatehgarh Churian", "Sri Hargobindpur", "Sujanpur", "Narot Jaimal Singh", "Shahpur Kandi", "Mukerian", "Dasuya", "Tanda Urmar", "Garhdiwala", "Hajipur", "Talwara", "Mahilpur", "Garhshankar", "Hariana", "Sham Chaurasi", "Chabbewal", "Balachaur", "Nawanshahr", "Banga", "Rahon", "Jadla", "Aur", "Phillaur", "Goraya", "Nurmahal", "Nakodar", "Shahkot", "Kartarpur", "Adampur", "Bhogpur", "Alawalpur", "Lohian Khas", "Sultanpur Lodhi", "Begowal", "Bholath", "Nadala", "Dhilwan", "Fattu Dhinga", "Sultanwind", "Samrala", "Machhiwara", "Doraha", "Sahnewal", "Raikot", "Jagraon", "Mullanpur Dakha", "Payal", "Maloud", "Sidhwan Bet", "Bagha Purana", "Nihal Singh Wala", "Dharamkot", "Badhni Kalan", "Kot Ise Khan"],
  "Rajasthan": ["Jaipur", "Jodhpur", "Udaipur", "Kota", "Ajmer", "Bikaner", "Alwar", "Bharatpur", "Bhilwara", "Sikar", "Pali", "Sri Ganganagar", "Chittorgarh", "Barmer", "Jaisalmer", "Tonk", "Bundi", "Baran", "Jhalawar", "Dausa", "Dholpur", "Karauli", "Sawai Madhopur", "Nagaur", "Didwana", "Kuchaman City", "Makrana", "Merta City", "Degana", "Ladnun", "Nawa", "Parbatsar", "Jayal", "Khinvsar", "Mundwa", "Nokha", "Kolayat", "Lunkaransar", "Sri Dungargarh", "Khajuwala", "Chhatargarh", "Anupgarh", "Suratgarh", "Raisinghnagar", "Padampur", "Sadulshahar", "Karanpur", "Kesrisinghpur", "Gajsinghpur", "Gharsana", "Vijaynagar", "Hanumangarh", "Nohar", "Bhadra", "Pilibanga", "Sangaria", "Rawatsar", "Tibbi", "Ellenabad (Haryana)", "Churu", "Ratangarh", "Sujangarh", "Sardarshahar", "Rajgarh", "Taranagar", "Bidasar", "Chhapar", "Rajaldesar", "Jhunjhunu", "Nawalgarh", "Pilani", "Chirawa", "Khetri", "Mandawa", "Mukundgarh", "Udaipurwati", "Surajgarh", "Bissau", "Fatehpur", "Laxmangarh", "Neem Ka Thana", "Sri Madhopur", "Reengus", "Khandela", "Danta Ramgarh", "Ramgarh Shekhawati", "Kotputli", "Behror", "Shahpura", "Viratnagar", "Chomu", "Sambhar", "Phulera", "Jobner", "Bagru", "Chaksu", "Bassi", "Jamwa Ramgarh", "Amer", "Kishangarh", "Nasirabad", "Beawar", "Pushkar", "Kekri", "Sarwar", "Masuda", "Bijainagar", "Bandanwara", "Gulabpura", "Jahazpur", "Mandalgarh", "Asind", "Gangapur", "Raipur", "Banera", "Hurda", "Bijoliya", "Kotri", "Mandal", "Kapasan", "Nimbahera", "Begun", "Rawatbhata", "Bari Sadri", "Dungla", "Gangrar", "Rashmi", "Bhadesar", "Pratapgarh", "Chhoti Sadri", "Dhariyawad", "Arnod", "Peepalkhoont", "Banswara", "Kushalgarh", "Garhi", "Ghatol", "Bagidora", "Sajjangarh", "Dungarpur", "Sagwara", "Aspur", "Simalwara", "Bichhiwara", "Galiyakot", "Sirohi", "Abu Road", "Mount Abu", "Pindwara", "Sheoganj", "Reodar", "Jalore", "Bhinmal", "Sanchore", "Raniwara", "Sayla", "Ahore", "Jaswantpura", "Bilara", "Pipar City", "Osian", "Phalodi", "Bap", "Bhopalgarh", "Shergarh", "Luni", "Tinwari", "Mathania", "Balesar", "Pokaran", "Fatehgarh", "Sam", "Ramgarh", "Baytu", "Balotra", "Siwana", "Pachpadra", "Gudamalani", "Chohtan", "Dhorimanna", "Sheo", "Kherwara", "Salumbar", "Gogunda", "Jhadol", "Mavli", "Vallabhnagar", "Fatehnagar", "Kanore", "Bhinder", "Nathdwara", "Rajsamand", "Kankroli", "Amet", "Deogarh", "Railmagra", "Kumbhalgarh", "Bhim", "Gangapur City", "Hindaun City", "Todabhim", "Mahwa", "Lalsot", "Bandikui", "Baswa", "Sikrai", "Mandawar", "Tijara", "Bhiwadi", "Khairthal", "Kishangarh Bas", "Govindgarh", "Lakshmangarh", "Nadbai", "Deeg", "Kaman", "Nagar", "Kumher", "Bayana", "Weir", "Rupbas", "Bari", "Rajakhera", "Baseri", "Sarmathura", "Sapotra", "Bonli", "Chauth Ka Barwara", "Khandar", "Uniara", "Niwai", "Deoli", "Malpura", "Todaraisingh", "Piplu", "Indergarh", "Lakheri", "Nainwa", "Keshoraipatan", "Mangrol", "Anta", "Chhabra", "Atru", "Kishanganj", "Shahbad", "Ramganj Mandi", "Sangod", "Itawa", "Digod", "Kanwas", "Jhalrapatan", "Bhawani Mandi", "Pirawa", "Aklera", "Khanpur", "Manohar Thana"],
  "Sikkim": ["Gangtok", "Namchi", "Gyalshing", "Mangan", "Rangpo", "Singtam", "Jorethang", "Soreng", "Pakyong", "Rongli", "Rhenock", "Rorathang", "Majitar", "Ranipool", "Tadong", "Deorali", "Arithang", "Sichey", "Burtuk", "Chandmari", "Upper Tadong", "Lower Tadong", "Tashiding", "Yuksom", "Pelling", "Dentam", "Uttarey", "Rinchenpong", "Legship", "Sombaria", "Kaluk", "Melli", "Namthang", "Ravangla", "Yangang", "Temi", "Tarku", "Makha", "Dikchu", "Chungthang", "Lachen", "Lachung", "Phodong", "Kabi", "Dzongu", "Hee Bermiok", "Martam", "Assam Lingzey", "Aritar", "Zuluk", "Kupup"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem", "Tiruppur", "Erode", "Tirunelveli", "Vellore", "Thoothukudi", "Dindigul", "Thanjavur", "Hosur", "Nagercoil", "Karur", "Kanchipuram", "Cuddalore", "Sivakasi", "Kumbakonam", "Mayiladuthurai", "Nagapattinam", "Tiruvarur", "Karaikudi", "Pudukkottai", "Ramanathapuram", "Paramakudi", "Rameswaram", "Sivaganga", "Devakottai", "Manamadurai", "Aruppukkottai", "Virudhunagar", "Rajapalayam", "Srivilliputhur", "Sattur", "Tiruchuli", "Watrap", "Sankarankovil", "Tenkasi", "Shenkottai", "Kadayanallur", "Puliyangudi", "Ambasamudram", "Cheranmahadevi", "Valliyur", "Nanguneri", "Thisayanvilai", "Kovilpatti", "Ettayapuram", "Vilathikulam", "Tiruchendur", "Kayalpattinam", "Arumuganeri", "Udangudi", "Sathankulam", "Srivaikuntam", "Eral", "Colachel", "Padmanabhapuram", "Thuckalay", "Marthandam", "Kuzhithurai", "Kaliyakkavilai", "Karungal", "Suchindram", "Bhoothapandi", "Thiruvattar", "Kanyakumari", "Palayamkottai", "Alangulam", "Surandai", "Pavoorchatram", "Papanasam", "Palani", "Oddanchatram", "Vedasandur", "Natham", "Nilakottai", "Batlagundu", "Kodaikanal", "Chinnalapatti", "Athoor", "Theni", "Periyakulam", "Bodinayakanur", "Cumbum", "Uthamapalayam", "Chinnamanur", "Andipatti", "Gudalur", "Kombai", "Devadanapatti", "Melur", "Thirumangalam", "Usilampatti", "Vadipatti", "Sholavandan", "Peraiyur", "T. Kallupatti", "Avaniyapuram", "Thiruparankundram", "Tirumangalam", "Tiruppuvanam", "Ilayangudi", "Kalaiyarkoil", "Singampunari", "Kallal", "Tirupattur (Sivaganga)", "Chettinad", "Kanadukathan", "Aranthangi", "Alangudi", "Keeranur", "Ponnamaravathi", "Gandarvakottai", "Karambakudi", "Viralimalai", "Annavasal", "Manapparai", "Lalgudi", "Musiri", "Thuraiyur", "Thottiyam", "Thiruverumbur", "Srirangam", "Samayapuram", "Pullambadi", "Uppiliapuram", "Thathiengarpet", "Perambalur", "Ariyalur", "Jayankondam", "Udayarpalayam", "Sendurai", "Kunnam", "Veppanthattai", "Alathur", "Pattukkottai", "Peravurani", "Orathanadu", "Thiruvaiyaru", "Thirukattupalli", "Vallam", "Ayyampettai", "Aduthurai", "Swamimalai", "Thirubuvanam", "Sirkazhi", "Vaitheeswaran Koil", "Tharangambadi", "Poraiyar", "Kuthalam", "Manalmedu", "Kollidam", "Velankanni", "Vedaranyam", "Thirukkuvalai", "Kilvelur", "Nagore", "Mannargudi", "Thiruthuraipoondi", "Needamangalam", "Valangaiman", "Nannilam", "Koradacheri", "Muthupet", "Chidambaram", "Neyveli", "Panruti", "Virudhachalam", "Bhuvanagiri", "Parangipettai", "Kattumannarkoil", "Kurinjipadi", "Tittakudi", "Pennadam", "Srimushnam", "Vadalur", "Nellikuppam", "Kullanchavadi", "Villupuram", "Tindivanam", "Gingee", "Kallakurichi", "Ulundurpet", "Sankarapuram", "Tirukoilur", "Marakkanam", "Vikravandi", "Vanur", "Thirunavalur", "Rishivandiyam", "Chinnasalem", "Manalurpet", "Thiyagadurgam", "Tiruvannamalai", "Arani", "Cheyyar", "Vandavasi", "Polur", "Chengam", "Kilpennathur", "Chetpet", "Kalasapakkam", "Peranamallur", "Desur", "Tiruvethipuram", "Vettavalam", "Tirupattur", "Vaniyambadi", "Ambur", "Jolarpettai", "Natrampalli", "Alangayam", "Pernambut", "Gudiyatham", "Katpadi", "Arcot", "Ranipet", "Walajapet", "Sholinghur", "Arakkonam", "Nemili", "Kaveripakkam", "Kalavai", "Timiri", "Sriperumbudur", "Uthiramerur", "Walajabad", "Kundrathur", "Mangadu", "Poonamallee", "Avadi", "Ambattur", "Tiruvallur", "Tiruttani", "Ponneri", "Gummidipoondi", "Minjur", "Tirumazhisai", "Tirunindravur", "Thiruvallur", "Pallipattu", "R.K. Pet", "Red Hills", "Madhavaram", "Manali", "Ennore", "Tiruvottiyur", "Perambur", "Kolathur", "Anna Nagar", "T. Nagar", "Adyar", "Velachery", "Tambaram", "Pallavaram", "Chromepet", "Pammal", "Anakaputhur", "Perungalathur", "Vandalur", "Guduvancheri", "Maraimalai Nagar", "Chengalpattu", "Mahabalipuram", "Thiruporur", "Kelambakkam", "Thirukazhukundram", "Madurantakam", "Acharapakkam", "Tiruporur", "Kalpakkam", "Pollachi", "Mettupalayam", "Valparai", "Sulur", "Annur", "Kinathukadavu", "Madukkarai", "Periyanaickenpalayam", "Thondamuthur", "Karamadai", "Sirumugai", "Negamam", "Anaimalai", "Udumalpet", "Palladam", "Avinashi", "Dharapuram", "Kangeyam", "Vellakoil", "Muthur", "Madathukulam", "Tiruppur North", "Tiruppur South", "Bhavani", "Gobichettipalayam", "Sathyamangalam", "Perundurai", "Chennimalai", "Kodumudi", "Anthiyur", "Nambiyur", "Modakurichi", "Ammapet", "Punjai Puliampatti", "Nallampatti", "Attur", "Mettur", "Edappadi", "Sankagiri", "Omalur", "Yercaud", "Vazhapadi", "Gangavalli", "Thalaivasal", "Pethanaickenpalayam", "Jalakandapuram", "Tharamangalam", "Mecheri", "Namakkal", "Rasipuram", "Tiruchengode", "Kumarapalayam", "Pallipalayam", "Paramathi Velur", "Mohanur", "Sendamangalam", "Kolli Hills", "Erumaipatti", "Velagoundampatti", "Dharmapuri", "Harur", "Palacode", "Pennagaram", "Pappireddipatti", "Karimangalam", "Nallampalli", "Krishnagiri", "Denkanikottai", "Uthangarai", "Bargur", "Pochampalli", "Kelamangalam", "Shoolagiri", "Thally", "Anchetty", "Nilgiris", "Ooty (Udhagamandalam)", "Coonoor", "Kotagiri", "Pandalur", "Wellington", "Ketti", "Aravankadu", "Naduvattam", "Masinagudi", "Devala", "Cherambadi"],
  "Telangana": ["Hyderabad", "Secunderabad", "Warangal", "Hanamkonda", "Karimnagar", "Nizamabad", "Khammam", "Ramagundam", "Mahabubnagar", "Siddipet", "Suryapet", "Nalgonda", "Adilabad", "Mancherial", "Kothagudem", "Sangareddy", "Medak", "Kamareddy", "Jagtial", "Peddapalli", "Nirmal", "Bodhan", "Armoor", "Korutla", "Metpally", "Vemulawada", "Sircilla", "Huzurabad", "Jammikunta", "Husnabad", "Choppadandi", "Dharmapuri", "Raikal", "Mallial", "Kathlapur", "Ibrahimpatnam", "Jagtial Rural", "Nizamabad Rural", "Banswada", "Yellareddy", "Bichkunda", "Pitlam", "Jukkal", "Madnoor", "Varni", "Navipet", "Balkonda", "Mortad", "Bheemgal", "Dichpally", "Jakranpally", "Nandipet", "Nizam Sagar", "Domakonda", "Machareddy", "Nagireddypet", "Tadwai", "Lingampet", "Rajampet", "Gandhari", "Bhiknoor", "Ramareddy", "Sadasivanagar", "Birkur", "Nasrullabad", "Rudrur", "Kotagiri", "Renjal", "Makloor", "Indalwai", "Sirikonda", "Dharpally", "Velpur", "Kammarpally", "Yergatla", "Mupkal", "Utnoor", "Ichoda", "Boath", "Bela", "Jainath", "Tamsi", "Talamadugu", "Bazarhathnoor", "Gudihatnoor", "Indervelly", "Narnoor", "Gadiguda", "Mavala", "Neredigonda", "Kerameri", "Asifabad", "Kagaznagar", "Sirpur", "Rebbena", "Wankidi", "Jainoor", "Lingapur", "Tiryani", "Bejjur", "Dahegaon", "Kouthala", "Chintalamanepally", "Penchikalpet", "Bhainsa", "Khanapur", "Mudhole", "Kubeer", "Basar", "Dilawarpur", "Mamda", "Laxmanchanda", "Sarangapur", "Kaddam", "Soan", "Narsapur G", "Pembi", "Bellampalli", "Mandamarri", "Luxettipet", "Chennur", "Jaipur", "Kotapalli", "Nennel", "Bheemaram", "Dandepalli", "Jannaram", "Kasipet", "Tandur", "Vemanpally", "Hajipur", "Ramakrishnapur", "Srirampur", "Godavarikhani", "Sultanabad", "Manthani", "Ramagiri", "Palakurthy", "Julapalli", "Eligaid", "Dharmaram", "Odela", "Kalva Srirampur", "Mutharam", "Kamanpur", "Yellandu", "Palwancha", "Bhadrachalam", "Manuguru", "Aswaraopeta", "Sathupalli", "Madhira", "Wyra", "Kusumanchi", "Nelakondapalli", "Bonakal", "Chintakani", "Tirumalayapalem", "Mudigonda", "Raghunadhapalem", "Konijerla", "Kallur", "Enkoor", "Tallada", "Penuballi", "Vemsoor", "Dammapeta", "Mulakalapalli", "Burgampahad", "Pinapaka", "Cherla", "Dummugudem", "Venkatapuram", "Wazeed", "Tekulapalli", "Gundala", "Julurpad", "Chandrugonda", "Annapureddypalli", "Sujathanagar", "Laxmidevipalli", "Aswapuram", "Karakagudem", "Kazipet", "Parkal", "Narsampet", "Wardhannapet", "Jangaon", "Station Ghanpur", "Ghanpur", "Zaffergadh", "Bachannapet", "Raghunathpalle", "Devaruppula", "Lingalaghanpur", "Kodakandla", "Cherial", "Maddur", "Komuravelli", "Dhoolmitta", "Pembarthy", "Mulugu", "Eturnagaram", "Mangapet", "Tadvai", "Govindaraopet", "Venkatapur", "Kannaigudem", "Wajedu", "Mahabubabad", "Dornakal", "Maripeda", "Thorrur", "Kesamudram", "Garla", "Bayyaram", "Kuravi", "Nellikudur", "Narsimhulapet", "Chinnagudur", "Gudur", "Kothaguda", "Gangaram", "Danthalapalle", "Pedda Vangara", "Yadadri Bhuvanagiri", "Bhongir", "Yadagirigutta", "Alair", "Mothkur", "Choutuppal", "Pochampally", "Valigonda", "Ramannapet", "Bibinagar", "Bommalaramaram", "Turkapally", "Rajapet", "Atmakur M", "Addagudur", "Narayanpur", "Miryalaguda", "Devarakonda", "Nakrekal", "Huzurnagar", "Kodad", "Nereducherla", "Tirumalagiri", "Chivvemla", "Penpahad", "Munagala", "Mellacheruvu", "Mattampally", "Palakeedu", "Garidepally", "Chilkur", "Ananthagiri", "Mothey", "Nuthankal", "Nagaram", "Jajireddygudem", "Thungathurthy", "Shaligouraram", "Kattangur", "Narketpally", "Chityal", "Munugode", "Chandur", "Marriguda", "Chintapally", "Peddavoora", "Nidamanur", "Tripuraram", "Vemulapally", "Madugulapally", "Kanagal", "Tipparthy", "Kethepally", "Kangal", "Damaracherla", "Adavidevulapally", "Gurazala (Andhra Pradesh)", "Jadcherla", "Badepally", "Narayanpet", "Makthal", "Kosgi", "Kodangal", "Gadwal", "Wanaparthy", "Nagarkurnool", "Achampet", "Kalwakurthy", "Kollapur", "Alampur", "Ieeja", "Pebbair", "Kothakota", "Atmakur", "Amangal", "Shadnagar", "Farooqnagar", "Keshampet", "Kondurg", "Balanagar", "Midjil", "Rajapur", "Nawabpet", "Hanwada", "Bhoothpur", "Addakal", "Devarkadra", "Moosapet", "Koilkonda", "Gandeed", "Mohammadabad", "Dhanwada", "Marikal", "Utkoor", "Damaragidda", "Krishna", "Maganoor", "Narva", "Chinnachintakunta", "Peddamandadi", "Gopalpet", "Pangal", "Revally", "Srirangapur", "Veepanagandla", "Chinnambavi", "Lingal", "Balmoor", "Uppununthala", "Telkapally", "Tadoor", "Bijinapally", "Thimmajipet", "Vangoor", "Charakonda", "Urkonda", "Veldanda", "Madgul", "Talakondapally", "Kadthal", "Kandukur", "Maheshwaram", "Adibatla", "Tukkuguda", "Shamshabad", "Rajendranagar", "Serilingampally", "Kukatpally", "Quthbullapur", "Malkajgiri", "Medchal", "Kompally", "Dundigal", "Bachupally", "Nizampet", "Patancheru", "Ramachandrapuram", "Ameenpur", "Beeramguda", "Tellapur", "Gachibowli", "Kondapur", "Miyapur", "Chandanagar", "Lingampally", "Uppal", "Nagole", "LB Nagar", "Hayathnagar", "Vanasthalipuram", "Badangpet", "Meerpet", "Jalpally", "Balapur", "Boduppal", "Peerzadiguda", "Ghatkesar", "Pocharam", "Keesara", "Shamirpet", "Alwal", "Kapra", "Jawaharnagar", "Dammaiguda", "Thumkunta", "Toopran", "Gajwel", "Dubbak", "Narsapur", "Zaheerabad", "Sadasivpet", "Andole", "Jogipet", "Narayankhed", "Kohir", "Jharasangam", "Nyalkal", "Munipally", "Pulkal", "Hathnoora", "Raikode", "Sirgapoor", "Kalher", "Kangti", "Manoor", "Regode", "Alladurg", "Tekmal", "Papannapet", "Shivampet", "Kowdipally", "Chegunta", "Ramayampet", "Yeldurthy", "Shankarampet", "Kulcharam", "Haveli Ghanpur"],
  "Tripura": ["Agartala", "Udaipur", "Dharmanagar", "Kailashahar", "Belonia", "Ambassa", "Khowai", "Sabroom", "Bishalgarh", "Ranirbazar", "Jirania", "Mohanpur", "Teliamura", "Amarpur", "Kumarghat", "Kamalpur", "Sonamura", "Melaghar", "Santirbazar", "Panisagar", "Kadamtala", "Kanchanpur", "Pecharthal", "Fatikroy", "Jampui Hills", "Vanghmun", "Manu", "Chailengta", "Longtharai Valley", "Gandacherra", "Raishyabari", "Karbook", "Silachari", "Natunbazar", "Ompi", "Kakraban", "Matabari", "Tepania", "Jolaibari", "Hrishyamukh", "Rajnagar", "Rupaichari", "Poangbari", "Kathalia", "Boxanagar", "Nalchar", "Dhanpur", "Charilam", "Dukli", "Bamutia", "Lefunga", "Mandai", "Hezamara", "Tulashikhar", "Padmabil", "Mungiakami", "Kalyanpur", "Kanchanmala", "Champahour", "Durga Chowmuhani", "Salema", "Halahali", "Chandipur", "Gournagar", "Yubarajnagar", "Jubarajnagar", "Damcherra", "Dasda", "Laljuri"],
  "Uttar Pradesh": ["Lucknow", "Kanpur", "Varanasi", "Agra", "Prayagraj", "Ghaziabad", "Noida", "Greater Noida", "Meerut", "Gorakhpur", "Bareilly", "Aligarh", "Moradabad", "Mathura", "Jhansi", "Ayodhya", "Saharanpur", "Firozabad", "Muzaffarnagar", "Rampur", "Shahjahanpur", "Farrukhabad", "Fatehgarh", "Etawah", "Mainpuri", "Etah", "Kasganj", "Hathras", "Bulandshahr", "Hapur", "Modinagar", "Muradnagar", "Loni", "Dadri", "Sikandrabad", "Khurja", "Jewar", "Dankaur", "Rabupura", "Jahangirpur", "Anupshahr", "Dibai", "Shikarpur", "Siyana", "Gulaothi", "Jahangirabad", "Garhmukteshwar", "Pilkhuwa", "Dhaulana", "Dasna", "Sahibabad", "Indirapuram", "Vasundhara", "Kaushambi", "Greater Noida West", "Baraut", "Baghpat", "Khekra", "Chhaprauli", "Budhana", "Khatauli", "Jansath", "Shamli", "Kairana", "Kandhla", "Thana Bhawan", "Un", "Jalalabad", "Deoband", "Gangoh", "Nakur", "Behat", "Chilkana", "Nanauta", "Rampur Maniharan", "Sarsawa", "Nagal", "Chhutmalpur", "Amroha", "Gajraula", "Hasanpur", "Dhanaura", "Joya", "Naugawan Sadat", "Sambhal", "Chandausi", "Bahjoi", "Sirsi", "Babrala", "Gunnaur", "Bilari", "Thakurdwara", "Kanth", "Kundarki", "Bhojpur", "Bilaspur", "Milak", "Shahabad", "Tanda", "Suar", "Kemri", "Bazpur (Uttarakhand)", "Rudrapur (Uttarakhand)", "Bijnor", "Najibabad", "Nagina", "Dhampur", "Chandpur", "Kiratpur", "Seohara", "Afzalgarh", "Haldaur", "Noorpur", "Mandawar", "Sherkot", "Nehtaur", "Nainital (Uttarakhand)", "Pilibhit", "Bisalpur", "Puranpur", "Barkhera", "Jehanabad", "Bilsanda", "Baheri", "Aonla", "Faridpur", "Nawabganj", "Mirganj", "Fatehganj", "Shishgarh", "Richha", "Sirauli", "Budaun", "Ujhani", "Sahaswan", "Bisauli", "Dataganj", "Bilsi", "Islamnagar", "Kakrala", "Alapur", "Wazirganj", "Usawan", "Tilhar", "Powayan", "Khutar", "Katra", "Kant", "Banda (Shahjahanpur)", "Khudaganj", "Nigohi", "Hardoi", "Shahabad (Hardoi)", "Sandila", "Bilgram", "Sandi", "Pihani", "Mallawan", "Madhoganj", "Gopamau", "Beniganj", "Kachhauna", "Pali", "Sawayajpur", "Sitapur", "Biswan", "Laharpur", "Mahmudabad", "Sidhauli", "Khairabad", "Misrikh", "Tambaur", "Hargaon", "Reusa", "Machhrehta", "Naimisharanya", "Lakhimpur", "Kheri", "Gola Gokarannath", "Palia Kalan", "Mohammadi", "Nighasan", "Dhaurahra", "Mailani", "Tikunia", "Singahi", "Bheera", "Oel", "Maigalganj", "Bahraich", "Nanpara", "Kaiserganj", "Jarwal", "Risia", "Payagpur", "Mihipurwa", "Fakharpur", "Balrampur", "Tulsipur", "Utraula", "Pachperwa", "Gonda", "Colonelganj", "Mankapur", "Tarabganj", "Katra Bazar", "Khargupur", "Itiyathok", "Basti", "Harraiya", "Rudhauli", "Babhnan", "Bankati", "Siddharthnagar", "Naugarh", "Bansi", "Shohratgarh", "Itwa", "Dumariyaganj", "Barhni", "Uska Bazar", "Sant Kabir Nagar", "Khalilabad", "Mehdawal", "Hainsar Bazar", "Sahjanwa", "Pipraich", "Chauri Chaura", "Campierganj", "Gola Bazar", "Barhalganj", "Bansgaon", "Khajni", "PPGanj", "Maharajganj", "Nautanwa", "Nichlaul", "Pharenda", "Siswa Bazar", "Ghughuli", "Anandnagar", "Partawal", "Kushinagar", "Padrauna", "Hata", "Kasia", "Tamkuhi Raj", "Seorahi", "Kaptanganj", "Ramkola", "Fazilnagar", "Deoria", "Salempur", "Barhaj", "Rudrapur", "Bhatni", "Bhatpar Rani", "Lar", "Gauri Bazar", "Rampur Karkhana", "Ballia", "Rasra", "Bansdih", "Sikanderpur", "Belthara Road", "Reoti", "Maniyar", "Bairia", "Sahatwar", "Chitbaragaon", "Azamgarh", "Mubarakpur", "Nizamabad", "Phulpur", "Lalganj", "Mehnagar", "Atraulia", "Saraimeer", "Bilariaganj", "Jiyanpur", "Mau", "Ghosi", "Muhammadabad Gohna", "Kopaganj", "Dohrighat", "Madhuban", "Chiraiyakot", "Amila", "Jaunpur", "Shahganj", "Machhlishahr", "Mariahu", "Kerakat", "Badlapur", "Jafarabad", "Jalalpur", "Ramnagar", "Pindra", "Gangapur", "Cholapur", "Babatpur", "Chandauli", "Mughalsarai (Pt. Deen Dayal Upadhyaya Nagar)", "Chakia", "Saiyadraja", "Sakaldiha", "Mirzapur", "Chunar", "Vindhyachal", "Ahraura", "Kachhwa", "Sonbhadra", "Robertsganj", "Obra", "Renukoot", "Anpara", "Shaktinagar", "Duddhi", "Chopan", "Ghorawal", "Pipri", "Babhani", "Myorpur", "Gopiganj", "Bhadohi", "Gyanpur", "Suriyawan", "Khamaria", "Aurai", "Sitamarhi", "Naini", "Handia", "Koraon", "Meja", "Sirsa", "Shankargarh", "Mauaima", "Soraon", "Jhunsi", "Fafamau", "Manjhanpur", "Bharwari", "Sirathu", "Chail", "Karari", "Sarai Akil", "Fatehpur", "Bindki", "Khaga", "Kishanpur", "Hathgaon", "Hussainganj", "Jahanabad", "Unnao", "Shuklaganj", "Safipur", "Bangarmau", "Purwa", "Maurawan", "Asoha", "Bighapur", "Hasanganj", "Kanpur Dehat", "Akbarpur", "Rura", "Pukhrayan", "Jhinjhak", "Rasulabad", "Sikandra", "Derapur", "Shivli", "Maitha", "Amraudha", "Bhognipur", "Kanpur Nagar", "Bilhaur", "Ghatampur", "Bithoor", "Chaubepur", "Shivrajpur", "Maharajpur", "Narwal", "Bidhnu", "Hamirpur", "Rath", "Maudaha", "Kurara", "Sumerpur", "Sarila", "Mahoba", "Charkhari", "Kulpahar", "Kabrai", "Panwari", "Banda", "Atarra", "Baberu", "Naraini", "Tindwari", "Bisanda", "Kartal", "Chitrakoot", "Karwi", "Rajapur", "Manikpur", "Barhgarh", "Mauranipur", "Babina", "Chirgaon", "Moth", "Garautha", "Samthar", "Baruasagar", "Gursarai", "Parichha", "Lalitpur", "Talbehat", "Mahroni", "Jakhora", "Orai", "Jalaun", "Kalpi", "Konch", "Madhogarh", "Rampura", "Kuthaund", "Kadaura", "Bharthana", "Jaswantnagar", "Bakewar", "Lakhna", "Saifai", "Bidhuna", "Achhalda", "Dibiyapur", "Auraiya", "Phaphund", "Ajitmal", "Bela", "Kannauj", "Chhibramau", "Tirwa", "Saurikh", "Gursahaiganj", "Kaimganj", "Kamalganj", "Mohammadabad", "Shamsabad", "Kampil", "Karhal", "Bhongaon", "Kishni", "Bewar", "Kurawali", "Ghiraur", "Aliganj", "Jalesar", "Awagarh", "Nidhauli Kalan", "Sakit", "Soron", "Patiyali", "Ganjdundwara", "Sidhpura", "Sahawar", "Fatehpur Sikri", "Achhnera", "Kiraoli", "Etmadpur", "Bah", "Pinahat", "Kheragarh", "Jagner", "Saiyan", "Fatehabad", "Vrindavan", "Govardhan", "Kosi Kalan", "Chhata", "Raya", "Baldeo", "Barsana", "Nandgaon", "Farah", "Mahavan", "Sadabad", "Sikandra Rao", "Sasni", "Mursan", "Hasayan", "Sahpau", "Atrauli", "Khair", "Iglas", "Gabhana", "Chharra", "Harduaganj", "Jalali", "Piswa", "Pilakhna", "Tappal", "Raebareli", "Dalmau", "Unchahar", "Bachhrawan", "Salon", "Parsadepur", "Amethi", "Gauriganj", "Jais", "Musafirkhana", "Jagdishpur", "Tiloi", "Shukul Bazar", "Sultanpur", "Kadipur", "Lambhua", "Dostpur", "Kurebhar", "Baldirai", "Faizabad", "Rudauli", "Milkipur", "Bikapur", "Gosainganj", "Sohawal", "Ambedkar Nagar", "Baskhari", "Ashrafpur Kichhauchha", "Rajesultanpur", "Barabanki", "Zaidpur", "Ramsanehighat", "Haidergarh", "Dariyabad", "Tikaitnagar", "Satrikh", "Mohanlalganj", "Malihabad", "Kakori", "Bakshi Ka Talab", "Itaunja", "Nigohan"],
  "Uttarakhand": ["Dehradun", "Haridwar", "Roorkee", "Haldwani", "Rishikesh", "Rudrapur", "Kashipur", "Nainital", "Almora", "Pithoragarh", "Kotdwar", "Mussoorie", "Vikasnagar", "Ranikhet", "Ramnagar", "Kichha", "Sitarganj", "Khatima", "Jaspur", "Bajpur", "Gadarpur", "Pantnagar", "Dineshpur", "Shaktigarh", "Nanakmatta", "Kelakhera", "Mahuakheraganj", "Mahuadabra", "Sultanpur Patti", "Kaladhungi", "Lalkuan", "Bhimtal", "Bhowali", "Mukteshwar", "Ramgarh", "Betalghat", "Dhari", "Okhalkanda", "Dwarahat", "Chaukhutiya", "Someshwar", "Bhikiyasain", "Sult", "Syalde", "Lamgara", "Jainti", "Dhauladevi", "Bageshwar", "Kapkot", "Garur", "Kanda", "Baijnath", "Berinag", "Didihat", "Dharchula", "Munsiyari", "Gangolihat", "Thal", "Askot", "Kanalichhina", "Munakot", "Champawat", "Lohaghat", "Tanakpur", "Banbasa", "Pati", "Barakot", "Purnagiri", "Kalsi", "Chakrata", "Tyuni", "Herbertpur", "Sahaspur", "Doiwala", "Raiwala", "Clement Town", "Landour", "Dhanaulti", "Chamba", "New Tehri", "Narendra Nagar", "Devprayag", "Ghansali", "Pratapnagar", "Jakhnidhar", "Kirtinagar", "Hindolakhal", "Uttarkashi", "Barkot", "Purola", "Naugaon", "Mori", "Dunda", "Chinyalisaur", "Bhatwari", "Gangotri", "Yamunotri", "Joshimath", "Chamoli", "Gopeshwar", "Karnaprayag", "Nandprayag", "Gauchar", "Tharali", "Gairsain", "Adibadri", "Pokhari", "Ghat", "Pipalkoti", "Badrinath", "Mana", "Rudraprayag", "Agastyamuni", "Guptkashi", "Ukhimath", "Kedarnath", "Tilwara", "Srinagar", "Pauri", "Lansdowne", "Satpuli", "Dhumakot", "Thalisain", "Bironkhal", "Yamkeshwar", "Dugadda", "Kalagarh", "Swargashram", "Shyampur", "Jwalapur", "Laksar", "Manglaur", "Bhagwanpur", "Landhaura", "Jhabrera", "Narsan", "Bahadrabad", "Pathri", "Khanpur"],
  "West Bengal": ["Kolkata", "Howrah", "Durgapur", "Asansol", "Siliguri", "Darjeeling", "Kharagpur", "Haldia", "Bardhaman", "Malda", "Baharampur", "Jalpaiguri", "Raiganj", "Krishnanagar", "Bankura", "Purulia", "Cooch Behar", "Alipurduar", "Balurghat", "Gangarampur", "Islampur", "Kaliaganj", "Dalkhola", "Hemtabad", "Karandighi", "Itahar", "Chopra", "Goalpokhar", "Kaliyaganj", "Tapan", "Kumarganj", "Buniadpur", "Harirampur", "Kushmandi", "Hili", "English Bazar", "Old Malda", "Chanchal", "Gazole", "Habibpur", "Bamangola", "Manikchak", "Ratua", "Kaliachak", "Sujapur", "Mothabari", "Farakka", "Jangipur", "Raghunathganj", "Dhulian", "Aurangabad", "Suti", "Lalgola", "Bhagwangola", "Domkal", "Jalangi", "Raninagar", "Hariharpara", "Beldanga", "Kandi", "Bharatpur", "Burwan", "Salar", "Nabagram", "Murshidabad", "Jiaganj", "Azimganj", "Lalbagh", "Khagra", "Nabadwip", "Santipur", "Ranaghat", "Kalyani", "Chakdaha", "Haringhata", "Gayeshpur", "Taherpur", "Birnagar", "Karimpur", "Tehatta", "Nakashipara", "Bethuadahari", "Chapra", "Krishnaganj", "Bagula", "Hanskhali", "Phulia", "Badkulla", "Aranghata", "Bangaon", "Barasat", "Madhyamgram", "New Barrackpore", "Barrackpore", "North Barrackpore", "Titagarh", "Khardaha", "Panihati", "Sodepur", "Kamarhati", "Baranagar", "Dum Dum", "South Dum Dum", "North Dum Dum", "Lake Town", "Bidhannagar", "Salt Lake City", "New Town", "Rajarhat", "Baguiati", "Kestopur", "Hatiara", "Gopalpur", "Birati", "Belgharia", "Agarpara", "Naihati", "Halisahar", "Kanchrapara", "Bhatpara", "Jagaddal", "Shyamnagar", "Ichhapur", "Garulia", "Palta", "Ashoknagar Kalyangarh", "Habra", "Gobardanga", "Maslandapur", "Basirhat", "Baduria", "Taki", "Hasnabad", "Hingalganj", "Haroa", "Minakhan", "Sandeshkhali", "Swarupnagar", "Deganga", "Amdanga", "Gaighata", "Bagdah", "Jadavpur", "Tollygunge", "Behala", "Garden Reach", "Metiabruz", "Garia", "Narendrapur", "Sonarpur", "Rajpur", "Baruipur", "Maheshtala", "Budge Budge", "Pujali", "Batanagar", "Bishnupur", "Amtala", "Falta", "Diamond Harbour", "Kakdwip", "Namkhana", "Sagar", "Patharpratima", "Mathurapur", "Raidighi", "Kulpi", "Canning", "Basanti", "Gosaba", "Bhangar", "Joynagar", "Majilpur", "Kultali", "Magrahat", "Usthi", "Burnpur", "Kulti", "Raniganj", "Jamuria", "Andal", "Pandabeswar", "Ukhra", "Kajora", "Kanksa", "Panagarh", "Budbud", "Faridpur", "Laudoha", "Barakar", "Chittaranjan", "Rupnarayanpur", "Salanpur", "Dishergarh", "Neamatpur", "Hirapur", "Sitarampur", "Memari", "Kalna", "Katwa", "Dainhat", "Guskara", "Purbasthali", "Monteswar", "Bhatar", "Galsi", "Raina", "Khandaghosh", "Jamalpur", "Mangalkote", "Ketugram", "Ausgram", "Raghunathpur", "Adra", "Jhalda", "Balarampur", "Kashipur", "Hura", "Manbazar", "Bandwan", "Barabazar", "Arsha", "Baghmundi", "Joypur", "Neturia", "Para", "Santaldih", "Sonamukhi", "Khatra", "Taldangra", "Onda", "Indpur", "Raipur", "Sarenga", "Ranibandh", "Simlapal", "Patrasayer", "Indas", "Kotulpur", "Mejia", "Gangajalghati", "Saltora", "Chhatna", "Barjora", "Beliyatore", "Midnapore", "Ghatal", "Chandrakona", "Keshpur", "Garbeta", "Salboni", "Debra", "Panskura", "Kolaghat", "Tamluk", "Mahishadal", "Nandakumar", "Nandigram", "Contai (Kanthi)", "Egra", "Digha", "Ramnagar", "Junput", "Tajpur", "Mandarmani", "Shankarpur", "Khejuri", "Bhagwanpur", "Patashpur", "Moyna", "Pingla", "Sabang", "Narayangarh", "Dantan", "Belda", "Keshiary", "Jhargram", "Gopiballavpur", "Nayagram", "Sankrail", "Binpur", "Belpahari", "Lalgarh", "Silda", "Chilkigarh", "Suri", "Bolpur", "Santiniketan", "Rampurhat", "Sainthia", "Dubrajpur", "Nalhati", "Murarai", "Margram", "Tarapith", "Labpur", "Nanoor", "Illambazar", "Ahmadpur", "Mayureswar", "Rajnagar", "Khoyrasol", "Mohammad Bazar", "Deucha", "Hetampur", "Bakreswar", "Kurseong", "Kalimpong", "Mirik", "Sukna", "Matigara", "Bagdogra", "Naxalbari", "Kharibari", "Phansidewa", "Sevoke", "Mungpoo", "Sonada", "Ghoom", "Takdah", "Lamahatta", "Lava", "Loleygaon", "Pedong", "Algarah", "Gorubathan", "Jaldhaka", "Rishop", "Rimbick", "Bijanbari", "Jorebunglow", "Maynaguri", "Dhupguri", "Malbazar", "Chalsa", "Nagrakata", "Banarhat", "Birpara", "Madarihat", "Falakata", "Hasimara", "Jaigaon", "Kalchini", "Kumargram", "Kamakhyaguri", "Samuktala", "Dinhata", "Mathabhanga", "Tufanganj", "Mekhliganj", "Haldibari", "Sitalkuchi", "Sitai", "Ghoksadanga", "Nishiganj", "Pundibari", "Baneswar", "Changrabandha", "Union Territories"],
  "Andaman and Nicobar Islands": ["Sri Vijaya Puram (Port Blair)", "Diglipur", "Mayabunder", "Rangat", "Baratang", "Kadamtala", "Ferrargunj", "Bambooflat", "Wimberly Gunj", "Hut Bay", "Campbell Bay", "Car Nicobar", "Nancowry", "Kamorta", "Katchal", "Teressa", "Long Island", "Neil Island (Shaheed Dweep)", "Havelock Island (Swaraj Dweep)"],
  "Chandigarh": ["Chandigarh", "Manimajra", "Dhanas", "Maloya", "Khuda Lahora", "Khuda Jassu", "Khuda Alisher", "Kishangarh", "Raipur Khurd", "Raipur Kalan", "Behlana", "Hallo Majra", "Burail", "Kajheri", "Dadumajra", "Sarangpur", "Mauli Jagran"],
  "Dadra and Nagar Haveli and Daman and Diu": ["Silvassa", "Daman", "Diu", "Dadra", "Naroli", "Rakholi", "Samarvarni", "Amli", "Masat", "Khanvel", "Dudhani", "Kauncha", "Vapi (Gujarat)", "Kachigam", "Dabhel", "Bhimpore", "Nani Daman", "Moti Daman", "Dunetha", "Marwad", "Vanakbara", "Ghoghla", "Fudam"],
  "Delhi": ["New Delhi", "Delhi", "Dwarka", "Rohini", "Narela", "Najafgarh", "Shahdara", "Seelampur", "Seemapuri", "Vivek Vihar", "Preet Vihar", "Mayur Vihar", "Patparganj", "Laxmi Nagar", "Gandhi Nagar", "Krishna Nagar", "Geeta Colony", "Yamuna Vihar", "Bhajanpura", "Karawal Nagar", "Burari", "Timarpur", "Civil Lines", "Model Town", "Adarsh Nagar", "Jahangirpuri", "Azadpur", "Shalimar Bagh", "Pitampura", "Saraswati Vihar", "Keshav Puram", "Tri Nagar", "Ashok Vihar", "Wazirpur", "Kanjhawala", "Bawana", "Sultanpuri", "Mangolpuri", "Nangloi", "Mundka", "Kirari", "Ranhola", "Vikaspuri", "Janakpuri", "Uttam Nagar", "Tilak Nagar", "Rajouri Garden", "Punjabi Bagh", "Paschim Vihar", "Moti Nagar", "Patel Nagar", "Karol Bagh", "Paharganj", "Connaught Place", "Chanakyapuri", "Vasant Vihar", "Vasant Kunj", "Mehrauli", "Chhatarpur", "Saket", "Malviya Nagar", "Hauz Khas", "Green Park", "Greater Kailash", "Kalkaji", "Nehru Place", "Govindpuri", "Tughlakabad", "Badarpur", "Okhla", "Jamia Nagar", "Shaheen Bagh", "Jasola", "Sarita Vihar", "Madanpur Khadar", "Sangam Vihar", "Deoli", "Ambedkar Nagar", "Munirka", "R.K. Puram", "Mahipalpur", "Kapashera", "Bijwasan", "Palam", "Dabri", "Sagarpur", "Delhi Cantonment", "Dhaula Kuan", "Naraina", "Inderpuri"],
  "Jammu and Kashmir": ["Srinagar", "Jammu", "Anantnag", "Baramulla", "Sopore", "Udhampur", "Kathua", "Rajouri", "Poonch", "Pulwama", "Shopian", "Kulgam", "Budgam", "Ganderbal", "Bandipora", "Kupwara", "Handwara", "Uri", "Pattan", "Tangmarg", "Gulmarg", "Kunzer", "Magam", "Beerwah", "Chadoora", "Charar-i-Sharief", "Pampore", "Awantipora", "Tral", "Bijbehara", "Mattan", "Pahalgam", "Kokernag", "Achabal", "Qazigund", "Dooru Verinag", "Kishtwar", "Doda", "Bhaderwah", "Ramban", "Banihal", "Batote", "Reasi", "Katra", "Akhnoor", "R.S. Pura", "Bishnah", "Samba", "Vijaypur", "Hiranagar", "Billawar", "Basohli", "Lakhanpur", "Nowshera", "Sunderbani", "Kalakote", "Thanamandi", "Mendhar", "Surankote", "Gurez", "Sumbal", "Hajin", "Kangan", "Sonamarg"],
  "Ladakh": ["Leh", "Kargil", "Dras", "Diskit", "Hunder", "Nubra", "Sumur", "Panamik", "Turtuk", "Tangtse", "Durbuk", "Nyoma", "Hanle", "Chushul", "Karzok", "Khaltse", "Saspol", "Nimmu", "Basgo", "Likir", "Alchi", "Lamayuru", "Hemis", "Thiksey", "Shey", "Choglamsar", "Spituk", "Stok", "Sankoo", "Panikhar", "Parkachik", "Rangdum", "Padum", "Zanskar", "Batalik", "Shargole", "Mulbekh", "Wakha"],
  "Lakshadweep": ["Kavaratti", "Agatti", "Andrott", "Amini", "Kadmat", "Kiltan", "Chetlat", "Bitra", "Kalpeni", "Minicoy", "Bangaram"],
  "Puducherry": ["Puducherry", "Karaikal", "Mahe", "Yanam", "Ozhukarai", "Villianur", "Ariyankuppam", "Bahour", "Nettapakkam", "Mannadipet", "Thirubuvanai", "Madagadipet", "Lawspet", "Mudaliarpet", "Muthialpet", "Reddiarpalayam", "Nellithope", "Orleanpet", "Kalapet", "Kirumampakkam", "Thavalakuppam", "Karikalampakkam", "Nedungadu", "Thirunallar", "Kottucherry", "Neravy", "Thirumalairayanpattinam", "Palloor", "Pandakkal"],
};

export function getIndianStates(): string[] {
  return Object.keys(INDIAN_STATES_AND_CITIES).sort((a, b) => a.localeCompare(b));
}

export function getCitiesForState(state: string): string[] {
  if (!state) return [];
  const normalized = state.trim();
  const direct = INDIAN_STATES_AND_CITIES[normalized];
  if (direct) return [...direct].sort((a, b) => a.localeCompare(b));
  const key = Object.keys(INDIAN_STATES_AND_CITIES).find((k) => k.toLowerCase() === normalized.toLowerCase());
  return key ? [...INDIAN_STATES_AND_CITIES[key]].sort((a, b) => a.localeCompare(b)) : [];
}
