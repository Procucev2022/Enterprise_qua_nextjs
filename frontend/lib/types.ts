export type UserRole = 'buyer' | 'category_manager' | 'vendor' | 'admin';

export type SourcingMode = 'mode_1' | 'mode_2' | 'mode_3';

export type VendorSubscriptionPlan = 'premium' | 'connect' | 'select' | 'premium_network';

export interface SourcingModeDetail {
  id: SourcingMode;
  code: string;
  name: string;
  shortLabel: string;
  description: string;
  badgeColor: string;
}

export interface ExtractedEntity {
  id: string;
  itemName: string;
  quantity: number;
  unit: string;
  targetDate: string;
  technicalSpecs: string;
  confidence: number;
  category: string;
  majorCategory?: string;
  minorCategory?: string;
}

export interface LineItemBid {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  leadTimeDays: number;
  uploadedDocument?: string;
  complianceDoc?: string;
  marketBandStatus: 'optimal' | 'warning' | 'high';
  paymentTerms: string;
}

export interface QuoteComparison {
  vendorId: string;
  vendorName: string;
  vendorCategory: 'Client List' | 'Procucev - AI Rec' | 'Procucev Network';
  unitPrice: number;
  totalPrice: number;
  leadTimeDays: number;
  aiMatchScore: number;
  isBestPrice?: boolean;
  isPreferred?: boolean;
  warrantyYears: number;
  complianceStatus: 'Fully Compliant' | 'Minor Exception' | 'Pending Review';
  paymentTerms: string;
  remarks: string;
}

export type FollowUpChannel = 'call' | 'whatsapp' | 'sms';

export interface VendorChannelCall {
  status: 'completed' | 'connected' | 'in_progress' | 'voicemail' | 'failed' | 'scheduled';
  lastAttempt: string;
  duration?: string;
  summary?: string;
  recordingUrl?: string;
  transcriptSnippet?: string;
}

export interface VendorChannelWhatsApp {
  status: 'read' | 'delivered' | 'replied' | 'pending' | 'failed';
  lastAttempt: string;
  messagePreview?: string;
  linkClicked?: boolean;
}

export interface VendorChannelSMS {
  status: 'delivered' | 'sent' | 'clicked' | 'failed' | 'pending';
  lastAttempt: string;
  deliveryReport?: string;
}

export interface VendorChannelEmail {
  status: 'sent' | 'delivered' | 'opened' | 'pending' | 'reminded_24h';
  lastAttempt: string;
  is24hReminderSent: boolean;
  subject?: string;
}

export interface VendorFollowUpRecord {
  vendorId: string;
  vendorName: string;
  phone: string;
  contactPerson: string;
  call: VendorChannelCall;
  whatsapp: VendorChannelWhatsApp;
  sms: VendorChannelSMS;
  email24h?: VendorChannelEmail;
  overallStatus: 'Responded' | 'Follow-up Active' | 'Awaiting Bid' | 'Escalated' | 'Pending';
  lastInteraction: string;
  attemptsCount: number;
  bidStatus: 'Submitted' | 'In Progress' | 'Pending' | 'Declined';
}

export interface RFQFollowUpBreakdown {
  rfqNumber: string;
  totalInvited: number;
  respondedCount: number;
  callStats: {
    total: number;
    connected: number;
    avgDuration: string;
  };
  whatsappStats: {
    total: number;
    delivered: number;
    read: number;
    replied: number;
  };
  smsStats: {
    total: number;
    delivered: number;
    clicked: number;
  };
  emailStats?: {
    total: number;
    sent24h: number;
    opened: number;
  };
  vendors: VendorFollowUpRecord[];
  nextScheduledChaser?: string;
  autoChasingEnabled: boolean;
}

export type RFQSource = 'email_gateway' | 'web_portal' | 'email_upload' | 'manual_entry';

