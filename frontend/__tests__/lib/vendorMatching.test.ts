import {
  normalizeCategory,
  extractRfqCategorySignals,
  matchVendorAgainstSignals,
  getCategoryMatchedProcucevVendors,
  selectVendorsForCategories,
  scoreVendorLocation,
  rankProcucevVendorsForV3,
  minorNamesMatch,
} from '@/lib/vendorMatching';
import type { VendorEntry } from '@/lib/types';
import { UI_STRINGS } from '@/lib/uiStrings';

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

      const { signals, rawSignals, minorOnly } = extractRfqCategorySignals(form);
      expect(rawSignals).toContain('Mechanical');
      expect(rawSignals).toContain('Centrifugal Pumps');
      expect(rawSignals).toContain('Motors & Drives');
      // An RFQ that names minor categories is matched by those minors only.
      expect(minorOnly).toBe(true);
      expect(signals).toEqual(['centrifugal pumps', 'motors and drives']);
    });

    it('matches on the major and category labels when the RFQ names no minor category', () => {
      const { signals, minorOnly } = extractRfqCategorySignals({ majorCategory: 'Mechanical', category: 'Pumps' });
      expect(minorOnly).toBe(false);
      expect(signals).toEqual(['mechanical', 'pumps']);
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

    it('matches client mapped categories and vendor selected categories with exact and partial matches', () => {
      const vendorWithAllCategories: VendorEntry = {
        id: 'proc-all',
        name: 'Omni Supplier',
        majorCategory: 'Mechanical Engineering',
        minorCategories: ['Centrifugal Pumps'],
        clientMappedCategories: ['Industrial Turbines'],
        vendorSelectedCategories: ['Safety Valves'],
        rating: 4.9,
      } as unknown as VendorEntry;

      // Partial minor match
      const minorPartial = matchVendorAgainstSignals(vendorWithAllCategories, ['centrifugal']);
      expect(minorPartial.isMatch).toBe(true);
      expect(minorPartial.matchScore).toBe(92);

      // Exact mapped match
      const mappedExact = matchVendorAgainstSignals(vendorWithAllCategories, ['industrial turbines']);
      expect(mappedExact.isMatch).toBe(true);
      expect(mappedExact.matchScore).toBe(96);

      // Partial mapped match
      const mappedPartial = matchVendorAgainstSignals(vendorWithAllCategories, ['turbines']);
      expect(mappedPartial.isMatch).toBe(true);
      expect(mappedPartial.matchScore).toBe(90);

      // Partial major match
      const majorPartial = matchVendorAgainstSignals(vendorWithAllCategories, ['mechanical']);
      expect(majorPartial.isMatch).toBe(true);
      expect(majorPartial.matchScore).toBe(88);

      // Exact selected match
      const selExact = matchVendorAgainstSignals(vendorWithAllCategories, ['safety valves']);
      expect(selExact.isMatch).toBe(true);
      expect(selExact.matchScore).toBe(94);

      // Partial selected match
      const selPartial = matchVendorAgainstSignals(vendorWithAllCategories, ['valves']);
      expect(selPartial.isMatch).toBe(true);
      expect(selPartial.matchScore).toBe(86);
    });

    it('returns isMatch false when no category signals overlap or inputs are invalid', () => {
      const result = matchVendorAgainstSignals(mockVendor, ['civil and structural steel', 'cement']);
      expect(result.isMatch).toBe(false);
      expect(result.matchScore).toBe(0);
      expect(result.matchedCategories).toEqual([]);

      expect(matchVendorAgainstSignals(null as any, ['cat']).isMatch).toBe(false);
      expect(matchVendorAgainstSignals(mockVendor, []).isMatch).toBe(false);
      expect(matchVendorAgainstSignals(mockVendor, ['']).isMatch).toBe(false);
    });

    it('handles vendor with no category information gracefully', () => {
      const emptyVendor = { id: 'v-empty', name: 'No Cat Vendor' } as unknown as VendorEntry;
      const res = matchVendorAgainstSignals(emptyVendor, ['Civil Works']);
      expect(res.isMatch).toBe(false);
      expect(res.matchScore).toBe(0);
    });

    it('matches through taxonomy hierarchy bidirectionally', () => {
      // Vendor has major 'Civil Works', signal is minor 'Bricks'
      const majorVendor = {
        id: 'v-major',
        name: 'Civil Co',
        majorCategory: 'Civil Works',
      } as unknown as VendorEntry;
      const res1 = matchVendorAgainstSignals(majorVendor, ['Bricks']);
      expect(res1.isMatch).toBe(true);
      expect(res1.matchScore).toBe(93);

      // Vendor has minor 'Bricks', signal is major 'Civil Works'
      const minorVendor = {
        id: 'v-minor',
        name: 'Brick Maker',
        minorCategories: ['Bricks'],
      } as unknown as VendorEntry;
      const res2 = matchVendorAgainstSignals(minorVendor, ['Civil Works']);
      expect(res2.isMatch).toBe(true);
      expect(res2.matchScore).toBe(93);
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
        id: 'proc-3',
        name: 'Beta Pumps',
        majorCategory: 'Mechanical',
        minorCategories: ['Centrifugal Pumps'],
        rating: 4.2,
        source: 'procucev_network',
      } as unknown as VendorEntry,
      {
        id: 'buyer-v-1',
        name: 'Private Roster Vendor',
        majorCategory: 'Mechanical',
        source: 'buyer_uploaded',
      } as unknown as VendorEntry,
    ];

    it('filters strictly to category-matched Procucev vendors and sorts by score and rating', () => {
      const matched = getCategoryMatchedProcucevVendors(vendors, ['mechanical', 'centrifugal pumps'], 80);
      expect(matched.length).toBeGreaterThanOrEqual(2);
      expect(matched[0].vendor.id).toBe('proc-1');
      expect(matched[1].vendor.id).toBe('proc-3');
    });

    it('returns empty array if no Procucev vendors cover the category or array is empty', () => {
      const matched = getCategoryMatchedProcucevVendors(vendors, ['aerospace composites'], 80);
      expect(matched).toHaveLength(0);
      expect(getCategoryMatchedProcucevVendors(null as any, ['cat'])).toHaveLength(0);
    });
  });

  describe('selectVendorsForCategories', () => {
    const pool: VendorEntry[] = [
      { id: 'v1', name: 'Cat 1 Vendor A', majorCategory: 'Cat1', rating: 4.9 } as unknown as VendorEntry,
      { id: 'v2', name: 'Cat 1 Vendor B', majorCategory: 'Cat1', rating: 4.5 } as unknown as VendorEntry,
      { id: 'v3', name: 'Cat 2 Vendor A', majorCategory: 'Cat2', rating: 4.8 } as unknown as VendorEntry,
      { id: 'v4', name: 'Cat 3 Vendor A', majorCategory: 'Cat3', rating: 4.7 } as unknown as VendorEntry,
      { id: 'v5', name: 'Cat 4 Vendor A', majorCategory: 'Cat4', rating: 4.6 } as unknown as VendorEntry,
      { id: 'v6', name: 'Cat 5 Vendor A', majorCategory: 'Cat5', rating: 4.5 } as unknown as VendorEntry,
    ];

    it('selects up to maxPerCategory per category when distinct categories > 3', () => {
      const result = selectVendorsForCategories(pool, ['Cat1', 'Cat2', 'Cat3', 'Cat4', 'Cat5'], 5);
      expect(result.length).toBe(6);
      const ids = result.map((r) => r.vendor.id);
      expect(ids).toContain('v1');
      expect(ids).toContain('v2');
      expect(ids).toContain('v3');
      expect(ids).toContain('v4');
      expect(ids).toContain('v5');
      expect(ids).toContain('v6');
    });

    it('selects and ranks all matched vendors when categories <= 3', () => {
      const result = selectVendorsForCategories(pool, ['Cat1', 'Cat2']);
      expect(result.length).toBe(3);
      expect(result[0].vendor.id).toBe('v1');
      expect(result[1].vendor.id).toBe('v3');
      expect(result[2].vendor.id).toBe('v2');
    });

    it('sorts matching vendors with equal scores by rating and falls back to vendor email', () => {
      const tiePool: VendorEntry[] = [
        { email: 'low@rating.com', name: 'Low Rated', majorCategory: 'Cat1', rating: 3.5 } as unknown as VendorEntry,
        { email: 'high@rating.com', name: 'High Rated', majorCategory: 'Cat1', rating: 4.8 } as unknown as VendorEntry,
        { email: 'norating@test.com', name: 'No Rating', majorCategory: 'Cat1' } as unknown as VendorEntry,
      ];
      const result = selectVendorsForCategories(tiePool, ['Cat1', 'Cat2', 'Cat3', 'Cat4', 'Cat5'], 2);
      expect(result.length).toBe(2);
      expect(result[0].vendor.email).toBe('high@rating.com');
      expect(result[1].vendor.email).toBe('low@rating.com');

      const directMatches = selectVendorsForCategories(tiePool, ['Cat1']);
      expect(directMatches[0].vendor.email).toBe('high@rating.com');
      expect(directMatches[1].vendor.email).toBe('low@rating.com');
      expect(directMatches[2].vendor.email).toBe('norating@test.com');
    });

    it('prioritizes vendors closer to delivery destination when destination is provided', () => {
      const locPool: VendorEntry[] = [
        { id: 'v-delhi', name: 'Delhi Vendor', majorCategory: 'Cat1', city: 'Delhi', pincode: '110001', rating: 4.9 } as unknown as VendorEntry,
        { id: 'v-mumbai', name: 'Mumbai Vendor', majorCategory: 'Cat1', city: 'Mumbai', pincode: '400001', rating: 4.2 } as unknown as VendorEntry,
      ];
      const result = selectVendorsForCategories(locPool, ['Cat1'], 5, { location: 'Mumbai Plant', pincode: '400001' });
      expect(result.length).toBe(2);
      expect(result[0].vendor.id).toBe('v-mumbai');
      expect(result[1].vendor.id).toBe('v-delhi');
    });

    it('handles location tie-breaks, single dimension location filters, and equal score fallbacks', () => {
      const vendorA = { id: 'v-a', email: 'a@test.com', majorCategory: 'Cat1', city: 'Mumbai', pincode: '400001', rating: 4.5 } as unknown as VendorEntry;
      const vendorB = { id: 'v-b', email: 'b@test.com', majorCategory: 'Cat1', city: 'Mumbai', pincode: '400001', rating: 4.0 } as unknown as VendorEntry;

      // Equal location scores with destination, ranks by rating
      const equalLoc = selectVendorsForCategories([vendorB, vendorA], ['Cat1'], 5, { location: 'Mumbai' });
      expect(equalLoc[0].vendor.id).toBe('v-a');

      // Only pincode in destination
      const pinOnly = selectVendorsForCategories([vendorB, vendorA], ['Cat1'], 5, { pincode: '400001' });
      expect(pinOnly[0].vendor.id).toBe('v-a');

      // Non-matching PIN digits
      const distantVendor = { id: 'v-c', email: 'c@test.com', majorCategory: 'Cat1', pincode: '600001', rating: 4.0 } as unknown as VendorEntry;
      const resDiffPin = selectVendorsForCategories([distantVendor, vendorA], ['Cat1'], 5, { pincode: '400001' });
      expect(resDiffPin[0].vendor.id).toBe('v-a');
    });

    it('handles empty inputs safely', () => {
      expect(selectVendorsForCategories([], ['Cat1'])).toEqual([]);
      expect(selectVendorsForCategories(null as any, ['Cat1'])).toEqual([]);
      expect(selectVendorsForCategories(pool, [])).toEqual([]);
    });
  });

  describe('scoreVendorLocation (V3 360° delivery-location component)', () => {
    const vendorAt = (overrides: Partial<VendorEntry>): VendorEntry =>
      ({ id: 'v', name: 'V', location: '', pincode: '', city: '', state: '', ...overrides } as unknown as VendorEntry);

    it('scores a same-district PIN prefix highest', () => {
      const r = scoreVendorLocation(vendorAt({ pincode: '560001' }), { pincode: '560099' });
      expect(r.score).toBe(100);
      expect(r.reason).toMatch(/district/i);
    });

    it('scores a same postal region (first PIN digit) in the middle', () => {
      const r = scoreVendorLocation(vendorAt({ pincode: '560001' }), { pincode: '590001' });
      expect(r.score).toBe(70);
    });

    it('matches on city name in the destination text', () => {
      const r = scoreVendorLocation(vendorAt({ city: 'Pune' }), { location: 'Pune Plant, Maharashtra' });
      expect(r.score).toBe(85);
      expect(r.reason).toMatch(/Pune/);
    });

    it('matches on state name when city does not match', () => {
      const r = scoreVendorLocation(vendorAt({ state: 'Gujarat' }), { location: 'Hazira, Gujarat' });
      expect(r.score).toBe(60);
    });

    it('matches when the vendor location text mentions a destination token', () => {
      // No city/state fields set, but the free-text location overlaps the destination.
      const r = scoreVendorLocation(vendorAt({ location: 'Coimbatore Industrial Estate' }), { location: 'Coimbatore' });
      expect(r.score).toBe(60);
      expect(r.reason).toMatch(/Regional/i);
    });

    it('returns a neutral score when nothing matches', () => {
      const r = scoreVendorLocation(vendorAt({ location: 'Delhi' }), { location: 'Chennai', pincode: '600001' });
      expect(r.score).toBe(40);
      expect(r.reason).toBe(UI_STRINGS.vendorRanking.locationNotConfirmed);
    });
  });

  describe('rankProcucevVendorsForV3 (top-10 by category + location)', () => {
    const vendor = (overrides: Partial<VendorEntry>): VendorEntry =>
      ({
        id: `v-${Math.random().toString(36).slice(2)}`,
        name: 'Vendor',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategories: ['Pumps & Accessories'],
        rating: 4,
        source: 'procucev_network',
        contactPerson: 'C',
        phone: '1',
        email: 'e@x.com',
        location: '',
        pincode: '',
        ...overrides,
      } as unknown as VendorEntry);

    const signals = ['engineering spares - mechanical', 'pumps and accessories'];

    it('excludes buyer-uploaded vendors and keeps only the Procucev network', () => {
      const pool = [
        vendor({ id: 'proc-1', name: 'Net Co' }),
        vendor({ id: 'v-buyer-1', name: 'Private Co', source: 'buyer_uploaded' }),
      ];
      const ranked = rankProcucevVendorsForV3(pool, signals, {}, 10);
      expect(ranked.map((r) => r.vendor.id)).toEqual(['proc-1']);
    });

    it('ranks a geographically closer vendor above an equally-capable distant one', () => {
      const near = vendor({ id: 'near', name: 'Near Co', pincode: '560001' });
      const far = vendor({ id: 'far', name: 'Far Co', pincode: '110001' });
      const ranked = rankProcucevVendorsForV3([far, near], signals, { pincode: '560045' }, 10);
      expect(ranked[0].vendor.id).toBe('near');
      expect(ranked[0].overallScore).toBeGreaterThanOrEqual(ranked[1].overallScore);
    });

    it('caps the result at the requested limit', () => {
      const pool = Array.from({ length: 25 }, (_, i) => vendor({ id: `proc-${i}`, name: `Co ${i}` }));
      expect(rankProcucevVendorsForV3(pool, signals, {}, 10)).toHaveLength(10);
    });

    it('ranks no vendor when there are no category signals, instead of inventing a baseline score', () => {
      const pool = [vendor({ id: 'proc-x', name: 'Baseline Co' })];
      expect(rankProcucevVendorsForV3(pool, [], {}, 10)).toEqual([]);
    });

    it('handles V3 tie-breaks and excludes non-matching vendors', () => {
      const vNoMatch = vendor({ id: 'no-match', majorCategory: 'Aerospace', minorCategories: ['Satellites'] });
      const vSameOverallHighCat = vendor({ id: 'v-high-cat', majorCategory: 'Mechanical', rating: 4.0 });
      const vSameOverallLowCat = vendor({ id: 'v-low-cat', majorCategory: 'Mechanical', rating: 4.8 });
      const pool = [vNoMatch, vSameOverallLowCat, vSameOverallHighCat];
      const res = rankProcucevVendorsForV3(pool, ['mechanical'], {});
      expect(res.some((r) => r.vendor.id === 'no-match')).toBe(false);
      expect(res.length).toBe(2);
    });

    it('returns an empty list for a non-array input', () => {
      expect(rankProcucevVendorsForV3(null as any, signals, {}, 10)).toEqual([]);
    });
  });

  describe('additional branch coverage for category signals and match fallbacks', () => {
    it('extracts signals from extractedEntities with fallback category fields', () => {
      const form = {
        extractedEntities: [
          { category: 'Pumps & Spares', majorCategory: 'Mechanical', minorCategory: 'Centrifugal Pumps' },
        ],
      };
      const { rawSignals } = extractRfqCategorySignals(form);
      expect(rawSignals).toContain('Pumps & Spares');
      expect(rawSignals).toContain('Mechanical');
      expect(rawSignals).toContain('Centrifugal Pumps');
    });

    it('handles whitespace-only and punctuation signals in matchVendorAgainstSignals', () => {
      const v = {
        id: 'v-minor-only',
        name: 'Minor Only Vendor',
        minorCategories: ['Centrifugal Pumps'],
      } as unknown as VendorEntry;
      const res = matchVendorAgainstSignals(v, ['  ---  ', 'centrifugal pumps']);
      expect(res.isMatch).toBe(true);
      expect(res.matchedMajor).toBe('Centrifugal Pumps');
    });

    it('ranks preferredMinors first in rankProcucevVendorsForV3', () => {
      const v1 = {
        id: 'v1',
        name: 'Vendor General',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategories: ['General Parts'],
        source: 'procucev_network',
        rating: 4.5,
      };

      const v2 = {
        id: 'v2',
        name: 'Vendor Specific Minor',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategories: ['Centrifugal Pumps'],
        source: 'procucev_network',
        rating: 4.0,
      };

      const ranked = rankProcucevVendorsForV3(
        [v1 as any, v2 as any],
        ['Engineering Spares - Mechanical'],
        { location: 'Mumbai' },
        10,
        ['Centrifugal Pumps']
      );

      expect(ranked[0].vendor.id).toBe('v2');
      expect(ranked[0].hasMinorMatch).toBe(true);
      expect(ranked[0].matchedMinorCategory).toBe('Centrifugal Pumps');
      expect(ranked[1].hasMinorMatch).toBe(false);
    });
  });
});

