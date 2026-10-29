const storeService = require('../src/services/storeService');
const domainPool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const rfqChaserScheduler = require('../src/services/rfqChaserScheduler');

describe('autoAssignVendorsFromDB and candidateVendorsForRFQAsync', () => {
  let originalPool;

  beforeEach(() => {
    originalPool = domainPool.pool;
  });

  afterEach(() => {
    domainPool.pool = originalPool;
    jest.restoreAllMocks();
  });

  describe('autoAssignVendorsFromDB', () => {
    test('returns null / undefined if rfq is falsy', async () => {
      expect(await storeService.autoAssignVendorsFromDB(null)).toBeNull();
      expect(await storeService.autoAssignVendorsFromDB(undefined)).toBeUndefined();
    });

    test('no-ops for Mode 1 (Private Roster Only)', async () => {
      const rfq = { id: 'rfq-m1', sourcingMode: 'mode_1', category: 'Electrical' };
      const res = await storeService.autoAssignVendorsFromDB(rfq);
      expect(res).toBe(rfq);
    });

    test('delegates to augmentV0AssignmentsFromDB for Mode 0', async () => {
      const rfq = { id: 'rfq-m0', sourcingMode: 'mode_0', category: 'Electrical' };
      const spy = jest.spyOn(storeService, 'augmentV0AssignmentsFromDB').mockResolvedValue({ ...rfq, augmented: true });
      const res = await storeService.autoAssignVendorsFromDB(rfq);
      expect(spy).toHaveBeenCalledWith(rfq);
      expect(res.augmented).toBe(true);
    });

    test('returns unmodified if RFQ has no category signals', async () => {
      const rfq = { id: 'rfq-nocat', sourcingMode: 'mode_3', category: null, lineItems: [] };
      jest.spyOn(storeService, '_rfqCategorySignals').mockReturnValue([]);
      const res = await storeService.autoAssignVendorsFromDB(rfq);
      expect(res).toBe(rfq);
    });

    test('auto-assigns category-matched vendors from DB and ranks by delivery location', async () => {
      domainPool.pool = { query: jest.fn() };
      const rfq = storeService.createRFQ({
        id: 'rfq-auto-test-1',
        title: 'Pipes Procurement',
        category: 'Engineering Spares - Mechanical',
        sourcingMode: 'mode_3',
        deliveryPincode: '516267',
        deliveryLocation: 'Kadapa, Andhra Pradesh, 516267',
      });

      const mockVendors = [
        { id: 'v-far', name: 'Far Vendor', category: 'Engineering Spares - Mechanical', majorCategory: 'Engineering Spares - Mechanical', pincode: '110001', rating: 5, source: 'procucev_network' },
        { id: 'v-near', name: 'Near Vendor', category: 'Engineering Spares - Mechanical', majorCategory: 'Engineering Spares - Mechanical', pincode: '516267', rating: 4, source: 'procucev_network' },
      ];

      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue(mockVendors);
      jest.spyOn(domainQueries, 'upsertRFQInDB').mockResolvedValue();
      const chaserSpy = jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});

      const updated = await storeService.autoAssignVendorsFromDB(rfq);
      expect(updated.assignedVendors.length).toBe(2);
      // v-near matches pincode 516267 so it should be ranked first
      expect(updated.assignedVendors[0].id).toBe('v-near');
      expect(updated.assignedVendors[1].id).toBe('v-far');
      expect(updated.procucevVendorCount).toBe(2);
      expect(chaserSpy).toHaveBeenCalled();
    });

    test('falls back to getVendorsPageFromDB if getPublicVendorsMatchingCategories returns empty array', async () => {
      domainPool.pool = { query: jest.fn() };
      const rfq = storeService.createRFQ({
        id: 'rfq-auto-test-2',
        title: 'General Goods',
        category: 'CustomCategory',
        sourcingMode: 'mode_2',
      });

      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({
        rows: [
          { id: 'v-fallback', name: 'Fallback Vendor', category: 'CustomCategory', majorCategory: 'CustomCategory', source: 'procucev_network' },
        ],
        total: 1,
      });
      jest.spyOn(domainQueries, 'upsertRFQInDB').mockResolvedValue();

      const updated = await storeService.autoAssignVendorsFromDB(rfq);
      expect(updated.assignedVendors.some((v) => v.id === 'v-fallback')).toBe(true);
    });

    test('handles DB query errors gracefully and falls back to in-memory candidates', async () => {
      domainPool.pool = { query: jest.fn() };
      const rfq = storeService.createRFQ({
        id: 'rfq-auto-test-3',
        title: 'Error RFQ',
        category: 'Hardware',
        sourcingMode: 'mode_3',
      });

      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockRejectedValue(new Error('DB failure'));
      jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockRejectedValue(new Error('Fallback DB failure'));
      jest.spyOn(storeService, 'candidateVendorsForRFQ').mockReturnValue([
        { id: 'v-mem', name: 'Memory Vendor', category: 'Hardware', majorCategory: 'Hardware', source: 'procucev_network' },
      ]);
      jest.spyOn(domainQueries, 'upsertRFQInDB').mockResolvedValue();

      const updated = await storeService.autoAssignVendorsFromDB(rfq);
      expect(updated.assignedVendors.some((v) => v.id === 'v-mem')).toBe(true);
    });

    test('returns unmodified if no candidate matches exist in DB or memory', async () => {
      domainPool.pool = { query: jest.fn() };
      const rfq = storeService.createRFQ({
        id: 'rfq-auto-test-4',
        title: 'Empty RFQ',
        category: 'NonExistentCategory',
        sourcingMode: 'mode_3',
      });

      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({ rows: [], total: 0 });
      jest.spyOn(storeService, 'candidateVendorsForRFQ').mockReturnValue([]);

      const updated = await storeService.autoAssignVendorsFromDB(rfq);
      expect(updated.assignedVendors).toEqual([]);
    });

    test('returns rfq unchanged when all candidates are already in assignedVendors', async () => {
      domainPool.pool = { query: jest.fn() };
      const rfq = storeService.createRFQ({
        id: 'rfq-auto-test-5',
        title: 'Already Assigned RFQ',
        category: 'Pipes',
        sourcingMode: 'mode_3',
        assignedVendors: [{ id: 'v-already', name: 'Already Assigned', email: 'already@v.com' }],
      });

      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([
        { id: 'v-already', name: 'Already Assigned', email: 'already@v.com', source: 'procucev_network', category: 'Pipes' },
      ]);

      const updated = await storeService.autoAssignVendorsFromDB(rfq);
      expect(updated.assignedVendors.length).toBe(1);
    });

    test('handles chaser scheduling errors and DB upsert errors gracefully', async () => {
      domainPool.pool = { query: jest.fn() };
      const rfq = storeService.createRFQ({
        id: 'rfq-auto-test-6',
        title: 'Error Catch RFQ',
        category: 'Tools',
        sourcingMode: 'mode_3',
      });

      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([
        { id: 'v-err', name: 'Err Vendor', source: 'procucev_network', category: 'Tools' },
      ]);
      jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {
        throw new Error('Chaser error');
      });
      jest.spyOn(domainQueries, 'upsertRFQInDB').mockRejectedValue(new Error('DB upsert error'));

      const updated = await storeService.autoAssignVendorsFromDB(rfq);
      expect(updated.assignedVendors.some((v) => v.id === 'v-err')).toBe(true);
    });
  });

  describe('candidateVendorsForRFQAsync', () => {
    test('returns in-memory candidates when available', async () => {
      const rfq = { id: 'rfq-c-1', category: 'Electrical' };
      const memCandidates = [{ id: 'v1', name: 'Vendor 1' }];
      jest.spyOn(storeService, 'candidateVendorsForRFQ').mockReturnValue(memCandidates);

      const res = await storeService.candidateVendorsForRFQAsync(rfq, 5);
      expect(res).toEqual(memCandidates);
    });

    test('falls back to DB when in-memory candidate list is empty', async () => {
      domainPool.pool = { query: jest.fn() };
      const rfq = {
        id: 'rfq-c-2',
        category: 'Engineering Spares - Mechanical',
        deliveryPincode: '516267',
        assignedVendors: [{ id: 'v-invited' }],
      };
      jest.spyOn(storeService, 'candidateVendorsForRFQ').mockReturnValue([]);
      jest.spyOn(storeService, '_rfqCategorySignals').mockReturnValue(['Engineering Spares - Mechanical']);
      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([
        { id: 'v-invited', name: 'Invited Vendor', pincode: '516267', rating: 4 },
        { id: 'v-other', name: 'Other Vendor', pincode: '110001', rating: 5 },
      ]);

      const res = await storeService.candidateVendorsForRFQAsync(rfq, 10);
      expect(res.length).toBe(2);
      expect(res.find((v) => v.id === 'v-invited').alreadyInvited).toBe(true);
      expect(res.find((v) => v.id === 'v-other').alreadyInvited).toBe(false);
    });

    test('handles DB query error gracefully in candidateVendorsForRFQAsync', async () => {
      domainPool.pool = { query: jest.fn() };
      const rfq = { id: 'rfq-c-3', category: 'Hardware' };
      jest.spyOn(storeService, 'candidateVendorsForRFQ').mockReturnValue([]);
      jest.spyOn(storeService, '_rfqCategorySignals').mockReturnValue(['Hardware']);
      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockRejectedValue(new Error('DB err'));

      const res = await storeService.candidateVendorsForRFQAsync(rfq, 5);
      expect(res).toEqual([]);
    });

    test('sorts DB candidates by rating when location scores are tied', async () => {
      domainPool.pool = { query: jest.fn() };
      const rfq = {
        id: 'rfq-c-4',
        category: 'Lighting',
        deliveryPincode: '560001',
      };
      jest.spyOn(storeService, 'candidateVendorsForRFQ').mockReturnValue([]);
      jest.spyOn(storeService, '_rfqCategorySignals').mockReturnValue(['Lighting']);
      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([
        { id: 'v-low', name: 'Low Rating', pincode: '110001', rating: 2 },
        { id: 'v-high', name: 'High Rating', pincode: '110001', rating: 5 },
      ]);

      const res = await storeService.candidateVendorsForRFQAsync(rfq);
      expect(res.length).toBe(2);
      expect(res[0].id).toBe('v-high');
      expect(res[1].id).toBe('v-low');
    });
  });
});
