// ==============================================================================
// PROCUCEV ENTERPRISE (QUA AI 2.0) - CONSTANTS, TAXONOMIES & SYSTEM DEFAULTS
// ==============================================================================

const SOURCING_MODES = [
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

const BUYER_SUBSCRIPTION_PLANS = [
  {
    id: 'free_trial',
    name: 'Free Trial Starter',
    price: '$0',
    billing: '5 Free RFQs included',
    description: 'Explore all 3 sourcing modes (Mode 1, Mode 2 & Mode 3) with full multi-channel AI chasing.',
    features: [
      '5 Free RFQ dispatches across any operational mode',
      'Autonomous Voice, WhatsApp & SMS multi-channel follow-ups',
      'Interactive Quote Matrix & 1-click PO generation',
      'SHA-256 cryptographic audit transaction seals',
    ],
  },
  {
    id: 'version_1',
    name: 'Version 1 Plan: Client Roster Only',
    price: '$199',
    billing: 'per user / month',
    description: 'Streamline procurement across your private pre-approved vendor roster with automated working-hour follow-ups.',
    features: [
      'Mode 1: Private Preferred Vendor Network Sourcing',
      'Direct sourcing from uploaded Excel/Manual buyer rosters',
      'Working-hour multi-channel follow-ups (SMS 5m, Call +6h, WA +12h)',
      'Strict single-dispatch guarantee per vendor (zero repetition)',
    ],
  },
  {
    id: 'version_2',
    name: 'Version 2 Plan: Hybrid Sourcing',
    price: '$499',
    billing: 'per user / month',
    description: 'Cumulative plan giving full access to BOTH Mode 1 and Mode 2 with hybrid platform network discovery.',
    features: [
      'CUMULATIVE: Full access to Mode 1 AND Mode 2 features',
      'AI Hybrid Sourcing with Procucev verified network matching',
      'Intelligent RFQ Minor Category matching (280+ taxonomy) & proximity filter',
      'Automatic classification of Buyer Upload vs. Network Pool',
    ],
  },
  {
    id: 'version_3',
    name: 'Version 3 Plan: Autonomous AI Enterprise',
    price: '$999',
    billing: 'per user / month',
    description: 'Ultimate all-inclusive tier giving full access to Mode 1, Mode 2, AND Mode 3 with autonomous AI governance.',
    features: [
      'ALL-INCLUSIVE: Full access to Mode 1, Mode 2, AND Mode 3 features',
      'Pre-bid 360° 6-pillar vendor qualification audits',
      'Double-blind supplier identity shielding for unbiased quote benchmarking',
      'Automated SAP S/4HANA & Oracle Cloud ERP synchronization adapters',
    ],
  },
];

const VENDOR_SUBSCRIPTION_PLANS = [
  {
    id: 'premium',
    name: 'Premium Model (Client Uploaded)',
    price: 'Free',
    billing: 'included with Buyer Roster upload',
    description: 'Automatically granted to vendors uploaded by buyers. Access all direct RFQ invitations issued by your clients.',
    features: [
      'See all RFQs from buyers who uploaded your vendor profile',
      'Unlimited technical BOQ downloads for direct invitation RFQs',
      'Email-based quotation tracking and status updates',
      'Direct communication channel with inviting enterprise buyers',
    ],
  },
  {
    id: 'connect',
    name: 'Connect Model (Marketplace Expansion)',
    price: '$149',
    billing: 'per 3 months (90 days)',
    description: 'Expand your market reach. Access & download open RFQs across the entire Procucev Network Marketplace.',
    features: [
      'All Premium Client-Uploaded features included',
      'Download up to 50 RFQs within 3 months (90-day period)',
      '🎁 360° AI Self-Evaluation Fee: $0 FREE (Waived from $5)',
      'Access to full Open Network Marketplace RFQs',
      'Instant email dispatch of technical BOQ spreadsheets & specifications',
    ],
  },
  {
    id: 'select',
    name: 'Select Model (Catalogue & High Volume)',
    price: '$349',
    billing: 'per 3 months (90 days)',
    description: 'Complete tier for high-volume suppliers. Build your Item Catalogue and capture maximum marketplace demand.',
    features: [
      'Download up to 100 RFQs within 3 months',
      'Published Item SKU Catalogue with direct buyer visibility',
      '🎁 360° AI Self-Evaluation Fee: $0 FREE (Waived from $5)',
      'Priority AI routing in Mode 2 & Mode 3 matching algorithms',
    ],
  },
];

const INITIAL_SYSTEM_CONFIG = {
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

const INITIAL_AZURE_HEALTH = [
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

const QUALIFICATION_PILLARS = [
  { id: 'M1', name: 'Commercial Terms', weight: 25, color: '#3b82f6' },
  { id: 'M2', name: 'Technical Capabilities', weight: 15, color: '#06b6d4' },
  { id: 'M3', name: 'Quality & Warranty', weight: 20, color: '#10b981' },
  { id: 'M4', name: 'Operational Delivery', weight: 20, color: '#8b5cf6' },
  { id: 'M5', name: 'Financial Stability', weight: 10, color: '#f59e0b' },
  { id: 'M6', name: 'Governance & ESG', weight: 10, color: '#f43f5e' },
];

const AES_CONFIG = {
  ALGORITHM: 'aes-256-gcm',
  FALLBACK_ALGORITHM: 'aes-256-cbc',
  KEY_LENGTH_BYTES: 32,
  IV_LENGTH_BYTES: 12,
  AUTH_TAG_LENGTH_BYTES: 16,
  SALT_LENGTH_BYTES: 16,
  PBKDF2_ITERATIONS: 100000,
  PBKDF2_DIGEST: 'sha256',
  VERSION: 'v1',
  DEFAULT_ENCODING: 'hex',
  SERIALIZATION_PREFIX: 'enc:v1:aes-256-gcm:',
};

const {
  EMAIL_REGEX,
  GSTIN_REGEX,
  PHONE_REGEX,
  VALIDATION_SCHEMAS,
  validatePayload,
} = require('./validationSchemas');

module.exports = {
  SOURCING_MODES,
  BUYER_SUBSCRIPTION_PLANS,
  VENDOR_SUBSCRIPTION_PLANS,
  INITIAL_SYSTEM_CONFIG,
  INITIAL_AZURE_HEALTH,
  QUALIFICATION_PILLARS,
  AES_CONFIG,
  EMAIL_REGEX,
  GSTIN_REGEX,
  PHONE_REGEX,
  VALIDATION_SCHEMAS,
  validatePayload,
};


