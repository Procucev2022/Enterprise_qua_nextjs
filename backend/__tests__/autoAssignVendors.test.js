const storeService = require('../src/services/storeService');
const domainPool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const eventOutboxService = require('../src/services/eventOutboxService');
const { EVENT_OUTBOX_TYPES } = require('../src/config/constants');
const rfqChaserScheduler = require('../src/services/rfqChaserScheduler');
const { logger } = require('../src/services/loggerService');

describe('autoAssignVendorsFromDB and candidateVendorsForRFQAsync', () => {
  let originalPool;

  beforeEach(() => {
    originalPool = domainPool.pool;
    jest.spyOn(domainQueries, 'getRFQSnapshotByIdFromDB').mockImplementation(async (id) => {
      const rfq = storeService.getRFQById(id);
      return rfq ? { id: rfq.id, rfq, raw: JSON.stringify(rfq) } : null;
    });
    jest.spyOn(domainQueries, 'updateRFQIfUnchangedInDB').mockImplementation(async (_snapshot, rfq) => rfq);
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
      expect(spy).toHaveBeenCalledWith(rfq, { deferChasers: false });
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
      jest.spyOn(domainQueries, 'upsertRFQInDB').mockImplementation(async (updatedRfq) => updatedRfq);
      const chaserSpy = jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});

      const updated = await storeService.autoAssignVendorsFromDB(rfq);
      expect(updated.assignedVendors.length).toBe(2);
      // v-near matches pincode 516267 so it should be ranked first
      expect(updated.assignedVendors[0].id).toBe('v-near');
      expect(updated.assignedVendors[1].id).toBe('v-far');
      expect(updated.procucevVendorCount).toBe(2);
      expect(chaserSpy).toHaveBeenCalled();
    });

    test('reapplies assignment additions after a CAS conflict without dropping concurrent vendors or duplicating chasers', async () => {
      domainPool.pool = { query: jest.fn() };
      jest.spyOn(domainQueries, 'upsertRFQInDB').mockImplementation(async (rfq) => rfq);
      const rfq = storeService.createRFQ({
        id: 'rfq-auto-cas-merge',
        title: 'Concurrent Assignment RFQ',
        category: 'Tools',
        sourcingMode: 'mode_3',
        assignedVendors: [],
      });
      const initial = { ...rfq, assignedVendors: [] };
      const concurrent = { ...initial, assignedVendors: [{ id: 'v-concurrent', name: 'Concurrent Vendor' }] };
      const newVendor = { id: 'v-new', name: 'New Vendor', majorCategory: 'Tools', source: 'procucev_network' };
      const getSnapshotSpy = domainQueries.getRFQSnapshotByIdFromDB
        .mockResolvedValueOnce({ id: rfq.id, rfq: initial, raw: JSON.stringify(initial) })
        .mockResolvedValueOnce({ id: rfq.id, rfq: concurrent, raw: JSON.stringify(concurrent) });
      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([newVendor, newVendor]);
      jest.spyOn(storeService, 'selectVendorsPerCategory').mockReturnValue([newVendor, newVendor]);
      const compareAndSwapSpy = domainQueries.updateRFQIfUnchangedInDB
        .mockResolvedValueOnce(null)
        .mockImplementationOnce(async (_snapshot, updatedRFQ) => updatedRFQ);
      const chaserSpy = jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});

      const updated = await storeService.autoAssignVendorsFromDB(rfq);

      expect(getSnapshotSpy).toHaveBeenCalledTimes(2);
      expect(compareAndSwapSpy).toHaveBeenCalledTimes(2);
      expect(updated.assignedVendors.map((vendor) => vendor.id)).toEqual(['v-concurrent', 'v-new']);
      expect(chaserSpy).toHaveBeenCalledTimes(1);
      expect(chaserSpy.mock.calls[0][1].map((vendor) => vendor.id)).toEqual(['v-new']);
    });

    test('does not schedule a second chaser when another writer already assigned the same vendor', async () => {
      domainPool.pool = { query: jest.fn() };
      jest.spyOn(domainQueries, 'upsertRFQInDB').mockImplementation(async (rfq) => rfq);
      const rfq = storeService.createRFQ({
        id: 'rfq-auto-cas-same-vendor',
        title: 'Concurrent Duplicate Assignment RFQ',
        category: 'Tools',
        sourcingMode: 'mode_3',
        assignedVendors: [],
      });
      const initial = { ...rfq, assignedVendors: [] };
      const concurrent = { ...initial, assignedVendors: [{ id: 'v-already-assigned', name: 'Already Assigned' }] };
      const concurrentVendor = { id: 'v-already-assigned', name: 'Already Assigned', majorCategory: 'Tools', source: 'procucev_network' };
      domainQueries.getRFQSnapshotByIdFromDB
        .mockResolvedValueOnce({ id: rfq.id, rfq: initial, raw: JSON.stringify(initial) })
        .mockResolvedValueOnce({ id: rfq.id, rfq: concurrent, raw: JSON.stringify(concurrent) });
      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([concurrentVendor]);
      jest.spyOn(storeService, 'selectVendorsPerCategory').mockReturnValue([concurrentVendor]);
      domainQueries.updateRFQIfUnchangedInDB
        .mockResolvedValueOnce(null)
        .mockImplementationOnce(async (_snapshot, updatedRFQ) => updatedRFQ);
      const chaserSpy = jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});

      const updated = await storeService.autoAssignVendorsFromDB(rfq);

      expect(updated.assignedVendors.map((vendor) => vendor.id)).toEqual(['v-already-assigned']);
      expect(chaserSpy).not.toHaveBeenCalled();
    });

    test('does not assign random vendors if getPublicVendorsMatchingCategories returns empty array', async () => {
      domainPool.pool = { query: jest.fn() };
      const rfq = storeService.createRFQ({
        id: 'rfq-auto-test-2',
        title: 'General Goods',
        category: 'CustomCategory',
        sourcingMode: 'mode_2',
      });

      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([]);
      jest.spyOn(storeService, 'candidateVendorsForRFQ').mockReturnValue([]);
      jest.spyOn(domainQueries, 'upsertRFQInDB').mockResolvedValue();

      const updated = await storeService.autoAssignVendorsFromDB(rfq);
      expect(updated.assignedVendors.length).toBe(0);
    });

    test('handles DB query errors by queuing a plan retry instead of planning from in-memory vendors', async () => {
      domainPool.pool = { query: jest.fn() };
      const rfq = storeService.createRFQ({
        id: 'rfq-auto-test-3',
        title: 'Error RFQ',
        category: 'Hardware',
        sourcingMode: 'mode_3',
      });

      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockRejectedValue(new Error('DB failure'));
      jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockRejectedValue(new Error('Fallback DB failure'));
      // 'Hardware' is a taxonomy minor, so this RFQ is minor-level. With storage, its plan is never built from
      // the in-memory vendors, so the failed read queues a retry and nothing is assigned.
      const enqueueSpy = jest.spyOn(eventOutboxService, 'enqueueEventOutbox').mockResolvedValue({ id: 'queued' });
      const originalVendors = storeService.vendors;
      storeService.vendors = [
        { id: 'v-mem', name: 'Memory Vendor', category: 'Hardware', majorCategory: 'Hardware', source: 'procucev_network' },
      ];
      jest.spyOn(domainQueries, 'upsertRFQInDB').mockImplementation(async (updatedRfq) => updatedRfq);

      try {
        const updated = await storeService.autoAssignVendorsFromDB(rfq);
        expect(updated.assignedVendors ?? []).toEqual([]);
        expect(enqueueSpy).toHaveBeenCalledWith(
          EVENT_OUTBOX_TYPES.RFQ_VENDOR_PLAN,
          expect.stringContaining('rfq-auto-test-3:'),
          expect.objectContaining({ rfqId: 'rfq-auto-test-3', path: 'auto-assign' })
        );
      } finally {
        storeService.vendors = originalVendors;
      }
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

    test('logs chaser scheduling errors after the RFQ update is durable', async () => {
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
      jest.spyOn(domainQueries, 'upsertRFQInDB').mockImplementation(async (updatedRfq) => updatedRfq);

      const updated = await storeService.autoAssignVendorsFromDB(rfq);
      expect(updated.assignedVendors.some((v) => v.id === 'v-err')).toBe(true);
    });

    test('logs synchronous vendor dispatch errors without losing durable assignments', async () => {
      domainPool.pool = { query: jest.fn() };
      const rfq = storeService.createRFQ({
        id: 'rfq-auto-dispatch-failure',
        title: 'Dispatch Failure',
        category: 'Tools',
        sourcingMode: 'mode_3',
      });
      const dispatchError = new Error('Feed write failed');
      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([
        { id: 'v-dispatch', name: 'Dispatch Vendor', email: 'dispatch@example.com', source: 'procucev_network', category: 'Tools' },
      ]);
      jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});
      // Synchronous failure inside the dispatch loop. Feed writes now run in the background
      // (_recordChannelFeedItem), so a throw from _buildNotification is what reaches the catch.
      jest.spyOn(storeService, '_buildNotification').mockImplementation(() => {
        throw dispatchError;
      });
      const errorSpy = jest.spyOn(logger, 'error');

      const updated = await storeService.autoAssignVendorsFromDB(rfq);

      expect(updated.assignedVendors.map((vendor) => vendor.id)).toContain('v-dispatch');
      expect(errorSpy).toHaveBeenCalledWith(
        'RFQ assignments were saved but automatic vendor dispatch failed',
        expect.objectContaining({
          rfqId: rfq.id,
          rfqNumber: rfq.rfqNumber,
          assignedVendorIds: ['v-dispatch'],
          error: dispatchError,
        }),
        'STORE_SERVICE'
      );
    });

    test('keeps deferred assignments when follow-up telemetry is absent', async () => {
      domainPool.pool = { query: jest.fn() };
      const rfq = storeService.createRFQ({
        id: 'rfq-auto-deferred-without-follow-up',
        title: 'Deferred Assignment',
        category: 'Tools',
        sourcingMode: 'mode_3',
      });
      const vendor = { id: 'v-deferred', name: 'Deferred Vendor', source: 'procucev_network', category: 'Tools' };
      const updatedRFQ = { ...rfq, assignedVendors: [vendor], followUpData: null };
      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([vendor]);
      jest.spyOn(storeService, '_appendRFQAssignmentsDurably').mockResolvedValue({
        updatedRFQ,
        committedAdditions: [vendor],
      });
      const persistSpy = jest.spyOn(storeService, '_persistRFQ').mockImplementation(() => true);
      const chaserSpy = jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers');

      const result = await storeService.autoAssignVendorsFromDB(rfq, { deferChasers: true });

      expect(result.assignedVendors).toEqual([vendor]);
      expect(result.followUpData).toBeNull();
      expect(chaserSpy).not.toHaveBeenCalled();
      expect(persistSpy).toHaveBeenCalledWith(updatedRFQ);
    });

    test('does not publish assignments or schedule chasers when the durable RFQ update fails', async () => {
      domainPool.pool = { query: jest.fn() };
      const rfq = storeService.createRFQ({
        id: 'rfq-auto-persist-failure',
        title: 'Persistence Failure',
        category: 'Tools',
        sourcingMode: 'mode_3',
      });
      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([
        { id: 'v-persist-failure', name: 'Persist Failure Vendor', source: 'procucev_network', category: 'Tools' },
      ]);
      const chaserSpy = jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});
      jest.spyOn(domainQueries, 'updateRFQIfUnchangedInDB').mockRejectedValue(new Error('DB compare-and-swap error'));

      await expect(storeService.autoAssignVendorsFromDB(rfq)).rejects.toMatchObject({
        statusCode: 503,
        code: 'PERSISTENCE_UNAVAILABLE',
      });

      expect(rfq.assignedVendors).toEqual([]);
      expect(chaserSpy).not.toHaveBeenCalled();
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

    test('extracts domain keywords from lineItems and titles in _rfqCategorySignals', () => {
      const rfqPipes = {
        title: 'Need 2-inch PVC Pipe urgently',
        category: 'Engineering Spares - Mechanical',
        lineItems: [{ description: 'PVC Pipe 2-inch diameter schedule 40' }],
      };
      const signals = storeService._rfqCategorySignals(rfqPipes);
      expect(signals).toContain('Pipes & Pipe Fittings');
      expect(signals).toContain('Plumbing');

      const rfqPacking = {
        title: 'Packing Supplies',
        category: 'Industrial',
        extractedEntities: [{ description: 'Bubble Rolls for packaging' }],
      };
      const packSignals = storeService._rfqCategorySignals(rfqPacking);
      expect(packSignals).toContain('Packing Material');
    });

    test('vendorCoversCategory and vendorCoversMinorCategory handle array, JSON string, comma string, and invalid inputs', () => {
      const vJson = { minorCategories: '["Pumps", "Motors"]' };
      expect(storeService.vendorCoversCategory(vJson, 'Pumps')).toBe(true);
      expect(storeService.vendorCoversMinorCategory(vJson, 'Pumps')).toBe(true);

      const vCsv = { vendorSelectedCategories: 'Valves, Pipes, Fittings', category: 'Hardware, Tools' };
      expect(storeService.vendorCoversCategory(vCsv, 'Valves')).toBe(true);
      expect(storeService.vendorCoversMinorCategory(vCsv, 'Hardware')).toBe(true);

      const vInvalidJson = { clientMappedCategories: '[broken-json' };
      expect(storeService.vendorCoversCategory(vInvalidJson, '[broken-json')).toBe(true);

      const vArray = { categories: ['Safety', 'PPE'] };
      expect(storeService.vendorCoversCategory(vArray, 'Safety')).toBe(true);
      expect(storeService.vendorCoversMinorCategory(vArray, 'Safety')).toBe(true);

      const vEmpty = { minorCategories: null, vendorSelectedCategories: 123, category: undefined };
      expect(storeService.vendorCoversCategory(vEmpty, 'Pumps')).toBe(false);
      expect(storeService.vendorCoversMinorCategory(vEmpty, 'Pumps')).toBe(false);
    });
  });
});
