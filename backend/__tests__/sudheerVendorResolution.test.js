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

  test('reviseRating succeeds via vendorEmail fallback when ID is not found initially', async () => {
    jest.spyOn(storeService, 'reviseVendorRatingDurably')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        updatedVendor: { ...vendorRecord, rating: 4.5 },
        revisionRecord: { id: 'rev-002', newRating: 4.5 },
      });
    jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(vendorRecord);

    const req = {
      params: { id: 'v-hist-nonexistent-id' },
      body: {
        qualityScore: 90,
        costScore: 90,
        deliveryScore: 90,
        remarks: 'Great performance.',
        vendorEmail: 'sudheer.kangala@procucev.com',
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
          updatedVendor: expect.objectContaining({ rating: 4.5 }),
        }),
      })
    );
  });

  test('reviseRating falls back to all scope when scoped revise returns null', async () => {
    jest.spyOn(storeService, 'reviseVendorRatingDurably')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        updatedVendor: { ...vendorRecord, rating: 4.7 },
        revisionRecord: { id: 'rev-003', newRating: 4.7 },
      });
    jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(vendorRecord);

    const req = {
      params: { id: 'v-hist-scoped-miss' },
      body: {
        qualityScore: 95,
        costScore: 95,
        deliveryScore: 95,
        remarks: 'Global fallback revision.',
        vendorEmail: 'sudheer.kangala@procucev.com',
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
          updatedVendor: expect.objectContaining({ rating: 4.7 }),
        }),
      })
    );
  });

  test('reviseRating returns 404 when vendor is completely unresolvable', async () => {
    jest.spyOn(storeService, 'reviseVendorRatingDurably').mockResolvedValue(null);
    jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);

    const req = {
      params: { id: 'v-completely-unknown' },
      body: {
        qualityScore: 50,
        costScore: 50,
        deliveryScore: 50,
        remarks: 'Unknown vendor test.',
      },
      user: buyerUser,
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await vendorController.reviseRating(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('not found'),
      })
    );
  });

  test('requestEvaluation promotes and succeeds for synthetic v-hist- vendor without initial DB match', async () => {
    jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);
    jest.spyOn(storeService, 'empanelIngestedVendor').mockReturnValue(vendorRecord);
    jest.spyOn(storeService, 'getVendorEvaluationsDurably').mockResolvedValue([]);
    jest.spyOn(storeService, 'requestVendorEvaluationDurably').mockResolvedValue({
      ...vendorRecord,
      evaluationRequested: true,
    });

    const req = {
      params: { id: 'v-hist-1794906884019-5-b7yn' },
      body: {
        notes: 'Please complete evaluation.',
        vendorEmail: 'sudheer.kangala@procucev.com',
        vendorName: 'Sudheer Solutions pvt LTD',
        majorCategory: 'Engineering Spares - Electrical',
        minorCategories: ['Cables', 'Laptop'],
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
      })
    );
  });
});
