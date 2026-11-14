const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const pool = require('../src/db/pool');
const mailerService = require('../src/services/mailerService');
const rfqChaserScheduler = require('../src/services/rfqChaserScheduler');
const { logger } = require('../src/services/loggerService');
const { VENDOR_ASSIGNMENT_LIMITS } = require('../src/config/constants');

// An RFQ whose line items name many minor categories must invite the vendors of every one of
// them. This fixture uses 15 minors of one major, 40 line items, and more network vendors per
// minor than the per-minor target. The tests pin three things: the vendors assigned for each
// minor, the order the invitations are queued in and e-mailed in (a partly delivered batch has to
// reach every minor), and the creation path that leaves the assignment to the database plan.

const MAJOR = 'Civil Works';
const MINORS = [
  'Back filing',
  'Bricks',
  'Drilling',
  'Excavation',
  'Flooring Material',
  'Gypsum Board',
  'Interior Finishes',
  'Ladders & Scaffolding',
  'PEB Structure',
  'PUF Wall Partition',
  'Piling',
  'Plumbing',
  'Rain Water Gutters',
  'Roofing',
  'Vinyl Sheet',
];
const VENDORS_PER_MINOR = 30;
const TARGET_PER_MINOR = VENDOR_ASSIGNMENT_LIMITS.MAX_PROCUCEV_PER_CATEGORY;

/** The minor a fixture vendor was built for. Fixture e-mails read vendor-<minorIndex>-<k>@fanout.test. */
function minorOfEmail(email) {
  return MINORS[Number(String(email).split('-')[1])];
}

/** Network vendors in the database, each filed under exactly one minor. Higher _order means newer. */
function networkVendorRows() {
  const rows = [];
  MINORS.forEach((minor, minorIndex) => {
    for (let k = 0; k < VENDORS_PER_MINOR; k += 1) {
      rows.push({
        id: `db-${minorIndex}-${k}`,
        name: `Network Vendor ${minorIndex}-${k}`,
        email: `vendor-${minorIndex}-${k}@fanout.test`,
        majorCategory: MAJOR,
        minorCategories: [minor],
        source: 'procucev_network',
        rating: 4,
        _order: rows.length + 1,
      });
    }
  });
  return rows;
}

/** A capped in-memory pool that covers only the first two minors, as a page of recent vendors might. */
function inMemoryPoolCoveringTwoMinors() {
  return networkVendorRows().filter((vendor) => vendor.minorCategories[0] === MINORS[0] || vendor.minorCategories[0] === MINORS[1]);
}

/** Stands in for the SQL `JSON LIKE '%"term'` test: a minor name starts with one of the search terms. */
function coversAnyTerm(vendor, terms) {
  return vendor.minorCategories.some((minor) => {
    const name = minor.toLowerCase();
    return terms.some((term) => name.startsWith(term));
  });
}

/** Stands in for `ORDER BY created_at DESC LIMIT n`. */
function newestFirst(rows, limit) {
  return [...rows].sort((a, b) => b._order - a._order).slice(0, limit);
}

function persistedCopy(rfq) {
  return JSON.parse(JSON.stringify(rfq));
}

/** A 40-line RFQ that names the 15 minors in turn. The first line names the first minor. */
function fanoutRfq(overrides = {}) {
  return {
    id: 'rfq-fanout',
    rfqNumber: 'RFQ-FANOUT',
    title: 'Civil works order',
    category: MAJOR,
    status: 'Open',
    deliveryLocation: 'Mumbai, Maharashtra',
    deliveryPincode: '400001',
    extractedEntities: Array.from({ length: 40 }, (_, index) => ({
      id: `li-${index}`,
      itemName: `Item ${index}`,
      majorCategory: MAJOR,
      minorCategory: MINORS[index % MINORS.length],
      quantity: 1,
      unit: 'Nos',
    })),
    assignedVendors: [],
    ...overrides,
  };
}

