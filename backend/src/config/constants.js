const path = require('path');

// ==============================================================================
// PROCUCEV ENTERPRISE (QUA AI 2.0) - CONSTANTS, TAXONOMIES & SYSTEM DEFAULTS
// ==============================================================================

const INQUIRIES_PERSISTENCE_FILE = typeof __dirname !== 'undefined'
  ? path.join(__dirname, '../../data/enterprise_inquiries.json')
  : './data/enterprise_inquiries.json';

/**
 * Centralized RFQ Modes Enum / Constants
 * V1 → Mode 1
 * V2 → Mode 2
 * V3 → Mode 3
 * V0 → Mode 0
 */
const RFQ_MODES = Object.freeze({
  MODE_0: 'mode_0',
  MODE_1: 'mode_1',
  MODE_2: 'mode_2',
  MODE_3: 'mode_3',
});

const RFQ_MODE_LABELS = Object.freeze({
  [RFQ_MODES.MODE_0]: 'Mode 0',
  [RFQ_MODES.MODE_1]: 'Mode 1',
  [RFQ_MODES.MODE_2]: 'Mode 2',
  [RFQ_MODES.MODE_3]: 'Mode 3',
});

const RFQ_MODE_MAP = Object.freeze({
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
});

const SOURCING_MODES = [
  {
    id: RFQ_MODES.MODE_0,
    code: RFQ_MODE_LABELS[RFQ_MODES.MODE_0],
    name: `${RFQ_MODE_LABELS[RFQ_MODES.MODE_0]}: Free Starter Trial Plan (Procucev Network Only)`,
    shortLabel: RFQ_MODE_LABELS[RFQ_MODES.MODE_0],
    description:
      'Free Starter Trial mode. RFQs are strictly circulated only to verified Procucev network vendors without consuming free credits.',
    badgeColor: 'border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10',
  },
  {
    id: RFQ_MODES.MODE_1,
    code: RFQ_MODE_LABELS[RFQ_MODES.MODE_1],
    name: `${RFQ_MODE_LABELS[RFQ_MODES.MODE_1]}: Client Roster Sourcing Plan`,
    shortLabel: RFQ_MODE_LABELS[RFQ_MODES.MODE_1],
    description:
      'Private empanelled vendor network. RFQs are strictly circulated only to your pre-verified approved vendor list.',
    badgeColor: 'border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/10',
  },
  {
    id: RFQ_MODES.MODE_2,
    code: RFQ_MODE_LABELS[RFQ_MODES.MODE_2],
    name: `${RFQ_MODE_LABELS[RFQ_MODES.MODE_2]}: Hybrid Sourcing Plan`,
    shortLabel: RFQ_MODE_LABELS[RFQ_MODES.MODE_2],
    description:
      'Circulate to your private empanelled list first. If quotes or responses are insufficient, AI expands to Procucev Base Network.',
    badgeColor: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10',
  },
  {
    id: RFQ_MODES.MODE_3,
    code: RFQ_MODE_LABELS[RFQ_MODES.MODE_3],
    name: `${RFQ_MODE_LABELS[RFQ_MODES.MODE_3]}: AI Autonomous Sourcing Plan`,
    shortLabel: RFQ_MODE_LABELS[RFQ_MODES.MODE_3],
    description:
      'Autonomous Procucev Network Sourcing with double-blind supplier identity shielding, continuous AI evaluation, and best-fit routing.',
    badgeColor: 'border-purple-500/40 text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/10',
  },
];

