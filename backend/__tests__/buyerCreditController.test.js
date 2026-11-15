const buyerAccountController = require('../src/controllers/buyerAccountController');
const storeService = require('../src/services/storeService');

describe('buyer credit allocation controller', () => {
  const buyer = {
    id: 'buyer-credit-controller',
    organizationName: 'Credit Controller Buyer',
    corporateEmail: 'buyer@example.com',
    remainingFreeRFQs: 4,
  };

  beforeEach(() => {
    jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([buyer]);
    jest.spyOn(storeService, 'addAuditLog').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('uses the caller idempotency key and audits only a newly committed allocation', async () => {
    const key = 'b714f6d8-83a1-4f34-9d89-72ebddb1186d';
    const tx = { id: 'credit-ledger-1', idempotencyKey: key };
    jest.spyOn(storeService, 'addBuyerCreditsDurably').mockResolvedValue({
      account: { ...buyer, remainingFreeRFQs: 9 },
      previousBalance: 4,
      updatedBalance: 9,
      transaction: tx,
      replayed: false,
    });
    const req = {
      user: { role: 'admin', email: 'admin@example.com' },
      params: { id: buyer.id },
      headers: { 'idempotency-key': key },
      body: { amount: 5, reason: 'Manual allocation' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await buyerAccountController.addCredit(req, res, next);

    expect(storeService.addBuyerCreditsDurably).toHaveBeenCalledWith(
      buyer.id,
      5,
      expect.objectContaining({ idempotencyKey: key, creditsAdded: 5 })
    );
    expect(storeService.addAuditLog).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ previousBalance: 4, updatedBalance: 9, replayed: false }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('does not duplicate audit entries for an idempotent replay', async () => {
    const key = 'b714f6d8-83a1-4f34-9d89-72ebddb1186d';
    jest.spyOn(storeService, 'addBuyerCreditsDurably').mockResolvedValue({
      account: { ...buyer, remainingFreeRFQs: 9 },
      previousBalance: 4,
      updatedBalance: 9,
      transaction: { id: 'credit-ledger-1', idempotencyKey: key },
      replayed: true,
    });
    const req = {
      user: { role: 'admin', email: 'admin@example.com' },
      params: { id: buyer.id },
      headers: { 'idempotency-key': key },
      body: { amount: 5, reason: 'Manual allocation' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await buyerAccountController.addCredit(req, res, jest.fn());

    expect(storeService.addAuditLog).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ replayed: true }),
    }));
  });
});
