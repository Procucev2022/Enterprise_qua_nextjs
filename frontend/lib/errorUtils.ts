/**
 * Enterprise Descriptive UI Error Messaging Utility
 * Transforms raw API responses, network exceptions, and validation failures
 * into rich, actionable user-facing error diagnostics with clear recovery paths.
 */

export type ErrorCategory =
  | 'VALIDATION'
  | 'NETWORK'
  | 'DATABASE_SYNC'
  | 'AUTHENTICATION'
  | 'BUSINESS_LOGIC'
  | 'SYSTEM';

export interface DescriptiveUIError {
  category: ErrorCategory;
  title: string;
  message: string;
  details?: string;
  actionText?: string;
  actionType?: 'RETRY' | 'CHECK_NETWORK' | 'LOGIN' | 'CONTACT_SUPPORT' | 'FIX_INPUT' | 'SWITCH_MODE';
  fieldErrors?: Record<string, string>;
  isRecoverable: boolean;
  timestamp: string;
}

/**
 * Parses and formats any error into a rich, descriptive user-facing error payload.
 */
export function formatDescriptiveErrorMessage(
  error: any,
  context: string = 'General Operation'
): DescriptiveUIError {
  const timestamp = new Date().toISOString();
  const rawMessage = typeof error === 'string' ? error : error?.message || error?.error || '';
  const status = error?.status || error?.statusCode;

  // 1. Validation & Input Format Errors
  if (
    error?.fieldErrors ||
    /validation|invalid gstin|invalid email|required field|invalid mobile|exceeds maximum/i.test(rawMessage) ||
    status === 400
  ) {
    return {
      category: 'VALIDATION',
      title: 'Form Validation Incomplete',
      message: rawMessage || 'One or more required fields contain invalid data or are missing.',
      details: `Please review highlighted form inputs and adjust values according to required formats (e.g. valid GSTIN, valid email format, and positive numeric quantities).`,
      actionText: 'Review Form Fields',
      actionType: 'FIX_INPUT',
      fieldErrors: error?.fieldErrors || {},
      isRecoverable: true,
      timestamp,
    };
  }

  // 2. Database & Sync Failures (Checked before generic network)
  if (
    /database|postgres|pool|sync failed|foreign key|unique constraint/i.test(rawMessage) ||
    status === 503
  ) {
    return {
      category: 'DATABASE_SYNC',
      title: 'Database Synchronization Delayed',
      message: 'Persistent storage sync encountered a temporary lock or latency bottleneck.',
      details: 'Your changes have been safely preserved in browser local storage and will automatically resync once the database connection settles.',
      actionText: 'Trigger Resync',
      actionType: 'RETRY',
      isRecoverable: true,
      timestamp,
    };
  }

  // 3. Network & Offline Failures
  if (
    /failed to fetch|networkerror|econnrefused|offline|timeout|fetch failed/i.test(rawMessage) ||
    status === 504 ||
    (typeof navigator !== 'undefined' && !navigator.onLine)
  ) {
    return {
      category: 'NETWORK',
      title: 'Network Connectivity Disrupted',
      message: 'Unable to reach the Procucev enterprise API services.',
      details: 'Check your local internet connection or VPN settings. Offline local cache is currently serving read-only data.',
      actionText: 'Retry Connection',
      actionType: 'RETRY',
      isRecoverable: true,
      timestamp,
    };
  }

  // 4. Authentication & Permissions
  if (
    /unauthorized|forbidden|jwt expired|invalid token|access denied|session expired/i.test(rawMessage) ||
    status === 401 ||
    status === 403
  ) {
    return {
      category: 'AUTHENTICATION',
      title: 'Authentication Required or Expired',
      message: 'Your enterprise session has expired or your current role lacks necessary permissions.',
      details: 'Please re-verify your corporate email via OTP or switch to an authorized administrative profile to complete this action.',
      actionText: 'Sign In Again',
      actionType: 'LOGIN',
      isRecoverable: true,
      timestamp,
    };
  }

  // 5. Business Logic & SLA / Sourcing Mode Constraints
  if (
    /budget exceeded|rfq deadline expired|mode constraint|minimum quote requirement|no available vendors/i.test(rawMessage)
  ) {
    return {
      category: 'BUSINESS_LOGIC',
      title: 'Workflow Policy Constraint',
      message: rawMessage || 'This operation violates active procurement workflow rules.',
      details: `The requested action cannot be executed under current sourcing mode policies. Verify allocated budget limits or adjust RFQ deadline parameters in your Command Center.`,
      actionText: 'Modify RFQ Parameters',
      actionType: 'SWITCH_MODE',
      isRecoverable: true,
      timestamp,
    };
  }

  // 6. Generic / System Fallback
  return {
    category: 'SYSTEM',
    title: `${context} Error`,
    message: rawMessage || 'An unexpected operational anomaly occurred while processing your request.',
    details: 'The incident has been logged with full stack trace telemetry for automated self-healing. If problem persists, contact enterprise support.',
    actionText: 'Contact Enterprise Support',
    actionType: 'CONTACT_SUPPORT',
    isRecoverable: false,
    timestamp,
  };
}