const BUYER_SUBSCRIPTION_PLANS = [
  {
    id: 'free_trial',
    name: 'Free Trial Starter (V0)',
    price: '₹0',
    billing: '5 Free RFQ Credits included for V1/V2/V3 + Unlimited V0',
    description: 'Create unlimited V0 RFQs sent to Procucev verified vendors (0 credits deducted), plus 5 free RFQ credits for V1, V2, or V3.',
    features: [
      'V0 Free Starter: Unlimited RFQs to Procucev network vendors (0 credits deducted)',
      '5 Free RFQ credits to trial V1 (Client Roster), V2 (Hybrid), and V3 (AI Autonomous)',
      'Autonomous Voice, WhatsApp & SMS multi-channel follow-ups',
      'Interactive Quote Matrix & 1-click PO generation',
      'SHA-256 cryptographic audit transaction seals',
    ],
  },
  {
    id: 'version_1',
    name: 'Version 1 Plan: Client Roster Only',
    get price() {
      const p = process.env.BUYER_V1_12M_PRICE || process.env.BUYER_VERSION_1_12M_PRICE || 4999;
      return `₹${Number(p).toLocaleString('en-IN')}`;
    },
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
    get price() {
      const p = process.env.BUYER_V2_12M_PRICE || process.env.BUYER_VERSION_2_12M_PRICE || 7499;
      return `₹${Number(p).toLocaleString('en-IN')}`;
    },
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
    get price() {
      const p = process.env.BUYER_V3_12M_PRICE || process.env.BUYER_VERSION_3_12M_PRICE || 9999;
      return `₹${Number(p).toLocaleString('en-IN')}`;
    },
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
    get price() {
      const p = process.env.SELLER_V1_12M_PRICE || process.env.SELLER_CONNECT_12M_PRICE || process.env.SELLER_CONNECT_PRICE || 7499;
      return `₹${Number(p).toLocaleString('en-IN')}`;
    },
    billing: 'per 12 months',
    description: 'Expand your market reach. Access & download open RFQs across the entire Procucev Network Marketplace.',
    features: [
      'All Premium Client-Uploaded features included',
      'Download up to 50 RFQs within 3 months (90-day period)',
      '🎁 360° AI Self-Evaluation Fee: ₹0 FREE (Waived from ₹5)',
      'Access to full Open Network Marketplace RFQs',
      'Instant email dispatch of technical BOQ spreadsheets & specifications',
    ],
  },
  {
    id: 'select',
    name: 'Select Model (Catalogue & High Volume)',
    get price() {
      const p = process.env.SELLER_V2_12M_PRICE || process.env.SELLER_SELECT_12M_PRICE || process.env.SELLER_SELECT_PRICE || 14999;
      return `₹${Number(p).toLocaleString('en-IN')}`;
    },
    billing: 'per 12 months',
    description: 'Complete tier for high-volume suppliers. Build your Item Catalogue and capture maximum marketplace demand.',
    features: [
      'Download up to 100 RFQs within 3 months',
      'Published Item SKU Catalogue with direct buyer visibility',
      '🎁 360° AI Self-Evaluation Fee: ₹0 FREE (Waived from ₹5)',
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

// Actor recorded on an audit entry when no signed-in user could be resolved for
// the action. Previously each call site invented its own plausible-looking human
// mailbox ('buyer@enterprise.com', 'procurement@enterprise.com',
// 'auditor@procucev.ai'), which made an unattributed system action read as a
// deliberate act by a named person.
const SYSTEM_ACTOR_EMAIL = 'system@procucev.ai';
// Time budget defaults for a newly raised RFQ. Real values, just not per-RFQ
// choices — kept here rather than inline so the chaser cadence and the UI agree.
const RFQ_DEFAULTS = {
  ALLOCATED_TIME: '24 hrs',
  ELAPSED_TIME: '0 hrs',
  ALLOWED_EXTENSION_HOURS: Object.freeze([24, 48]),
  DEFAULT_EXTENSION_HOURS: 24,
};
const ALLOWED_EXTENSION_HOURS = Object.freeze([24, 48]);
const DEFAULT_EXTENSION_HOURS = 24;
// Infrastructure rows the admin screen renders. The database row is replaced at
// runtime with the live result of pool.checkDatabaseHealth() (see
// storeService.refreshInfrastructureHealth), so the entry below is only the
// placeholder shown before the first probe completes.
//
// The previous first entry described 'Azure Database for MySQL (Shared Identity
// Schema)' as ONLINE with an 18ms latency and 99.99% uptime. That database is no
// longer part of this application at all.
const DATABASE_HEALTH_SERVICE_LABEL = 'PostgreSQL Database (Neon)';
const INITIAL_AZURE_HEALTH = [
  {
    service: DATABASE_HEALTH_SERVICE_LABEL,
    status: 'CHECKING',
    latency: '—',
    uptime: '—',
    details: 'Awaiting the first connection health probe.',
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

const AUTH_MESSAGES = {
  EMAIL_REQUIRED: 'Email is required.',
  EMAIL_PASSWORD_REQUIRED: 'Email and password are required.',
  EMAIL_MOBILE_PASSWORD_REQUIRED:
    'Email, registered mobile number and password are all required to sign in.',
  INVALID_CREDENTIALS: 'Invalid email or password.',
  // Password sign-in resolves the account by email + mobile together, so the
  // failure message names all three fields without revealing which one missed.
  INVALID_LOGIN_CREDENTIALS: 'Invalid password for this account. Check your password and try again.',
  // Java equivalent: "Invalid phone number and username" from POST /authenticate.
  INVALID_USERNAME_OR_MOBILE:
    'No active account matches this email address and mobile number together. Check both values, or register if you do not have an account yet.',
  MOBILE_REQUIRED: 'A 10-digit Indian mobile number is required.',
  PASSWORD_OR_CODE_REQUIRED: 'Password or OTP code is required.',
  AUTH_FAILED_FALLBACK: 'Authentication failed',
  OTP_EMAIL_REQUIRED: 'Email is required to dispatch OTP.',
  OTP_REQUEST_EMAIL_REQUIRED: 'Email is required to request OTP.',
  ACCOUNT_NOT_FOUND: 'No account found for this email. Please register first.',
  OTP_CODE_REQUIRED: 'Email and verification code are required.',
  INVALID_OTP: 'Invalid or expired OTP code.',
  INVALID_OTP_FALLBACK: 'Invalid OTP code.',
  REGISTRATION_EMAIL_REQUIRED: 'Email is required for registration.',
  ACCOUNT_EXISTS_LOGIN: 'Account already exists. Logged in successfully.',
  REGISTRATION_SUCCESS: 'Registration successful.',
  NO_SESSION_TOKEN: 'No active session token provided.',
  INVALID_SESSION_FALLBACK: 'Invalid session',
  SESSION_TOKEN_MISSING: 'Token missing or invalid',
  MALFORMED_TOKEN: 'Malformed token structure',
  INVALID_TOKEN_SIGNATURE: 'Invalid token signature',
  SESSION_LOGGED_OUT: 'Session has been logged out.',
  SESSION_EXPIRED: 'Session token has expired',
  TOKEN_DECODE_FAILED: 'Failed to decode token payload',
  LOGOUT_SUCCESS: 'Logged out successfully.',
  // Self-service password change. The current password is re-verified against
  // the stored row on every attempt, because the session token proves who the
  // caller is but not that they still know the credential.
  CHANGE_PASSWORD_FIELDS_REQUIRED:
    'A new password and verification code (or current password) are required to change your password.',
  CHANGE_PASSWORD_VERIFICATION_REQUIRED:
    'A valid verification code or reset token is required to change your password.',
  CHANGE_PASSWORD_VERIFICATION_INVALID:
    'Invalid or expired verification code. Please request a new code and try again.',
  CHANGE_PASSWORD_CURRENT_INCORRECT:
    'Your current password is not correct, so the password was not changed. Re-enter it and try again.',
  CHANGE_PASSWORD_TOO_SHORT: 'Choose a new password of at least 8 characters.',
  CHANGE_PASSWORD_UNCHANGED:
    'The new password is the same as your current one. Choose a different password.',
  CHANGE_PASSWORD_ACCOUNT_MISSING:
    'Your account record could not be read, so the password was not changed. Sign in again and retry.',
  CHANGE_PASSWORD_WRITE_FAILED:
    'The new password could not be saved, so your existing password is still in effect. Try again in a moment.',
  CHANGE_PASSWORD_SUCCESS: 'Your password has been changed. Use it the next time you sign in.',
  LOGOUT_REVOCATION_FAILED:
    'Your session could not be ended because the database is unreachable. Try again; if it persists, close the browser to discard the session locally.',
  IDENTITY_DB_UNAVAILABLE:
    'The database is unreachable, so credentials cannot be verified right now. Confirm the DATABASE_URL in backend/.env is correct and that this host is allowed to reach the PostgreSQL instance, then retry.',
  IDENTITY_DB_NOT_CONFIGURED:
    'No database is configured. Set DATABASE_URL in backend/.env so logins can be verified against real account records.',
  // Revocation is checked against the database, so an unreachable database means
  // the session cannot be confirmed as still valid. It fails closed and says so,
  // rather than reporting the credentials as invalid.
  SESSION_CHECK_UNAVAILABLE:
    'Your session could not be confirmed because the database is unreachable. Try again in a moment; if it persists, sign in again.',
  OTP_STORAGE_FAILED:
    'The verification code could not be saved, so it has not been sent. Try requesting a new code in a moment.',
  // Delivery is confirmed before "sent" is reported, so a failed send is told to
  // the visitor instead of leaving them waiting for a code that never arrives.
  OTP_DELIVERY_FAILED:
    'We could not deliver your verification code by email or SMS right now. Please try again in a few minutes.',
  OTP_EMAIL_DELIVERY_FAILED:
    'We could not send the verification email right now, so registration cannot be verified. Please try again in a few minutes.',
  OTP_SMS_DELIVERY_FAILED:
    'We could not send the verification SMS right now, so registration cannot be verified. Please try again in a few minutes.',
  ACCOUNT_INACTIVE:
    'This account is marked inactive. Ask an administrator to re-activate it before signing in.',
  ACCOUNT_PENDING_APPROVAL:
    'This self-registered account is still awaiting administrator approval, so sign-in is blocked. You will be able to log in once it is approved.',
  ACCOUNT_ALREADY_EXISTS:
    'An account already exists for this email address and mobile number. Use the Sign In tab instead of creating a new account.',
};

// ==============================================================================
// IDENTITY DATABASE (shared Procucev MySQL) - role + master-data mapping
// ==============================================================================

// Maps a `role.role_name` value in the shared MySQL schema onto the four
// application roles the Next.js workspace understands. Unmapped roles are
// rejected at login rather than silently downgraded to `buyer`.
const IDENTITY_ROLE_MAP = {
  clientinitiator: 'buyer',
  'clientinitiator1.1': 'buyer',
  client: 'buyer',
  prapprover: 'buyer',
  prapprover2: 'buyer',
  'prapprover1.1': 'buyer',
  vendor: 'vendor',
  vendorpartner: 'vendor',
  partialvendor: 'vendor',
  registration: 'vendor',
  categorymanager: 'category_manager',
  categorymanager2: 'category_manager',
  categorymanagerbasic: 'category_manager',
  categorymanagerbasic2: 'category_manager',
  vendormanager: 'admin',
  vendormanager2: 'admin',
  vendormanager3: 'admin',
  vendorexecutive: 'admin',
  vendorexecutive2: 'admin',
  superuser: 'admin',
  procucev: 'admin',
};

// Master-data row identifiers that already exist in the shared schema. These are
// looked up by name at runtime; the ids are documented fallbacks only.
const IDENTITY_MASTER_DATA = {
  BUYER_ROLE_NAME: 'ClientInitiator',
  BUYER_ORG_TYPE: 'CLIENT',
  BUYER_STATUS: 'CLIENT_NEW',
  VENDOR_ROLE_NAME: 'Vendor',
  VENDOR_ORG_TYPE: 'VENDOR',
  VENDOR_STATUS: 'VENDOR_NEW',
  CATEGORY_MANAGER_ROLE_NAME: 'CategoryManager',
  CATEGORY_MANAGER_ORG_TYPE: 'INTERNAL',
  CATEGORY_MANAGER_STATUS: 'STAFF_ACTIVE',
  ADMIN_ROLE_NAME: 'SuperUser',
  ADMIN_ORG_TYPE: 'INTERNAL',
  ADMIN_STATUS: 'STAFF_ACTIVE',
  DEFAULT_GMT_PLAN: 'GMT Basic',
  DEFAULT_BFS_PLAN: 'BFS PRO',
  SOURCE_TYPE_WEB: 'W',
  VERIFICATION_VERIFIED: 'EMAIL_VERIFIED',
  VERIFICATION_PENDING: 'PENDING_EMAIL_VERIFICATION',
};

// Indian phone numbers are stored normalised as +91XXXXXXXXXX in the shared
// schema, and the Java login path compares them byte-for-byte.
const IDENTITY_PHONE_CONFIG = {
  DEFAULT_COUNTRY_CODE: '+91',
  NATIONAL_NUMBER_LENGTH: 10,
  // Bare dialling digits, used to detect an already-prefixed 91XXXXXXXXXX value.
  COUNTRY_DIALLING_DIGITS: '91',
};

// ==============================================================================
// RFQ SUMMARY
// ==============================================================================
// Bounds on the generated per-RFQ summary. The item cap keeps a 300-line BOQ
// from producing a prompt large enough to blow the model's context or the
// request timeout; the head of the list is representative enough to summarise.
const RFQ_SUMMARY_CONFIG = {
  MAX_PROMPT_ITEMS: 40,
  MAX_HEADLINE_CHARS: 140,
  MAX_RISK_NOTES: 5,
};

// ==============================================================================
// ACTIVE BUYER ACCOUNT
// ==============================================================================
// The signed-in buyer's account comes from the shared identity schema. There is
// no seeded fallback: a fabricated account is how the dashboard used to attribute
// one buyer's work to another company entirely.
const BUYER_ACCOUNT_RESOLUTION = {
  SOURCE_IDENTITY_DB: 'identity_database',
  STATUS_ACTIVE: 'ACTIVE_VERIFIED',
  MESSAGES: {
    NO_SESSION: 'Sign in to load your organisation profile.',
    IDENTITY_UNAVAILABLE:
      'The account directory is unavailable, so your organisation profile cannot be loaded. Try again shortly.',
    LOOKUP_FAILED:
      'Your organisation profile could not be read. Try again, and if it persists contact your administrator.',
    USER_NOT_FOUND:
      'No account was found for this session. Sign in again, and if it persists contact your administrator.',
    ORG_NOT_LINKED:
      'Your account is not linked to a buyer organisation yet. Ask your administrator to link it, then sign in again.',
  },
};

// ==============================================================================
// RFQ LINE-ITEM CATEGORY CLASSIFICATION
// ==============================================================================
// Resolves a major ("division") and minor ("category") for every ingested line
// item in strict precedence: an explicit non-generic category wins, then a
// domain keyword match, then unclassified. Confidence and status are recorded so
// the buyer can see why an item landed where it did.
//
// Every major/minor pair below must exist in the `category_division` table,
// otherwise the review grid cannot render the value in its dropdowns.
//
// DEFAULT_MAJOR_CATEGORY / DEFAULT_MINOR_CATEGORY are deliberately gone. They
// held 'General Procurement' / 'General Industrial Goods', neither of which is a
// row in that table — so the "documented default" was a pair no dropdown could
// display and no vendor was mapped to. An unmatched item is now left blank and
// flagged for review instead.
const RFQ_CATEGORY_CLASSIFICATION = {
  // How long the ingestion service caches its taxonomy index. The master changes
  // rarely and an ingest reads it once per request, so a shared cache keeps the
  // flow from re-reading a few hundred rows on every upload.
  TAXONOMY_CACHE_TTL_MS: 10 * 60 * 1000,

  CONFIDENCE: {
    EXPLICIT: 0.95,
    KEYWORD: 0.9,
    DEFAULT: 0.5,
  },

  STATUS: {
    EXPLICIT: 'AI_EXTRACTED',
    KEYWORD: 'DOMAIN_KEYWORD_MATCHED',
    DEFAULT: 'DEFAULT',
  },

  // Values that look like a category but carry no routing information, so they
  // must not short-circuit keyword matching.
  GENERIC_CATEGORY_TOKENS: [
    'multiple',
    'various',
    'mixed',
    'general',
    'not specified',
    'unspecified',
    'unknown',
    'other',
    'others',
    'misc',
    'miscellaneous',
    'n/a',
    'na',
    'none',
    'tbd',
  ],

  // Umbrella labels a document's own "Category" column tends to carry, mapped to
  // the real taxonomy minor they mean. These are NOT taxonomy minors themselves,
  // so without this map resolveStatedCategory() rejects them and the stated
  // category — which the document actually gave — is discarded, forcing every
  // row to fall through to keyword matching (or blank). The minor each alias
  // points to must exist in the category_division master, otherwise the review
  // grid cannot render it. A label with no genuine taxonomy home (e.g. "Medical
  // Equipment") is deliberately absent: it stays blank and is flagged for review
  // rather than being forced into an unrelated category (RULE 10).
  //
  // Keys are compared lowercased and trimmed (see resolveStatedCategoryAlias).
  STATED_CATEGORY_ALIASES: {
    // IT aliases (taxonomy major "IT")
    'it': 'Hardware',
    'it equipment': 'Hardware',
    'it hardware': 'Hardware',
    'computer hardware': 'Hardware',
    'it software': 'Software',
    'computers': 'Computer',
    'laptops': 'Laptop',
    'monitors': 'Hardware',
    'printers': 'Printers',
    'servers': 'Servers',
    'networking': 'Networking Equipment',
    // Electrical goods -> Engineering Spares - Electrical » Lights.
    'electrical equipment': 'Lights',
    'electrical material': 'Lights',
    'electrical goods': 'Lights',
    'lighting equipment': 'Lights',
    // Plumbing -> Civil Works » Plumbing.
    'plumbing material': 'Plumbing',
    'plumbing equipment': 'Plumbing',
    'plumbing goods': 'Plumbing',
    // Piping -> Engineering Spares - Mechanical » Pipes & Pipe Fittings.
    'piping material': 'Pipes & Pipe Fittings',
    // Safety & PPE aliases -> Occuptional Health and Safety
    'helmet': 'Helmets',
    'helmets': 'Helmets',
    'hard hat': 'Helmets',
    'hard hats': 'Helmets',
    'safety helmet': 'Helmets',
    'safety helmets': 'Helmets',
    'hemlet': 'Hemlets',
    'hemlets': 'Hemlets',
    'safety shoe': 'Safety Shoes',
    'safety shoes': 'Safety Shoes',
    'safety boot': 'Safety Shoes',
    'safety boots': 'Safety Shoes',
    'safety goggles': 'Eye Protection',
    'safety glasses': 'Eye Protection',
    'first aid box': 'First Aid Kits',
    'first aid kit': 'First Aid Kits',
    'fire safety': 'Fire Extinguishers',
    'groceries': 'Food & Beverages',
    'grocery': 'Food & Beverages',
    'food': 'Food & Beverages',
    'food & beverage': 'Food & Beverages',
    'food and beverage': 'Food & Beverages',
    'food & beverages': 'Food & Beverages',
    'food and beverages': 'Food & Beverages',
    'disposable gloves': 'Gloves',
    'surgical gloves': 'Gloves',
    'examination gloves': 'Gloves',
    'surgical instruments': 'Surgical Instruments',
    'surgical instrument': 'Surgical Instruments',
    'health equipment': 'Health Equipments',
    'health equipments': 'Health Equipments',
  },

  // Aliases for major category abbreviations/legacy names to canonical taxonomy names
  MAJOR_CATEGORY_ALIASES: {
    mechanical: 'Engineering Spares - Mechanical',
    electrical: 'Engineering Spares - Electrical',
    civil: 'Civil Works',
    safety: 'Occuptional Health and Safety',
    'occupational health and safety': 'Occuptional Health and Safety',
    packaging: 'Packing Material',
    packing: 'Packing Material',
    stationery: 'Printing & Stationery',
    retail: 'Retail Repair & Maintenance',
    it: 'IT',
    logistics: 'Logistics',
    'pumps & motors': 'Engineering Spares - Mechanical',
    'pumps and motors': 'Engineering Spares - Mechanical',
    electronics: 'Engineering Spares - Electrical',
    electronic: 'Engineering Spares - Electrical',
    piping: 'Engineering Spares - Mechanical',
    pipes: 'Engineering Spares - Mechanical',
    valves: 'Engineering Spares - Mechanical',
    pumps: 'Engineering Spares - Mechanical',
    motors: 'Engineering Spares - Electrical',
    'general procurement': 'Others – New Product',
  },

  // Keywords that describe raw/component materials rather than product purpose.
  // When classifying by technical specifications alone, these must be ignored so
  // finished goods (e.g. Stethoscopes with stainless steel parts) are not misclassified.
  MATERIAL_ONLY_KEYWORDS: [
    'steel',
    'steels',
    'structural steel',
    'rebar',
    'tmt',
    'lubricant',
    'lubricants',
    'rubber',
    'plastic',
    'copper',
    'brass',
    'aluminium',
    'aluminum',
    'metal',
    'metals',
    'iron',
    'cast iron',
    'sheet metal',
    'electrical',
  ],

  // Longest keyword is evaluated first so "circuit breaker" beats "breaker".
  DOMAIN_KEYWORD_MAP: {
    // Grocery & Food items -> Others – New Product » Food & Beverages
    'sugar packing': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'sugar refined': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'sugar loose': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'madhur sugar': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'toor dal loose': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'toor dal': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'gram dal loose': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'gram dal': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'chana dal': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'moong dal': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'urad dal': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'masoor dal': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'dal loose': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'dal': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'pulses': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'sugar': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'groceries': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'grocery': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'food & beverages': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'food and beverages': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'beverages': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'beverage': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'rice': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'wheat': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'atta': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'maida': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'sooji': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'tea': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'coffee': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'spices': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'salt': { major: 'Others – New Product', minor: 'Food & Beverages' },
    'edible oil': { major: 'Raw Material', minor: 'Edible Oil' },

    // Medical & Healthcare items -> Others – New Product » Health Equipments
    'stethoscope': { major: 'Others – New Product', minor: 'Health Equipments' },
    'pulse oximeter': { major: 'Others – New Product', minor: 'Health Equipments' },
    'oximeter': { major: 'Others – New Product', minor: 'Health Equipments' },
    'thermometer': { major: 'Others – New Product', minor: 'Health Equipments' },
    'sphygmomanometer': { major: 'Others – New Product', minor: 'Health Equipments' },
    'bp monitor': { major: 'Others – New Product', minor: 'Health Equipments' },
    'blood pressure monitor': { major: 'Others – New Product', minor: 'Health Equipments' },
    'glucometer': { major: 'Others – New Product', minor: 'Health Equipments' },
    'nebulizer': { major: 'Others – New Product', minor: 'Health Equipments' },
    'ventilator': { major: 'Others – New Product', minor: 'Health Equipments' },
    'ecg machine': { major: 'Others – New Product', minor: 'Health Equipments' },
    'ecg monitor': { major: 'Others – New Product', minor: 'Health Equipments' },
    'health equipment': { major: 'Others – New Product', minor: 'Health Equipments' },
    'health equipments': { major: 'Others – New Product', minor: 'Health Equipments' },
    'surgical instrument': { major: 'CAPEX - Equipment & Machinery', minor: 'Surgical Instruments' },
    'surgical instruments': { major: 'CAPEX - Equipment & Machinery', minor: 'Surgical Instruments' },
    'ambulance': { major: 'CAPEX - Equipment & Machinery', minor: 'Ambulances' },
    'ambulances': { major: 'CAPEX - Equipment & Machinery', minor: 'Ambulances' },
    'disposable gloves': { major: 'Occuptional Health and Safety', minor: 'Gloves' },
    'surgical gloves': { major: 'Occuptional Health and Safety', minor: 'Gloves' },
    'examination gloves': { major: 'Occuptional Health and Safety', minor: 'Gloves' },
    'latex gloves': { major: 'Occuptional Health and Safety', minor: 'Gloves' },
    'nitrile gloves': { major: 'Occuptional Health and Safety', minor: 'Gloves' },
    'medicine': { major: 'Occuptional Health and Safety', minor: 'Medicines' },
    'medicines': { major: 'Occuptional Health and Safety', minor: 'Medicines' },

    // Existing Engineering & Industrial mappings
    // ── IT & Computing ──
    'laserjet printer': { major: 'IT', minor: 'Printers' },
    'inkjet printer': { major: 'IT', minor: 'Printers' },
    'multifunction printer': { major: 'IT', minor: 'Printers' },
    'barcode scanner': { major: 'IT', minor: 'BARCODE SCANNERS' },
    'barcode reader': { major: 'IT', minor: 'BARCODE SCANNERS' },
    'wireless keyboard': { major: 'IT', minor: 'Hardware' },
    'keyboard and mouse': { major: 'IT', minor: 'Hardware' },
    'keyboard & mouse': { major: 'IT', minor: 'Hardware' },
    'external ssd': { major: 'IT', minor: 'Hardware' },
    'external hdd': { major: 'IT', minor: 'Hardware' },
    'hard drive': { major: 'IT', minor: 'Hardware' },
    'hard disk': { major: 'IT', minor: 'Hardware' },
    'solid state drive': { major: 'IT', minor: 'Hardware' },
    'network switch': { major: 'IT', minor: 'Networking Equipment' },
    'networking equipment': { major: 'IT', minor: 'Networking Equipment' },
    'access point': { major: 'IT', minor: 'Networking Equipment' },
    'ethernet cable': { major: 'IT', minor: 'Networking Equipment' },
    'patch cord': { major: 'IT', minor: 'Networking Equipment' },
    'lan cable': { major: 'IT', minor: 'Networking Equipment' },
    'cctv camera': { major: 'IT', minor: 'CCTV' },
    'dome camera': { major: 'IT', minor: 'CCTV' },
    'bullet camera': { major: 'IT', minor: 'CCTV' },
    'ip camera': { major: 'IT', minor: 'CCTV' },
    'toner cartridge': { major: 'IT', minor: 'IT Consumables' },
    'audio visual': { major: 'IT', minor: 'Audio Visual Equipment' },
    'all-in-one pc': { major: 'IT', minor: 'Computer' },
    'desktop pc': { major: 'IT', minor: 'Computer' },
    'desktop computer': { major: 'IT', minor: 'Computer' },
    'rack server': { major: 'IT', minor: 'Servers' },
    'blade server': { major: 'IT', minor: 'Servers' },
    'led monitor': { major: 'IT', minor: 'Hardware' },
    'lcd monitor': { major: 'IT', minor: 'Hardware' },
    'computer monitor': { major: 'IT', minor: 'Hardware' },
    'pc monitor': { major: 'IT', minor: 'Hardware' },
    keyboard: { major: 'IT', minor: 'Hardware' },
    mouse: { major: 'IT', minor: 'Hardware' },
    printer: { major: 'IT', minor: 'Printers' },
    printers: { major: 'IT', minor: 'Printers' },
    laptop: { major: 'IT', minor: 'Laptop' },
    laptops: { major: 'IT', minor: 'Laptop' },
    notebook: { major: 'IT', minor: 'Laptop' },
    desktop: { major: 'IT', minor: 'Computer' },
    computer: { major: 'IT', minor: 'Computer' },
    workstation: { major: 'IT', minor: 'Computer' },
    server: { major: 'IT', minor: 'Servers' },
    servers: { major: 'IT', minor: 'Servers' },
    scanner: { major: 'IT', minor: 'BARCODE SCANNERS' },
    cctv: { major: 'IT', minor: 'CCTV' },
    dvr: { major: 'IT', minor: 'CCTV' },
    nvr: { major: 'IT', minor: 'CCTV' },
    router: { major: 'IT', minor: 'Networking Equipment' },
    firewall: { major: 'IT', minor: 'Networking Equipment' },
    ssd: { major: 'IT', minor: 'Hardware' },
    hdd: { major: 'IT', minor: 'Hardware' },
    nvme: { major: 'IT', minor: 'Hardware' },
    ram: { major: 'IT', minor: 'Hardware' },
    toner: { major: 'IT', minor: 'IT Consumables' },
    cartridge: { major: 'IT', minor: 'IT Consumables' },
    projector: { major: 'IT', minor: 'Audio Visual Equipment' },
    software: { major: 'IT', minor: 'Software' },
    antivirus: { major: 'IT', minor: 'Software' },
    intercom: { major: 'IT', minor: 'Telecom & Security Products' },
    epabx: { major: 'IT', minor: 'Telecom & Security Products' },

    // ── Engineering Spares - Mechanical ──
    'centrifugal pump': { major: 'Engineering Spares - Mechanical', minor: 'Pumps & Accessories' },
    'submersible pump': { major: 'Engineering Spares - Mechanical', minor: 'Pumps & Accessories' },
    'gate valve': { major: 'Engineering Spares - Mechanical', minor: 'Hoses, Valves & Fittings' },
    'ball valve': { major: 'Engineering Spares - Mechanical', minor: 'Hoses, Valves & Fittings' },
    'butterfly valve': { major: 'Engineering Spares - Mechanical', minor: 'Hoses, Valves & Fittings' },
    'check valve': { major: 'Engineering Spares - Mechanical', minor: 'Hoses, Valves & Fittings' },
    'globe valve': { major: 'Engineering Spares - Mechanical', minor: 'Hoses, Valves & Fittings' },
    'solenoid valve': { major: 'Engineering Spares - Mechanical', minor: 'Hoses, Valves & Fittings' },
    'hydraulic hose': { major: 'Engineering Spares - Mechanical', minor: 'Hoses, Valves & Fittings' },
    'pipe fittings': { major: 'Engineering Spares - Mechanical', minor: 'Pipes & Pipe Fittings' },
    'flange': { major: 'Engineering Spares - Mechanical', minor: 'Pipes & Pipe Fittings' },
    'elbow': { major: 'Engineering Spares - Mechanical', minor: 'Pipes & Pipe Fittings' },
    'compressor': { major: 'Engineering Spares - Mechanical', minor: 'Compressors & Accessories' },
    'air compressor': { major: 'Engineering Spares - Mechanical', minor: 'Compressors & Accessories' },
    gearbox: { major: 'Engineering Spares - Mechanical', minor: 'Gearboxes & Spares' },
    bearing: { major: 'Engineering Spares - Mechanical', minor: 'Bearings & Accessories' },
    'ball bearing': { major: 'Engineering Spares - Mechanical', minor: 'Bearings & Accessories' },
    'roller bearing': { major: 'Engineering Spares - Mechanical', minor: 'Bearings & Accessories' },
    fastener: { major: 'Engineering Spares - Mechanical', minor: 'Fasteners' },
    'hex bolt': { major: 'Engineering Spares - Mechanical', minor: 'Fasteners' },
    'anchor bolt': { major: 'Engineering Spares - Mechanical', minor: 'Fasteners' },
    impeller: { major: 'Engineering Spares - Mechanical', minor: 'Pumps & Accessories' },
    pump: { major: 'Engineering Spares - Mechanical', minor: 'Pumps & Accessories' },
    pumps: { major: 'Engineering Spares - Mechanical', minor: 'Pumps & Accessories' },
    valve: { major: 'Engineering Spares - Mechanical', minor: 'Hoses, Valves & Fittings' },
    valves: { major: 'Engineering Spares - Mechanical', minor: 'Hoses, Valves & Fittings' },
    hose: { major: 'Engineering Spares - Mechanical', minor: 'Hoses, Valves & Fittings' },
    pipe: { major: 'Engineering Spares - Mechanical', minor: 'Pipes & Pipe Fittings' },
    panel: { major: 'Engineering Spares - Electrical', minor: 'Panels' },
    cable: { major: 'Engineering Spares - Electrical', minor: 'Cables' },
    sensor: { major: 'Engineering Spares - Electrical', minor: 'Sensors' },
    motor: { major: 'Engineering Spares - Electrical', minor: 'Motors' },
    pipes: { major: 'Engineering Spares - Mechanical', minor: 'Pipes & Pipe Fittings' },
    gasket: { major: 'Engineering Spares - Mechanical', minor: 'O-Rings / Gasket / Seals' },
    'o-ring': { major: 'Engineering Spares - Mechanical', minor: 'O-Rings / Gasket / Seals' },
    'oil seal': { major: 'Engineering Spares - Mechanical', minor: 'O-Rings / Gasket / Seals' },
    filter: { major: 'Engineering Spares - Mechanical', minor: 'Filters' },
    filters: { major: 'Engineering Spares - Mechanical', minor: 'Filters' },
    tool: { major: 'Engineering Spares - Mechanical', minor: 'Tools & Tackles' },
    tools: { major: 'Engineering Spares - Mechanical', minor: 'Tools & Tackles' },
    'welding machine': { major: 'Engineering Spares - Mechanical', minor: 'Welding Equipment & Cutting Machines' },
    'welding electrode': { major: 'Engineering Spares - Mechanical', minor: 'Welding Materials' },

    // ── Engineering Spares - Electrical ──
    'circuit breaker': { major: 'Engineering Spares - Electrical', minor: 'Circuit Breakers' },
    'air circuit breaker': { major: 'Engineering Spares - Electrical', minor: 'Circuit Breakers' },
    'flood light': { major: 'Engineering Spares - Electrical', minor: 'Lights' },
    'street light': { major: 'Engineering Spares - Electrical', minor: 'Lights' },
    'led light': { major: 'Engineering Spares - Electrical', minor: 'Lights' },
    'high bay light': { major: 'Engineering Spares - Electrical', minor: 'Lights' },
    luminaire: { major: 'Engineering Spares - Electrical', minor: 'Lights' },
    switchgear: { major: 'Engineering Spares - Electrical', minor: 'Electrical-Lv Switch Gears' },
    transformer: { major: 'Engineering Spares - Electrical', minor: 'Transformers' },
    mccb: { major: 'Engineering Spares - Electrical', minor: 'Circuit Breakers' },
    mcb: { major: 'Engineering Spares - Electrical', minor: 'Circuit Breakers' },
    rccb: { major: 'Engineering Spares - Electrical', minor: 'Circuit Breakers' },
    panel: { major: 'Engineering Spares - Electrical', minor: 'Panels' },
    panels: { major: 'Engineering Spares - Electrical', minor: 'Panels' },
    cable: { major: 'Engineering Spares - Electrical', minor: 'Cables' },
    cables: { major: 'Engineering Spares - Electrical', minor: 'Cables' },
    wire: { major: 'Engineering Spares - Electrical', minor: 'Wires' },
    wires: { major: 'Engineering Spares - Electrical', minor: 'Wires' },
    sensor: { major: 'Engineering Spares - Electrical', minor: 'Sensors' },
    sensors: { major: 'Engineering Spares - Electrical', minor: 'Sensors' },
    motor: { major: 'Engineering Spares - Electrical', minor: 'Motors' },
    motors: { major: 'Engineering Spares - Electrical', minor: 'Motors' },
    battery: { major: 'Engineering Spares - Electrical', minor: 'Batteries' },
    batteries: { major: 'Engineering Spares - Electrical', minor: 'Batteries' },
    earthing: { major: 'Engineering Spares - Electrical', minor: 'Earthing Items' },
    capacitor: { major: 'Engineering Spares - Electrical', minor: 'Electrical Capacitors' },

    // ── Civil Works ──
    'structural steel': { major: 'Civil Works', minor: 'PEB Structure' },
    'roofing sheet': { major: 'Civil Works', minor: 'Roofing Sheets' },
    'water pipe': { major: 'Civil Works', minor: 'Plumbing' },
    rebar: { major: 'Civil Works', minor: 'TMT BARS' },
    hdpe: { major: 'Civil Works', minor: 'Plumbing' },
    cpvc: { major: 'Civil Works', minor: 'Plumbing' },
    upvc: { major: 'Civil Works', minor: 'Plumbing' },
    plumbing: { major: 'Civil Works', minor: 'Plumbing' },
    peb: { major: 'Civil Works', minor: 'PEB Structure' },
    tmt: { major: 'Civil Works', minor: 'TMT BARS' },
    steel: { major: 'Raw Material', minor: 'Steels' },
    tool: { major: 'Engineering Spares - Mechanical', minor: 'Tools & Tackles' },
    'tmt bar': { major: 'Civil Works', minor: 'TMT BARS' },
    'tmt bars': { major: 'Civil Works', minor: 'TMT BARS' },
    bricks: { major: 'Civil Works', minor: 'Bricks' },
    brick: { major: 'Civil Works', minor: 'Bricks' },
    paint: { major: 'Civil Works', minor: 'Paints' },
    paints: { major: 'Civil Works', minor: 'Paints' },
    waterproofing: { major: 'Civil Works', minor: 'Waterproofing' },
    scaffolding: { major: 'Civil Works', minor: 'Ladders & Scaffolding' },
    flooring: { major: 'Civil Works', minor: 'Flooring Material' },
    tiles: { major: 'Civil Works', minor: 'Flooring Material' },

    // ── Safety & Health ──
    'fire extinguisher': { major: 'Occuptional Health and Safety', minor: 'Fire Extinguishers' },
    'safety jacket': { major: 'Occuptional Health and Safety', minor: 'Safety jackets' },
    'safety shoe': { major: 'Occuptional Health and Safety', minor: 'Safety Shoes' },
    'safety shoes': { major: 'Occuptional Health and Safety', minor: 'Safety Shoes' },
    'safety boots': { major: 'Occuptional Health and Safety', minor: 'Safety Shoes' },
    'safety helmet': { major: 'Occuptional Health and Safety', minor: 'Helmets' },
    'hard hat': { major: 'Occuptional Health and Safety', minor: 'Helmets' },
    helmets: { major: 'Occuptional Health and Safety', minor: 'Helmets' },
    helmet: { major: 'Occuptional Health and Safety', minor: 'Helmets' },
    hemlet: { major: 'Occuptional Health and Safety', minor: 'Hemlets' },
    harness: { major: 'Occuptional Health and Safety', minor: 'Harness' },
    glove: { major: 'Occuptional Health and Safety', minor: 'Gloves' },
    gloves: { major: 'Occuptional Health and Safety', minor: 'Gloves' },
    filter: { major: 'Engineering Spares - Mechanical', minor: 'Filters' },

    // ── Packaging & Materials ──
    'corrugated box': { major: 'Packing Material', minor: 'Corrugated Boxes' },
    'corrugated roll': { major: 'Packing Material', minor: 'Corrugated Rolls' },
    'bubble roll': { major: 'Packing Material', minor: 'Bubble Rolls' },
    'bubble wrap': { major: 'Packing Material', minor: 'Bubble Rolls' },
    'shrink film': { major: 'Packing Material', minor: 'Shrink Flims' },
    'stretch film': { major: 'Packing Material', minor: 'Shrink Flims' },
    pallet: { major: 'Packing Material', minor: 'Pallets' },
    pallets: { major: 'Packing Material', minor: 'Pallets' },
    'packaging tape': { major: 'Packing Material', minor: 'Tapes' },

    // ── Raw Materials & Logistics ──
    steel: { major: 'Raw Material', minor: 'Steels' },
    lubricant: { major: 'Raw Material', minor: 'Lubricants' },
    freight: { major: 'Logistics', minor: 'Road transport' },
    transport: { major: 'Logistics', minor: 'Road transport' },

    // ── Services & Others ──
    'storage rack': { major: 'Others – New Product', minor: 'Storage Racks' },
    consulting: { major: 'Others – New Service', minor: 'Consulting' },
    calibration: { major: 'Others – New Service', minor: 'Calibration Services' },
  },
};

const DEFAULT_CATEGORY_TAXONOMY = require('./categoryTaxonomyMaster.json');

// ==============================================================================
// GEMINI AI DOCUMENT EXTRACTION
// ==============================================================================
// Mirrors app.gemini.* in the Java p2pservices app, which is the service that
// currently extracts RFQ line items in production. The API keys are read from the
// environment only and never leave the server. Supports a comma-separated list
// of multiple keys in GEMINI_API_KEY with round-robin sequential rotation per request
// to expand rate limits on free tier accounts.
// Gemini extraction policy is intentionally code-owned rather than environment
// configurable: one operation may run for up to fifteen minutes, with fixed input
// limits that protect memory and provider payload size.
const GEMINI_TOTAL_BUDGET_MS = Number(process.env.GEMINI_TOTAL_BUDGET_MS || 15 * 60 * 1000);
const GEMINI_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const GEMINI_MAX_DOCUMENT_TEXT_CHARS = 300000;

const GEMINI_CONFIG = {
  API_KEYS: (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_KEYS) ||
    (typeof globalThis !== 'undefined' && globalThis.__CF_ENV__ && globalThis.__CF_ENV__.GEMINI_API_KEYS) ||
    '',
  API_KEY: (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_KEY) ||
    (typeof globalThis !== 'undefined' && globalThis.__CF_ENV__ && globalThis.__CF_ENV__.GEMINI_API_KEY) ||
    '',
  BACKUP_KEYS: (typeof process !== 'undefined' && process.env && process.env.GEMINI_BACKUP_KEYS) ||
    (typeof globalThis !== 'undefined' && globalThis.__CF_ENV__ && globalThis.__CF_ENV__.GEMINI_BACKUP_KEYS) ||
    '',
  DISABLE_TIMEOUT: process.env.GEMINI_DISABLE_TIMEOUT === 'true',
  KEY_COOLDOWN_MS: Number(
    process.env.GEMINI_KEY_COOLDOWN_MS !== undefined
      ? process.env.GEMINI_KEY_COOLDOWN_MS
      : (process.env.NODE_ENV === 'test' ? 0 : 60000)
  ),
  BASE_URL: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/models',
  // Ordered models attempted in sequence: gemini-3.5-flash-lite down to reasoning fallback models.
  // Extraction automatically advances through the backup models upon error or 503 overload.
  MODELS: (
    process.env.GEMINI_MODELS ||
    'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash'
  )
    .split(',')
    .map((m) => m.trim().replace(/\s+/g, '-'))
    .filter(Boolean),
  get PRIMARY_MODEL() {
    return this.MODELS[0] || 'gemini-3.5-flash-lite';
  },
  set PRIMARY_MODEL(val) {
    if (val) {
      this.MODELS = Array.from(new Set([val, ...this.MODELS]));
    }
  },
  get FALLBACK_MODELS() {
    return this.MODELS.slice(1);
  },
  set FALLBACK_MODELS(arr) {
    const list = Array.isArray(arr) ? arr : (typeof arr === 'string' ? arr.split(',').map((m) => m.trim()) : []);
    this.MODELS = Array.from(new Set([this.PRIMARY_MODEL, ...list].filter(Boolean)));
  },
  // Kept as a mutable compatibility field for tests and old callers, but zero
  // means there is no per-model timeout. Production uses only TOTAL_BUDGET_MS.
  REQUEST_TIMEOUT_MS: Number(process.env.GEMINI_REQUEST_TIMEOUT_MS || 0),
  PER_MODEL_TIMEOUT_MS: Number(process.env.GEMINI_PER_MODEL_TIMEOUT_MS || 0),
  TOTAL_BUDGET_MS: GEMINI_TOTAL_BUDGET_MS,
  MIN_ATTEMPT_MS: 0,
  MAX_DOCUMENT_BYTES: GEMINI_MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_TEXT_CHARS: GEMINI_MAX_DOCUMENT_TEXT_CHARS,
  // Maximum number of API keys attempted per individual model before advancing
  // to the next fallback model in the chain (prevents long key-retry loops on rate limits).
  MAX_KEY_ATTEMPTS_PER_MODEL: Number(process.env.GEMINI_MAX_KEY_ATTEMPTS_PER_MODEL || 3),
  // Automatic model recovery interval: resets active model index back to primary model (0)
  // daily or after the cooldown period so refreshed daily quotas can be utilized.
  MODEL_RESET_TTL_MS: Number(process.env.GEMINI_MODEL_RESET_TTL_MS || 24 * 60 * 60 * 1000),
  TEMPERATURE: 0,
};

// ==============================================================================
// RFQ DOCUMENT ATTACHMENTS
// ==============================================================================
// Supporting documents a buyer attaches to an RFQ. These are stored and served
// back verbatim and are never sent to Gemini: the manual flow exists precisely
// because the buyer is keying the line items themselves.
//
// Content lives in Cloudflare R2 rather than on the RFQ record. A 15MB PDF is
// ~20MB of base64, and the bootstrap payload returns every RFQ, so inlining
// attachments would make that response grow without bound.
const RFQ_ATTACHMENT_CONFIG = {
  // Object key prefix within the R2 bucket (was the local disk directory
  // before the R2 migration — same env var, reinterpreted).
  STORAGE_DIR: process.env.RFQ_ATTACHMENT_DIR || 'uploads/rfq-attachments',
  MAX_BYTES: Number(process.env.RFQ_ATTACHMENT_MAX_BYTES || 15 * 1024 * 1024),
  MAX_PER_RFQ: Number(process.env.RFQ_ATTACHMENT_MAX_PER_RFQ || 10),
  // Allow-list rather than a block-list: anything not named here is refused, so a
  // new executable or script type cannot be introduced by omission.
  ALLOWED_MIME_TYPES: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain',
    'text/csv',
    'image/png',
    'image/jpeg',
    'image/webp',
    // Email files. The ingestion wizard's own file picker offers `.eml` / `.msg`
    // (its accept list has always included them), so a buyer could stage one,
    // have it read for extraction, and then have the store of that same document
    // refused by this list. Both are inert message containers, served back with
    // their own content type, so nothing here is executable.
    'message/rfc822',
    'application/vnd.ms-outlook',
  ],
  // Identifiers are generated server-side and must match this before ever being
  // joined onto a path, which is what keeps `../` out of the storage directory.
  ID_PATTERN: /^[a-f0-9-]{8,64}$/,
};

// ==============================================================================
// RFQ VENDOR ASSIGNMENT LIMITS PER CATEGORY
// ==============================================================================
// Sets the maximum number of Client and Procucev vendors assigned per category on RFQs.
// Configurable via environment variables (default: 5):
// - MAX_CLIENT_VENDORS_PER_CATEGORY
// - MAX_PROCUCEV_VENDORS_PER_CATEGORY
function getEnvNumber(key, fallback = 5) {
  let val = undefined;
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.__CF_ENV__ &&
    globalThis.__CF_ENV__[key] !== undefined &&
    globalThis.__CF_ENV__[key] !== ''
  ) {
    val = globalThis.__CF_ENV__[key];
  } else if (typeof process !== 'undefined' && process.env && process.env[key] !== undefined && process.env[key] !== '') {
    val = process.env[key];
  }
  if (val !== undefined && val !== null) {
    const num = Number(val);
    if (!Number.isNaN(num) && num > 0) return num;
  }
  return fallback;
}

const MAX_INVITE_VENDORS_PER_REQUEST = 20;

const VENDOR_ASSIGNMENT_LIMITS = {
  get MAX_CLIENT_PER_CATEGORY() {
    return getEnvNumber('MAX_CLIENT_VENDORS_PER_CATEGORY', 5);
  },
  get MAX_PROCUCEV_PER_CATEGORY() {
    return getEnvNumber('MAX_PROCUCEV_VENDORS_PER_CATEGORY', 5);
  },
};

// ==============================================================================
// EMAIL-TO-RFQ INGESTION
// ==============================================================================
// Shapes how an emailed requisition is turned into extractor input. See
// services/emailIngestionService.js — in particular why workbook attachments are
// deliberately not parsed server-side.
const EMAIL_INGESTION_CONFIG = {
  // RFC822 containers this pipeline reads.
  EML_PATTERN: /\.eml$/i,
  // Outlook's Compound File Binary format, which is not RFC822 and is refused
  // with an instruction to re-export rather than failing silently.
  MSG_PATTERN: /\.msg$/i,
  MAX_BYTES: Number(process.env.EMAIL_INGESTION_MAX_BYTES || 15 * 1024 * 1024),
  MAX_ATTACHMENTS: Number(process.env.EMAIL_INGESTION_MAX_ATTACHMENTS || 10),
  // Cap on how much of a decoded text attachment is appended, so one oversized
  // CSV cannot crowd the body out of the extractor's context window.
  MAX_TEXT_ATTACHMENT_CHARS: Number(process.env.EMAIL_INGESTION_MAX_TEXT_CHARS || 40000),
  // Decoded inline and appended to the document text.
  TEXT_ATTACHMENT_MIME_TYPES: ['text/plain', 'text/csv', 'text/tab-separated-values'],
  // Passed to Gemini as base64. Kept as a subset of GEMINI_INLINE_MIME_TYPES so a
  // type can never be forwarded that the extractor would then refuse.
  INLINE_ATTACHMENT_MIME_TYPES: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
  // A line matching any of these starts the quoted thread beneath a forwarded
  // requisition; everything from there down is dropped before extraction.
  QUOTE_MARKERS: [
    /^\s*-{2,}\s*original message\s*-{2,}\s*$/i,
    /^\s*-{2,}\s*forwarded message\s*-{2,}\s*$/i,
    /^\s*_{5,}\s*$/,
    /^\s*on .+ wrote:\s*$/i,
    /^\s*from:\s.+\ssent:\s/i,
    /^\s*>{1,}\s?/,
  ],
};

// ==============================================================================
// ZOHO PAYMENTS
// ==============================================================================
// Ported from the reference p2pservices Java app's ZohoOAuthService/ZohoApiClient/
// PaymentLinkService/ZohoWebhookController. Real secrets (CLIENT_SECRET,
// REFRESH_TOKEN) live only in backend/.env, never hardcoded — same rule as
// DATABASE_URL and EMAIL_GATEWAY_*.
//
// Live and sandbox are separately-authorized Zoho OAuth grants (different scope
// prefix, ZohoPay.* vs ZohoPaySandbox.*, and a different API host), so each needs
// its own full credential set rather than one set with a URL swap. ZOHO_MODE
// picks which block is active; the backend must be restarted to change it.
// Read on every access, not once at load. The Worker copies its secrets into
function getZohoEnv(key, fallback = '') {
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.__CF_ENV__ &&
    globalThis.__CF_ENV__[key] !== undefined &&
    globalThis.__CF_ENV__[key] !== ''
  ) {
    return globalThis.__CF_ENV__[key];
  }
  return process.env[key] !== undefined && process.env[key] !== '' ? process.env[key] : fallback;
}

function zohoModeFromEnv() {
  const explicit = (getZohoEnv('ZOHO_MODE', '')).toLowerCase();
  const hasLiveToken = !!(getZohoEnv('ZOHO_LIVE_REFRESH_TOKEN') || getZohoEnv('ZOHO_REFRESH_TOKEN'));
  const hasSandboxToken = !!getZohoEnv('ZOHO_SANDBOX_REFRESH_TOKEN');

  if (explicit === 'sandbox') return 'sandbox';
  if (explicit === 'live') {
    // If live mode is selected in wrangler.jsonc but only sandbox secrets were added to Cloudflare Secrets,
    // gracefully fall back to sandbox so payment links continue working instead of failing with a 502 error.
    if (!hasLiveToken && hasSandboxToken) {
      return 'sandbox';
    }
    return 'live';
  }
  return !hasLiveToken && hasSandboxToken ? 'sandbox' : 'live';
}

function zohoLiveCredentials() {
  return {
    CLIENT_ID: getZohoEnv('ZOHO_LIVE_CLIENT_ID') || getZohoEnv('ZOHO_CLIENT_ID'),
    CLIENT_SECRET: getZohoEnv('ZOHO_LIVE_CLIENT_SECRET') || getZohoEnv('ZOHO_CLIENT_SECRET'),
    REFRESH_TOKEN: getZohoEnv('ZOHO_LIVE_REFRESH_TOKEN') || getZohoEnv('ZOHO_REFRESH_TOKEN'),
    OAUTH_TOKEN_URL: getZohoEnv('ZOHO_LIVE_OAUTH_TOKEN_URL') || getZohoEnv('ZOHO_OAUTH_TOKEN_URL', 'https://accounts.zoho.in/oauth/v2/token'),
    PAYMENTS_BASE_URL: getZohoEnv('ZOHO_LIVE_PAYMENTS_BASE_URL', 'https://payments.zoho.in/api/v1'),
    ACCOUNT_ID: getZohoEnv('ZOHO_LIVE_PAYMENTS_ACCOUNT_ID') || getZohoEnv('ZOHO_PAYMENTS_ACCOUNT_ID'),
    WEBHOOK_SIGNING_KEY: getZohoEnv('ZOHO_LIVE_WEBHOOK_SIGNING_KEY') || getZohoEnv('ZOHO_WEBHOOK_SIGNING_KEY'),
    RETURN_URL_BASE: getZohoEnv('ZOHO_LIVE_RETURN_URL_BASE') || getZohoEnv('ZOHO_PAYMENTS_RETURN_URL_BASE') || getZohoEnv('PUBLIC_FRONTEND_URL', 'http://localhost:3000'),
  };
}

function zohoSandboxCredentials() {
  return {
    CLIENT_ID: getZohoEnv('ZOHO_SANDBOX_CLIENT_ID') || getZohoEnv('ZOHO_CLIENT_ID'),
    CLIENT_SECRET: getZohoEnv('ZOHO_SANDBOX_CLIENT_SECRET') || getZohoEnv('ZOHO_CLIENT_SECRET'),
    REFRESH_TOKEN: getZohoEnv('ZOHO_SANDBOX_REFRESH_TOKEN') || getZohoEnv('ZOHO_REFRESH_TOKEN'),
    OAUTH_TOKEN_URL: getZohoEnv('ZOHO_SANDBOX_OAUTH_TOKEN_URL', 'https://accounts.zoho.in/oauth/v2/token'),
    PAYMENTS_BASE_URL: getZohoEnv('ZOHO_SANDBOX_PAYMENTS_BASE_URL', 'https://paymentssandbox.zoho.in/api/v1'),
    ACCOUNT_ID: getZohoEnv('ZOHO_SANDBOX_PAYMENTS_ACCOUNT_ID') || getZohoEnv('ZOHO_PAYMENTS_ACCOUNT_ID'),
    WEBHOOK_SIGNING_KEY: getZohoEnv('ZOHO_SANDBOX_WEBHOOK_SIGNING_KEY'),
    RETURN_URL_BASE: getZohoEnv('ZOHO_SANDBOX_RETURN_URL_BASE') || getZohoEnv('ZOHO_PAYMENTS_RETURN_URL_BASE') || getZohoEnv('PUBLIC_FRONTEND_URL', 'http://localhost:3000'),
  };
}

function buildZohoConfig() {
  const mode = zohoModeFromEnv();
  return {
    MODE: mode,
    ...(mode === 'sandbox' ? zohoSandboxCredentials() : zohoLiveCredentials()),
    RECONCILIATION_ENABLED: String(getZohoEnv('ZOHO_RECONCILIATION_ENABLED', '')).toLowerCase() === 'true',
    // 10 minutes, matching the reference app's `0 */10 * * * *` cron.
    RECONCILIATION_INTERVAL_MS: Number(getZohoEnv('ZOHO_RECONCILIATION_INTERVAL_MS', 10 * 60 * 1000)),
    // Refresh the cached access token this many ms before it actually expires, so
    // a request never races a token that's about to go stale mid-flight.
    TOKEN_REFRESH_BUFFER_MS: 60 * 1000,
    GST_RATE: getSubscriptionGstRate(),
  };
}

function getSubscriptionGstPercent() {
  const envVal = process.env.SUBSCRIPTION_GST_PERCENT;
  if (envVal !== undefined && envVal !== '') {
    const parsed = Number(envVal);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 18;
}

function getSubscriptionGstRate() {
  return getSubscriptionGstPercent() / 100;
}

// Same name and shape as before, so every call site is unchanged. Values assigned
// to it (tests do this to set and restore fields) are kept as overrides and win
// over the environment.
const zohoConfigOverrides = {};
const ZOHO_CONFIG = new Proxy({}, {
  get: (_target, key) => (key in zohoConfigOverrides ? zohoConfigOverrides[key] : buildZohoConfig()[key]),
  set: (_target, key, value) => {
    zohoConfigOverrides[key] = value;
    return true;
  },
  deleteProperty: (_target, key) => {
    delete zohoConfigOverrides[key];
    return true;
  },
  has: (_target, key) => key in zohoConfigOverrides || key in buildZohoConfig(),
  ownKeys: () => [...new Set([...Object.keys(buildZohoConfig()), ...Object.keys(zohoConfigOverrides)])],
  getOwnPropertyDescriptor: (_target, key) => {
    if (!(key in zohoConfigOverrides) && !(key in buildZohoConfig())) return undefined;
    const value = key in zohoConfigOverrides ? zohoConfigOverrides[key] : buildZohoConfig()[key];
    return { enumerable: true, configurable: true, value, writable: true };
  },
});

function getSellerSubscriptionPricing() {
  const gstRate = (zohoConfigOverrides.GST_RATE !== undefined)
    ? zohoConfigOverrides.GST_RATE
    : getSubscriptionGstRate();

  const connect12Inclusive = Number(process.env.SELLER_V1_12M_PRICE || 7499);
  const connect6Inclusive = Number(process.env.SELLER_V1_6M_PRICE || 4125);
  const connect12Base = Math.round((connect12Inclusive / (1 + gstRate)) * 100) / 100;
  const connect6Base = Math.round((connect6Inclusive / (1 + gstRate)) * 100) / 100;

  const select12Inclusive = Number(process.env.SELLER_V2_12M_PRICE || 14999);
  const select6Inclusive = Number(process.env.SELLER_V2_6M_PRICE || 8250);
  const select12Base = Math.round((select12Inclusive / (1 + gstRate)) * 100) / 100;
  const select6Base = Math.round((select6Inclusive / (1 + gstRate)) * 100) / 100;

  const v312Inclusive = Number(process.env.SELLER_V3_12M_PRICE || 19999);
  const v36Inclusive = Number(process.env.SELLER_V3_6M_PRICE || 11000);
  const v312Base = Math.round((v312Inclusive / (1 + gstRate)) * 100) / 100;
  const v36Base = Math.round((v36Inclusive / (1 + gstRate)) * 100) / 100;

  return {
    connect: { '12_months': connect12Base, '6_months': connect6Base },
    select: { '12_months': select12Base, '6_months': select6Base },
    version_3: { '12_months': v312Base, '6_months': v36Base },
  };
}

const zohoSubscriptionPricingOverrides = {};
const ZOHO_SUBSCRIPTION_PRICING = new Proxy({}, {
  get: (_target, key) => {
    if (key in zohoSubscriptionPricingOverrides) return zohoSubscriptionPricingOverrides[key];
    const pricing = getSellerSubscriptionPricing();
    if (key in pricing) {
      return pricing[key]['12_months'];
    }
    return undefined;
  },
  set: (_target, key, val) => {
    zohoSubscriptionPricingOverrides[key] = val;
    return true;
  },
  deleteProperty: (_target, key) => {
    delete zohoSubscriptionPricingOverrides[key];
    return true;
  },
  has: (_target, key) => key in zohoSubscriptionPricingOverrides || key in getSellerSubscriptionPricing(),
  ownKeys: () => [...new Set([...Object.keys(getSellerSubscriptionPricing()), ...Object.keys(zohoSubscriptionPricingOverrides)])],
  getOwnPropertyDescriptor: (_target, key) => {
    const val = key in zohoSubscriptionPricingOverrides
      ? zohoSubscriptionPricingOverrides[key]
      : (getSellerSubscriptionPricing()[key] ? getSellerSubscriptionPricing()[key]['12_months'] : undefined);
    if (val === undefined) return undefined;
    return { enumerable: true, configurable: true, value: val, writable: true };
  },
});

/** GST-inclusive amount Zoho actually charges for a plan, 2dp, or null if the plan isn't payable. */
function computeZohoPlanAmount(planId, billingDuration = '12_months') {
  const duration = billingDuration === '6_months' ? '6_months' : '12_months';
  if (planId in zohoSubscriptionPricingOverrides && duration === '12_months') {
    const base = zohoSubscriptionPricingOverrides[planId];
    if (!Number.isFinite(base) || base <= 0) return null;
    return Math.round(base * (1 + ZOHO_CONFIG.GST_RATE) * 100) / 100;
  }
  const pricing = getSellerSubscriptionPricing();
  const planPricing = pricing[planId];
  if (!planPricing) return null;
  const base = typeof planPricing === 'number' ? planPricing : planPricing[duration];
  if (!Number.isFinite(base) || base <= 0) return null;
  return Math.round(base * (1 + ZOHO_CONFIG.GST_RATE) * 100) / 100;
}

function getBuyerSubscriptionPricing() {
  return {
    version_1: {
      '12_months': Number(process.env.BUYER_V1_12M_PRICE || 4999),
      '6_months': Number(process.env.BUYER_V1_6M_PRICE || 5499),
    },
    version_2: {
      '12_months': Number(process.env.BUYER_V2_12M_PRICE || 7499),
      '6_months': Number(process.env.BUYER_V2_6M_PRICE || 7999),
    },
    version_3: {
      '12_months': Number(process.env.BUYER_V3_12M_PRICE || 9999),
      '6_months': Number(process.env.BUYER_V3_6M_PRICE || 10499),
    },
  };
}

const zohoBuyerPricingOverrides = {};
const ZOHO_BUYER_SUBSCRIPTION_PRICING = new Proxy({}, {
  get: (_target, key) => {
    if (key in zohoBuyerPricingOverrides) return zohoBuyerPricingOverrides[key];
    const pricing = getBuyerSubscriptionPricing();
    return pricing[key];
  },
  set: (_target, key, val) => {
    zohoBuyerPricingOverrides[key] = val;
    return true;
  },
  deleteProperty: (_target, key) => {
    delete zohoBuyerPricingOverrides[key];
    return true;
  },
  has: (_target, key) => key in zohoBuyerPricingOverrides || key in getBuyerSubscriptionPricing(),
  ownKeys: () => [...new Set([...Object.keys(getBuyerSubscriptionPricing()), ...Object.keys(zohoBuyerPricingOverrides)])],
  getOwnPropertyDescriptor: (_target, key) => {
    const val = key in zohoBuyerPricingOverrides ? zohoBuyerPricingOverrides[key] : getBuyerSubscriptionPricing()[key];
    if (val === undefined) return undefined;
    return { enumerable: true, configurable: true, value: val, writable: true };
  },
});

/** GST-inclusive amount Zoho actually charges for a buyer plan (monthlyRate * durationMonths * 1.18), or null if the plan isn't payable. */
function computeZohoBuyerPlanAmount(planId, billingDuration = '12_months') {
  const planPricing = ZOHO_BUYER_SUBSCRIPTION_PRICING[planId];
  if (!planPricing) return null;
  const duration = billingDuration === '6_months' ? '6_months' : '12_months';
  const months = duration === '6_months' ? 6 : 12;
  const monthlyRate = typeof planPricing === 'number' ? planPricing : planPricing[duration];
  if (!Number.isFinite(monthlyRate) || monthlyRate <= 0) return null;
  const base = monthlyRate * months;
  return Math.round(base * (1 + ZOHO_CONFIG.GST_RATE) * 100) / 100;
}

function getSubscriptionPricingConfig() {
  const gstPercent = getSubscriptionGstPercent();
  const gstRate = ZOHO_CONFIG.GST_RATE ?? getSubscriptionGstRate();
  const buyerPricing = getBuyerSubscriptionPricing();
  const sellerPricing = getSellerSubscriptionPricing();

  const makeBuyerDuration = (planId, dur, months) => {
    const monthlyRate = buyerPricing[planId][dur];
    const baseTotal = monthlyRate * months;
    const gstAmount = Math.round(baseTotal * gstRate * 100) / 100;
    const totalAmount = computeZohoBuyerPlanAmount(planId, dur);
    return {
      monthlyRate,
      price: monthlyRate,
      months,
      baseTotal,
      baseDurationPrice: baseTotal,
      gstAmount,
      totalAmountWithGst: totalAmount,
      totalWithGst: totalAmount,
    };
  };

  const makeSellerDuration = (planId, dur) => {
    const baseAmount = sellerPricing[planId][dur];
    const gstAmount = Math.round(baseAmount * gstRate * 100) / 100;
    const totalAmount = computeZohoPlanAmount(planId, dur);
    return {
      baseAmount,
      price: totalAmount,
      baseDurationPrice: baseAmount,
      gstAmount,
      totalAmountWithGst: totalAmount,
      totalWithGst: totalAmount,
    };
  };

  const v1_12 = makeBuyerDuration('version_1', '12_months', 12);
  const v1_6 = makeBuyerDuration('version_1', '6_months', 6);
  const v2_12 = makeBuyerDuration('version_2', '12_months', 12);
  const v2_6 = makeBuyerDuration('version_2', '6_months', 6);
  const v3_12 = makeBuyerDuration('version_3', '12_months', 12);
  const v3_6 = makeBuyerDuration('version_3', '6_months', 6);

  const conn_12 = makeSellerDuration('connect', '12_months');
  const conn_6 = makeSellerDuration('connect', '6_months');
  const sel_12 = makeSellerDuration('select', '12_months');
  const sel_6 = makeSellerDuration('select', '6_months');

  return {
    gstPercent,
    gstRate,
    buyer: {
      version_1: {
        id: 'version_1',
        name: 'Silver Plan (Mode 1)',
        '12_months': v1_12,
        '6_months': v1_6,
        pricing: { '12_months': v1_12, '6_months': v1_6 },
      },
      version_2: {
        id: 'version_2',
        name: 'Gold Plan (Mode 2)',
        '12_months': v2_12,
        '6_months': v2_6,
        pricing: { '12_months': v2_12, '6_months': v2_6 },
      },
      version_3: {
        id: 'version_3',
        name: 'Diamond Plan (Mode 3)',
        '12_months': v3_12,
        '6_months': v3_6,
        pricing: { '12_months': v3_12, '6_months': v3_6 },
      },
    },
    seller: {
      premium: {
        id: 'premium',
        name: 'Premium Model',
        free: true,
        price: 'Free',
      },
      connect: {
        id: 'connect',
        name: 'Connect Model',
        '12_months': conn_12,
        '6_months': conn_6,
        pricing: { '12_months': conn_12, '6_months': conn_6 },
      },
      select: {
        id: 'select',
        name: 'Select Model',
        '12_months': sel_12,
        '6_months': sel_6,
        pricing: { '12_months': sel_12, '6_months': sel_6 },
      },
    },
  };
}

// ==============================================================================
// AUTONOMOUS EMAIL INGESTION GATEWAY
// ==============================================================================
// The mailbox poller. See services/emailGatewayService.js for why an ingested RFQ
// is held for review rather than circulated.
const EMAIL_GATEWAY_CONFIG = {
  DEFAULT_POLL_MS: 60000,
  // Floor on the interval regardless of configuration. Each poll opens an IMAP
  // connection and may call Gemini per message, so a misconfigured 1s interval
  // would burn provider quota and risk the mail host throttling the account.
  MIN_POLL_MS: 30000,
  // Cap per pass so a backlog cannot spend unbounded time and quota in one run.
  DEFAULT_MAX_PER_POLL: 10,
  // Inbound requisitions circulate to category-matched vendors upon creation, transitioning to Quotes Pending.
  INGESTED_STATUS: 'Quotes Pending',
  // Default sourcing mode for email-ingested RFQs: Version 2 (Hybrid Sourcing).
  INGESTED_SOURCING_MODE: 'mode_2',
  // Emails have no file name; this stands in wherever one is recorded.
  SYNTHETIC_FILE_NAME: 'inbound-email.eml',
  DEFAULT_GATEWAY_ADDRESS: 'rfq@procucev.com',
  DEFAULT_FALLBACK_RFQ_TITLE: 'Request for Quotation',
  MAX_LINE_ITEMS_PER_RFQ: 49,
  LABEL_PROCESSED: 'Processed',
  LABEL_ERROR: 'Error',
};

const GMAIL_GATEWAY_LABELS = Object.freeze({
  PROCESSED: 'Processed',
  ERROR: 'Error',
  INBOX: 'INBOX',
  UNREAD: 'UNREAD',
});

const VENDOR_EMAIL_GATEWAY_CONFIG = {
  DEFAULT_POLL_MS: 60000,
  MIN_POLL_MS: 30000,
  DEFAULT_MAX_PER_POLL: 10,
  DEFAULT_GATEWAY_ADDRESS: 'srinu20252026@gmail.com',
  DEFAULT_FROM_NAME: 'Procucev Enterprise',
};

// ==============================================================================
// RFQ MULTI-CHANNEL CHASER TIMING (Version 1 / mode_1 flow)
// ==============================================================================
// RFQ MULTI-CHANNEL CHASER TIMING
// ==============================================================================
// Controls when each channel fires after an RFQ is created or a vendor is
// invited. Stored here so tests and the scheduler share a single source of truth
// and the delays can be tuned without touching service logic.
//
//  Channel      Delay    Rationale
//  ---------    -----    -----------------------------------------
//  SMS          5 min    Within 5 minutes of RFQ creation
//  Call         6 h      After 6 hours — voice reminder (logic preserved, telephony deferred)
//  WhatsApp     12 h     After another 6 hours (12h total) — WhatsApp interactive reminder
//  Email        24 h     After 24 hours — formal email reminder with full RFQ details
//
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

function resolveChaserDelay(envVal, defaultMs) {
  if (envVal !== undefined && envVal !== null && envVal !== '') {
    const val = Number(envVal);
    if (!isNaN(val) && val >= 0) {
      return val;
    }
  }
  return defaultMs;
}

const CHASER_DELAYS = {
  SMS_MS:       resolveChaserDelay(process.env.CHASER_SMS_DELAY_MS, FIVE_MINUTES_MS),
  CALL_MS:      resolveChaserDelay(process.env.CHASER_CALL_DELAY_MS, SIX_HOURS_MS),
  WHATSAPP_MS:  resolveChaserDelay(process.env.CHASER_WHATSAPP_DELAY_MS, TWELVE_HOURS_MS),
  EMAIL_MS:     resolveChaserDelay(process.env.CHASER_EMAIL_DELAY_MS, TWENTY_FOUR_HOURS_MS),
};

const PRESENCE_ONLINE_THRESHOLD_MS = 10 * 60 * 1000;

// ==============================================================================
// SMS DLT TEMPLATE REGISTRY
// ==============================================================================
// Registered templates on sendmsg.in / TRAI DLT portal.
//
// Template Name      : RFQ_Notification_Seller_Service
// Reference Number   : 11-2WNNMUNY6YY1
// SMSGID             : 1777179076323440961
// Approved Text      : RFQ Alert {#alp#}: You are invited to bid for {#alp#}. Submit quote : {#urg#} - Team Procucev.
// Variables          : {#alp#}, {#alp#}, {#urg#} → rfqNumber, rfqTitle, bidUrl
//
// Buyer Quote Matrix Template:
// Reference Number   : 11-44JHMUY9DRFC
// Template Id / SMSGID: 1777179138668879258
// Header             : PROCUC
// Approved Text      : RFQ Update: 48-hour bidding window for {#alp#} is completed. Quotation matrix is ready with {#num#} quotes. Review now: {#urg#} - Team Procucev.
// Variables          : {#alp#}, {#num#}, {#urg#} → rfqLabel, quotesCount, matrixLink
//
// OTP Template       : DLT ID 1102294821 (TRANSACTIONAL)
const SMS_DLT_TEMPLATES = {
  RFQ_CHASER: {
    NAME:     'RFQ_Notification_Seller_Service',
    REFERENCE_NUMBER: '11-2WNNMUNY6YY1',
    SMSGID:   process.env.SMS_GATEWAY_RFQ_SMSGID || '1777179076323440961',
    CATEGORY: 'SERVICE_IMPLICIT',
    // Exact approved template text — static parts must match character-for-character.
    TEMPLATE: 'RFQ Alert {#alp#}: You are invited to bid for {#alp#}. Submit quote : {#urg#} - Team Procucev.',
    VARIABLES: ['rfqNumber', 'rfqTitle', 'bidUrl'],
    VARIABLE_TYPES: ['alp', 'alp', 'urg'],
    // Keep the registered quotation URL; an unregistered URL shortener can fail DLT validation.
    URL_SHORTENING: false,
  },
  OTP: {
    NAME:     'OTP_Procucev_GMT',
    SMSGID:   process.env.SMS_GATEWAY_SMSGID || '1102294821',
    CATEGORY: 'TRANSACTIONAL',
    TEMPLATE: 'OTP for registering your access to Get My quoTe (GMT): {#var#}. Valid for 5 mins. Do not share. - Team Procucev.',
    VARIABLES: ['otp'],
  },
  BUYER_BIDS_UNLOCKED: {
    NAME:     'Buyer_Quote_Matrix_Ready',
    REFERENCE_NUMBER: '11-44JHMUY9DRFC',
    SMSGID:   process.env.SMS_GATEWAY_BUYER_UNLOCKED_SMSGID || '1777179138668879258',
    CATEGORY: 'SERVICE_IMPLICIT',
    HEADER:   'PROCUC',
    TEMPLATE: 'RFQ Update: 48-hour bidding window for {#alp#} is completed. Quotation matrix is ready with {#num#} quotes. Review now: {#urg#} - Team Procucev.',
    VARIABLES: ['rfqLabel', 'quotesCount', 'matrixLink'],
    VARIABLE_TYPES: ['alp', 'num', 'urg'],
    URL_SHORTENING: false,
  },
};

/**
 * Mapping between buyer subscription plans and their corresponding RFQ sourcing / version mode.
 * - version_1: mode_1 (Version 1: Client Roster Sourcing Plan)
 * - version_2: mode_2 (Version 2: Hybrid Sourcing Plan)
 * - version_3: mode_3 (Version 3: AI Autonomous Sourcing Plan)
 */
const BUYER_SUBSCRIPTION_TO_SOURCING_MODE = {
  version_0: 'mode_0',
  mode_0: 'mode_0',
  v0: 'mode_0',
  version_1: 'mode_1',
  version_2: 'mode_2',
  version_3: 'mode_3',
  v1: 'mode_1',
  v2: 'mode_2',
  v3: 'mode_3',
  mode_1: 'mode_1',
  mode_2: 'mode_2',
  mode_3: 'mode_3',
};

/**
 * Helper to unwrap raw JSON payload from D1/Postgres database rows if present.
 */
function unwrapAccountData(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.raw) {
    if (typeof obj.raw === 'string') {
      try {
        const parsed = JSON.parse(obj.raw);
        return { ...parsed, ...obj };
      } catch (_) {}
    } else if (typeof obj.raw === 'object') {
      return { ...obj.raw, ...obj };
    }
  }
  return obj;
}

/**
 * Check if a buyer account has database-configured unlimited RFQ creation access.
 * Reads database-level flags without hardcoding any identity credentials.
 */
function hasUnlimitedRfqAccess(account) {
  const data = unwrapAccountData(account);
  if (!data || typeof data !== 'object') return false;
  return Boolean(
    data.unlimitedRfqAccess === true ||
    data.unlimitedAccess === true ||
    data.isUnlimited === true ||
    String(data.subscriptionPlan || '').trim().toLowerCase() === 'unlimited'
  );
}

/**
 * Check if a vendor account has database-configured unlimited quote submission access.
 * Reads database-level flags without hardcoding any identity credentials.
 */
function hasUnlimitedQuoteAccess(vendor) {
  const data = unwrapAccountData(vendor);
  if (!data || typeof data !== 'object') return false;
  return Boolean(
    data.unlimitedQuoteSubmissions === true ||
    data.unlimitedQuotes === true ||
    data.unlimitedAccess === true ||
    data.isUnlimited === true
  );
}

/**
 * Check if a vendor account has database-configured unlimited RFQ download access.
 * Reads database-level flags without hardcoding any identity credentials.
 */
function hasUnlimitedDownloadAccess(vendor) {
  const data = unwrapAccountData(vendor);
  if (!data || typeof data !== 'object') return false;
  return Boolean(
    data.unlimitedRfqDownloads === true ||
    data.unlimitedDownloads === true ||
    data.unlimitedAccess === true ||
    data.isUnlimited === true
  );
}

/**
 * Entitled sourcing modes per subscription plan tier.
 */
const SUBSCRIPTION_MODE_ENTITLEMENTS = {
  free_trial: ['mode_0', 'mode_1', 'mode_2', 'mode_3'],
  version_0: ['mode_0'],
  v0: ['mode_0'],
  version_1: ['mode_0', 'mode_1'],
  version_2: ['mode_0', 'mode_1', 'mode_2'],
  version_3: ['mode_0', 'mode_1', 'mode_2', 'mode_3'],
  unlimited: ['mode_0', 'mode_1', 'mode_2', 'mode_3'],
};

/**
 * Resolves the RFQ version / sourcing mode based upon the subscription of the buyer.
 * Defaults to INGESTED_SOURCING_MODE ('mode_2') for free starter trial / unselected plan.
 *
 * @param {Object|string|null|undefined} buyerAccountOrPlan - Buyer account object or subscription plan string
 * @param {string} [preferredMode] - Optional requested mode
 * @returns {string} Sourcing mode ('mode_0' | 'mode_1' | 'mode_2' | 'mode_3')
 */
function resolveBuyerSourcingMode(buyerAccountOrPlan, preferredMode = null) {
  let plan = null;
  let subscriptions = [];
  let isExpired = false;
  let isInactive = false;
  let remainingFreeRFQs = undefined;

  if (typeof buyerAccountOrPlan === 'object' && buyerAccountOrPlan !== null) {
    // Database-level unlimited access bypasses subscription restrictions
    if (hasUnlimitedRfqAccess(buyerAccountOrPlan)) {
      const requestedMode = (preferredMode || buyerAccountOrPlan.sourcingMode || buyerAccountOrPlan.sourcing_mode || '').trim().toLowerCase();
      if (['mode_0', 'v0', 'version_0'].includes(requestedMode)) return 'mode_0';
      if (['mode_1', 'v1', 'version_1'].includes(requestedMode)) return 'mode_1';
      if (['mode_2', 'v2', 'version_2'].includes(requestedMode)) return 'mode_2';
      if (['mode_3', 'v3', 'version_3'].includes(requestedMode)) return 'mode_3';
      return 'mode_3';
    }

    plan = buyerAccountOrPlan.subscriptionPlan || buyerAccountOrPlan.activeSubscription || null;
    remainingFreeRFQs = buyerAccountOrPlan.remainingFreeRFQs;
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
        return 'mode_3';
      }
      if (activePlans.some((p) => p === 'version_2' || p === 'v2' || p === 'mode_2')) {
        return 'mode_2';
      }
      if (activePlans.some((p) => p === 'version_1' || p === 'v1' || p === 'mode_1')) {
        return 'mode_1';
      }
      if (activePlans.some((p) => p === 'version_0' || p === 'v0' || p === 'mode_0')) {
        return 'mode_0';
      }
    }
  }

  // Expired or inactive subscriptions are not considered; default to mode_0
  if (isExpired || isInactive) {
    return 'mode_0';
  }

  // Check single active subscription
  if (typeof plan === 'string') {
    const normalized = plan.trim().toLowerCase();
    if (normalized === 'unlimited') {
      return 'mode_3';
    }
    if (['version_1', 'v1', 'mode_1'].includes(normalized)) {
      return 'mode_1';
    }
    if (['version_2', 'v2', 'mode_2'].includes(normalized)) {
      return 'mode_2';
    }
    if (['version_3', 'v3', 'mode_3'].includes(normalized)) {
      return 'mode_3';
    }
    if (['version_0', 'v0', 'mode_0'].includes(normalized)) {
      return 'mode_0';
    }
  }

  // No active V1/V2/V3 subscription -> default automatically to mode_0 (V0)
  return 'mode_0';
}

