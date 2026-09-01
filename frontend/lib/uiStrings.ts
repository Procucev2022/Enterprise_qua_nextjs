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


  templates: {
    rfqDispatched: 'RFQ #{rfqNumber} successfully dispatched to {vendorCount} qualified vendors.',
    poGenerated: 'Purchase Order #{poNumber} created and committed to ERP.',
    ratingUpdated: 'Vendor rating for {vendorName} revised to {newScore}/100.',
    welcomeUser: 'Welcome back, {userName} ({userRole})',
    totalSpendSummary: 'Total analyzed spend: ₹{amount} across {categoryCount} categories.',
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
