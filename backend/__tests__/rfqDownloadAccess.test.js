/**
 * RFQ download access (unlockRFQForVendor) and the refusal `code` on POST /api/rfqs/:id/download.
 *
 * Prod refused every mode_0 download by a seller outside the RFQ's minor category (e.g. a Cables
 * seller on a Motors RFQ), even though canVendorViewRfq already shows mode_0 RFQs to every seller.
 * Any seller can now unlock a mode_0 RFQ for 1 credit, a seller keeps access to an RFQ they already
 * unlocked, and a refusal says why (CREDITS_EXHAUSTED vs NOT_ELIGIBLE) so the bot stops reporting
 * every 403 as "Insufficient Credits".
 */
const request = require('supertest');

const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const { RFQ_DOWNLOAD_ERRORS } = require('../src/config/constants');

let seq = 0;
const uid = (label) => `${label}-${Date.now()}-${++seq}`;

// createRFQ auto-invites category-matched vendors; detach them so each test controls invites.
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

describe('unlockRFQForVendor access', () => {
  beforeEach(() => {
    jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
    jest.spyOn(mailerService, 'sendVendorCategoryMismatchEmail').mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('mode_0 RFQ, seller in another category: unlocks for 1 credit, and a re-download is free', async () => {
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

  test('mode_0 RFQ with 0 credits: creditsExhausted, nothing unlocked', async () => {
    const vendor = makeVendor('Electrical Cables', { freeQuotationCredits: 0, freeCreditsAllocated: 0 });
    const rfq = makeRfq('mode_0', 'Heavy Machinery');

    const result = await storeService.unlockRFQForVendor(vendor.id, rfq.id);

    expect(result.success).toBe(false);
    expect(result.creditsExhausted).toBe(true);
    expect(storeService.isRfqUnlockedForVendor(vendor.id, rfq.id)).toBe(false);
  });

  test.each(['mode_3', 'mode_2'])(
    '%s RFQ, seller in another category and not invited: refused, no credit spent',
    async (mode) => {
      const vendor = makeVendor('Electrical Cables');
      const rfq = makeRfq(mode, 'Heavy Machinery');

      const result = await storeService.unlockRFQForVendor(vendor.id, rfq.id);

      expect(result).toEqual({ success: false, error: RFQ_DOWNLOAD_ERRORS.UNAUTHORIZED, unauthorized: true });
      expect(storeService.getVendorRfqCredits(vendor.id).freeCreditsRemaining).toBe(5);
    }
  );

  test('mode_3 RFQ, invited seller in another category: allowed', async () => {
    const vendor = makeVendor('Electrical Cables');
    const rfq = makeRfq('mode_3', 'Heavy Machinery');
    rfq.assignedVendors = [{ id: vendor.id, name: vendor.name, email: vendor.email }];

    const result = await storeService.unlockRFQForVendor(vendor.id, rfq.id);

    expect(result.success).toBe(true);
  });

  test('mode_3 RFQ the seller already unlocked: re-download allowed free, even outside their category', async () => {
    const rfq = makeRfq('mode_3', 'Heavy Machinery');
    const vendor = makeVendor('Electrical Cables', { unlockedRfqIds: [rfq.rfqNumber || rfq.id] });

    const result = await storeService.unlockRFQForVendor(vendor.id, rfq.id);

    expect(result.success).toBe(true);
    expect(result.alreadyUnlocked).toBe(true);
    expect(result.creditCharged).toBe(0);
  });

  test('mode_1 RFQ, seller not invited or buyer-mapped: still refused', async () => {
    const vendor = makeVendor('Heavy Machinery');
    const rfq = makeRfq('mode_1', 'Heavy Machinery');

    const result = await storeService.unlockRFQForVendor(vendor.id, rfq.id);

    expect(result.unauthorized).toBe(true);
  });
});

describe('POST /api/rfqs/:id/download refusal code', () => {
  const app = require('../src/app');
  const { authHeader, TEST_USERS } = require('./testHelpers');
  let rfq;

  beforeAll(() => {
    jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
    // The vendor session in testHelpers resolves to this vendor profile by email.
    makeVendor('Heavy Machinery', { email: TEST_USERS.vendor.email });
    rfq = makeRfq('mode_0', 'Heavy Machinery');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function downloadWith(unlockResult) {
    jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(rfq);
    jest.spyOn(storeService, 'unlockRFQForVendor').mockResolvedValue(unlockResult);
    return request(app).post(`/api/rfqs/${rfq.id}/download`).set(authHeader('vendor')).send({});
  }

  test('not allowed -> 403 NOT_ELIGIBLE with the unchanged error text', async () => {
    const res = await downloadWith({ success: false, unauthorized: true, error: RFQ_DOWNLOAD_ERRORS.UNAUTHORIZED });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, error: RFQ_DOWNLOAD_ERRORS.UNAUTHORIZED, code: 'NOT_ELIGIBLE' });
  });

  test('no credits -> 403 CREDITS_EXHAUSTED, keeping the existing exhausted fields', async () => {
    const res = await downloadWith({ success: false, creditsExhausted: true, freeCreditsRemaining: 0 });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      error: RFQ_DOWNLOAD_ERRORS.CREDITS_EXHAUSTED,
      code: 'CREDITS_EXHAUSTED',
      freeCreditsRemaining: 0,
      exhausted: true,
    });
  });

  test.each([
    [{ success: false, notFound: true, error: 'RFQ x not found.' }, 404],
    [{ success: false }, 503],
  ])('any other refusal %j -> %i UNKNOWN', async (unlockResult, status) => {
    const res = await downloadWith(unlockResult);

    expect(res.status).toBe(status);
    expect(res.body.code).toBe('UNKNOWN');
  });
});
