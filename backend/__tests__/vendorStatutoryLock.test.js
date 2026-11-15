const storeService = require('../src/services/storeService');
const vendorController = require('../src/controllers/vendorController');
const { logger } = require('../src/services/loggerService');

const { PAN_MESSAGE, DUMMY_PAN_MESSAGE } = require('../src/config/validationSchemas');

const STATUTORY_CHANGES = {
  gst: '29AAMCP4349L1Z0',
  gstin: '29AAMCP4349L1Z0',
  pan: 'AAMCP4349L',
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

  test('rejects dummy placeholder PANs when a vendor or admin updates a profile', async () => {
    givenVendor({ id: 'vendor-self-1', name: 'Supplier Co', email: 'supplier@example.test', source: 'self_registration' });
    const res = mockRes();

    await vendorController.updateVendor(
      {
        params: { id: 'vendor-self-1' },
        body: { pan: 'abcpe1234f', gst: STATUTORY_CHANGES.gst },
        user: { role: 'vendor', email: 'supplier@example.test' },
      },
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: DUMMY_PAN_MESSAGE });
    expect(update).not.toHaveBeenCalled();
  });

  test('rejects invalid non-empty PAN formats and ignores blank PAN strings on update', async () => {
    givenVendor({ id: 'vendor-self-1', name: 'Supplier Co', email: 'supplier@example.test', source: 'self_registration' });
    const invalidRes = mockRes();

    await vendorController.updateVendor(
      {
        params: { id: 'vendor-self-1' },
        body: { pan: 'BADPAN' },
        user: { role: 'vendor', email: 'supplier@example.test' },
      },
      invalidRes,
      next
    );

    expect(invalidRes.status).toHaveBeenCalledWith(400);
    expect(invalidRes.json).toHaveBeenCalledWith({ success: false, error: PAN_MESSAGE });
    expect(update).not.toHaveBeenCalled();

    const blankRes = mockRes();
    await vendorController.updateVendor(
      {
        params: { id: 'vendor-self-1' },
        body: { name: 'Supplier Co Updated', pan: '   ' },
        user: { role: 'vendor', email: 'supplier@example.test' },
      },
      blankRes,
      next
    );

    expect(update).toHaveBeenCalledWith('vendor-self-1', { name: 'Supplier Co Updated' });
  });

  test('strips dummy PANs when reading a vendor profile and blocks dummy PANs on vendor self-create', async () => {
    jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue({
      id: 'v-veera-1',
      name: 'Veera Solutions Pvt LTD',
      email: 'veerababu@example.test',
      gst: '29AAMCP4349L1Z0',
      pan: 'ABCPE1234F',
      raw: { id: 'v-veera-1', pan: 'ABCPE1234F', panNumber: 'ABCDE1234F' },
    });

    const getRes = mockRes();
    await vendorController.getVendorById(
      { params: { id: 'v-veera-1' }, user: { role: 'vendor', email: 'veerababu@example.test' } },
      getRes,
      next
    );

    expect(getRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.not.objectContaining({ pan: 'ABCPE1234F' }),
      })
    );
    const returned = getRes.json.mock.calls[0][0].data;
    expect(returned.pan).toBeUndefined();
    expect(returned.raw.pan).toBeUndefined();
    expect(returned.raw.panNumber).toBeUndefined();

    const createRes = mockRes();
    await vendorController.createVendor(
      {
        body: { name: 'Veera Solutions Pvt LTD', majorCategory: 'Engineering', pan: 'ABCPE1234F' },
        user: { role: 'vendor', email: 'veerababu@example.test' },
      },
      createRes,
      next
    );
    expect(createRes.status).toHaveBeenCalledWith(400);
    expect(createRes.json).toHaveBeenCalledWith({ success: false, error: DUMMY_PAN_MESSAGE });
  });
});
