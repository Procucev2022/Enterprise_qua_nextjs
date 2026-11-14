const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const pool = require('../src/db/pool');
const mailerService = require('../src/services/mailerService');
const rfqChaserScheduler = require('../src/services/rfqChaserScheduler');
const { logger } = require('../src/services/loggerService');
const { VENDOR_ASSIGNMENT_LIMITS, RFQ_MINOR_INVITE_LOOKUP } = require('../src/config/constants');

// An RFQ that names minor categories is filled to the per-minor target from the vendors carrying
// each minor, then from the vendors under the minor's parent major. A shortfall is reported to the
// Procucev team. These tests pin the planner, the lookups behind it, the alert and the flows that use them.

const MAJOR = 'Engineering Spares - Mechanical';
const MINOR = 'Bearings & Accessories';
const OTHER_MINOR = 'Pumps & Accessories';
const TARGET = VENDOR_ASSIGNMENT_LIMITS.MAX_PROCUCEV_PER_CATEGORY;
const PER_MINOR_LOOKUP = VENDOR_ASSIGNMENT_LIMITS.MAX_PROCUCEV_PER_CATEGORY * RFQ_MINOR_INVITE_LOOKUP.OVERFETCH_FACTOR;
const DEFAULT_RECIPIENTS = ['gmtrfq@procucev.com', 'quateam@procucev.com', 'anshul.goel@procucev.com', 'veerababu.v@procucev.com'];

/** A Procucev network vendor. A vendor with no minors is a major-only vendor. */
function networkVendor(id, { minors = [], major = MAJOR, rating = 3, pincode = null } = {}) {
  return {
    id,
    name: `Vendor ${id}`,
    email: `${id}@quota.test`,
    majorCategory: major,
    minorCategories: minors,
    source: 'procucev_network',
    rating,
    ...(pincode ? { pincode } : {}),
  };
}

/** Vendors carrying MINOR, numbered from `prefix`, with ratings `start` down to one less each step. */
function minorVendors(count, prefix, start = 5) {
  return Array.from({ length: count }, (_, i) => networkVendor(`${prefix}${i}`, { minors: [MINOR], rating: start - i * 0.01 }));
}

/** Vendors filed under MAJOR only, numbered from `prefix`, rated from 10 downwards. */
function majorOnlyVendors(count, prefix) {
  return Array.from({ length: count }, (_, i) => networkVendor(`${prefix}${i}`, { rating: 10 - i }));
}

/** An RFQ that names MINOR and has no vendors assigned yet. */
function minorRfq(overrides = {}) {
  return {
    id: 'rfq-quota',
    rfqNumber: 'RFQ-QUOTA',
    title: 'Quota RFQ',
    category: MAJOR,
    status: 'Open',
    deliveryLocation: 'Mumbai, Maharashtra',
    deliveryPincode: '400001',
    extractedEntities: [{ id: 'li-1', itemName: 'Ball bearing 6205', majorCategory: MAJOR, minorCategory: MINOR, quantity: 2, unit: 'Nos' }],
    assignedVendors: [],
    ...overrides,
  };
}

/** A buyer account. createRFQ stamps the RFQ's buyerAccountId from the requesting account. */
const BUYER_7 = { id: 'buyer-7', organizationName: 'Quota Buyer', corporateEmail: 'buyer-7@quota.test' };

/** Creates an RFQ in memory, with no persistence or outgoing side effects. */
function createQuietRfq(overrides = {}, buyer = null) {
  return storeService.createRFQ(minorRfq(overrides), buyer, { deferPersistence: true, deferSideEffects: true });
}

const idsOf = (vendors) => vendors.map((vendor) => vendor.id);