describe('vendorMatching edge branches', () => {
  const procucevVendor = (overrides: Partial<VendorEntry>): VendorEntry =>
    ({
      id: 'p-default',
      name: 'Procucev Partner',
      source: 'procucev_network',
      contactPerson: 'Contact',
      phone: '9999999999',
      email: 'partner@procucev.com',
      ...overrides,
    }) as VendorEntry;

  test('extractRfqCategorySignals reads only the category fields that are present', () => {
    const { rawSignals, signals } = extractRfqCategorySignals({
      category: 'Valves',
      lineItems: [{ majorCategory: undefined, minorCategory: '   ', category: 'Gate Valves' }],
    });
    expect(rawSignals).toEqual(['Valves', 'Gate Valves']);
    expect(signals).toHaveLength(2);
  });

  test('matchVendorAgainstSignals leaves matchedMajor empty when the vendor has no major category and nothing matches', () => {
    const result = matchVendorAgainstSignals(
      procucevVendor({ majorCategory: undefined, minorCategories: ['Valves'] }),
      ['Pumps']
    );
    expect(result.isMatch).toBe(false);
    expect(result.matchedMajor).toBe('');
  });

  test('matchVendorAgainstSignals matches a shorter vendor category inside a longer buyer category', () => {
    const result = matchVendorAgainstSignals(
      procucevVendor({ majorCategory: undefined, minorCategories: ['Pumps'] }),
      ['Centrifugal Pumps']
    );
    expect(result.isMatch).toBe(true);
    expect(result.matchScore).toBe(92);
    expect(result.matchedCategories).toEqual(['Pumps']);
  });

  test('rankProcucevVendorsForV3 puts preferred-minor matches first, then by rating, and tolerates missing minor lists', () => {
    const vendors = [
      procucevVendor({ id: 'a', majorCategory: 'Mechanical', minorCategories: ['Pumps'] }),
      procucevVendor({ id: 'b', majorCategory: 'Mechanical', minorCategories: ['Valves'] }),
      procucevVendor({ id: 'c', majorCategory: 'Mechanical', minorCategories: undefined }),
      procucevVendor({ id: 'd', majorCategory: 'Mechanical', minorCategories: ['Pumps', 'Valves'], rating: 4 }),
      procucevVendor({ id: 'e', majorCategory: 'Mechanical' }),
    ];
    const ranked = rankProcucevVendorsForV3(vendors, ['Mechanical'], {}, 10, ['Pumps']);

    expect(ranked.map((r) => r.vendor.id)).toEqual(['d', 'a', 'b', 'c', 'e']);
    expect(ranked[0].hasMinorMatch).toBe(true);
    expect(ranked.find((r) => r.vendor.id === 'b')?.matchedMinorCategory).toBe('Valves');
    expect(ranked.find((r) => r.vendor.id === 'c')?.matchedMinorCategory).toBeNull();
  });

  test('getCategoryMatchedProcucevVendors orders by match score, then rating, and keeps unrated vendors after rated ones', () => {
    const vendors = [
      procucevVendor({ id: 'x', minorCategories: ['Pumps'] }),
      procucevVendor({ id: 'y', majorCategory: 'Pumps', minorCategories: [] }),
      procucevVendor({ id: 'z', minorCategories: ['Pumps'] }),
      procucevVendor({ id: 'w', minorCategories: ['Pumps'], rating: 3 }),
    ];
    const results = getCategoryMatchedProcucevVendors(vendors, ['Pumps']);
    expect(results.map((r) => r.vendor.id)).toEqual(['w', 'x', 'z', 'y']);
  });

  test('selectVendorsForCategories returns nothing when every signal normalises to empty', () => {
    expect(selectVendorsForCategories([procucevVendor({ id: 'q', minorCategories: ['Pumps'] })], ['  ', ''])).toEqual([]);
  });

  test('selectVendorsForCategories skips keyless vendors and does not pick one vendor twice', () => {
    const vendors = [
      procucevVendor({ id: 'm1', minorCategories: ['Pumps'], rating: 5 }),
      procucevVendor({ id: 'm2', majorCategory: 'Pumps', minorCategories: [] }),
      procucevVendor({ id: 'm3', minorCategories: ['Pumps'] }),
      procucevVendor({ id: 'm4', minorCategories: ['Pumps', 'Valves'], rating: 1 }),
      procucevVendor({ id: 'v1', minorCategories: ['Valves'], rating: 2 }),
      procucevVendor({ id: '', email: '', minorCategories: ['Valves'] }),
    ];
    const selected = selectVendorsForCategories(vendors, ['Pumps', 'Valves'], 10);
    expect(selected.map((s) => s.vendor.id)).toEqual(['m1', 'v1', 'm4', 'm3', 'm2']);
  });
});

