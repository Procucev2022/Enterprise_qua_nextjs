import type { SubscriptionPricingPlanData, SubscriptionPricingResponse } from '@/lib/subscriptionPaymentClient';

// Display helpers for buyer plan prices. Every amount comes from the pricing
// response of GET /api/subscriptions/pricing. Nothing here holds a price.

export type BillingDuration = '6_months' | '12_months';
export type BuyerPlanId = 'version_1' | 'version_2' | 'version_3';

const BILLING_MONTHS: Record<BillingDuration, number> = {
  '6_months': 6,
  '12_months': 12,
};

const formatInr = (value: number): string => `₹${Math.round(value).toLocaleString('en-IN')}`;

const formatInrDecimal = (value: number): string =>
  `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function buildPlanPriceView(planData: SubscriptionPricingPlanData, duration: BillingDuration) {
  const months = BILLING_MONTHS[duration];
  return {
    price: formatInr(planData.price),
    label: 'per month',
    baseDurationLabel: `${formatInr(planData.baseDurationPrice)} (${formatInr(planData.price)} × ${months} months)`,
    gstAmount: formatInrDecimal(planData.gstAmount),
    totalPriceWithGst: formatInrDecimal(planData.totalWithGst),
  };
}

export type BuyerPlanPriceView = ReturnType<typeof buildPlanPriceView>;

/** The display values for one plan and duration, or null when the server did not price it. */
export function getBuyerPlanPrice(
  config: SubscriptionPricingResponse | null,
  plan: BuyerPlanId,
  duration: BillingDuration
): BuyerPlanPriceView | null {
  const planData = config?.buyer?.[plan]?.[duration];
  return planData ? buildPlanPriceView(planData, duration) : null;
}

/** GST rate reported by the server, or null when no pricing was loaded. */
export function getBuyerGstPercent(config: SubscriptionPricingResponse | null): number | null {
  return config && Number.isFinite(config.gstPercent) ? config.gstPercent : null;
}

/**
 * Percentage the 12-month monthly price saves against the 6-month monthly price,
 * or null when either price is missing or the 12-month price is not lower.
 */
export function getTwelveMonthSavingPercent(
  config: SubscriptionPricingResponse | null,
  plan: BuyerPlanId
): number | null {
  const sixMonthPrice = config?.buyer?.[plan]?.['6_months']?.price;
  const twelveMonthPrice = config?.buyer?.[plan]?.['12_months']?.price;
  if (!sixMonthPrice || !twelveMonthPrice || twelveMonthPrice >= sixMonthPrice) return null;
  return Math.round(((sixMonthPrice - twelveMonthPrice) / sixMonthPrice) * 100);
}