export interface RFQItem {
  id: string;
  rfqNumber: string;
  title: string;
  category: string;
  sourcingMode: SourcingMode;
  status: 'Parsing' | 'In Evaluation' | 'AI Recommended' | 'PO Generated' | 'Quotes Pending';
  quotesCount: number;
  targetDeliveryDate: string;
  budget: number;
  createdAt: string;
  extractedEntities: ExtractedEntity[];
  quotes: QuoteComparison[];
  chasingActive: boolean;
  chaserMethod?: 'WhatsApp' | 'Email' | 'SMS' | 'Call' | 'Multi-Channel';
  aiScore?: number;
  source?: RFQSource;
  sourceEmail?: string;
  sourceFileName?: string;
  autoCirculated?: boolean;
  followUpData?: RFQFollowUpBreakdown;
  awardedVendorId?: string;
  awardedVendor?: string;
  awardedAmount?: number;
}

export interface AIBotFeedItem {
  id: string;
  timestamp: string;
  timeAgo: string;
  type: 'call' | 'whatsapp' | 'sms' | 'email' | 'scoring' | 'ingestion' | 'escalation' | 'approval' | 'system' | 'invitation' | 'reminder';
  channel?: 'call' | 'whatsapp' | 'sms' | 'email' | 'system' | 'invitation' | 'reminder';
  title: string;
  message: string;
  recipient?: string;
  rfqNumber?: string;
  status: 'delivered' | 'read' | 'completed' | 'processing' | 'answered' | 'connected' | 'failed';
  channelDetails?: {
    duration?: string;
    transcriptSummary?: string;
    deliveryTimestamp?: string;
    actionOutcome?: string;
  };
}

export interface VendorOpportunity {
  id: string;
  rfqNumber: string;
  title: string;
  buyer: string;
  deadline: string;
  daysRemaining: number;
  type: 'direct_invitation' | 'network_marketplace';
  estimatedValue?: string;
  deliveryLocation: string;
  status: 'pending_bid' | 'submitted' | 'under_review';
  lineItems: LineItemBid[];
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  rfqNumber?: string;
  shaSignature: string;
  status: 'VERIFIED' | 'TAMPER_CHECK_OK';
  ipAddress: string;
}

export interface AzureServiceHealth {
  service: string;
  status: 'ONLINE' | 'HEALTHY' | 'DEGRADED';
  latency: string;
  uptime: string;
  details: string;
}

export interface SystemConfig {
  ollamaModel: 'Llama 3 (8B Instruct)' | 'Llama 3.1 (70B Quantized)' | 'Mistral NeMo 12B';
  ollamaActive: boolean;
  ocrExtractionThreshold: number;
  whatsappAutoChaser: boolean;
  voiceCallAutoChaser?: boolean;
  smsAutoChaser?: boolean;
  escalationIntervalHours: number;
  azureDbBackupFrequency: 'Hourly' | 'Daily' | 'Continuous';
  rbacEnforced: boolean;
}

export interface VendorModuleScore {
  score: number;
  maxScore: number;
  weight: number;
  weightedScore: number;
  remarks?: string;
}

export interface VendorEvaluationDocument {
  id: string;
  name: string;
  type: string;
  uploadDate: string;
  verified: boolean;
  status: 'Verified' | 'Pending Review' | 'Missing';
}

export interface QuestionEvaluationItem {
  refId: string;
  pillarId: 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6';
  pillarName: string;
  criteria: string;
  attachmentName: string;
  attachmentVerified: boolean;
  score: number;
  weightedScore: number;
  remarks: string;
}

export interface VendorEvaluationRecord {
  id: string;
  vendorId: string;
  vendorName: string;
  contactPerson: string;
  email: string;
  phone: string;
  category: string;
  submissionDate: string;
  status: 'PREFERRED ENTERPRISE SUPPLIER' | 'CONDITIONAL / UNDER REVIEW' | 'DISQUALIFIED SUPPLIER';
  overallScore: number; // 0 - 100%
  moduleScores: {
    commercial: VendorModuleScore; // 25%
    technical: VendorModuleScore; // 15%
    quality: VendorModuleScore; // 20%
    delivery: VendorModuleScore; // 20%
    financial: VendorModuleScore; // 10%
    governance: VendorModuleScore; // 10%
  };
  documents: VendorEvaluationDocument[];
  questionBreakdown?: QuestionEvaluationItem[];
  capaRequired?: boolean;
  capaNotes?: string;
  systemAction: string;
  responses?: Record<string, string | number>;
}

