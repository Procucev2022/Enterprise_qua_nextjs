/**
 * @file trialPeriodTimeBased.test.js
 * Comprehensive automated regression test suite for Time-Based Trial Period logic:
 * 1. Approving a 7-day trial sets trialEndDate and canonical fields without adding numeric credits.
 * 2. Active 7-day trial allows unlimited RFQs across any mode (Mode 0, Mode 1, Mode 2, Mode 3) with 0 credit deductions even if remainingFreeRFQs === 0.
 * 3. Expired trial automatically reverts to normal credit/plan enforcement.
 * 4. Normal Buyer Credit Addition (+5 Credits) continues to add numeric credits and deducts 1 per RFQ as expected.
 */

const pool = require('../src/db/pool');
const d1Bridge = require('../src/db/d1Bridge');
const internalTaskQueries = require('../src/db/internalTaskQueries');
const buyerRfqCreationQueries = require('../src/db/buyerRfqCreationQueries');
const domainQueries = require('../src/db/domainQueries');
const storeService = require('../src/services/storeService');
const {
  isTrialActive,
  hasUnlimitedRfqAccess,
  BUYER_TRIAL_TRANSACTION_TYPE,
} = require('../src/config/constants');
const buyerAccountController = require('../src/controllers/buyerAccountController');

function createD1Binding(batchRows) {
  const statements = [];
  const db = {
    prepare: (text) => ({
      bind: (...params) => {
        const statement = { text, params };
        statements.push(statement);
        return statement;
      },
    }),
    batch: jest.fn().mockResolvedValue(batchRows.map((rows) => ({
      results: rows,
      meta: { changes: rows.length },
    }))),
  };
  return { db, statements };
}

function withD1Env(db, run) {
  const previous = globalThis.__CF_ENV__;
  globalThis.__CF_ENV__ = { DB: db };
  return Promise.resolve().then(run).finally(() => {
    if (previous === undefined) delete globalThis.__CF_ENV__;
    else globalThis.__CF_ENV__ = previous;
  });
}

