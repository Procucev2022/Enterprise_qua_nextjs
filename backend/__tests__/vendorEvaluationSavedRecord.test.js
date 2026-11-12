const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const storeService = require('../src/services/storeService');
const vendorController = require('../src/controllers/vendorController');
const evaluationController = require('../src/controllers/evaluationController');
const { VENDOR_EVALUATION_REQUEST, formatMessage } = require('../src/config/constants');
const { authHeader } = require('./testHelpers');

function mockRes() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('getEvaluationsForVendorFromDB', () => {
  let originalPool;

  beforeEach(() => {
    originalPool = pool.pool;
  });

  afterEach(() => {
    pool.pool = originalPool;
    jest.restoreAllMocks();
  });

  test('returns an empty list when storage is not configured', async () => {
    pool.pool = null;
    await expect(domainQueries.getEvaluationsForVendorFromDB('v-1')).resolves.toEqual([]);
  });

  test('returns an empty list for a blank vendor id without querying', async () => {
    const query = jest.fn();
    pool.pool = { query };
    await expect(domainQueries.getEvaluationsForVendorFromDB('   ')).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  test('queries the newest saved evaluations for one vendor and maps the raw rows', async () => {
    const saved = { id: 'eval-1', vendorId: 'v-1', overallScore: 70 };
    const query = jest.fn().mockResolvedValue({ rows: [{ raw: saved }] });
    pool.pool = { query };

    await expect(domainQueries.getEvaluationsForVendorFromDB(' v-1 ', 1)).resolves.toEqual([saved]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT $2'),
      ['v-1', 1]
    );
  });

  test('returns an empty list when no vendor id is given, even with storage configured', async () => {
    const query = jest.fn();
    pool.pool = { query };
    await expect(domainQueries.getEvaluationsForVendorFromDB()).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  test('clamps the requested row count to the supported range', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    pool.pool = { query };

    await domainQueries.getEvaluationsForVendorFromDB('v-1', 900);
    expect(query).toHaveBeenLastCalledWith(expect.any(String), ['v-1', 500]);

    await domainQueries.getEvaluationsForVendorFromDB('v-1', 50);
    expect(query).toHaveBeenLastCalledWith(expect.any(String), ['v-1', 50]);

    await domainQueries.getEvaluationsForVendorFromDB('v-1', 'abc');
    expect(query).toHaveBeenLastCalledWith(expect.any(String), ['v-1', 1]);

    await domainQueries.getEvaluationsForVendorFromDB('v-1', 0);
    expect(query).toHaveBeenLastCalledWith(expect.any(String), ['v-1', 1]);
  });
});

describe('storeService.getVendorEvaluationsDurably', () => {
  const originalEvaluations = storeService.evaluations;
  let originalPool;

  beforeEach(() => {
    originalPool = pool.pool;
  });

  afterEach(() => {
    pool.pool = originalPool;
    storeService.evaluations = originalEvaluations;
    jest.restoreAllMocks();
  });

  test('returns an empty list when no vendor id is given', async () => {
    await expect(storeService.getVendorEvaluationsDurably('   ')).resolves.toEqual([]);
  });

  test('searches the in-memory list by vendor id or name when storage is not configured', async () => {
    pool.pool = null;
    storeService.evaluations = [
      { id: 'e-1', vendorId: 'v-1', vendorName: 'Apex' },
      { id: 'e-2', vendorId: 'v-2', vendorName: 'Other Supplier' },
      { id: 'e-3', vendorId: 'v-3', vendorName: 'APEX' },
    ];

    await expect(storeService.getVendorEvaluationsDurably('V-1', 5)).resolves.toEqual([
      { id: 'e-1', vendorId: 'v-1', vendorName: 'Apex' },
    ]);
    await expect(storeService.getVendorEvaluationsDurably('apex', 1)).resolves.toEqual([
      { id: 'e-1', vendorId: 'v-1', vendorName: 'Apex' },
    ]);
  });

  test('treats missing vendor fields as non-matching and a missing id as an empty lookup', async () => {
    pool.pool = null;
    storeService.evaluations = [
      { id: 'e-4', vendorName: 'Nameless Id Supplier' },
      { id: 'e-5', vendorId: 'v-5' },
    ];

    await expect(storeService.getVendorEvaluationsDurably(undefined)).resolves.toEqual([]);
    await expect(storeService.getVendorEvaluationsDurably('v-5')).resolves.toEqual([
      { id: 'e-5', vendorId: 'v-5' },
    ]);
    await expect(storeService.getVendorEvaluationsDurably('nameless id supplier')).resolves.toEqual([
      { id: 'e-4', vendorName: 'Nameless Id Supplier' },
    ]);
  });

  test('reads the saved evaluations from storage when storage is configured', async () => {
    pool.pool = { query: jest.fn() };
    const saved = { id: 'eval-db', vendorId: 'v-9' };
    const readSpy = jest.spyOn(domainQueries, 'getEvaluationsForVendorFromDB').mockResolvedValue([saved]);

    await expect(storeService.getVendorEvaluationsDurably('v-9', 3)).resolves.toEqual([saved]);
    expect(readSpy).toHaveBeenCalledWith('v-9', 3);
  });

  test('throws a 503 with a retry message when storage cannot be read, so no request is treated as unnecessary', async () => {
    pool.pool = { query: jest.fn() };
    jest.spyOn(domainQueries, 'getEvaluationsForVendorFromDB').mockRejectedValue(new Error('connection reset'));

    const error = await storeService.getVendorEvaluationsDurably('v-9').catch((err) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe('PERSISTENCE_UNAVAILABLE');
    expect(error.message).toMatch(/No evaluation request was sent/);
  });
});

describe('vendorController.requestEvaluation saved-evaluation check', () => {
  const buyerUser = {
    id: 'buyer-guard-id',
    email: 'buyer-guard@example.test',
    role: 'buyer',
    name: 'Buyer Guard',
    orgName: 'Guard Org',
  };
  const vendor = { id: 'v-guard', name: 'Guard Supplier', email: 'guard-supplier@example.test' };
  let spies;

  beforeEach(() => {
    spies = {
      account: jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null),
      vendor: jest.spyOn(storeService, 'getVendorById').mockReturnValue(vendor),
      saved: jest.spyOn(storeService, 'getVendorEvaluationsDurably').mockResolvedValue([]),
      dispatch: jest.spyOn(storeService, 'requestVendorEvaluationDurably').mockResolvedValue({
        vendorId: vendor.id,
        evaluationRequested: true,
      }),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const buildReq = (body = {}, params = { id: vendor.id }) => ({ params, user: buyerUser, body });

  test('returns the saved evaluation and sends no request when one exists', async () => {
    const saved = { id: 'eval-guard', vendorId: vendor.id, overallScore: 64 };
    spies.saved.mockResolvedValueOnce([saved]);
    const res = mockRes();
    const next = jest.fn();

    await vendorController.requestEvaluation(buildReq({ notes: 'Please submit' }), res, next);

    expect(spies.saved).toHaveBeenCalledWith(vendor.id, 1);
    expect(spies.dispatch).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      evaluationExists: true,
      message: formatMessage(VENDOR_EVALUATION_REQUEST.EXISTING_EVALUATION_MESSAGE, { vendorName: vendor.name }),
      data: { evaluation: saved },
    });
  });

  test('rejects an over-long note before any lookup or dispatch', async () => {
    const res = mockRes();

    await vendorController.requestEvaluation(buildReq({ notes: 'n'.repeat(1001) }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      errors: expect.objectContaining({ notes: expect.any(String) }),
    }));
    expect(spies.saved).not.toHaveBeenCalled();
    expect(spies.dispatch).not.toHaveBeenCalled();
  });

  test('sends the request with the trimmed note when no saved evaluation exists', async () => {
    const res = mockRes();

    await vendorController.requestEvaluation(buildReq({ notes: '  Please submit  ' }), res, jest.fn());

    expect(spies.dispatch).toHaveBeenCalledWith(
      vendor.id,
      expect.objectContaining({ notes: 'Please submit' }),
      buyerUser.email
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ evaluationRequested: true }),
    }));
  });

  test('treats a request without a body as an empty payload when no saved evaluation exists', async () => {
    const res = mockRes();

    await vendorController.requestEvaluation({ params: { id: vendor.id }, user: buyerUser }, res, jest.fn());

    expect(spies.dispatch).toHaveBeenCalledWith(vendor.id, expect.objectContaining({ notes: '' }), buyerUser.email);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('refuses to send when the vendor has no email and no saved evaluation exists', async () => {
    spies.vendor.mockReturnValueOnce({ id: 'v-no-mail', name: 'No Mail Supplier', email: '' });
    const res = mockRes();

    await vendorController.requestEvaluation(buildReq({}, { id: 'v-no-mail' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(spies.dispatch).not.toHaveBeenCalled();
  });

  test('passes a failed saved-evaluation read to the error handler without sending a request', async () => {
    const readError = Object.assign(new Error('Saved evaluations could not be read from storage.'), { statusCode: 503 });
    spies.saved.mockRejectedValueOnce(readError);
    const next = jest.fn();

    await vendorController.requestEvaluation(buildReq({}), mockRes(), next);

    expect(next).toHaveBeenCalledWith(readError);
    expect(spies.dispatch).not.toHaveBeenCalled();
  });
});

describe('evaluationController.getEvaluations', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('reads the saved evaluations for one vendor from storage with the requested limit', async () => {
    const saved = [{ id: 'eval-old', vendorId: 'v-old' }];
    const readSpy = jest.spyOn(storeService, 'getVendorEvaluationsDurably').mockResolvedValue(saved);
    const res = mockRes();

    await evaluationController.getEvaluations({ query: { vendorId: 'v-old', limit: '5' } }, res, jest.fn());

    expect(readSpy).toHaveBeenCalledWith('v-old', 5);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: saved }));
  });

  test('rejects an over-long vendor id with a 400 before reading storage', async () => {
    const readSpy = jest.spyOn(storeService, 'getVendorEvaluationsDurably');
    const res = mockRes();

    await evaluationController.getEvaluations({ query: { vendorId: 'v'.repeat(129) } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      errors: expect.objectContaining({ vendorId: expect.any(String) }),
    }));
    expect(readSpy).not.toHaveBeenCalled();
  });

  test('passes a storage read failure to the error handler', async () => {
    const readError = new Error('read failed');
    jest.spyOn(storeService, 'getVendorEvaluationsDurably').mockRejectedValue(readError);
    const next = jest.fn();

    await evaluationController.getEvaluations({ query: { vendorId: 'v-1' } }, mockRes(), next);

    expect(next).toHaveBeenCalledWith(readError);
  });

  test('lists recent evaluations when no vendor is given', async () => {
    const recent = [{ id: 'eval-recent' }];
    jest.spyOn(storeService, 'getEvaluations').mockReturnValue(recent);
    const res = mockRes();

    await evaluationController.getEvaluations({ query: {} }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: recent }));
  });
});

