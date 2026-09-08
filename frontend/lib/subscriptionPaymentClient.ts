import { authClient } from './authClient';
import { UI_STRINGS, formatString } from './uiStrings';
import type { PaymentLinkCreateResult } from './types';

/**
 * Create a real Zoho payment link for a vendor's `connect`/`select` subscription
 * upgrade. The caller redirects the browser to the returned `paymentUrl` — Zoho
 * hosts the actual payment page, so no card details ever reach this app.
 */
export async function createPaymentLink(vendorId: string, plan: string): Promise<PaymentLinkCreateResult> {
  const token = authClient.getToken();

  let res: Response;
  try {
    res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}/payment-link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ plan }),
    });
  } catch {
    return { success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable };
  }

  let body: { success?: boolean; data?: { paymentUrl?: string; paymentLinkId?: string; status?: string }; error?: string } = {};
  try {
    body = await res.json();
  } catch {
    return {
      success: false,
      reason: 'NETWORK',
      error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }),
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { success: false, reason: 'UNAUTHORIZED', error: body.error || UI_STRINGS.auth.sessionExpired };
  }
  if (!res.ok || !body.success || !body.data || !body.data.paymentUrl) {
    return {
      success: false,
      reason: res.status === 400 ? 'VALIDATION' : 'SERVER',
      error: body.error || UI_STRINGS.rfqDetails.loadFailed,
    };
  }

  return {
    success: true,
    paymentUrl: body.data.paymentUrl,
    paymentLinkId: body.data.paymentLinkId || '',
    status: body.data.status || '',
  };
}

/**
 * Create a real Zoho payment link for a buyer's version_1/2/3 subscription
 * upgrade. Same shape/error-handling as `createPaymentLink` (vendor); a
 * separate function because it hits a different endpoint scoped to the
 * buyer account rather than the vendor record.
 */
export async function createBuyerPaymentLink(buyerAccountId: string, plan: string): Promise<PaymentLinkCreateResult> {
  const token = authClient.getToken();

  let res: Response;
  try {
    res = await fetch(`/api/buyer-accounts/${encodeURIComponent(buyerAccountId)}/subscription-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ plan }),
    });
  } catch {
    return { success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable };
  }

  let body: { success?: boolean; data?: { paymentUrl?: string; paymentLinkId?: string; status?: string }; error?: string } = {};
  try {
    body = await res.json();
  } catch {
    return {
      success: false,
      reason: 'NETWORK',
      error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }),
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { success: false, reason: 'UNAUTHORIZED', error: body.error || UI_STRINGS.auth.sessionExpired };
  }
  if (!res.ok || !body.success || !body.data || !body.data.paymentUrl) {
    return {
      success: false,
      reason: res.status === 400 ? 'VALIDATION' : 'SERVER',
      error: body.error || UI_STRINGS.rfqDetails.loadFailed,
    };
  }

  return {
    success: true,
    paymentUrl: body.data.paymentUrl,
    paymentLinkId: body.data.paymentLinkId || '',
    status: body.data.status || '',
  };
}