describe('Time-Based Trial Period vs Numeric Credit Addition', () => {
  let originalPool;

  beforeEach(() => {
    originalPool = pool.pool;
  });

  afterEach(() => {
    pool.pool = originalPool;
    jest.restoreAllMocks();
    pool.queryCache.clear();
  });

  describe('isTrialActive & hasUnlimitedRfqAccess helper tests', () => {
    test('returns true when trialEndDate is in the future and trialActive is not false', () => {
      const futureDate = new Date(Date.now() + 7 * 86400000).toISOString();
      const account = {
        id: 'buyer-trial-1',
        trialActive: true,
        trialDays: 7,
        trialStartDate: new Date().toISOString(),
        trialEndDate: futureDate,
      };

      expect(isTrialActive(account)).toBe(true);
      expect(hasUnlimitedRfqAccess(account)).toBe(true);
    });

    test('returns false when trialEndDate is in the past (expired)', () => {
      const pastDate = new Date(Date.now() - 1000).toISOString();
      const account = {
        id: 'buyer-trial-expired',
        trialActive: true,
        trialDays: 7,
        trialEndDate: pastDate,
      };

      expect(isTrialActive(account)).toBe(false);
      expect(hasUnlimitedRfqAccess(account)).toBe(false);
    });

    test('returns false when trialActive is explicitly false even if date is in the future', () => {
      const futureDate = new Date(Date.now() + 7 * 86400000).toISOString();
      const account = {
        id: 'buyer-trial-disabled',
        trialActive: false,
        trialEndDate: futureDate,
      };

      expect(isTrialActive(account)).toBe(false);
      expect(hasUnlimitedRfqAccess(account)).toBe(false);
    });

    test('returns false for null, undefined, invalid account or date', () => {
      expect(isTrialActive(null)).toBe(false);
      expect(isTrialActive(undefined)).toBe(false);
      expect(isTrialActive({})).toBe(false);
      expect(isTrialActive({ trialEndDate: 'not-a-valid-date' })).toBe(false);
    });

    test('correctly unwraps raw JSON string account', () => {
      const futureDate = new Date(Date.now() + 5 * 86400000).toISOString();
      const wrappedAccount = {
        raw: JSON.stringify({
          trialActive: true,
          trialDays: 5,
          trialEndDate: futureDate,
        }),
      };

      expect(isTrialActive(wrappedAccount)).toBe(true);
      expect(hasUnlimitedRfqAccess(wrappedAccount)).toBe(true);
    });
  });

  describe('1. Approving a 7-day Trial Period (Postgres & D1)', () => {
    function mockCreditClient({ lockedRow, buyerRow } = {}) {
      return {
        query: jest.fn(async (sql) => {
          if (sql.includes('FROM internal_tasks WHERE id = $1 FOR UPDATE')) {
            return { rows: lockedRow };
          }
          if (sql.includes('FROM buyer_accounts WHERE id = $1 FOR UPDATE')) {
            return { rows: buyerRow };
          }
          return { rowCount: 1, rows: [] };
        }),
        release: jest.fn(),
      };
    }

    test('approving a 7-day trial sets trialEndDate and does NOT add 7 numeric credits', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const updateBuyerSpy = jest.spyOn(storeService, 'updateBuyerAccount').mockReturnValue({});
      const recordSpy = jest.spyOn(domainQueries, 'recordBuyerCreditTransactionInDB').mockResolvedValue({ id: 'tx-trial-1' });

      const taskRow = {
        id: 'tsk_trial_7',
        task_number: 'TSK-TRIAL-001',
        task_type: 'Trial Periods',
        credit_quantity: 7,
        credit_account_type: 'BUYER',
        credit_account_id: 'buyer_abc_1',
        raw: JSON.stringify({
          request_type: 'Trial Periods',
          duration_days: 7,
          notes: 'Customer requested 7 days free trial',
        }),
        status: 'Pending Approval',
        approval_status: 'PENDING',
      };

      const buyerRow = {
        id: 'buyer_abc_1',
        raw: JSON.stringify({
          creditBalance: 3,
          available_credits: 3,
          remainingFreeRFQs: 3,
        }),
      };

      const client = mockCreditClient({ lockedRow: [taskRow], buyerRow: [buyerRow] });
      pool.pool = { connect: jest.fn().mockResolvedValue(client) };
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ ...taskRow, approval_status: 'APPROVED' }] });

      const approvalRemarks = 'Approved 7 days trial period';
      await internalTaskQueries.approveCreditTask('tsk_trial_7', { id: 'admin-1', name: 'Approver Pavani' }, approvalRemarks);

      // Verify trial transaction recorded with 0 credits added and 0 credits consumed
      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          buyerId: 'buyer_abc_1',
          transactionType: BUYER_TRIAL_TRANSACTION_TYPE,
          creditsAdded: 0,
          creditsConsumed: 0,
          previousBalance: 3,
          updatedBalance: 3, // Balance remains 3, not mutated to 10!
          description: expect.stringContaining('7 Days Unlimited Trial'),
        })
      );

      // Verify storeService updated with canonical trial fields
      expect(updateBuyerSpy).toHaveBeenCalledWith(
        'buyer_abc_1',
        expect.objectContaining({
          trialActive: true,
          trialDays: 7,
          trialStartDate: expect.any(String),
          trialEndDate: expect.any(String),
          subscriptionTier: 'Free_trial',
          trialPeriodDays: 7,
        }),
        { persist: false }
      );

      // Verify trialEndDate is approximately 7 days from now
      const passedUpdate = updateBuyerSpy.mock.calls[0][1];
      const startMs = new Date(passedUpdate.trialStartDate).getTime();
      const endMs = new Date(passedUpdate.trialEndDate).getTime();
      const diffDays = Math.round((endMs - startMs) / 86400000);
      expect(diffDays).toBe(7);

      expect(client.release).toHaveBeenCalled();
    });

    test('Worker D1 approval formats TRIAL_GRANTED with 0 credits added for trial tasks', async () => {
      const taskRowD1 = {
        id: 'tsk_d1_trial',
        task_number: 'TSK-D1-002',
        task_type: 'Trial Periods',
        credit_account_type: 'BUYER',
        credit_account_id: 'buy_d1_trial',
        credit_quantity: 7,
        raw: JSON.stringify({ request_type: 'Trial Periods', duration_days: 7 }),
        status: 'Pending Approval',
        approval_status: 'PENDING',
      };

      const { db, statements } = createD1Binding([
        [{ id: 'tsk_d1_trial' }],
        [{ id: 'buy_d1_trial', raw: JSON.stringify({ creditBalance: 5, remainingFreeRFQs: 5 }) }],
        [{}],
        [{}],
        [{ id: 'tx-d1-trial' }],
        [{ id: 'tsk_d1_trial' }],
      ]);

      await withD1Env(db, async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
        jest.spyOn(pool, 'query').mockImplementation((sql) => {
          if (sql.includes('FROM internal_tasks t')) {
            return Promise.resolve({ rows: [{ ...taskRowD1, approval_status: 'APPROVED' }] });
          }
          if (sql.includes('FROM buyer_accounts WHERE id = $1')) {
            return Promise.resolve({ rows: [{ available_credits: 5 }] });
          }
          return Promise.resolve({ rows: [] });
        });

        await internalTaskQueries.approveCreditTask('tsk_d1_trial', { id: 'admin-1', name: 'Admin' }, 'Approved trial');

        expect(db.batch).toHaveBeenCalledTimes(1);
        const txStmt = statements.find((s) => s.text.includes('INSERT INTO buyer_credit_transactions'));
        expect(txStmt).toBeDefined();
        expect(txStmt.params[1]).toBe('TRIAL_GRANTED');
        expect(txStmt.params[3]).toBe(0); // credits_added = 0
        expect(txStmt.params[4]).toBe(0); // credits_consumed = 0
        expect(txStmt.params[5]).toBe('TRIAL_GRANTED: 7 Days Unlimited Trial');
      });
    });
  });

  describe('2. Active 7-day Trial: Unlimited RFQs across any mode with 0 credit deduction', () => {
    function configurePostgresForRfq(client) {
      pool.pool = {};
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
      jest.spyOn(pool, 'withTransaction').mockImplementation(async (callback) => callback(client));
    }

    test('buyer with active 7-day trial creates multiple RFQs across modes with 0 deductions even with 0 free credits', async () => {
      const futureDate = new Date(Date.now() + 7 * 86400000).toISOString();
      const trialBuyer = {
        id: 'buyer-active-trial-1',
        subscriptionPlan: 'free_trial',
        remainingFreeRFQs: 0, // 0 remaining free credits!
        trialActive: true,
        trialDays: 7,
        trialStartDate: new Date().toISOString(),
        trialEndDate: futureDate,
      };

      // Test across multiple sourcing modes (Mode 0, Mode 1, Mode 2, Mode 3) for 10 sequential RFQs
      const modes = ['mode_0', 'mode_1', 'mode_2', 'mode_3', 'mode_1', 'mode_2', 'mode_3', 'mode_1', 'mode_2', 'mode_3'];

      for (let i = 0; i < modes.length; i++) {
        const sourcingMode = modes[i];
        const rfq = {
          id: `rfq-trial-test-${i + 1}`,
          rfqNumber: `RFQ-TRIAL-${1000 + i}`,
          category: 'Steel Fabrications',
          status: 'Quotes Pending',
          sourcingMode,
          budget: 50000 + i * 1000,
          buyerAccountId: trialBuyer.id,
        };

        const client = {
          query: jest.fn(async (sql) => {
            if (sql.includes('FROM buyer_accounts WHERE id = $1 FOR UPDATE')) {
              return { rows: [{ raw: JSON.stringify(trialBuyer) }], rowCount: 1 };
            }
            if (sql.includes('FROM rfqs WHERE id = $1')) {
              return { rows: [], rowCount: 0 };
            }
            if (sql.includes('INSERT INTO rfqs')) {
              return { rows: [{ raw: JSON.stringify(rfq) }], rowCount: 1 };
            }
            if (sql.includes('FROM buyer_accounts WHERE id = $1')) {
              return { rows: [{ raw: JSON.stringify(trialBuyer) }], rowCount: 1 };
            }
            return { rows: [], rowCount: 1 };
          }),
        };

        configurePostgresForRfq(client);

        const result = await buyerRfqCreationQueries.createRFQWithCreditInDB({
          rfq,
          buyerId: trialBuyer.id,
        });

        expect(result).toBeDefined();
        expect(result.success).toBe(true);
        expect(result.rfq).toBeDefined();
        // Crucial: 0 credits charged!
        expect(result.shouldCharge).toBe(false);
        expect(result.credit.consumed).toBe(false);
        expect(result.credit.remaining).toBe(0);
        expect(result.credit.transaction).toBeNull();
      }
    });
  });

  describe('3. Expired Trial Period Reverts to Normal Quota Enforcement', () => {
    function configurePostgresForRfq(client) {
      pool.pool = {};
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
      jest.spyOn(pool, 'withTransaction').mockImplementation(async (callback) => callback(client));
    }

    test('expired trial buyer with remainingFreeRFQs = 0 is blocked for Mode 1 RFQ', async () => {
      const pastDate = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      const expiredBuyer = {
        id: 'buyer-expired-trial',
        subscriptionPlan: 'free_trial',
        remainingFreeRFQs: 0,
        trialActive: true,
        trialDays: 7,
        trialStartDate: new Date(Date.now() - 8 * 86400000).toISOString(),
        trialEndDate: pastDate,
      };

      const rfq = {
        id: 'rfq-blocked-1',
        rfqNumber: 'RFQ-BLOCKED-1',
        category: 'Electronics',
        status: 'Quotes Pending',
        sourcingMode: 'mode_1',
        budget: 20000,
        buyerAccountId: expiredBuyer.id,
      };

      const client = {
        query: jest.fn(async (sql) => {
          if (sql.includes('FROM buyer_accounts WHERE id = $1 FOR UPDATE')) {
            return { rows: [{ raw: JSON.stringify(expiredBuyer) }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }),
      };

      configurePostgresForRfq(client);

      const result = await buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: expiredBuyer.id });
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.creditsExhausted).toBe(true);
      expect(result.remaining).toBe(0);
    });

    test('expired trial buyer with remainingFreeRFQs = 3 charges 1 credit for Mode 1 RFQ', async () => {
      const pastDate = new Date(Date.now() - 3600000).toISOString();
      const expiredBuyer = {
        id: 'buyer-expired-with-credits',
        subscriptionPlan: 'free_trial',
        remainingFreeRFQs: 3,
        trialActive: true,
        trialDays: 7,
        trialEndDate: pastDate,
      };

      const rfq = {
        id: 'rfq-charge-1',
        rfqNumber: 'RFQ-CHARGE-1',
        category: 'Electronics',
        status: 'Quotes Pending',
        sourcingMode: 'mode_1',
        budget: 20000,
        buyerAccountId: expiredBuyer.id,
      };

      const client = {
        query: jest.fn(async (sql) => {
          if (sql.includes('FROM buyer_accounts WHERE id = $1 FOR UPDATE')) {
            return { rows: [{ raw: JSON.stringify(expiredBuyer) }], rowCount: 1 };
          }
          if (sql.includes('FROM rfqs WHERE id = $1')) {
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes('UPDATE buyer_accounts')) {
            return { rows: [{ raw: JSON.stringify({ ...expiredBuyer, remainingFreeRFQs: 2 }) }], rowCount: 1 };
          }
          if (sql.includes('INSERT INTO rfqs')) {
            return { rows: [{ raw: JSON.stringify(rfq) }], rowCount: 1 };
          }
          if (sql.includes('INSERT INTO buyer_credit_transactions')) {
            return {
              rows: [{
                id: 'tx-charge-1',
                transaction_type: 'RFQ_CREATE',
                credits_consumed: 1,
                previous_balance: 3,
                updated_balance: 2,
              }],
              rowCount: 1,
            };
          }
          if (sql.includes('FROM buyer_accounts WHERE id = $1')) {
            return { rows: [{ raw: JSON.stringify({ ...expiredBuyer, remainingFreeRFQs: 2 }) }], rowCount: 1 };
          }
          return { rows: [], rowCount: 1 };
        }),
      };

      configurePostgresForRfq(client);

      const result = await buyerRfqCreationQueries.createRFQWithCreditInDB({
        rfq,
        buyerId: expiredBuyer.id,
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.shouldCharge).toBe(true);
      expect(result.credit.consumed).toBe(true);
      expect(result.credit.remaining).toBe(2);
      expect(result.credit.transaction).toBeDefined();
    });
  });

  describe('4. Normal Buyer Credit Addition (+5 Credits) continues to work', () => {
    function mockCreditClient({ lockedRow, buyerRow } = {}) {
      return {
        query: jest.fn(async (sql) => {
          if (sql.includes('FROM internal_tasks WHERE id = $1 FOR UPDATE')) {
            return { rows: lockedRow };
          }
          if (sql.includes('FROM buyer_accounts WHERE id = $1 FOR UPDATE')) {
            return { rows: buyerRow };
          }
          return { rowCount: 1, rows: [] };
        }),
        release: jest.fn(),
      };
    }

    test('approving normal credit addition task adds numeric credits', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const updateBuyerSpy = jest.spyOn(storeService, 'updateBuyerAccount').mockReturnValue({});
      const recordSpy = jest.spyOn(domainQueries, 'recordBuyerCreditTransactionInDB').mockResolvedValue({ id: 'tx-add-5' });

      const taskRow = {
        id: 'tsk_credit_add_5',
        task_number: 'TSK-CREDIT-005',
        task_type: 'Credit Addition',
        credit_quantity: 5,
        credit_account_type: 'BUYER',
        credit_account_id: 'buyer_credit_test',
        raw: JSON.stringify({
          request_type: 'Buyer Credit Addition: +5 Credits',
        }),
        status: 'Pending Approval',
        approval_status: 'PENDING',
      };

      const buyerRow = {
        id: 'buyer_credit_test',
        raw: JSON.stringify({
          creditBalance: 10,
          available_credits: 10,
          remainingFreeRFQs: 10,
        }),
      };

      const client = mockCreditClient({ lockedRow: [taskRow], buyerRow: [buyerRow] });
      pool.pool = { connect: jest.fn().mockResolvedValue(client) };
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ ...taskRow, approval_status: 'APPROVED' }] });

      await internalTaskQueries.approveCreditTask('tsk_credit_add_5', { id: 'admin-1', name: 'Approver' }, 'Approved 5 credits');

      // Verify numeric credits added: 10 + 5 = 15
      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          buyerId: 'buyer_credit_test',
          transactionType: 'Admin Credit Addition',
          creditsAdded: 5,
          creditsConsumed: 0,
          previousBalance: 10,
          updatedBalance: 15,
        })
      );

      expect(updateBuyerSpy).toHaveBeenCalledWith(
        'buyer_credit_test',
        expect.objectContaining({
          creditBalance: 15,
          available_credits: 15,
        }),
        { persist: false }
      );
    });
  });

  describe('5. getCreditHistory includes trial fields and skips missing RFQ debit during active trial', () => {
    test('returns trial summary fields and does not synthesize deductions for RFQs created during trial', async () => {
      const trialStart = new Date(Date.now() - 2 * 86400000).toISOString();
      const trialEnd = new Date(Date.now() + 5 * 86400000).toISOString();
      const trialBuyer = {
        id: 'buyer-history-trial',
        companyName: 'Trial Co',
        corporateEmail: 'trial@co.com',
        remainingFreeRFQs: 5,
        trialActive: true,
        trialDays: 7,
        trialStartDate: trialStart,
        trialEndDate: trialEnd,
      };

      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([trialBuyer]);
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(domainQueries, 'getBuyerAccountByIdFromDB').mockResolvedValue(trialBuyer);

      // Mock credit transactions: only TRIAL_GRANTED, no RFQ_CREATE
      jest.spyOn(domainQueries, 'getBuyerCreditTransactionsFromDB').mockResolvedValue([
        {
          id: 'tx-trial-init',
          buyer_id: 'buyer-history-trial',
          transaction_type: 'TRIAL_GRANTED',
          credits_added: 0,
          credits_consumed: 0,
          created_at: trialStart,
          description: 'TRIAL_GRANTED: 7 Days Unlimited Trial',
        },
      ]);

      // Mock RFQ created during active trial
      jest.spyOn(domainQueries, 'getRFQsFromDB').mockResolvedValue([
        {
          id: 'rfq-during-trial',
          sourcing_mode: 'mode_1',
          created_at: new Date(Date.now() - 86400000).toISOString(),
        },
      ]);

      const req = { params: { id: 'buyer-history-trial' }, user: { id: 'buyer-history-trial', role: 'admin' } };
      let jsonResult = null;
      let statusResult = 200;
      const res = {
        status: jest.fn((code) => {
          statusResult = code;
          return res;
        }),
        json: jest.fn((data) => {
          jsonResult = data;
          return res;
        }),
      };

      await buyerAccountController.getCreditHistory(req, res);

      expect(statusResult).toBe(200);
      expect(jsonResult).toBeDefined();
      expect(jsonResult.summary).toEqual(
        expect.objectContaining({
          trialActive: true,
          trialDays: 7,
          trialStartDate: trialStart,
          trialEndDate: trialEnd,
        })
      );

      // Verify no synthetic RFQ_CREATE transaction was generated because the RFQ was created during active trial
      const rfqTransactions = jsonResult.transactions.filter((t) => t.transactionType === 'RFQ_CREATE');
      expect(rfqTransactions.length).toBe(0);
    });
  });
});