/** Connection state reported to the gateway panel. */
const EMAIL_GATEWAY_STATE = {
  ACTIVE_LISTENING: 'ACTIVE_LISTENING',
  CONNECTION_ERROR: 'CONNECTION_ERROR',
  SWITCHED_OFF: 'SWITCHED_OFF',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
};

/**
 * Ports that belong to sending mail, not reading it.
 *
 * Pointing the gateway at 587 (SMTP submission) with implicit TLS on is what
 * produced `SSL routines::wrong version number`: 587 opens in plaintext and
 * upgrades via STARTTLS, so a TLS ClientHello gets a plaintext SMTP greeting
 * back. Detected explicitly rather than left to fail at the socket.
 */
const EMAIL_GATEWAY_SMTP_PORTS = [25, 465, 587, 2525];

/** Buyer-facing detail recorded against each considered message. */
const EMAIL_GATEWAY_MESSAGES = {
  // Configuration faults, named precisely because the underlying socket error is
  // unreadable to anyone who has not seen it before.
  SMTP_HOST_CONFIGURED:
    'EMAIL_GATEWAY_HOST is set to {host}, which is a mail sending server. The gateway reads a mailbox, so it needs an IMAP host — use imap.gmail.com for Gmail or outlook.office365.com for Microsoft 365.',
  SMTP_PORT_CONFIGURED:
    'EMAIL_GATEWAY_PORT is {port}, which is a mail sending port. IMAP uses 993 with EMAIL_GATEWAY_SECURE=true, or 143 with EMAIL_GATEWAY_SECURE=false.',
  TLS_VERSION_MISMATCH:
    'The mail server answered without TLS, so the connection was refused. This is almost always the wrong host or port: IMAP is 993 with EMAIL_GATEWAY_SECURE=true, or 143 with EMAIL_GATEWAY_SECURE=false. Check EMAIL_GATEWAY_HOST is an IMAP host and not an SMTP one.',
  AUTH_REJECTED:
    'The mail server rejected the credentials. For Gmail, IMAP must be enabled in Settings > Forwarding and POP/IMAP, and EMAIL_GATEWAY_PASSWORD must be an App Password rather than the account password.',
  HOST_UNRESOLVED:
    'EMAIL_GATEWAY_HOST could not be resolved. Check the hostname for a typo and that this machine has DNS and outbound network access.',
  HOST_UNREACHABLE:
    'The mail server did not accept a connection on that port. Check EMAIL_GATEWAY_PORT and that outbound IMAP is not blocked by a firewall.',
  CERTIFICATE_REJECTED:
    'The mail server presented a certificate that could not be verified. Confirm EMAIL_GATEWAY_HOST matches the certificate, and do not disable TLS to work around it.',
  CONNECTION_FAILED_FALLBACK:
    'The mailbox could not be reached. Check EMAIL_GATEWAY_HOST, EMAIL_GATEWAY_PORT and the credentials, then try again.',
  NOT_CONFIGURED:
    'The email gateway is not configured. Set EMAIL_GATEWAY_HOST, EMAIL_GATEWAY_USER and EMAIL_GATEWAY_PASSWORD in backend/.env to connect a mailbox.',
  DISABLED: 'The email gateway is switched off. Set EMAIL_GATEWAY_ENABLED=true to start watching the mailbox.',
  ALREADY_STARTED: 'The email gateway is already watching the mailbox.',
  POLL_ALREADY_RUNNING: 'A mailbox check is already in progress.',
  ALREADY_PROCESSED: 'ALREADY_PROCESSED',
  SENDER_MISSING: 'The message carried no sender address, so it could not be attributed to a buyer account.',
  SENDER_NOT_LISTED:
    'The sender {address} is not on EMAIL_GATEWAY_ALLOWED_SENDERS, so the requisition was not raised.',
  DOMAIN_NOT_LISTED:
    'The domain {domain} is not on EMAIL_GATEWAY_ALLOWED_DOMAINS, so the requisition was not raised.',
  // The baseline rule: without an owning account an RFQ has no buyerAccountId and
  // would not appear on any dashboard, so this is a functional bar as well as a
  // security one.
  SENDER_NO_ACCOUNT:
    'No buyer account is registered against {address}. Add it as a buyer account before requisitions from that address can be raised.',
  PREPARE_REFUSED: 'The message could not be read for extraction ({status}).',
  EXTRACTION_FAILED: 'AI extraction produced no line items ({status}).',
  NO_ITEMS_ACCEPTED: 'No usable procurement line items were found in the message.',
  LINE_ITEMS_EXCEED_LIMIT: 'Maximum {max} line items per RFQ exceeded (received {count}).',
  INGESTED_DETAIL: 'Raised with {count} line item(s), {needsReview} needing category review.',
  QUOTE_INGESTED_DETAIL: 'Vendor quotation for RFQ {rfqNumber} successfully ingested from email ({vendorName}).',
  QUOTE_VALIDATION_FAILED_DETAIL: 'Vendor quotation for RFQ {rfqNumber} from {vendorName} failed validation: {reason}.',
  QUOTE_ACK_SUBJECT: 'Quotation Received – RFQ {rfqNumber}',
  QUOTE_FAILURE_SUBJECT: 'Action Required – Quotation Could Not Be Processed for RFQ {rfqNumber}',
  INVALID_RFQ_REFERENCED: 'The referenced RFQ {rfqNumber} was not found in the system.',
  VENDOR_NOT_FOUND_FOR_QUOTE: 'No vendor profile found for sender {address}.',
  VENDOR_GATEWAY_REQUIRES_RFQ: 'Vendor email gateway only processes quotation replies for existing RFQs.',
  CREDITS_EXHAUSTED_DETAIL: 'Quotation email from {vendorName} for RFQ {rfqNumber} acknowledged: 5 free quotation credits exhausted. Subscription upgrade email sent.',
  CREDITS_EXHAUSTED_SUBJECT: 'Action Required – Upgrade Plan to Submit Quotation for RFQ {rfqNumber}',
  // Gemini being rate-limited, erroring or unconfigured says nothing about the
  // email itself, so it is retried rather than recorded as "no line items".
  EXTRACTION_RETRYABLE: 'AI extraction is temporarily unavailable ({status}); the message will be retried.',
  EXTRACTION_GAVE_UP: 'AI extraction was still unavailable ({status}) after the final retry, so no RFQ was raised.',
  RFQ_CREDITS_EXHAUSTED_DETAIL:
    'Free trial RFQ credits exhausted ({remaining} left, {needed} needed), so no RFQ was raised. Buyer notified.',
};

