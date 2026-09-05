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
};
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
  ACCOUNT_INACTIVE:
    'This account is marked inactive. Ask an administrator to re-activate it before signing in.',
  ACCOUNT_PENDING_APPROVAL:
    'This self-registered account is still awaiting administrator approval, so sign-in is blocked. You will be able to log in once it is approved.',
  ACCOUNT_ALREADY_EXISTS:
    'An account already exists for this email address. Use the Sign In tab instead of creating a new account.',
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

  // Longest keyword is evaluated first so "circuit breaker" beats "breaker".
  DOMAIN_KEYWORD_MAP: {
    'centrifugal pump': { major: 'Engineering Spares - Mechanical', minor: 'Pumps & Accessories' },
    'circuit breaker': { major: 'Engineering Spares - Electrical', minor: 'Circuit Breakers' },
    'structural steel': { major: 'Civil Works', minor: 'PEB Structure' },
    'roofing sheet': { major: 'Civil Works', minor: 'Roofing Sheets' },
    'gate valve': { major: 'Engineering Spares - Mechanical', minor: 'Hoses, Valves & Fittings' },
    switchgear: { major: 'Engineering Spares - Electrical', minor: 'Electrical-Lv Switch Gears' },
    transformer: { major: 'Engineering Spares - Electrical', minor: 'Transformers' },
    compressor: { major: 'Engineering Spares - Mechanical', minor: 'Compressors & Accessories' },
    gearbox: { major: 'Engineering Spares - Mechanical', minor: 'Gearboxes & Spares' },
    bearing: { major: 'Engineering Spares - Mechanical', minor: 'Bearings & Accessories' },
    fastener: { major: 'Engineering Spares - Mechanical', minor: 'Fasteners' },
    lubricant: { major: 'Raw Material', minor: 'Lubricants' },
    impeller: { major: 'Engineering Spares - Mechanical', minor: 'Pumps & Accessories' },
    rebar: { major: 'Civil Works', minor: 'TMT BARS' },
    mccb: { major: 'Engineering Spares - Electrical', minor: 'Circuit Breakers' },
    laptop: { major: 'IT', minor: 'Laptop' },
    software: { major: 'IT', minor: 'Software' },
    freight: { major: 'Logistics', minor: 'Road transport' },
    pump: { major: 'Engineering Spares - Mechanical', minor: 'Pumps & Accessories' },
    valve: { major: 'Engineering Spares - Mechanical', minor: 'Hoses, Valves & Fittings' },
    hose: { major: 'Engineering Spares - Mechanical', minor: 'Hoses, Valves & Fittings' },
    pipe: { major: 'Engineering Spares - Mechanical', minor: 'Pipes & Pipe Fittings' },
    panel: { major: 'Engineering Spares - Electrical', minor: 'Panels' },
    cable: { major: 'Engineering Spares - Electrical', minor: 'Cables' },
    sensor: { major: 'Engineering Spares - Electrical', minor: 'Sensors' },
    motor: { major: 'Engineering Spares - Electrical', minor: 'Motors' },
    peb: { major: 'Civil Works', minor: 'PEB Structure' },
    tmt: { major: 'Civil Works', minor: 'TMT BARS' },
    steel: { major: 'Raw Material', minor: 'Steels' },
    tool: { major: 'Engineering Spares - Mechanical', minor: 'Tools & Tackles' },
    // Personal protective equipment. The model tends to label these with an
    // umbrella term ('PPE', 'Hand Protection') that is not a taxonomy minor, so
    // the item text is what routes them.
    'fire extinguisher': { major: 'Occuptional Health and Safety', minor: 'Fire Extinguishers' },
    'safety jacket': { major: 'Occuptional Health and Safety', minor: 'Safety jackets' },
    'safety shoe': { major: 'Occuptional Health and Safety', minor: 'Safety Shoes' },
    'storage rack': { major: 'New Category-Product', minor: 'Storage Racks' },
    helmet: { major: 'Occuptional Health and Safety', minor: 'Hemlets' },
    harness: { major: 'Occuptional Health and Safety', minor: 'Harness' },
    glove: { major: 'Occuptional Health and Safety', minor: 'Gloves' },
    filter: { major: 'Engineering Spares - Mechanical', minor: 'Filters' },
  },
};

