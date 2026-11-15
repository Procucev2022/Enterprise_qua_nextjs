const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const rfqController = require('../src/controllers/rfqController');
const { RFQ_MINOR_SHORTFALL_ALERT } = require('../src/config/constants');

// The shortfall alert e-mail, its recipient list from the environment, and the create flow that
// decides whether the database top-up runs and whether it may send the alert.

const MAJOR = 'Engineering Spares - Mechanical';
const MINOR = 'Bearings & Accessories';
const DEFAULT_RECIPIENTS = ['gmtrfq@procucev.com', 'quateam@procucev.com', 'anshul.goel@procucev.com', 'veerababu.v@procucev.com'];
const SHORTFALL = { minorCategory: MINOR, majorCategory: MAJOR, minorMatched: 21, majorFilled: 4, target: 25 };
const RECIPIENT_ENV = 'RFQ_MINOR_SHORTFALL_ALERT_EMAILS';

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('minor shortfall alert e-mail', () => {
  test('lists the recipients, the RFQ and each short minor, with the counts in the text and the table', () => {
    const message = mailerService.buildRfqMinorShortfallEmail({
      recipients: ['ops@quota.test', '', 'lead@quota.test'],
      rfq: { rfqNumber: 'RFQ-9', title: 'Bolts & nuts' },
      shortfalls: [SHORTFALL],
    });

    expect(message.to).toBe('ops@quota.test, lead@quota.test');
    expect(message.subject).toBe('[Action Required] RFQ RFQ-9: minor category vendor shortfall');
    expect(message.text).toContain(`- ${MINOR} (major: ${MAJOR}): 21 of 25 minor vendors found, 4 added from the major category`);
    expect(message.html).toContain('Bolts &amp; nuts');
    expect(message.html).toContain('21 of 25');
    expect(message.html).toContain('Bearings &amp; Accessories');
  });

  test('uses placeholders when the RFQ, its minor and its major are missing', () => {
    const message = mailerService.buildRfqMinorShortfallEmail({ shortfalls: [{ minorMatched: 0, majorFilled: 0, target: 25 }] });

    expect(message.to).toBe('');
    expect(message.subject).toBe('[Action Required] RFQ Not specified: minor category vendor shortfall');
    expect(message.text).toContain('- Not specified (major: Not specified): 0 of 25 minor vendors found, 0 added from the major category');
  });

  test('builds a message with an empty table and a zero target when no shortfall is given', () => {
    const message = mailerService.buildRfqMinorShortfallEmail();

    expect(message.html).toContain('<tbody></tbody>');
    expect(message.text).toContain('invites 0 network vendors');
  });

  test('the sender skips a message with no recipient and reports why', async () => {
    await expect(mailerService.sendRfqMinorShortfallEmail({ recipients: [], rfq: { rfqNumber: 'RFQ-9' }, shortfalls: [SHORTFALL] }))
      .resolves.toEqual({ sent: false, success: false, status: 'skipped', reason: 'no recipients configured' });
  });

  test('the sender hands a message with recipients to delivery, which reports the test environment', async () => {
    await expect(mailerService.sendRfqMinorShortfallEmail({ recipients: ['ops@quota.test'], rfq: { rfqNumber: 'RFQ-9' }, shortfalls: [SHORTFALL] }))
      .resolves.toEqual({ sent: false, success: false, status: 'skipped', reason: 'test environment' });
  });
});

