describe('store service durable purchase-order wrapper', () => {
  test('forwards the approval payload and store context to the purchase-order service', async () => {
    const approvePurchaseOrderDurably = jest.fn().mockResolvedValue({ success: true, poNumber: 'PO-1' });
    let freshStore;
    jest.isolateModules(() => {
      jest.doMock('../src/services/purchaseOrderService', () => ({ approvePurchaseOrderDurably }));
      freshStore = require('../src/services/storeService');
    });

    await expect(freshStore.approvePurchaseOrderDurably(
      'RFQ-1', 'vendor-1', 'Vendor One', 1200, 'approved', 'buyer@example.test'
    )).resolves.toEqual({ success: true, poNumber: 'PO-1' });
    expect(approvePurchaseOrderDurably).toHaveBeenCalledWith(
      freshStore, 'RFQ-1', 'vendor-1', 'Vendor One', 1200, 'approved', 'buyer@example.test'
    );
  });
});