describe('planMinorInvites', () => {
  beforeEach(() => {
    storeService.vendors = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('fills a minor to the target from its own vendors, best rated first', () => {
    const plan = storeService.planMinorInvites(minorRfq(), { candidatePool: minorVendors(30, 'm'), limit: 25 });

    expect(plan.selected).toHaveLength(25);
    expect(idsOf(plan.selected)).toEqual(Array.from({ length: 25 }, (_, i) => `m${i}`));
    expect(plan.shortfalls).toEqual([]);
  });

  test('tops a short minor up from its parent major and reports the shortfall', () => {
    const plan = storeService.planMinorInvites(minorRfq(), {
      candidatePool: [...minorVendors(21, 'b'), ...majorOnlyVendors(10, 'x')],
      limit: 25,
    });

    expect(plan.selected).toHaveLength(25);
    expect(idsOf(plan.selected).slice(21)).toEqual(['x0', 'x1', 'x2', 'x3']);
    expect(plan.shortfalls).toEqual([
      { minorCategory: MINOR, majorCategory: MAJOR, minorMatched: 21, majorFilled: 4, target: 25 },
    ]);
  });

  test('takes no major vendor when the minor alone reaches the target', () => {
    const plan = storeService.planMinorInvites(minorRfq(), {
      candidatePool: [...minorVendors(25, 'b'), ...majorOnlyVendors(5, 'x')],
      limit: 25,
    });

    expect(plan.selected).toHaveLength(25);
    expect(plan.selected.every((vendor) => vendor.minorCategories.includes(MINOR))).toBe(true);
    expect(plan.shortfalls).toEqual([]);
  });

  test('fills a minor that has no vendor at all entirely from its parent major', () => {
    const plan = storeService.planMinorInvites(minorRfq(), { candidatePool: majorOnlyVendors(3, 'x'), limit: 25 });

    expect(idsOf(plan.selected)).toEqual(['x0', 'x1', 'x2']);
    expect(plan.shortfalls).toEqual([
      { minorCategory: MINOR, majorCategory: MAJOR, minorMatched: 0, majorFilled: 3, target: 25 },
    ]);
  });

  test('reports a shortfall with nothing added when neither the minor nor its major has a vendor', () => {
    const plan = storeService.planMinorInvites(minorRfq(), {
      candidatePool: [networkVendor('z1', { major: 'Electrical', minors: ['Cables'] })],
      limit: 25,
    });

    expect(plan.selected).toEqual([]);
    expect(plan.shortfalls).toEqual([
      { minorCategory: MINOR, majorCategory: MAJOR, minorMatched: 0, majorFilled: 0, target: 25 },
    ]);
  });

  test('tops up a minor without a taxonomy parent from its own vendors only', () => {
    const rfq = minorRfq({ extractedEntities: [{ minorCategory: 'Zorblax Widgets', quantity: 1, unit: 'Nos' }] });
    const plan = storeService.planMinorInvites(rfq, {
      candidatePool: [networkVendor('w1', { minors: ['Zorblax Widgets'] }), networkVendor('w2', { rating: 9 })],
      limit: 5,
    });

    expect(idsOf(plan.selected)).toEqual(['w1']);
    expect(plan.shortfalls).toEqual([
      { minorCategory: 'Zorblax Widgets', majorCategory: null, minorMatched: 1, majorFilled: 0, target: 5 },
    ]);
  });

  test('counts seed vendors toward the minors they carry, keeps them first, and adds only the missing vendors', () => {
    const seeds = [networkVendor('s1', { minors: [MINOR], rating: 1 }), networkVendor('s2', { minors: [MINOR], rating: 1 })];
    const plan = storeService.planMinorInvites(minorRfq(), { candidatePool: minorVendors(30, 'm'), seedVendors: seeds, limit: 25 });

    expect(plan.selected).toHaveLength(25);
    expect(idsOf(plan.selected).slice(0, 2)).toEqual(['s1', 's2']);
    expect(new Set(idsOf(plan.selected)).size).toBe(25);
    expect(plan.shortfalls).toEqual([]);
  });

  test('a seed major vendor counts toward the top-up, so the fill adds only what is still missing', () => {
    const seeds = [networkVendor('sm', { rating: 1 })];
    const plan = storeService.planMinorInvites(minorRfq(), {
      candidatePool: [...minorVendors(20, 'b'), ...majorOnlyVendors(10, 'x')],
      seedVendors: seeds,
      limit: 25,
    });

    expect(plan.selected).toHaveLength(25);
    expect(idsOf(plan.selected)).toContain('sm');
    expect(idsOf(plan.selected).filter((id) => id.startsWith('x'))).toHaveLength(4);
    expect(plan.shortfalls).toEqual([
      { minorCategory: MINOR, majorCategory: MAJOR, minorMatched: 20, majorFilled: 5, target: 25 },
    ]);
  });

  test('lists a vendor that serves two minors once, and counts it for both', () => {
    const rfq = minorRfq({
      extractedEntities: [
        { minorCategory: MINOR, quantity: 1, unit: 'Nos' },
        { minorCategory: OTHER_MINOR, quantity: 1, unit: 'Nos' },
      ],
    });
    const both = networkVendor('both', { minors: [MINOR, OTHER_MINOR], rating: 1 });
    const plan = storeService.planMinorInvites(rfq, { candidatePool: [both, ...minorVendors(24, 'b')], limit: 25 });

    expect(plan.selected).toHaveLength(25);
    expect(new Set(idsOf(plan.selected)).size).toBe(25);
    // The 24 vendors picked for MINOR sit under the same parent major, so they also fill OTHER_MINOR's slate.
    expect(plan.shortfalls).toEqual([
      { minorCategory: OTHER_MINOR, majorCategory: expect.any(String), minorMatched: 1, majorFilled: 24, target: 25 },
    ]);
  });

  test('ranks by delivery pincode before rating when a location is given', () => {
    const far = networkVendor('far', { minors: [MINOR], rating: 5, pincode: '110001' });
    const near = networkVendor('near', { minors: [MINOR], rating: 1, pincode: '400001' });
    const plan = storeService.planMinorInvites(minorRfq(), {
      candidatePool: [far, near],
      targetLocation: { pincode: '400001', location: null },
      limit: 1,
    });

    expect(idsOf(plan.selected)).toEqual(['near']);
  });

  test('uses the configured per-minor target when no limit is given or the limit is not positive', () => {
    const pool = minorVendors(30, 'm');

    expect(storeService.planMinorInvites(minorRfq(), { candidatePool: pool }).selected).toHaveLength(TARGET);
    expect(storeService.planMinorInvites(minorRfq(), { candidatePool: pool, limit: 0 }).selected).toHaveLength(TARGET);
  });

  test('returns only the seeds for an RFQ without minor categories', () => {
    const rfq = { category: MAJOR, extractedEntities: [{ majorCategory: MAJOR }] };
    const plan = storeService.planMinorInvites(rfq, {
      candidatePool: [networkVendor('m1', { minors: [MINOR] })],
      seedVendors: [networkVendor('s1')],
    });

    expect(idsOf(plan.selected)).toEqual(['s1']);
    expect(plan.shortfalls).toEqual([]);
  });

  test('skips entries with no identifying key, lists a repeated candidate once, and accepts missing lists', () => {
    const vendor = networkVendor('once', { minors: [MINOR] });
    const plan = storeService.planMinorInvites(minorRfq(), {
      candidatePool: [null, {}, vendor, vendor],
      seedVendors: [null, {}],
      limit: 5,
    });

    expect(idsOf(plan.selected)).toEqual(['once']);
    expect(storeService.planMinorInvites(minorRfq(), { candidatePool: null, seedVendors: null }).selected).toEqual([]);
  });

  test('checks a seed against its in-memory record, or against the entry itself when the vendor is not in memory', () => {
    storeService.vendors = [networkVendor('vIn', { minors: [MINOR] })];
    const seeds = [
      { id: 'vIn', name: 'Stored only' },
      { id: 'vGhost', name: 'Ghost', minorCategories: [MINOR] },
      { email: 'nameless@quota.test', minorCategories: [MINOR] },
    ];
    const plan = storeService.planMinorInvites(minorRfq(), { seedVendors: seeds, limit: 3 });

    expect(plan.selected).toHaveLength(3);
    expect(plan.shortfalls).toEqual([]);
  });

  test('a vendor filed under a legacy alias of the parent major, or under only a category field, counts for the top-up', () => {
    const alias = { id: 'al', name: 'Alias', email: 'al@quota.test', majorCategory: 'Mechanical', source: 'procucev_network', rating: 9 };
    const legacy = { id: 'lg', name: 'Legacy', email: 'lg@quota.test', category: MAJOR, source: 'procucev_network', rating: 8 };
    const plan = storeService.planMinorInvites(minorRfq(), { candidatePool: [legacy, alias], limit: 2 });

    expect(idsOf(plan.selected)).toEqual(['al', 'lg']);
    expect(plan.shortfalls[0]).toMatchObject({ minorMatched: 0, majorFilled: 2 });
  });
});

describe('network lookups for minor categories', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('one lookup covers every minor when it returns fewer rows than its cap', async () => {
    const fetch = jest.fn().mockResolvedValue([{ id: 'a' }]);

    const rows = await storeService._fetchMinorCandidatesFromDB([MINOR, OTHER_MINOR], fetch);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith([MINOR, OTHER_MINOR], PER_MINOR_LOOKUP * 2);
    expect(rows).toEqual([{ id: 'a' }]);
  });

  test('looks each minor up on its own when the combined lookup fills its cap', async () => {
    const full = Array.from({ length: PER_MINOR_LOOKUP * 2 }, (_, i) => ({ id: `c${i}` }));
    const fetch = jest.fn(async (subset) => (subset.length === 2 ? full : [{ id: `only-${subset[0]}` }]));

    const rows = await storeService._fetchMinorCandidatesFromDB([MINOR, OTHER_MINOR], fetch);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenNthCalledWith(2, [MINOR], PER_MINOR_LOOKUP);
    expect(fetch).toHaveBeenNthCalledWith(3, [OTHER_MINOR], PER_MINOR_LOOKUP);
    expect(rows).toHaveLength(full.length + 2);
  });

  test('a single minor is never looked up twice, even when its lookup is full', async () => {
    const fetch = jest.fn().mockResolvedValue(Array.from({ length: PER_MINOR_LOOKUP }, (_, i) => ({ id: `s${i}` })));

    const rows = await storeService._fetchMinorCandidatesFromDB([MINOR], fetch);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(PER_MINOR_LOOKUP);
  });

  test('a combined lookup that returns no array contributes no rows, and a per-minor lookup that returns none adds nothing', async () => {
    expect(await storeService._fetchMinorCandidatesFromDB([MINOR, OTHER_MINOR], jest.fn().mockResolvedValue(undefined))).toEqual([]);

    const full = Array.from({ length: PER_MINOR_LOOKUP * 2 }, (_, i) => ({ id: `c${i}` }));
    const fetch = jest.fn(async (subset) => (subset.length === 2 ? full : undefined));
    expect(await storeService._fetchMinorCandidatesFromDB([MINOR, OTHER_MINOR], fetch)).toHaveLength(full.length);
  });

  test('reads one parent major per distinct set of majors, and skips minors that have no parent', async () => {
    const spy = jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockResolvedValue([{ id: 'maj' }]);

    const rows = await storeService._fetchMajorFallbackFromDB([MINOR, MINOR, 'Zorblax Widgets']);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.arrayContaining([MAJOR.toLowerCase()]), PER_MINOR_LOOKUP);
    expect(rows).toEqual([{ id: 'maj' }]);
  });

  test('a major lookup that returns no array adds nothing', async () => {
    jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockResolvedValue(undefined);

    expect(await storeService._fetchMajorFallbackFromDB([MINOR])).toEqual([]);
  });
});