/**
 * Notice sent to a registered buyer whose RFQ email did not become an RFQ.
 * Without it the buyer only ever hears back on success, so a failure looked
 * the same as "still processing".
 */
const RFQ_NOT_CREATED_NOTIFICATION = {
  SUBJECT: 'Action Required – Your RFQ Email Could Not Be Processed',
  HEADLINE: 'PROCUCEV ENTERPRISE',
  SUBLINE: 'RFQ Not Created',
  REASONS: {
    NO_LINE_ITEMS:
      'We could not find any procurement line items in your email. Please list each item with its description, quantity and unit, in the email body or an attached document.',
    TOO_MANY_LINE_ITEMS:
      'Your email contained {count} line items, but an emailed RFQ can carry at most {max}. Please split the requirement across several emails, or raise it on the Buyer Portal.',
    CREDITS_EXHAUSTED:
      'Your free trial RFQ credits have been fully used. Upgrade to a paid plan to keep raising RFQs by email, or raise a V0 Free Starter RFQ on the Buyer Portal.',
    PROCESSING_FAILED:
      'We could not read your requirement because of a temporary problem on our side. Please resend the email in a little while, or raise the RFQ on the Buyer Portal.',
  },
};

/** Default free RFQ quotation credits granted to each vendor */
const VENDOR_FREE_CREDITS_LIMIT = 5;

