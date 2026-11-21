/**
 * unlockRFQForVendor access rules for network-mode RFQs.
 *
 * dd9513cf removed the `categoryMatches` variable that the final `hasAccess` term used, so a
 * mode_2/mode_3 download by a seller who was not invited, had not unlocked the RFQ and was not
 * directly covered threw `ReferenceError: categoryMatches is not defined` (a 500) instead of
 * a clean refusal. These tests pin the restored behaviour and the paths around it.
 */
const request = require('supertest');

const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const { RFQ_DOWNLOAD_ERRORS } = require('../src/config/constants');

let seq = 0;
const uid = (label) => `${label}-${Date.now()}-${++seq}`;

// createRFQ auto-invites category-matched vendors; detach them so the test controls invites.
function clearAutoInvites(rfq) {
  rfq.assignedVendors = [];
  if (rfq.followUpData) {
    rfq.followUpData.vendors = [];
    rfq.followUpData.totalInvited = 0;
  }
  return rfq;
}

function makeVendor(majorCategory, extra = {}) {
  const id = uid('vendor');
  return storeService.addVendor({
    name: `Seller ${id}`,
    email: `${id}@seller.test`,
    majorCategory,
    freeQuotationCredits: 5,
    freeCreditsAllocated: 5,
    ...extra,
  });
}

function makeRfq(sourcingMode, category) {
  return clearAutoInvites(storeService.createRFQ({
    id: uid('rfq'),
    title: `${category} requirement`,
    category,
    sourcingMode,
  }));
}

describe('unlockRFQForVendor network-mode access', () => {
  beforeEach(() => {
    jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
    jest.spyOn(mailerService, 'sendVendorCategoryMismatchEmail').mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(['mode_3', 'mode_2'])(
    '%s RFQ, seller in another category and not invited: clean refusal, no throw, no credit spent',
    async (mode) => {
      const vendor = makeVendor('Electrical Cables');
      const rfq = makeRfq(mode, 'Heavy Machinery');

      const result = await storeService.unlockRFQForVendor(vendor.id, rfq.id);

      expect(result).toEqual({
        success: false,
        error: RFQ_DOWNLOAD_ERRORS.UNAUTHORIZED,
        unauthorized: true,
      });
      expect(storeService.getVendorRfqCredits(vendor.id).freeCreditsRemaining).toBe(5);
      expect(storeService.isRfqUnlockedForVendor(vendor.id, rfq.id)).toBe(false);
    }
  );

  test('mode_3 RFQ, seller in the matching category but not invited: allowed and charged 1 credit', async () => {
    const vendor = makeVendor('Heavy Machinery');
    const rfq = makeRfq('mode_3', 'Heavy Machinery');

    const result = await storeService.unlockRFQForVendor(vendor.id, rfq.id);

    expect(result.success).toBe(true);
    expect(result.creditCharged).toBe(1);
    expect(result.freeCreditsRemaining).toBe(4);
  });

  test('mode_3 RFQ, invited seller in another category: allowed', async () => {
    const vendor = makeVendor('Electrical Cables');
    const rfq = makeRfq('mode_3', 'Heavy Machinery');
    rfq.assignedVendors = [{ id: vendor.id, name: vendor.name, email: vendor.email }];

    const result = await storeService.unlockRFQForVendor(vendor.id, rfq.id);

    expect(result.success).toBe(true);
    expect(result.unauthorized).toBeUndefined();
  });

  test('mode_0 RFQ, seller in another category: unlocks with 1 credit, and a re-download is free', async () => {
    const vendor = makeVendor('Electrical Cables');
    const rfq = makeRfq('mode_0', 'Heavy Machinery');

    const first = await storeService.unlockRFQForVendor(vendor.id, rfq.id);
    expect(first.success).toBe(true);
    expect(first.creditCharged).toBe(1);
    expect(first.freeCreditsRemaining).toBe(4);

    const again = await storeService.unlockRFQForVendor(vendor.id, rfq.id);
    expect(again.success).toBe(true);
    expect(again.alreadyUnlocked).toBe(true);
    expect(again.creditCharged).toBe(0);
    expect(again.freeCreditsRemaining).toBe(4);
  });

  test('mode_0 RFQ with no credits left: creditsExhausted', async () => {
    const vendor = makeVendor('Electrical Cables', { freeQuotationCredits: 0, freeCreditsAllocated: 0 });
    const rfq = makeRfq('mode_0', 'Heavy Machinery');

    const result = await storeService.unlockRFQForVendor(vendor.id, rfq.id);

    expect(result.success).toBe(false);
    expect(result.creditsExhausted).toBe(true);
  });

  test('non-network (mode_1) RFQ, seller not covered: refused without the category check', async () => {
    const vendor = makeVendor('Heavy Machinery');
    const rfq = makeRfq('mode_1', 'Heavy Machinery');
    const categorySpy = jest.spyOn(storeService, '_vendorCoversRFQCategories');

    const result = await storeService.unlockRFQForVendor(vendor.id, rfq.id);

    expect(result.unauthorized).toBe(true);
    // The restored check only runs for network-mode RFQs.
    expect(categorySpy).not.toHaveBeenCalled();
  });
});

describe('POST /api/rfqs/:id/download refusal code', () => {
  const app = require('../src/app');
  const { authHeader, TEST_USERS } = require('./testHelpers');
  let vendor;

  beforeAll(() => {
    // The vendor session in testHelpers resolves to this vendor profile by email.
    vendor = makeVendor('Heavy Machinery', { email: TEST_USERS.vendor.email });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function downloadAs(rfq, unlockResult) {
    jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(rfq);
    jest.spyOn(storeService, 'unlockRFQForVendor').mockResolvedValue(unlockResult);
    return request(app)
      .post(`/api/rfqs/${rfq.id}/download`)
      .set(authHeader('vendor'))
      .send({});
  }

  test.each([
    [{ success: false, unauthorized: true, error: RFQ_DOWNLOAD_ERRORS.UNAUTHORIZED }, 403, 'NOT_ELIGIBLE'],
    [{ success: false, creditsExhausted: true, freeCreditsRemaining: 0 }, 403, 'CREDITS_EXHAUSTED'],
    [{ success: false, notFound: true, error: 'RFQ x not found.' }, 404, 'NOT_FOUND'],
    [{ success: false }, 503, 'UNKNOWN'],
  ])('unlock result %j -> %i with code %s, error text unchanged', async (unlockResult, status, code) => {
    const rfq = makeRfq('mode_0', 'Heavy Machinery');
    rfq.assignedVendors = [{ id: vendor.id, name: vendor.name, email: vendor.email }];

    const res = await downloadAs(rfq, unlockResult);

    expect(res.status).toBe(status);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe(code);
    expect(typeof res.body.error).toBe('string');
    if (code === 'CREDITS_EXHAUSTED') {
      expect(res.body.exhausted).toBe(true);
      expect(res.body.error).toBe(RFQ_DOWNLOAD_ERRORS.CREDITS_EXHAUSTED);
    }
  });
});