// ==============================================================================
// GEMINI AI DOCUMENT EXTRACTION
// ==============================================================================
// Mirrors app.gemini.* in the Java p2pservices app, which is the service that
// currently extracts RFQ line items in production. The API key is read from the
// environment only and never leaves the server.
const GEMINI_CONFIG = {
  API_KEY: process.env.GEMINI_API_KEY || '',
  BASE_URL: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/models',
  // Pinned to a specific GA model so extraction quality is reproducible.
  PRIMARY_MODEL: process.env.GEMINI_PRIMARY_MODEL || 'gemini-3.6-flash',
  // Tried in order when the primary model errors or is unavailable.
  //
  // Ordered fastest-first, which is a deliberate departure from
  // app.gemini.backup-models in the Java service.
  //
  // That service extracts from inbound email in the background, so it can spend
  // as long as it likes on progressively stronger models. This endpoint answers a
  // synchronous browser upload behind a proxy that cuts the request off at 30s,
  // so once the primary has used most of the budget the only useful fallback is
  // one that can finish in the seconds that remain. Measured on the same
  // document: gemini-3.6-flash 12.5s, gemini-3.5-flash-lite 1.8s, identical line
  // items from both.
  //
  // The chain still ends on a floating alias. Google retires pinned models: when
  // gemini-2.0-flash was withdrawn every entry in the old chain 404'd at once and
  // extraction failed outright instead of degrading.
  FALLBACK_MODELS: (
    process.env.GEMINI_FALLBACK_MODELS ||
    'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest,gemini-3.7-flash,gemini-3.5-flash'
  )
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean),
  // The primary model measured 12.5s on a small PDF and timed out at 15s on a
  // real one, so it needs more than the Java service's 15s read timeout to have a
  // fair chance before the chain moves on.
  REQUEST_TIMEOUT_MS: Number(process.env.GEMINI_REQUEST_TIMEOUT_MS || 20000),
  // Ceiling for the whole model chain, not one attempt.
  //
  // Extraction is answered inside a browser request, so the walk has to finish
  // while something is still listening. Next's dev proxy cuts a rewrite off at a
  // hardcoded 30s and browsers apply a similar cap, so at 45s a second slow
  // attempt ran past it and the request was killed mid-flight — which surfaced to
  // the buyer as a bare 500 instead of the manual-entry fallback this endpoint
  // exists to return.
  //
  // 24s leaves 6s of headroom under that ceiling and still funds a fast fallback:
  // if the 20s primary times out, the remaining 4s comfortably covers a lite
  // model measured at 1.8s.
  TOTAL_BUDGET_MS: Number(process.env.GEMINI_TOTAL_BUDGET_MS || 24000),
  // Below this much remaining budget a further attempt cannot finish, so the
  // chain stops rather than starting a request it will have to abandon.
  MIN_ATTEMPT_MS: Number(process.env.GEMINI_MIN_ATTEMPT_MS || 3000),
  // Documents larger than this are rejected before a request is billed.
  MAX_DOCUMENT_BYTES: Number(process.env.GEMINI_MAX_DOCUMENT_BYTES || 10 * 1024 * 1024),
  MAX_DOCUMENT_TEXT_CHARS: Number(process.env.GEMINI_MAX_DOCUMENT_TEXT_CHARS || 120000),
  // Deterministic output: extraction must not paraphrase or invent values.
  TEMPERATURE: 0,
};

// ==============================================================================
// RFQ DOCUMENT ATTACHMENTS
// ==============================================================================
// Supporting documents a buyer attaches to an RFQ. These are stored and served
// back verbatim and are never sent to Gemini: the manual flow exists precisely
// because the buyer is keying the line items themselves.
//
// Content lives in Cloudflare R2 rather than on the RFQ record. A 10MB PDF is
// ~13MB of base64, and the bootstrap payload returns every RFQ, so inlining
// attachments would make that response grow without bound.
const RFQ_ATTACHMENT_CONFIG = {
  // Object key prefix within the R2 bucket (was the local disk directory
  // before the R2 migration — same env var, reinterpreted).
  STORAGE_DIR: process.env.RFQ_ATTACHMENT_DIR || 'uploads/rfq-attachments',
  MAX_BYTES: Number(process.env.RFQ_ATTACHMENT_MAX_BYTES || 10 * 1024 * 1024),
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
  ],
  // Identifiers are generated server-side and must match this before ever being
  // joined onto a path, which is what keeps `../` out of the storage directory.
  ID_PATTERN: /^[a-f0-9-]{8,64}$/,
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
  NO_ITEMS_FOUND:
    'No procurement line items could be identified in this document. Add the line items manually to continue.',
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
  VALIDATION_SCHEMAS,
  validatePayload,
} = require('./validationSchemas');

module.exports = {
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
  VALIDATION_SCHEMAS,
  validatePayload,
};


