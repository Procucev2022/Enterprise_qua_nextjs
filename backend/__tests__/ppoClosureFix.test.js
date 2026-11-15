'use strict';

const storeService = require('../src/services/storeService');
const rfqController = require('../src/controllers/rfqController');
const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');

describe('PPO Generation and 48-Hour Closure Fix Tests', () => {
  beforeEach(() => {
    // Reset store RFQs
    storeService.rfqs = [];
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    jest.spyOn(storeService, 'notifyOfRFQClosure').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  test('auto-close does not revert a PO Generated RFQ even if created > 48h ago', async () => {
    const fortyNineHoursAgo = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
    const rfqPO = {
      id: 'rfq-po-test-1',
      rfqNumber: 'RFQ-2026-PO01',
      title: 'Pumps Requisition',
      createdAt: fortyNineHoursAgo,
      status: 'PO Generated',
      poFinalised: true,
      poNumber: 'PO-2026-PO01',
      awardedVendor: 'Apex Industrial',
      awardedAmount: 150000,
    };
    storeService.rfqs = [rfqPO];

    const closed = await storeService.closeExpiredRFQsDurably();
    expect(closed).toEqual([]);
    expect(storeService.rfqs[0].status).toBe('PO Generated');
    expect(storeService.rfqs[0].poFinalised).toBe(true);
  });

  test('auto-close does not revert an RFQ with poNumber or poFinalised even if status was set to another non-closed state', async () => {
    const fiftyHoursAgo = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString();
    const rfqPO = {
      id: 'rfq-po-test-2',
      rfqNumber: 'RFQ-2026-PO02',
      title: 'Valves Requisition',
      createdAt: fiftyHoursAgo,
      status: 'In Evaluation',
      poFinalised: true,
      poNumber: 'PO-2026-PO02',
    };
    storeService.rfqs = [rfqPO];

    const closed = await storeService.closeExpiredRFQsDurably();
    expect(closed).toEqual([]);
    expect(storeService.rfqs[0].status).toBe('In Evaluation');
  });

  test('auto-close does not close an Expired RFQ', async () => {
    const fiftyHoursAgo = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString();
    const rfqExpired = {
      id: 'rfq-exp-test-1',
      rfqNumber: 'RFQ-2026-EXP01',
      title: 'Expired Requisition',
      createdAt: fiftyHoursAgo,
      status: 'Expired',
    };
    storeService.rfqs = [rfqExpired];

    const closed = await storeService.closeExpiredRFQsDurably();
    expect(closed).toEqual([]);
    expect(storeService.rfqs[0].status).toBe('Expired');
  });

  test('auto-close closes normal open RFQs older than 48 hours in memory-only mode', async () => {
    const fiftyHoursAgo = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString();
    const openRfq = {
      id: 'rfq-open-test-1',
      rfqNumber: 'RFQ-2026-OPEN01',
      title: 'Open Requisition',
      createdAt: fiftyHoursAgo,
      status: 'In Evaluation',
    };
    storeService.rfqs = [openRfq];

    const closed = await storeService.closeExpiredRFQsDurably();
    expect(closed.length).toBe(1);
    expect(storeService.rfqs[0].status).toBe('Closed');
    expect(storeService.notifyOfRFQClosure).toHaveBeenCalledWith(closed[0]);
  });

  test('memory-only auto-close ignores null and invalid-date cache entries', async () => {
    storeService.rfqs = [null, { id: 'rfq-invalid-date', createdAt: 'not-a-date', status: 'Open' }];
    await expect(storeService.closeExpiredRFQsDurably()).resolves.toEqual([]);
    await expect(storeService.closeExpiredRFQsDurably('invalid-time')).rejects.toThrow(TypeError);
  });

  test('RFQ reads do not trigger closure mutations or notifications', () => {
    const oldOpenRfq = {
      id: 'rfq-read-purity',
      rfqNumber: 'RFQ-READ-PURITY',
      createdAt: new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(),
      status: 'In Evaluation',
    };
    storeService.rfqs = [oldOpenRfq];

    expect(storeService.getRFQs()[0].status).toBe('In Evaluation');
    expect(storeService.getRFQById(oldOpenRfq.id).status).toBe('In Evaluation');
    expect(storeService.notifyOfRFQClosure).not.toHaveBeenCalled();
  });

  test('durable closure updates storage before changing cache and notifying', async () => {
    const dueRfq = {
      id: 'rfq-durable-close',
      rfqNumber: 'RFQ-DURABLE-CLOSE',
      status: 'Closed',
      createdAt: new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(),
    };
    storeService.rfqs = [{ ...dueRfq, id: 'stale-cache-id', status: 'In Evaluation' }];
    pool.hasStorage.mockReturnValue(true);
    const closeSpy = jest.spyOn(domainQueries, 'closeExpiredRFQsInDB').mockImplementation(async () => {
      expect(storeService.rfqs[0].status).toBe('In Evaluation');
      expect(storeService.notifyOfRFQClosure).not.toHaveBeenCalled();
      return [dueRfq];
    });

    await expect(storeService.closeExpiredRFQsDurably()).resolves.toEqual([dueRfq]);
    expect(storeService.rfqs[0]).toEqual(dueRfq);
    expect(storeService.notifyOfRFQClosure).toHaveBeenCalledWith(dueRfq);
    expect(closeSpy).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.any(String));
  });

  test('failed durable closure leaves cached status and notifications untouched', async () => {
    const dueRfq = {
      id: 'rfq-durable-close-failure',
      rfqNumber: 'RFQ-DURABLE-CLOSE-FAIL',
      status: 'In Evaluation',
      createdAt: new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(),
    };
    storeService.rfqs = [dueRfq];
    pool.hasStorage.mockReturnValue(true);
    jest.spyOn(domainQueries, 'closeExpiredRFQsInDB').mockRejectedValue(new Error('database unavailable'));

    await expect(storeService.closeExpiredRFQsDurably()).rejects.toThrow('database unavailable');
    expect(storeService.rfqs[0]).toBe(dueRfq);
    expect(storeService.notifyOfRFQClosure).not.toHaveBeenCalled();
  });

  test('persisted closures absent from cache still notify and notification errors are logged', async () => {
    const dueRfq = { id: 'rfq-not-cached', rfqNumber: 'RFQ-NOT-CACHED', status: 'Closed' };
    pool.hasStorage.mockReturnValue(true);
    jest.spyOn(domainQueries, 'closeExpiredRFQsInDB').mockResolvedValue([dueRfq]);
    storeService.notifyOfRFQClosure.mockImplementation(() => { throw new Error('notification failed'); });

    await expect(storeService.closeExpiredRFQsDurably()).resolves.toEqual([dueRfq]);
    expect(storeService.rfqs).toEqual([]);
    expect(storeService.notifyOfRFQClosure).toHaveBeenCalledWith(dueRfq);
  });

  test('getRFQs heals an RFQ with poFinalised or poNumber that was erroneously set to Closed', () => {
    const rfqCorrupted = {
      id: 'rfq-corrupted-1',
      rfqNumber: 'RFQ-2026-CORR01',
      title: 'Corrupted Requisition',
      createdAt: new Date().toISOString(),
      status: 'Closed',
      poFinalised: true,
      poNumber: 'PO-2026-CORR01',
      awardedVendor: 'Apex Industrial',
      awardedAmount: 200000,
    };
    storeService.rfqs = [rfqCorrupted];

    const rfqs = storeService.getRFQs();
    expect(rfqs[0].status).toBe('PO Generated');
    expect(rfqs[0].poFinalised).toBe(true);
  });

  test('getRFQById heals an RFQ with poFinalised or poNumber that was erroneously set to Closed', () => {
    const rfqCorrupted = {
      id: 'rfq-corrupted-2',
      rfqNumber: 'RFQ-2026-CORR02',
      title: 'Corrupted Requisition 2',
      createdAt: new Date().toISOString(),
      status: 'Closed',
      poFinalised: true,
      poNumber: 'PO-2026-CORR02',
    };
    storeService.rfqs = [rfqCorrupted];

    const rfq = storeService.getRFQById('rfq-corrupted-2');
    expect(rfq).toBeDefined();
    expect(rfq.status).toBe('PO Generated');
    expect(rfq.poFinalised).toBe(true);
  });

  test('isWithin48HourWindow returns false for PO Generated or poFinalised RFQs', () => {
    const recent = new Date().toISOString();
    const rfqPO = {
      id: 'rfq-po-3',
      rfqNumber: 'RFQ-2026-PO03',
      createdAt: recent,
      status: 'PO Generated',
      poFinalised: true,
    };
    expect(storeService.isWithin48HourWindow(rfqPO)).toBe(false);

    const rfqPOByNumber = {
      id: 'rfq-po-4',
      rfqNumber: 'RFQ-2026-PO04',
      createdAt: recent,
      status: 'In Evaluation',
      poNumber: 'PO-2026-PO04',
    };
    expect(storeService.isWithin48HourWindow(rfqPOByNumber)).toBe(false);

    const rfqExpired = {
      id: 'rfq-exp-2',
      rfqNumber: 'RFQ-2026-EXP02',
      createdAt: recent,
      status: 'Expired',
    };
    expect(storeService.isWithin48HourWindow(rfqExpired)).toBe(false);
  });

  test('rfqController masking helper treats PO Generated as concluded', async () => {
    const recent = new Date().toISOString();
    const rfqPO = {
      id: 'rfq-po-ctrl',
      rfqNumber: 'RFQ-2026-POCTRL',
      createdAt: recent,
      status: 'PO Generated',
      buyerAccountId: 'buyer-1',
      poFinalised: true,
      quotes: [{ id: 'q-1', vendorId: 'v-1', price: 100 }],
    };
    storeService.rfqs = [rfqPO];
    const req = { user: { role: 'buyer', id: 'b-1', email: 'buyer@test.com', buyerAccountId: 'buyer-1' }, query: {} };
    const res = { json: jest.fn() };
    const next = jest.fn();

    jest.spyOn(storeService, 'syncRFQsFromDB').mockResolvedValue([rfqPO]);
    jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue({ id: 'buyer-1' });
    await rfqController.getRFQs(req, res, next);
    expect(res.json).toHaveBeenCalled();
    const returned = res.json.mock.calls[0][0];
    expect(returned.data[0].quotesHidden).toBe(false);
  });
});