export interface MajorMinorCategory {
  majorCategory: string;
  minorCategories: string[];
}

export interface OrganizationProfile {
  companyName: string;
  brandName: string;
  organizationType: 'Private Limited' | 'Public Limited' | 'Partnership' | 'Sole Proprietorship' | 'LLP';
  panNumber: string;
  gstNumber: string;
  cinNumber: string;
  msmeNumber?: string;
  website: string;
  annualTurnover: string;
  registeredAddress: {
    street: string;
    city: string;
    state: string;
    pincode: string;
    country: string;
  };
  primaryContact: {
    name: string;
    designation: string;
    email: string;
    phone: string;
  };
  selectedMajorCategories: string[];
  selectedMinorCategories: Record<string, string[]>;
}

export interface VendorEntry {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  majorCategory: string;
  minorCategories: string[];
  location: string;
  rating: number;
  source: 'buyer_manual' | 'buyer_excel' | 'procucev_network' | 'manual' | 'excel';
  status?: 'PREFERRED ENTERPRISE SUPPLIER' | 'CONDITIONAL / UNDER REVIEW' | 'REGISTERED / NOT EVALUATED';
  score?: number | null;
  evaluated?: boolean;
  hasRecord?: boolean;
  matchReason?: string;
  proximity?: string;
  proximityMatch?: boolean;

  // Database Availability & Onboarding Credentials
  isExistingInDatabase?: boolean;
  onboardingEmailStatus?: 'sent' | 'pending' | 'delivered';
  onboardingEmailDispatchedAt?: string;
  tempPassword?: string;
  firstLoginCompleted?: boolean;
  reminderCadence?: 'every_3_days';
  nextReminderDate?: string;
  remindersSentCount?: number;
  addedByBuyerCompany?: string;
  addedByBuyerName?: string;
  profileCompletionStatus?: 'pending' | 'completed';

  // Dual-Stream Category Mapping & Reconciliation (Client-Mapped vs Vendor-Selected)
  clientMappedCategories?: string[]; // Categories assigned by buyer (from PO / vendor master upload)
  vendorSelectedCategories?: string[]; // Categories chosen by vendor from profile page (max 10)
  isCategoryAligned?: boolean; // True if vendor selected matches client mapped
  categoryMismatchDetails?: {
    clientOnly: string[];
    vendorOnly: string[];
    common: string[];
  };
  categoryMatchSource?: 'Aligned Buyer & Vendor Category Match' | 'Buyer Empanelled Category Match' | 'Vendor Profile Self-Declared Category Match';

  // Buyer Performance Ratings & Revisions
  latestRatingRevision?: VendorRatingRevisionRecord;
  ratingRevisionHistory?: VendorRatingRevisionRecord[];
}

export interface VendorRatingRevisionRecord {
  id: string;
  vendorId: string;
  vendorName: string;
  buyerCompany: string;
  buyerName: string;
  buyerEmail: string;
  timestamp: string;
  qualityScore: number; // 0-100
  costScore: number; // 0-100
  deliveryScore: number; // 0-100
  buyerAverage: number; // (Q + C + D) / 3
  previousScore: number;
  newCompositeScore: number; // Math.round((previousScore + buyerAverage) / 2)
  previousRating: number;
  newRating: number; // newCompositeScore / 20
  remarks: string;
  emailDispatched: boolean;
  shaSignature: string;
}

