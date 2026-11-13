const storeService = require('../src/services/storeService');
const vendorController = require('../src/controllers/vendorController');
const { logger } = require('../src/services/loggerService');

const STATUTORY_CHANGES = {
  gst: '29AAMCP4349L1Z0',
  gstin: '29AAMCP4349L1Z0',
  pan: 'ABCPE1234F',
  msme: 'UDYAM-KA-01-0000001',
  annualTurnover: '10 - 50 Cr',
};

const BUYER = { role: 'buyer', email: 'buyer@acme.test' };

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function buyerOwnedVendor() {
  return {
    id: 'v-hist-1',
    name: 'Veera Solutions Pvt LTD',
    email: 'veerababu.v@procucev.com',
    buyerId: 'buyer-1',
    source: 'buyer_uploaded',
  };
}

describe('vendor update: statutory identifiers are locked to the buyer', () => {
  let update;
  let next;

  beforeEach(() => {
    next = jest.fn();
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({ id: 'buyer-1', organizationName: 'Acme Ltd' });
    update = jest.spyOn(storeService, 'updateVendorDurably').mockImplementation(async (id, changes) => ({ id, ...changes }));
    jest.spyOn(logger, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function givenVendor(vendor) {
    jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(vendor);
  }

  test('drops statutory changes from a buyer edit and keeps the other fields', async () => {
    givenVendor(buyerOwnedVendor());
    const res = mockRes();

    await vendorController.updateVendor(
      { params: { id: 'v-hist-1' }, body: { contactPerson: 'Asha Rao', ...STATUTORY_CHANGES }, user: BUYER },
      res,
      next
    );

    expect(update).toHaveBeenCalledWith('v-hist-1', { contactPerson: 'Asha Rao' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(next).not.toHaveBeenCalled();
  });

  test('reports which locked fields a buyer edit dropped', async () => {
    givenVendor(buyerOwnedVendor());

    await vendorController.updateVendor(
      { params: { id: 'v-hist-1' }, body: { gst: STATUTORY_CHANGES.gst, pan: STATUTORY_CHANGES.pan }, user: BUYER },
      mockRes(),
      next
    );

    expect(logger.info).toHaveBeenCalledWith(
      'Ignored buyer changes to locked statutory fields on vendor v-hist-1',
      { id: 'v-hist-1', droppedFields: ['gst', 'pan'] },
      'VENDOR_CONTROLLER'
    );
    expect(update).toHaveBeenCalledWith('v-hist-1', {});
  });

  test('does not report a buyer edit that carries no locked field', async () => {
    givenVendor(buyerOwnedVendor());

    await vendorController.updateVendor(
      { params: { id: 'v-hist-1' }, body: { phone: '+91 9000000000' }, user: BUYER },
      mockRes(),
      next
    );

    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining('locked statutory fields'),
      expect.anything(),
      expect.anything()
    );
    expect(update).toHaveBeenCalledWith('v-hist-1', { phone: '+91 9000000000' });
  });

  test('treats a buyer edit with no body as an empty change', async () => {
    givenVendor(buyerOwnedVendor());

    await vendorController.updateVendor(
      { params: { id: 'v-hist-1' }, body: undefined, user: BUYER },
      mockRes(),
      next
    );

    expect(update).toHaveBeenCalledWith('v-hist-1', {});
  });

  test('keeps statutory changes when the supplier edits its own record', async () => {
    givenVendor({ id: 'vendor-self-1', name: 'Supplier Co', email: 'supplier@example.test', source: 'self_registration' });

    await vendorController.updateVendor(
      {
        params: { id: 'vendor-self-1' },
        body: { pan: STATUTORY_CHANGES.pan, gst: STATUTORY_CHANGES.gst },
        user: { role: 'vendor', email: 'supplier@example.test' },
      },
      mockRes(),
      next
    );

    expect(update).toHaveBeenCalledWith('vendor-self-1', { pan: STATUTORY_CHANGES.pan, gst: STATUTORY_CHANGES.gst });
  });

  test('keeps statutory changes when an admin edits the record', async () => {
    givenVendor(buyerOwnedVendor());

    await vendorController.updateVendor(
      { params: { id: 'v-hist-1' }, body: { ...STATUTORY_CHANGES }, user: { role: 'admin', email: 'admin@procucev.com' } },
      mockRes(),
      next
    );

    expect(update).toHaveBeenCalledWith('v-hist-1', STATUTORY_CHANGES);
  });
});
