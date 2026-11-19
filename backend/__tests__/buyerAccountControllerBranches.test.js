// Branch coverage for buyerAccountController. Handlers are called directly with mocked
// req, res and next. Storage is spied at each module boundary (store service, domain,
// identity, payment-dues and task queries, Zoho, mailer, SMS, event outbox). Nothing here
// reaches a database or a provider.
const buyerAccountController = require('../src/controllers/buyerAccountController');
const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const identityQueries = require('../src/db/identityQueries');
const internalTaskQueries = require('../src/db/internalTaskQueries');
const paymentDuesQueries = require('../src/db/paymentDuesQueries');
const pool = require('../src/db/pool');
const mailerService = require('../src/services/mailerService');
const smsService = require('../src/services/smsService');
const eventOutboxService = require('../src/services/eventOutboxService');
const zohoPaymentService = require('../src/services/zohoPaymentService');
const zohoReconciliationService = require('../src/services/zohoReconciliationService');
const { logger } = require('../src/services/loggerService');
const {
  CREDIT_APPROVAL_APPROVERS,
  PERSISTENCE_MESSAGES,
  ZOHO_CONFIG,
  computeZohoBuyerPlanAmount,
} = require('../src/config/constants');

const OWNER_EMAIL = 'owner@buyer.test';
const OTHER_EMAIL = 'other@buyer.test';
const STAFF_EMAIL = 'staff@procucev.test';
const APPROVER_NAME = CREDIT_APPROVAL_APPROVERS[0];

function buyerAccount(overrides = {}) {
  return {
    id: 'ba-1',
    organizationName: 'Buyer Org One',
    corporateEmail: OWNER_EMAIL,
    mobileNumber: '9876543210',
    creditBalance: 500,
    sourcingMode: 'mode_1',
    subscriptionPlan: 'version_1',
    ...overrides,
  };
}

function buyerUser(overrides = {}) {
  return { role: 'buyer', email: OWNER_EMAIL, sub: 'u-owner', ...overrides };
}

