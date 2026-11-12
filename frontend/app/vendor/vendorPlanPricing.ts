import type { SubscriptionPricingResponse } from '@/lib/subscriptionPaymentClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';

/** The paid vendor tiers that are sold through a Zoho payment link. */
export type PaidVendorPlanId = 'connect' | 'select';

const NOT_AVAILABLE_LABEL = '—';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Text shown in place of a plan price while the pricing API has not answered, or has failed. */
export function pricePlaceholderLabel(pricingFailed: boolean): string {
  return pricingFailed ? UI_STRINGS.vendorWorkspace.priceUnavailable : UI_STRINGS.vendorWorkspace.priceLoading;
}

/** Formats a rupee amount for display, or a dash when the amount was not returned. */
export function formatVendorPlanAmount(value: unknown): string {
  return isFiniteNumber(value) ? `₹${Math.round(value).toLocaleString('en-IN')}` : NOT_AVAILABLE_LABEL;
}

/**
 * The 12-month price of a paid vendor tier, read from the pricing API response.
 * Returns null when the response is missing or any of the three amounts is absent,
 * so callers show a dash or block payment instead of falling back to a fixed price.
 */
export function getPaidVendorPlanPrice(pricing: SubscriptionPricingResponse | null, plan: PaidVendorPlanId) {
  const row = pricing?.seller?.[plan]?.['12_months'];
  if (!row) return null;
  if (!isFiniteNumber(row.totalWithGst) || !isFiniteNumber(row.baseDurationPrice) || !isFiniteNumber(row.gstAmount)) {
    return null;
  }
  const gstPercent = pricing?.gstPercent;
  return {
    totalWithGst: formatVendorPlanAmount(row.totalWithGst),
    basePrice: formatVendorPlanAmount(row.baseDurationPrice),
    gstAmount: formatVendorPlanAmount(row.gstAmount),
    gstLabel: isFiniteNumber(gstPercent) ? `${gstPercent}%` : 'GST',
  };
}

/**
 * Reads a plan limit that the pricing API returns on a seller plan entry. The API may omit
 * it, so a missing or non-positive value is null, and the copy built from it names no number.
 */
function readSellerPlanLimit(
  pricing: SubscriptionPricingResponse | null,
  plan: PaidVendorPlanId,
  field: 'rfqQuota' | 'catalogueLimit'
): number | null {
  const entry: unknown = pricing?.seller?.[plan];
  if (typeof entry !== 'object' || entry === null) return null;
  const value: unknown = (entry as Record<string, unknown>)[field];
  return isFiniteNumber(value) && value > 0 ? Math.floor(value) : null;
}

/** RFQ downloads a paid tier includes per 3-month period, or null when the pricing API does not return it. */
export function getPaidVendorPlanRfqQuota(pricing: SubscriptionPricingResponse | null, plan: PaidVendorPlanId): number | null {
  return readSellerPlanLimit(pricing, plan, 'rfqQuota');
}

/** Product limit of the Select tier's item catalogue, or null when the pricing API does not return it. */
export function getVendorCatalogueLimit(pricing: SubscriptionPricingResponse | null): number | null {
  return readSellerPlanLimit(pricing, 'select', 'catalogueLimit');
}

/** Name of a paid tier as shown in the payment dialog. */
export function paidPlanDisplayName(plan: PaidVendorPlanId, rfqQuota: number | null): string {
  const copy = UI_STRINGS.vendorWorkspace;
  if (plan === 'connect') {
    return rfqQuota !== null ? formatString(copy.connectPlanNameWithCount, { count: rfqQuota }) : copy.connectPlanName;
  }
  return rfqQuota !== null ? formatString(copy.selectPlanNameWithCount, { count: rfqQuota }) : copy.selectPlanName;
}

/** One-line description of a paid tier's RFQ download quota. */
export function paidPlanQuotaCopy(plan: PaidVendorPlanId, rfqQuota: number | null): string {
  const copy = UI_STRINGS.vendorWorkspace;
  if (plan === 'connect') {
    return rfqQuota !== null ? formatString(copy.connectQuotaWithCount, { count: rfqQuota }) : copy.connectQuotaWithoutCount;
  }
  return rfqQuota !== null ? formatString(copy.selectQuotaWithCount, { count: rfqQuota }) : copy.selectQuotaWithoutCount;
}

/** Feature line for the RFQ download quota on a plan card. */
export function rfqQuotaFeatureCopy(rfqQuota: number | null): string {
  const copy = UI_STRINGS.vendorWorkspace;
  return rfqQuota !== null ? formatString(copy.rfqQuotaFeatureWithCount, { count: rfqQuota }) : copy.rfqQuotaFeatureWithoutCount;
}

/** Feature line for the catalogue product limit on the Select card. */
export function catalogueFeatureCopy(catalogueLimit: number | null): string {
  const copy = UI_STRINGS.vendorWorkspace;
  return catalogueLimit !== null
    ? formatString(copy.catalogueFeatureWithCount, { count: catalogueLimit })
    : copy.catalogueFeatureWithoutCount;
}
