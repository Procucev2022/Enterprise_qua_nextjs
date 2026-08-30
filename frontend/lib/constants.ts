import type { SourcingModeDetail, SystemConfig, AzureServiceHealth } from './types';

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

export {
  FORM_SCHEMAS,
  validateFormData,
  EMAIL_PATTERN,
  GSTIN_PATTERN,
  PHONE_PATTERN,
} from './validationSchemas';
