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

// One line item with every field the RFQ form requires, so each create request reaches the checks under test.
const COMPLETE_LINE_ITEM = {
  itemName: 'Centrifugal pump bearing',
  technicalSpecs: 'Deep groove ball bearing, 6205 2RS',
  quantity: 2,
  unit: 'Nos',
  majorCategory: 'Engineering Spares - Mechanical',
  minorCategory: 'Bearings & Accessories',
};

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
        extractedEntities: [{ ...COMPLETE_LINE_ITEM }],
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

  test('persists RFQ gateway delivery intent and avoids direct delivery when storage is configured', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const buyer = {
      id: 'buyer-gateway-1',
      corporateEmail: 'buyer@example.test',
      organizationName: 'Buyer Co',
      subscriptionPlan: 'version_1',
    };
    jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue(buyer);
    const rfq = {
      id: 'rfq-gateway-controller-1',
      rfqNumber: 'RFQ-GATEWAY-CONTROLLER-1',
      title: 'Pump spares',
      category: 'Pumps & Motors',
      sourcingMode: 'mode_1',
      procucevVendorCount: 0,
      assignedVendors: [],
      extractedEntities: [],
    };
    const createSpy = jest.spyOn(storeService, 'createRFQDurably').mockResolvedValue(rfq);
    jest.spyOn(storeService, 'resolveProcucevVendorCountFromDB').mockResolvedValue(0);
    jest.spyOn(rfqSummaryService, 'buildRFQSummary').mockResolvedValue({ summary: 'Pump requirement' });
    const gatewayEmailSpy = jest.spyOn(mailerService, 'sendRequisitionNotificationEmail');
    const res = createResponse();

    await rfqController.createRFQ({
      body: {
        title: 'Pump spares',
        category: 'Pumps & Motors',
        sourcingMode: 'mode_1',
        budget: 1000,
        targetDeliveryDate: '2099-01-01',
        deliveryLocation: 'Mumbai',
        deliveryPincode: '400001',
        extractedEntities: [{ ...COMPLETE_LINE_ITEM }],
        source: 'email_gateway',
        sourceEmail: 'buyer@example.test',
        targetGatewayEmail: 'gateway@example.test',
      },
      user: { role: 'buyer', email: buyer.corporateEmail, name: 'Buyer Contact' },
    }, res, jest.fn());

    expect(res.statusCode).toBe(201);
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      gatewayNotificationTarget: {
        recipientEmail: 'gateway@example.test',
        sourceEmail: 'buyer@example.test',
      },
    }), buyer);
    expect(gatewayEmailSpy).not.toHaveBeenCalled();
    expect(res.data.data).not.toHaveProperty('gatewayNotificationTarget');
  });
});
