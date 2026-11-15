const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const eventOutboxQueries = require('../src/db/eventOutboxQueries');
const eventOutboxService = require('../src/services/eventOutboxService');
const mailerService = require('../src/services/mailerService');
const pool = require('../src/db/pool');
const { logger } = require('../src/services/loggerService');
const { EVENT_OUTBOX_TYPES } = require('../src/config/constants');

// Two parts of invitation planning that the fan-out tests do not reach.
// 1. Each minor of an RFQ takes its own vendors before any vendor is invited for a second minor.
//    A vendor covering two minors is invited once, and a minor reuses such a vendor only when it has
//    no unclaimed vendor left.
// 2. A database read that fails while a minor-scoped RFQ is planned must not fall back to the capped
//    in-memory subset, which holds the newest vendors and can cover one minor. The plan is retried
//    through the outbox instead.

const RING_MINORS = Array.from({ length: 15 }, (_, index) => `Ring Minor ${index}`);

/** A ring of 15 minors: group g covers minors g and g+1, with 15 vendors per group (225 vendors). */
function ringVendors() {
  const vendors = [];
  for (let group = 0; group < RING_MINORS.length; group += 1) {
    for (let k = 0; k < 15; k += 1) {
      vendors.push({
        id: `ring-${group}-${k}`,
        name: `Ring Vendor ${group}-${k}`,
        email: `ring-${group}-${k}@planner.test`,
        majorCategory: 'Civil Works',
        minorCategories: [RING_MINORS[group], RING_MINORS[(group + 1) % RING_MINORS.length]],
        source: 'procucev_network',
        rating: 4,
      });
    }
  }
  return vendors;
}

function rfqNaming(minors, overrides = {}) {
  return {
    id: 'rfq-planner',
    rfqNumber: 'RFQ-PLANNER',
    title: 'Planner fixture',
    category: 'Civil Works',
    status: 'Open',
    deliveryLocation: 'Mumbai, Maharashtra',
    deliveryPincode: '400001',
    extractedEntities: minors.map((minorCategory, index) => ({
      id: `li-${index}`,
      itemName: `Item ${index}`,
      majorCategory: 'Civil Works',
      minorCategory,
      quantity: 1,
      unit: 'Nos',
    })),
    assignedVendors: [],
    ...overrides,
  };
}

describe('planMinorInvites: each minor takes its own vendors first', () => {
  test('spreads a ring of overlapping minors over every vendor before any vendor is reused', () => {
    const plan = storeService.planMinorInvites(rfqNaming(RING_MINORS), { candidatePool: ringVendors(), limit: 25 });

    expect(plan.shortfalls).toEqual([]);
    expect(new Set(plan.selected.map((vendor) => vendor.id)).size).toBe(225);
    for (const minor of RING_MINORS) {
      expect(plan.selected.filter((vendor) => storeService.vendorCoversMinorCategory(vendor, minor)).length)
        .toBeGreaterThanOrEqual(25);
    }
  });

  test('the first round of invitations reaches every minor, even when a vendor covers an earlier minor too', () => {
    const plan = storeService.planMinorInvites(rfqNaming(RING_MINORS), { candidatePool: ringVendors(), limit: 25 });

    const ordered = storeService._interleaveVendorsByMinor(plan.selected, RING_MINORS, plan.pickedFor);
    const firstRound = ordered.slice(0, RING_MINORS.length).map((vendor) => plan.pickedFor.get(vendor.id.toLowerCase()));

    expect(new Set(firstRound)).toEqual(new Set(RING_MINORS));
  });

  test('a minor reuses a vendor another minor took only when it has no unclaimed vendor left', () => {
    const shared = Array.from({ length: 25 }, (_, k) => ({
      id: `shared-${k}`,
      name: `Shared ${k}`,
      email: `shared-${k}@planner.test`,
      majorCategory: 'Civil Works',
      minorCategories: ['Alpha Minor', 'Beta Minor'],
      rating: 4,
    }));
    const betaOnly = ['beta-1', 'beta-2'].map((id) => ({
      id,
      name: id,
      email: `${id}@planner.test`,
      majorCategory: 'Civil Works',
      minorCategories: ['Beta Minor'],
      rating: 4,
    }));

    const plan = storeService.planMinorInvites(rfqNaming(['Alpha Minor', 'Beta Minor']), {
      candidatePool: [...shared, ...betaOnly],
      limit: 25,
    });

    expect(plan.shortfalls).toEqual([]);
    // Alpha takes its 25 shared vendors. Beta takes its own two, then reaches 25 by reusing 23 of Alpha's.
    expect(plan.selected.map((vendor) => vendor.id).sort()).toEqual([...shared.map((v) => v.id), 'beta-1', 'beta-2'].sort());
  });

  test('a minor short of vendors is topped up from its parent major and reported as a shortfall', () => {
    const bricks = ['bricks-1', 'bricks-2'].map((id) => ({
      id,
      name: id,
      email: `${id}@planner.test`,
      majorCategory: 'Civil Works',
      minorCategories: ['Bricks'],
      rating: 4,
    }));
    const roofing = Array.from({ length: 5 }, (_, k) => ({
      id: `roofing-${k}`,
      name: `Roofing ${k}`,
      email: `roofing-${k}@planner.test`,
      majorCategory: 'Civil Works',
      minorCategories: ['Roofing'],
      rating: 4,
    }));

    const plan = storeService.planMinorInvites(rfqNaming(['Bricks']), {
      candidatePool: [...bricks, ...roofing],
      limit: 4,
    });

    expect(plan.selected).toHaveLength(4);
    expect(plan.shortfalls).toEqual([
      expect.objectContaining({ minorCategory: 'Bricks', minorMatched: 2, majorFilled: 2, target: 4 }),
    ]);
  });
});

