/**
 * Bootstrap vendor_master_records fallback: minor categories inferred from the taxonomy when a
 * record has a major but no minors, plus the defensive paths around loading category mappings.
 */
const bootstrapController = require('../src/controllers/bootstrapController');
const storeService = require('../src/services/storeService');
const vendorIngestionQueries = require('../src/db/vendorIngestionQueries');

function mockRes() {
  return {
    statusCode: 200,
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    },
  };
}

// No buyer account, no sub/email: the org comes from user.orgId and buyerId falls back to it.
const bareBuyer = { role: 'buyer', orgId: 'org-bare-1' };

async function bootstrapWith({ records, mappings, existingVendors = [], user = bareBuyer }) {
  jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue(null);
  jest.spyOn(vendorIngestionQueries, 'findLatestSession').mockResolvedValue({ id: 'sess-bare-1' });
  jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecords').mockResolvedValue(records);
  if (mappings instanceof Error) {
    jest.spyOn(vendorIngestionQueries, 'findCategoryMappings').mockRejectedValue(mappings);
  } else if (mappings !== undefined) {
    jest.spyOn(vendorIngestionQueries, 'findCategoryMappings').mockResolvedValue(mappings);
  }
  jest.spyOn(storeService, 'getBootstrapData').mockResolvedValue({ vendors: existingVendors, evaluations: [] });

  const res = mockRes();
  await bootstrapController.getBootstrap({ user }, res, jest.fn());
  expect(res.statusCode).toBe(200);
  return res.data.data.vendors;
}

describe('bootstrap master fallback minor inference', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('infers minors from AI relevant products and items supplied when only a taxonomy major is known', async () => {
    const vendors = await bootstrapWith({
      records: [
        { id: 'rec-infer', companyName: 'Civil Co', majorCategory: 'Civil Works', itemsSupplied: ['Red Bricks', 'bricks'] },
      ],
      mappings: [
        { vendorRecordId: 'rec-infer', aiSuggestion: { relevantProducts: ['Soil excavation'] } },
      ],
    });

    const vendor = vendors.find((v) => v.id === 'v-master-rec-infer');
    expect(vendor.majorCategory).toBe('Civil Works');
    expect(vendor.minorCategories).toEqual(['Excavation', 'Bricks']);
    expect(vendor.clientMappedCategories).toEqual(['Excavation', 'Bricks']);
    // No account, sub or email: owner falls back to the org, contact fields to null.
    expect(vendor).toMatchObject({
      email: null,
      buyerId: 'org-bare-1',
      buyerAccountId: 'org-bare-1',
      buyerEmail: null,
      addedByBuyerCompany: null,
    });
  });

  test('a major outside the taxonomy, or no candidates, leaves minors empty', async () => {
    const vendors = await bootstrapWith({
      records: [
        { id: 'rec-unknown-major', companyName: 'Odd Co', majorCategory: 'Not A Real Major', itemsSupplied: ['Bricks'] },
        { id: 'rec-no-cands', companyName: 'Quiet Co', majorCategory: 'Civil Works' },
      ],
      mappings: null,
    });

    expect(vendors.find((v) => v.id === 'v-master-rec-unknown-major').minorCategories).toEqual([]);
    expect(vendors.find((v) => v.id === 'v-master-rec-no-cands').minorCategories).toEqual([]);
  });

  test('a failing category-mapping lookup is ignored and existing vendors without email or code do not block records', async () => {
    const vendors = await bootstrapWith({
      records: [{ id: 'rec-after-error', companyName: 'Survivor Co' }],
      mappings: new Error('mapping table missing'),
      existingVendors: [{ id: 'v-blank', name: 'No Contact Vendor', buyerId: 'org-bare-1' }],
    });

    expect(vendors.map((v) => v.id)).toEqual(expect.arrayContaining(['v-blank', 'v-master-rec-after-error']));
  });

  test('works when the queries module has no category-mapping lookup', async () => {
    const original = vendorIngestionQueries.findCategoryMappings;
    vendorIngestionQueries.findCategoryMappings = undefined;
    try {
      const vendors = await bootstrapWith({ records: [{ id: 'rec-no-lookup', companyName: 'Plain Co' }] });
      expect(vendors.find((v) => v.id === 'v-master-rec-no-lookup')).toBeDefined();
    } finally {
      vendorIngestionQueries.findCategoryMappings = original;
    }
  });

  test.each([[[]], [null]])('master records %j add nothing', async (records) => {
    const vendors = await bootstrapWith({ records });
    expect(vendors).toEqual([]);
  });
});
