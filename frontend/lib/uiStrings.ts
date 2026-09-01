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
    quoteMatrix: {
      title: 'Comparative Quote Evaluation Matrix',
      screenTag: 'Screen 1.3',
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
    otpRequired: 'Enter the 4-digit verification code that was emailed to you.',
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
    otpDispatched: 'A 4-digit verification code has been emailed to {email}. It expires in 10 minutes.',
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
