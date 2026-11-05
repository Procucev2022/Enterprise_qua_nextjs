const pool = require('../src/db/pool');
const rfqController = require('../src/controllers/rfqController');
const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const rfqSummaryService = require('../src/services/rfqSummaryService');

function createResponse() {
  return {
    statusCode: 200,
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    },
  };
}

describe('RFQ creation acknowledgement persistence', () => {
  afterEach(() => jest.restoreAllMocks());

  test('persists the session recipient and relies on the outbox when storage is configured', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const buyer = {
      id: 'buyer-ack-1',
      corporateEmail: 'buyer@example.test',
      organizationName: 'Buyer Co',
      subscriptionPlan: 'version_1',
    };
    jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue(buyer);
    const rfq = {
      id: 'rfq-ack-controller-1',
      rfqNumber: 'RFQ-ACK-CONTROLLER-1',
      title: 'Hydraulic pump',
      category: 'Pumps & Motors',
      sourcingMode: 'mode_1',
      procucevVendorCount: 0,
      assignedVendors: [],
      extractedEntities: [],
    };
    const createSpy = jest.spyOn(storeService, 'createRFQDurably').mockResolvedValue(rfq);
    jest.spyOn(storeService, 'resolveProcucevVendorCountFromDB').mockResolvedValue(0);
    jest.spyOn(rfqSummaryService, 'buildRFQSummary').mockResolvedValue({ summary: 'Pump requirement' });
    const emailSpy = jest.spyOn(mailerService, 'sendRfqAcknowledgementEmail').mockResolvedValue({ sent: true });
    const res = createResponse();

    await rfqController.createRFQ({
      body: {
        title: 'Hydraulic pump',
        category: 'Pumps & Motors',
        sourcingMode: 'mode_1',
        budget: 1000,
        targetDeliveryDate: '2099-01-01',
        deliveryLocation: 'Mumbai',
        deliveryPincode: '400001',
      },
      user: { role: 'buyer', email: buyer.corporateEmail, name: 'Buyer Contact' },
    }, res, jest.fn());

    expect(res.statusCode).toBe(201);
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      buyerEmail: buyer.corporateEmail,
      raisedByName: 'Buyer Contact',
      creationAcknowledgementRequested: true,
    }), buyer);
    expect(emailSpy).not.toHaveBeenCalled();
  });
});