describe('shortfall alert recipients from the environment', () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = process.env[RECIPIENT_ENV];
    delete process.env[RECIPIENT_ENV];
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[RECIPIENT_ENV];
    else process.env[RECIPIENT_ENV] = savedEnv;
    delete globalThis.__CF_ENV__;
  });

  test('defaults to the three Procucev addresses when the variable is unset', () => {
    expect(RFQ_MINOR_SHORTFALL_ALERT.RECIPIENTS).toEqual(DEFAULT_RECIPIENTS);
  });

  test('reads a comma-separated list and drops blank entries', () => {
    process.env[RECIPIENT_ENV] = ' ops@quota.test , ,lead@quota.test ';

    expect(RFQ_MINOR_SHORTFALL_ALERT.RECIPIENTS).toEqual(['ops@quota.test', 'lead@quota.test']);
  });

  test('a blank list keeps the defaults', () => {
    process.env[RECIPIENT_ENV] = ' , ';

    expect(RFQ_MINOR_SHORTFALL_ALERT.RECIPIENTS).toEqual(DEFAULT_RECIPIENTS);
  });

  test('a Cloudflare Worker binding takes precedence over process.env, and an empty binding falls through to it', () => {
    process.env[RECIPIENT_ENV] = 'env@quota.test';
    globalThis.__CF_ENV__ = { [RECIPIENT_ENV]: 'binding@quota.test' };
    expect(RFQ_MINOR_SHORTFALL_ALERT.RECIPIENTS).toEqual(['binding@quota.test']);

    globalThis.__CF_ENV__ = { [RECIPIENT_ENV]: '' };
    expect(RFQ_MINOR_SHORTFALL_ALERT.RECIPIENTS).toEqual(['env@quota.test']);
  });
});

describe('creation flow top-up', () => {
  const body = (sourcingMode) => ({
    title: `Quota ${sourcingMode} RFQ`,
    category: MAJOR,
    sourcingMode,
    targetDeliveryDate: '2028-10-15',
    deliveryLocation: 'Mumbai',
    deliveryPincode: '400001',
    extractedEntities: [{ itemName: 'Centrifugal pump bearing', technicalSpecs: 'Deep groove ball bearing, 6205 2RS', quantity: 2, unit: 'Nos', majorCategory: MAJOR, minorCategory: MINOR }],
  });

  /** Stubs the create call so the controller receives an RFQ already holding `assignedVendors`. */
  function stubCreatedRfq(sourcingMode, assignedVendors) {
    const created = {
      id: `rfq-ctl-${sourcingMode}`,
      rfqNumber: `RFQ-CTL-${sourcingMode.toUpperCase()}`,
      title: `Quota ${sourcingMode} RFQ`,
      category: MAJOR,
      sourcingMode,
      status: 'Quotes Pending',
      assignedVendors,
      procucevVendorCount: assignedVendors.length,
      followUpData: null,
      extractedEntities: [],
    };
    jest.spyOn(storeService, 'createRFQDurably').mockResolvedValue(created);
    return created;
  }

  beforeEach(() => {
    storeService.addBuyerAccount({
      organizationName: 'Quota Org',
      corporateEmail: 'quota-buyer@example.com',
      subscriptionPlan: 'version_2',
    });
    jest.spyOn(storeService, 'resolveProcucevVendorCountFromDB').mockResolvedValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a mode 2 RFQ tops up from the database on create even when the in-memory pass assigned vendors, and asks for the alert', async () => {
    const created = stubCreatedRfq('mode_2', [{ id: 'v-x', name: 'Vendor X', source: 'procucev_network' }]);
    const autoAssign = jest.spyOn(storeService, 'autoAssignVendorsFromDB').mockResolvedValue(created);
    const res = mockRes();

    await rfqController.createRFQ({ body: body('mode_2'), user: { email: 'quota-buyer@example.com' } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(autoAssign).toHaveBeenCalledWith(created, { notifyShortfall: true });
  });

  test('a mode 1 RFQ that already holds its explicit roster list is not topped up', async () => {
    stubCreatedRfq('mode_1', [{ id: 'roster-1', name: 'Roster One', source: 'buyer_uploaded' }]);
    const autoAssign = jest.spyOn(storeService, 'autoAssignVendorsFromDB');
    const res = mockRes();

    await rfqController.createRFQ({ body: body('mode_1'), user: { email: 'quota-buyer@example.com' } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(autoAssign).not.toHaveBeenCalled();
  });

  test('a mode 1 RFQ with nothing assigned is topped up from the buyer roster, with the alert flag', async () => {
    const created = stubCreatedRfq('mode_1', []);
    const autoAssign = jest.spyOn(storeService, 'autoAssignVendorsFromDB').mockResolvedValue(created);
    const res = mockRes();

    await rfqController.createRFQ({ body: body('mode_1'), user: { email: 'quota-buyer@example.com' } }, res, jest.fn());

    expect(autoAssign).toHaveBeenCalledWith(created, { notifyShortfall: true });
  });
});
