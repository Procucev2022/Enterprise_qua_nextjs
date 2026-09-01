import type {
  SourcingModeDetail,
  SystemConfig,
  AzureServiceHealth,
  RFQItem,
  SidebarNavItem,
  RoleWorkspaceMeta,
  UserRole,
} from './types';
import { UI_STRINGS } from './uiStrings';

export const SOURCING_MODES: SourcingModeDetail[] = [
  {
    id: 'mode_1',
    code: 'Version 1',
    name: 'Version 1: Client Roster Sourcing Plan',
    shortLabel: 'Version 1',
    description:
      'Private empanelled vendor network. RFQs are strictly circulated only to your pre-verified approved vendor list.',
    badgeColor: 'border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/10',
  },
  {
    id: 'mode_2',
    code: 'Version 2',
    name: 'Version 2: Hybrid Sourcing Plan',
    shortLabel: 'Version 2',
    description:
      'Circulate to your private empanelled list first. If quotes or responses are insufficient, AI expands to Procucev Base Network.',
    badgeColor: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10',
  },
  {
    id: 'mode_3',
    code: 'Version 3',
    name: 'Version 3: AI Autonomous Sourcing Plan',
    shortLabel: 'Version 3',
    description:
      'Autonomous Procucev Network Sourcing with double-blind supplier identity shielding, continuous AI evaluation, and best-fit routing.',
    badgeColor: 'border-purple-500/40 text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/10',
  },
];

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
 * Canonical RFQ references rendered on the static Category Manager Kanban
 * pipeline cards (Screen 2.1). Card action handlers resolve these references
 * against live store data instead of indexing `rfqs[0]`, which is `undefined`
 * while the pipeline is empty or still hydrating from PostgreSQL.
 */
export const KANBAN_CARD_RFQ_REFS = {
  FOLLOW_UP_DEEP_DIVE: { rfqNumber: 'RFQ-2026-00421', title: 'Centrifugal Water Pumps & Spares' },
  SCORED_REPORT: { rfqNumber: 'RFQ-00418', title: 'Low Voltage Switchgear Panels' },
  MATRIX_READY: { rfqNumber: 'RFQ-00421', title: 'Vendor Scored Quote Matrix' },
};

/**
 * Neutral RFQ skeleton used when a pipeline card reference cannot be resolved
 * against the live RFQ collection. Guarantees downstream handlers, modals, and
 * navigation callbacks always receive a well-formed `RFQItem`.
 */
export const FALLBACK_RFQ_TEMPLATE: Omit<RFQItem, 'rfqNumber' | 'title'> = {
  id: 'rfq-unresolved',
  category: 'Uncategorised',
  sourcingMode: 'mode_3',
  status: 'In Evaluation',
  quotesCount: 0,
  targetDeliveryDate: '',
  budget: 0,
  createdAt: '',
  extractedEntities: [],
  quotes: [],
  chasingActive: false,
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
      shortTag: '1.1',
      label: NAV_ITEMS.commandCenter.label,
      description: NAV_ITEMS.commandCenter.description,
      icon: 'Layers',
      group: NAV_GROUPS.buyerSourcing,
      route: '/buyer/command-center',
    },
    {
      id: 'ingestion_wizard',
      screenTag: 'Screen 1.2',
      shortTag: '1.2',
      label: NAV_ITEMS.ingestionWizard.label,
      description: NAV_ITEMS.ingestionWizard.description,
      icon: 'FileSpreadsheet',
      group: NAV_GROUPS.buyerSourcing,
      route: '/buyer/ingestion-wizard',
    },
    {
      id: 'vendor_evaluation_summary',
      screenTag: 'Screen 1.3',
      shortTag: '1.3',
      label: NAV_ITEMS.buyerEvaluationSummary.label,
      description: NAV_ITEMS.buyerEvaluationSummary.description,
      icon: 'FileCheck',
      group: NAV_GROUPS.buyerEvaluation,
      route: '/buyer/vendor-evaluation-summary',
    },
    {
      id: 'vendor_summary',
      screenTag: 'Screen 1.4',
      shortTag: '1.4',
      label: NAV_ITEMS.vendorDirectory.label,
      description: NAV_ITEMS.vendorDirectory.description,
      icon: 'Building2',
      group: NAV_GROUPS.buyerEvaluation,
      route: '/buyer/vendor-summary',
    },
    {
      id: 'subscription_center',
      screenTag: 'Screen 1.5',
      shortTag: '1.5',
      label: NAV_ITEMS.sourcingSubscriptions.label,
      description: NAV_ITEMS.sourcingSubscriptions.description,
      icon: 'Sparkles',
      group: NAV_GROUPS.buyerAccount,
      route: '/buyer/subscription-center',
    },
    {
      id: 'buyer_profile',
      screenTag: 'Screen 1.6',
      shortTag: '1.6',
      label: NAV_ITEMS.buyerProfile.label,
      description: NAV_ITEMS.buyerProfile.description,
      icon: 'Building2',
      group: NAV_GROUPS.buyerAccount,
      route: '/buyer/buyer-profile',
    },
    {
      id: 'buyer_directory',
      screenTag: 'Screen 1.7',
      shortTag: '1.7',
      label: NAV_ITEMS.buyerDbSync.label,
      description: NAV_ITEMS.buyerDbSync.description,
      icon: 'Database',
      group: NAV_GROUPS.buyerAccount,
      route: '/buyer/buyer-directory',
    },
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
  buyer: '/buyer/command-center',
  category_manager: '/category-manager/kanban-board',
  vendor: '/vendor/opportunity-feed',
  admin: '/admin/infra-control',
};

/** Path of the sign-in screen. */
export const LOGIN_ROUTE = '/login';

/** URL prefix that scopes each role's workspace, used to guard route access. */
export const ROLE_ROUTE_PREFIX: Record<UserRole, string> = {
  buyer: '/buyer',
  category_manager: '/category-manager',
  vendor: '/vendor',
  admin: '/admin',
};

export {
  FORM_SCHEMAS,
  validateFormData,
  EMAIL_PATTERN,
  GSTIN_PATTERN,
  PHONE_PATTERN,
} from './validationSchemas';