export interface VendorRatingRevisionEmailPayload {
  vendorName: string;
  vendorEmail: string;
  vendorContactPerson: string;
  buyerCompany: string;
  buyerContactName: string;
  buyerContactEmail: string;
  dispatchedAt: string;
  qualityScore: number;
  costScore: number;
  deliveryScore: number;
  buyerAverage: number;
  previousScore: number;
  newCompositeScore: number;
  newRating: number;
  remarks: string;
  shaSignature: string;
}

export interface VendorMasterUploadRecord {
  id: string;
  vendorCode?: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  gstNumber: string;
  vendorRatingScore?: number; // 0 to 100 (Optional)
}

export interface PurchaseOrderLineItemRecord {
  id: string;
  poNumber: string;
  poDate: string;
  vendorIdentifier: string; // Matches vendor code, company name or email
  itemName: string;
  specs?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalSpend: number;
  department?: string;
}

export interface HistoricalPurchaseVendorRecord {
  id: string;
  vendorCode?: string;
  companyName: string;
  email: string;
  contactPerson?: string;
  phone: string;
  address: string;
  gstNumber: string;
  vendorRatingScore?: number; // 0 to 100 (Optional)
  hasPoHistory: boolean; // True if PO line items were found in PO dump
  categoriesMappedByBuyer: boolean; // True if buyer mapped 1st & 2nd set categories from POs
  itemsSupplied: string[]; // List of items purchased in the past
  pastPoSpend?: string;
  poCount?: number;
  firstSetMajorCategory: string; // 1st Set: Primary Major Category
  secondSetMinorCategories: string[]; // 2nd Set: Minor Categories
  secondSetSecondaryMajors?: string[]; // 2nd Set: Secondary Major Categories
  isExistingInDatabase?: boolean;
  tempPassword?: string;
}

export interface VendorOnboardingEmailPayload {
  emailId: string;
  vendorId: string;
  vendorName: string;
  recipientEmail: string;
  contactPerson: string;
  buyerCompanyName: string;
  buyerContactName: string;
  buyerContactEmail: string;
  isExistingInDatabase: boolean;
  subject: string;
  username: string;
  tempPassword: string;
  authInstructions: string;
  profileUpdateInstructions: string;
  categoryUpdateInstructions: string;
  
  // Categorization status
  hasPoHistory: boolean;
  categoriesMappedByBuyer: boolean;
  unmappedSelfServiceMessage?: string;
  
  // Highlighted Assigned Categories by Buyer (1st Set Major & 2nd Set Minor Categories)
  assignedMajorCategory: string;
  assignedMinorCategories: string[];
  assignedSecondaryMajors?: string[];
  
  reminderScheduleNote: string;
  dispatchedAt: string;
  nextReminderDate: string;
  portalLoginUrl: string;
  shaSignature: string;
  reminderCount: number;
}

export interface VendorProfileReminderPayload {
  reminderId: string;
  vendorId: string;
  vendorName: string;
  recipientEmail: string;
  buyerCompanyName: string;
  buyerContactName: string;
  dayNumber: number; // 3, 6, 9, etc.
  subject: string;
  message: string;
  username: string;
  dispatchedAt: string;
  nextReminderDate: string;
  shaSignature: string;
}

export interface StandardRFQEmailPayload {
  emailId: string;
  rfqNumber: string;
  rfqTitle: string;
  sourcingMode: SourcingMode;
  sourcingModeName: string;
  sourcingModeCode: string;
  buyerCompany: string;
  buyerContactName: string;
  buyerContactEmail: string;
  buyerContactPhone: string;
  recipientVendorName: string;
  recipientContactPerson: string;
  recipientEmail: string;
  subject: string;
  matchedMajorCategory: string;
  matchedMinorCategories: string[];
  requisitionDate: string;
  submissionDeadline: string;
  targetDeliveryDate: string;
  deliveryLocation: string;
  paymentTerms: string;
  lineItems: Array<{
    itemNumber: number;
    itemName: string;
    technicalSpecs: string;
    quantity: number;
    unit: string;
    minorCategory: string;
    targetDate: string;
  }>;
  specialInstructions: string;
  complianceChecklist: string[];
  replyInstructions: string;
  replyToEmail: string;
  shaSignature: string;
  dispatchedAt: string;
}