// Replaces the buyer list for the current test only. Used where the buyer has no organization name.
function buyerAccountWithoutName() {
  return buyerAccount({ organizationName: undefined });
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn();
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

describe('buyerAccountController branches', () => {
  beforeEach(() => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([buyerAccount()]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('account ownership for edits', () => {
    test('lets the owning buyer update their account', async () => {
      jest.spyOn(storeService, 'updateBuyerAccountDurably').mockResolvedValue(buyerAccount({ organizationName: 'Renamed Org' }));
      const res = mockRes();

      await buyerAccountController.updateBuyerAccount({
        user: buyerUser(),
        params: { id: 'ba-1' },
        body: { organizationName: 'Renamed Org' },
      }, res, jest.fn());

      expect(storeService.updateBuyerAccountDurably).toHaveBeenCalledWith('ba-1', { organizationName: 'Renamed Org' });
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('refuses a buyer edit to an account the session does not own', async () => {
      const updateSpy = jest.spyOn(storeService, 'updateBuyerAccountDurably');
      const res = mockRes();

      await buyerAccountController.updateBuyerAccount({
        user: buyerUser({ email: OTHER_EMAIL, sub: 'u-other' }),
        params: { id: 'ba-1' },
        body: { organizationName: 'Takeover' },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'You do not have permission to modify this buyer account.',
      });
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe('getBuyerAccounts', () => {
    test('forwards a failed listing and does not mark it retryable once storage reads as unconfigured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValueOnce(true).mockReturnValueOnce(false);
      jest.spyOn(domainQueries, 'getBuyerAccountsFromDB').mockRejectedValue(new Error('query timed out'));
      const next = jest.fn();

      await buyerAccountController.getBuyerAccounts({ user: { role: 'admin' } }, mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
      const forwarded = next.mock.calls[0][0];
      expect(forwarded.message).toBe('query timed out');
      expect(forwarded.status).toBeUndefined();
    });
  });

  describe('aiCrossMatch', () => {
    test('refuses the cross-match to a vendor session', () => {
      const res = mockRes();

      buyerAccountController.aiCrossMatch({ user: { role: 'vendor' }, body: {} }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('answers an empty match when the body carries no vendors or PO lines', () => {
      const res = mockRes();

      buyerAccountController.aiCrossMatch({ user: buyerUser(), body: {} }, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith({ success: true, data: [], totalMatched: 0, totalUnmatched: 0 });
    });

    test('matches vendors on name, keeps the first category on a tie, and treats missing spend as zero', () => {
      const res = mockRes();

      buyerAccountController.aiCrossMatch({
        user: { role: 'admin' },
        body: {
          vendors: [
            { id: 'v-1', companyName: 'Alpha Pumps', vendorCode: 'ALP-1' },
            { id: 'v-2', vendorCode: 'ZZZ-9' },
          ],
          poLineItems: [
            { vendorIdentifier: 'Alpha Pumps', itemName: 'Pump', existingCategory: 'Valves', totalSpend: 500 },
            { vendorIdentifier: 'alpha pumps', itemName: 'Seal', existingCategory: 'Piping' },
          ],
        },
      }, res, jest.fn());

      const { data, totalMatched, totalUnmatched } = res.json.mock.calls[0][0];
      expect(data[0]).toEqual(expect.objectContaining({
        id: 'v-1',
        hasPoHistory: true,
        poCount: 2,
        firstSetMajorCategory: 'Valves',
        itemsSupplied: ['Pump', 'Seal'],
      }));
      expect(data[0].pastPoSpend).toEqual(expect.stringContaining('(2 POs)'));
      expect(data[1]).toEqual(expect.objectContaining({ id: 'v-2', hasPoHistory: false, firstSetMajorCategory: '' }));
      expect(totalMatched).toBe(1);
      expect(totalUnmatched).toBe(1);
    });
  });

  describe('createSubscriptionPaymentLink', () => {
    const ZOHO_LINK = {
      zohoPaymentLinkId: 'zpl-1',
      paymentUrl: 'https://pay.test/zpl-1',
      status: 'CREATED',
      rawResponse: { ok: true },
    };

    function paymentRequest(body) {
      return { user: buyerUser(), params: { id: 'ba-1' }, body };
    }

    beforeEach(() => {
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(buyerAccount());
      jest.spyOn(zohoPaymentService, 'createPaymentLink').mockResolvedValue(ZOHO_LINK);
      jest.spyOn(storeService, 'createPaymentLinkRecordDurably').mockImplementation(async (data) => ({
        id: data.id,
        zohoPaymentLinkId: data.zohoPaymentLinkId,
        paymentUrl: data.paymentUrl,
        status: data.status,
      }));
    });

    test('refuses a payment-link request from a vendor session before any Zoho call', async () => {
      const res = mockRes();

      await buyerAccountController.createSubscriptionPaymentLink({
        user: { role: 'vendor', email: 'vendor@vendor.test' },
        params: { id: 'ba-1' },
        body: { plan: 'version_1' },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(403);
      expect(zohoPaymentService.createPaymentLink).not.toHaveBeenCalled();
    });

    test('rejects a request with no body as a plan outside the payable list', async () => {
      const res = mockRes();

      await buyerAccountController.createSubscriptionPaymentLink({ user: buyerUser(), params: { id: 'ba-1' } }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'plan must be one of: version_1, version_2, version_3.',
      });
    });

    test('prices and labels six-month billing as six months', async () => {
      const res = mockRes();

      await buyerAccountController.createSubscriptionPaymentLink(
        paymentRequest({ plan: 'version_1', billingDuration: '6_months' }),
        res,
        jest.fn()
      );

      expect(zohoPaymentService.createPaymentLink).toHaveBeenCalledWith(expect.objectContaining({
        planId: 'version_1',
        planLabel: expect.stringContaining('(6 Months)'),
        amountInr: computeZohoBuyerPlanAmount('version_1', '6_months'),
      }));
      expect(storeService.createPaymentLinkRecordDurably).toHaveBeenCalledWith(
        expect.objectContaining({ billingDuration: '6_months' })
      );
    });

    test('uses the duration field when billingDuration is blank', async () => {
      const res = mockRes();

      await buyerAccountController.createSubscriptionPaymentLink(
        paymentRequest({ plan: 'version_2', billingDuration: '', duration: '6_months' }),
        res,
        jest.fn()
      );

      expect(storeService.createPaymentLinkRecordDurably).toHaveBeenCalledWith(
        expect.objectContaining({ planId: 'version_2', billingDuration: '6_months' })
      );
    });

    test('stores a payment link that the provider returned without a status as CREATED', async () => {
      jest.spyOn(zohoPaymentService, 'createPaymentLink').mockResolvedValue({ ...ZOHO_LINK, status: undefined });
      const res = mockRes();

      await buyerAccountController.createSubscriptionPaymentLink(paymentRequest({ plan: 'version_3' }), res, jest.fn());

      expect(storeService.createPaymentLinkRecordDurably).toHaveBeenCalledWith(expect.objectContaining({ status: 'CREATED' }));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'CREATED' }),
      }));
    });

    test('builds a root-relative return path when the return URL base is empty', async () => {
      ZOHO_CONFIG.RETURN_URL_BASE = '';
      const res = mockRes();
      try {
        await buyerAccountController.createSubscriptionPaymentLink(paymentRequest({ plan: 'version_1' }), res, jest.fn());
      } finally {
        delete ZOHO_CONFIG.RETURN_URL_BASE;
      }

      expect(zohoPaymentService.createPaymentLink).toHaveBeenCalledWith(expect.objectContaining({
        returnUrl: expect.stringMatching(/^\/buyer\/subscription-center\?linkId=pl-/),
      }));
    });

    test('reuses the mirror created by a concurrent first request after a uniqueness conflict', async () => {
      jest.spyOn(storeService, 'getBuyerAccountByEmail')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(buyerAccount());
      jest.spyOn(storeService, 'addBuyerAccountDurably').mockRejectedValue(
        Object.assign(new Error('duplicate buyer mirror'), { statusCode: 409 })
      );
      const res = mockRes();

      await buyerAccountController.createSubscriptionPaymentLink(paymentRequest({ plan: 'version_1' }), res, jest.fn());

      expect(storeService.getBuyerAccountByEmail).toHaveBeenCalledTimes(2);
      expect(storeService.createPaymentLinkRecordDurably).toHaveBeenCalledWith(
        expect.objectContaining({ buyerAccountId: 'ba-1' })
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('takes the buyer phone from the identity record when the mirror has none', async () => {
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(buyerAccount({ mobileNumber: '' }));
      const identitySpy = jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue({ mobile: '9123456789' });
      const res = mockRes();

      await buyerAccountController.createSubscriptionPaymentLink(paymentRequest({ plan: 'version_1' }), res, jest.fn());

      expect(identitySpy).toHaveBeenCalledWith(OWNER_EMAIL);
      expect(zohoPaymentService.createPaymentLink).toHaveBeenCalledWith(expect.objectContaining({ phone: '9123456789' }));
    });

    test('logs an identity lookup failure and refuses when no phone is available anywhere', async () => {
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(buyerAccount({ mobileNumber: '' }));
      jest.spyOn(identityQueries, 'findUserByEmail').mockRejectedValue(new Error('identity store down'));
      const errorSpy = jest.spyOn(logger, 'error');
      const res = mockRes();

      await buyerAccountController.createSubscriptionPaymentLink(paymentRequest({ plan: 'version_1' }), res, jest.fn());

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Identity profile lookup failed'),
        expect.any(Error),
        'BUYER_ACCOUNT_CONTROLLER'
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(zohoPaymentService.createPaymentLink).not.toHaveBeenCalled();
    });
  });

  describe('getPaymentLinks', () => {
    test('keeps the first list when reconciliation changed nothing', async () => {
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(buyerAccount());
      const linksSpy = jest.spyOn(storeService, 'getPaymentLinksForBuyer').mockResolvedValue([{ id: 'pl-1', status: 'CREATED' }]);
      jest.spyOn(zohoReconciliationService, 'reconcilePendingLinks').mockResolvedValue(0);
      const res = mockRes();

      await buyerAccountController.getPaymentLinks({ user: buyerUser(), params: { id: 'ba-1' } }, res, jest.fn());

      expect(linksSpy).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ id: 'pl-1', status: 'CREATED' }] });
    });
  });

  describe('getCreditHistory', () => {
    test('treats missing transaction history as empty', async () => {
      jest.spyOn(domainQueries, 'getBuyerCreditTransactionsFromDB').mockResolvedValue(null);
      const res = mockRes();

      await buyerAccountController.getCreditHistory({ user: { role: 'admin' }, params: { id: 'ba-1' } }, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        transactions: [],
        historyAvailable: false,
      }));
    });

    test('counts an untyped transaction row by its consumed credits only', async () => {
      jest.spyOn(domainQueries, 'getBuyerCreditTransactionsFromDB').mockResolvedValue([
        { id: 'tx-1', credits_added: 5, credits_consumed: 2 },
      ]);
      const res = mockRes();

      await buyerAccountController.getCreditHistory({ user: { role: 'admin' }, params: { id: 'ba-1' } }, res, jest.fn());

      const body = res.json.mock.calls[0][0];
      expect(body.summary.totalCreditsConsumed).toBe(2);
      expect(body.summary.totalCreditsAllocated).toBe(0);
      expect(body.historyAvailable).toBe(true);
    });
  });

  describe('requestCreditApproval', () => {
    test('refuses a credit approval request from a buyer session', async () => {
      const res = mockRes();

      await buyerAccountController.requestCreditApproval({ user: buyerUser(), params: { id: 'ba-1' }, body: {} }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('rejects an approval request that fails validation', async () => {
      const res = mockRes();

      await buyerAccountController.requestCreditApproval({
        user: { role: 'admin', email: STAFF_EMAIL, name: 'Staff Admin' },
        params: { id: 'ba-1' },
        body: {},
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Validation failed on credit approval request.',
      }));
    });

    test('refuses an approval when the buyer has no balance on record', async () => {
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([buyerAccount({ creditBalance: 'n/a' })]);
      const taskSpy = jest.spyOn(internalTaskQueries, 'createInternalTaskWithApproval');
      const res = mockRes();

      await buyerAccountController.requestCreditApproval({
        user: { role: 'admin', email: STAFF_EMAIL, name: 'Staff Admin' },
        params: { id: 'ba-1' },
        body: { amount: 10, approverName: APPROVER_NAME },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(422);
      expect(taskSpy).not.toHaveBeenCalled();
    });

    test('submits the approval as the signed-in maker, with fallbacks for a missing reason and email', async () => {
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([{
        id: 'ba-2',
        organizationName: 'Buyer Org Two',
        creditBalance: 250,
      }]);
      const taskSpy = jest.spyOn(internalTaskQueries, 'createInternalTaskWithApproval').mockResolvedValue({ task_number: 'TSK-CR-9' });
      const res = mockRes();

      await buyerAccountController.requestCreditApproval({
        user: { role: 'admin', email: STAFF_EMAIL },
        params: { id: 'ba-2' },
        body: { amount: 100, approverName: APPROVER_NAME },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(201);
      expect(taskSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Requested credit top-up for Buyer Org Two',
          creditQuantity: 100,
          notes: expect.stringContaining(`Initiated By: ${STAFF_EMAIL}.`),
        }),
        expect.objectContaining({ name: STAFF_EMAIL, email: STAFF_EMAIL }),
        expect.objectContaining({
          details: 'Requested credit top-up for Buyer Org Two',
          applicant_email: '',
          available_balance: 250,
          history: [expect.objectContaining({
            remarks: `Submitted for credit approval by ${APPROVER_NAME}.`,
          })],
        })
      );
    });

    test('refuses buyer credit deletion when deduction exceeds current balance', async () => {
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([{
        id: 'ba-del',
        organizationName: 'Buyer Del Org',
        creditBalance: 15,
      }]);
      const res = mockRes();

      await buyerAccountController.requestCreditApproval({
        user: { role: 'admin', email: STAFF_EMAIL },
        params: { id: 'ba-del' },
        body: {
          requestType: 'Buyer Credit Deletion',
          amount: 50,
          approverName: APPROVER_NAME,
        },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.stringContaining('Cannot delete 50 credits'),
      }));
    });

    test('refuses buyer credit addition and deletion when amount is not a valid positive number', async () => {
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([{
        id: 'ba-num',
        organizationName: 'Buyer Num Org',
        creditBalance: 50,
      }]);

      const resAdd = mockRes();
      await buyerAccountController.requestCreditApproval({
        user: { role: 'admin', email: STAFF_EMAIL },
        params: { id: 'ba-num' },
        body: { requestType: 'Buyer Credit Addition', amount: -5, approverName: APPROVER_NAME },
      }, resAdd, jest.fn());
      expect(resAdd.status).toHaveBeenCalledWith(400);

      const resDel = mockRes();
      await buyerAccountController.requestCreditApproval({
        user: { role: 'admin', email: STAFF_EMAIL },
        params: { id: 'ba-num' },
        body: { requestType: 'Buyer Credit Deletion', approverName: APPROVER_NAME },
      }, resDel, jest.fn());
      expect(resDel.status).toHaveBeenCalledWith(400);
      expect(resDel.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'A positive credit amount is required for Buyer Credit Deletion.',
      }));
    });

    test('submits requests for Buyer Credit Deletion, Discounts, Trial Periods, and Offline Payments', async () => {
      const taskSpy = jest.spyOn(internalTaskQueries, 'createInternalTaskWithApproval').mockResolvedValue({ task_number: 'TSK-REQ-1' });

      // 1. Buyer Credit Deletion
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([{
        id: 'ba-del',
        organizationName: 'Buyer Del Org',
        creditBalance: 100,
        corporateEmail: 'del@buyer.test',
      }]);
      let res = mockRes();
      await buyerAccountController.requestCreditApproval({
        user: { role: 'admin', email: STAFF_EMAIL, fullName: 'Staff Approver' },
        params: { id: 'ba-del' },
        body: {
          requestType: 'Buyer Credit Deletion',
          amount: 25,
          approverName: APPROVER_NAME,
          reason: 'Excess quota reduction',
        },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(201);
      expect(taskSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskType: 'Credit Deletion',
          title: 'Credit Deduction Request: 25 Credits from Buyer Del Org',
          description: 'Excess quota reduction',
        }),
        expect.anything(),
        expect.objectContaining({
          request_type: 'Buyer Credit Deletion',
          value_impact: '-25 RFQ Credits (Buyer Del Org)',
        })
      );

      // 2. Discounts
      taskSpy.mockClear();
      res = mockRes();
      await buyerAccountController.requestCreditApproval({
        user: { role: 'admin', email: STAFF_EMAIL },
        params: { id: 'ba-del' },
        body: {
          requestType: 'Discounts',
          discountPercentage: 15,
          approverName: APPROVER_NAME,
        },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(201);
      expect(taskSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskType: 'Discounts',
          title: 'Discount Approval Request: 15% for Buyer Del Org',
        }),
        expect.anything(),
        expect.objectContaining({
          value_impact: '15% Subscription Discount (Buyer Del Org)',
          amount: 15,
        })
      );

      // 3. Trial Periods
      taskSpy.mockClear();
      res = mockRes();
      await buyerAccountController.requestCreditApproval({
        user: { role: 'admin', email: STAFF_EMAIL },
        params: { id: 'ba-del' },
        body: {
          requestType: 'Trial Periods',
          durationDays: 45,
          approverName: APPROVER_NAME,
        },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(201);
      expect(taskSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskType: 'Trial Periods',
          title: 'Trial Period Request: 45 Days for Buyer Del Org',
        }),
        expect.anything(),
        expect.objectContaining({
          value_impact: '45 Days Free Trial (Buyer Del Org)',
          amount: 45,
        })
      );

      // 4. Offline Payments
      taskSpy.mockClear();
      res = mockRes();
      await buyerAccountController.requestCreditApproval({
        user: { role: 'admin', email: STAFF_EMAIL },
        params: { id: 'ba-del' },
        body: {
          requestType: 'Offline Payments',
          amount: 50000,
          paymentReference: 'NEFT-883924',
          approverName: APPROVER_NAME,
        },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(201);
      expect(taskSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskType: 'Offline Payments',
          title: expect.stringContaining('Offline Payment Verification: ₹50,000'),
        }),
        expect.anything(),
        expect.objectContaining({
          value_impact: expect.stringContaining('Ref: NEFT-883924'),
        })
      );

      // 5. Discounts with full calculation breakdown and proof file
      taskSpy.mockClear();
      res = mockRes();
      await buyerAccountController.requestCreditApproval({
        user: { role: 'admin', email: STAFF_EMAIL },
        params: { id: 'ba-del' },
        body: {
          requestType: 'Discounts',
          amount: 20,
          discountPercentage: 20,
          selectedMode: 'Mode 2',
          billingDuration: '6 Months',
          originalPrice: 47994,
          discountAmount: 9598.8,
          remainingAmount: 38395.2,
          gstAmount: 6911.14,
          finalPayableAmount: 45306.34,
          reason: 'Special loyalty concession',
          approverName: APPROVER_NAME,
          proofFileName: 'proof.pdf',
          proofFileUrl: 'https://example.com/proof.pdf',
          proofFileType: 'application/pdf',
          proofFileSize: 1024,
        },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(201);
      expect(taskSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskType: 'Discounts',
          raw: expect.objectContaining({
            original_price: 47994,
            selected_mode: 'Mode 2',
            billing_duration: '6 Months',
            discount_percentage: 20,
          }),
        }),
        expect.anything(),
        expect.objectContaining({
          details: expect.stringContaining('Special loyalty concession'),
        })
      );
    });

    test('answers 503 with the database message when the approval cannot be stored', async () => {
      jest.spyOn(internalTaskQueries, 'createInternalTaskWithApproval').mockRejectedValue(
        Object.assign(new Error('storage down'), { code: 'PERSISTENCE_UNAVAILABLE' })
      );
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
      const res = mockRes();
      const next = jest.fn();

      await buyerAccountController.requestCreditApproval({
        user: { role: 'admin', email: STAFF_EMAIL, name: 'Staff Admin' },
        params: { id: 'ba-1' },
        body: { amount: 100, approverName: APPROVER_NAME },
      }, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE,
        code: 'PERSISTENCE_UNAVAILABLE',
        retryable: true,
      });
      expect(next).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith('Error requesting credit approval for buyer', expect.any(Error), 'BUYER_ACCOUNT_CONTROLLER');
    });

    test('answers 503 from the real task write when no database is configured', async () => {
      jest.spyOn(logger, 'error').mockImplementation(() => {});
      const res = mockRes();
      const next = jest.fn();

      await buyerAccountController.requestCreditApproval({
        user: { role: 'admin', email: STAFF_EMAIL, name: 'Staff Admin' },
        params: { id: 'ba-1' },
        body: { amount: 100, approverName: APPROVER_NAME },
      }, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        code: 'PERSISTENCE_UNAVAILABLE',
        retryable: true,
        error: PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE,
      }));
      expect(next).not.toHaveBeenCalled();
    });

    test('passes other failures to next unchanged', async () => {
      const conflict = Object.assign(new Error('This idempotency key was already used for a different credit approval request.'), {
        code: 'IDEMPOTENCY_CONFLICT',
        statusCode: 409,
      });
      jest.spyOn(internalTaskQueries, 'createInternalTaskWithApproval').mockRejectedValue(conflict);
      jest.spyOn(logger, 'error').mockImplementation(() => {});
      const res = mockRes();
      const next = jest.fn();

      await buyerAccountController.requestCreditApproval({
        user: { role: 'admin', email: STAFF_EMAIL, name: 'Staff Admin' },
        params: { id: 'ba-1' },
        body: { amount: 100, approverName: APPROVER_NAME },
      }, res, next);

      expect(next).toHaveBeenCalledWith(conflict);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('updateSupportedCategories', () => {
    test('refuses a category update from a vendor session', async () => {
      const res = mockRes();

      await buyerAccountController.updateSupportedCategories({
        user: { role: 'vendor', email: 'vendor@vendor.test' },
        params: { id: 'ba-1' },
        body: { categories: ['Valves'] },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('refuses a category update to an account the buyer does not own', async () => {
      const updateSpy = jest.spyOn(storeService, 'updateBuyerAccountDurably');
      const res = mockRes();

      await buyerAccountController.updateSupportedCategories({
        user: buyerUser({ email: OTHER_EMAIL, sub: 'u-other' }),
        params: { id: 'ba-1' },
        body: { categories: ['Valves'] },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(403);
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe('getBuyerCommunications', () => {
    test('refuses the communication history to a vendor session', async () => {
      const res = mockRes();

      await buyerAccountController.getBuyerCommunications({
        user: { role: 'vendor', email: 'vendor@vendor.test' },
        params: { id: 'ba-1' },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('refuses the communication history to a buyer who does not own the account', async () => {
      const historySpy = jest.spyOn(paymentDuesQueries, 'getCommunicationHistory');
      const res = mockRes();

      await buyerAccountController.getBuyerCommunications({
        user: buyerUser({ email: OTHER_EMAIL, sub: 'u-other' }),
        params: { id: 'ba-1' },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(403);
      expect(historySpy).not.toHaveBeenCalled();
    });
  });

  describe('recordBuyerCommunication', () => {
    const STAFF = { role: 'admin', email: STAFF_EMAIL, name: 'Staff Admin' };
    let recordSpy;
    let updateSpy;

    function communicationRequest(body, user = STAFF) {
      return { user, params: { id: 'ba-1' }, body };
    }

    beforeEach(() => {
      recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({ id: 'comm-1', deliveryStatus: 'Pending' });
      updateSpy = jest.spyOn(paymentDuesQueries, 'updateCommunicationDeliveryStatus').mockResolvedValue({ id: 'comm-1', deliveryStatus: 'Delivered' });
      jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue({ id: 'comm-1', deliveryStatus: 'Delivered' });
      jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({ id: 'tsk-comm' });
    });

    test('refuses a communication record from a vendor session', async () => {
      const res = mockRes();

      await buyerAccountController.recordBuyerCommunication(
        communicationRequest({ channel: 'EMAIL' }, { role: 'vendor', email: 'vendor@vendor.test' }),
        res,
        jest.fn()
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(recordSpy).not.toHaveBeenCalled();
    });

    test('refuses a communication record to a buyer who does not own the account', async () => {
      const res = mockRes();

      await buyerAccountController.recordBuyerCommunication(
        communicationRequest({ channel: 'EMAIL' }, buyerUser({ email: OTHER_EMAIL, sub: 'u-other' })),
        res,
        jest.fn()
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(recordSpy).not.toHaveBeenCalled();
    });

    test('refuses to attribute a communication to a session with no name or email', async () => {
      const res = mockRes();

      await buyerAccountController.recordBuyerCommunication(
        communicationRequest({ channel: 'EMAIL' }, { role: 'admin', sub: 'staff-anon' }),
        res,
        jest.fn()
      );

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.stringContaining('cannot be attributed'),
      }));
      expect(recordSpy).not.toHaveBeenCalled();
    });

    test('sends the email as staff without a reply address and uses the default subject', async () => {
      const deliverSpy = jest.spyOn(mailerService, 'deliver').mockResolvedValue({ sent: true });
      const res = mockRes();

      await buyerAccountController.recordBuyerCommunication(
        communicationRequest({ channel: 'EMAIL', notes: 'Call follow-up', message: '' }, { role: 'admin', name: 'Staff Admin' }),
        res,
        jest.fn()
      );

      expect(deliverSpy).toHaveBeenCalledWith(
        expect.objectContaining({ to: OWNER_EMAIL, subject: '[Procucev] Buyer Account Update', text: 'Call follow-up', replyTo: undefined }),
        'BUYER_DOSSIER_COMM'
      );
      expect(recordSpy.mock.calls[0][0].metadata).toEqual(expect.objectContaining({
        deliveryEmailSubject: '[Procucev] Buyer Account Update',
      }));
      expect(recordSpy.mock.calls[0][0].metadata).not.toHaveProperty('deliveryReplyTo');
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
        notificationStatus: 'Notification Sent',
        deliveryStatus: 'Delivered',
      }));
      expect(res.status).toHaveBeenCalledWith(201);
    });

    test('sends an empty email body when there is neither a message nor a note', async () => {
      const deliverSpy = jest.spyOn(mailerService, 'deliver').mockResolvedValue({ sent: true });
      const res = mockRes();

      await buyerAccountController.recordBuyerCommunication(
        communicationRequest({ channel: 'EMAIL', message: '' }),
        res,
        jest.fn()
      );

      expect(deliverSpy).toHaveBeenCalledWith(expect.objectContaining({ text: '' }), 'BUYER_DOSSIER_COMM');
    });

    test('marks the email failed when the provider accepts nothing, with or without a reason', async () => {
      const deliverSpy = jest.spyOn(mailerService, 'deliver')
        .mockResolvedValueOnce({ sent: false, reason: 'Relay refused' })
        .mockResolvedValueOnce({ sent: false });

      await buyerAccountController.recordBuyerCommunication(communicationRequest({ channel: 'EMAIL', message: 'Hello buyer' }), mockRes(), jest.fn());
      await buyerAccountController.recordBuyerCommunication(communicationRequest({ channel: 'EMAIL', message: 'Hello again' }), mockRes(), jest.fn());

      expect(deliverSpy).toHaveBeenCalledTimes(2);
      expect(updateSpy).toHaveBeenCalledTimes(2);
      for (const [statusUpdate] of updateSpy.mock.calls) {
        expect(statusUpdate).toEqual(expect.objectContaining({
          notificationStatus: 'Failed',
          deliveryStatus: 'Failed',
          acknowledgementStatus: 'Failed',
        }));
      }
    });

    test('marks the email failed and logs it when the mailer throws', async () => {
      jest.spyOn(mailerService, 'deliver').mockRejectedValue(new Error('connection reset'));
      const errorSpy = jest.spyOn(logger, 'error');
      const res = mockRes();

      await buyerAccountController.recordBuyerCommunication(communicationRequest({ channel: 'EMAIL', message: 'Hello buyer' }), res, jest.fn());

      expect(errorSpy).toHaveBeenCalledWith(
        'Buyer dossier email dispatch failed',
        expect.objectContaining({ error: expect.objectContaining({ message: 'connection reset' }) }),
        'BUYER_ACCOUNT_CONTROLLER'
      );
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ deliveryStatus: 'Failed' }));
      expect(res.status).toHaveBeenCalledWith(201);
    });

    test('marks the email failed when the shared mailer has no deliver function', async () => {
      const originalDeliver = mailerService.deliver;
      mailerService.deliver = undefined;
      const errorSpy = jest.spyOn(logger, 'error');
      try {
        await buyerAccountController.recordBuyerCommunication(communicationRequest({ channel: 'EMAIL', message: 'Hello buyer' }), mockRes(), jest.fn());
      } finally {
        mailerService.deliver = originalDeliver;
      }

      expect(errorSpy).toHaveBeenCalledWith(
        'Buyer dossier email dispatch failed',
        expect.objectContaining({
          error: expect.objectContaining({ message: 'Shared email delivery service is unavailable.' }),
        }),
        'BUYER_ACCOUNT_CONTROLLER'
      );
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ deliveryStatus: 'Failed' }));
    });

    test('logs a mismatch and keeps the pending record when the status write matches no row', async () => {
      jest.spyOn(mailerService, 'deliver').mockResolvedValue({ sent: true });
      updateSpy.mockResolvedValue(null);
      const errorSpy = jest.spyOn(logger, 'error');
      const res = mockRes();

      await buyerAccountController.recordBuyerCommunication(communicationRequest({ channel: 'EMAIL', message: 'Hello buyer' }), res, jest.fn());

      expect(errorSpy).toHaveBeenCalledWith(
        'Buyer dossier delivery result could not be matched to its persisted communication',
        expect.any(Object),
        'BUYER_ACCOUNT_CONTROLLER'
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: { id: 'comm-1', deliveryStatus: 'Pending' },
      }));
    });

    test('sends an SMS to the buyer phone with the subject-less fallback text and records the provider refusal', async () => {
      const smsSpy = jest.spyOn(smsService, 'sendActionCenterSms').mockResolvedValue({ success: false });
      const res = mockRes();

      await buyerAccountController.recordBuyerCommunication(
        communicationRequest({ channel: 'SMS', recipient: '9876543210', message: '', subject: '' }),
        res,
        jest.fn()
      );

      expect(smsSpy).toHaveBeenCalledWith(expect.objectContaining({
        mobile: '9876543210',
        recipientName: 'Buyer Org One',
        message: 'Buyer account notification',
      }));
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
        notificationStatus: 'Failed',
        deliveryStatus: 'Failed',
      }));
    });

    test('uses the subject as SMS text when there is no message, and keeps the provider error text', async () => {
      const smsSpy = jest.spyOn(smsService, 'sendActionCenterSms').mockResolvedValue({ success: false, error: 'Gateway timeout' });
      const errorSpy = jest.spyOn(logger, 'error');
      storeService.getBuyerAccounts.mockReturnValue([buyerAccountWithoutName()]);
      const res = mockRes();

      await buyerAccountController.recordBuyerCommunication(
        communicationRequest({ channel: 'SMS', recipient: '9876543210', message: '', subject: 'Payment reminder' }),
        res,
        jest.fn()
      );

      expect(smsSpy).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Payment reminder',
        recipientName: null,
      }));
      expect(recordSpy.mock.calls[0][0].metadata).toEqual(expect.objectContaining({ deliveryRecipientName: null }));
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ deliveryStatus: 'Failed' }));
      expect(errorSpy).not.toHaveBeenCalledWith('Buyer dossier SMS dispatch failed', expect.anything(), expect.anything());
    });

    test('marks the SMS failed and logs it when the SMS dispatch throws', async () => {
      jest.spyOn(smsService, 'sendActionCenterSms').mockRejectedValue(new Error('sms network down'));
      const errorSpy = jest.spyOn(logger, 'error');

      await buyerAccountController.recordBuyerCommunication(
        communicationRequest({ channel: 'SMS', recipient: '9876543210', message: 'Payment reminder text' }),
        mockRes(),
        jest.fn()
      );

      expect(errorSpy).toHaveBeenCalledWith(
        'Buyer dossier SMS dispatch failed',
        expect.objectContaining({ error: expect.objectContaining({ message: 'sms network down' }) }),
        'BUYER_ACCOUNT_CONTROLLER'
      );
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ deliveryStatus: 'Failed' }));
    });

    test('queues the SMS through the durable outbox when storage is configured and returns the reloaded record', async () => {
      pool.hasStorage.mockReturnValue(true);
      const outboxSpy = jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({ claimed: 1 });
      const res = mockRes();

      await buyerAccountController.recordBuyerCommunication(
        communicationRequest({ channel: 'SMS', recipient: '9876543210', message: 'Payment reminder text' }),
        res,
        jest.fn()
      );

      expect(outboxSpy).toHaveBeenCalledWith(1);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        data: { id: 'comm-1', deliveryStatus: 'Delivered' },
      }));
    });

    test('logs an immediate outbox failure and still answers with the queued record', async () => {
      pool.hasStorage.mockReturnValue(true);
      jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockRejectedValue(new Error('outbox busy'));
      const errorSpy = jest.spyOn(logger, 'error');
      const res = mockRes();

      await buyerAccountController.recordBuyerCommunication(
        communicationRequest({ channel: 'SMS', recipient: '9876543210', message: 'Payment reminder text' }),
        res,
        jest.fn()
      );

      expect(errorSpy).toHaveBeenCalledWith(
        'Immediate buyer dossier delivery failed; durable recovery will retry',
        expect.objectContaining({ accountId: 'ba-1', communicationId: 'comm-1' }),
        'BUYER_ACCOUNT_CONTROLLER'
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    test('keeps the queued record and logs when its delivery state cannot be reloaded', async () => {
      pool.hasStorage.mockReturnValue(true);
      jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({ claimed: 1 });
      jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockRejectedValue(new Error('read failed'));
      const errorSpy = jest.spyOn(logger, 'error');
      const res = mockRes();

      await buyerAccountController.recordBuyerCommunication(
        communicationRequest({ channel: 'SMS', recipient: '9876543210', message: 'Payment reminder text' }),
        res,
        jest.fn()
      );

      expect(errorSpy).toHaveBeenCalledWith(
        'Buyer dossier delivery state could not be reloaded after queueing',
        expect.objectContaining({ communicationId: 'comm-1' }),
        'BUYER_ACCOUNT_CONTROLLER'
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        data: { id: 'comm-1', deliveryStatus: 'Pending' },
      }));
    });

    test('logs a queued communication that has disappeared and keeps the original record', async () => {
      pool.hasStorage.mockReturnValue(true);
      jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({ claimed: 1 });
      jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue(null);
      const errorSpy = jest.spyOn(logger, 'error');
      const res = mockRes();

      await buyerAccountController.recordBuyerCommunication(
        communicationRequest({ channel: 'SMS', recipient: '9876543210', message: 'Payment reminder text' }),
        res,
        jest.fn()
      );

      expect(errorSpy).toHaveBeenCalledWith(
        'Buyer dossier communication disappeared after durable delivery was queued',
        expect.objectContaining({ communicationId: 'comm-1' }),
        'BUYER_ACCOUNT_CONTROLLER'
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        data: { id: 'comm-1', deliveryStatus: 'Pending' },
      }));
    });

    test('links the follow-up to the actor when the actor has no user id', async () => {
      const taskSpy = internalTaskQueries.createInternalTask;
      const res = mockRes();

      await buyerAccountController.recordBuyerCommunication(
        communicationRequest({
          channel: 'CALL',
          message: 'Spoke about renewal',
          nextFollowupDate: '2026-12-01',
          followupPriority: 'High',
        }, { role: 'admin', name: 'Staff Admin' }),
        res,
        jest.fn()
      );

      expect(taskSpy).toHaveBeenCalledTimes(2);
      expect(taskSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({
        priority: 'High',
        assignedToUserId: null,
        assignedToName: 'Staff Admin',
        dueDate: '2026-12-01',
      }), expect.objectContaining({ name: 'Staff Admin' }));
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('getBuyerPaymentHistory', () => {
    test('refuses payment history to a vendor session', async () => {
      const res = mockRes();

      await buyerAccountController.getBuyerPaymentHistory({
        user: { role: 'vendor', email: 'vendor@vendor.test' },
        params: { id: 'ba-1' },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('refuses payment history to a buyer who does not own the account', async () => {
      const linksSpy = jest.spyOn(storeService, 'getPaymentLinksForBuyer');
      const res = mockRes();

      await buyerAccountController.getBuyerPaymentHistory({
        user: buyerUser({ email: OTHER_EMAIL, sub: 'u-other' }),
        params: { id: 'ba-1' },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(403);
      expect(linksSpy).not.toHaveBeenCalled();
    });

    test('adds only paid and refunded links that carry an amount to the money totals', async () => {
      jest.spyOn(storeService, 'getPaymentLinksForBuyer').mockResolvedValue([
        { id: 'pl-1', status: 'PAID', amount: null, planId: 'version_1' },
        { id: 'pl-2', status: 'REFUNDED', amount: null, planId: 'version_1' },
        { id: 'pl-3', status: 'PAID', amount: 4999, planId: 'version_1' },
      ]);
      jest.spyOn(zohoReconciliationService, 'reconcilePendingLinks').mockResolvedValue(0);
      const res = mockRes();

      await buyerAccountController.getBuyerPaymentHistory({ user: buyerUser(), params: { id: 'ba-1' } }, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        summary: expect.objectContaining({
          totalAmountPaid: 4999,
          totalSuccessfulPayments: 2,
          totalRefundedAmount: 0,
        }),
      }));
    });
  });

  describe('createBuyerAccount, updateBuyerAccount & deleteBuyerAccount branches', () => {
    test('merges into existing mirror account when session matches', async () => {
      const mirrorEmail = 'mirror@test.com';
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({
        id: 'u-mirror-1',
        organizationName: 'Old Mirror',
        corporateEmail: mirrorEmail,
      });
      const updateSpy = jest.spyOn(storeService, 'updateBuyerAccountDurably').mockResolvedValue({
        id: 'u-mirror-1',
        organizationName: 'New Mirror',
        corporateEmail: mirrorEmail,
      });

      const res = mockRes();
      await buyerAccountController.createBuyerAccount({
        user: { id: 'u-mirror-1', email: mirrorEmail, role: 'admin' },
        body: { organizationName: 'New Mirror', corporateEmail: mirrorEmail },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(201);
      expect(updateSpy).toHaveBeenCalledWith('u-mirror-1', expect.objectContaining({
        organizationName: 'New Mirror',
      }));
    });

    test('returns 404 and catches error on updateBuyerAccount', async () => {
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([buyerAccount()]);
      jest.spyOn(storeService, 'updateBuyerAccountDurably').mockResolvedValueOnce(null);

      const res404 = mockRes();
      await buyerAccountController.updateBuyerAccount({
        user: { role: 'admin', email: STAFF_EMAIL },
        params: { id: 'ba-1' },
        body: { organizationName: 'Nonexistent' },
      }, res404, jest.fn());
      expect(res404.status).toHaveBeenCalledWith(404);

      const nextErr = jest.fn();
      jest.spyOn(storeService, 'updateBuyerAccountDurably').mockRejectedValueOnce(new Error('DB failure'));
      await buyerAccountController.updateBuyerAccount({
        user: { role: 'admin', email: STAFF_EMAIL },
        params: { id: 'ba-1' },
        body: { organizationName: 'Exploding' },
      }, mockRes(), nextErr);
      expect(nextErr).toHaveBeenCalledWith(expect.any(Error));
    });

    test('catches error on deleteBuyerAccount', async () => {
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([buyerAccount()]);
      const nextErr = jest.fn();
      jest.spyOn(storeService, 'deleteBuyerAccountDurably').mockRejectedValueOnce(new Error('Delete crash'));

      await buyerAccountController.deleteBuyerAccount({
        user: { role: 'admin', email: STAFF_EMAIL },
        params: { id: 'ba-1' },
      }, mockRes(), nextErr);
      expect(nextErr).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('getBuyerUploadedVendors branches', () => {
    test('fetches from DB when pool has storage and matches in-memory vendor fallbacks', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(domainQueries, 'getBuyerAccountByIdFromDB').mockResolvedValue({
        id: 'ba-db-1',
        organizationName: 'DB Buyer Corp',
        corporateEmail: 'dbbuyer@test.com',
      });
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([]);
      jest.spyOn(domainQueries, 'getVendorsUploadedByBuyerFromDB').mockResolvedValue([
        { id: 'v-db-1', name: 'Vendor DB', vendorId: 'v-db-1' },
      ]);

      storeService.vendors = [
        null,
        { id: 'v-match-account', buyerAccountId: 'ba-db-1', name: 'Matched By Account ID' },
        { id: 'v-match-email', buyerEmail: 'dbbuyer@test.com', name: 'Matched By Email' },
        { id: 'v-match-company', addedByBuyerCompany: 'DB Buyer Corp', name: 'Matched By Company' },
        { id: 'v-no-match', buyerId: 'other-buyer', name: 'Ignored Vendor' },
      ];

      const res = mockRes();
      await buyerAccountController.getBuyerUploadedVendors({
        user: { role: 'admin', email: STAFF_EMAIL },
        params: { id: 'ba-db-1' },
      }, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        count: expect.any(Number),
      }));
    });

    test('fetches by email when caller is buyer without matched ID', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([]);
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({
        id: 'ba-buyer-role',
        organizationName: 'Buyer Role Org',
        corporateEmail: OWNER_EMAIL,
      });

      const res = mockRes();
      await buyerAccountController.getBuyerUploadedVendors({
        user: { role: 'buyer', email: OWNER_EMAIL },
        params: { id: 'ba-unknown' },
      }, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
      }));
    });
  });

  describe('createBuyerAccount self-registration mirror sync & 409 recovery', () => {
    test('merges into legacy-ID mirror on self-registration sync, falls back to email, and syncs registeredAddress + derived PAN to organization', async () => {
      const buyerProfileQueries = require('../src/db/buyerProfileQueries');
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce({
        id: 'buyer-acc-legacy-99',
        corporateEmail: 'veera@example.com',
        organizationId: null,
      });
      const updateSpy = jest.spyOn(storeService, 'updateBuyerAccountDurably')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'buyer-acc-legacy-99',
          userId: 'u-veera-1',
          organizationId: 'org-veera-1',
          corporateEmail: 'veera@example.com',
          organizationName: 'Veera Solutions Pvt Ltd',
          registeredAddress: '302 Sharada, AECS Layout',
          city: 'Bengaluru',
          state: 'Karnataka',
          zipCode: '560037',
          gstNumber: '27AAACK3921P1Z9',
        });
      const orgSyncSpy = jest.spyOn(buyerProfileQueries, 'updateProfile').mockResolvedValueOnce({ updated: true });
      const res = mockRes();

      await buyerAccountController.createBuyerAccount({
        user: { role: 'buyer', sub: 'u-veera-1', orgId: 'org-veera-1', email: 'veera@example.com' },
        body: {
          organizationName: 'Veera Solutions Pvt Ltd',
          corporateEmail: 'veera@example.com',
          registeredAddress: '302 Sharada, AECS Layout',
          city: 'Bengaluru',
          state: 'Karnataka',
          zipCode: '560037',
          gstNumber: '27AAACK3921P1Z9',
        },
      }, res, jest.fn());

      expect(updateSpy).toHaveBeenNthCalledWith(1, 'buyer-acc-legacy-99', expect.objectContaining({
        userId: 'u-veera-1',
        organizationId: 'org-veera-1',
      }));
      expect(updateSpy).toHaveBeenNthCalledWith(2, 'veera@example.com', expect.objectContaining({
        userId: 'u-veera-1',
        organizationId: 'org-veera-1',
      }));
      expect(orgSyncSpy).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: 'org-veera-1',
        userId: 'u-veera-1',
        patch: expect.objectContaining({
          street: '302 Sharada, AECS Layout',
          pincode: '560037',
          gstNumber: '27AAACK3921P1Z9',
          panNumber: 'AAACK3921P',
        }),
      }));
      expect(res.status).toHaveBeenCalledWith(201);
    });

    test('recovers from 409 BUYER_EMAIL_CONFLICT race during self-registration sync and forwards errors when recovery cannot update', async () => {
      const buyerProfileQueries = require('../src/db/buyerProfileQueries');
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
      const conflictErr = new Error('A buyer account with the email race@example.com already exists.');
      conflictErr.statusCode = 409;
      jest.spyOn(storeService, 'addBuyerAccountDurably').mockRejectedValue(conflictErr);

      // 1. 409 recovery succeeds and logs warning if canonical org sync fails
      jest.spyOn(storeService, 'updateBuyerAccountDurably').mockResolvedValueOnce({
        id: 'buyer-race-1',
        userId: 'u-race-1',
        organizationId: 'org-race-1',
        corporateEmail: 'race@example.com',
        organizationName: 'Race Corp',
        streetAddress: 'Plot 55',
        gstin: '27AAACK3921P1Z9',
      });
      jest.spyOn(buyerProfileQueries, 'updateProfile').mockRejectedValueOnce(new Error('D1 transient'));
      const resOk = mockRes();
      await buyerAccountController.createBuyerAccount({
        user: { role: 'buyer', sub: 'u-race-1', orgId: 'org-race-1', email: 'race@example.com' },
        body: {
          organizationName: 'Race Corp',
          corporateEmail: 'race@example.com',
          streetAddress: 'Plot 55',
          gstin: '27AAACK3921P1Z9',
        },
      }, resOk, jest.fn());
      expect(resOk.status).toHaveBeenCalledWith(201);

      // 2. 409 recovery rejects paid subscriptionPlan
      const resBadPlan = mockRes();
      await buyerAccountController.createBuyerAccount({
        user: { role: 'buyer', sub: 'u-race-1', orgId: 'org-race-1', email: 'race@example.com' },
        body: {
          organizationName: 'Race Corp',
          corporateEmail: 'race@example.com',
          subscriptionPlan: 'version_2',
        },
      }, resBadPlan, jest.fn());
      expect(resBadPlan.status).toHaveBeenCalledWith(400);

      // 3. 409 recovery rethrows if updateBuyerAccountDurably returns null
      jest.spyOn(storeService, 'updateBuyerAccountDurably').mockResolvedValueOnce(null);
      const next = jest.fn();
      await buyerAccountController.createBuyerAccount({
        user: { role: 'buyer', sub: 'u-race-1', orgId: 'org-race-1', email: 'race@example.com' },
        body: {
          organizationName: 'Race Corp',
          corporateEmail: 'race@example.com',
        },
      }, mockRes(), next);
      expect(next).toHaveBeenCalledWith(conflictErr);
    });
  });
});
