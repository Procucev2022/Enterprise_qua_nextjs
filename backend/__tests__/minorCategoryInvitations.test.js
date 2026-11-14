const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const pool = require('../src/db/pool');
const rfqController = require('../src/controllers/rfqController');
const rfqChaserScheduler = require('../src/services/rfqChaserScheduler');
const { logger } = require('../src/services/loggerService');

// RFQ invitations follow the minor category the RFQ names, not its major category.
// Only a vendor that carries the RFQ's minor is invited. A vendor filed under the same
// major, or under a sibling minor, is not. These tests pin that rule for candidate
// selection, automatic assignment, the V0 database lookup, visibility and e-mail recipients.

const MAJOR = 'Engineering Spares - Mechanical';
const MINOR = 'Bearings & Accessories';

function procucevVendors() {
  return [
    { id: 'v-major', name: 'Major Only Co', email: 'major@minor-invite.test', majorCategory: MAJOR, minorCategories: [], source: 'procucev_network', rating: 5 },
    { id: 'v-minor', name: 'Bearing Specialist', email: 'bearing@minor-invite.test', majorCategory: MAJOR, minorCategories: [MINOR], source: 'procucev_network', rating: 3 },
    { id: 'v-other', name: 'Pump Specialist', email: 'pump@minor-invite.test', majorCategory: MAJOR, minorCategories: ['Pumps & Accessories'], source: 'procucev_network', rating: 4 },
    { id: 'v-accessory', name: 'Accessory Only Co', email: 'accessory@minor-invite.test', majorCategory: MAJOR, minorCategories: ['Accessories'], source: 'procucev_network', rating: 4 },
  ];
}

const vendorById = (id) => procucevVendors().find((vendor) => vendor.id === id);

function bearingRfq(overrides = {}) {
  return {
    id: 'rfq-minor-invite',
    rfqNumber: 'RFQ-MINOR-INVITE',
    title: 'Ball bearing order',
    category: MAJOR,
    status: 'Open',
    deliveryLocation: 'Mumbai, Maharashtra',
    deliveryPincode: '400001',
    extractedEntities: [{ id: 'li-1', itemName: 'Ball bearing 6205', majorCategory: MAJOR, minorCategory: MINOR, quantity: 2, unit: 'Nos' }],
    assignedVendors: [],
    ...overrides,
  };
}

/** Creates an RFQ in memory, with no persistence or outgoing side effects. */
function createQuietRfq(overrides = {}) {
  return storeService.createRFQ(bearingRfq(overrides), null, { deferPersistence: true, deferSideEffects: true });
}