export interface BuyerAccount {
  id: string;
  organizationName: string;
  brandName?: string;
  corporateEmail: string;
  contactPerson: string;
  contactDesignation?: string;
  mobileNumber: string;
  gstin: string;
  panNumber?: string;
  cinNumber?: string;
  industrySector: string;
  sourcingMode: SourcingMode;
  subscriptionPlan: 'free_trial' | 'version_1' | 'version_2' | 'version_3';
  remainingFreeRFQs: number;
  accountSource: 'public_system' | 'web_registration' | 'enterprise_sso';
  status: 'ACTIVE_VERIFIED' | 'PENDING_ALIGNMENT' | 'SYNCED_LEGACY';
  primaryPlantLocation: string;
  supportedMajorCategories: string[];
  supportedMinorCategories?: string[];
  totalRFQsCreated: number;
  totalSpend: string;
  syncTimestamp: string;
  createdDate: string;
  
  // Historical purchase data ingestion & initial setup tracking
  initialSetupCompleted?: boolean;
  historicalDataPeriod?: '1_year' | '2_years' | '3_years';
  historicalVendorsCount?: number;
}

export interface DBHealthStatus {
  connected: boolean;
  isConnected?: boolean;
  isConfigured?: boolean;
  providerLabel?: string;
  latencyMs?: number;
  poolStatus?: {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  };
  tablesCount?: number;
  totalRecords?: {
    buyerAccounts?: number;
    vendors?: number;
    rfqs?: number;
    evaluations?: number;
    auditLogs?: number;
  };
  uptime?: string;
}

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
  salt?: string;
  algorithm: string;
  version: string;
  encoded?: string;
}

export interface AESEncryptionOptions {
  secretKey?: string;
  salt?: string;
  additionalData?: string;
  encoding?: 'hex' | 'base64';
}

export interface DecryptionResult<T = string> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface CryptoHealthStatus {
  status: 'HEALTHY' | 'DEGRADED' | 'FAILED';
  algorithm: string;
  keyLengthBits: number;
  roundtripVerified: boolean;
  tamperDetectionVerified: boolean;
  timestamp: string;
}

// Authentication & Session Types
export interface UserSession {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  orgId: string;
  orgName: string;
  mobile?: string;
  authMethod?: 'PASSWORD' | 'EMAIL_OTP' | 'TEMP_PASSWORD' | 'INSTANT_DEMO';
}

// ═══════════════════════════════════════════════════════════════════════
// RFQ Ingestion & Portfolio Summary Types
// ═══════════════════════════════════════════════════════════════════════

/** Why an ingested line item landed in its category, surfaced in the review grid. */
export type RFQClassificationStatus = 'AI_EXTRACTED' | 'DOMAIN_KEYWORD_MATCHED' | 'DEFAULT';

/** Per-ingest breakdown returned by POST /api/rfqs/ingest. */
export interface RFQIngestionClassification {
  totalExtracted: number;
  accepted: number;
  duplicatesRemoved: number;
  needsReview: number;
  autoClassified: number;
}

/** Draft RFQ header + classified line items returned by POST /api/rfqs/ingest. */
export interface RFQIngestionDraft {
  title: string;
  category: string;
  targetDeliveryDate: string;
  /**
   * Overall value read off the document: a stated grand total, else the sum of
   * the priced line items. Null when the document carried no pricing at all, in
   * which case the buyer supplies the figure on the review step.
   */
  estimatedBudget: number | null;
  extractedEntities: ExtractedEntity[];
  source: RFQSource;
  sourceFileName?: string;
  sourceEmail?: string;
}

/** Why an AI extraction attempt did not yield line items. */
export type RFQExtractionReason =
  | 'NOT_CONFIGURED'
  | 'NO_CONTENT'
  | 'DOCUMENT_TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'AI_FAILED'
  | 'NO_ITEMS_FOUND'
  | 'NETWORK';