/** Notification email content for vendor credit exhaustion */
const VENDOR_CREDITS_EXHAUSTED_NOTIFICATION = {
  SUBJECT: 'Action Required – 5 Free Quotation Credits Exhausted for RFQ #{rfqNumber}',
  HEADLINE: 'PROCUCEV ENTERPRISE',
  SUBLINE: 'Free Quotation Credits Exhausted',
  EXHAUSTION_MESSAGE: 'Your 5 free RFQ quotation credits have been fully utilized.',
  UPGRADE_BUTTON_LABEL: 'Click Here to Go to Portal and Upgrade Plan',
  REASSURANCE: 'Your quotation has not been submitted yet. To continue submitting quotations and have your bids evaluated by buyers, please upgrade your subscription plan on the vendor portal.',
};

/** Notification email content for unauthorized email senders. */
const UNAUTHORIZED_BUYER_NOTIFICATION = {
  SUBJECT: 'Enterprise QUA - Buyer Registration Required',
  HEADLINE: 'PROCUCEV ENTERPRISE',
  SUBLINE: 'Buyer Registration Required',
  DEFAULT_GATEWAY_EMAIL: 'RFQ@procucev.com',
};

/** RFQ creation acknowledgement notification sent to the buyer (Qua AI Email 2 Standard). */
const RFQ_ACKNOWLEDGEMENT_NOTIFICATION = {
  SUBJECT: 'Congratulations, RFQ {rfq_id} is live. Qua AI is on it',
  LEGACY_SUBJECT: 'Great news! Your requirement has been converted into RFQ #{rfqNumber}',
  HEADLINE: 'QUA AI AUTONOMOUS PROCUREMENT',
  SUBLINE: 'RFQ Creation Acknowledgement',
  SUPPORT_PHONE: '+91 8247722944',
  SUPPORT_EMAIL: 'info@procucev.com',
  DEFAULT_GATEWAY_EMAIL: 'RFQ@procucev.com',
  TEAM_SIGNATURE: 'Team Qua AI\nProcucev Enterprise Solutions',
  QUOTES_TIMELINE: 'Suppliers start quoting within about 24 hours. Qua AI follows up with them and sends you the quotations side by side.',
  NEED_IT_FASTER: 'For any further questions or clarifications, please reach out to +91 8247722944/email to info@procucev.com',
  CLOSING: 'Next time, just email your requirement to RFQ@procucev.com again.',
};