describe('RFQ invitations follow the minor category', () => {
  beforeEach(() => {
    storeService.vendors = procucevVendors();
    jest.spyOn(storeService, '_persistRFQ').mockImplementation(() => {});
    jest.spyOn(storeService, '_persistNotification').mockImplementation(() => {});
    jest.spyOn(storeService, '_dispatchRFQVendorInviteOutbox').mockImplementation(() => {});
    jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('matching a vendor to a minor', () => {
    test('accepts the same minor under case, ampersand, spacing and singular or plural variations', () => {
      expect(storeService.vendorCoversMinorCategory({ minorCategories: [MINOR] }, MINOR)).toBe(true);
      expect(storeService.vendorCoversMinorCategory({ minorCategories: ['bearings and accessories'] }, MINOR)).toBe(true);
      expect(storeService.vendorCoversMinorCategory({ minorCategories: ['Bearings  &  Accessories'] }, MINOR)).toBe(true);
      expect(storeService.vendorCoversMinorCategory({ minorCategories: ['Steel'] }, 'Steels')).toBe(true);
      expect(storeService.vendorCoversMinorCategory({ minorCategories: ['Steels'] }, 'Steel')).toBe(true);
      expect(storeService.vendorCoversMinorCategory({ minorCategories: ['Box'] }, 'Boxes')).toBe(true);
      expect(storeService.vendorCoversMinorCategory({ minorCategories: ['Boxes'] }, 'Box')).toBe(true);
    });

    test('reads the minor from every minor-level label field and from a legacy major field', () => {
      expect(storeService.vendorCoversMinorCategory({ vendorSelectedCategories: [MINOR] }, MINOR)).toBe(true);
      expect(storeService.vendorCoversMinorCategory({ clientMappedCategories: [MINOR] }, MINOR)).toBe(true);
      expect(storeService.vendorCoversMinorCategory({ categories: [MINOR] }, MINOR)).toBe(true);
      expect(storeService.vendorCoversMinorCategory({ category: MINOR }, MINOR)).toBe(true);
      expect(storeService.vendorCoversMinorCategory({ majorCategory: MINOR }, MINOR)).toBe(true);
    });

    test('rejects the parent major, a sibling minor, a name that only contains the minor, and missing input', () => {
      expect(storeService.vendorCoversMinorCategory(vendorById('v-major'), MINOR)).toBe(false);
      expect(storeService.vendorCoversMinorCategory(vendorById('v-other'), MINOR)).toBe(false);
      expect(storeService.vendorCoversMinorCategory(vendorById('v-accessory'), MINOR)).toBe(false);
      expect(storeService.vendorCoversMinorCategory({ majorCategory: MAJOR }, MINOR)).toBe(false);
      expect(storeService.vendorCoversMinorCategory({ minorCategories: ['/'] }, MINOR)).toBe(false);
      expect(storeService.vendorCoversMinorCategory(null, MINOR)).toBe(false);
      expect(storeService.vendorCoversMinorCategory(vendorById('v-minor'), '')).toBe(false);
    });
  });

  describe('reading the minors an RFQ names', () => {
    test('collects each minor once from the header, the minor list and every line item', () => {
      const rfq = {
        minorCategory: MINOR,
        minorCategories: ['bearings and accessories', 'Transformers'],
        category: 'Hardware',
        extractedEntities: [
          { minorCategory: 'Hardware' },
          { subCategory: 'Hardware' },
          { category: 'Transformers' },
          { category: MAJOR },
          null,
        ],
        lineItems: [{ minorCategory: '', category: 'Hardware' }],
      };
      expect(storeService._rfqMinorCategories(rfq)).toEqual([MINOR, 'Transformers', 'Hardware']);
      expect(storeService._rfqMinorCategories(null)).toEqual([]);
    });

    test('an RFQ with no minor is matched on its major category, as before', () => {
      const majorOnly = { category: MAJOR, extractedEntities: [{ majorCategory: MAJOR }] };
      expect(storeService._rfqMinorCategories(majorOnly)).toEqual([]);
      expect(storeService.candidateVendorsForRFQ(majorOnly).map((v) => v.id).sort()).toEqual(['v-accessory', 'v-major', 'v-minor', 'v-other']);
    });

    test('database search terms are the minors plus their singular or plural stems', () => {
      expect(storeService._rfqMatchSignals(bearingRfq())).toEqual(['bearings & accessories', 'bearings & accessori']);
      expect(storeService._rfqMatchSignals({
        extractedEntities: [{ minorCategory: 'Pipes' }, { minorCategory: 'Steels' }, { minorCategory: 'Hardware' }],
      })).toEqual(['pipes', 'pip', 'steels', 'steel', 'hardware']);
    });

    test('the parent majors of a minor include its legacy alias spellings', () => {
      expect(storeService._majorCategoriesForMinors([MINOR])).toEqual(expect.arrayContaining([MAJOR.toLowerCase(), 'mechanical']));
      expect(storeService._majorCategoriesForMinors(['Not A Real Minor'])).toEqual([]);
    });

    test('the narrowing filter keeps every row without minors and re-checks rows with minors', () => {
      const rows = [vendorById('v-major'), vendorById('v-minor')];
      expect(storeService._narrowDbVendorsToRFQ({ category: MAJOR }, rows)).toHaveLength(2);
      expect(storeService._narrowDbVendorsToRFQ(bearingRfq(), rows).map((v) => v.id)).toEqual(['v-minor']);
      expect(storeService._narrowDbVendorsToRFQ(bearingRfq(), null)).toEqual([]);
    });
  });

  describe('which vendors an RFQ reaches', () => {
    test('the candidate pool holds only the vendor carrying the minor, while a mode_2 assignment fills the minor first and tops up from the parent major', () => {
      expect(storeService.candidateVendorsForRFQ(bearingRfq()).map((v) => v.id)).toEqual(['v-minor']);
      const created = createQuietRfq({ sourcingMode: 'mode_2', id: 'rfq-minor-m2', rfqNumber: 'RFQ-MINOR-M2' });
      expect(created.assignedVendors.map((v) => v.id)).toEqual(['v-minor', 'v-major', 'v-other', 'v-accessory']);
    });

    test('a mode_2 RFQ with no vendor carrying the minor is filled from the parent major', () => {
      storeService.vendors = procucevVendors().filter((vendor) => vendor.id !== 'v-minor');
      const created = createQuietRfq({ sourcingMode: 'mode_2', id: 'rfq-minor-none', rfqNumber: 'RFQ-MINOR-NONE' });
      expect(created.assignedVendors.map((v) => v.id)).toEqual(['v-major', 'v-other', 'v-accessory']);
    });

    test('a V0 RFQ is assigned the in-memory vendor carrying the minor, topped up from the parent major', () => {
      const created = createQuietRfq({ sourcingMode: 'mode_0', id: 'rfq-minor-v0-mem', rfqNumber: 'RFQ-MINOR-V0-MEM' });
      expect(created.assignedVendors.map((v) => v.id)).toEqual(['v-minor', 'v-major', 'v-other', 'v-accessory']);
    });

    test('a mode_3 RFQ counts the minor vendor and the parent-major top-up', () => {
      const created = createQuietRfq({ sourcingMode: 'mode_3', id: 'rfq-minor-m3', rfqNumber: 'RFQ-MINOR-M3' });
      expect(created.procucevVendorCount).toBe(4);
    });

    test('explicit vendors on a minor-level RFQ that do not carry the minor are dropped', () => {
      const created = createQuietRfq({
        sourcingMode: 'mode_1',
        id: 'rfq-minor-explicit',
        rfqNumber: 'RFQ-MINOR-EXPLICIT',
        assignedVendors: [
          { id: 'v-major', name: 'Major Only Co', email: 'major@minor-invite.test', source: 'procucev_network' },
          { id: 'v-other', name: 'Pump Specialist', email: 'pump@minor-invite.test', source: 'procucev_network' },
        ],
      });
      expect(created.assignedVendors).toEqual([]);
    });

    test('a manual invite of a vendor without the minor is flagged as an override', async () => {
      const created = createQuietRfq({ sourcingMode: 'mode_1', id: 'rfq-minor-manual', rfqNumber: 'RFQ-MINOR-MANUAL' });
      const result = await storeService.inviteVendorsToRFQ(created.id, ['v-major', 'v-minor'], 'cm@example.com');
      expect(result.invitedCount).toBe(2);
      expect(result.overrideCount).toBe(1);
    });

    test('a vendor with no category at all is not reached by a minor-level RFQ', () => {
      const noCategory = { id: 'v-none', name: 'No Category', email: 'none@minor-invite.test', source: 'procucev_network' };
      storeService.vendors = [noCategory];
      expect(storeService.vendorCoversRFQ(noCategory, bearingRfq({ sourcingMode: 'mode_0' }))).toBe(false);
      // A major-only RFQ keeps the existing rule that an uncategorized vendor passes.
      expect(storeService.vendorCoversRFQ(noCategory, bearingRfq({ sourcingMode: 'mode_0', extractedEntities: [], category: MAJOR }))).toBe(true);
    });

    test('a V0 RFQ with a minor is visible only to the vendor carrying that minor', () => {
      const v0 = bearingRfq({ sourcingMode: 'mode_0' });
      expect(storeService.vendorCoversRFQ(vendorById('v-minor'), v0)).toBe(true);
      expect(storeService.vendorCoversRFQ(vendorById('v-major'), v0)).toBe(false);
      expect(storeService.vendorCoversRFQ(vendorById('v-accessory'), v0)).toBe(false);
    });

    test('a V0 RFQ with no category is open to every vendor', () => {
      const v0 = bearingRfq({ sourcingMode: 'mode_0', extractedEntities: [], category: '' });
      expect(storeService.vendorCoversRFQ(vendorById('v-major'), v0)).toBe(true);
    });

    test('a mode_2 RFQ is visible through the network only to the vendor carrying the minor', () => {
      const v2 = bearingRfq({ sourcingMode: 'mode_2' });
      expect(rfqController.canVendorViewRfq(vendorById('v-minor'), v2)).toBe(true);
      expect(rfqController.canVendorViewRfq(vendorById('v-major'), v2)).toBe(false);
      expect(rfqController.canVendorViewRfq({ id: 'v-none', name: 'No Category', source: 'procucev_network' }, v2)).toBe(false);
    });

    test('e-mail recipients for an RFQ with several minors are the invited vendors carrying one of them', () => {
      const rfq = bearingRfq({
        sourcingMode: 'mode_2',
        extractedEntities: [MINOR, 'Pumps & Accessories', 'Accessories', 'Transformers'].map((minorCategory, index) => ({
          id: `li-${index}`,
          majorCategory: MAJOR,
          minorCategory,
          quantity: 1,
          unit: 'Nos',
        })),
        assignedVendors: [{ id: 'v-major' }, { id: 'v-minor' }, { id: 'v-other' }],
      });
      const ids = storeService.selectVendorsForRFQEmail(rfq).map((v) => v.id).sort();
      expect(ids).toEqual(['v-minor', 'v-other']);
    });
  });

  describe('database-backed assignment', () => {
    beforeEach(() => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(storeService, '_appendRFQAssignmentsDurably').mockImplementation(async (rfqId, additions) => {
        const current = storeService.rfqs.find((rfq) => rfq.id === rfqId);
        const updatedRFQ = { ...current, assignedVendors: [...(current.assignedVendors || []), ...additions], followUpData: null };
        return { updatedRFQ, committedAdditions: additions };
      });
    });

    test('a V0 RFQ with a minor takes its minor vendors from the minor lookup and its top-up from the parent major, never from the directory page', async () => {
      storeService.vendors = [];
      const created = createQuietRfq({ sourcingMode: 'mode_0', id: 'rfq-minor-v0-db', rfqNumber: 'RFQ-MINOR-V0-DB' });
      const minorLookup = jest.spyOn(domainQueries, 'getPublicVendorsByMinorCategoryFromDB').mockResolvedValue([
        vendorById('v-minor'),
      ]);
      const majorLookup = jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockResolvedValue([
        vendorById('v-major'),
        vendorById('v-accessory'),
      ]);
      const pageLookup = jest.spyOn(domainQueries, 'getVendorsPageFromDB');

      const updated = await storeService.augmentV0AssignmentsFromDB(created);

      expect(minorLookup).toHaveBeenCalledWith(
        ['bearings & accessories', 'bearings & accessori'],
        expect.arrayContaining([MAJOR.toLowerCase()]),
        expect.any(Number)
      );
      expect(majorLookup).toHaveBeenCalledWith(expect.arrayContaining([MAJOR.toLowerCase()]), expect.any(Number));
      expect(pageLookup).not.toHaveBeenCalled();
      expect(updated.assignedVendors.map((v) => v.id)).toEqual(['v-minor', 'v-major', 'v-accessory']);
    });

    test('a V0 RFQ with a minor and no matching vendor is routed to the Category Manager, with no directory fallback', async () => {
      storeService.vendors = [];
      const created = createQuietRfq({ sourcingMode: 'mode_0', id: 'rfq-minor-v0-none', rfqNumber: 'RFQ-MINOR-V0-NONE' });
      jest.spyOn(domainQueries, 'getPublicVendorsByMinorCategoryFromDB').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockResolvedValue([]);
      const pageLookup = jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({
        rows: [{ id: 'v-random', name: 'Random Vendor', source: 'procucev_network' }],
        total: 1,
      });
      jest.spyOn(storeService, 'updateRFQDurably').mockImplementation(async (_id, update) => ({ ...created, ...update(created) }));

      const updated = await storeService.augmentV0AssignmentsFromDB(created);

      expect(pageLookup).not.toHaveBeenCalled();
      expect(updated.assignedVendors).toEqual([]);
      expect(updated.needsCategoryManagerAssignment).toBe(true);
    });

    test('a V0 RFQ keeps its existing vendors when the minor lookup finds no new match', async () => {
      storeService.vendors = [];
      const created = createQuietRfq({
        sourcingMode: 'mode_0',
        id: 'rfq-minor-v0-keep',
        rfqNumber: 'RFQ-MINOR-V0-KEEP',
        assignedVendors: [{ id: 'v-major', name: 'Major Only Co', email: 'major@minor-invite.test', source: 'procucev_network' }],
      });
      jest.spyOn(domainQueries, 'getPublicVendorsByMinorCategoryFromDB').mockResolvedValue([vendorById('v-major')]);
      jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockResolvedValue([]);
      const updateSpy = jest.spyOn(storeService, 'updateRFQDurably');

      const updated = await storeService.augmentV0AssignmentsFromDB(created);

      expect(updated).toBe(created);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    test('a V0 RFQ with a minor falls back to the in-memory minor and major candidates when the lookup fails', async () => {
      storeService.vendors = [];
      const created = createQuietRfq({ sourcingMode: 'mode_0', id: 'rfq-minor-v0-err', rfqNumber: 'RFQ-MINOR-V0-ERR' });
      storeService.vendors = procucevVendors();
      jest.spyOn(domainQueries, 'getPublicVendorsByMinorCategoryFromDB').mockRejectedValue(new Error('D1 DB is overloaded.'));
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

      const updated = await storeService.augmentV0AssignmentsFromDB(created);

      expect(warnSpy).toHaveBeenCalledWith(
        'V0 DB-backed minor category lookup failed',
        expect.objectContaining({ rfqNumber: 'RFQ-MINOR-V0-ERR' }),
        'STORE_SERVICE'
      );
      expect(updated.assignedVendors.map((v) => v.id)).toEqual(['v-minor', 'v-major', 'v-other', 'v-accessory']);
    });

    test('a mode_2 RFQ auto-assigns from the database the vendor carrying the minor first, topped up from the parent major', async () => {
      storeService.vendors = [];
      jest.spyOn(domainQueries, 'getVendorsByBuyerFromDB').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockResolvedValue([]);
      const lookup = jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([
        vendorById('v-major'),
        vendorById('v-minor'),
      ]);
      const created = createQuietRfq({ sourcingMode: 'mode_2', id: 'rfq-minor-m2-db', rfqNumber: 'RFQ-MINOR-M2-DB' });

      const updated = await storeService.autoAssignVendorsFromDB(created, { deferChasers: true });

      expect(lookup).toHaveBeenCalledWith(['bearings & accessories', 'bearings & accessori'], expect.any(Number));
      expect(updated.assignedVendors.map((v) => v.id)).toEqual(['v-minor', 'v-major']);
    });

    test('a mode_2 RFQ whose database matches lack the minor is topped up from the parent major', async () => {
      storeService.vendors = [];
      jest.spyOn(domainQueries, 'getVendorsByBuyerFromDB').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([
        vendorById('v-major'),
        vendorById('v-other'),
      ]);
      const created = createQuietRfq({ sourcingMode: 'mode_2', id: 'rfq-minor-m2-none-db', rfqNumber: 'RFQ-MINOR-M2-NONE-DB' });

      const updated = await storeService.autoAssignVendorsFromDB(created, { deferChasers: true });

      expect(updated.assignedVendors.map((v) => v.id)).toEqual(['v-major', 'v-other']);
    });

    test('a mode_1 RFQ with no roster vendor carrying the minor is topped up from the buyer roster under the parent major', async () => {
      storeService.vendors = [];
      jest.spyOn(domainQueries, 'getVendorsByBuyerFromDB').mockResolvedValue([vendorById('v-other')]);
      const created = createQuietRfq({ sourcingMode: 'mode_1', id: 'rfq-minor-m1-db', rfqNumber: 'RFQ-MINOR-M1-DB' });

      const updated = await storeService.autoAssignVendorsFromDB(created, { deferChasers: true });

      expect(updated.assignedVendors.map((v) => v.id)).toEqual(['v-other']);
    });

    test('the candidate lookup narrows the database rows to the minor', async () => {
      storeService.vendors = [];
      const lookup = jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([
        vendorById('v-major'),
        vendorById('v-minor'),
      ]);

      const rows = await storeService.candidateVendorsForRFQAsync(bearingRfq(), 5);

      expect(lookup).toHaveBeenCalledWith(['bearings & accessories', 'bearings & accessori'], 5);
      expect(rows.map((v) => v.id)).toEqual(['v-minor']);
    });
  });
});