describe('saved evaluation routes', () => {
  const originalEvaluations = storeService.evaluations;
  let originalPool;
  let vendor;
  let savedEvaluation;

  beforeEach(() => {
    originalPool = pool.pool;
    pool.pool = null;
    vendor = storeService.addVendor({
      name: 'Route Saved Supplier',
      email: 'route-saved-supplier@example.test',
      source: 'buyer_manual',
    });
    savedEvaluation = {
      id: 'eval-route-saved',
      vendorId: vendor.id,
      vendorName: vendor.name,
      overallScore: 77,
      status: 'CONDITIONAL / UNDER REVIEW',
      moduleScores: {},
      documents: [],
      systemAction: 'Review',
    };
    storeService.evaluations = [savedEvaluation, ...originalEvaluations];
  });

  afterEach(() => {
    pool.pool = originalPool;
    storeService.evaluations = originalEvaluations;
    jest.restoreAllMocks();
  });

  test('POST request-evaluation returns the saved evaluation and sends no request', async () => {
    const dispatchSpy = jest.spyOn(storeService, 'requestVendorEvaluationDurably');

    const res = await request(app)
      .post(`/api/vendors/${vendor.id}/request-evaluation`)
      .set(authHeader('buyer'))
      .send({ notes: 'Please submit' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.evaluationExists).toBe(true);
    expect(res.body.data.evaluation.id).toBe(savedEvaluation.id);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  test('GET /api/evaluations returns the saved evaluation for the vendor', async () => {
    const res = await request(app)
      .get(`/api/evaluations?vendorId=${encodeURIComponent(vendor.id)}`)
      .set(authHeader('buyer'));

    expect(res.statusCode).toBe(200);
    expect(res.body.data.map((evaluation) => evaluation.id)).toEqual([savedEvaluation.id]);
  });
});
