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
  followUpData?: RFQFollowUpBreakdown;
}

export interface AIBotFeedItem {
  id: string;
  timestamp: string;
  timeAgo: string;
  type: 'call' | 'whatsapp' | 'sms' | 'email' | 'scoring' | 'ingestion' | 'escalation' | 'approval' | 'system';
  channel?: 'call' | 'whatsapp' | 'sms' | 'email' | 'system';
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