describe('minor shortfall alert', () => {
  let sendSpy;
  const shortfall = { minorCategory: MINOR, majorCategory: MAJOR, minorMatched: 21, majorFilled: 4, target: 25 };

  beforeEach(() => {
    delete process.env.RFQ_MINOR_SHORTFALL_ALERT_EMAILS;
    sendSpy = jest.spyOn(mailerService, 'sendRfqMinorShortfallEmail').mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    delete process.env.RFQ_MINOR_SHORTFALL_ALERT_EMAILS;
    jest.restoreAllMocks();
  });

  test('sends nothing when no minor fell short or there is no RFQ', () => {
    storeService._alertRfqMinorShortfall(minorRfq(), []);
    storeService._alertRfqMinorShortfall(minorRfq(), undefined);
    storeService._alertRfqMinorShortfall(null, [shortfall]);

    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('emails the default recipients with the RFQ and its shortfalls', () => {
    const rfq = minorRfq();
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    storeService._alertRfqMinorShortfall(rfq, [shortfall]);

    expect(sendSpy).toHaveBeenCalledWith({ recipients: DEFAULT_RECIPIENTS, rfq, shortfalls: [shortfall] });
    expect(warnSpy).toHaveBeenCalledWith(
      'RFQ minor category vendor shortfall',
      expect.objectContaining({ rfqNumber: 'RFQ-QUOTA', recipients: DEFAULT_RECIPIENTS }),
      'STORE_SERVICE'
    );
  });

  test('uses the recipients listed in RFQ_MINOR_SHORTFALL_ALERT_EMAILS when it is set', () => {
    process.env.RFQ_MINOR_SHORTFALL_ALERT_EMAILS = 'ops@quota.test, lead@quota.test';
    const rfq = minorRfq();

    storeService._alertRfqMinorShortfall(rfq, [shortfall]);

    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ recipients: ['ops@quota.test', 'lead@quota.test'] }));
  });

  test('a failed send is logged and does not reject the flow that raised it', async () => {
    sendSpy.mockRejectedValue(new Error('SMTP down'));
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    storeService._alertRfqMinorShortfall(minorRfq(), [shortfall]);
    await new Promise((resolve) => setImmediate(resolve));

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to send the RFQ minor category shortfall alert',
      expect.objectContaining({ rfqNumber: 'RFQ-QUOTA', operation: 'rfq-minor-shortfall-alert' }),
      'STORE_SERVICE'
    );
  });
});