/**
 * Qua AI 13 Transactional Email Templates Configuration
 */
const QUA_AI_EMAIL_TEMPLATES = {
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
};

const QUA_AI_EMAIL_SUPPORT = {
  PHONE: '+91 8247722944',
  EMAIL: 'info@procucev.com',
  TEAM_SIGNATURE: 'Team Qua AI',
  COMPANY_NAME: 'Procucev Enterprise Solutions',
};

const VENDOR_QUOTE_SUPPORT_CC = process.env.VENDOR_QUOTE_SUPPORT_CC || '';


/** Outcome of preparing an email for extraction. */
const EMAIL_INGESTION_STATUS = {
  READY: 'READY',
  NOT_AN_EMAIL: 'NOT_AN_EMAIL',
  OUTLOOK_MSG_UNSUPPORTED: 'OUTLOOK_MSG_UNSUPPORTED',
  NO_CONTENT: 'NO_CONTENT',
  TOO_LARGE: 'TOO_LARGE',
  UNREADABLE: 'UNREADABLE',
};

/**
 * Buyer-facing explanation for each email ingestion refusal.
 *
 * Every one names the specific recovery step, per the descriptive-error standard:
 * re-export the message, send the workbook through the BOQ tab, or key the items.
 */
const EMAIL_INGESTION_MESSAGES = {
  NOT_AN_EMAIL:
    'That file is not an email message. Upload a .eml file exported from your mail client, or use the BOQ Spreadsheet / Drawing tab for documents.',
  OUTLOOK_MSG_UNSUPPORTED:
    'Outlook .msg files cannot be read. In Outlook, open the message and use File > Save As to save it as a .eml file, then upload that instead.',
  NO_CONTENT:
    'This email has no readable body and no PDF, image or CSV attachment to extract from. If the requisition is in a spreadsheet, upload it through the BOQ Spreadsheet / Drawing tab.',
  TOO_LARGE: `That email is larger than the ${Math.floor(
    Number(process.env.EMAIL_INGESTION_MAX_BYTES || 15 * 1024 * 1024) / (1024 * 1024)
  )}MB limit. Forward just the requisition without the earlier thread, or upload the attachment on its own.`,
  UNREADABLE:
    'This email could not be parsed. Re-export it from your mail client as a .eml file, or add the line items manually.',
  // Appended when the message did yield line items but also carried an
  // attachment this pipeline cannot read.
  SPREADSHEET_ATTACHMENT_SKIPPED:
    'The attachment {fileNames} was not read. Spreadsheet attachments are not extracted from email — upload it through the BOQ Spreadsheet / Drawing tab to include its line items.',
};

