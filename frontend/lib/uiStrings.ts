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
      title: 'Buyer Dashboard',
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
        label: 'Dashboard',
        description: 'Live RFQ pipeline & AI chaser telemetry',
      },
      ingestionWizard: {
        label: 'AI RFQ Create',
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
    /**
     * Shown for a transport failure rather than a model failure. A dev-proxy error
     * or a stopped API answers with HTML, and reporting `unreadableResponse` for
     * that blamed the AI for what was actually an unreachable backend.
     */
    apiUnavailable:
      'The RFQ service is not responding (HTTP {status}), so the document could not be sent for extraction. It may be restarting — wait a moment and retry. You can add the line items manually to carry on in the meantime.',

    // Step 2 line-item table placeholders. A row added by hand starts completely
    // blank, so each field states what belongs in it.
    itemNamePlaceholder: 'Item name, with any size or model that identifies it',
    itemSpecsPlaceholder: 'Material grade, standard, class or rating',
    itemQtyPlaceholder: 'Qty',
    itemUnitPlaceholder: 'e.g. Nos',
    categoryPlaceholder: 'Select major category',
    minorCategoryPlaceholder: 'Select minor category',
    confidenceUnset: '—',

    // Step 2 empty state
    emptyTitle: 'No Line Items Yet',
    emptyMessage: 'Add at least one line item so vendors have something to quote against.',
    addFirstItemAction: 'Add First Line Item',
    incompleteItemsTitle: 'Line Items Incomplete',
    incompleteItemsMessage:
      'Every line item needs a description, a quantity above zero, a unit and both categories before you can choose a sourcing mode. Vendors quote against these, so a blank field cannot be dispatched.',

    // Step 2 RFQ header fields
    budgetLabel: 'Estimated Budget ({symbol})',
    budgetOptionalTag: 'Optional',
    budgetFromDocumentHint: 'Read from {fileName}. Edit it if the document under-states the true value.',
    budgetMissingHint: 'Optional. Leave it at zero if you would rather not publish a ceiling to vendors.',
    /**
     * Delivery destination. Both fields are mandatory: vendors price freight
     * against the location and the pincode, so a quote raised without them
     * cannot be compared against one that has them.
     */
    /**
     * Decorative marker only. It is rendered aria-hidden because the inputs carry
     * aria-required, which is what a screen reader announces; showing the glyph to
     * assistive tech as well would just read out a stray asterisk.
     */
    deliveryRequiredMarker: '*',
    deliveryLocationLabel: 'Delivery Location',
    deliveryLocationPlaceholder: 'Plant, warehouse or site address',
    deliveryLocationRequiredMessage:
      'Enter the delivery location. Vendors price freight against it, so it cannot be left blank.',
    deliveryLocationSchemaMessage: 'Delivery location is required and must be 3 to 200 characters.',
    deliveryPincodeLabel: 'Pincode / Zipcode',
    deliveryPincodePlaceholder: 'e.g. 400701',
    deliveryPincodeRequiredMessage:
      'Enter the delivery pincode or zipcode. Freight is rated on it, so it cannot be left blank.',
    deliveryPincodeInvalidTitle: 'Check the Delivery Details',
    deliveryPincodeInvalidMessage:
      'Enter a pincode or zipcode of 3 to 10 letters, digits, spaces or hyphens, for example 400701.',
    deliveryIncompleteTitle: 'Delivery Details Needed',
    deliveryIncompleteMessage:
      'Add the delivery location and a valid pincode or zipcode before choosing a sourcing mode. Vendors quote freight against both.',

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
    stepLockedReviewMessage:
      'Review the line items, give each one a description, and fill in the delivery location and pincode before choosing a sourcing mode.',
    stepLockedHint: 'Complete the previous step',

    // Step 1 manual intake
    manualMethodLabel: 'Manual RFQ Entry',
    manualStartAction: 'Continue to Line Items',
    manualHint: 'You will add each line item and its minor category in Step 2.',
    manualBannerTitle: 'Manual Entry',
    manualBannerMessage: 'These line items were keyed by hand, so no AI confidence is reported against them.',

    // Step 1 manual attachments. Stored and shown back verbatim; never extracted.
    attachTitle: 'Supporting Documents',
    attachMessage:
      'Attach a drawing, specification sheet or indent form to the RFQ. These are stored with the RFQ for reference and are not read by AI — you key the line items yourself on the next step.',
    attachAction: 'Choose Files',
    attachingLabel: 'Attaching…',
    attachedHeading: 'Attached ({count})',
    attachRemoveAria: 'Remove {fileName} from this RFQ',
    attachFailedTitle: 'Document Not Attached',
    attachLimitTitle: 'Attachment Limit Reached',
    attachLimitMessage: 'An RFQ can carry up to {max} supporting documents. Remove one before adding another.',
    attachUnreachable:
      'The document could not be uploaded because the RFQ service did not respond. Try again in a moment.',

    // Step 3 vendor placeholder
    vendorComingSoonTitle: 'Vendor Matching & Dispatch — Coming Soon',
    vendorComingSoonMessage:
      'Supplier matching, the Mode 3 anonymous pool and standard RFQ email dispatch are being rebuilt on the new sourcing engine. For now your RFQ is saved with the sourcing mode you select here, and vendors can be attached once matching goes live.',
    vendorComingSoonBadge: 'In Development',
    dispatchAction: 'Save RFQ with Selected Sourcing Mode',
    dispatchSummary: '{rfqNumber} — {itemCount} categorised line items will be saved under {modeCode}.',
  },

  /** Buyer RFQ Details (Screen 1.4) — everything submitted for one RFQ. */
  rfqDetails: {
    backAction: 'Back to RFQ Portfolio',
    notFoundTitle: 'RFQ Not Found',
    notFoundMessage:
      'This RFQ is no longer in your portfolio. It may have been raised in a previous session before the records were reloaded.',

    // Provenance strip
    documentTypeBadge: 'Request for Quotation (RFQ)',
    auditImmutable: 'Audit Immutable',
    raisedOnStrip: 'Raised {timestamp}',

    // Header & submission provenance
    submittedHeading: 'Submission Detail',
    sourceLabel: 'Intake Source',
    sourceFileLabel: 'Source Document',
    sourceEmailLabel: 'Source Email',
    createdLabel: 'Raised On',
    referenceLabel: 'Record ID',

    // Commercial & logistics
    commercialHeading: 'Commercial & Delivery',
    categoryLabel: 'Major Category',
    budgetLabel: 'Estimated Budget',
    targetDateLabel: 'Target Delivery',
    statusLabel: 'Current Status',
    deliveryLocationLabel: 'Delivery Location',
    deliveryPincodeLabel: 'PIN: {pincode}',
    unsetValue: 'Not provided',
    daysRemaining: '{days} days remaining',
    dueToday: 'Due today',
    overdueBy: 'Overdue by {days} days',

    // Line items
    lineItemsHeading: 'Line Items',
    lineItemsSubtitle: 'Package requirement specification',
    lineItemSearchPlaceholder: 'Search line items…',
    lineItemSearchAria: 'Search the line items of this RFQ',
    allMinorCategories: 'All Minor Categories',
    minorFilterAria: 'Filter line items by minor category',
    exportCsvAction: 'Export CSV',
    exportCsvAria: 'Download the line items of {rfqNumber} as CSV',
    colItem: 'Item Description',
    colSpecs: 'Technical Specification',
    colMajor: 'Major Category',
    colMinor: 'Minor Category',
    colQty: 'Qty',
    colUnit: 'Unit',
    colTargetDate: 'Required By',
    colConfidence: 'Confidence',
    noLineItems: 'No line items were recorded against this RFQ.',
    noLineItemMatches: 'No line items match the current search and filter.',
    manualConfidence: 'Keyed manually',
    confidenceHigh: '{confidence}% High Confidence',
    confidenceReview: '{confidence}% Needs Review',
    displayingCount: 'Displaying {shown} of {total} line items',
    parsedSuccessfully: '{percent}% classified automatically',

    // Quotes
    quotesHeading: 'Vendor Quotations',
    quotesTabAll: 'All Quotes ({count})',
    quotesTabUnderReview: 'Under Review ({count})',
    quotesTabShortlisted: 'Shortlisted ({count})',
    colVendor: 'Vendor',
    colUnitPrice: 'Unit Price',
    colTotalPrice: 'Total',
    colLeadTime: 'Lead Time',
    colMatchScore: 'AI Match',
    colCompliance: 'Compliance',
    leadTimeDays: '{days} days',
    noQuotes: 'No vendor quotations have been received yet.',
    noQuotesMessage:
      'Vendor matching and standard RFQ email dispatch are being rebuilt on the new sourcing engine, so this RFQ has not yet been circulated. Quotations will appear here once it goes live.',
    noQuotesTabMessage: 'No quotations are in this state yet.',

    // Attachments
    attachmentsHeading: 'Supporting Documents',
    attachmentViewAction: 'View',
    attachmentViewAria: 'Open {fileName} in a new tab',
    attachmentUploadedOn: 'Attached {date}',
    noAttachments: 'No supporting documents were attached to this RFQ.',

    // Follow-ups
    followUpsHeading: 'Multi-Channel Follow-Ups',
    followUpsTag: 'Outreach Analytics',
    invitedLabel: 'Vendors Invited',
    respondedLabel: 'Vendors Responded',
    callsLabel: 'Calls Connected',
    whatsappLabel: 'WhatsApp Read',
    smsLabel: 'SMS Delivered',
    awaitingTrigger: 'Awaiting initial trigger',
    noFollowUps: 'Vendor matching and dispatch are still to come for this RFQ, so there is nothing to chase yet.',
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
    budgetUnset: 'Not set',
    detailsAction: 'View Details',
    viewDetailsAria: 'View the full submitted detail for {rfqNumber}',
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

  buyerProfile: {
    // Toast titles
    loadFailedTitle: 'Profile Could Not Be Loaded',
    validationErrorTitle: 'Validation Error',
    saveFailedTitle: 'Profile Not Saved',
    savedTitle: 'Profile Saved Successfully',
    limitReachedTitle: 'Category Limit Reached',

    // Success
    savedMessage: 'Organization details and {categoryCount} procurement categories updated.',

    // Load / save failures. Each one says what state the record is in, so the
    // buyer knows whether their edits survived.
    loadUnreachable:
      'Cannot reach the Procucev API, so your organization profile could not be loaded. Check that the backend is running and that you are online, then reload this page.',
    loadRejected:
      'Your organization profile could not be loaded: {reason} Nothing has been changed.',
    saveUnreachable:
      'Cannot reach the Procucev API, so your changes were not saved. Your edits are still on screen — check your connection and press Save again.',
    saveRejected: 'Your changes were not saved: {reason}',
    sessionExpired:
      'Your session has expired, so the profile could not be saved. Sign in again and re-apply your changes.',
    notPermitted:
      'Your account role is not permitted to manage a buyer organization profile. Switch to a buyer account or contact your Procucev administrator.',
    serverErrorFallback:
      'The server rejected the request but did not explain why. Please retry, and contact support if it persists.',

    // Field-level validation, surfaced through the existing toast so no new UI
    // is introduced.
    companyNameRequired: 'Legal Entity Name is required before the profile can be saved.',
    panInvalid: 'PAN must be 10 characters in the format AAAAA9999A, for example AAACL1234F.',
    gstInvalid: 'GSTIN must be 15 characters in the format 99AAAAA9999A9Z9, for example 27AAACL1234F1Z5.',
    cinInvalid:
      'CIN must be 21 characters in the format L99999AA9999AAA999999, for example L28920MH1946PLC004768.',
    websiteInvalid:
      'Corporate Website must be a full URL beginning http:// or https://, for example https://example.com.',
    pincodeInvalid: 'PIN Code must be 6 digits and cannot start with 0, for example 400001.',
    categoriesRequired:
      'Select at least one minor procurement category so RFQs can be matched to vendors.',

    // Cardinality caps
    maxMajorReached:
      'You can select at most {max} major procurement categories. Clear one before adding another.',
    maxMinorReached:
      'You have selected {count} of {max} minor procurement categories. Clear one before adding another.',
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
