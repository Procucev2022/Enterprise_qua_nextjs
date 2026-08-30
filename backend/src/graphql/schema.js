const { buildSchema } = require('graphql');

/**
 * Enterprise GraphQL Schema Definition for Procucev Enterprise Sourcing & Procurement Platform
 */
const schema = buildSchema(`
  scalar JSON

  type BuyerAccount {
    id: String!
    organizationName: String!
    corporateEmail: String!
    contactPerson: String!
    mobileNumber: String
    industrySector: String
    accountSource: String
    subscriptionPlan: String
    totalRFQsCreated: Int
    totalSpend: String
    isVerified: Boolean
    createdDate: String
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
    majorCategory: String
    minorCategories: [String]
    location: String
    rating: Float
    score: Float
    source: String
    status: String
    evaluated: Boolean
    hasRecord: Boolean
    whatsappSla: Int
    awardedSpend: Float
    leadTimeDays: Int
    empanelledBy: String
    isEmpanelled: Boolean
    categoryCount: Int
    clientMappedCategories: [String]
    vendorSelectedCategories: [String]
  }

  type LineItem {
    id: String
    itemDescription: String
    quantity: Float
    uom: String
    targetPrice: Float
    targetSpend: Float
    historicalPrice: Float
    potentialSaving: Float
  }

  type Quote {
    id: String
    vendorId: String
    vendorName: String
    quoteAmount: Float
    unitPrice: Float
    deliveryDays: Int
    score: Float
    rank: Int
    evaluatedStatus: String
    savingsPct: Float
  }

  type RFQ {
    id: String!
    rfqNumber: String!
    title: String!
    category: String!
    sourcingMode: String
    buyerCompany: String
    buyerContact: String
    buyerEmail: String
    createdDate: String
    deadline: String
    budget: Float
    status: String
    quotesCount: Int
    targetSavings: String
    isDoubleBlind: Boolean
    source: String
    allocatedTime: String
    elapsedTime: String
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
    multiChannelOutreach: Boolean
    autoChaseSlaMinutes: Int
    aiModel: String
    azureEndpointConfigured: Boolean
  }

  type DBHealthStatus {
    isConfigured: Boolean
    isConnected: Boolean
    provider: String
    providerLabel: String
    latencyMs: Int
    tablesCount: Int
    errorMessage: String
  }

  type CacheMetrics {
    activeEntries: Int
    hits: Int
    misses: Int
    totalQueriesProcessed: Int
    cacheHitRatio: String
    estimatedComputeMsSaved: Int
    estimatedComputeHoursSaved: Float
  }

  type QueryAuditReport {
    totalQueriesExecuted: Int
    totalExecutionTimeMs: Int
    averageQueryDurationMs: Float
    slowQueryThresholdMs: Int
    slowQueriesCount: Int
  }

  type ComputeOptimizationMetrics {
    cache: CacheMetrics
    auditing: QueryAuditReport
    timestamp: String
  }

  type PurgeReport {
    success: Boolean
    purgedMemoryCount: Int
    diskFilesPurged: Int
    retentionCutoff: String
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
  }
`);

module.exports = schema;
