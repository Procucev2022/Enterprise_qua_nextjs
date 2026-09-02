/**
 * Centralized UI Strings & Screen Text Constants (i18n Ready)
 * Single source of truth for UI typography, headings, labels, actions, and template messages.
 */

export const UI_STRINGS = {
  appName: 'Procucev Enterprise',
  engineVersion: 'QUA AI 2.0',
  tagline: 'Autonomous Industrial Procurement & Supplier Telemetry Orchestration',

  screens: {
    commandCenter: {
      title: 'Enterprise Procurement Command Center',
      screenTag: 'Screen 1.1',
      subtitle: 'Real-time multi-channel supplier chasing & automated quote evaluation telemetry.',
    },
    ingestionWizard: {
      title: 'Multi-Modal RFQ Ingestion Wizard',
      screenTag: 'Screen 1.2',
      subtitle: 'Parse structured, tabular, and unstructured industrial BOM requirements.',
    },
    rfqSummary: {
      title: 'Buyer RFQ Portfolio Summary',
      screenTag: 'Screen 1.3',
      subtitle: 'Every RFQ raised by this organisation with intake source, sourcing mode and quote progress.',
    },
    quoteMatrix: {
      title: 'Comparative Quote Evaluation Matrix',
      screenTag: 'Screen 1.4',
      subtitle: 'Side-by-side parametric evaluation of line-item vendor bids synthesized by QUA AI.',
    },
    vendorEvaluation: {
      title: 'Vendor Comprehensive Evaluation Summary',
      screenTag: 'Screen 2.3',
      subtitle: 'Comprehensive 6-pillar vendor scorecards with verifiable OCR audit trails.',
    },
    categoryDashboard: {
      title: 'Category Manager Spend & Sourcing Console',
      screenTag: 'Screen 3.1',
      subtitle: 'Spend distribution, mode-allocation metrics, and buyer portfolio governance.',
    },
    infraControl: {
      title: 'Enterprise Infrastructure & Health Control Plane',
      screenTag: 'Screen 4.1',
      subtitle: 'Real-time Azure cloud telemetry, PostgreSQL pool monitoring, and AI inference latency tracking.',
    },
    auditLogs: {
      title: 'Enterprise Audit Trail & Security Ledger',
      screenTag: 'Screen 4.2',
      subtitle: 'Immutable record of system changes, procurement actions, and user activities.',
    },
  },

  actions: {
    backToDashboard: 'Back to Command Center',
    approveAndGeneratePO: '[ APPROVE & GENERATE PO ]',
    exportToExcel: 'Export Comparison Matrix',
    deepDiveTelemetry: 'Deep Dive Telemetry',
    pauseChasing: 'Pause AI Chasing',
    resumeChasing: 'Resume AI Chasing',
    saveChanges: 'Save Configuration',
    retrySync: 'Retry Synchronization',
    submit: 'Submit',
    cancel: 'Cancel',
    confirm: 'Confirm',
    downloadTemplate: 'Download CSV Template',
    hideDetails: 'Hide Details',
    reviewRfqDetails: 'Review RFQ Details',
    reviewVendorPerformance: 'Review Performance',
  },

  badges: {
    aiChasingActive: 'AI Chasing Active',
    aiChasingPaused: 'AI Chasing Paused',
    fullyCompliant: 'Fully Compliant',
    preferredVendor: 'Preferred Vendor (AI Recommended)',
    liveTelemetry: 'Live Telemetry',
    online: 'ONLINE',
    healthy: 'HEALTHY',
    aesEncrypted: 'AES-256-GCM Encrypted',
    aesGcmProtected: 'AES-256 AEAD Protected',
    cryptoVerified: 'Cryptographically Verified',
  },


  navigation: {
    sidebarHeading: 'Workspace Modules',
    navLandmarkLabel: 'Role Workspace Sidebar Navigation',
    openMenu: 'Open Workspace Navigation',
    closeMenu: 'Close Workspace Navigation',
    dismissOverlay: 'Dismiss Navigation Overlay',
    activeModuleIndicator: 'Currently Active Module',
    signOut: 'Sign Out',
    signOutHint: 'Sign Out of Session',
    modulesCountTemplate: '{count} Modules',
    groups: {
      buyerSourcing: 'Sourcing Operations',
      buyerEvaluation: 'Evaluation & Vendors',
      buyerAccount: 'Account & Data',
      categoryOperations: 'Operational Desk',
      categoryConsoles: 'Buyer & Vendor Consoles',
      categoryGovernance: 'Category Governance',
      vendorOpportunities: 'Opportunities & Bids',
      vendorQualification: 'Qualification & Catalogue',
      vendorAccount: 'Subscription & Profile',
      adminPlatform: 'Platform Control Plane',
    },
    items: {
      commandCenter: {
        label: 'Command Center',
        description: 'Live RFQ pipeline & AI chaser telemetry',
      },
      ingestionWizard: {
        label: 'AI Ingestion & Mode Wizard',
        description: 'Parse BOM inputs & pick a sourcing version',
      },
      rfqSummary: {
        label: 'RFQ Summary',
        description: 'Portfolio of every RFQ raised & its quote status',
      },
      buyerEvaluationSummary: {
        label: 'Evaluation Summary',
        description: '6-pillar supplier scorecards with OCR trails',
      },
      vendorDirectory: {
        label: 'Vendor Directory',
        description: 'Empanelled roster & network suppliers',
      },
      sourcingSubscriptions: {
        label: 'Sourcing Subscriptions',
        description: 'Plan quotas & remaining free RFQs',
      },
      buyerProfile: {
        label: 'Buyer Profile',
        description: 'Organisation, tax identity & approvers',
      },
      buyerDbSync: {
        label: 'Buyer DB Sync',
        description: 'Integrated public database reconciliation',
      },
      operationalKanban: {
        label: 'Operational Kanban',
        description: 'Pipeline stages & chasing control board',
      },
      spendAnalytics: {
        label: 'Spend Analytics',
        description: 'Mode performance & spend distribution',
      },
      buyerRfqConsole: {
        label: 'Buyer RFQ Console',
        description: 'Buyer-wise enquiry governance',
      },
      modeEvaluations: {
        label: 'Mode 3 Evaluations',
        description: 'Autonomous sourcing evaluation reports',
      },
      vendorPerformance: {
        label: 'Vendor Performance',
        description: 'Supplier scorecards & bid reliability',
      },
      categoryTrends: {
        label: 'Categories & Trends',
        description: 'Demand-supply taxonomy analytics',
      },
      opportunityFeed: {
        label: 'Opportunity Feed',
        description: 'Matched enquiries open for quoting',
      },
      bidQuotes: {
        label: 'Bid Quotes',
        description: 'Submit & track line-item quotations',
      },
      selfEvaluation: {
        label: '360° AI Self-Evaluation',
        description: 'Capability audit across 6 pillars',
      },
      itemCatalogue: {
        label: 'Item Catalogue',
        description: 'Published SKUs & pricing bands',
      },
      subscriptionPlans: {
        label: 'Subscription Plans',
        description: 'Access tiers, quotas & downloads',
      },
      supplierProfile: {
        label: 'Vendor Profile',
        description: 'Company credentials & banking vault',
      },
      azureInfrastructure: {
        label: 'Azure Infrastructure & AI',
        description: 'Cloud health, pools & inference latency',
      },
      immutableAuditLog: {
        label: 'Immutable Audit Log',
        description: 'SHA-256 chained compliance ledger',
      },
    },
  },

  templates: {
    rfqDispatched: 'RFQ #{rfqNumber} successfully dispatched to {vendorCount} qualified vendors.',
    poGenerated: 'Purchase Order #{poNumber} created and committed to ERP.',
    ratingUpdated: 'Vendor rating for {vendorName} revised to {newScore}/100.',
    welcomeUser: 'Welcome back, {userName} ({userRole})',
    totalSpendSummary: 'Total analyzed spend: ₹{amount} across {categoryCount} categories.',
  },
  /** Buyer RFQ Portfolio Summary (Screen 1.3). */
  /** AI document extraction inside the ingestion wizard (Screen 1.2). */
  rfqExtraction: {
    // Step 1
    noFileTitle: 'No Document Selected',
    noFileMessage: 'Upload a BOQ spreadsheet, PDF or scanned requirement before continuing.',
    extractAction: 'Extract Line Items with AI',
    extractingLabel: 'Reading your document with QUA AI…',
    extractingHint: 'Identifying line items, quantities, units and specifications.',

    // Step 2 outcome banners
    successTitle: 'AI Extraction Complete',
    successSummary:
      '{accepted} line items extracted by {model}. {needsReview} need a category review before dispatch.',
    successToast: '{accepted} line items extracted from {fileName}.',
    fallbackTitle: 'Line Items Could Not Be Read',
    fallbackHint: 'Add each line item below, assign its minor category, then continue to sourcing.',
    unreadableResponse:
      'The extraction service returned an unexpected response. Add the line items manually to continue.',

    // Step 2 empty state
    emptyTitle: 'No Line Items Yet',
    emptyMessage: 'Add at least one line item so vendors have something to quote against.',
    addFirstItemAction: 'Add First Line Item',
    incompleteItemsTitle: 'Line Items Incomplete',
    incompleteItemsMessage: 'Give every line item a description before choosing a sourcing mode.',

    // Step 2 RFQ header fields
    budgetLabel: 'Estimated Budget ({symbol})',
    budgetFromDocumentHint: 'Read from {fileName}. Edit it if the document under-states the true value.',
    budgetMissingHint: 'No value was stated in the document. Enter your estimated budget before saving.',
    budgetRequiredTitle: 'Estimated Budget Required',
    budgetRequiredMessage:
      'Enter an estimated budget above zero. Vendors are ranked against it, so the RFQ cannot be saved without one.',

    /**
     * Step strip. Rendered in order, and a step only becomes reachable once the
     * one before it has produced what the next step needs.
     */
    steps: [
      {
        number: 1,
        label: 'STEP 1: INGESTION',
        tag: 'Portal / Email',
        hint: 'BOQ file or Email Gateway',
      },
      {
        number: 2,
        label: 'STEP 2: MINOR CATEGORIZATION',
        tag: 'Taxonomy Mapping',
        hint: 'Classify into 280+ Minor Categories',
      },
      {
        number: 3,
        label: 'STEP 3: SOURCING MODE',
        tag: 'Mode Selection',
        hint: 'Choose how this RFQ reaches suppliers',
      },
    ],

    // Step 2 taxonomy re-classification
    classifyAction: 'AI Auto-Categorize All',
    classifyingLabel: 'Re-categorizing line items…',
    classifyEmptyTitle: 'Nothing to Categorize',
    classifyEmptyMessage: 'Add at least one line item with a description first.',
    classifySuccessTitle: 'Minor Categories Updated',
    classifySuccessMessage:
      '{accepted} line items re-categorized against the shared taxonomy. {needsReview} could not be matched and kept the default category.',
    classifyFailed:
      'Categories could not be refreshed just now. Set the major and minor category on each line item manually, or try again.',

    // Step strip gating
    stepLockedTitle: 'Finish the Current Step First',
    stepLockedExtractMessage: 'Upload a document and extract its line items before opening the review step.',
    stepLockedReviewMessage: 'Review the line items and give each one a description before choosing a sourcing mode.',
    stepLockedHint: 'Complete the previous step',

    // Step 3 vendor placeholder
    vendorComingSoonTitle: 'Vendor Matching & Dispatch — Coming Soon',
    vendorComingSoonMessage:
      'Supplier matching, the Mode 3 anonymous pool and standard RFQ email dispatch are being rebuilt on the new sourcing engine. For now your RFQ is saved with the sourcing mode you select here, and vendors can be attached once matching goes live.',
    vendorComingSoonBadge: 'In Development',
    dispatchAction: 'Save RFQ with Selected Sourcing Mode',
    dispatchSummary: '{rfqNumber} — {itemCount} categorised line items will be saved under {modeCode}.',
  },

  rfqSummary: {
    createRFQAction: 'Create New RFQ',

    // KPI strip
    kpiTotalRFQs: 'Total RFQs Raised',
    kpiTotalRFQsHint: '{activeCount} still chasing vendors',
    kpiAwaitingQuotes: 'Awaiting First Quote',
    kpiAwaitingQuotesHint: '{quoteCount} quotations received in total',
    kpiPortfolioValue: 'Portfolio Value',
    kpiPortfolioValueHint: 'Averaging {average} quotes per RFQ',
    kpiVendorsEngaged: 'Vendors Invited',
    kpiVendorsEngagedHint: '{responded} have responded so far',

    // Sourcing mode distribution
    modeDistributionTitle: 'Sourcing Mode Distribution',
    modeSharePercent: '{modeCode}: {share}% of portfolio',

    // Filters
    searchLabel: 'Search Portfolio',
    searchPlaceholder: 'RFQ number, title, category or line item…',
    statusFilterLabel: 'Status',
    modeFilterLabel: 'Sourcing Mode',
    sourceFilterLabel: 'Intake Source',
    allStatuses: 'All Statuses',
    allModes: 'All Modes',
    allSources: 'All Sources',
    resultCount: 'Showing {shown} of {total} RFQs',

    // Intake source badges
    sourceEmailGateway: 'Email Gateway',
    sourceEmailUpload: 'Email File Upload',
    sourceManualEntry: 'Manual Web Entry',
    sourceWebPortal: 'Web App Portal',

    // Table
    tableCaption: 'RFQ portfolio with sourcing mode, status, quote counts and delivery dates',
    colRfqNumber: 'RFQ Number',
    colTitle: 'Title & Category',
    colMode: 'Mode',
    colStatus: 'Status',
    colItems: 'Items',
    colQuotes: 'Quotes',
    colBudget: 'Budget',
    colDelivery: 'Target Delivery',
    colActions: 'Actions',
    chasingActive: 'Chasers running',
    deliveryDateUnset: 'Not set',
    ofInvited: 'of {invited} invited',
    followUpsAction: 'Follow-ups',
    quotesAction: 'Quotes',
    viewFollowUpsAria: 'View multi-channel follow-up detail for {rfqNumber}',
    viewQuotesAria: 'Open the comparative quote matrix for {rfqNumber}',

    // Empty & no-match states
    emptyPortfolioTitle: 'No RFQs raised yet',
    emptyPortfolioMessage:
      'Ingest a BOQ spreadsheet, forward a requisition email, or enter line items manually to raise your first RFQ.',
    noMatchesMessage: 'No RFQs match the current search and filter combination.',
    noQuotesYetTitle: 'No Quotes Received Yet',
    noQuotesYetMessage:
      'Vendors have not submitted quotations against {rfqNumber} yet. Chasers are still running, so check back shortly.',

    // Pagination
    rowsPerPageLabel: 'Rows per page',
    pageRange: 'Showing {from}–{to} of {total}',
    pageIndicator: 'Page {current} of {total}',
    previousPageAria: 'Go to the previous page of RFQs',
    nextPageAria: 'Go to the next page of RFQs',
  },

  auth: {
    // Titles used by the sign-in / registration toasts
    signInFailedTitle: 'Sign In Failed',
    registrationFailedTitle: 'Registration Failed',
    otpRequestFailedTitle: 'OTP Request Failed',
    otpInvalidTitle: 'Invalid OTP',
    missingFieldsTitle: 'Missing Fields',
    loggedOutTitle: 'Logged Out',
    welcomeBackTitle: 'Welcome Back',
    registrationSuccessTitle: 'Registration Successful',

    // Field-level validation
    emailRequired: 'Enter your registered email address to continue.',
    passwordRequired: 'Enter your account password to continue.',
    emailAndPasswordRequired: 'Enter both your registered email address and password to continue.',
    loginFieldsRequired:
      'Enter your registered email address, registered mobile number and password to continue.',
    emailInvalid: 'Enter a valid email address, for example you@company.com.',
    otpRequired: 'Enter the 6-digit verification code that was emailed to you.',
    emailAndMobileRequired:
      'Enter both your registered email address and mobile number. The code is issued against the pair.',
    registrationFieldsRequired:
      'Full name, company email, mobile number and password are all required to create an account.',
    passwordTooShort: 'Choose a password of at least 8 characters.',
    mobileInvalid: 'Enter a valid 10-digit Indian mobile number, for example 9876543210.',

    // Network / backend reachability. These replace the previous behaviour of
    // silently fabricating a valid session when the API could not be reached.
    networkUnreachable:
      'Cannot reach the Procucev API, so your credentials could not be verified. Check that the backend is running on the configured port and that you are online, then try again.',
    serverErrorFallback:
      'The server rejected the request but did not explain why. Please retry, and contact support if it persists.',

    // Success / informational
    signedInAs: 'Signed in as {userName} ({userRole}) — {orgName}.',
    otpDispatched:
      'A {codeLength}-digit verification code has been emailed to {email}. It expires in {expiryMinutes} minutes.',
    loggedOutMessage: 'Successfully signed out of the secure workspace.',
    redirecting: 'Redirecting to your workspace…',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    registrationSuccessMessage:
      'Account created for {email}. You are signed in and can start configuring your workspace.',
  },
};

/**
 * Format string template with runtime parameter placeholders
 * Example: formatString('Hello {name}, you have {count} messages', { name: 'Alex', count: 3 })
 */
export function formatString(template: string, values?: Record<string, string | number>): string {
  if (!template) return '';
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return values[key] !== undefined ? String(values[key]) : match;
  });
}
