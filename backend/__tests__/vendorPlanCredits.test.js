const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const pool = require('../src/db/pool');
const paymentDuesQueries = require('../src/db/paymentDuesQueries');
const emailGatewayService = require('../src/services/emailGatewayService');
const emailGatewayQueries = require('../src/db/emailGatewayQueries');
const mailerService = require('../src/services/mailerService');
const geminiService = require('../src/services/geminiService');
const quoteCreditQueries = require('../src/db/vendorQuoteCreditQueries');
const { VENDOR_PLAN_RFQ_QUOTA } = require('../src/config/constants');

// A Connect/Select subscriber's credit balance is their plan quota less the
// downloads used. It used to be read from the free-tier field, which stays 0
// for subscribers, so every subscriber was shown "0 credits" (e.g. a Select
// vendor with 11 downloads used saw 0 instead of 89).
describe('subscriber credit balance', () => {
  let savedVendors;
  let savedRfqs;

  beforeEach(() => {
    savedVendors = storeService.vendors;
    savedRfqs = storeService.rfqs;
    jest.spyOn(domainQueries, 'unlockRFQInDB').mockResolvedValue(true);
    jest.spyOn(domainQueries, 'recordCreditTransactionInDB').mockResolvedValue(true);
  });

  afterEach(() => {
    storeService.vendors = savedVendors;
    storeService.rfqs = savedRfqs;
    jest.restoreAllMocks();
  });

  test('exposes the advertised plan quotas', () => {
    expect(VENDOR_PLAN_RFQ_QUOTA).toEqual({ connect: 50, select: 100 });
  });

  test('a Select subscriber sees quota less downloads used, not the free-tier 0', () => {
    storeService.vendors = [
      { id: 'v-select', email: 'select@plan.test', subscriptionPlan: 'select', rfqDownloadsUsed: 11, freeQuotationCredits: 0 },
    ];
    expect(storeService.getVendorRfqCredits('v-select')).toMatchObject({
      freeCreditsAllocated: 100,
      freeCreditsUsed: 11,
      freeCreditsRemaining: 89,
      isSubscribed: true,
      subscriptionPlan: 'select',
    });
  });

  test('a Connect subscriber with no usage yet has the full quota, and never goes negative', () => {
    storeService.vendors = [
      { id: 'v-connect', email: 'connect@plan.test', subscriptionPlan: 'connect' },
      { id: 'v-over', email: 'over@plan.test', subscriptionPlan: 'connect', rfqDownloadsUsed: 70, unlockedRfqIds: ['r1'] },
    ];
    expect(storeService.getVendorRfqCredits('v-connect')).toMatchObject({ freeCreditsRemaining: 50, freeCreditsUsed: 0, unlockedRfqIds: [] });
    expect(storeService.getVendorRfqCredits('v-over')).toMatchObject({ freeCreditsRemaining: 0, freeCreditsUsed: 50, unlockedRfqIds: ['r1'] });
  });

  test('a vendor without a subscription shows their free-tier balance (0 by default)', () => {
    storeService.vendors = [{ id: 'v-none', email: 'none@plan.test', subscriptionPlan: 'premium', freeQuotationCredits: 0 }];
    expect(storeService.getVendorRfqCredits('v-none')).toMatchObject({ freeCreditsRemaining: 0, isSubscribed: false });
  });

  test('an unlimited-access vendor keeps the unlimited balance whatever their plan', () => {
    storeService.vendors = [{ id: 'v-unl', email: 'unl@plan.test', subscriptionPlan: 'select', unlimitedDownloads: true }];
    expect(storeService.getVendorRfqCredits('v-unl').freeCreditsRemaining).toBe(999999);
  });

  describe('downloads counted against the plan', () => {
    const marketplaceRfq = { id: 'rfq-plan-1', rfqNumber: 'RFQ-PLAN-1', sourcingMode: 'mode_0', quotes: [] };

    test('a first-time download uses one credit and returns the new balance', async () => {
      storeService.vendors = [{ id: 'v-dl', email: 'dl@plan.test', subscriptionPlan: 'select', rfqDownloadsUsed: 11, unlockedRfqIds: [] }];
      storeService.rfqs = [marketplaceRfq];

      const res = await storeService.unlockRFQForVendor('v-dl', 'rfq-plan-1');

      expect(res).toMatchObject({ success: true, creditCharged: 0, freeCreditsRemaining: 88 });
      expect(storeService.getVendorById('v-dl', 'all').rfqDownloadsUsed).toBe(12);
    });

    test('re-downloading an RFQ already unlocked does not use another credit', async () => {
      storeService.vendors = [
        { id: 'v-re', email: 're@plan.test', subscriptionPlan: 'select', rfqDownloadsUsed: 5, unlockedRfqIds: ['rfq-plan-1'] },
      ];
      storeService.rfqs = [marketplaceRfq];

      const res = await storeService.unlockRFQForVendor('v-re', 'rfq-plan-1');

      expect(res).toMatchObject({ success: true, alreadyUnlocked: true, freeCreditsRemaining: 95 });
      expect(storeService.getVendorById('v-re', 'all').rfqDownloadsUsed).toBe(5);
    });

    test("an RFQ from the vendor's own buyer is free", async () => {
      storeService.vendors = [
        { id: 'v-own', email: 'own@plan.test', subscriptionPlan: 'connect', rfqDownloadsUsed: 3, buyerId: 'buyer-own', unlockedRfqIds: [] },
      ];
      storeService.rfqs = [{ ...marketplaceRfq, id: 'rfq-own-1', buyerAccountId: 'buyer-own' }];

      const res = await storeService.unlockRFQForVendor('v-own', 'rfq-own-1');

      expect(res.success).toBe(true);
      expect(storeService.getVendorById('v-own', 'all').rfqDownloadsUsed).toBe(3);
    });

    test('a free-tier download also records the download count', async () => {
      storeService.vendors = [{ id: 'v-free', email: 'free@plan.test', freeQuotationCredits: 2, unlockedRfqIds: [] }];
      storeService.rfqs = [marketplaceRfq];

      const res = await storeService.unlockRFQForVendor('v-free', 'rfq-plan-1');

      expect(res).toMatchObject({ success: true, creditCharged: 1, freeCreditsRemaining: 1 });
      expect(storeService.getVendorById('v-free', 'all').rfqDownloadsUsed).toBe(1);
    });
  });

  describe('quotations counted against the plan (Connect & Select subscriptions)', () => {
    const marketplaceRfq = { id: 'rfq-quote-plan-1', rfqNumber: 'RFQ-QUOTE-PLAN-1', sourcingMode: 'mode_0', quotes: [] };

    test('a Connect subscriber submitting a quote without prior unlock uses one credit and updates balance', () => {
      storeService.vendors = [
        { id: 'v-quote-connect', email: 'qc@plan.test', subscriptionPlan: 'connect', rfqDownloadsUsed: 10, unlockedRfqIds: [], quotedRfqIds: [] },
      ];
      storeService.rfqs = [marketplaceRfq];

      storeService.consumeVendorQuotationCredit('v-quote-connect', 'rfq-quote-plan-1');
      const updated = storeService.getVendorById('v-quote-connect', 'all');
      expect(updated.rfqDownloadsUsed).toBe(11);
      expect(updated.quotedRfqIds).toContain('rfq-quote-plan-1');
      expect(storeService.getVendorRfqCredits('v-quote-connect').freeCreditsRemaining).toBe(39);
    });

    test('a Connect subscriber submitting a quote for an already unlocked RFQ does NOT use an extra credit', () => {
      storeService.vendors = [
        { id: 'v-quote-connect-unlocked', email: 'qcu@plan.test', subscriptionPlan: 'connect', rfqDownloadsUsed: 10, unlockedRfqIds: ['rfq-quote-plan-1'], quotedRfqIds: [] },
      ];
      storeService.rfqs = [marketplaceRfq];

      storeService.consumeVendorQuotationCredit('v-quote-connect-unlocked', 'rfq-quote-plan-1');
      const updated = storeService.getVendorById('v-quote-connect-unlocked', 'all');
      expect(updated.rfqDownloadsUsed).toBe(10);
      expect(storeService.getVendorRfqCredits('v-quote-connect-unlocked').freeCreditsRemaining).toBe(40);
    });

    test('resubmitting a quote for the same RFQ does not deduct an extra credit', () => {
      storeService.vendors = [
        { id: 'v-quote-resubmit', email: 'qcr@plan.test', subscriptionPlan: 'select', rfqDownloadsUsed: 5, unlockedRfqIds: [], quotedRfqIds: ['rfq-quote-plan-1'] },
      ];
      storeService.rfqs = [marketplaceRfq];

      storeService.consumeVendorQuotationCredit('v-quote-resubmit', 'rfq-quote-plan-1');
      const updated = storeService.getVendorById('v-quote-resubmit', 'all');
      expect(updated.rfqDownloadsUsed).toBe(5);
      expect(storeService.getVendorRfqCredits('v-quote-resubmit').freeCreditsRemaining).toBe(95);
    });

    test('a Connect subscriber with exhausted quota (50 used) is rejected on a new RFQ', () => {
      storeService.vendors = [
        { id: 'v-quote-exhausted', email: 'qce@plan.test', subscriptionPlan: 'connect', rfqDownloadsUsed: 50, unlockedRfqIds: [], quotedRfqIds: [] },
      ];
      storeService.rfqs = [marketplaceRfq];

      const eligibility = storeService.checkVendorQuotationEligibility(storeService.getVendorById('v-quote-exhausted', 'all'), marketplaceRfq);
      expect(eligibility).toMatchObject({
        eligible: false,
        freeCreditsRemaining: 0,
        isSubscribed: true,
        subscriptionPlan: 'connect',
      });
    });

    test('a Connect subscriber with exhausted quota who already unlocked the RFQ can still submit a quote', () => {
      storeService.vendors = [
        { id: 'v-quote-preunlocked', email: 'qcpu@plan.test', subscriptionPlan: 'connect', rfqDownloadsUsed: 50, unlockedRfqIds: ['rfq-quote-plan-1'], quotedRfqIds: [] },
      ];
      storeService.rfqs = [marketplaceRfq];

      const eligibility = storeService.checkVendorQuotationEligibility(storeService.getVendorById('v-quote-preunlocked', 'all'), marketplaceRfq);
      expect(eligibility).toMatchObject({
        eligible: true,
        freeCreditsRemaining: 0,
        isSubscribed: true,
        subscriptionPlan: 'connect',
      });

      storeService.consumeVendorQuotationCredit('v-quote-preunlocked', 'rfq-quote-plan-1');
      const updated = storeService.getVendorById('v-quote-preunlocked', 'all');
      expect(updated.rfqDownloadsUsed).toBe(50);
    });

    test('an RFQ from the subscriber vendor own buyer is free', () => {
      storeService.vendors = [
        { id: 'v-quote-own', email: 'qco@plan.test', subscriptionPlan: 'connect', rfqDownloadsUsed: 15, buyerId: 'buyer-org-1', unlockedRfqIds: [], quotedRfqIds: [] },
      ];
      storeService.rfqs = [{ ...marketplaceRfq, id: 'rfq-own-quote-1', buyerAccountId: 'buyer-org-1' }];

      storeService.consumeVendorQuotationCredit('v-quote-own', 'rfq-own-quote-1');
      const updated = storeService.getVendorById('v-quote-own', 'all');
      expect(updated.rfqDownloadsUsed).toBe(15);
      expect(storeService.getVendorRfqCredits('v-quote-own').freeCreditsRemaining).toBe(35);
    });
  });

  describe('email quotation gateway for Connect & Select subscribers', () => {
    const vendorGatewayConfig = {
      enabled: true,
      user: 'vendor-smtp@supplier.test',
      address: 'vendor-smtp@supplier.test',
      isVendorMailbox: true,
    };
    const subscriberEmail = 'subscriber@connect.test';
    let subscriberVendor;
    let testRfq;

    beforeEach(() => {
      emailGatewayService.resetAutoReplyMemory();
      jest.spyOn(emailGatewayQueries, 'countRecentOutcomes').mockResolvedValue(0);
      jest.spyOn(mailerService, 'sendQuoteAcknowledgementEmail').mockResolvedValue(true);
      jest.spyOn(mailerService, 'sendQuoteReceivedEmail').mockResolvedValue(true);

      subscriberVendor = {
        id: 'v-sub-email',
        name: 'Subscribed Industrial Supplier',
        email: subscriberEmail,
        subscriptionPlan: 'connect',
        rfqDownloadsUsed: 10,
        unlockedRfqIds: [],
        quotedRfqIds: [],
      };
      testRfq = {
        id: 'rfq-sub-test-1',
        rfqNumber: 'RFQ-SUB-001',
        title: 'Precision Bearings',
        category: 'Bearings',
        sourcingMode: 'mode_0',
        status: 'Quotes Pending',
        quotes: [],
        assignedVendors: [],
      };
      storeService.vendors = [subscriberVendor];
      storeService.rfqs = [testRfq];
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('submitting a quote via email for un-unlocked RFQ decrements Connect quota by 1', async () => {
      const quoteEml = `From: ${subscriberEmail}
To: vendor-smtp@supplier.test
Subject: Re: Quotation for ${testRfq.rfqNumber}
Message-ID: <quote-sub-1@connect.test>
Date: Tue, 22 Sep 2026 10:00:00 +0530
Content-Type: text/plain

Unit Price: INR 12,000
Lead Time: 5 days
Warranty: 1 year
Payment Terms: Net 30
`;
      jest.spyOn(geminiService, 'extractQuotationFromEmail').mockResolvedValueOnce({
        unitPrice: 12000,
        totalPrice: 24000,
        leadTimeDays: 5,
        warrantyYears: 1,
        paymentTerms: 'Net 30',
      });

      const result = await emailGatewayService.processMessage(Buffer.from(quoteEml, 'utf8'), vendorGatewayConfig);
      expect(result.status).toBe(emailGatewayQueries.INGESTION_OUTCOME.QUOTE_INGESTED);
      expect(storeService.getRFQById(testRfq.id).quotes).toHaveLength(1);
      expect(storeService.getVendorById(subscriberVendor.id, 'all').rfqDownloadsUsed).toBe(11);
    });

    test('submitting a quote via email for already unlocked RFQ does NOT decrement quota again', async () => {
      subscriberVendor.unlockedRfqIds = [testRfq.id, testRfq.rfqNumber];

      const quoteEml = `From: ${subscriberEmail}
To: vendor-smtp@supplier.test
Subject: Re: Quotation for ${testRfq.rfqNumber}
Message-ID: <quote-sub-2@connect.test>
Date: Tue, 22 Sep 2026 10:00:00 +0530
Content-Type: text/plain

Unit Price: INR 12,000
Lead Time: 5 days
`;
      jest.spyOn(geminiService, 'extractQuotationFromEmail').mockResolvedValueOnce({
        unitPrice: 12000,
        totalPrice: 24000,
        leadTimeDays: 5,
      });

      const result = await emailGatewayService.processMessage(Buffer.from(quoteEml, 'utf8'), vendorGatewayConfig);
      expect(result.status).toBe(emailGatewayQueries.INGESTION_OUTCOME.QUOTE_INGESTED);
      expect(storeService.getRFQById(testRfq.id).quotes).toHaveLength(1);
      expect(storeService.getVendorById(subscriberVendor.id, 'all').rfqDownloadsUsed).toBe(10);
    });

    test('submitting a quote via email when Connect quota is exhausted is rejected with CREDITS_EXHAUSTED', async () => {
      subscriberVendor.rfqDownloadsUsed = 50;
      const exhaustedSpy = jest.spyOn(mailerService, 'sendVendorCreditsExhaustedEmail').mockResolvedValue(true);

      const quoteEml = `From: ${subscriberEmail}
To: vendor-smtp@supplier.test
Subject: Re: Quotation for ${testRfq.rfqNumber}
Message-ID: <quote-sub-3@connect.test>
Date: Tue, 22 Sep 2026 10:00:00 +0530
Content-Type: text/plain

Unit Price: INR 15,000
Lead Time: 3 days
`;
      const result = await emailGatewayService.processMessage(Buffer.from(quoteEml, 'utf8'), vendorGatewayConfig);
      expect(result.status).toBe(emailGatewayQueries.INGESTION_OUTCOME.CREDITS_EXHAUSTED);
      expect(exhaustedSpy).toHaveBeenCalledTimes(1);
      expect(storeService.getRFQById(testRfq.id).quotes).toHaveLength(0);
      expect(storeService.getVendorById(subscriberVendor.id, 'all').rfqDownloadsUsed).toBe(50);
    });
  });

  describe('atomic database queries for Connect & Select subscriber quote credit deduction', () => {
    let originalPool;
    const subVendor = {
      id: 'v-atomic-sub',
      subscriptionPlan: 'connect',
      rfqDownloadsUsed: 10,
      unlockedRfqIds: [],
      quotedRfqIds: [],
    };
    const subOptions = {
      vendorId: subVendor.id,
      rfqId: 'rfq-atomic-sub-1',
      rfqNumber: 'RFQ-ATOMIC-SUB-1',
      transactionId: 'tx-atomic-sub-1',
      idempotencyKey: 'rfq-quote:v-atomic-sub:rfq-atomic-sub-1',
      isBuyerMapped: false,
      isResubmission: false,
    };

    beforeEach(() => {
      originalPool = pool.pool;
    });

    afterEach(() => {
      pool.pool = originalPool;
      jest.restoreAllMocks();
    });

    test('quoteCreditState charges 1 credit when Connect vendor has not unlocked RFQ', () => {
      const state = quoteCreditQueries.quoteCreditState(subVendor, false, false, false);
      expect(state).toEqual({ balance: 40, shouldCharge: true });
    });

    test('quoteCreditState charges 0 credits when Connect vendor has already unlocked RFQ', () => {
      const state = quoteCreditQueries.quoteCreditState(subVendor, false, false, true);
      expect(state).toEqual({ balance: 40, shouldCharge: false });
    });

    test('quoteCreditState charges 0 credits when isBuyerMapped or isResubmission is true', () => {
      expect(quoteCreditQueries.quoteCreditState(subVendor, true, false, false)).toEqual({ balance: 40, shouldCharge: false });
      expect(quoteCreditQueries.quoteCreditState(subVendor, false, true, false)).toEqual({ balance: 40, shouldCharge: false });
    });

    test('Postgres recordVendorQuoteCreditInDB charges 1 credit and increments rfqDownloadsUsed for new RFQ', async () => {
      const client = { query: jest.fn() };
      const savedVendor = { ...subVendor, rfqDownloadsUsed: 11, quotedRfqIds: [subOptions.rfqId], unlockedRfqIds: [subOptions.rfqId, subOptions.rfqNumber] };
      const ledger = { id: subOptions.transactionId, transaction_type: 'RFQ_QUOTE', amount: -1, balance_after: 39 };

      client.query
        .mockResolvedValueOnce({ rows: [{ raw: JSON.stringify(subVendor) }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ raw: JSON.stringify(savedVendor) }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [ledger], rowCount: 1 });

      pool.pool = {};
      jest.spyOn(pool, 'withTransaction').mockImplementation(async (cb) => cb(client));

      const result = await quoteCreditQueries.recordVendorQuoteCreditInDB(subOptions);
      expect(result).toMatchObject({ creditCharged: 1, alreadyQuoted: false });
      expect(result.vendor.rfqDownloadsUsed).toBe(11);
      expect(client.query.mock.calls[3][1]).toEqual([subOptions.transactionId, subOptions.vendorId, subOptions.rfqId, -1, 39, subOptions.idempotencyKey]);
    });

    test('Postgres recordVendorQuoteCreditInDB charges 0 credits if already unlocked', async () => {
      const client = { query: jest.fn() };
      const unlockedVendor = { ...subVendor, unlockedRfqIds: [subOptions.rfqId] };
      const savedVendor = { ...unlockedVendor, quotedRfqIds: [subOptions.rfqId] };
      const ledger = { id: subOptions.transactionId, transaction_type: 'RFQ_QUOTE', amount: 0, balance_after: 40 };

      client.query
        .mockResolvedValueOnce({ rows: [{ raw: JSON.stringify(unlockedVendor) }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ raw: JSON.stringify(savedVendor) }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [ledger], rowCount: 1 });

      pool.pool = {};
      jest.spyOn(pool, 'withTransaction').mockImplementation(async (cb) => cb(client));

      const result = await quoteCreditQueries.recordVendorQuoteCreditInDB(subOptions);
      expect(result).toMatchObject({ creditCharged: 0, alreadyQuoted: false });
      expect(result.vendor.rfqDownloadsUsed).toBe(10);
      expect(client.query.mock.calls[3][1]).toEqual([subOptions.transactionId, subOptions.vendorId, subOptions.rfqId, -0, 40, subOptions.idempotencyKey]);
    });
  });
});

describe('Payment Dues low-credit monitoring for subscribers', () => {
  beforeEach(() => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    jest.spyOn(paymentDuesQueries, 'fetchRawBuyers').mockResolvedValue([]);
  });

  afterEach(() => jest.restoreAllMocks());

  test('lists a subscriber only when their plan balance is low, not because the free-tier field is 0', async () => {
    jest.spyOn(paymentDuesQueries, 'fetchRawVendors').mockResolvedValue([
      { id: 'v-healthy', name: 'Healthy Select', subscriptionPlan: 'select', rfqDownloadsUsed: 11, freeQuotationCredits: 0 },
      { id: 'v-low', name: 'Low Connect', subscriptionPlan: 'connect', rfqDownloadsUsed: 49, freeQuotationCredits: 0 },
    ]);

    // A database is configured, and its communication table has no rows for these accounts.
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

    const result = await paymentDuesQueries.getLowCreditAccounts();
    const rows = result.data || result.accounts || result;
    const ids = rows.map((a) => a.accountId);

    expect(ids).not.toContain('v-healthy');
    expect(ids).toContain('v-low');
    expect(rows.find((a) => a.accountId === 'v-low')).toMatchObject({ totalCredits: 50 });
  });

  test('refuses to list low-credit accounts when no database is configured', async () => {
    jest.spyOn(paymentDuesQueries, 'fetchRawVendors').mockResolvedValue([
      { id: 'v-low', name: 'Low Connect', subscriptionPlan: 'connect', rfqDownloadsUsed: 49, freeQuotationCredits: 0 },
    ]);

    await expect(paymentDuesQueries.getLowCreditAccounts()).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
    });
  });
});
