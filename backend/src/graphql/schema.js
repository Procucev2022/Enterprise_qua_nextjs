const { buildSchema } = require('graphql');

/**
 * Enterprise GraphQL Schema Definition
 */
const schema = buildSchema(`
  type BuyerAccount {
    id: String!
    organizationName: String!
    corporateEmail: String!
    contactPerson: String
    mobileNumber: String
    industrySector: String
    accountSource: String
    subscriptionPlan: String
    totalRFQsCreated: Int
    totalSpend: Float
    isVerified: Boolean
    createdDate: String
    syncTimestamp: String
    sourcingMode: String
    status: String
    gstin: String
    primaryPlantLocation: String
    supportedMajorCategories: [String]
    supportedMinorCategories: [String]
    remainingFreeRFQs: Int
  }

  type Vendor {
    id: String!
    name: String!
    contactPerson: String
    email: String!
    phone: String
    majorCategory: String!
    minorCategories: [String]
    location: String
    rating: Float
    score: Float
    source: String
    status: String
    evaluated: Boolean
    hasRecord: Boolean
    isExistingInDatabase: Boolean
    onboardingEmailStatus: String
    clientMappedCategories: [String]
    vendorSelectedCategories: [String]
  }

  type LineItem {
    id: String!
    sku: String
    description: String!
    quantity: Int!
    unitPrice: Float
    totalPrice: Float
    specifications: String
  }

  type Quote {
    id: String!
    vendorId: String!
    vendorName: String!
    totalPrice: Float!
    unitPrice: Float
    leadTimeDays: Int
    status: String
    submittedAt: String
  }

  type RFQ {
    id: String!
    rfqNumber: String!
    title: String!
    category: String!
    createdAt: String!
    deadline: String
    status: String!
    sourcingMode: String!
    quotesCount: Int
    chasingActive: Boolean
    buyerCompany: String
    buyerEmail: String
    budget: Float
    targetSavings: String
    lineItems: [LineItem]
    quotes: [Quote]
    assignedVendors: [Vendor]
    tags: [String]
    poNumber: String
    poAmount: Float
    poAwardedTo: String
    poAwardDate: String
    poStatus: String
    poApproverNotes: String
  }

  type VendorEvaluation {
    id: String!
    vendorName: String!
    overallScore: Float
    status: String
    submissionDate: String
    auditHash: String
  }

  type AuditLogEntry {
    id: String!
    timestamp: String!
    userEmail: String!
    action: String!
    rfqNumber: String
    ipAddress: String
    shaSignature: String
    previousSha: String
    verified: Boolean
  }

  type CatalogueProduct {
    id: String!
    name: String!
    sku: String!
    category: String!
    minorCategory: String
    unitPrice: Float!
    stockQuantity: Int!
    unitOfMeasure: String!
    supplierId: String
    supplierName: String
    leadTimeDays: Int
    rating: Float
  }

  type AIBotFeedItem {
    id: String!
    timestamp: String!
    timeAgo: String
    agent: String
    action: String
    target: String
    detail: String
    status: String
    metric: String
  }

  type SystemConfig {
    maintenanceMode: Boolean
    strictSecurityMode: Boolean
    allowDirectNegotiations: Boolean
    require2FAForPO: Boolean
    autoApproveVendorUnderBudget: Boolean
    aiAutonomousChasing: Boolean
    auditLogRetentionDays: Int
    maxSimultaneousMode2Events: Int
    activeMode: String
    chaserIntervalSeconds: Int
    aiModel: String
    aiTemperature: Float
    identityDbSyncInterval: Int
  }

  """
  Health of the PostgreSQL database, which backs authentication and every domain
  record. Counts come from one round trip, so they are consistent with each other.
  """
  type DBHealthStatus {
    isConfigured: Boolean!
    isConnected: Boolean!
    provider: String!
    providerLabel: String!
    poolStatus: String!
    database: String
    userCount: Int
    vendorCount: Int
    rfqCount: Int
    latencyMs: Int
    errorMessage: String
    timestamp: String
  }

  type QueryCacheMetrics {
    activeEntries: Int
    maxEntries: Int
    hits: Int
    misses: Int
    totalQueriesProcessed: Int
    cacheHitRatio: String
    cacheHitRatioNumber: Float
    invalidations: Int
    estimatedComputeMsSaved: Float
    estimatedComputeHoursSaved: Float
  }

  type QueryAuditReport {
    totalQueriesExecuted: Int
    totalExecutionTimeMs: Float
    averageQueryDurationMs: Float
    slowQueryThresholdMs: Int
    slowQueriesCount: Int
  }

  type ComputeOptimizationMetrics {
    cache: QueryCacheMetrics
    auditing: QueryAuditReport
    pool: DBHealthStatus
    activeComputeSavingStrategy: String
    timestamp: String
  }

  type PurgeReport {
    success: Boolean
    purgedMemoryCount: Int
    diskFilesPurged: Int
    retentionCutoff: String
  }

  type DiagnosedIssue {
    issueId: String!
    issueType: String!
    category: String!
    severity: String!
    suggestedAction: String!
    count: Int!
    firstSeen: String
    lastSeen: String
    sampleMessage: String
  }

  type RemediationResult {
    remediationId: String!
    actionType: String!
    message: String!
    timestamp: String!
    durationMs: Int
  }

  type AutoResolveReport {
    diagnosedCount: Int!
    issues: [DiagnosedIssue]
    remediationsApplied: [RemediationResult]
  }

  type PerformanceAuditReport {
    timestamp: String!
    healthScore: Int!
    grade: String!
    recommendations: [String]
  }

  type PerformanceOptimizationResult {
    optimizationId: String!
    level: String!
    durationMs: Int!
    timestamp: String!
    beforeScore: Int!
    status: String!
    actionsApplied: [String]
  }

  type CryptoEngineStatus {
    status: String!
    algorithm: String!
    keyLengthBits: Int!
    ivLengthBytes: Int!
    authTagLengthBytes: Int!
    iterations: Int!
    roundtripVerified: Boolean!
    tamperDetectionVerified: Boolean!
    timestamp: String!
  }

  type EncryptedPayloadResult {
    ciphertext: String!
    iv: String!
    authTag: String!
    salt: String
    algorithm: String!
    version: String!
    encoded: String
  }

  type DecryptedPayloadResult {
    plaintext: String!
  }

  input EncryptDataInput {
    plaintext: String!
    secretKey: String
    additionalData: String
    encoding: String
  }

  input DecryptDataInput {
    token: String
    ciphertext: String
    iv: String
    authTag: String
    salt: String
    secretKey: String
    additionalData: String
    encoding: String
  }

  input CreateRFQInput {
    title: String!
    category: String!
    sourcingMode: String
    buyerCompany: String
    buyerEmail: String
    budget: Float
    deadline: String
    targetSavings: String
  }

  input UpdateRFQInput {
    title: String
    status: String
    budget: Float
    deadline: String
    targetSavings: String
  }

  input CreateVendorInput {
    name: String!
    email: String!
    phone: String
    majorCategory: String!
    location: String
    rating: Float
    score: Float
  }

  input UpdateVendorInput {
    name: String
    phone: String
    location: String
    rating: Float
    score: Float
    status: String
  }

  input CreateBuyerAccountInput {
    organizationName: String!
    corporateEmail: String!
    contactPerson: String!
    mobileNumber: String
    industrySector: String
    sourcingMode: String
  }

  type Query {
    rfqs(category: String, sourcingMode: String, status: String, limit: Int, offset: Int): [RFQ]
    rfq(id: String, rfqNumber: String): RFQ
    vendors(majorCategory: String, source: String, search: String, limit: Int, offset: Int): [Vendor]
    vendor(id: String, email: String): Vendor
    buyerAccounts(limit: Int): [BuyerAccount]
    activeBuyerAccount: BuyerAccount
    evaluations(vendorName: String): [VendorEvaluation]
    auditLogs(limit: Int, search: String): [AuditLogEntry]
    catalogue(category: String, search: String): [CatalogueProduct]
    aiFeed(limit: Int): [AIBotFeedItem]
    systemConfig: SystemConfig
    dbHealth: DBHealthStatus
    optimizationMetrics: ComputeOptimizationMetrics
    diagnoseLogErrors: [DiagnosedIssue]
    auditPerformance: PerformanceAuditReport
    cryptoStatus: CryptoEngineStatus
    decryptData(input: DecryptDataInput!): DecryptedPayloadResult
  }

  type Mutation {
    createRFQ(input: CreateRFQInput!): RFQ
    updateRFQ(id: String!, input: UpdateRFQInput!): RFQ
    createVendor(input: CreateVendorInput!): Vendor
    updateVendor(id: String!, input: UpdateVendorInput!): Vendor
    deleteVendor(id: String!): Boolean
    createBuyerAccount(input: CreateBuyerAccountInput!): BuyerAccount
    clearQueryCache: Boolean
    purgeLogs(maxAgeDays: Int): PurgeReport
    autoResolveLogErrors(action: String): AutoResolveReport
    optimizePerformance(level: String): PerformanceOptimizationResult
    encryptData(input: EncryptDataInput!): EncryptedPayloadResult
  }
`);


module.exports = schema;
