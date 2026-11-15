import { authClient } from './authClient';
import { UI_STRINGS, formatString } from './uiStrings';
import { logger } from './logger';
import type { PaymentLinkCreateResult } from './types';

const SUBSCRIPTION_PAYMENT_LOG_CATEGORY = 'SUBSCRIPTION_PAYMENT_CLIENT';

function logSubscriptionPaymentFailure(
  operation: string,
  error: unknown,
  metadata: Record<string, unknown> = {}
): void {
  const errorDetails = error instanceof Error
    ? { error, errorName: error.name, errorMessage: error.message }
    : { errorName: 'UnknownError', errorMessage: 'Non-Error subscription payment failure' };
  logger.error(`Subscription payment ${operation} failed`, { ...errorDetails, ...metadata }, SUBSCRIPTION_PAYMENT_LOG_CATEGORY);
}

function logSubscriptionPaymentResponseFailure(
  operation: string,
  status: number,
  failureKind: string
): void {
  const httpFailure = status < 200 || status >= 300;
  logSubscriptionPaymentFailure(operation, new Error(httpFailure ? `HTTP ${status}` : 'Payment API response was incomplete'), {
    status,
    failureKind,
    errorName: httpFailure ? 'HttpError' : 'InvalidPaymentResponse',
  });
}

/**
 * Create a real Zoho payment link for a vendor's `connect`/`select` subscription
 * upgrade. The caller redirects the browser to the returned `paymentUrl` — Zoho
 * hosts the actual payment page, so no card details ever reach this app.
 */
