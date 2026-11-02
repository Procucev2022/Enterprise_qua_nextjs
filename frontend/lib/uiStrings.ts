/**
 * Centralized UI Strings & Screen Text Constants (i18n Ready)
 * Single source of truth for UI typography, headings, labels, actions, and template messages.
 */

import type { RFQExtractionReason } from './types';

export const UI_STRINGS = {
  appName: 'Procucev Enterprise',
  engineVersion: 'QUA AI 2.0',
  tagline: 'Autonomous Industrial Procurement & Supplier Telemetry Orchestration',

  buyerDirectory: {
    title: 'Buyers Directory',
    searchPlaceholder: 'Search company, contact person, email, city...',
    allSourcingModes: 'All Sourcing Modes',
    allStatuses: 'All Statuses',
    pendingVerification: 'Pending Verification',
    activeVerified: 'Active & Verified',
    allSources: 'All Sources',
    sourceWebApp: 'Web App',
    sourceWhatsApp: 'WhatsApp',
    sourceEmail: 'Email',
    exportDirectory: 'Export Directory',
    totalBuyers: 'Total Buyers',
    subscriptionBuyers: 'Subscription Buyers',
    totalRfqs: 'Total RFQs',
    freeRfqs: 'Free RFQs',
    paidRfqs: 'Paid RFQs',
    acrossAllEnterprise: 'Across all enterprise accounts',
    activeVerifiedSubtext: '{count} Active Verified',
    freeTrialSubtext: '{count} Free Trial',
    trialPromotionalSubtext: 'Trial & promotional credits',
    paidSubscriptionSubtext: 'Subscription & enterprise',
    columnSettingsTitle: 'Column Settings',
    columnSettingsSubtitle: 'Customize column visibility and order',
    resetDefault: 'Reset to Default',
    noBuyersFound: 'No buyer accounts found matching your query.',
    dossierAction: '360° Dossier',
    dossier: {
      profileTab: 'Profile',
      rfqsTab: 'RFQs',
      creditTab: 'Credit',
      communicationsTab: 'Communications',
      paymentsTab: 'Payments',
      addCredit: 'Add Credit',
      registered: 'Registered: {date}',
      closeDossier: 'Close Dossier',
      consoleTitle: 'Category Manager Operations Console',
      editCategories: 'Edit',
      supportedMajorCategories: 'Supported Major Categories',
      corporateContact: 'Corporate Contact',
      statutoryGovernance: 'Statutory & Governance',
      saveCategories: 'Save Categories',
      addCustomCategory: 'Add Category',
      subTabs: {
        email: 'Email',
        sms: 'SMS',
        whatsapp: 'WhatsApp',
        callLogs: 'Call Logs',
      },
      compose: {
        title: 'Record Communication & Activity',
        subtitle: 'Record Call Log, Email, SMS, or WhatsApp communication with automated internal task tracking.',
        sendBtn: 'Save & Synchronize Tasks',
        cancelBtn: 'Cancel',
        channelLabel: 'Communication Channel',
        subjectLabel: 'Subject / Summary',
        subjectPlaceholder: 'Brief summary of the exchange (e.g. Price clarification)',
        messageLabel: 'Message Content / Discussion Notes',
        messagePlaceholder: 'Key details, buyer requirements, and agreed action items...',
        recipientLabel: 'Recipient Contact',
        recipientPlaceholder: 'Recipient email or phone number',
        callOutcomeLabel: 'Call Outcome / Disposition',
        callDurationLabel: 'Call Duration',
        callDurationPlaceholder: 'e.g. 10 mins or 00:10:00',
        nextFollowupLabel: 'Next Follow-up Date (Optional)',
        followupPriorityLabel: 'Follow-up Priority',
        followupAssigneeLabel: 'Assign Follow-up To',
        followupNotesLabel: 'Follow-up Objective / Remarks',
        followupNotesPlaceholder: 'Action items for next scheduled interaction...',
        successToast: 'Communication recorded, completed task created, and follow-up scheduled.',
        errorToast: 'Failed to record communication.',
      },
      credit: {
        totalAllocated: 'Total Credits Allocated',
        totalConsumed: 'Total Credits Consumed',
        remainingFree: 'Remaining Free Credits',
        purchased: 'Purchased Credits',
        adjusted: 'Adjusted Credits',
        entitlementMode: 'Entitlement Mode',
        subscriptionPlan: 'Current Subscription Plan',
        addCreditTitle: 'Allocate Buyer Credits',
        addCreditSubtitle: 'Allocate additional RFQ sourcing credits directly to buyer account.',
        creditAmount: 'Credit Amount',
        reason: 'Reason / Remarks',
        confirmAddCredit: 'Confirm Credit Allocation',
      },
      payments: {
        totalPaid: 'Total Amount Paid',
        successful: 'Total Successful Payments',
        pending: 'Pending Payments',
        failed: 'Failed Payments',
        refunded: 'Total Refunded Amount',
        invoiceRef: 'Invoice / Reference',
        description: 'Description',
        amount: 'Amount',
        gatewayChannel: 'Gateway / Channel',
        status: 'Status',
        details: 'Payment Details',
      },
      rfqModal: {
        rfqDetails: 'RFQ Details',
        viewFullDetails: 'View Full Details',
        itemsTable: 'Line Items & Technical Specifications',
        assignedVendors: 'Assigned Vendors & Quotes',
        deliveryLocation: 'Delivery Location',
        deliveryDate: 'Delivery Date',
      },
    },

  },

sellerDirectory: {
    title: 'Sellers Directory',
    searchPlaceholder: 'Search company, contact, email, category, city...',
    allSources: 'All Sources',
    buyerUploaded: 'Buyer Uploaded',
    procucevNetwork: 'Procucev Network',
    allCategories: 'All Categories',
    allRatings: 'All Ratings',
    exportDirectory: 'Export Directory',
    totalSuppliers: 'Total Suppliers',
    networkSuppliers: 'Network Suppliers',
    buyerUploadedCard: 'Buyer Uploaded',
    avgScore: 'Average 360° Score',
    quotedOpportunities: 'Quoted Opportunities',
    procucevMarketplace: 'Procucev Marketplace',
    privateEnterpriseRoster: 'Private enterprise roster',
    aiEvaluationBenchmark: 'AI evaluation benchmark',
    totalBidsDelivered: 'Total bids delivered',
    verifiedActiveSubtext: '{count} Verified active',
    columnSettingsTitle: 'Column Settings',
    columnSettingsSubtitle: 'Show, hide, and drag handles to reorder columns',
    resetDefault: 'Reset to Default',
    noSellersFound: 'No suppliers found matching your query.',
    dossierAction: '360° Dossier',
    dossier: {
      profileTab: 'Profile',
      quotesTab: 'Quotes',
      creditTab: 'Credit',
      communicationsTab: 'Communications',
      paymentsTab: 'Payments',
      registered: 'Registered: {date}',
      closeDossier: 'Close Dossier',
      consoleTitle: 'Category Manager Operations Console',
      editCategories: 'Edit',
      procurementCategoriesMaster: 'Procurement Categories Master',
      contactDetails: 'Contact Details',
      statutoryVerification: 'Statutory & Verification',
      saveCategories: 'Save Categories',
      addCustomCategory: 'Add Category',
      score360Label: '360° AI Score',
      ratingLabel: 'Rating',
      subTabs: {
        email: 'Email',
        sms: 'SMS',
        whatsapp: 'WhatsApp',
        callLogs: 'Call Logs',
      },
      compose: {
        title: 'Record Supplier Communication',
        subtitle: 'Record Call Log, Email, SMS, or WhatsApp communication with automated internal task tracking.',
        sendBtn: 'Dispatch & Record',
        cancelBtn: 'Cancel',
        channelLabel: 'Communication Channel',
        subjectLabel: 'Subject / Summary',
        subjectPlaceholder: 'e.g. RFQ Quotation clarification follow-up',
        messageLabel: 'Message Content / Discussion Notes',
        messagePlaceholder: 'Type message content or summary of call...',
        recipientLabel: 'Recipient Contact',
        callOutcomeLabel: 'Call Outcome / Disposition',
        callDurationLabel: 'Call Duration',
        callDurationPlaceholder: 'e.g. 10 mins or 00:10:00',
        nextFollowupLabel: 'Next Follow-up Date (Optional)',
        followupPriorityLabel: 'Follow-up Priority',
        followupAssigneeLabel: 'Assign Follow-up To',
        followupNotesLabel: 'Follow-up Objective / Remarks',
        followupNotesPlaceholder: 'Action items for next scheduled interaction...',
        successToast: 'Communication recorded and dispatched successfully.',
        errorToast: 'Error recording communication',
      },
      quoteModal: {
        quoteDetails: 'Quotation Details',
        viewFullDetails: 'View Full Details',
        rfqDetails: 'RFQ Details',
        lineItems: 'Quoted Items & Technical Specifications',
        commercialTerms: 'Commercial Terms & Pricing',
        attachments: 'Drawings & Supporting Documents',
      },
      credit: {
        totalAllocated: 'Total Credits Allocated',
        totalConsumed: 'Total Credits Consumed',
        remainingFree: 'Remaining Free Credits',
        purchased: 'Purchased Credits',
        adjusted: 'Adjusted Credits',
        currentBalance: 'Current Credit Balance',
        subscriptionPlan: 'Current Subscription Plan',
      },
      payments: {
        totalPaid: 'Total Amount Paid',
        successful: 'Total Successful Payments',
        pending: 'Pending Payments',
        failed: 'Failed Payments',
        refunded: 'Total Refunded Amount',
        invoiceRef: 'Invoice / Reference',
        description: 'Description',
        amount: 'Amount',
        gatewayChannel: 'Gateway / Channel',
        status: 'Status',
        details: 'Payment Details',
      },
    },
  },
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
      title: 'RFQ Summary',
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
    transactionalEmails: {
      title: 'Qua AI Transactional Email Templates',
      screenTag: 'Screen 5.1',
      subtitle: 'Standardized transactional communication templates across buyer and vendor lifecycles.',
      supportPhone: '+91 8247722944',
      supportEmail: 'info@procucev.com',
      teamSignature: 'Team Qua AI',
      companyName: 'Procucev Enterprise Solutions',
    },
  },


  actions: {
    backToDashboard: 'Back to Command Center',
    approveAndGeneratePO: '[ APPROVE & GENERATE PRE-PURCHASE ORDER ]',
    exportToExcel: 'Export Comparison Matrix',
    deepDiveTelemetry: 'Vendor Follow-Up Details',
    vendorFollowUpDetails: 'Vendor Follow-Up Details',
    closeVendorFollowUpDetails: 'Close Vendor Follow-Up Details',
    pauseChasing: 'Pause AI Chasing',
    resumeChasing: 'Resume AI Chasing',
    saveChanges: 'Save Configuration',
    retrySync: 'Retry Synchronization',
    submit: 'Submit',
    cancel: 'Cancel',
    confirm: 'Confirm',
    downloadTemplate: 'Download Excel Template',
    downloadExcelTemplate: 'Download Excel Template',
    downloadVendorMasterTemplate: 'Download Vendor Master Template',
    downloadCsvTemplate: 'Download CSV Template',
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
    emailQuoteSource: '✉️ Email',
    portalQuoteSource: '🌐 Portal',
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
      vendorEmailTemplates: {
        label: 'Vendor Email Templates',
        description: 'Customize vendor onboarding emails',
      },
      buyerDbSync: {
        label: 'Buyer DB Sync',
        description: 'Integrated public database reconciliation',
      },
      vendorPoIngestion: {
        label: 'Vendor & PO Ingestion',
        description: 'Vendor master, PO history & AI categorisation',
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
      allRfqsConsole: {
        label: 'All RFQs',
        description: 'Every RFQ raised across all buyers',
      },
      enterpriseInquiries: {
        label: 'Enterprise Inquiries',
        description: 'Buyer enterprise customization & bulk contracts leads',
      },
      buyersDirectory: {
        label: 'Buyers Directory',
        description: 'Complete profiles, RFQ history, credits & transaction governance',
      },
      sellersDirectory: {
        label: 'Sellers Directory',
        description: 'Verified supplier profiles, quotes, catalog & communication logs',
      },
      dailyReports: {
        label: 'Daily Reports',
        description: 'Downloadable operational, buyer, seller & RFQ Excel/CSV reports',
      },
      internalTasks: {
        label: 'Action Center',
        description: 'Internal tasks, management approvals, tickets & executive scorecards',
      },
      opportunityFeed: {
        label: 'Dashboard',
        description: 'Your enquiries, quotes, and sourcing activity',
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
      billingHistory: {
        label: 'Billing History',
        description: 'Past payments & downloadable receipts',
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
    poGenerated: 'Pre-Purchase Order #{poNumber} created and committed to ERP.',
    ratingUpdated: 'Vendor rating for {vendorName} revised to {newScore}/100.',
    welcomeUser: 'Welcome back, {userName} ({userRole})',
    totalSpendSummary: 'Total analyzed spend: ₹{amount} across {categoryCount} categories.',
  },
  /** Buyer RFQ Portfolio Summary (Screen 1.3). */
  /** AI document extraction inside the ingestion wizard (Screen 1.2). */
  /**
   * Manual RFQ entry. Every message names the offending field and says why the
   * value is needed, because "invalid input" tells a buyer nothing about what to
   * type instead.
   */
  manualRfq: {
    defaultStatus: 'Quotes Pending',

    // Line item
    itemNameRequired: 'Describe the item. Vendors quote against this text, so it cannot be blank.',
    quantityRequired: 'Enter a quantity above zero.',
    unitRequired: 'Enter a unit, for example Nos, Kg or Mtr.',
    majorCategoryRequired: 'Choose a major category so the RFQ routes to the right vendors.',
    minorCategoryRequired: 'Choose a minor category.',

    // Header
    titleLength: 'The RFQ title must be between {min} and {max} characters, or left blank to use the first line item.',
    deliveryLocationRequired:
      'Enter the delivery location. Vendors price freight against it, so it cannot be left blank.',
    deliveryLocationLength: 'The delivery location must be between {min} and {max} characters.',
    deliveryPincodeRequired:
      'Enter the delivery pincode or zipcode. Freight is rated on it, so it cannot be left blank.',
    deliveryPincodeInvalid:
      'Enter a pincode or zipcode of 3 to 10 letters, digits, spaces or hyphens, for example 400701.',
    deliveryPincodeDummy:
      'Dummy or sequential PIN codes (e.g. 123456, 111111) are not allowed. Please enter a valid delivery PIN code.',
    deliveryPincodeNotFound:
      'PIN code not found in postal directory. Please enter a valid delivery PIN code.',
    budgetNegative: 'An estimated budget cannot be negative. Leave it blank to publish no ceiling.',
    lineItemsRequired: 'Add at least one line item so vendors have something to quote against.',
    targetDateCannotBePast: 'Target date cannot be earlier than today.',
  },

  /** The Manual RFQ Entry dialog opened from the wizard's Manual tab. */
  manualRfqModal: {
    title: 'Manual RFQ Entry',
    subtitle:
      '',
    closeAria: 'Close manual RFQ entry',

    titleLabel: 'RFQ Title',
    titlePlaceholder: 'Leave blank to use the first line item',
    budgetLabel: 'Estimated Budget ({symbol})',
    budgetPlaceholder: 'Leave blank to publish no ceiling',
    optionalTag: 'Optional',
    deliveryLocationLabel: 'Delivery Location',
    deliveryLocationPlaceholder: 'Plant, warehouse or site address',
    deliveryPincodeLabel: 'Pincode / Zipcode',
    deliveryPincodePlaceholder: 'e.g. 400701',
    targetDateLabel: 'Target Delivery Date',
    sourcingModeLabel: 'Sourcing Mode',

    lineItemsHeading: 'Line Items ({count})',
    addItemAction: 'Add Line Item',
    noItemsMessage: 'No line items yet. Add at least one so vendors have something to quote against.',
    colItem: 'Item Description',
    colSpecs: 'Specification',
    colMajor: 'Major Category',
    colMinor: 'Minor Category',
    colQty: 'Quantity',
    colUnit: 'Unit',
    colTargetDate: 'Target Date',
    itemPlaceholder: 'e.g. Centrifugal water pump',
    specsPlaceholder: 'e.g. SS316 impeller',
    qtyPlaceholder: 'Qty',
    unitPlaceholder: 'Nos',
    selectPlaceholder: 'Select…',
    removeItemAria: 'Remove {item}',
    untitledItem: 'this line item',

    attachHeading: 'Supporting Documents',
    attachHint:
      'Attach a BOQ, drawings, specs, or signed requisition (.xlsx, .xls, .csv, .pdf, .docx, .txt, .eml, .msg up to 15 MB). They are stored with the RFQ, and you can optionally read the line items out of them into the table below.',
    attachAction: 'Attach Documents',
    attachingAction: 'Uploading…',
    extractAction: 'Extract Line Items',
    extractingAction: 'Reading…',
    removeAttachmentAria: 'Remove {fileName}',

    quotaExhaustedTitle: 'Free RFQ Limit Reached for Mode 1, Mode 2 & Mode 3 (0 of 5 Remaining)',
    quotaExhaustedMessage:
      'You have consumed all 5 free credits for Mode 1, Mode 2, and Mode 3. You can still create multiple free RFQs using Mode 0 (Procucev Network Vendors) at 0 credits, or upgrade your plan.',
    upgradePlanAction: 'Upgrade Plan',
    useV0Action: 'Switch to Mode 0 (Free)',
    v0FreeBadge: '⚡ Unlimited Free RFQs with Mode 0',

    serverAllocatesNumber: 'The RFQ number is allocated when you save.',
    cancelAction: 'Cancel',
    saveAction: 'Create RFQ',
    savingAction: 'Creating…',
  },

  rfqExtraction: {
    quotaExhaustedTitle: 'Free RFQ Quota Exhausted for Mode 1, Mode 2 & Mode 3 (0 of 5 Remaining)',
    quotaExhaustedMessage:
      'You have consumed all 5 free credits for Mode 1, Mode 2, and Mode 3. You can still create multiple free RFQs using Mode 0 (Procucev Network Vendors) at 0 credits, or upgrade your plan.',
    upgradePlanAction: 'Upgrade Plan',
    useV0Action: 'Switch to Mode 0 (Free)',
    v0FreeBadge: '⚡ Unlimited Free RFQs with Mode 0',

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
    errorDetailLabel: 'Exact reason (for debugging):',
    fallbackHint: 'Add each line item below, assign its minor category, then continue to sourcing.',
    unreadableResponse:
      'The extraction service returned an unexpected response. Add the line items manually to continue.',

    // Explicit recovery action shown on the failure banner so the buyer is not
    // left to guess that the table below is the fallback.
    retryAction: 'Retry extraction',
    manualEntryAction: 'Enter line items manually',
    manualEntryStarted: 'Add your line items in the table below.',

    /**
     * Reason-specific guidance for a failed extraction. Keyed by RFQExtractionReason
     * so the banner explains exactly why the document could not be read and what to
     * do next, rather than one generic line. Every message ends by pointing at
     * manual entry, which is the recovery path.
     */
    reasonMessages: {
      NOT_CONFIGURED:
        'AI extraction is not available on this environment. Enter the line items manually to continue.',
      NO_CONTENT:
        'No readable text was found in this file. If it is a scanned image, try a clearer scan, or enter the line items manually.',
      DOCUMENT_TOO_LARGE:
        'This document is too large for AI extraction. Upload a smaller file (or a single sheet), or enter the line items manually.',
      UNSUPPORTED_TYPE:
        'This file type cannot be read by AI extraction. Upload a spreadsheet (.xlsx/.csv), PDF or image, or enter the line items manually.',
      AI_FAILED:
        'The AI could not read this document — its layout may be unusual or the scan unclear. Try a spreadsheet or clearer PDF, or enter the line items manually.',
      QUOTA_EXCEEDED:
        'AI extraction reached the Gemini API quota or rate limit. Check the Google AI project quota or retry later, or enter the line items manually.',
      NO_ITEMS_FOUND:
        'No procurement line items could be identified in this document. Check that quantities are stated, or enter the line items manually.',
      NETWORK:
        'The extraction service could not be reached. Check your connection and retry, or enter the line items manually.',
    } as Record<RFQExtractionReason, string>,
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
    // Manual entry saves through its own dialog, so it reports its own outcome.
    manualCreatedTitle: 'RFQ Created',
    manualCreatedMessage: '{rfqNumber} was saved and is now in your RFQ portfolio.',

    // The uploaded document is stored alongside the RFQ so the details screen can
    // offer it back. A storage failure does not stop the RFQ being raised, so the
    // message says exactly what is missing and what still went through.
    attachmentStoreFailedTitle: 'Document Not Attached',

    // Document upload tab. This tab takes documents only — an emailed requisition
    // is picked up by the autonomous gateway, so no email container is offered here.
    boqTabLabel: 'BOQ Spreadsheet / Drawing (.xlsx, .pdf, .docx)',
    processingDocumentLabel: 'Processing Document & Extracting Line-Items with AI OCR...',
    dropZoneHeading: 'Click to Browse or Drag & Drop RFQ Document / BOQ Spreadsheet',
    dropZoneHint:
      'Supports Excel (.xlsx, .xls), CSV, PDF drawings, Word specifications (.docx), text files (.txt), or forwarded requisition emails (.eml, .msg) up to 15 MB.',
    extractFooterHint: 'Your document is read by Gemini AI, then you confirm the line items in Step 2.',
    attachmentStoreFailedMessage:
      'The RFQ was created, but {fileName} could not be stored with it, so it will not appear under Supporting Documents. {reason} You can attach it again from the RFQ details screen.',

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
        hint: 'BOQ file or via Email Upload',
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
    manualStartAction: 'Add Manual RFQ',
    manualHint: 'You will add each line item and its minor category in Step 2.',
    // The Manual tab now opens a dialog rather than routing through the review
    // step, so the tab itself just explains the path and offers the way in.
    manualPanelTitle: 'Enter RFQ Details Manually',
    manualPanelMessage:
      'Enter your RFQ details, including line items, delivery location, and supporting information, directly in the form. AI document extraction is not required for manual RFQ creation. Use document upload only when you want AI to extract RFQ details automatically.',

    manualBannerTitle: 'Manual Entry',
    manualBannerMessage: 'These line items were keyed by hand, so no AI confidence is reported against them.',

    // Step 1 manual attachments. Stored and shown back verbatim; never extracted.
    attachTitle: 'Supporting Documents',
    attachMessage:
      'Attach a drawing, specification sheet, indent form or document (.xlsx, .xls, .csv, .pdf, .docx, .txt, .eml, .msg up to 15 MB) to the RFQ. These are stored with the RFQ for reference and are not read by AI — you key the line items yourself on the next step.',
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
    backAction: 'Back to RFQs',
    notFoundTitle: 'RFQ Not Found',
    // Reworded now that the page reads from the API rather than store state: a
    // miss means this RFQ is not under the signed-in buyer's organisation, which
    // is also the answer another organisation's RFQ gives.
    notFoundMessage:
      'This RFQ was not found under your organisation. Check the RFQ number, or return to the portfolio to pick one.',

    // API-backed loading
    loadingTitle: 'Loading RFQ',
    loadingMessage: 'Fetching the RFQ record and its line items.',
    loadFailedTitle: 'RFQ Could Not Be Loaded',
    loadFailed: 'The RFQ could not be read. Try again, and if it persists the API may be unavailable.',
    retryAction: 'Try Again',
    missingReferenceTitle: 'No RFQ Selected',
    missingReferenceMessage:
      'Open an RFQ from the portfolio so this page knows which record to display.',

    // Provenance strip. No "audit immutable" claim: nothing in the record backs
    // it, and the RFQ is in fact editable.
    documentTypeBadge: 'Request for Quotation (RFQ)',
    raisedOnStrip: 'Raised {timestamp}',
    updatedOnStrip: 'Edited {timestamp}',

    // Header & submission provenance
    submittedHeading: 'Submission Detail',
    sourceLabel: 'Intake Source',
    sourceWebPortal: 'Web Portal Upload',
    sourceEmailGateway: 'via Email Upload',
    sourceEmailUpload: 'Emailed Document',
    sourceManualEntry: 'Manual Entry',
    sourceAiExtraction: 'AI Extraction',
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
    colIndex: '#',
    colItem: 'Item Description',
    colSpecs: 'Technical Specification',
    colMajor: 'Major Category',
    colMinor: 'Minor Category',
    colCategory: 'Category',
    colQty: 'Qty',
    colUnit: 'Unit',
    colTargetDate: 'Required By',
    colConfidence: 'Confidence',
    noLineItems: 'No line items were recorded against this RFQ.',
    noLineItemMatches: 'No line items match the current search and filter.',
    clearFiltersAction: 'Clear search and filter',
    manualConfidence: 'Keyed manually',
    confidenceHigh: '{confidence}% High Confidence',
    confidenceReview: '{confidence}% Needs Review',
    displayingCount: 'Displaying {shown} of {total} line items',
    parsedSuccessfully: '{percent}% classified automatically',
    totalQuantityLabel: 'Total quantity',
    // Column sorting. The label names what clicking does next, so a screen reader
    // announces the action rather than the current state.
    sortAscAria: 'Sort by {column}, ascending',
    sortDescAria: 'Sort by {column}, descending',
    specsInlineLabel: 'Spec',

    // Quotes
    quotesHeading: 'Vendor Quotations',
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

    // Attachments
    attachmentsHeading: 'Supporting Documents',
    attachmentViewAction: 'View',
    attachmentViewAria: 'Open {fileName} in a new tab',
    attachmentUploadedOn: 'Attached {date}',
    noAttachments: 'No supporting documents were attached to this RFQ.',

    // Vendor Inquiries & Live Availability
    vendorOnline: 'Online',
    vendorOffline: 'Offline',

    // Extend RFQ (one-time 24h or 48h deadline extension for open RFQs)
    extendRfqAction: 'Extend RFQ',
    extendRfqAria: 'Extend deadline for RFQ {rfqNumber} by 24 or 48 hours',
    extendModalTitle: 'Extend RFQ Closing Deadline',
    extendModalSubtitle: 'Grant suppliers a one-time extension of 24 or 48 hours for {rfqNumber}.',
    currentDeadlineLabel: 'Current Closing Deadline',
    revisedDeadlineLabel: 'Revised Closing Deadline',
    closingDeadlineLabel: 'Closing Deadline',
    selectExtensionDurationLabel: 'Select Extension Duration',
    hoursUnit: 'Hours',
    oneDayLabel: '24 Hours (+1 Day)',
    twoDaysLabel: '48 Hours (+2 Days)',
    oneTimeNotice: 'This is a strictly one-time extension. Once confirmed, this RFQ deadline cannot be extended again.',
    confirmExtensionAction: 'Confirm Extension (+{hours}h)',
    extendingAction: 'Extending Deadline…',
    extensionSuccessTitle: 'RFQ Deadline Extended',
    extensionSuccessMessage: 'Closing deadline for {rfqNumber} has been extended by {hours} hours to {newDeadline}.',
    extensionFailedTitle: 'Extension Failed',
    extendedBadge: 'Extended (+{hours}h)',
    alreadyExtendedTooltip: 'A one-time extension of {hours} hours has already been applied to this RFQ.',
    revisedDeadlineNote: 'One-time extension applied',
    oneTimeExtensionAvailable: 'One-time extension (+24h / +48h) available',
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
    sourceEmailGateway: 'via Email Upload',
    sourceEmailUpload: 'Email File Upload',
    sourceManualEntry: 'Manual Entry',
    sourceAiExtraction: 'AI Extraction',
    sourceAiRfqCreate: 'AI RFQ Create',
    sourceWebPortal: 'Web App Portal',

    // Static ordered list of intake source filter options shown in the dropdown.
    // The value matches the RFQSource stored on each RFQ; the label is what the
    // buyer reads. The order is: AI RFQ Create → Email Gateway → Manual Entry.
    intakeSourceFilterOptions: [
      { value: 'ai_extraction', label: 'AI RFQ Create' },
      { value: 'email_gateway', label: 'Email Gateway' },
      { value: 'manual_entry', label: 'Manual Entry' },
    ] as ReadonlyArray<{ value: string; label: string }>,

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
    quotesReceivedLabel: '{count} quotes',
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

  allRfqs: {
    title: 'All RFQs',
    subtitle: 'Every RFQ raised across all buyer organisations',
    loading: 'Loading every RFQ…',
    loadFailed: 'The RFQ list could not be loaded. Try again, and if it persists the API may be unavailable.',
    retryAction: 'Retry',
    countSummary: '{count} RFQs across {buyers} buyers',
    resultCount: 'Showing {shown} of {total} RFQs',
    filtersLabel: 'RFQ search and filters',
    filtersApplied: 'Filters applied',
    clearFilters: 'Clear filters',
    clearSearch: 'Clear search',
    searchLabel: 'Search',
    searchPlaceholder: 'RFQ number, title, category or buyer…',
    statusFilterLabel: 'Status',
    allStatuses: 'All Statuses',
    buyerFilterLabel: 'Buyer',
    allBuyers: 'All Buyers',
    noMatches: 'No RFQs match the current search and filters.',
    empty: 'No RFQs have been raised yet.',
    colRfqNumber: 'RFQ Number',
    colTitle: 'Title & Category',
    colBuyer: 'Buyer',
    colStatus: 'Status',
    colQuotes: 'Quotes',
    colVendors: 'Quoted Vendors',
    colBudget: 'Budget',
    colCreated: 'Raised',
    colLatestQuote: 'Latest Quote',
    colActions: 'Actions',
    buyerUnknown: 'Unattributed',
    budgetUnset: 'Not set',
    latestQuoteNone: 'No quotes yet',
    colVendorsNone: 'No vendors quoted',
    viewMatrixAction: 'Quote Matrix',
    viewMatrixAria: 'Open the comparative quote matrix for {rfqNumber}',
    viewDetailsAction: 'Details',
    viewDetailsAria: 'View the full submitted detail for {rfqNumber}',
    inviteVendorsAction: 'Invite Vendors',
    inviteVendorsAria: 'Invite vendors to {rfqNumber}',
  },

  inviteVendors: {
    title: 'Invite Vendors',
    subtitle: 'Category-matched candidates for {rfqNumber}',
    closeAria: 'Close',
    loading: 'Loading candidate vendors…',
    loadFailed: 'The vendor candidate list could not be loaded.',
    noCandidates: 'No vendors cover this RFQ’s category yet.',
    candidateCount: '{count} candidates',
    selectAll: 'Select all',
    deselectAll: 'Deselect all',
    alreadyInvitedBadge: 'Invited',
    cancelAction: 'Cancel',
    inviteAction: 'Invite Selected Vendors ({count})',
    inviteSelectedAction: 'Invite Selected Vendors',
    successTitle: 'Vendors Invited',
    successMessage: '{count} vendor(s) invited to {rfqNumber}. They can now see it, and have been notified.',
    failTitle: 'Could Not Invite Vendors',
    categoryMatchesTab: 'Category Matches',
    allVendorsTab: 'All Vendors',
    searchPlaceholder: 'Search by vendor name or email…',
    outsideCategoryBadge: 'Outside Category',
    noVendorsFound: 'No vendors match your search.',
    allVendorsLoadFailed: 'The vendor list could not be loaded.',
    dbQueryTimeout: 'The vendor search timed out. Please try refining your search or checking specific emails.',
    loadMoreVendors: 'Load {pageSize} more vendors',
    candidateCountOfTotal: 'Showing {count} of {total} vendors',
    selectedVendorCount: '{count}/{max} Selected',
    selectedRatio: '{count}/{max}',
    clearSelection: 'Clear Selection',
    removeVendorAria: 'Remove {name} from selection',
    stateFilterPlaceholder: 'All States',
    cityFilterPlaceholder: 'All Cities',
    selectStateFirst: 'Select state first',
    stateLabel: 'State',
    cityLabel: 'City',
    categoryLabel: 'Category',
    allCategories: 'All categories',
    maxSelectionWarning: 'Maximum of {max} vendors can be selected per invitation.',
    limitReachedNotice: 'Maximum 20 vendors limit reached. Remove some to select others.',
    duplicateIgnored: 'Vendor already invited',
    noMatchingVendors: 'No vendors match the selected filters.',
  },

  notifications: {
    bellAria: 'Notifications',
    bellAriaUnread: '{count} unread notifications',
    heading: 'Notifications',
    unreadBadge: '{count} new',
    markAllRead: 'Mark all read',
    empty: 'You have no notifications yet.',
    loadFailed: 'Notifications could not be loaded.',
    aiFeedHeading: 'Vendor Follow Up Status',
    aiFeedEventCount: '{count} Events',
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
    mobileInvalid: 'Enter a valid 10-digit Indian mobile number.',

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
    sessionExpired: 'Your session has expired. Sign in again to continue.',
    redirecting: 'Redirecting to your workspace…',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    registrationSuccessMessage:
      'Account created for {email}. You are signed in and can start configuring your workspace.',

    // Buyer First-Login Onboarding
    buyerOnboarding: {
      title: 'Complete Profile & Verify Account',
      subtitle: 'Your RFQ has been created and sent to eligible vendors. Complete verification to access your portal.',
      step1Title: 'Email Verification',
      step1Desc: 'Enter the 6-digit OTP sent to your registered email address.',
      step2Title: 'Phone Verification',
      step2Desc: 'Replace the placeholder 9999999999 with your active mobile number and verify via SMS OTP.',
      step3Title: 'Change Temporary Password',
      step3Desc: 'Replace your temporary password with a secure new permanent password.',
      step4Title: 'Organisation & Statutory Profile',
      step4Desc: 'Provide your company, tax credentials, and registered address to finalize your account.',
      emailOtpLabel: 'Email OTP Code',
      sendEmailOtpBtn: 'Send Email OTP',
      mobileLabel: 'Mobile Phone Number',
      mobileOtpLabel: 'SMS OTP Code',
      sendSmsOtpBtn: 'Send SMS OTP',
      currentPasswordLabel: 'Temporary Password',
      newPasswordLabel: 'New Password',
      confirmPasswordLabel: 'Confirm New Password',
      companyNameLabel: 'Company Name / Legal Name',
      contactNameLabel: 'Full Name / Procurement Lead',
      cityLabel: 'City',
      stateLabel: 'State',
      pincodeLabel: 'Pincode',
      addressLabel: 'Address / Street Location',
      gstinLabel: 'GSTIN / GST Number',
      panLabel: 'PAN Number',
      companyNamePlaceholder: 'e.g. Larsen & Toubro Procurement',
      contactNamePlaceholder: 'e.g. Navin Chaudhary',
      gstinPlaceholder: 'e.g. 27AAAAA0000A1Z5',
      pincodePlaceholder: 'e.g. 411001',
      cityPlaceholder: 'e.g. Pune',
      statePlaceholder: 'e.g. Maharashtra',
      addressPlaceholder: 'e.g. MIDC Industrial Area, Phase II',
      companyNameRequired: 'Company Name / Legal Name is required.',
      gstinRequired: 'GSTIN / GST Number is required.',
      gstinInvalid: 'GSTIN must be 15 characters in the format 99AAAAA9999A9Z9, for example 27AAAAA0000A1Z5.',
      pincodeRequired: 'Pincode is required.',
      pincodeInvalid: 'PIN Code must be 6 digits and cannot start with 0.',
      cityRequired: 'City is required.',
      stateRequired: 'State is required.',
      submitBtn: 'Complete Verification & Enter Portal',
      submittingBtn: 'Verifying & Setting Up Account…',
      successTitle: 'Profile Verification Complete',
      successMessage: 'Your buyer profile is active and verified. Any pending quotes have been delivered.',
      placeholderPhoneWarning: 'Placeholder phone 9999999999 must be replaced with your real mobile number.',
      passwordMismatch: 'New password and confirmation do not match.',
      otpSentMessage: 'Verification code has been dispatched.',
    },
  },

  // Editing and withdrawing an RFQ.
  rfqEdit: {
    editAction: 'Edit',
    editAria: 'Edit {rfqNumber}',
    deleteAction: 'Delete',
    deleteAria: 'Delete {rfqNumber}',

    // Edit dialog
    dialogTitle: 'Edit RFQ',
    dialogSubtitle:
      'Change the title, terms, line items and documents of {rfqNumber}. Only what you change is sent.',
    titleLabel: 'RFQ Title',
    categoryLabel: 'RFQ Major Category',
    statusLabel: 'Status',
    budgetLabel: 'Estimated Budget ({symbol})',
    targetDateLabel: 'Target Delivery Date',
    deliveryLocationLabel: 'Delivery Location',
    deliveryPincodeLabel: 'PIN / ZIP Code',
    optionalTag: 'Optional',

    // Section headings inside the dialog, mirroring the details page so the buyer
    // is editing the same groupings they were just reading.
    sectionCommercial: 'Commercial & Delivery',
    sectionLineItems: 'Line Items',
    sectionDocuments: 'Supporting Documents',
    sectionProvenance: 'Submission Detail',

    // Read-only provenance, shown so the buyer can see what an edit cannot change.
    readOnlyNote: 'Allocated by the server and not editable.',
    rfqNumberLabel: 'RFQ Number',
    raisedOnLabel: 'Raised On',
    raisedByLabel: 'Raised By',
    intakeSourceLabel: 'Intake Source',

    // Line items
    addItemAction: 'Add Line Item',
    removeItemAria: 'Remove line item {item}',
    untitledItem: 'this row',
    noItemsMessage: 'This RFQ has no line items. Add at least one before saving.',
    colItem: 'Item Description',
    colSpecs: 'Technical Specification',
    colMajor: 'Major Category',
    colMinor: 'Minor Category',
    colQty: 'Qty',
    colUnit: 'Unit',
    colTargetDate: 'Required By',
    selectMajorFirst: 'Select a major category first',
    itemNameRequired: 'Every line item needs a description.',
    quantityRequired: 'Every line item needs a quantity above zero.',
    unitRequired: 'Every line item needs a unit.',
    majorCategoryRequired: 'Every line item needs a major category.',
    lineItemsRequired: 'An RFQ needs at least one line item.',
    lineItemErrorSummary: 'Row {row}: {message}',

    // Documents
    attachAction: 'Attach Document',
    attachingAction: 'Uploading…',
    removeAttachmentAria: 'Remove {fileName}',
    noAttachmentsMessage: 'No supporting documents are attached.',
    attachHint: 'Stored against the RFQ and downloadable from its details page.',

    saveAction: 'Save Changes',
    savingAction: 'Saving…',
    cancelAction: 'Cancel',
    closeAria: 'Close the edit dialog',
    noChanges: 'Nothing has been changed yet.',

    // Validation. Same rules as creation, so an edit cannot introduce a value that
    // could not have been created.
    titleRequired: 'RFQ Title is required and must be at least 3 characters.',
    categoryRequired: 'Major Category is required.',
    budgetNegative: 'Estimated Budget cannot be negative. Leave it blank if no ceiling is set.',
    deliveryLocationRequired: 'Delivery Location is required so vendors can price freight.',
    deliveryPincodeRequired: 'PIN / ZIP Code is required so vendors can price freight.',
    deliveryPincodeInvalid:
      'PIN / ZIP Code must be 3 to 10 letters, digits, spaces or hyphens, for example 400701 or SW1A 1AA.',
    deliveryPincodeDummy:
      'Dummy or sequential PIN codes (e.g. 123456, 111111) are not allowed. Please enter a valid delivery PIN code.',
    targetDateCannotBePast: 'Target date cannot be earlier than today.',

    // Outcomes
    savedTitle: 'RFQ Updated',
    savedMessage: '{rfqNumber} has been updated.',
    saveFailedTitle: 'RFQ Not Updated',
    saveFailed: 'The RFQ could not be updated. Try again, and if it persists the API may be unavailable.',

    // Delete confirmation. Named explicitly, because the RFQ number is the only
    // thing distinguishing one row from the next.
    deleteTitle: 'Delete this RFQ?',
    deleteConfirmMessage:
      'This permanently deletes {rfqNumber} ({title}) and its {itemCount} line items. This cannot be undone.',
    deleteConfirmAction: 'Delete RFQ',
    deletingAction: 'Deleting…',
    deletedTitle: 'RFQ Deleted',
    deletedMessage: '{rfqNumber} has been deleted.',
    deleteFailedTitle: 'RFQ Not Deleted',
    deleteFailed: 'The RFQ could not be deleted. Try again, and if it persists the API may be unavailable.',
    classifyFailed:
      'Categories could not be refreshed just now. Set the major and minor category on each line item manually, or try again.',
  },

  vendorFeed: {
    // The direct-invitation buyer filter. Options are the buyers actually present
    // in the feed, so the label names the identity an RFQ carries (the raising
    // buyer's corporate email) rather than a company the RFQ has no field for.
    buyerFilterLabel: 'Raising Buyer',
    buyerFilterAll: '🌐 All Inviting Buyers',
  },

  vendorProfile: {
    customCategoriesTitle: 'Add & Update Your Supply Categories',
    customCategoriesSubtitle: 'Self-service category addition',
    customCategoriesDesc:
      "Can't find your exact product or service in the pre-configured categories below? Add your own specialized procurement categories here. They will be saved to your profile and matched to relevant RFQs.",
    customCategoryPlaceholder:
      'Type custom category name (e.g., CNC Precision Machining, Industrial Valves, Fire Protection)...',
    addCategoryButton: '+ Add Category',
    categoryAddedTitle: 'Category Added',
    categoryAddedMessage: 'Added "{category}" to your procurement categories.',
    categoryExistsMessage: 'Category already exists in your selections.',
    categoryEmptyMessage: 'Please enter a valid category name.',
    maxCategoriesReached: 'Maximum {max} categories allowed. Please remove a category before adding a new one.',
    customCategoryGroup: 'Other',
    removeCategoryTitle: 'Remove Category',
    noCategoriesSelected: 'No categories selected. Pick up to 10 below or add your own above.',
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

    // Shown wherever a category picker has no options. There is no bundled copy of
    // the category master any more, so an unreadable master means no categories
    // can be offered — stating that is safer than offering a list that may not
    // match what RFQ routing and the saved scope are actually resolved against.
    taxonomyUnavailable:
      'The procurement category list could not be loaded, so no categories can be offered right now. Reload the page, and contact your Procucev administrator if it persists.',
    taxonomyEmpty:
      'No procurement categories are configured yet. Ask your Procucev administrator to load the category master before selecting categories.',

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

  // ============================================================================
  // ACCOUNT & SECURITY
  // ============================================================================
  // Copy for the display-name and password-change forms. These used to be inline
  // literals in the header component; they moved here when the panel was lifted
  // out of the header so the buyer profile page and the header could share one
  // implementation without duplicating strings.
  accountSecurity: {
    // Headings. The panel holds only the password form, so it is named for
    // that rather than for "account" settings it no longer contains.
    menuLabel: 'Security',
    sectionTitle: 'Section 4: Security',
    panelTitle: 'Security Settings',
    sectionDescription:
      'Change the password used to sign in to your Procucev workspace.',

    // Password fields
    passwordSectionLabel: 'Change Sign-In Password',
    currentPasswordLabel: 'Current Password',
    currentPasswordPlaceholder: 'Enter your current password',
    newPasswordLabel: 'New Password',
    newPasswordPlaceholder: 'Min 8 characters',
    confirmPasswordLabel: 'Confirm New Password',
    confirmPasswordPlaceholder: 'Re-enter new password',
    verificationCodeLabel: 'Verification Code',
    verificationCodePlaceholder: 'Enter 6-digit code',
    sendVerificationCodeAction: 'Send Verification Code',
    sendingCodeAction: 'Sending code…',
    resendCodeAction: 'Resend Code',
    updatePasswordAction: 'Update Password',
    updatingPasswordAction: 'Updating…',

    // Guidance shown beside the fields. This states what the server actually
    // enforces and separates it from what is merely advisable: the previous
    // copy listed an uppercase-and-symbol rule that nothing checked, and
    // claimed AES encryption at rest that is not in place.
    policyTitle: 'Password requirements:',
    policyMinLength: 'At least 8 characters. This is checked when you save.',
    policyReuse: 'Must be different from your current password.',
    policyComplexity:
      'Recommended: mix upper and lower case with at least one number and one symbol.',

    // Toast titles
    validationErrorTitle: 'Validation Error',
    weakPasswordTitle: 'Weak Password',
    passwordMismatchTitle: 'Password Mismatch',
    passwordChangedTitle: 'Password Changed',
    changeFailedTitle: 'Password Not Changed',
    codeSentTitle: 'Verification Code Sent',

    // Toast messages. Failure text is supplied by the API so the reason is
    // specific; these cover the client-side checks and the fallbacks.
    currentPasswordRequired: 'Enter your current password to authorise the change.',
    verificationCodeRequired: 'Enter the 6-digit verification code sent to your registered contact.',
    codeSentMessage: 'A 6-digit verification code has been dispatched to your registered contact.',
    requestOtpFirst: 'Please request and enter a verification code first.',
    weakPasswordMessage: 'Choose a new password of at least 8 characters.',
    passwordMismatchMessage: 'The new password and its confirmation do not match.',
    passwordSameAsCurrent:
      'The new password is the same as your current one. Choose a different password.',
    passwordChangedFallback:
      'Your password has been changed. Use it the next time you sign in.',
    changeFailedFallback:
      'Your password could not be changed and your existing password is still in effect. Try again in a moment.',

    // Modal-only affordance, used where the panel is presented as an overlay
    closeAction: 'Close',
  },

  // ============================================================================
  // CATEGORY MANAGER KANBAN
  // ============================================================================
  // Copy for the Ingested / Parsing column, which is where an email-ingested RFQ
  // lands. It has had no human review, so the card states its origin, what the
  // extractor could not place, and who it came from.
  categoryManagerKanban: {
    buyerLabel: 'Buyer',
    majorCategoryLabel: 'Major category',
    minorCategoryLabel: 'Minor category',
    itemsLabel: 'Line items',
    receivedLabel: 'Received',
    confidenceLabel: 'Avg. extraction confidence',
    reviewAction: 'Open & Review Categories',
    needsCategoryReview: '{count} need category',
    sourceLabels: {
      email_gateway: 'via Email Upload',
      email_upload: 'Email File Upload',
      web_portal: 'Web Portal',
      manual_entry: 'Manual Entry',
    } as Record<string, string>,
  },

  // ============================================================================
  // AUTONOMOUS EMAIL INGESTION GATEWAY
  // ============================================================================
  // Copy for the Step 1 gateway panel. This replaced a simulator: a textarea with
  // three hardcoded sample requisitions and a green "Active & Listening" badge
  // with no connection behind it. Everything here now reflects real state, so the
  // not-configured and error cases matter as much as the healthy one.
  emailGateway: {
    title: 'Autonomous Email Ingestion Gateway',
    watchingLabel: 'Watching',
    notWatchingLabel: 'Not watching',
    offLabel: 'Switched off',
    notConfiguredLabel: 'Not configured',
    activeListeningLabel: 'Active & Listening',
    connectionErrorLabel_state: 'Connection error',

    // How it works. Deliberately stops at Category Manager review: this gateway
    // does not shortlist or contact vendors, and saying otherwise was the
    // misleading claim the simulator used to make.
    howItWorks:
      'Requisitions emailed to the gateway are automatically extracted and categorized, then sent to the Category Manager for review.',
    lightsOutTitle: 'Autonomous Lights-Out Ingestion',
    // The prototype's banner claimed this step also shortlisted vendors and
    // circulated the RFQ. It does neither: extraction and categorization are
    // automatic, release to vendors is a Category Manager decision.
    howItWorksAddressed:
      'When a requisition arrives from a registered buyer at {address}, the system automatically extracts the line items and assigns major and minor categories, then raises the RFQ for Category Manager review. No vendor is shortlisted or contacted at this stage.',

    // The intake address buyers send TO. Distinct from the IMAP login below,
    // which is the account the backend reads and is an operational detail.
    gatewayAddressLabel: 'Send requisitions to',
    gatewayAddressHint: 'Procucev intake mailbox',
    mailboxAccountLabel: 'Collected from',
    checkedEveryLabel: 'Checked every',
    reviewStatusLabel: 'Ingested RFQs are held in',

    // Worked example, so the direction of the flow cannot be misread.
    exampleTitle: 'How to send a requisition',
    exampleFromLabel: 'From',
    exampleFromValue: 'your registered buyer email',
    exampleToLabel: 'To',
    exampleSubjectLabel: 'Subject',
    exampleSubjectValue: 'RFQ - Industrial Water Pump',
    exampleBodyLabel: 'Body',
    exampleBodyValue: 'Line items and specifications, or attach a PDF / CSV',

    // What happens next, and explicitly what does not.
    nextStepsTitle: 'What happens next',
    nextStepExtract: 'Line items and major/minor categories are extracted automatically.',
    nextStepReview: 'The RFQ is created and appears on the Category Manager board for review.',
    nextStepNoVendors: 'No vendor is contacted from here. Releasing to vendors is the Category Manager\u2019s step.',

    // Who is allowed to raise a requisition by email.
    allowedAnyAccount:
      'Any sender registered as a buyer account. A message from an unknown address is recorded and skipped.',
    allowedSendersLabel: 'Allowed senders',
    allowedDomainsLabel: 'Allowed domains',

    // Not configured: name the exact variables, since this is a deployment step.
    setupTitle: 'No mailbox connected',
    setupBody:
      'Set EMAIL_GATEWAY_HOST, EMAIL_GATEWAY_USER and EMAIL_GATEWAY_PASSWORD in backend/.env, then set EMAIL_GATEWAY_ENABLED=true and restart the backend.',
    setupHint:
      'For Gmail use imap.gmail.com on port 993 with an App Password — a normal account password will be refused.',

    // Manual check
    checkNowAction: 'Check Mailbox Now',
    checkingLabel: 'Checking…',
    checkCompleteTitle: 'Mailbox Checked',
    checkCompleteMessage: 'Considered {considered} message(s), raised {ingested} RFQ(s). {pending} still queued.',
    checkFailedTitle: 'Mailbox Check Failed',
    pollFailed: 'The mailbox could not be checked. Confirm the gateway credentials and that the host is reachable.',
    statusUnavailable:
      'The gateway status could not be read. The backend may be starting up — retry in a moment.',

    // Activity ledger
    recentTitle: 'Recent inbound messages',
    recentEmpty: 'No inbound messages have been processed yet.',
    lastCheckedLabel: 'Last checked',
    neverChecked: 'Never',
    connectionErrorLabel: 'Last error',

    // Requisition composer form & submission
    sampleSelectorTitle: 'Select Incoming Email Requisition Sample:',
    samplePumps: 'Mechanical Pumps & Valves',
    sampleElectrical: 'Electrical Switchgear',
    sampleSteel: 'Civil & PEB Steel',
    fromPlantEngineerLabel: 'FROM (PLANT ENGINEER)',
    toGatewayLabel: 'TO (ENTERPRISE GATEWAY)',
    subjectInputLabel: 'SUBJECT',
    bodyInputLabel: 'EMAIL BODY & LINE-ITEM SPECS',
    submitAction: 'Autonomous Ingest, Categorize & Auto-Circulate RFQ',
    submittingAction: 'Ingesting & Processing with AI…',
    createdSuccessTitle: 'Requisition Ingested & RFQ Created Successfully',
    createdSuccessSubtitle:
      'The requisition was processed into line items and saved to the database. It is now queued for Category Manager review.',
    createdRfqNumberLabel: 'RFQ Number',
    createdStatusLabel: 'Status',
    createdItemsLabel: 'Extracted Line Items',
    createdBudgetLabel: 'Est. Budget',
    createdStatusValue: 'Ingested · Parsing (Awaiting Category Manager)',
    sendAnotherAction: 'Submit Another Requisition',
    viewInKanbanAction: 'View on Category Manager Board',

    // Ledger outcomes, keyed to the server's status values.
    outcomeIngested: 'RFQ raised',
    outcomeSenderNotAllowed: 'Sender not allowed',
    outcomeNoLineItems: 'No line items',
    outcomeUnreadable: 'Unreadable',
    outcomeFailed: 'Failed',
  },

  // ============================================================================
  // VENDOR MASTER & PO DATA INGESTION (Screen 1.6)
  // ============================================================================
  // Copy for the five-step buyer ingestion wizard. The wording is deliberately
  // precise about what the AI actually reads — the PO purchasing history, not the
  // company name — because that distinction is the whole value of the feature and
  // a vague label invites the buyer to trust a name-based guess.
  vendorPoIngestion: {
    title: 'Vendor Master & PO Data Ingestion',
    subtitle:
      'Upload your vendor master and historical PO purchase dump separately. Supplier categories are derived from actual purchasing history, then reviewed by you before any email is sent.',
    organizationLabel: 'Organisation',
    sessionLabel: 'Session',
    startNewAction: 'Start New Ingestion',
    resumeNotice: 'Resuming your last ingestion run. Nothing is lost if you navigate away.',
    loadingSession: 'Loading your ingestion session…',
    noSessionTitle: 'No ingestion run yet',
    noSessionBody:
      'Choose a time horizon to begin. You will upload your vendor master first, then your historical PO dump.',
    lockedStepTitle: 'Complete the earlier step first',
    lockedStepTemplate: 'Step {step} unlocks once the previous step is complete.',

    steps: {
      timeHorizon: { number: 1, label: 'Time Horizon', tag: 'Step 1' },
      vendorMaster: { number: 2, label: 'Vendor Master', tag: 'Step 2' },
      poDump: { number: 3, label: 'PO Dump', tag: 'Step 3' },
      aiCategoryJoin: { number: 4, label: 'AI Category Join', tag: 'Step 4' },
      dispatch: { number: 5, label: 'Dispatch Emails', tag: 'Step 5' },
    },

    horizon: {
      heading: 'Step 1 — Choose the historical purchase period',
      hint: 'Only PO records inside this period are used to categorise your suppliers.',
      last1Year: 'Last 1 Year (12 Months)',
      last1YearHint: 'Recent, high-velocity procurement only.',
      last2Years: 'Last 2 Years (24 Months)',
      last2YearsHint: 'Covers seasonal maintenance and capex cycles.',
      last2YearsBadge: 'Recommended',
      last3Years: 'Last 3 Years (36 Months)',
      last3YearsHint: 'Full historical audit and broadest supplier discovery.',
      custom: 'Custom Date Range',
      customHint: 'Pick an exact window, for example a financial year.',
      startDateLabel: 'Start date',
      endDateLabel: 'End date',
      selectedPeriodLabel: 'Selected Period',
      selectedPeriodTemplate: '{start} → {end}',
      continueAction: 'Continue to Vendor Master',
      saveAction: 'Save Period',
      changeWarning:
        'Changing the period clears any PO data already uploaded, because a different window means different purchasing evidence.',
    },

    vendorMaster: {
      heading: 'Step 2 — Upload File 1: Vendor Master',
      hint: 'Required columns: Vendor Code, Company Name, Contact Person, Email, Phone, Address, GSTIN. Rating (0-100) is optional.',
      dropzone: 'Click to browse or drag and drop your Vendor Master (.xlsx, .xls, .csv)',
      dropzoneParsing: 'Reading and validating vendor rows…',
      templateAction: 'Download Template',
      uploadAction: 'Validate & Store Vendor Master',
      replaceAction: 'Replace Stored Vendor Master',
      storedBadge: 'Stored',
      storedTemplate: '{count} vendors stored',
      previewHeading: 'Stored Vendor Master',
      emptyPreview: 'No vendor master stored for this session yet.',
      continueAction: 'Proceed to PO Dump',
      columnCode: 'Code',
      columnCompany: 'Company Name',
      columnContact: 'Email & Phone',
      columnGstin: 'GSTIN / Address',
      columnRating: 'Rating',
      ratingNotProvided: 'Not provided',
    },

    poDump: {
      heading: 'Step 3 — Upload File 2: Historical PO Purchase Dump',
      hint: 'Required columns: PO Number, PO Date, Vendor Code or Vendor Name, Line Item Description, Quantity, UOM, Spend, Department. Material Code, Existing Category, Subcategory and Currency are optional.',
      dropzone: 'Click to browse or drag and drop your PO dump (.xlsx, .xls, .csv)',
      dropzoneParsing: 'Reading and validating PO line items…',
      templateAction: 'Download Template',
      uploadAction: 'Validate & Store PO Dump',
      replaceAction: 'Replace Stored PO Dump',
      blockedByVendorMaster: 'Upload and store your Vendor Master before the PO dump.',
      insidePeriodLabel: 'Inside selected period',
      outsidePeriodLabel: 'Outside selected period',
      totalUploadedLabel: 'Total uploaded PO rows',
      noneInPeriodWarning:
        'None of the uploaded PO rows fall inside the selected period. Check the period, or the date column in your file.',
      runJoinAction: 'Run Vendor & PO Match',
      runningJoin: 'Matching PO history to your vendor master…',
    },

    join: {
      heading: 'Vendor & PO match',
      totalVendorsLabel: 'Total Vendors',
      matchedLabel: 'Matched Vendors',
      unmatchedLabel: 'No PO History',
      strategyHeading: 'How lines were attributed',
      byVendorCodeLabel: 'By Vendor Code',
      byGstinLabel: 'By GSTIN',
      byNameLabel: 'By normalised name',
      unattributedLabel: 'Unattributed',
      matchedTableHeading: 'Suppliers with pre-purchase order history',
      unmatchedTableHeading: 'Suppliers with no pre-purchase order history — self-mapping required',
      unmatchedExplain:
        'These suppliers are in your vendor master but have no pre-purchase orders inside the selected period. They are not categorised automatically; they will be invited to map their own categories.',
      unmatchedPoHeading: 'PO spend for suppliers not in your vendor master',
      unmatchedPoExplain:
        'These vendors appear in your PO dump but not in your vendor master. Usually this means the vendor master is incomplete.',
      columnVendor: 'Vendor',
      columnPoCount: 'PO Count',
      columnSpend: 'Total Spend',
      columnItems: 'Purchased Items',
    },

    ai: {
      heading: 'Step 4 — AI category join & buyer review',
      hint: 'Suppliers are categorised from their PO line items, purchase frequency and spend — never from the company name alone.',
      startAction: 'Start AI Categorisation',
      resumeAction: 'Resume AI Categorisation',
      progressTemplate: 'Processing {processed} / {total} vendors',
      completedTemplate: 'Categorised {processed} of {total} vendors',
      runningLabel: 'Categorising…',
      idleLabel: 'Not started',
      completedLabel: 'Complete',
      failedLabel: 'Failed',
      categoryMasterEmptyTitle: 'Your category master is empty',
      reRunAction: 'Re-run AI',
      reRunning: 'Re-running…',
      approveAction: 'Approve',
      editAction: 'Edit Category',
      rejectAction: 'Reject',
      saveEditAction: 'Save Category',
      cancelEditAction: 'Cancel',
      aiSuggestedLabel: 'AI suggested',
      buyerFinalLabel: 'Your approved category',
      reasonLabel: 'Why',
      confidenceLabel: 'Confidence',
      confidenceHigh: 'High confidence',
      confidenceMedium: 'Review recommended',
      confidenceNeedsReview: 'Needs buyer review',
      confidenceUnstated: 'No confidence score returned',
      newCategoryBadge: 'New category suggestion',
      newCategoryExplain:
        'The categoriser could not place this supplier in your category master. Choose a category yourself — nothing is created automatically.',
      noPoHistoryBadge: 'No PO history',
      failedBadge: 'Categorisation failed',
      reviewedByTemplate: 'Reviewed by {email} on {date}',
      majorCategoryLabel: 'Primary major category',
      minorCategoryLabel: 'Minor categories',
      relevantProductsLabel: 'Relevant products',
      addMinorAction: 'Add',
      removeMinorAction: 'Remove',
      rejectConfirmTitle: 'Reject this suggestion?',
      rejectConfirmBody:
        'The supplier will be moved to self-mapping and asked to select its own categories. The AI suggestion is kept for the audit trail.',
      continueAction: 'Continue to Dispatch',
    },

    filters: {
      searchPlaceholder: 'Search vendor, code, email or category',
      statusAll: 'All',
      statusMapped: 'Mapped',
      statusPendingReview: 'Needs Review',
      statusApproved: 'Approved',
      statusSelfMap: 'Self-Map Required',
      statusFailed: 'Failed',
      confidenceAll: 'Any confidence',
      confidenceHigh: 'High (90-100)',
      confidenceMedium: 'Medium (70-89)',
      confidenceNeedsReview: 'Below 70',
      poHistoryAll: 'Any PO history',
      poHistoryYes: 'Has PO history',
      poHistoryNo: 'No PO history',
      clearAction: 'Clear filters',
      resultsTemplate: 'Showing {from}-{to} of {total}',
      previousPage: 'Previous',
      nextPage: 'Next',
      noResults: 'No suppliers match these filters.',
    },

    segmentation: {
      heading: 'Vendors by category',
      selfMapHeading: 'Self Mapping Required',
      vendorCountTemplate: '{count} vendors',
      empty: 'No categories assigned yet.',
    },

    dispatch: {
      heading: 'Step 5 — Dispatch emails',
      hint: 'Select who to email, preview the recipient list, then confirm. Nobody is ever sent the same email twice.',
      templateLabel: 'Email template',
      templateCategoryMapped: 'Category mapping confirmation',
      templateCategoryMappedHint: 'For suppliers whose categories you have approved.',
      templateSelfMap: 'Self-mapping invitation',
      templateSelfMapHint: 'For suppliers with no PO history, asking them to map their own categories.',
      templateOnboarding: 'General onboarding notice',
      templateOnboardingHint: 'A plain notice that makes no claim about categories.',
      categoryFilterLabel: 'Limit to category',
      categoryFilterAll: 'All approved categories',
      previewAction: 'Preview Recipients',
      sendAction: 'Dispatch Emails',
      sendingLabel: 'Dispatching…',
      recipientsHeading: 'Recipients',
      recipientCountTemplate: '{count} vendors',
      alreadySentHeading: 'Already received this email — will be skipped',
      nothingToSend: 'There is nobody to email with this template yet.',
      confirmTitle: 'Dispatch to {count} vendors?',
      confirmBody: 'Each recipient receives this email once. Already-notified suppliers are skipped automatically.',
      confirmAction: 'Send',
      cancelAction: 'Cancel',
      statusHeading: 'Email status',
      statusTotal: 'Total',
      statusSent: 'Sent',
      statusFailed: 'Failed',
      statusPending: 'Pending',
      retryAction: 'Retry Failed',
      retryingLabel: 'Retrying…',
      retryHint: 'Only failures are retried. A successfully sent email is never sent again.',
      logHeading: 'Dispatch log',
      logEmpty: 'No emails dispatched for this session yet.',
      columnRecipient: 'Recipient',
      columnTemplate: 'Template',
      columnStatus: 'Status',
      columnDetail: 'Detail',
      columnSentAt: 'Sent',
    },

    audit: {
      heading: 'Audit trail',
      hint: 'Every action in this module is recorded with who did it and what changed.',
      empty: 'No audit entries yet.',
      columnWhen: 'When',
      columnWho: 'Who',
      columnAction: 'Action',
      columnEntity: 'Entity',
      columnChange: 'Change',
      viewAiLogsAction: 'AI classification log',
      aiLogsHeading: 'AI classification attempts',
      aiLogsEmpty: 'No AI classification attempts recorded yet.',
      aiLogsHint: 'Includes failed attempts, so an unusable model reply is visible rather than silent.',
    },

    validation: {
      summaryHeading: 'Validation summary',
      totalRowsLabel: 'Total Rows',
      validRowsLabel: 'Valid Rows',
      invalidRowsLabel: 'Invalid Rows',
      duplicateRowsLabel: 'Duplicate Rows',
      errorListHeading: 'Rejected rows',
      errorRowTemplate: 'Row {row}',
      downloadErrorsAction: 'Download Error Report',
      allValid: 'Every row passed validation.',
      unsupportedFileTitle: 'Unsupported file type',
      unsupportedFileTemplate: '"{name}" is not a supported spreadsheet. Accepted: {accepted}.',
      fileTooLargeTitle: 'File too large',
      fileTooLargeTemplate: '"{name}" is {size}MB. The limit is {limit}MB.',
      missingColumnsTitle: 'Missing required columns',
      missingColumnsTemplate: 'Could not find: {columns}. Check the file matches the template.',
      noRowsTitle: 'No readable rows',
      noRowsBody: 'The file has no data rows below its header.',
      blankRowsTemplate: '{count} blank row(s) were skipped.',
    },

    errors: {
      loadFailed: 'Could not load the ingestion session.',
      saveFailed: 'Could not save. Please try again.',
      uploadFailed: 'The upload could not be stored.',
      joinFailed: 'Could not match PO data to your vendor master.',
      aiFailed: 'AI categorisation could not be completed.',
      reviewFailed: 'Could not save your category decision.',
      dispatchFailed: 'The email dispatch could not be completed.',
      retryFailed: 'Could not retry the failed emails.',
    },

    toasts: {
      sessionStartedTitle: 'Ingestion started',
      sessionStartedTemplate: 'Analysing pre-purchase orders from {start} to {end}.',
      horizonSavedTitle: 'Period updated',
      vendorMasterStoredTitle: 'Vendor Master stored',
      vendorMasterStoredTemplate: '{stored} vendors stored, {rejected} rows rejected.',
      poStoredTitle: 'PO Dump stored',
      poStoredTemplate: '{inside} of {total} rows fall inside the selected period.',
      joinCompleteTitle: 'Match complete',
      joinCompleteTemplate: '{matched} suppliers have PO history; {unmatched} need self-mapping.',
      aiCompleteTitle: 'AI categorisation complete',
      aiCompleteTemplate: '{mapped} mapped, {review} need review, {failed} failed.',
      approvedTitle: 'Category approved',
      approvedTemplate: '{vendor} is now empanelled under {category}.',
      editedTitle: 'Category updated',
      rejectedTitle: 'Suggestion rejected',
      rejectedTemplate: '{vendor} moved to self-mapping.',
      reRunTitle: 'AI re-run complete',
      dispatchedTitle: 'Emails dispatched',
      dispatchedTemplate: '{sent} sent, {failed} failed, {skipped} skipped as already sent.',
      retriedTitle: 'Retry complete',
      retriedTemplate: '{sent} of {attempted} failed emails were sent.',
      templateDownloadedTitle: 'Template downloaded',
    },
  },

  initialSetupCompletion: {
    title: 'Setup & Vendor Ingestion Summary',
    subtitle: 'Dual-group vendor processing and onboarding email dispatch completed in a single coordinated action.',
    statusHeading: 'Overall Ingestion Status',
    statusCompleted: 'COMPLETED',
    statusWithFailures: 'COMPLETED WITH WARNINGS',
    statusFailed: 'FAILED',
    totalProcessedLabel: 'Total Processed',
    totalVendorsUnit: 'Vendors',
    mappedSentLabel: 'Template A: Pre-PO Mapped',
    unmappedSentLabel: 'Template B: Self-Map Required',
    failedCountLabel: 'Failed Email Dispatches',
    failedTableHeading: 'Failed Email Dispatches Requiring Attention',
    thVendorName: 'Vendor Name',
    thEmail: 'Email Address',
    thTemplate: 'Template',
    thReason: 'Failure Reason',
    retryAction: 'Retry Failed Emails',
    retryingAction: 'Retrying Dispatches…',
    doneAction: 'Done & View Dashboard',
    backToReviewAction: 'Back to Email Preview',
    allSuccessNotice: 'All eligible mapped (Template A) and unmapped (Template B) vendor onboarding emails dispatched successfully.',
    retryHint: 'Retrying will safely re-attempt only failed emails without duplicating successful dispatches.',
    suppliersUnit: 'Suppliers',
    emailsSentTemplate: '{sent} of {total} Emails Sent',
  },

  sourcingModeVersions: {
    mode_0: 'Mode 0 – Procucev Network Vendors',
    mode_1: 'Mode 1 – Internal Vendors',
    mode_2: 'Mode 2 – Internal + Procucev Vetted Vendors',
    mode_3: 'Mode 3 – Autonomous AI + 360 Qualification',
  },

  vendorSubscriptionModal: {
    upgradeTitle: '🔒 Upgrade Plan to Submit Quotations',
    creditsExhaustedWarning: '⚠️ No Free Quotation Credits: Free quotation credits are not available for network and external buyers. Quotations for your inviting/owning buyer remain unlimited. To submit quotes to other buyers across V0, V2, and V3, please upgrade to a paid subscription plan.',
    connectTitle: 'Connect Model (₹2 / 3 mo)',
    connectDesc: 'Quote and download up to 50 RFQs in 3 months from Marketplace.',
    selectTitle: 'Select Model (₹5 / 3 mo)',
    selectDesc: 'Item Catalogue (100 products) + 100 RFQs / 3 months.',
    activeBadge: 'Active',
    upgradeAction: 'Upgrade',
    closeAction: 'Close',
    upgradeToBidAction: '🔒 Upgrade to Bid',
    subscriptionRequiredToastTitle: 'Subscription Required',
    subscriptionRequiredToastDesc: 'You have no free quotation credits. Please upgrade your subscription to continue quoting on external buyer RFQs.',
    creditsExhaustedToastTitle: 'Quotation Credits Exhausted',
    creditsExhaustedToastDesc: 'You have no free quotation credits available. Please upgrade your subscription plan to continue submitting quotations.',
  },

  publicVendorDirectory: {
    title: 'Enterprise Vendor Directory',
    subtitle: 'Browse and discover verified industrial manufacturers, suppliers, and distributors across India.',
    searchPlaceholder: 'Search by name, category, product, or keywords...',
    filterHeading: 'Refine Suppliers',
    allCategories: 'All Categories',
    allStates: 'All States',
    ratingFilterLabel: 'Minimum Rating',
    allRatings: 'Any Rating',
    verifiedOnlyLabel: 'Verified Suppliers Only',
    totalFound: '{count} suppliers found',
    viewDetailsButton: 'View Full Profile',
    closeModal: 'Close',
    noVendorsFound: 'No vendors match your search criteria.',
    noVendorsFoundSubtitle: 'Try adjusting your filters or search keywords.',
    clearFilters: 'Clear All Filters',
    loadingText: 'Loading vendors...',
    errorText: 'Failed to load vendors. Please try again.',
    retryButton: 'Retry',
    tabs: {
      overview: 'Overview & Contacts',
      categories: 'Categories & Products',
      compliance: 'Compliance & Tax',
      performance: 'Performance & Rating',
    },
    labels: {
      contactPerson: 'Key Contact Person',
      designation: 'Designation',
      email: 'Corporate Email',
      phone: 'Direct Phone',
      website: 'Official Website',
      location: 'Operational Location',
      address: 'Factory / Registered Address',
      pincode: 'PIN Code',
      state: 'State',
      country: 'Country',
      gstin: 'GSTIN / Tax ID',
      pan: 'PAN Number',
      msme: 'MSME Registration',
      annualTurnover: 'Annual Turnover',
      orgType: 'Constitution / Org Type',
      majorCategory: 'Primary Industrial Category',
      minorCategories: 'Secondary Capabilities',
      productsOffered: 'Product & Service Portfolio',
      rating: 'Enterprise Rating',
      status: 'Onboarding Status',
      networkBadge: 'Procucev Verified Supplier',
      memberSince: 'Member Since',
      noProducts: 'No products listed.',
      noMinorCategories: 'No sub-categories listed.',
      copyEmail: 'Copy Email',
      copiedEmail: 'Copied!',
      verified: 'Verified',
      notVerified: 'Not Verified',
      ratingStars: '{rating} out of 5',
    },
    pagination: {
      previous: 'Previous',
      next: 'Next',
      pageOf: 'Page {page} of {total}',
    },
  },

  headerNav: {
    vendorDirectory: 'Vendor Directory',
    signIn: 'Sign In',
    support: 'Support',
    needSupport: 'Need Support?',
  },

  vendorDirectoryLogin: {
    badge: 'Enterprise Access Control',
    title: 'Vendor Directory Login',
    subtitle: 'Enter your Procucev corporate email address to receive a single-use verification code and access verified supplier profiles.',
    passkeyLabel: 'Directory Access Passkey',
    passkeyPlaceholder: 'Enter directory passkey (e.g. Procucev@Vendors2026)',
    submitButton: 'Authenticate & Enter Directory',
    authenticating: 'Verifying credentials...',
    exitDirectory: 'Exit Directory',
    sessionActive: 'Directory Session Active',
    invalidPasskey: 'Invalid directory access key. Please enter the valid passkey provided by Procucev.',
    emptyPasskey: 'Please enter the directory passkey to proceed.',
    quickAccessHint: 'Enterprise Directory Key:',
    useDemoKey: 'Use Demo Key',
    backToMainLogin: 'Platform Main Login (Buyer / Admin)',
    mainLoginDesc: 'Are you an Enterprise Buyer or Category Manager?',
    securedAccess: 'AES-256 Authenticated Gateway',
    directoryNotice: 'This directory is restricted to authorized company employees. Sessions automatically terminate after 5 minutes of inactivity.',
    // Procucev Email & OTP Flow
    emailStepTitle: 'Company Employee Directory Sign In',
    emailStepSubtitle: 'Enter your official @procucev.com email address to receive a single-use verification code.',
    emailLabel: 'Procucev Corporate Email',
    emailPlaceholder: 'e.g. name@procucev.com',
    sendOtpButton: 'Send Verification Code',
    sendingOtp: 'Sending verification code...',
    otpStepTitle: 'Enter Verification Code',
    otpStepSubtitle: 'We sent a 6-digit verification code to {email}. Code expires in 5 minutes.',
    otpLabel: '6-Digit Verification Code',
    otpPlaceholder: 'Enter 6-digit OTP',
    verifyButton: 'Verify & Enter Directory',
    verifyingOtp: 'Verifying code & establishing session...',
    resendOtp: 'Resend Code',
    resendIn: 'Resend code in {time}',
    didNotReceiveOtp: "Didn't receive the code?",
    codeExpiresNotice: 'Code expires in 5 minutes.',
    changeEmail: 'Change Email',
    sessionExpiredNotice: 'Your vendor directory session has expired due to 5 minutes of inactivity. Please sign in again.',
    accessDeniedNotice: 'Access restricted: Only active @procucev.com corporate email addresses are authorized to access this directory.',
    procucevEmailRequired: 'Must be a valid Procucev corporate email address ending in @procucev.com',
    invalidOtp: 'Invalid verification code. Please enter the 6-digit numeric OTP sent to your email.',
    emptyEmail: 'Please enter your Procucev corporate email address.',
    emptyOtp: 'Please enter the 6-digit verification code.',
    networkError: 'Unable to reach the server. Please check your network connection and try again.',
  },

  actionCenter: {
    title: 'Action Center',
    subtitle: 'Dynamic task governance, real-time assignment, cross-module workflow tracking, and escalation management.',
    tabs: {
      internalTasks: 'Internal tasks',
      tickets: 'Tickets',
      approvals: 'Approvals',
      scorecard: 'Scorecard',
      buyersDirectory: 'Buyers Directory',
      sellersDirectory: 'Sellers Directory',
      registrations: 'Registrations',
      paymentDues: 'Payment Dues',
    },
    communicationModal: {
      modalTitle: 'Action Center Communication',
      modalSubtitle: 'Directly dispatch SMS alerts, official transactional emails, or multi-channel notices with real-time audit logging.',
      channelLabel: 'Notification Channel',
      channelEmail: 'Email',
      channelSms: 'SMS Direct',
      channelBoth: 'Both (Email & SMS)',
      recipientNameLabel: 'Recipient Name',
      recipientEmailLabel: 'Recipient Email',
      recipientPhoneLabel: 'Recipient Phone (+91)',
      subjectLabel: 'Subject Line',
      subjectPlaceholder: 'Enter communication subject...',
      messageLabel: 'Message Content',
      messagePlaceholder: 'Compose your official notification or alert message...',
      charCountLabel: '{chars} characters ({units} SMS unit)',
      charCountLabelPlural: '{chars} characters ({units} SMS units)',
      scheduleFollowupCheckbox: 'Schedule an automated follow-up internal task',
      followupDueDateLabel: 'Follow-up Due Date',
      followupPriorityLabel: 'Priority',
      followupAssigneeLabel: 'Assign Follow-up To',
      followupNotesLabel: 'Follow-up Remarks / Instructions',
      followupNotesPlaceholder: 'Instructions for the assignee when following up...',
      btnCancel: 'Cancel',
      btnSend: 'Dispatch Notification',
      btnSending: 'Dispatching...',
      validationEmailRequired: 'A valid recipient email address is required for Email dispatch.',
      validationPhoneRequired: 'A valid 10-digit Indian mobile number is required for SMS dispatch.',
      validationMessageRequired: 'Message content cannot be blank.',
      validationFollowupDueDateRequired: 'A due date is required when scheduling a follow-up task.',
      successToast: 'Communication successfully dispatched via {channel} and logged in Action Center.',
      partialSuccessToast: 'Communication recorded, but external gateway reported a delivery delay.',
      followupSchedulingWarning: 'Notification was dispatched successfully, but scheduling the follow-up task failed: {error}.',
      errorToast: 'Failed to dispatch communication. Please try again or check recipient details.',
    },

    registrationsDashboard: {
      title: 'Registered Clients',
      totalCountBadge: '{count} Total',
      sourceTypeLabel: 'Source Type:',
      allSources: 'All',
      webApp: 'Web App',
      whatsapp: 'WhatsApp',
      email: 'Email',
      searchPlaceholder: 'Search...',
      colUserName: 'User Name',
      colCompanyName: 'Company Name',
      colPhoneNumber: 'Phone Number',
      colUserEmail: 'User Email',
      colRegDate: 'Reg. Date',
      colStatus: 'Status',
      colSourceType: 'Source Type',
      colActions: 'Actions',
      loadingClients: 'Loading registrations...',
      noClientsFound: 'No registered clients found.',
      acceptTooltip: 'Accept',
      rejectTooltip: 'Reject',
      acceptSuccess: 'Client registration accepted successfully.',
      rejectSuccess: 'Client registration rejected.',
      actionError: 'Failed to process registration action.',
      statusAccepted: 'Accepted',
      statusRejected: 'Rejected',
    },
    tasks: {
      total: 'Total Tasks',
      pending: 'Pending Tasks',
      escalated: 'Escalated Tasks',
      completed: 'Completed Tasks',
      critical: 'Critical / Overdue',
      myItems: 'My Items',
      execWise: 'Executive-wise',
      allTasks: 'All Tasks',
      createTask: 'Create Internal Task',
      allUsers: 'All Users',
      myTasks: 'My Tasks',
      unassigned: 'Unassigned',
      selectAssignee: 'Select Assignee',
      assignedToUser: 'Assigned to {user}',
      customAssignee: '+ Add Custom Assignee',
      chooseExistingMember: 'Choose Existing Member',
      completeTaskModalTitle: 'Complete Internal Task',
      resolutionRemarksLabel: 'Resolution Remarks / Internal Notes',
      resolutionRemarksPlaceholder: 'Record handover remarks, resolution outcome, or follow-up notes...',
      completeTaskBtn: 'Complete Task',
      reopenTaskBtn: 'Reopen Task',
      taskMarkedCompleted: 'Task {taskNumber} marked as Completed',
      taskReopened: 'Task {taskNumber} reopened as Pending',
      filterByMember: 'Filter by Team Member',
    },
    tickets: {
      total: 'Total Tickets',
      pending: 'Pending Tickets',
      escalated: 'Escalated Tickets',
      completed: 'Completed Tickets',
      critical: 'Critical / High-Priority',
      createTicket: 'Create Ticket',
      searchPlaceholder: 'Search by ticket ID, subject, customer, or project...',
      noTicketsFound: 'No tickets found matching the selected filters.',
      escalateTitle: 'Escalate Ticket',
      detailsTitle: 'Ticket Details & Audit History',
      resolutionNotes: 'Resolution Notes',
      addComment: 'Add Note / Comment',
      saveTicket: 'Save Ticket',
      escalateAction: 'Escalate to Manager',
      resolveAction: 'Mark as Completed',
    },
    approvals: {
      pending: 'Pending Approvals',
      pendingSubtitle: 'Awaiting managerial decision',
      approved: 'Approved',
      approvedSubtitle: 'Cleared & updated live',
      rejected: 'Rejected',
      rejectedSubtitle: 'Declined & reverted',
      total: 'Total Requests',
      totalSubtitle: 'Lifetime audit transactions',
      allModules: 'All Modules',
      unitBookings: 'Unit Bookings',
      cancellations: 'Cancellations & Refunds',
      offlinePayments: 'Offline Payments',
      creditNotes: 'Credit Notes',
      packages: 'Packages',
      milestones: 'Milestones',
      configureRules: 'Configure Rules',
      approveBtn: 'Approve',
      rejectBtn: 'Reject',
      noApprovalsFound: 'No approval requests match the selected filters.',
    },
    scorecard: {
      teamLeaderboard: 'Complete Team (Leaderboard)',
      individualExecutive: 'Individual Executive',
      allProjects: 'All Projects',
      today: 'Today',
      thisWeek: 'This Week',
      thisMonth: 'This Month',
      lastMonth: 'Last Month',
      thisQuarter: 'This Qtr',
      financialYear: 'FY',
      customRange: 'Custom Range',
      allPillars: 'All Pillars',
      operationsPillar: 'Operations & Compliance',
      revenuePillar: 'Revenue & Banking',
      salesPillar: 'Sales & Customer Acquisition',
      teamScorecardTitle: 'Team Performance Scorecard',
      onTrack: 'On Track',
      needsFocus: 'Needs Focus',
      average: 'Average',
      viewDetails: 'View Details',
      progress: 'Progress',
      tasksCompleted: 'TASKS COMPLETED',
      ticketsCompleted: 'TICKETS COMPLETED',
      registrations: 'REGISTRATIONS',
      siteVisitsDone: 'SITE VISITS DONE',
      dueCollectedPending: 'DUE COLLECTED / PENDING',
      loansDisbursed: 'LOANS DISBURSED',
      loanRealized: 'LOAN REALIZED (₹)',
      leadsContacted: 'LEADS CONTACTED',
      leadVisitRate: 'LEAD -> VISIT RATE',
      visitConversion: 'VISIT CONVERSION',
      dealsClosed: 'DEALS CLOSED',
      rank: 'Rank',
      executive: 'Executive',
      tasks: 'Tasks',
      tickets: 'Tickets',
      registrationsCol: 'Registrations',
      siteVisitsCol: 'Site Visits',
      loansRealizedCol: 'Loans & Realized ₹',
      duesCollectedCol: 'Dues Collected',
      leadsDealsCol: 'Leads & Deals',
      conversionRatesCol: 'Conversion Rates',
      scoreCol: 'Score',
      performanceStatusCol: 'Performance Status',
      actionsCol: 'Actions',
      exportBtn: 'Export',
      teamMembersCount: '{count} Team Members',
      noDataFound: 'No scorecard data found for selected period and filters.',
      closeModal: 'Close',
      executivePerformanceTitle: 'Executive Performance Profile',
    },
    paymentDues: {
      title: 'Payment Dues – Low Credit Monitoring & Communication',
      subtitle: 'Identify, monitor, and notify Buyers and Sellers with low available credit balances (≤ 2 credits).',
      kpi: {
        totalLowCreditAccounts: 'Low-Credit Accounts',
        totalLowCreditSubtitle: 'All accounts with ≤ 2 credits',
        totalBuyers: 'Buyers',
        totalBuyersSubtitle: 'Buyers needing credit top-up',
        totalSellers: 'Sellers',
        totalSellersSubtitle: 'Sellers needing quotation credits',
        zeroCredits: '0 Credits (Critical)',
        zeroCreditsSubtitle: 'Completely exhausted credits',
        oneToTwoCredits: '1–2 Credits (Attention)',
        oneToTwoCreditsSubtitle: 'Low balance warning threshold',
        acknowledgementPending: 'Acknowledgement Pending',
        acknowledgementPendingSubtitle: 'Awaiting client response',
      },
      toolbar: {
        searchPlaceholder: 'Search company, contact person, email, phone, or account ID...',
        accountTypeFilter: 'Account Type',
        allTypes: 'All Types',
        buyersOnly: 'Buyers',
        sellersOnly: 'Sellers',
        creditsFilter: 'Credit Balance',
        allCredits: 'All Low Credits (≤ 2)',
        zeroCreditsOnly: '0 Credits',
        oneToTwoCreditsOnly: '1–2 Credits',
        statusFilter: 'Acknowledgement Status',
        allStatuses: 'All Acknowledgement Statuses',
        refresh: 'Refresh',
        resetFilters: 'Reset Filters',
        exportCsv: 'Export CSV',
        columnSettings: 'Customize Columns',
      },
      columns: {
        accountId: 'Account ID',
        accountType: 'Account Type',
        companyName: 'Company Name',
        contactPerson: 'Contact Person',
        email: 'Email',
        phoneNumber: 'Phone Number',
        availableCredits: 'Available Credits',
        totalCredits: 'Total Credits',
        creditsUsed: 'Credits Used',
        accountStatus: 'Account Status',
        registrationDate: 'Registration Date',
        lastActivity: 'Last Activity',
        assignedExecutive: 'Assigned Executive',
        lastNotification: 'Last Notification',
        notificationChannel: 'Notification Channel',
        acknowledgementStatus: 'Acknowledgement Status',
        actions: 'Actions',
      },
      actions: {
        sendEmail: 'Send Email',
        sendMessage: 'Send Message',
        sendWhatsApp: 'WhatsApp Notification',
        updateStatus: 'Update Acknowledgement',
        viewHistory: 'Communication History',
      },
      columnSettings: {
        title: 'Column Settings',
        description: 'Drag and drop to reorder columns. Toggle checkboxes to show or hide columns.',
        selectAll: 'Select All',
        hideAll: 'Hide All Optional',
        resetToDefault: 'Reset to Default',
      },
      modals: {
        emailTitle: 'Send Low-Credit Email Notification',
        emailRecipient: 'Recipient Email',
        emailSubject: 'Subject',
        emailMessage: 'Email Body',
        emailSend: 'Send Email',
        messageTitle: 'Send In-App Notification',
        messageTitleLabel: 'Notification Title',
        messageBodyLabel: 'Message Body',
        messageSend: 'Send Notification',
        whatsAppTitle: 'Send WhatsApp Notification',
        whatsAppNumber: 'WhatsApp Phone Number',
        whatsAppMessage: 'Message Text',
        whatsAppSend: 'Send via WhatsApp',
        whatsAppDirectLink: 'Open in WhatsApp Web / App',
        ackTitle: 'Update Acknowledgement Status',
        ackStatusLabel: 'New Acknowledgement Status',
        ackNotesLabel: 'Follow-up / Resolution Notes',
        ackSubmit: 'Save Status',
        historyTitle: 'Communication & Acknowledgement Audit Trail',
        noHistoryFound: 'No communication attempts recorded for this account yet.',
        cancel: 'Cancel',
        close: 'Close',
      },
      emptyState: 'No low-credit buyer or seller accounts found matching the current filters.',
    },
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

/**
 * Resolve a failed-extraction reason to a user-friendly, actionable message.
 *
 * Falls back to the generic unreadable-response copy when the reason is absent
 * or unrecognised, and prefers a specific server-supplied message when one was
 * returned, so the banner is always clear about why the document could not be
 * read and what to do next.
 */
export function extractionReasonMessage(
  reason?: RFQExtractionReason,
  serverMessage?: string
): string {
  if (serverMessage && serverMessage.trim()) return serverMessage;
  if (reason && UI_STRINGS.rfqExtraction.reasonMessages[reason]) {
    return UI_STRINGS.rfqExtraction.reasonMessages[reason];
  }
  return UI_STRINGS.rfqExtraction.unreadableResponse;
}