describe('vendor lookup helpers', () => {
  beforeEach(() => {
    storeService.vendors = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('the visible vendors leave out another buyer private vendor', () => {
    const mine = { ...networkVendor('m1'), buyerAccountId: 'buyer-1', source: 'buyer_uploaded' };
    const theirs = { ...networkVendor('t1'), buyerAccountId: 'buyer-9', source: 'buyer_uploaded' };
    storeService.vendors = [mine, theirs, networkVendor('p1')];

    expect(idsOf(storeService._visibleVendorsForRFQ({ buyerAccountId: 'buyer-1', extractedEntities: [] }))).toEqual(['m1', 'p1']);
  });

  test('an assignment entry resolves to its in-memory record, or stays as it is when there is none', () => {
    storeService.vendors = [networkVendor('p1')];

    expect(storeService._storedVendorRecord({ id: 'p1', name: 'stub' }).majorCategory).toBe(MAJOR);
    expect(storeService._storedVendorRecord({ id: 'gone', name: 'stub' })).toEqual({ id: 'gone', name: 'stub' });
    expect(storeService._storedVendorRecord({ name: 'nameless' })).toEqual({ name: 'nameless' });
    expect(storeService._storedVendorRecord(null)).toBeNull();
  });
});

describe('database top-up for a minor-level RFQ', () => {
  let alertSpy;

  beforeEach(() => {
    storeService.vendors = [];
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(storeService, '_persistRFQ').mockImplementation(() => {});
    jest.spyOn(storeService, '_persistNotification').mockImplementation(() => {});
    jest.spyOn(storeService, '_dispatchRFQVendorInviteOutbox').mockImplementation(() => {});
    jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});
    jest.spyOn(storeService, '_appendRFQAssignmentsDurably').mockImplementation(async (rfqId, additions) => {
      const current = storeService.rfqs.find((rfq) => rfq.id === rfqId);
      const updatedRFQ = { ...current, assignedVendors: [...(current.assignedVendors || []), ...additions], followUpData: null };
      return { updatedRFQ, committedAdditions: additions };
    });
    jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockResolvedValue([]);
    jest.spyOn(domainQueries, 'getVendorsByBuyerFromDB').mockResolvedValue([]);
    alertSpy = jest.spyOn(storeService, '_alertRfqMinorShortfall').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a V0 minor RFQ reports its shortfall only when the creation flow asks for it', async () => {
    const created = createQuietRfq({ sourcingMode: 'mode_0', id: 'rfq-alert-v0', rfqNumber: 'RFQ-ALERT-V0' });
    jest.spyOn(domainQueries, 'getPublicVendorsByMinorCategoryFromDB').mockResolvedValue([networkVendor('a1', { minors: [MINOR] })]);
    jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockResolvedValue([networkVendor('a2', { rating: 9 })]);

    await storeService.augmentV0AssignmentsFromDB(created);
    expect(alertSpy).not.toHaveBeenCalled();

    const updated = await storeService.augmentV0AssignmentsFromDB(created, { notifyShortfall: true });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(created, [
      { minorCategory: MINOR, majorCategory: MAJOR, minorMatched: 1, majorFilled: 1, target: TARGET },
    ]);
    expect(idsOf(updated.assignedVendors)).toEqual(['a1', 'a2']);
  });

  test('a V0 minor RFQ with no vendor alerts for every short minor and goes to the Category Manager', async () => {
    const created = createQuietRfq({ sourcingMode: 'mode_0', id: 'rfq-alert-v0-none', rfqNumber: 'RFQ-ALERT-V0-NONE' });
    jest.spyOn(domainQueries, 'getPublicVendorsByMinorCategoryFromDB').mockResolvedValue([]);
    const updateSpy = jest.spyOn(storeService, 'updateRFQDurably').mockImplementation(async (_id, update) => ({ ...created, ...update(created) }));

    const updated = await storeService.augmentV0AssignmentsFromDB(created, { notifyShortfall: true });

    expect(alertSpy).toHaveBeenCalledWith(created, [
      { minorCategory: MINOR, majorCategory: MAJOR, minorMatched: 0, majorFilled: 0, target: TARGET },
    ]);
    expect(updateSpy).toHaveBeenCalledWith(created.id, expect.any(Function));
    expect(updated.needsCategoryManagerAssignment).toBe(true);
  });

  test('a V0 minor RFQ keeps a buyer-side assignment and is not routed to the Category Manager when nothing new is found', async () => {
    const created = createQuietRfq({ sourcingMode: 'mode_0', id: 'rfq-alert-v0-keep', rfqNumber: 'RFQ-ALERT-V0-KEEP' });
    created.assignedVendors = [{ id: 'buyer-x', name: 'Buyer X', email: 'buyer-x@quota.test', source: 'buyer_uploaded', buyerId: 'b-1' }];
    jest.spyOn(domainQueries, 'getPublicVendorsByMinorCategoryFromDB').mockResolvedValue([]);
    const updateSpy = jest.spyOn(storeService, 'updateRFQDurably');

    const result = await storeService.augmentV0AssignmentsFromDB(created, { notifyShortfall: true });

    expect(result).toBe(created);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  test('a mode_2 minor RFQ alerts on a network shortfall, and a mode_1 RFQ never does', async () => {
    jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([networkVendor('n1', { minors: [MINOR] })]);
    const network = createQuietRfq({ sourcingMode: 'mode_2', id: 'rfq-alert-m2', rfqNumber: 'RFQ-ALERT-M2' });

    const updated = await storeService.autoAssignVendorsFromDB(network, { deferChasers: true, notifyShortfall: true });

    expect(idsOf(updated.assignedVendors)).toEqual(['n1']);
    expect(alertSpy).toHaveBeenCalledWith(network, [
      { minorCategory: MINOR, majorCategory: MAJOR, minorMatched: 1, majorFilled: 0, target: TARGET },
    ]);

    alertSpy.mockClear();
    const roster = createQuietRfq({ sourcingMode: 'mode_1', id: 'rfq-alert-m1', rfqNumber: 'RFQ-ALERT-M1' });
    await storeService.autoAssignVendorsFromDB(roster, { deferChasers: true, notifyShortfall: true });
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('a mode_3 minor RFQ tops up from the network only and never reads the buyer roster', async () => {
    const rosterSpy = domainQueries.getVendorsByBuyerFromDB;
    jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([networkVendor('n-3', { minors: [MINOR] })]);
    const created = createQuietRfq({ sourcingMode: 'mode_3', id: 'rfq-alert-m3', rfqNumber: 'RFQ-ALERT-M3' });

    const updated = await storeService.autoAssignVendorsFromDB(created, { deferChasers: true });

    expect(rosterSpy).not.toHaveBeenCalled();
    expect(idsOf(updated.assignedVendors)).toEqual(['n-3']);
  });

  test('a mode_2 top-up keeps an explicit roster vendor once and adds only the missing network vendors', async () => {
    storeService.vendors = [{ ...networkVendor('r-explicit', { minors: [MINOR] }), source: 'buyer_uploaded', buyerAccountId: 'buyer-7' }];
    const created = createQuietRfq({
      sourcingMode: 'mode_2',
      id: 'rfq-seed-m2',
      rfqNumber: 'RFQ-SEED-M2',
      assignedVendors: [{ id: 'r-explicit', name: 'Vendor r-explicit', email: 'r-explicit@quota.test', source: 'buyer_uploaded' }],
    }, BUYER_7);
    expect(idsOf(created.assignedVendors)).toEqual(['r-explicit']);
    jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([networkVendor('n-2', { minors: [MINOR] })]);

    const updated = await storeService.autoAssignVendorsFromDB(created, { deferChasers: true });

    expect(idsOf(updated.assignedVendors)).toEqual(['r-explicit', 'n-2']);
  });

  test('a mode_1 RFQ without explicit vendors takes its buyer roster under the parent major when no roster vendor carries the minor', () => {
    storeService.vendors = [{ ...networkVendor('r-major', { rating: 4 }), source: 'buyer_uploaded', buyerAccountId: 'buyer-7' }];

    const created = createQuietRfq({ sourcingMode: 'mode_1', id: 'rfq-v1-fill', rfqNumber: 'RFQ-V1-FILL' }, BUYER_7);

    expect(idsOf(created.assignedVendors)).toEqual(['r-major']);
  });
});

describe('planMinorInvites: each minor is filled on its own', () => {
  beforeEach(() => {
    storeService.vendors = [];
  });

  test('a minor with no vendor of its own is topped up from the parent major after another minor filled its slate', () => {
    const rfq = minorRfq({
      extractedEntities: [
        { minorCategory: MINOR, quantity: 1, unit: 'Nos' },
        { minorCategory: OTHER_MINOR, quantity: 1, unit: 'Nos' },
      ],
    });
    // 21 vendors carry MINOR, nothing carries OTHER_MINOR, and the parent major holds 50 vendors in all.
    const plan = storeService.planMinorInvites(rfq, {
      candidatePool: [...minorVendors(21, 'a'), ...majorOnlyVendors(50, 'x')],
      limit: 25,
    });

    expect(plan.shortfalls).toEqual([
      { minorCategory: MINOR, majorCategory: MAJOR, minorMatched: 21, majorFilled: 4, target: 25 },
      { minorCategory: OTHER_MINOR, majorCategory: MAJOR, minorMatched: 0, majorFilled: 25, target: 25 },
    ]);
    // OTHER_MINOR's own top-up reaches parent-major vendors that MINOR's set did not take.
    expect(idsOf(plan.selected)).toEqual(expect.arrayContaining(['x4', 'x5']));
  });
});

describe('parent majors of a minor', () => {
  test('the default is the first major that lists the minor, and allMajors adds every other one, such as CAPEX for Panels', () => {
    const first = storeService._majorCategoriesForMinors(['Panels']);

    expect(first).toEqual(expect.arrayContaining(['engineering spares - electrical']));
    expect(first).not.toContain('capex - equipment & machinery');
    expect(storeService._majorCategoriesForMinors(['Panels'], { allMajors: true })).toEqual(
      expect.arrayContaining(['engineering spares - electrical', 'capex - equipment & machinery'])
    );
  });
});

describe('V0 minor lookup covers every major that lists the minor', () => {
  let minorSpy;

  beforeEach(() => {
    storeService.vendors = [];
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(storeService, '_persistRFQ').mockImplementation(() => {});
    jest.spyOn(storeService, 'updateRFQDurably').mockResolvedValue(null);
    jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockResolvedValue([]);
    minorSpy = jest.spyOn(domainQueries, 'getPublicVendorsByMinorCategoryFromDB').mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a Panels RFQ looks the minor up under the electrical major and the CAPEX major, where the taxonomy also lists it', async () => {
    const created = createQuietRfq({
      sourcingMode: 'mode_0',
      id: 'rfq-panels',
      rfqNumber: 'RFQ-PANELS',
      extractedEntities: [{ minorCategory: 'Panels', majorCategory: 'Engineering Spares - Electrical', quantity: 1, unit: 'Nos' }],
    });

    await storeService.augmentV0AssignmentsFromDB(created);

    const [, majors] = minorSpy.mock.calls[0];
    expect(majors).toEqual(expect.arrayContaining(['engineering spares - electrical', 'capex - equipment & machinery']));
  });
});