// Buyer-facing explanation for each extraction outcome. Every one of these ends
// by pointing at manual line-item entry, because that is the recovery path.
const EXTRACTION_REASON_MESSAGES = {
  NOT_CONFIGURED:
    'AI extraction is not configured on this environment (GEMINI_API_KEY is unset). Add the line items manually to continue.',
  NO_CONTENT:
    'No readable content was found in this file. Add the line items manually to continue.',
  DOCUMENT_TOO_LARGE:
    'This document is too large for AI extraction. Upload a smaller file or add the line items manually.',
  UNSUPPORTED_TYPE:
    'This file type cannot be read by AI extraction. Upload a spreadsheet, PDF or image, or add the line items manually.',
  AI_FAILED:
    'AI extraction could not read this document. Add the line items manually to continue.',
  QUOTA_EXCEEDED:
    'AI extraction is temporarily unavailable because the Gemini API quota or rate limit was reached. Check the Google AI project quota or retry later; you can also add the line items manually to continue.',
  NO_ITEMS_FOUND:
    'No procurement line items could be identified in this document. Add the line items manually to continue.',
  // Shared with emailIngestionService's EMAIL_INGESTION_STATUS — a buyer
  // uploading a raw .eml goes through the same status set as the IMAP gateway.
  NOT_AN_EMAIL:
    'That file could not be read as an email. Upload the original .eml file, or add the line items manually.',
  OUTLOOK_MSG_UNSUPPORTED:
    'Outlook .msg files are not supported yet — save the email as .eml and upload that instead, or add the line items manually.',
  UNREADABLE:
    'This email could not be read. Add the line items manually to continue.',
  TOO_LARGE:
    'This email is too large for AI extraction. Add the line items manually to continue.',
};

// MIME types Gemini can read natively as inline data. Spreadsheets are flattened
// to text by the browser first, because Gemini cannot parse xlsx binaries.
const GEMINI_INLINE_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
  'text/plain',
  'text/csv',
];

// Normalisation defaults applied to every ingested RFQ line item. These mirror
// AutomaticRfqServiceImpl.raiseRfq and RFQBuilderService in the Java app, which
// are the values buyers' existing RFQs were created with.
const RFQ_INGESTION_CONFIG = {
  DEFAULT_UNIT: 'Nos',
  DEFAULT_QUANTITY: 1,
  DELIVERY_DATE_OFFSET_DAYS: 5,
  MAX_TITLE_LENGTH: 100,
  MAX_LINE_ITEMS_PER_RFQ: 49,
  TITLE_SUFFIX_SINGLE: ' Procurement',
  TITLE_SUFFIX_MULTIPLE: ' & Allied Items Procurement',
};

// Email OTP shape shared with the Java p2pservices app. That service stores
// codes in `otp_store` under the key `<normalisedPhone>_EMAIL_<email>` with a
// 6-character column and a 15-minute expiry, so these values are not free
// parameters: changing them desynchronises the two applications.
const IDENTITY_OTP_CONFIG = {
  OTP_LENGTH: 6,
  OTP_EXPIRY_MS: 15 * 60 * 1000,
  OTP_KEY_SEPARATOR: '_EMAIL_',
};

// ==============================================================================
// BUYER ORGANISATION PROFILE
// ==============================================================================
// Behaviour ported from ProcUserServiceImpl.updateBuyer and
// GMTServiceImpl.getOrgByUserId in the Java p2pservices app, which own the
// `organization` and `org_division_category` rows this feature reads and writes.
const BUYER_PROFILE_CONFIG = {
  // Cardinality caps the old Angular screen enforced for a ClientInitiator: at
  // most 5 divisions, at most 10 minor categories in total. They exist because
  // the RFQ distribution engine fans out per selected category, so an unbounded
  // selection would broadcast every RFQ to the entire vendor base.
  MAX_MAJOR_CATEGORIES: 5,
  MAX_MINOR_CATEGORIES: 10,

  // The rupee sign is rewritten before storage, exactly as updateBuyer does.
  // `organization.annual_turnover` is latin1 in the shared schema, so a literal ₹
  // is written back as mojibake; the Java service sidesteps that by substituting
  // an ASCII currency code, and both applications must agree on the stored form.
  CURRENCY_SYMBOL: '₹',
  CURRENCY_REPLACEMENT: 'INR ',

  // Default constitution applied when the stored row has none, matching the
  // buyer form's initial `orgType` value.
  DEFAULT_ORGANIZATION_TYPE: 'Public Limited',
  DEFAULT_COUNTRY: 'India',
};

const BUYER_PROFILE_MESSAGES = {
  NOT_A_BUYER: 'Only a buyer account can view or manage a buyer organization profile.',
  SESSION_MISSING_USER:
    'Your session does not identify a user account, so the organization profile could not be resolved. Please sign in again.',
  USER_NOT_FOUND:
    'Your user account could not be found in the Procucev identity database. Please sign in again or contact support.',
  ORGANIZATION_NOT_LINKED:
    'Your user account is not linked to an organization yet, so there is no buyer profile to manage. Contact your Procucev administrator to have your account attached to an organization.',
  ORGANIZATION_NOT_FOUND: 'The organization linked to your account no longer exists in the identity database.',
  PROFILE_LOAD_FAILED:
    'The buyer organization profile could not be read from the identity database. The record was not changed. Please retry in a moment.',
  PROFILE_SAVE_FAILED:
    'The buyer organization profile could not be saved to the identity database. No changes were applied. Please retry in a moment.',
  TAXONOMY_LOAD_FAILED:
    'The procurement category taxonomy could not be read from the identity database. Please retry in a moment.',
  PROFILE_SAVED: 'Buyer organization profile updated successfully.',
  CATEGORIES_INVALID:
    'Each procurement category must supply both a major category and a minor category.',
  TOO_MANY_MAJOR_CATEGORIES:
    'You can select at most {max} major procurement categories. Clear one before adding another.',
  TOO_MANY_MINOR_CATEGORIES:
    'You can select at most {max} minor procurement categories in total. Clear one before adding another.',
};

/**
 * Substitute {placeholder} tokens in a message template.
 *
 * Keeps parameterised copy in this module rather than assembling strings at the
 * call site, so every user-facing message stays translatable in one place.
 * An unknown placeholder is left verbatim, which makes the omission visible in
 * the message instead of rendering "undefined".
 */
function formatMessage(template, values) {
  if (!template) return '';
  if (!values) return template;
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    values[key] === undefined || values[key] === null ? match : String(values[key])
  );
}

const {
  EMAIL_REGEX,
  GSTIN_REGEX,
  GSTIN_MESSAGE,
  PHONE_REGEX,
  INDIAN_MOBILE_REGEX,
  INDIAN_MOBILE_MESSAGE,
  OTP_CODE_REGEX,
  OTP_CODE_MESSAGE,
  PINCODE_REGEX,
  PINCODE_MESSAGE,
  PAN_REGEX,
  PAN_MESSAGE,
  CIN_REGEX,
  CIN_MESSAGE,
  WEBSITE_REGEX,
  WEBSITE_MESSAGE,
  INDIAN_PINCODE_REGEX,
  INDIAN_PINCODE_MESSAGE,
  ORGANIZATION_TYPES,
  PASSWORD_MIN_LENGTH,
  ISO_DATE_REGEX,
  ISO_DATE_MESSAGE,
  TIME_HORIZON_TYPES,
  CATEGORY_REVIEW_ACTIONS,
  DISPATCH_TEMPLATES,
  VALIDATION_SCHEMAS,
  validatePayload,
} = require('./validationSchemas');

// ==============================================================================
// VENDOR MASTER & PO DATA INGESTION (buyer module)
// ==============================================================================
// A buyer uploads their Vendor Master, then their historical PO purchase dump,
// and the PO purchasing history — not the company name — is what a supplier is
// categorised from. These are the string enums, caps and user-facing messages
// that flow drives. Nothing below is declared inline at a use site.

/** Lifecycle of one ingestion run. Ordered: each value implies the previous. */
const VENDOR_INGESTION_SESSION_STATUS = {
  DRAFT: 'DRAFT',
  VENDOR_MASTER_STORED: 'VENDOR_MASTER_STORED',
  PO_STORED: 'PO_STORED',
  JOINED: 'JOINED',
  AI_COMPLETED: 'AI_COMPLETED',
  DISPATCHED: 'DISPATCHED',
};

/** Step number each status unlocks, so a forward jump can be refused. */
const VENDOR_INGESTION_STEP = {
  TIME_HORIZON: 1,
  VENDOR_MASTER: 2,
  PO_DUMP: 3,
  AI_CATEGORY_JOIN: 4,
  DISPATCH: 5,
};

/** Time horizon options. CUSTOM is the only one that reads the client's dates. */
const VENDOR_INGESTION_HORIZON = {
  LAST_1_YEAR: 'LAST_1_YEAR',
  LAST_2_YEARS: 'LAST_2_YEARS',
  LAST_3_YEARS: 'LAST_3_YEARS',
  CUSTOM: 'CUSTOM',
};

/** Months back from today for each predefined horizon. */
const VENDOR_INGESTION_HORIZON_MONTHS = {
  LAST_1_YEAR: 12,
  LAST_2_YEARS: 24,
  LAST_3_YEARS: 36,
};

/**
 * Category mapping status.
 *
 * SELF_MAP_REQUIRED is load-bearing: a supplier in the vendor master with no PO
 * history inside the selected horizon has no purchasing evidence, so it is never
 * sent to the categoriser and never carries an AI category. It is asked to map
 * itself instead.
 */
const VENDOR_MAPPING_STATUS = {
  PENDING_REVIEW: 'PENDING_REVIEW',
  AI_MAPPED: 'AI_MAPPED',
  BUYER_APPROVED: 'BUYER_APPROVED',
  SELF_MAP_REQUIRED: 'SELF_MAP_REQUIRED',
  SELF_MAPPED: 'SELF_MAPPED',
  REJECTED: 'REJECTED',
  NEW_CATEGORY_SUGGESTION: 'NEW_CATEGORY_SUGGESTION',
  FAILED: 'FAILED',
};

/** Who decided the stored category. */
const VENDOR_MAPPING_SOURCE = {
  AI: 'AI',
  BUYER: 'BUYER',
  SELF_MAPPED: 'SELF_MAPPED',
};

/** Per-vendor AI job state, persisted so a partial failure is retryable. */
const VENDOR_AI_PROCESSING_STATUS = {
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
};

/** Session-level AI job state. IDLE means categorisation has not been run. */
const VENDOR_INGESTION_AI_STATUS = {
  IDLE: 'IDLE',
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
};

/** How a PO line was attributed to a vendor-master row. */
const VENDOR_MATCH_STRATEGY = {
  VENDOR_CODE: 'VENDOR_CODE',
  GSTIN: 'GSTIN',
  NORMALIZED_NAME: 'NORMALIZED_NAME',
  UNMATCHED: 'UNMATCHED',
};

const VENDOR_DISPATCH_TEMPLATE = {
  CATEGORY_MAPPED: 'CATEGORY_MAPPED',
  SELF_MAP_REQUIRED: 'SELF_MAP_REQUIRED',
  GENERAL_ONBOARDING: 'GENERAL_ONBOARDING',
};

/**
 * Per-recipient email state.
 *
 * DELIVERED and BOUNCED are declared but only ever set by a provider callback.
 * Nodemailer over SMTP reports acceptance, not delivery, so this module stops at
 * SENT rather than claiming a delivery it cannot observe.
 */
const VENDOR_EMAIL_STATUS = {
  PENDING: 'PENDING',
  QUEUED: 'QUEUED',
  SENT: 'SENT',
  FAILED: 'FAILED',
  DELIVERED: 'DELIVERED',
  BOUNCED: 'BOUNCED',
};

const VENDOR_DISPATCH_STATUS = {
  QUEUED: 'QUEUED',
  COMPLETED: 'COMPLETED',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
};