/**
 * Document posted to POST /api/rfqs/extract. Spreadsheets are flattened to text
 * in the browser; PDFs and images travel as base64 with their MIME type.
 */
export interface RFQExtractionRequest {
  fileName: string;
  documentText?: string;
  inlineData?: string;
  mimeType?: string;
}

/** Which model produced the extraction, for display in the review step. */
export interface RFQExtractionMeta {
  model: string;
  deliveryDate?: string | null;
}

export interface RFQExtractionResult {
  success: boolean;
  data?: RFQIngestionDraft;
  classification?: RFQIngestionClassification;
  extraction?: RFQExtractionMeta;
  reason?: RFQExtractionReason;
  error?: string;
}

export interface RFQIngestionResponse {
  success: boolean;
  data?: RFQIngestionDraft;
  classification?: RFQIngestionClassification;
  error?: string;
}

/** Multi-channel follow-up roll-up across the whole RFQ portfolio. */
export interface RFQPortfolioFollowUps {
  vendorsInvited: number;
  vendorsResponded: number;
  calls: number;
  callsConnected: number;
  whatsapp: number;
  whatsappRead: number;
  sms: number;
}

/** Aggregated portfolio metrics backing the buyer RFQ Summary screen. */
export interface RFQPortfolioSummary {
  totalRFQs: number;
  activeRFQs: number;
  awaitingQuotes: number;
  totalQuotesReceived: number;
  totalBudget: number;
  averageQuotesPerRFQ: number;
  byStatus: Record<string, number>;
  bySourcingMode: Record<string, number>;
  bySource: Record<string, number>;
  followUps: RFQPortfolioFollowUps;
}

export interface AuthResponse {
  success: boolean;
  message?: string;
  token?: string;
  user?: UserSession;
  error?: string;
  demoCode?: string;
  expiresInSeconds?: number;
}

export interface LoginCredentials {
  email: string;
  /** Registered mobile number, verified alongside the password at sign-in. */
  mobile?: string;
  password?: string;
  code?: string;
  role?: UserRole;
}

export interface OtpRequestPayload {
  email: string;
  /** Registered mobile number the code is issued against. */
  mobile: string;
  roleHint?: UserRole;
}

export interface OtpVerifyPayload {
  email: string;
  code: string;
  /** Must match the mobile number the code was requested with. */
  mobile: string;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password?: string;
  mobile?: string;
  role?: UserRole;
  orgName?: string;
}


// ═══════════════════════════════════════════════════════════════════════
// Sidebar Dashboard Navigation Types (Role Workspace Shell)
// ═══════════════════════════════════════════════════════════════════════

export type SidebarIconKey =
  | 'Building2'
  | 'SlidersHorizontal'
  | 'Truck'
  | 'Cpu'
  | 'Layers'
  | 'Sparkles'
  | 'Kanban'
  | 'TrendingUp'
  | 'FileSpreadsheet'
  | 'FileCheck'
  | 'ShieldCheck'
  | 'Server'
  | 'Award'
  | 'ClipboardList'
  | 'Database';

export interface SidebarNavItem {
  /** Active screen key consumed by the screen switchboard */
  id: string;
  /** Full screen reference used for accessible names (e.g. "Screen 1.1") */
  screenTag: string;
  /** Compact screen reference rendered as a sidebar badge (e.g. "1.1") */
  shortTag: string;
  label: string;
  description: string;
  icon: SidebarIconKey;
  /** Section heading key the item is grouped under */
  group: string;
  /** Application URL this module is served at, e.g. "/buyer/command-center" */
  route: string;
}

export interface RoleWorkspaceMeta {
  accentText: string;
  accentActive: string;
  accentRing: string;
}

export interface RoleNavigationProps {
  /** Optional sign-out handler rendered in the rail footer. */
  onLogout?: () => void;
}