export async function createPaymentLink(
  vendorId: string,
  plan: string,
  billingDuration?: '6_months' | '12_months'
): Promise<PaymentLinkCreateResult> {
  const token = authClient.getToken();

  let res: Response;
  try {
    res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}/payment-link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(billingDuration ? { plan, billingDuration } : { plan }),
    });
  } catch (error: unknown) {
    logSubscriptionPaymentFailure('vendor link request', error, { accountType: 'vendor', method: 'POST' });
    return { success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable };
  }

  let body: { success?: boolean; data?: { paymentUrl?: string; paymentLinkId?: string; status?: string }; error?: string } = {};
  try {
    body = await res.json();
  } catch (error: unknown) {
    logSubscriptionPaymentFailure('vendor link response parsing', error, { accountType: 'vendor', status: res.status });
    return {
      success: false,
      reason: 'NETWORK',
      error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }),
    };
  }

  if (res.status === 401 || res.status === 403) {
    logSubscriptionPaymentResponseFailure('vendor link creation', res.status, 'UNAUTHORIZED');
    return { success: false, reason: 'UNAUTHORIZED', error: body.error || UI_STRINGS.auth.sessionExpired };
  }
  if (!res.ok || !body.success || !body.data || !body.data.paymentUrl) {
    logSubscriptionPaymentResponseFailure(
      'vendor link creation',
      res.status,
      res.status === 400 ? 'VALIDATION' : res.ok ? 'INVALID_RESPONSE' : 'SERVER'
    );
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
 * Look up the real, current status ('CREATED' | 'PAID' | 'CANCELED' | 'EXPIRED')
 * of one of a vendor's own payment links by its id — used on return from
 * Zoho's hosted checkout to show an accurate outcome instead of trusting a
 * client-controlled query param (Zoho redirects to the same return_url on
 * both a completed payment and a cancellation, so the URL alone can't tell
 * them apart). Returns null on any failure — callers fall back to a neutral
 * "still processing" message rather than guessing.
 */
export async function getVendorPaymentLinkStatus(vendorId: string, linkId: string): Promise<string | null> {
  const token = authClient.getToken();
  try {
    const res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}/payment-links`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    let body: { success?: boolean; data?: unknown } | null;
    try {
      body = await res.json();
    } catch (error: unknown) {
      logSubscriptionPaymentFailure('vendor link status response parsing', error, { accountType: 'vendor', status: res.status });
      return null;
    }
    if (!res.ok) {
      logSubscriptionPaymentResponseFailure('vendor link status lookup', res.status, 'SERVER');
      return null;
    }
    if (!body?.success || !Array.isArray(body.data)) {
      logSubscriptionPaymentResponseFailure('vendor link status lookup', res.status, 'INVALID_RESPONSE');
      return null;
    }
    const match = body.data.find((l: { id?: string; status?: string }) => l.id === linkId);
    return match?.status || null;
  } catch (error: unknown) {
    logSubscriptionPaymentFailure('vendor link status lookup', error, { accountType: 'vendor' });
    return null;
  }
}

/** Buyer-account equivalent of getVendorPaymentLinkStatus — see its docstring. */
export async function getBuyerPaymentLinkStatus(buyerAccountId: string, linkId: string): Promise<string | null> {
  const token = authClient.getToken();
  try {
    const res = await fetch(`/api/buyer-accounts/${encodeURIComponent(buyerAccountId)}/payment-links`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    let body: { success?: boolean; data?: unknown } | null;
    try {
      body = await res.json();
    } catch (error: unknown) {
      logSubscriptionPaymentFailure('buyer link status response parsing', error, { accountType: 'buyer', status: res.status });
      return null;
    }
    if (!res.ok) {
      logSubscriptionPaymentResponseFailure('buyer link status lookup', res.status, 'SERVER');
      return null;
    }
    if (!body?.success || !Array.isArray(body.data)) {
      logSubscriptionPaymentResponseFailure('buyer link status lookup', res.status, 'INVALID_RESPONSE');
      return null;
    }
    const match = body.data.find((l: { id?: string; status?: string }) => l.id === linkId);
    return match?.status || null;
  } catch (error: unknown) {
    logSubscriptionPaymentFailure('buyer link status lookup', error, { accountType: 'buyer' });
    return null;
  }
}

/**
 * Create a real Zoho payment link for a buyer's version_1/2/3 subscription
 * upgrade. Same shape/error-handling as `createPaymentLink` (vendor); a
 * separate function because it hits a different endpoint scoped to the
 * buyer account rather than the vendor record.
 */
export async function createBuyerPaymentLink(
  buyerAccountId: string,
  plan: string,
  billingDuration: '6_months' | '12_months' = '12_months'
): Promise<PaymentLinkCreateResult> {
  const token = authClient.getToken();

  let res: Response;
  try {
    res = await fetch(`/api/buyer-accounts/${encodeURIComponent(buyerAccountId)}/subscription-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ plan, billingDuration }),
    });
  } catch (error: unknown) {
    logSubscriptionPaymentFailure('buyer link request', error, { accountType: 'buyer', method: 'POST' });
    return { success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable };
  }

  let body: { success?: boolean; data?: { paymentUrl?: string; paymentLinkId?: string; status?: string }; error?: string } = {};
  try {
    body = await res.json();
  } catch (error: unknown) {
    logSubscriptionPaymentFailure('buyer link response parsing', error, { accountType: 'buyer', status: res.status });
    return {
      success: false,
      reason: 'NETWORK',
      error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }),
    };
  }

  if (res.status === 401 || res.status === 403) {
    logSubscriptionPaymentResponseFailure('buyer link creation', res.status, 'UNAUTHORIZED');
    return { success: false, reason: 'UNAUTHORIZED', error: body.error || UI_STRINGS.auth.sessionExpired };
  }
  if (!res.ok || !body.success || !body.data || !body.data.paymentUrl) {
    logSubscriptionPaymentResponseFailure(
      'buyer link creation',
      res.status,
      res.status === 400 ? 'VALIDATION' : res.ok ? 'INVALID_RESPONSE' : 'SERVER'
    );
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

export interface SubscriptionPricingPlanData {
  price: number;
  baseDurationPrice: number;
  gstAmount: number;
  totalWithGst: number;
}

export interface SubscriptionPricingResponse {
  gstPercent: number;
  gstRate: number;
  buyer: Record<string, Record<string, SubscriptionPricingPlanData>>;
  seller: Record<string, Record<string, SubscriptionPricingPlanData>>;
}

export async function fetchSubscriptionPricing(): Promise<SubscriptionPricingResponse | null> {
  try {
    const res = await fetch('/api/subscriptions/pricing');
    let body: { success?: boolean; data?: unknown } | null;
    try {
      body = await res.json();
    } catch (error: unknown) {
      logSubscriptionPaymentFailure('pricing response parsing', error, { status: res.status });
      return null;
    }
    if (!res.ok) {
      logSubscriptionPaymentResponseFailure('pricing fetch', res.status, 'SERVER');
      return null;
    }
    if (res.ok && body?.success && body?.data) {
      return body.data as SubscriptionPricingResponse;
    }
    logSubscriptionPaymentResponseFailure('pricing fetch', res.status, 'INVALID_RESPONSE');
    return null;
  } catch (error: unknown) {
    logSubscriptionPaymentFailure('pricing fetch', error);
    return null;
  }
}