/** Audit actions. Every state change in the module writes exactly one of these. */
const VENDOR_INGESTION_AUDIT_ACTION = {
  SESSION_CREATED: 'SESSION_CREATED',
  TIME_HORIZON_SELECTED: 'TIME_HORIZON_SELECTED',
  VENDOR_MASTER_UPLOADED: 'VENDOR_MASTER_UPLOADED',
  VENDOR_MASTER_VALIDATED: 'VENDOR_MASTER_VALIDATED',
  PO_DUMP_UPLOADED: 'PO_DUMP_UPLOADED',
  PO_DATA_VALIDATED: 'PO_DATA_VALIDATED',
  VENDOR_MATCHING_COMPLETED: 'VENDOR_MATCHING_COMPLETED',
  AI_CATEGORIZATION_STARTED: 'AI_CATEGORIZATION_STARTED',
  AI_CATEGORIZATION_COMPLETED: 'AI_CATEGORIZATION_COMPLETED',
  AI_RECOMMENDATION: 'AI_RECOMMENDATION',
  AI_RE_RUN: 'AI_RE_RUN',
  BUYER_APPROVAL: 'BUYER_APPROVAL',
  BUYER_EDIT: 'BUYER_EDIT',
  BUYER_REJECTION: 'BUYER_REJECTION',
  SELF_MAP_EMAIL_SENT: 'SELF_MAP_EMAIL_SENT',
  CATEGORY_EMAIL_SENT: 'CATEGORY_EMAIL_SENT',
  EMAIL_FAILED: 'EMAIL_FAILED',
  EMAIL_RETRIED: 'EMAIL_RETRIED',
  EMAIL_SKIPPED_DUPLICATE: 'EMAIL_SKIPPED_DUPLICATE',
};

/**
 * Confidence bands.
 *
 * Anything below REVIEW_THRESHOLD is held at PENDING_REVIEW regardless of what
 * the model returned — a low-confidence guess must not reach a live vendor
 * category without a person agreeing to it.
 */
const VENDOR_CONFIDENCE_BANDS = {
  HIGH_MIN: 90,
  MEDIUM_MIN: 70,
  REVIEW_THRESHOLD: 70,
};

/** Operational caps. All enforced server-side, not just in the browser. */
const VENDOR_INGESTION_CONFIG = {
  // One upload request carries at most this many rows; the client chunks a
  // larger file. Matches MAX_BULK_IMPORT_ROWS_PER_REQUEST in vendorController so
  // both spreadsheet upload paths behave identically.
  MAX_ROWS_PER_REQUEST: 1000,
  MAX_VENDOR_MASTER_ROWS: 20000,
  MAX_PO_ROWS: 200000,
  // R2 object key prefix for a large CSV upload awaiting background
  // processing (see largeFileIngestionService.js). Was a local temp-file
  // directory before the Cloudflare Workers migration — Workers has no
  // persistent local disk, so the raw upload now lives in R2 (the same
  // store RFQ attachments already use) between the streaming upload request
  // and the background ingestion job reading it back.
  UPLOAD_STORAGE_DIR: process.env.VENDOR_INGESTION_UPLOAD_DIR || 'uploads/vendor-ingestion',
  // 200,000 PO rows at a generous ~250 bytes/row is ~50MB; this leaves
  // headroom above that without risking an unbounded buffer.
  MAX_UPLOAD_BYTES: Number(process.env.VENDOR_INGESTION_MAX_UPLOAD_BYTES || 75 * 1024 * 1024),
  // Vendors classified per AI batch. The job is chunked so a large run reports
  // progress and can be resumed, rather than holding one long request open.
  AI_BATCH_SIZE: 8,
  // A model reply that is not valid JSON of the expected shape is retried this
  // many times in total before the vendor is marked FAILED. Retrying is safe:
  // classification writes no category until a reply validates.
  AI_MAX_ATTEMPTS: 2,
  // PO lines summarised into one vendor's purchasing profile. Enough to
  // characterise what a supplier sells without sending an entire spend history,
  // which is what makes this one call per vendor rather than one per PO row.
  AI_MAX_PO_LINES_PER_VENDOR: 60,
  AI_MAX_DESCRIPTION_CHARS: 240,
  MAX_MINOR_CATEGORIES_PER_VENDOR: 10,
  // Recipients per dispatch request, so one campaign cannot hold the event loop
  // on a few thousand sequential SMTP sends.
  MAX_RECIPIENTS_PER_DISPATCH: 500,
  // Legal-entity suffixes stripped before a vendor name is used as a fallback
  // match key, so "Apex Supplies Ltd." and "Apex Supplies Limited" collapse to
  // the same key. Vendor Code remains the preferred identifier; this is the last
  // resort, only reached when neither a code nor a GSTIN matched.
  NAME_NORMALIZATION_SUFFIXES: [
    'private limited',
    'pvt limited',
    'pvt ltd',
    'private ltd',
    'limited',
    'ltd',
    'llp',
    'inc',
    'incorporated',
    'corporation',
    'corp',
    'company',
    'co',
    'industries',
    'enterprises',
    'enterprise',
  ],
};

/** User-facing messages. `{param}` placeholders are filled by formatMessage. */
const VENDOR_INGESTION_MESSAGES = {
  NOT_A_BUYER: 'Only a buyer can ingest vendor master and pre-purchase order data.',
  SESSION_MISSING_USER: 'Your session does not identify a user. Please sign in again.',
  ORGANIZATION_NOT_LINKED: 'Your account is not linked to an organisation, so vendor data cannot be scoped to it.',
  SESSION_NOT_FOUND: 'That ingestion session does not exist for your organisation.',
  SESSION_REQUIRED: 'Start an ingestion session before uploading a file.',
  HORIZON_REQUIRED: 'Select a time horizon before uploading the pre-purchase order dump.',
  HORIZON_CUSTOM_DATES_REQUIRED: 'A custom time horizon needs both a start date and an end date.',
  HORIZON_START_AFTER_END: 'The time horizon start date must fall on or before its end date.',
  HORIZON_END_IN_FUTURE: 'The time horizon end date cannot be in the future.',
  VENDOR_MASTER_REQUIRED_FIRST: 'Upload and confirm your Vendor Master before uploading the PO dump.',
  VENDOR_MASTER_EMPTY: 'No valid vendor rows were supplied, so nothing was stored.',
  PO_DUMP_EMPTY: 'No valid pre-purchase order rows were supplied, so nothing was stored.',
  PO_DUMP_REQUIRED_FIRST: 'Upload and confirm your PO dump before running the category match.',
  JOIN_REQUIRED_FIRST: 'Run the vendor and PO match before starting AI categorisation.',
  TOO_MANY_ROWS: 'A single upload request may carry at most {max} rows. Large files are sent in chunks.',
  VENDOR_MASTER_LIMIT: 'A Vendor Master may hold at most {max} suppliers.',
  PO_LIMIT: 'A PO dump may hold at most {max} line items.',
  MAPPING_NOT_FOUND: 'That vendor is not part of this ingestion session.',
  MAPPING_NO_PO_HISTORY:
    'This supplier has no pre-purchase order history inside the selected period, so it cannot be categorised automatically. It is flagged for self-mapping.',
  CATEGORY_MASTER_EMPTY:
    'Your category master is empty, so there is nothing for the categoriser to choose from. Add categories to your organisation profile first.',
  MAJOR_CATEGORY_UNKNOWN: '"{category}" is not a major category in your organisation\'s category master.',
  MINOR_CATEGORY_UNKNOWN: '"{minor}" is not a sub-category of "{major}" in your category master.',
  TOO_MANY_MINOR_CATEGORIES: 'A supplier may carry at most {max} minor categories.',
  EDIT_REQUIRES_CATEGORY: 'Editing a mapping requires a primary major category.',
  AI_NOT_CONFIGURED: 'AI categorisation is not configured on this server, so no suggestions could be generated.',
  AI_ALREADY_RUNNING: 'AI categorisation is already running for this session.',
  AI_INVALID_RESPONSE: 'The categoriser did not return a usable result for this supplier.',
  DISPATCH_NO_RECIPIENTS: 'No eligible recipients were found for that template and category.',
  DISPATCH_TOO_MANY: 'A single dispatch may address at most {max} recipients.',
  DISPATCH_NOT_APPROVED:
    'Only suppliers whose categories you have approved can be sent the category notification. Approve them first.',
  DISPATCH_ALREADY_SENT:
    '{count} of the selected suppliers have already received this email and will be skipped. Use Retry Failed to re-attempt only the failures.',
  DISPATCH_NOTHING_TO_RETRY: 'There are no failed emails to retry for this session.',
  SESSION_LOAD_FAILED: 'Could not load your ingestion session. Please try again.',
  SESSION_SAVE_FAILED: 'Could not save your ingestion progress. Please try again.',
};

/**
 * Normalizes any date value (Excel numeric serial, Date instance, ISO string, DD-MM-YYYY, etc.)
 * into a clean standard ISO date string (YYYY-MM-DD).
 * Prevents Excel date serial numbers (e.g. 45995.00011574074) from being stored as decimals.
 */
function normalizePoDate(value) {
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

const INDIAN_STATES_AND_CITIES = {
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

function getIndianStates() {
  return Object.keys(INDIAN_STATES_AND_CITIES).sort((a, b) => a.localeCompare(b));
}

function getCitiesForState(state) {
  if (!state) return [];
  const normalized = String(state).trim();
  const direct = INDIAN_STATES_AND_CITIES[normalized];
  if (direct) return [...direct].sort((a, b) => a.localeCompare(b));
  const key = Object.keys(INDIAN_STATES_AND_CITIES).find((k) => k.toLowerCase() === normalized.toLowerCase());
  return key ? [...INDIAN_STATES_AND_CITIES[key]].sort((a, b) => a.localeCompare(b)) : [];
}




function parseSearchTokens(search) {
  if (!search || typeof search !== 'string') return [];
  const raw = search.trim();
  if (!raw) return [];

  if (/[\n\r,;]/.test(raw)) {
    return Array.from(
      new Set(
        raw
          .split(/[\n\r,;]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      )
    ).slice(0, 50);
  }

  const parts = raw.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => p.includes('@'))) {
    return Array.from(new Set(parts)).slice(0, 50);
  }

  return [raw];
}

module.exports = {
  normalizePoDate,
  VENDOR_INGESTION_SESSION_STATUS,
  VENDOR_INGESTION_STEP,
  VENDOR_INGESTION_HORIZON,
  VENDOR_INGESTION_HORIZON_MONTHS,
  VENDOR_MAPPING_STATUS,
  VENDOR_MAPPING_SOURCE,
  VENDOR_AI_PROCESSING_STATUS,
  VENDOR_INGESTION_AI_STATUS,
  VENDOR_MATCH_STRATEGY,
  VENDOR_DISPATCH_TEMPLATE,
  VENDOR_EMAIL_STATUS,
  VENDOR_DISPATCH_STATUS,
  VENDOR_INGESTION_AUDIT_ACTION,
  VENDOR_CONFIDENCE_BANDS,
  VENDOR_INGESTION_CONFIG,
  VENDOR_INGESTION_MESSAGES,
  ISO_DATE_REGEX,
  ISO_DATE_MESSAGE,
  TIME_HORIZON_TYPES,
  CATEGORY_REVIEW_ACTIONS,
  DISPATCH_TEMPLATES,
  RFQ_SUMMARY_CONFIG,
  BUYER_ACCOUNT_RESOLUTION,
  SOURCING_MODES,
  BUYER_SUBSCRIPTION_PLANS,
  VENDOR_SUBSCRIPTION_PLANS,
  INITIAL_SYSTEM_CONFIG,
  INITIAL_AZURE_HEALTH,
  DATABASE_HEALTH_SERVICE_LABEL,
  SYSTEM_ACTOR_EMAIL,
  RFQ_DEFAULTS,
  QUALIFICATION_PILLARS,
  AES_CONFIG,
  AUTH_MESSAGES,
  IDENTITY_ROLE_MAP,
  IDENTITY_MASTER_DATA,
  IDENTITY_PHONE_CONFIG,
  IDENTITY_OTP_CONFIG,
  BUYER_PROFILE_CONFIG,
  BUYER_PROFILE_MESSAGES,
  formatMessage,
  RFQ_CATEGORY_CLASSIFICATION,
  RFQ_INGESTION_CONFIG,
  RFQ_ATTACHMENT_CONFIG,
  GEMINI_CONFIG,
  GEMINI_INLINE_MIME_TYPES,
  EXTRACTION_REASON_MESSAGES,
  EMAIL_INGESTION_CONFIG,
  EMAIL_INGESTION_STATUS,
  EMAIL_INGESTION_MESSAGES,
  EMAIL_GATEWAY_CONFIG,
  GMAIL_GATEWAY_LABELS,
  VENDOR_EMAIL_GATEWAY_CONFIG,
  EMAIL_GATEWAY_MESSAGES,
  EMAIL_GATEWAY_STATE,
  EMAIL_GATEWAY_SMTP_PORTS,
  UNAUTHORIZED_BUYER_NOTIFICATION,
  RFQ_ACKNOWLEDGEMENT_NOTIFICATION,
  RFQ_NOT_CREATED_NOTIFICATION,
  VENDOR_FREE_CREDITS_LIMIT,
  VENDOR_CREDITS_EXHAUSTED_NOTIFICATION,
  ZOHO_CONFIG,
  ZOHO_SUBSCRIPTION_PRICING,
  computeZohoPlanAmount,
  ZOHO_BUYER_SUBSCRIPTION_PRICING,
  computeZohoBuyerPlanAmount,
  getSubscriptionPricingConfig,
  getSubscriptionGstPercent,
  getSubscriptionGstRate,
  getBuyerSubscriptionPricing,
  getSellerSubscriptionPricing,
  EMAIL_REGEX,
  GSTIN_REGEX,
  GSTIN_MESSAGE,
  PHONE_REGEX,
  INDIAN_MOBILE_REGEX,
  INDIAN_MOBILE_MESSAGE,
  OTP_CODE_REGEX,
  OTP_CODE_MESSAGE,
  PINCODE_REGEX,
  PINCODE_MESSAGE,
  PAN_REGEX,
  PAN_MESSAGE,
  CIN_REGEX,
  CIN_MESSAGE,
  WEBSITE_REGEX,
  WEBSITE_MESSAGE,
  INDIAN_PINCODE_REGEX,
  INDIAN_PINCODE_MESSAGE,
  ORGANIZATION_TYPES,
  PASSWORD_MIN_LENGTH,
  VALIDATION_SCHEMAS,
  validatePayload,
  BUYER_SUBSCRIPTION_TO_SOURCING_MODE,
  resolveBuyerSourcingMode,
  SUBSCRIPTION_MODE_ENTITLEMENTS,
  hasUnlimitedRfqAccess,
  hasUnlimitedQuoteAccess,
  hasUnlimitedDownloadAccess,
  CHASER_DELAYS,
  SMS_DLT_TEMPLATES,
  PRESENCE_ONLINE_THRESHOLD_MS,
  VENDOR_ASSIGNMENT_LIMITS,
  MAX_INVITE_VENDORS_PER_REQUEST,
  RFQ_MODES,
  RFQ_MODE_LABELS,
  RFQ_MODE_MAP,
  ALLOWED_EXTENSION_HOURS,
  DEFAULT_EXTENSION_HOURS,
  DEFAULT_CATEGORY_TAXONOMY,
  MAJOR_CATEGORY_ALIASES: RFQ_CATEGORY_CLASSIFICATION.MAJOR_CATEGORY_ALIASES,
  QUA_AI_EMAIL_TEMPLATES,
  QUA_AI_EMAIL_SUPPORT,
  VENDOR_QUOTE_SUPPORT_CC,
  INDIAN_STATES_AND_CITIES,
  getIndianStates,
  getCitiesForState,
  parseSearchTokens,
  INQUIRIES_PERSISTENCE_FILE,
};

