// ==============================================================================
// EMAIL INGESTION GATEWAY TRANSPORT
// ==============================================================================
// Reads the state of the autonomous mailbox watcher, and triggers an immediate
// check so the feature can be exercised without waiting out the poll interval.
//
// Both calls fail closed and describe what went wrong: the gateway panel is how a
// buyer finds out whether their forwarded requisition is going to be picked up, so
// reporting a healthy gateway when the API is unreachable would be worse than
// reporting nothing.
// ==============================================================================

import { authClient } from './authClient';
import { UI_STRINGS, formatString } from './uiStrings';
import type { EmailGatewayPollResult, EmailGatewayStatus } from './types';

function authHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface EmailGatewayStatusResult {
  success: boolean;
  data?: EmailGatewayStatus;
  error?: string;
}

export interface EmailGatewayPollOutcome {
  success: boolean;
  data?: EmailGatewayPollResult;
  error?: string;
}

/** Current gateway state: configured, watching, last poll, recent messages. */
export async function fetchEmailGatewayStatus(): Promise<EmailGatewayStatusResult> {
  let res: Response;
  try {
    res = await fetch('/api/rfqs/email-gateway/status', { headers: authHeaders() });
  } catch {
    return { success: false, error: UI_STRINGS.auth.networkUnreachable };
  }

  if (res.status >= 500) {
    return {
      success: false,
      error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }),
    };
  }

  let body: EmailGatewayStatusResult = { success: false };
  try {
    body = (await res.json()) as EmailGatewayStatusResult;
  } catch {
    return { success: false, error: UI_STRINGS.rfqExtraction.unreadableResponse };
  }

  if (!res.ok || !body.success || !body.data) {
    return { success: false, error: body.error || UI_STRINGS.emailGateway.statusUnavailable };
  }
  return { success: true, data: body.data };
}

/**
 * Check the mailbox now.
 *
 * A 409 means the gateway is switched off or a check is already running — an
 * expected state rather than a fault, and the server's own wording explains which.
 */
export async function pollEmailGateway(): Promise<EmailGatewayPollOutcome> {
  let res: Response;
  try {
    res = await fetch('/api/rfqs/email-gateway/poll', { method: 'POST', headers: authHeaders() });
  } catch {
    return { success: false, error: UI_STRINGS.auth.networkUnreachable };
  }

  let body: EmailGatewayPollOutcome = { success: false };
  try {
    body = (await res.json()) as EmailGatewayPollOutcome;
  } catch {
    return { success: false, error: UI_STRINGS.rfqExtraction.unreadableResponse };
  }

  if (!res.ok || !body.success || !body.data) {
    return { success: false, error: body.error || UI_STRINGS.emailGateway.pollFailed };
  }
  return { success: true, data: body.data };
}
