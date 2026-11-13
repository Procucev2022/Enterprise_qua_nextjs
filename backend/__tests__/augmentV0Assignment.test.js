const domainPool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const rfqChaserScheduler = require('../src/services/rfqChaserScheduler');
const storeService = require('../src/services/storeService');
const { logger } = require('../src/services/loggerService');

// The DB-backed step that assigns Procucev-network vendors to a V0 (mode_0) RFQ after it is created.
describe('augmentV0AssignmentsFromDB', () => {
  let originalPool;
  let originalBinding;
  let rfqSequence = 0;

  const newV0Rfq = (overrides = {}) => {
    rfqSequence += 1;
    return storeService.createRFQ({
      id: `rfq-v0-augment-${rfqSequence}`,
      title: 'Mechanical spares',
      category: 'Engineering Spares - Mechanical',
      sourcingMode: 'mode_0',
      deliveryPincode: '516267',
      deliveryLocation: 'Kadapa, Andhra Pradesh, 516267',
      ...overrides,
    }, null, { deferPersistence: true, deferSideEffects: true });
  };

  beforeEach(() => {
    originalPool = domainPool.pool;
    originalBinding = globalThis.__CF_ENV__;
    domainPool.pool = { query: jest.fn() };
    jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});
    jest.spyOn(storeService, '_appendRFQAssignmentsDurably').mockImplementation(async (rfqId, additions) => ({
      updatedRFQ: {
        id: rfqId,
        sourcingMode: 'mode_0',
        category: 'Engineering Spares - Mechanical',
        assignedVendors: additions,
        followUpData: null,
      },
      committedAdditions: additions,
    }));
  });

  afterEach(() => {
    domainPool.pool = originalPool;
    if (originalBinding === undefined) delete globalThis.__CF_ENV__;
    else globalThis.__CF_ENV__ = originalBinding;
    jest.restoreAllMocks();
  });

  describe('with a configured database', () => {
    test('assigns the category-matched public vendors from the indexed major-category lookup', async () => {
      const rfq = newV0Rfq();
      const matched = [
        {
          id: 'v-near',
          name: 'Near Vendor',
          majorCategory: 'Engineering Spares - Mechanical',
          pincode: '516267',
          rating: 4,
          source: 'category_manager_upload',
        },
        {
          id: 'v-far',
          name: 'Far Vendor',
          majorCategory: 'Engineering Spares - Mechanical',
          pincode: '110001',
          rating: 5,
          source: 'self_registration',
        },
      ];
      const majorSpy = jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockResolvedValue(matched);
      const likeSpy = jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([]);
      const pageSpy = jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({ rows: [], total: 0 });

      const result = await storeService.augmentV0AssignmentsFromDB(rfq);

      expect(majorSpy).toHaveBeenCalledWith(expect.arrayContaining(['Engineering Spares - Mechanical']), expect.any(Number));
      expect(likeSpy).not.toHaveBeenCalled();
      expect(pageSpy).not.toHaveBeenCalled();
      expect(result.assignedVendors.map((vendor) => vendor.id).sort()).toEqual(['v-far', 'v-near']);
    });

    test('falls back to the public vendor page when the category lookup finds no match', async () => {
      const rfq = newV0Rfq();
      jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([]);
      const pageSpy = jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({
        rows: [{ id: 'v-page', name: 'Page Vendor', source: 'procucev_network', rating: 3 }],
        total: 1,
      });

      const result = await storeService.augmentV0AssignmentsFromDB(rfq);

      expect(pageSpy).toHaveBeenCalledWith(expect.objectContaining({ publicOnly: true, skipCount: true }));
      expect(result.assignedVendors.map((vendor) => vendor.id)).toEqual(['v-page']);
    });

    test('still assigns from the public vendor page when the category lookup fails', async () => {
      const rfq = newV0Rfq();
      jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockRejectedValue(new Error('D1 DB is overloaded.'));
      jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({
        rows: [{ id: 'v-after-error', name: 'Recovered Vendor', source: 'procucev_network' }],
        total: 1,
      });
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

      const result = await storeService.augmentV0AssignmentsFromDB(rfq);

      expect(warnSpy).toHaveBeenCalledWith(
        'V0 DB-backed vendor assignment query failed',
        expect.objectContaining({ rfqNumber: rfq.rfqNumber }),
        'STORE_SERVICE'
      );
      expect(result.assignedVendors.map((vendor) => vendor.id)).toEqual(['v-after-error']);
    });

    test('records that no category-matched vendor exists when every source is empty', async () => {
      const rfq = newV0Rfq();
      jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({ rows: [], total: 0 });
      jest.spyOn(storeService, 'candidateVendorsForRFQ').mockReturnValue([]);
      const updateSpy = jest.spyOn(storeService, 'updateRFQDurably').mockImplementation(
        async (_id, update) => ({ ...rfq, ...update({ assignedVendors: [] }) })
      );

      const result = await storeService.augmentV0AssignmentsFromDB(rfq);

      expect(updateSpy).toHaveBeenCalledWith(rfq.id, expect.any(Function));
      expect(result).toEqual(expect.objectContaining({ needsCategoryManagerAssignment: true, procucevVendorCount: 0 }));
    });
  });

  describe('without a configured database', () => {
    test('uses only the in-memory candidates and makes no database lookup', async () => {
      domainPool.pool = null;
      delete globalThis.__CF_ENV__;
      const rfq = newV0Rfq();
      const majorSpy = jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB');
      jest.spyOn(storeService, 'candidateVendorsForRFQ').mockReturnValue([
        { id: 'v-mem', name: 'Memory Vendor', majorCategory: 'Engineering Spares - Mechanical', source: 'procucev_network' },
      ]);

      const result = await storeService.augmentV0AssignmentsFromDB(rfq);

      expect(majorSpy).not.toHaveBeenCalled();
      expect(result.assignedVendors.map((vendor) => vendor.id)).toEqual(['v-mem']);
    });
  });

  describe('without category signals', () => {
    test('marks the RFQ for category-manager assignment instead of matching any vendor', async () => {
      const rfq = newV0Rfq({ category: '', extractedEntities: [] });
      const majorSpy = jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB');
      const updateSpy = jest.spyOn(storeService, 'updateRFQDurably').mockImplementation(
        async (_id, update) => ({ ...rfq, ...update({ assignedVendors: [] }) })
      );

      const result = await storeService.augmentV0AssignmentsFromDB(rfq);

      expect(majorSpy).not.toHaveBeenCalled();
      expect(updateSpy).toHaveBeenCalledWith(rfq.id, expect.any(Function));
      expect(result.needsCategoryManagerAssignment).toBe(true);
    });
  });
});
