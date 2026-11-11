const pool = require('../src/db/pool');
const purchaseOrderQueries = require('../src/db/purchaseOrderQueries');
const purchaseOrderService = require('../src/services/purchaseOrderService');
const { logger } = require('../src/services/loggerService');

function createStore(rfq = {
  id: 'rfq-po-1',
  rfqNumber: 'RFQ-2026-001',
  status: 'Quotes Received',
  quotes: [
    { vendorId: 'vendor-winner', vendorName: 'Winner Co', status: 'Submitted' },
    { vendorId: 'vendor-loser', vendorName: 'Loser Co', status: '' },
  ],
  extractedEntities: [{ itemName: 'Pump', quantity: 2, unit: 'each' }],
  buyerAccountId: 'buyer-1',
}) {
  return {
    rfqs: [rfq],
    auditLogs: [{ shaSignature: 'previous-signature' }],
    activeBuyerAccount: null,
    notifications: [],
    _lastRfqSyncTime: 10,
    _lastRfqSyncMap: new Map([['buyer-1', 10]]),
    getRFQByIdAsync: jest.fn().mockResolvedValue(rfq),
    approvePurchaseOrder: jest.fn().mockReturnValue({ alreadyFinalised: true }),
    notifyBuyer: jest.fn(),
    _buildNotification: jest.fn((notification) => ({ id: 'notification-1', ...notification })),
    _persistNotification: jest.fn(),
  };
}