describe('a minor-scoped RFQ whose database read fails', () => {
  const overloaded = () => Object.assign(new Error('D1_ERROR: D1 DB is overloaded.'), { code: 'D1_OVERLOADED' });
  const rfq = rfqNaming(['Back filing', 'Bricks', 'Roofing']);
  let enqueueSpy;
  let sendSpy;
  let updateSpy;

  beforeEach(() => {
    // The in-memory subset would plan this RFQ if the code fell back to it.
    storeService.vendors = [{
      id: 'mem-1',
      name: 'Mem One',
      email: 'mem-1@planner.test',
      majorCategory: 'Civil Works',
      minorCategories: ['Bricks'],
      source: 'procucev_network',
      rating: 5,
    }];
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getPublicVendorsByMinorCategoryFromDB').mockRejectedValue(overloaded());
    jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockRejectedValue(overloaded());
    jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockResolvedValue([]);
    jest.spyOn(domainQueries, 'getVendorsByBuyerFromDB').mockResolvedValue([]);
    jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({ rows: [], total: 0 });
    enqueueSpy = jest.spyOn(eventOutboxService, 'enqueueEventOutbox').mockResolvedValue({ id: 'queued' });
    sendSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
    updateSpy = jest.spyOn(storeService, 'updateRFQDurably');
    jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    storeService.vendors = [];
    jest.restoreAllMocks();
  });

  test('a V0 plan queues a retry, returns the RFQ with no vendors, and plans nothing from memory', async () => {
    const result = await storeService.augmentV0AssignmentsFromDB({ ...rfq, sourcingMode: 'mode_0' }, { notifyShortfall: true });

    expect(result).toEqual(expect.objectContaining({ id: rfq.id, sourcingMode: 'mode_0' }));
    expect(enqueueSpy).toHaveBeenCalledWith(
      EVENT_OUTBOX_TYPES.RFQ_VENDOR_PLAN,
      expect.stringMatching(/^rfq-planner:/),
      expect.objectContaining({ rfqId: rfq.id, rfqNumber: rfq.rfqNumber, path: 'v0-augment' })
    );
    expect(updateSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('queued a retry'),
      expect.objectContaining({ path: 'v0-augment' }),
      'STORE_SERVICE'
    );
  });

  test('a V2 plan queues a retry the same way and does not plan from memory', async () => {
    const result = await storeService.autoAssignVendorsFromDB({ ...rfq, sourcingMode: 'mode_2' }, { notifyShortfall: true });

    expect(result).toEqual(expect.objectContaining({ id: rfq.id, sourcingMode: 'mode_2' }));
    expect(enqueueSpy).toHaveBeenCalledWith(
      EVENT_OUTBOX_TYPES.RFQ_VENDOR_PLAN,
      expect.stringMatching(/^rfq-planner:/),
      expect.objectContaining({ rfqId: rfq.id, path: 'auto-assign' })
    );
    expect(updateSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('the retry rethrows the database failure so the outbox backs off and tries again', async () => {
    await expect(storeService.augmentV0AssignmentsFromDB({ ...rfq, sourcingMode: 'mode_0' }, { rethrowOnDatabaseError: true }))
      .rejects.toThrow('D1 DB is overloaded');
    await expect(storeService.autoAssignVendorsFromDB({ ...rfq, sourcingMode: 'mode_2' }, { rethrowOnDatabaseError: true }))
      .rejects.toThrow('D1 DB is overloaded');
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  test('a failed queue write is logged, and the RFQ is still returned unchanged', async () => {
    enqueueSpy.mockRejectedValue(new Error('queue unavailable'));

    const result = await storeService.augmentV0AssignmentsFromDB({ ...rfq, sourcingMode: 'mode_0' });

    expect(result.assignedVendors ?? []).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to queue the RFQ vendor plan retry',
      expect.objectContaining({ path: 'v0-augment', error: 'queue unavailable' }),
      'STORE_SERVICE'
    );
  });
});

describe('the outbox retry of an RFQ vendor plan', () => {
  afterEach(() => jest.restoreAllMocks());

  function claimPlanJob(raw) {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'rfq_vendor_plan:rfq-planner:1700000000000',
      event_type: EVENT_OUTBOX_TYPES.RFQ_VENDOR_PLAN,
      raw,
      attempts: 1,
      lease_token: 'lease-rfq-plan',
    }]);
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);
    jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);
  }

  test('plans the RFQ from the database and lets a database failure retry the job', async () => {
    claimPlanJob({ rfqId: 'rfq-planner', rfqNumber: 'RFQ-PLANNER', path: 'v0-augment' });
    const persisted = rfqNaming(['Bricks'], { sourcingMode: 'mode_0' });
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(persisted);
    const plan = jest.spyOn(storeService, 'completeRFQVendorPlan').mockRejectedValue(new Error('D1 DB is overloaded.'));

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ claimed: 1, retried: 1 });

    expect(plan).toHaveBeenCalledWith(persisted, { notifyShortfall: true, rethrowOnDatabaseError: true });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      id: 'rfq_vendor_plan:rfq-planner:1700000000000',
      status: 'pending',
    }));
  });

  test('completes the job without planning when the RFQ no longer exists', async () => {
    claimPlanJob({ rfqId: 'rfq-gone', path: 'auto-assign' });
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(null);
    const plan = jest.spyOn(storeService, 'completeRFQVendorPlan');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ claimed: 1, completed: 1 });
    expect(plan).not.toHaveBeenCalled();
  });

  test('marks a retry without an RFQ id dead', async () => {
    claimPlanJob({ path: 'auto-assign' });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
  });
});