describe('RFQ invitations cover every minor category of a multi-minor RFQ', () => {
  let rfqStore;
  let updateSpy;

  function mockNetworkLookups(rows) {
    jest.spyOn(domainQueries, 'getPublicVendorsByMinorCategoryFromDB').mockImplementation(async (terms, majors, limit) => newestFirst(
      rows.filter((vendor) => majors.includes(vendor.majorCategory.toLowerCase()) && coversAnyTerm(vendor, terms)),
      limit
    ));
    jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockImplementation(async (terms, limit) => newestFirst(
      rows.filter((vendor) => coversAnyTerm(vendor, terms)),
      limit
    ));
    jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockImplementation(async (majors, limit) => newestFirst(
      rows.filter((vendor) => majors.includes(vendor.majorCategory.toLowerCase())),
      limit
    ));
    jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({ rows: [], total: 0 });
    jest.spyOn(domainQueries, 'getVendorsByBuyerFromDB').mockResolvedValue([]);
  }

  beforeEach(() => {
    rfqStore = new Map();
    storeService.vendors = [];
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(storeService, '_persistRFQ').mockImplementation(() => {});
    jest.spyOn(storeService, '_persistNotification').mockImplementation(() => {});
    jest.spyOn(storeService, '_recordChannelFeedItem').mockImplementation(() => {});
    jest.spyOn(storeService, '_dispatchRFQVendorInviteOutbox').mockImplementation(() => {});
    jest.spyOn(storeService, '_notifyRFQUpdate').mockImplementation(() => {});
    jest.spyOn(storeService, '_alertRfqMinorShortfall').mockImplementation(() => {});
    jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});
    jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
    jest.spyOn(domainQueries, 'getRFQSnapshotByIdFromDB').mockImplementation(async (id) => (
      rfqStore.has(id) ? { rfq: persistedCopy(rfqStore.get(id)) } : null
    ));
    updateSpy = jest.spyOn(domainQueries, 'updateRFQIfUnchangedInDB').mockImplementation(async (_snapshot, candidate) => {
      rfqStore.set(candidate.id, persistedCopy(candidate));
      return persistedCopy(candidate);
    });
    mockNetworkLookups(networkVendorRows());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createFanoutRfq(sourcingMode) {
    const created = storeService.createRFQ(
      fanoutRfq({ sourcingMode, id: `rfq-fanout-${sourcingMode}`, rfqNumber: `RFQ-FANOUT-${sourcingMode}` }),
      null,
      { deferPersistence: true, deferSideEffects: true, deferVendorPlan: true }
    );
    rfqStore.set(created.id, persistedCopy(created));
    return created;
  }

  /** Invitation targets from the last write that queued any, in the order they were written. */
  function lastQueuedTargets() {
    const writes = updateSpy.mock.calls
      .map(([, candidate]) => candidate.vendorInvitationTargets || [])
      .filter((targets) => targets.length > 0);
    return writes[writes.length - 1] || [];
  }

  function expectEveryMinorCovered(vendors) {
    for (const minor of MINORS) {
      const covered = vendors.filter((vendor) => storeService.vendorCoversMinorCategory(vendor, minor));
      expect(covered).toHaveLength(TARGET_PER_MINOR);
    }
  }

  test('assigns every minor its per-minor target, not only the first minor', async () => {
    const created = createFanoutRfq('mode_0');

    const updated = await storeService.augmentV0AssignmentsFromDB(created);

    expect(updated.assignedVendors).toHaveLength(MINORS.length * TARGET_PER_MINOR);
    expectEveryMinorCovered(updated.assignedVendors);
  });

  test('queues the invitations in turn across the minors, so the first batch reaches every minor', async () => {
    const created = createFanoutRfq('mode_0');

    await storeService.augmentV0AssignmentsFromDB(created);

    const queued = lastQueuedTargets();
    expect(queued).toHaveLength(MINORS.length * TARGET_PER_MINOR);
    const firstBatch = queued.slice(0, MINORS.length).map((target) => minorOfEmail(target.recipientEmail));
    expect(new Set(firstBatch)).toEqual(new Set(MINORS));
  });

  test('e-mails the invitations in turn across the minors, so a partly sent batch still covers every minor', async () => {
    const created = createFanoutRfq('mode_0');

    await storeService.augmentV0AssignmentsFromDB(created);

    const sent = mailerService.sendRfqInviteEmail.mock.calls.map(([email]) => email);
    expect(sent).toHaveLength(MINORS.length * TARGET_PER_MINOR);
    expect(new Set(sent.slice(0, MINORS.length).map(minorOfEmail))).toEqual(new Set(MINORS));
  });

  test('logs the minor invitation plan with the planned and added vendor count for each minor', async () => {
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    const created = createFanoutRfq('mode_0');

    await storeService.augmentV0AssignmentsFromDB(created);

    expect(infoSpy).toHaveBeenCalledWith(
      'RFQ minor invitation plan',
      expect.objectContaining({
        rfqNumber: 'RFQ-FANOUT-mode_0',
        path: 'v0-augment',
        minorCount: MINORS.length,
        plannedVendors: MINORS.length * TARGET_PER_MINOR,
        addedVendors: MINORS.length * TARGET_PER_MINOR,
        shortfallMinors: [],
        perMinor: MINORS.map((minorCategory) => expect.objectContaining({ minorCategory, vendors: TARGET_PER_MINOR })),
      }),
      'STORE_SERVICE'
    );
  });

  test('a mode_2 RFQ assigns every minor its target and queues and e-mails the invitations in turn', async () => {
    const created = createFanoutRfq('mode_2');

    const updated = await storeService.autoAssignVendorsFromDB(created);

    expect(updated.assignedVendors).toHaveLength(MINORS.length * TARGET_PER_MINOR);
    expectEveryMinorCovered(updated.assignedVendors);
    const queued = lastQueuedTargets();
    expect(new Set(queued.slice(0, MINORS.length).map((target) => minorOfEmail(target.recipientEmail)))).toEqual(new Set(MINORS));
    const sent = mailerService.sendRfqInviteEmail.mock.calls.map(([email]) => email);
    expect(new Set(sent.slice(0, MINORS.length).map(minorOfEmail))).toEqual(new Set(MINORS));
  });

  test('a planned RFQ created in the durable path gets its vendors and invitations from the database plan', async () => {
    storeService.vendors = inMemoryPoolCoveringTwoMinors();
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(null);
    const persistSpy = jest.spyOn(storeService, 'persistRFQDurably').mockResolvedValue(undefined);
    jest.spyOn(storeService, 'dispatchRFQCreationSideEffects').mockImplementation(() => {});

    const created = await storeService.createRFQDurably(
      fanoutRfq({ sourcingMode: 'mode_0', id: 'rfq-durable-v0', rfqNumber: 'RFQ-DURABLE-V0', status: 'Parsing' })
    );

    expect(created.assignedVendors).toEqual([]);
    const persisted = persistSpy.mock.calls[0][0];
    expect(persisted.vendorInvitationTargets).toEqual([]);
    rfqStore.set(persisted.id, persistedCopy(persisted));

    const completed = await storeService.completeRFQVendorPlan(created, { notifyShortfall: true });

    expect(completed.assignedVendors).toHaveLength(MINORS.length * TARGET_PER_MINOR);
    expectEveryMinorCovered(completed.assignedVendors);
    expect(new Set(lastQueuedTargets().slice(0, MINORS.length).map((target) => minorOfEmail(target.recipientEmail)))).toEqual(new Set(MINORS));
    expect(rfqStore.get(persisted.id).status).toBe('Quotes Pending');
  });

  test('without the plan flag the in-memory pool still queues invitations at creation, as before', () => {
    storeService.vendors = inMemoryPoolCoveringTwoMinors();

    const created = storeService.createRFQ(
      fanoutRfq({ sourcingMode: 'mode_0', id: 'rfq-control', rfqNumber: 'RFQ-CONTROL' }),
      null,
      { deferPersistence: true, deferSideEffects: true }
    );

    expect(created.vendorInvitationTargets.length).toBeGreaterThan(0);
  });

  test('a planned RFQ keeps the vendors the buyer named and queues only their invitations at creation', () => {
    const roster = [{ id: 'roster-1', name: 'Roster Co', email: 'roster@fanout.test', source: 'buyer_uploaded' }];

    const created = storeService.createRFQ(
      fanoutRfq({ sourcingMode: 'mode_2', id: 'rfq-roster', rfqNumber: 'RFQ-ROSTER', assignedVendors: roster }),
      null,
      { deferPersistence: true, deferSideEffects: true, deferVendorPlan: true }
    );

    expect(created.assignedVendors.map((vendor) => vendor.id)).toEqual(['roster-1']);
    expect(created.vendorInvitationTargets.map((target) => target.recipientEmail)).toEqual(['roster@fanout.test']);
  });

  test('a deferred V0 RFQ still drops buyer-owned vendors from the vendors it was given', () => {
    const buyerOwned = { id: 'buyer-owned-1', name: 'Buyer Owned Co', email: 'owned@fanout.test', buyerId: 'buyer-1', source: 'buyer_uploaded' };

    const created = storeService.createRFQ(
      fanoutRfq({ sourcingMode: 'mode_0', id: 'rfq-v0-filter', rfqNumber: 'RFQ-V0-FILTER', assignedVendors: [buyerOwned] }),
      null,
      { deferPersistence: true, deferSideEffects: true, deferVendorPlan: true }
    );

    expect(created.assignedVendors).toEqual([]);
    expect(created.vendorInvitationTargets).toEqual([]);
  });

  describe('completeRFQVendorPlan', () => {
    test('a V0 RFQ with a minor runs the V0 augment and a V2 RFQ runs auto-assignment', async () => {
      const augment = jest.spyOn(storeService, 'augmentV0AssignmentsFromDB').mockResolvedValue({ id: 'from-augment' });
      const autoAssign = jest.spyOn(storeService, 'autoAssignVendorsFromDB').mockResolvedValue({ id: 'from-auto-assign' });

      await expect(storeService.completeRFQVendorPlan(fanoutRfq({ sourcingMode: 'mode_0' }), { notifyShortfall: true }))
        .resolves.toEqual({ id: 'from-augment' });
      await expect(storeService.completeRFQVendorPlan(fanoutRfq({ sourcingMode: 'mode_2' }))).resolves.toEqual({ id: 'from-auto-assign' });
      expect(augment).toHaveBeenCalledWith(expect.objectContaining({ sourcingMode: 'mode_0' }), { notifyShortfall: true });
      expect(autoAssign).toHaveBeenCalledWith(expect.objectContaining({ sourcingMode: 'mode_2' }), { notifyShortfall: false });
    });

    test('an RFQ that is not planned, or names no minor, is returned unchanged', async () => {
      const augment = jest.spyOn(storeService, 'augmentV0AssignmentsFromDB');
      const autoAssign = jest.spyOn(storeService, 'autoAssignVendorsFromDB');
      const modeOne = fanoutRfq({ sourcingMode: 'mode_1' });
      const noMinor = fanoutRfq({ sourcingMode: 'mode_0', extractedEntities: [], category: MAJOR });

      await expect(storeService.completeRFQVendorPlan(modeOne)).resolves.toBe(modeOne);
      await expect(storeService.completeRFQVendorPlan(noMinor)).resolves.toBe(noMinor);
      await expect(storeService.completeRFQVendorPlan(null)).resolves.toBeNull();
      expect(augment).not.toHaveBeenCalled();
      expect(autoAssign).not.toHaveBeenCalled();
    });
  });

  describe('turn order across minors', () => {
    test('takes one vendor from each minor in turn, then the vendors that cover no minor', () => {
      const minors = ['Bricks', 'Roofing'];
      const vendors = [
        { id: 'b1', minorCategories: ['Bricks'] },
        { id: 'b2', minorCategories: ['Bricks'] },
        { id: 'b3', minorCategories: ['Bricks'] },
        { id: 'r1', minorCategories: ['Roofing'] },
        { id: 'top', minorCategories: [] },
        { id: 'r2', minorCategories: ['Roofing'] },
        { id: 'both', minorCategories: ['Roofing', 'Bricks'] },
      ];

      expect(storeService._interleaveVendorsByMinor(vendors, minors).map((vendor) => vendor.id))
        .toEqual(['b1', 'r1', 'b2', 'r2', 'b3', 'both', 'top']);
    });

    test('keeps the order of a vendor list when the RFQ names no minor, and of an empty list', () => {
      const vendors = [{ id: 'a' }, { id: 'b' }];

      expect(storeService._interleaveVendorsByMinor(vendors, []).map((vendor) => vendor.id)).toEqual(['a', 'b']);
      expect(storeService._interleaveVendorsByMinor(null, MINORS)).toEqual([]);
    });
  });
});