describe('durable purchase-order approval', () => {
  afterEach(() => jest.restoreAllMocks());

  test('uses the legacy in-memory path only when persistent storage is unconfigured', async () => {
    const store = createStore();
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

    await expect(purchaseOrderService.approvePurchaseOrderDurably(
      store, 'RFQ-2026-001', 'vendor-winner', 'Winner Co', 5000, 'notes', 'buyer@example.com'
    )).resolves.toEqual({ alreadyFinalised: true });
    expect(store.approvePurchaseOrder).toHaveBeenCalledWith(
      'RFQ-2026-001', 'vendor-winner', 'Winner Co', 5000, 'notes', 'buyer@example.com'
    );
  });

  test('returns null for a persisted RFQ that no longer exists', async () => {
    const store = createStore();
    store.rfqs = [];
    store.getRFQByIdAsync.mockResolvedValue(undefined);
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const querySpy = jest.spyOn(purchaseOrderQueries, 'approvePurchaseOrderInDB');

    await expect(purchaseOrderService.approvePurchaseOrderDurably(
      store, 'missing-rfq', 'vendor-1', 'Vendor', 10
    )).resolves.toBeNull();
    expect(querySpy).not.toHaveBeenCalled();
  });

  test('returns an idempotent result for an already finalized persisted RFQ', async () => {
    const rfq = { ...createStore().rfqs[0], status: 'PO Generated', poFinalised: true };
    const store = createStore(rfq);
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

    await expect(purchaseOrderService.approvePurchaseOrderDurably(
      store, rfq.rfqNumber, 'vendor-winner', 'Winner Co', 5000
    )).resolves.toEqual({ alreadyFinalised: true });
    expect(store.approvePurchaseOrder).toHaveBeenCalled();
  });

  test('atomically commits RFQ award and audit before cache updates or notifications', async () => {
    const store = createStore();
    const querySpy = jest.spyOn(purchaseOrderQueries, 'approvePurchaseOrderInDB').mockImplementation(async ({ updates, auditEntry }) => {
      expect(store.rfqs[0].status).toBe('Quotes Received');
      expect(store.notifyBuyer).not.toHaveBeenCalled();
      expect(updates.status).toBe('PO Generated');
      expect(updates.poFinalised).toBe(true);
      expect(updates.quotes[0]).toMatchObject({ status: 'Awarded', awarded: true });
      expect(updates.quotes[1]).toMatchObject({ status: 'Submitted', awarded: false });
      return {
        rfq: { ...store.rfqs[0], ...updates, poNumber: 'PO-2026-001' },
        auditEntry,
      };
    });
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const loggerAuditSpy = jest.spyOn(logger, 'audit').mockImplementation(() => {});

    const response = await purchaseOrderService.approvePurchaseOrderDurably(
      store, 'RFQ-2026-001', 'vendor-winner', 'Winner Co', 5000, 'best quote', 'buyer@example.com'
    );

    expect(response).toMatchObject({
      success: true,
      poNumber: 'PO-2026-001',
      rfqNumber: 'RFQ-2026-001',
      vendorId: 'vendor-winner',
      vendorName: 'Winner Co',
      totalAmount: 5000,
      lineItems: [{ description: 'Pump', quantity: 2, unit: 'each' }],
    });
    expect(store.rfqs[0].status).toBe('PO Generated');
    expect(store.auditLogs[0].shaSignature).toBe(response.shaSignature);
    expect(store._lastRfqSyncTime).toBe(0);
    expect(store._lastRfqSyncMap.size).toBe(0);
    expect(store.notifyBuyer).toHaveBeenCalledWith('buyer-1', expect.objectContaining({ kind: 'po_approved' }));
    expect(store._persistNotification).toHaveBeenCalledWith(expect.objectContaining({ kind: 'po_awarded' }));
    expect(loggerAuditSpy).toHaveBeenCalled();
    expect(querySpy).toHaveBeenCalledWith(expect.objectContaining({ rfqIdOrNumber: 'RFQ-2026-001' }));
  });

  test('finds the cached RFQ by its ID and replaces the cache row by RFQ number', async () => {
    const rfq = createStore().rfqs[0];
    const store = createStore(rfq);
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(purchaseOrderQueries, 'approvePurchaseOrderInDB').mockImplementation(async ({ updates, auditEntry }) => ({
      rfq: { ...rfq, id: 'persisted-rfq-id', ...updates },
      auditEntry,
    }));
    jest.spyOn(logger, 'audit').mockImplementation(() => {});

    const response = await purchaseOrderService.approvePurchaseOrderDurably(
      store, rfq.id, 'vendor-winner', 'Winner Co', 5000, 'notes', 'buyer@example.com'
    );

    expect(response.success).toBe(true);
    expect(store.rfqs).toHaveLength(1);
    expect(store.rfqs[0].id).toBe('persisted-rfq-id');
  });

  test('uses generated PO defaults, active buyer identity, and inserts a refreshed RFQ cache row', async () => {
    const rfq = { ...createStore().rfqs[0], id: 'rfq-empty-number', rfqNumber: '', poNumber: null };
    const store = createStore(rfq);
    store.auditLogs = [];
    store.activeBuyerAccount = { corporateEmail: 'active-buyer@example.com' };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const querySpy = jest.spyOn(purchaseOrderQueries, 'approvePurchaseOrderInDB').mockImplementation(async ({ updates, auditEntry }) => ({
      rfq: { ...rfq, id: 'new-persisted-id', rfqNumber: 'persisted-rfq-number', ...updates },
      auditEntry: { ...auditEntry, userEmail: '' },
    }));
    const auditSpy = jest.spyOn(logger, 'audit').mockImplementation(() => {});

    const response = await purchaseOrderService.approvePurchaseOrderDurably(
      store, '', null, 'Winner Co', 0, ''
    );

    expect(response.poNumber).toBe('PO-2026-');
    expect(querySpy.mock.calls[0][0].auditEntry.userEmail).toBe('active-buyer@example.com');
    expect(querySpy.mock.calls[0][0].auditEntry.previousHash).toBe('');
    expect(store.rfqs[0].id).toBe('new-persisted-id');
    expect(auditSpy).toHaveBeenCalledWith('Formally approved & sealed Pre-Purchase Order PO-2026- awarded to Winner Co (₹0). Notes: ', 'system@procucev.ai', expect.any(Object), '');
  });

  test('supports an RFQ without quotes, award vendor, or line items', async () => {
    const rfq = { id: 'rfq-no-quotes', rfqNumber: 'RFQ-NO-QUOTES', status: 'Open', quotes: null };
    const store = createStore(rfq);
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(purchaseOrderQueries, 'approvePurchaseOrderInDB').mockImplementation(async ({ auditEntry }) => ({
      rfq: { ...rfq, status: 'PO Generated', poFinalised: true },
      auditEntry,
    }));
    jest.spyOn(logger, 'audit').mockImplementation(() => {});

    const response = await purchaseOrderService.approvePurchaseOrderDurably(
      store, rfq.rfqNumber, null, 'Vendor Co', 0
    );
    expect(response.lineItems).toEqual([]);
    expect(response.vendorId).toBeNull();
    expect(store.notifyBuyer).toHaveBeenCalled();
    expect(store._buildNotification).not.toHaveBeenCalled();
  });

  test('returns the winning concurrent approval when its conditional update returns no row', async () => {
    const rfq = createStore().rfqs[0];
    const store = createStore(rfq);
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(purchaseOrderQueries, 'approvePurchaseOrderInDB').mockResolvedValue(null);
    store.getRFQByIdAsync
      .mockResolvedValueOnce(rfq)
      .mockImplementationOnce(async () => {
        store.rfqs[0] = { ...rfq, status: 'PO Generated', poFinalised: true };
      });

    await expect(purchaseOrderService.approvePurchaseOrderDurably(
      store, rfq.rfqNumber, 'vendor-winner', 'Winner Co', 5000
    )).resolves.toEqual({ alreadyFinalised: true });
    expect(store.approvePurchaseOrder).toHaveBeenCalled();
  });

  test('returns null when a conditional update loses but no finalized RFQ can be read', async () => {
    const store = createStore();
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(purchaseOrderQueries, 'approvePurchaseOrderInDB').mockResolvedValue(null);

    await expect(purchaseOrderService.approvePurchaseOrderDurably(
      store, 'RFQ-2026-001', 'vendor-winner', 'Winner Co', 5000
    )).resolves.toBeNull();
  });

  test('wraps failed persistence and never notifies or changes RFQ cache state', async () => {
    const store = createStore();
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(purchaseOrderQueries, 'approvePurchaseOrderInDB').mockRejectedValue(new Error('database unavailable'));
    const loggerSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(purchaseOrderService.approvePurchaseOrderDurably(
      store, 'RFQ-2026-001', 'vendor-winner', 'Winner Co', 5000
    )).rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });
    expect(store.rfqs[0].status).toBe('Quotes Received');
    expect(store.notifyBuyer).not.toHaveBeenCalled();
    expect(loggerSpy).toHaveBeenCalledWith('Failed to save purchase-order approval', expect.any(Object), 'PURCHASE_ORDER');
  });

  test('logs notification failures after a successful durable award', async () => {
    const store = createStore();
    store.notifyBuyer.mockImplementation(() => { throw new Error('buyer notice down'); });
    store._buildNotification.mockImplementation(() => { throw new Error('vendor notice down'); });
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(purchaseOrderQueries, 'approvePurchaseOrderInDB').mockImplementation(async ({ updates, auditEntry }) => ({
      rfq: { ...store.rfqs[0], ...updates },
      auditEntry,
    }));
    const loggerSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    jest.spyOn(logger, 'audit').mockImplementation(() => {});

    await expect(purchaseOrderService.approvePurchaseOrderDurably(
      store, 'RFQ-2026-001', 'vendor-winner', 'Winner Co', 5000
    )).resolves.toMatchObject({ success: true });
    expect(loggerSpy).toHaveBeenCalledTimes(2);
  });
});