describe('vendorMatching minor-only matching', () => {
  const vendorWithMinor = {
    id: 'v-min',
    name: 'Minor Vendor',
    majorCategory: 'Mechanical',
    minorCategories: ['Bearings & Accessories'],
    rating: 4,
    source: 'procucev_network',
  } as unknown as VendorEntry;
  const vendorMajorOnly = {
    id: 'v-maj',
    name: 'Major Vendor',
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategories: [],
    rating: 5,
    source: 'procucev_network',
  } as unknown as VendorEntry;
  const vendorSibling = {
    id: 'v-sib',
    name: 'Accessory Vendor',
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategories: ['Accessories'],
    rating: 4,
    source: 'procucev_network',
  } as unknown as VendorEntry;

  it('minorNamesMatch accepts the same name or its plural, and rejects a name that only contains the other', () => {
    expect(minorNamesMatch('bearings and accessories', 'bearings and accessories')).toBe(true);
    expect(minorNamesMatch('box', 'boxes')).toBe(true);
    expect(minorNamesMatch('boxes', 'box')).toBe(true);
    expect(minorNamesMatch('steel', 'steels')).toBe(true);
    expect(minorNamesMatch('steels', 'steel')).toBe(true);
    expect(minorNamesMatch('accessories', 'bearings and accessories')).toBe(false);
    expect(minorNamesMatch('', 'steel')).toBe(false);
  });

  it('matches only a minor-level label, never the major or a sibling minor', () => {
    const signals = ['bearings and accessories'];
    const minorMatch = matchVendorAgainstSignals(vendorWithMinor, signals, true);
    expect(minorMatch.isMatch).toBe(true);
    expect(minorMatch.matchScore).toBe(98);
    expect(matchVendorAgainstSignals(vendorMajorOnly, signals, true).isMatch).toBe(false);
    expect(matchVendorAgainstSignals(vendorSibling, signals, true).isMatch).toBe(false);
  });

  it('accepts the plural of a minor, and a major that is itself named like the minor', () => {
    const plural = { ...vendorWithMinor, minorCategories: ['Steel'] } as unknown as VendorEntry;
    expect(matchVendorAgainstSignals(plural, ['steels'], true).isMatch).toBe(true);
    const majorNamed = { id: 'v-mn', name: 'Named', majorCategory: 'Steels', minorCategories: [] } as unknown as VendorEntry;
    expect(matchVendorAgainstSignals(majorNamed, ['steels'], true).matchScore).toBe(95);
  });

  it('scores selected and client-mapped labels exactly in minor-only mode, never by token', () => {
    const selected = {
      id: 'v-sel',
      name: 'Selected',
      majorCategory: 'Mechanical',
      vendorSelectedCategories: ['Safety Valves'],
      minorCategories: [],
    } as unknown as VendorEntry;
    expect(matchVendorAgainstSignals(selected, ['safety valves'], true).matchScore).toBe(94);
    expect(matchVendorAgainstSignals(selected, ['valves'], true).isMatch).toBe(false);

    const mapped = {
      id: 'v-map',
      name: 'Mapped',
      majorCategory: 'Mechanical',
      clientMappedCategories: ['Industrial Turbines'],
      minorCategories: [],
    } as unknown as VendorEntry;
    expect(matchVendorAgainstSignals(mapped, ['industrial turbines'], true).matchScore).toBe(96);
    expect(matchVendorAgainstSignals(mapped, ['turbines'], true).isMatch).toBe(false);
  });

  it('does not reach a vendor through the taxonomy parent of a minor-only signal', () => {
    const parentMajor = {
      id: 'v-parent',
      name: 'Parent',
      majorCategory: 'Engineering Spares - Mechanical',
      minorCategories: ['Pumps & Accessories'],
    } as unknown as VendorEntry;
    expect(matchVendorAgainstSignals(parentMajor, ['bearings and accessories'], true).isMatch).toBe(false);
  });

  it('selects, matches and ranks only the vendors carrying the minor', () => {
    const pool = [vendorWithMinor, vendorMajorOnly, vendorSibling];
    const signals = ['bearings and accessories'];
    expect(selectVendorsForCategories(pool, signals, 5, undefined, true).map((r) => r.vendor.id)).toEqual(['v-min']);
    expect(getCategoryMatchedProcucevVendors(pool, signals, 80, true).map((r) => r.vendor.id)).toEqual(['v-min']);

    const ranked = rankProcucevVendorsForV3(
      pool,
      signals,
      { location: null, pincode: null },
      10,
      ['Bearings & Accessories'],
      true
    );
    expect(ranked.map((r) => r.vendor.id)).toEqual(['v-min']);
    expect(ranked[0].hasMinorMatch).toBe(true);
  });
});
