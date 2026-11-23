const vendorController = require('../src/controllers/vendorController');
const storeService = require('../src/services/storeService');

describe('Sudheer Vendor Rating Revision and Evaluation Resolution', () => {
  const buyerUser = {
    role: 'buyer',
    email: 'sudheer.kangala@procucev.com',
    name: 'Sudheer Kangala',
    orgName: 'Procucev',
    sub: 'user-sudheer-001',
    id: 'user-sudheer-001',
  };

  const buyerAccount = {
    id: '229ece9a-db70-4ef7-8768-36563de3d334',
    corporateEmail: 'sudheer.kangala@procucev.com',
    organizationName: 'Procucev',
    organizationId: 'c627c89f-9784-4ccc-b8cd-bc965fcdc9f6',
    contactPerson: 'Sudheer Kangala',
  };

  const vendorId = 'v-hist-1794906984019-5-b7yn';
  const vendorRecord = {
    id: vendorId,
    name: 'Sudheer Solutions pvt LTD',
    email: 'sudheer.kangala@procucev.com',
    buyerId: '229ece9a-db70-4ef7-8768-36563de3d334',
    buyerAccountId: '229ece9a-db70-4ef7-8768-36563de3d334',
    buyerEmail: 'sudheer.kangala@procucev.com',
    addedByBuyerCompany: 'Procucev',
    majorCategory: 'Engineering Spares - Electrical',
    minorCategories: ['Cables', 'Laptop'],
    status: 'NOT EVALUATED',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(buyerAccount);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('reviseRating succeeds for sudheer vendor record', async () => {
    jest.spyOn(storeService, 'reviseVendorRatingDurably').mockResolvedValue({
      updatedVendor: { ...vendorRecord, rating: 4.2 },
      revisionRecord: { id: 'rev-001', newRating: 4.2 },
    });

    const req = {
      params: { id: vendorId },
      body: {
        qualityScore: 85,
        costScore: 80,
        deliveryScore: 90,
        remarks: 'Excellent delivery and quality.',
      },
      user: buyerUser,
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await vendorController.reviseRating(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          updatedVendor: expect.objectContaining({ rating: 4.2 }),
        }),
      })
    );
  });

  test('requestEvaluation succeeds for sudheer vendor record', async () => {
    jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(vendorRecord);
    jest.spyOn(storeService, 'getVendorEvaluationsDurably').mockResolvedValue([]);
    jest.spyOn(storeService, 'requestVendorEvaluationDurably').mockResolvedValue({
      ...vendorRecord,
      evaluationRequested: true,
    });

    const req = {
      params: { id: vendorId },
      body: {
        notes: 'Please submit evaluation form.',
      },
      user: buyerUser,
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await vendorController.requestEvaluation(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          evaluationRequested: true,
        }),
      })
    );
  });
});
