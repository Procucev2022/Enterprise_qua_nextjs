import {
  normalizeCategory,
  extractRfqCategorySignals,
  matchVendorAgainstSignals,
  getCategoryMatchedProcucevVendors,
} from '@/lib/vendorMatching';
import type { VendorEntry } from '@/lib/types';

describe('vendorMatching module', () => {
  describe('normalizeCategory', () => {
    it('normalizes casing, ampersands, whitespace and punctuation', () => {
      expect(normalizeCategory('Hoses, Valves & Fittings')).toBe('hoses valves and fittings');
      expect(normalizeCategory('  MECHANICAL / ELECTRICAL  ')).toBe('mechanical electrical');
      expect(normalizeCategory('')).toBe('');
      expect(normalizeCategory(null)).toBe('');
    });
  });

  describe('extractRfqCategorySignals', () => {
    it('extracts unique category signals from header and line items', () => {
      const form = {
        majorCategory: 'Mechanical',
        minorCategory: 'Centrifugal Pumps',
        category: 'Pumps',
        lineItems: [
          { majorCategory: 'Mechanical', minorCategory: 'Centrifugal Pumps' },
          { majorCategory: 'Electrical', minorCategory: 'Motors & Drives' },
        ],
      };

      const { signals, rawSignals } = extractRfqCategorySignals(form);
      expect(rawSignals).toContain('Mechanical');
      expect(rawSignals).toContain('Centrifugal Pumps');
      expect(rawSignals).toContain('Motors & Drives');
      expect(signals).toContain('mechanical');
      expect(signals).toContain('centrifugal pumps');
      expect(signals).toContain('motors and drives');
    });

    it('handles empty forms safely', () => {
      const { signals, rawSignals } = extractRfqCategorySignals({});
      expect(signals).toEqual([]);
      expect(rawSignals).toEqual([]);
    });
  });

  describe('matchVendorAgainstSignals', () => {
    const mockVendor = {
      id: 'proc-1',
      name: 'Apex Pumps & Valves Ltd',
      majorCategory: 'Engineering Spares - Mechanical',
      minorCategories: ['Centrifugal Pumps', 'Gate Valves'],
      vendorSelectedCategories: ['Industrial Fluid Handling'],
      clientMappedCategories: [],
      rating: 4.8,
      source: 'procucev_network',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      contactPerson: 'Apex Contact',
      phone: '+91 9876543210',
      email: 'sales@apexpumps.com',
      location: 'Mumbai',
    } as unknown as VendorEntry;

    it('matches when vendor minor category matches signal with high score', () => {
      const result = matchVendorAgainstSignals(mockVendor, ['centrifugal pumps']);
      expect(result.isMatch).toBe(true);
      expect(result.matchScore).toBe(98);
      expect(result.matchedCategories).toContain('Centrifugal Pumps');
    });

    it('matches when vendor major category matches signal', () => {
      const result = matchVendorAgainstSignals(mockVendor, ['engineering spares mechanical']);
      expect(result.isMatch).toBe(true);
      expect(result.matchScore).toBe(95);
    });

    it('returns isMatch false when no category signals overlap', () => {
      const result = matchVendorAgainstSignals(mockVendor, ['civil and structural steel', 'cement']);
      expect(result.isMatch).toBe(false);
      expect(result.matchScore).toBe(0);
      expect(result.matchedCategories).toEqual([]);
    });
  });

  describe('getCategoryMatchedProcucevVendors', () => {
    const vendors: VendorEntry[] = [
      {
        id: 'proc-1',
        name: 'Apex Pumps',
        majorCategory: 'Mechanical',
        minorCategories: ['Centrifugal Pumps'],
        rating: 4.8,
        source: 'procucev_network',
      } as unknown as VendorEntry,
      {
        id: 'proc-2',
        name: 'BuildCon Cement',
        majorCategory: 'Civil Works',
        minorCategories: ['Ready Mix Concrete'],
        rating: 4.5,
        source: 'procucev_network',
      } as unknown as VendorEntry,
      {
        id: 'buyer-v-1',
        name: 'Private Roster Vendor',
        majorCategory: 'Mechanical',
        source: 'buyer_uploaded',
      } as unknown as VendorEntry,
    ];

    it('filters strictly to category-matched Procucev vendors (excluding buyer uploaded and unmatched Procucev)', () => {
      const matched = getCategoryMatchedProcucevVendors(vendors, ['mechanical', 'centrifugal pumps'], 80);
      expect(matched).toHaveLength(1);
      expect(matched[0].vendor.id).toBe('proc-1');
      expect(matched[0].matchScore).toBeGreaterThanOrEqual(95);
    });

    it('returns empty array if no Procucev vendors cover the category', () => {
      const matched = getCategoryMatchedProcucevVendors(vendors, ['aerospace composites'], 80);
      expect(matched).toHaveLength(0);
    });
  });
});
