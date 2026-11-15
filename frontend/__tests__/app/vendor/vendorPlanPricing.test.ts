import {
  catalogueFeatureCopy,
  formatVendorPlanAmount,
  getPaidVendorPlanPrice,
  getPaidVendorPlanRfqQuota,
  getVendorCatalogueLimit,
  paidPlanDisplayName,
  paidPlanQuotaCopy,
  pricePlaceholderLabel,
  rfqQuotaFeatureCopy,
} from '@/app/vendor/vendorPlanPricing';
import type { SubscriptionPricingResponse } from '@/lib/subscriptionPaymentClient';
import { UI_STRINGS } from '@/lib/uiStrings';

const COPY = UI_STRINGS.vendorWorkspace;

function pricingWith(seller: Record<string, unknown>, extra: Record<string, unknown> = {}): SubscriptionPricingResponse {
  return { seller, ...extra } as unknown as SubscriptionPricingResponse;
}

describe('vendor plan pricing helpers', () => {
  test('shows a placeholder while prices load and a failure label once they have failed', () => {
    expect(pricePlaceholderLabel(false)).toBe(COPY.priceLoading);
    expect(pricePlaceholderLabel(true)).toBe(COPY.priceUnavailable);
  });

  test('formats an amount in rupees, and shows a dash when the amount is missing or not finite', () => {
    expect(formatVendorPlanAmount(8849.4)).toBe('₹8,849');
    expect(formatVendorPlanAmount(undefined)).toBe('—');
    expect(formatVendorPlanAmount(Number.NaN)).toBe('—');
  });

  test('reads the 12-month price with its GST percentage', () => {
    const price = getPaidVendorPlanPrice(
      pricingWith({ connect: { '12_months': { totalWithGst: 8849, baseDurationPrice: 7499, gstAmount: 1350 } } }, { gstPercent: 18 }),
      'connect'
    );
    expect(price).toEqual({ totalWithGst: '₹8,849', basePrice: '₹7,499', gstAmount: '₹1,350', gstLabel: '18%' });
  });

  test('labels GST generically when the GST percentage is not returned', () => {
    const price = getPaidVendorPlanPrice(pricingWith({ connect: { '12_months': { totalWithGst: 1, baseDurationPrice: 1, gstAmount: 0 } } }), 'connect');
    expect(price?.gstLabel).toBe('GST');
  });

  test('returns no price when the response, the plan, the 12-month row or any amount is missing', () => {
    expect(getPaidVendorPlanPrice(null, 'connect')).toBeNull();
    expect(getPaidVendorPlanPrice(pricingWith({}), 'select')).toBeNull();
    expect(getPaidVendorPlanPrice(pricingWith({ select: { '12_months': { totalWithGst: 1, baseDurationPrice: 1 } } }), 'select')).toBeNull();
  });

  test('reads a plan limit only when the pricing API returns a positive number', () => {
    expect(getPaidVendorPlanRfqQuota(pricingWith({ connect: { rfqQuota: 50.9 } }), 'connect')).toBe(50);
    expect(getPaidVendorPlanRfqQuota(pricingWith({ connect: { rfqQuota: 0 } }), 'connect')).toBeNull();
    expect(getPaidVendorPlanRfqQuota(pricingWith({ connect: { rfqQuota: '50' } }), 'connect')).toBeNull();
    expect(getPaidVendorPlanRfqQuota(pricingWith({ connect: 'not-a-plan' }), 'connect')).toBeNull();
    expect(getPaidVendorPlanRfqQuota(pricingWith({}), 'connect')).toBeNull();
    expect(getPaidVendorPlanRfqQuota(null, 'connect')).toBeNull();
    expect(getVendorCatalogueLimit(pricingWith({ select: { catalogueLimit: 100 } }))).toBe(100);
    expect(getVendorCatalogueLimit(pricingWith({ select: { catalogueLimit: -1 } }))).toBeNull();
    expect(getVendorCatalogueLimit(null)).toBeNull();
  });

  test('names a paid plan and describes its quota with the count when it is known, and without one when it is not', () => {
    expect(paidPlanDisplayName('connect', 50)).toBe('Connect Model (50 RFQs / 3 Months)');
    expect(paidPlanDisplayName('connect', null)).toBe(COPY.connectPlanName);
    expect(paidPlanDisplayName('select', 100)).toBe('Select Model (Catalogue & 100 RFQs / 3 Months)');
    expect(paidPlanDisplayName('select', null)).toBe(COPY.selectPlanName);

    expect(paidPlanQuotaCopy('connect', 50)).toBe('Quote and download up to 50 RFQs in 3 months from the Marketplace.');
    expect(paidPlanQuotaCopy('connect', null)).toBe(COPY.connectQuotaWithoutCount);
    expect(paidPlanQuotaCopy('select', 100)).toBe('Item Catalogue + 100 RFQs / 3 months.');
    expect(paidPlanQuotaCopy('select', null)).toBe(COPY.selectQuotaWithoutCount);

    expect(rfqQuotaFeatureCopy(50)).toBe('Download up to 50 RFQs within 3 months (90-day period)');
    expect(rfqQuotaFeatureCopy(null)).toBe(COPY.rfqQuotaFeatureWithoutCount);
    expect(catalogueFeatureCopy(100)).toBe('Vendor Item Catalogue: Host up to 100 products (SKUs, MOQs & Specs)');
    expect(catalogueFeatureCopy(null)).toBe(COPY.catalogueFeatureWithoutCount);
  });
});
