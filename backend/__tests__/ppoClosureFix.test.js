'use strict';

const storeService = require('../src/services/storeService');
const rfqController = require('../src/controllers/rfqController');

describe('PPO Generation and 48-Hour Closure Fix Tests', () => {
  beforeEach(() => {
    // Reset store RFQs
    storeService.rfqs = [];
  });

  test('checkAndClose48HourRFQs does not revert a PO Generated RFQ to Closed even if created > 48h ago', () => {
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

    const closed = storeService.checkAndClose48HourRFQs();
    expect(closed).toEqual([]);
    expect(storeService.rfqs[0].status).toBe('PO Generated');
    expect(storeService.rfqs[0].poFinalised).toBe(true);
  });

  test('checkAndClose48HourRFQs does not revert an RFQ with poNumber or poFinalised even if status was set to another non-closed state', () => {
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

    const closed = storeService.checkAndClose48HourRFQs();
    expect(closed).toEqual([]);
    expect(storeService.rfqs[0].status).toBe('In Evaluation');
  });

  test('checkAndClose48HourRFQs does not close an Expired RFQ', () => {
    const fiftyHoursAgo = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString();
    const rfqExpired = {
      id: 'rfq-exp-test-1',
      rfqNumber: 'RFQ-2026-EXP01',
      title: 'Expired Requisition',
      createdAt: fiftyHoursAgo,
      status: 'Expired',
    };
    storeService.rfqs = [rfqExpired];

    const closed = storeService.checkAndClose48HourRFQs();
    expect(closed).toEqual([]);
    expect(storeService.rfqs[0].status).toBe('Expired');
  });

  test('checkAndClose48HourRFQs still closes normal open RFQs older than 48 hours', () => {
    const fiftyHoursAgo = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString();
    const openRfq = {
      id: 'rfq-open-test-1',
      rfqNumber: 'RFQ-2026-OPEN01',
      title: 'Open Requisition',
      createdAt: fiftyHoursAgo,
      status: 'In Evaluation',
    };
    storeService.rfqs = [openRfq];

    const closed = storeService.checkAndClose48HourRFQs();
    expect(closed.length).toBe(1);
    expect(storeService.rfqs[0].status).toBe('Closed');
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
