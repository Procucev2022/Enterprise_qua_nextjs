import { productMatchesOpportunity } from '@/app/vendor/catalogueMatching';
import type { VendorOpportunity } from '@/lib/types';

function opportunity(overrides: Partial<VendorOpportunity> = {}): VendorOpportunity {
  return { id: 'opp-1', rfqNumber: 'RFQ-1', title: 'Centrifugal Water Pumps', buyer: 'Acme Corp', ...overrides } as VendorOpportunity;
}

describe('productMatchesOpportunity', () => {
  test('matches a product whose name keyword appears in the opportunity title', () => {
    expect(productMatchesOpportunity({ name: 'Centrifugal Pump' }, opportunity())).toBe(true);
  });

  test('matches on a category keyword that appears in the buyer name', () => {
    expect(productMatchesOpportunity({ category: 'Acme', specs: '' }, opportunity())).toBe(true);
  });

  test('does not match when no product keyword appears in the opportunity', () => {
    expect(productMatchesOpportunity({ name: 'Gate Valve' }, opportunity())).toBe(false);
  });

  test('ignores words of three characters or fewer', () => {
    expect(productMatchesOpportunity({ name: 'Ace Gas Kit' }, opportunity())).toBe(false);
  });

  test('treats missing, null and empty name, category and specs as no keywords', () => {
    expect(productMatchesOpportunity({}, opportunity())).toBe(false);
    expect(productMatchesOpportunity({ name: '', category: null, specs: undefined }, opportunity())).toBe(false);
  });
});
