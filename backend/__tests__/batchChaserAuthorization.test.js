const request = require('supertest');
const app = require('../src/app');
const rfqController = require('../src/controllers/rfqController');
const storeService = require('../src/services/storeService');
const { authHeader, TEST_USERS } = require('./testHelpers');

// Chasing vendors is limited to buyers, category managers and admins. A buyer may
// chase only the RFQs their own account can access. Everyone else is refused before
// the store is called, so no provider is contacted.

const OTHER_BUYER = Object.freeze({
  id: 'usr-buyer-other-001',
  email: 'other.buyer@procucev.com',
  name: 'Other Buyer',
  role: 'buyer',
  orgId: 'org-buyer-other-01',
  orgName: 'Other Buyer Org',
});

const SENT_RESULT = Object.freeze({
  success: true,
  count: 1,
  logs: [],
  results: [{ channel: 'sms', status: 'sent', success: true }],
  sentCount: 1,
});

function mockRes() {
  const res = {};
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload) => {
    res.data = payload;
    return res;
  });
  return res;
}

describe('POST /api/rfqs/:id/batch-chaser authorization', () => {
  let ownedRfqId;
  let otherBuyerRfqId;

  beforeAll(async () => {
    const testBuyerAccount = await storeService.ensureBuyerAccountForUser(TEST_USERS.buyer);
    const otherBuyerAccount = await storeService.ensureBuyerAccountForUser(OTHER_BUYER);
    ownedRfqId = storeService.createRFQ({
      title: 'Batch chaser RFQ owned by the test buyer',
      category: 'Engineering Spares - Mechanical',
    }, testBuyerAccount).id;
    otherBuyerRfqId = storeService.createRFQ({
      title: 'Batch chaser RFQ owned by another buyer',
      category: 'Engineering Spares - Mechanical',
    }, otherBuyerAccount).id;
  });

  beforeEach(() => {
    jest.spyOn(storeService, 'triggerBatchChaser').mockResolvedValue(SENT_RESULT);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a vendor is refused with 403 over HTTP and the store is never called', async () => {
    const res = await request(app)
      .post(`/api/rfqs/${ownedRfqId}/batch-chaser`)
      .set(authHeader('vendor'))
      .send({ channels: ['sms'] });

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(storeService.triggerBatchChaser).not.toHaveBeenCalled();
  });

  test('a vendor is refused by the controller before the RFQ is even looked up', async () => {
    const lookupSpy = jest.spyOn(storeService, 'getRFQByIdAsync');
    const res = mockRes();
    const next = jest.fn();

    await rfqController.triggerBatchChaser(
      { params: { id: ownedRfqId }, body: { channels: ['sms'] }, user: TEST_USERS.vendor },
      res,
      next
    );

    expect(res.statusCode).toBe(403);
    expect(lookupSpy).not.toHaveBeenCalled();
    expect(storeService.triggerBatchChaser).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('a buyer without access to the RFQ gets the same 404 as an unknown RFQ', async () => {
    const forbidden = await request(app)
      .post(`/api/rfqs/${otherBuyerRfqId}/batch-chaser`)
      .set(authHeader('buyer'))
      .send({ channels: ['sms'] });
    const unknown = await request(app)
      .post('/api/rfqs/rfq-does-not-exist/batch-chaser')
      .set(authHeader('buyer'))
      .send({ channels: ['sms'] });

    expect(forbidden.statusCode).toBe(404);
    expect(forbidden.body).toEqual({ success: false, error: `RFQ with ID ${otherBuyerRfqId} not found.` });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.body).toEqual({ success: false, error: 'RFQ with ID rfq-does-not-exist not found.' });
    expect(storeService.triggerBatchChaser).not.toHaveBeenCalled();
  });

  test('a buyer who owns the RFQ gets the store result as a 200 and the store sees the buyer as actor', async () => {
    const res = await request(app)
      .post(`/api/rfqs/${ownedRfqId}/batch-chaser`)
      .set(authHeader('buyer'))
      .send({ channels: ['sms'] });

    expect(res.statusCode).toBe(200);
    expect(res.body.sentCount).toBe(1);
    expect(storeService.triggerBatchChaser).toHaveBeenCalledWith(
      ownedRfqId,
      ['sms'],
      expect.objectContaining({ role: 'buyer' })
    );
  });

  test.each(['admin', 'category_manager'])('a %s may chase an RFQ owned by another buyer', async (role) => {
    const res = await request(app)
      .post(`/api/rfqs/${otherBuyerRfqId}/batch-chaser`)
      .set(authHeader(role))
      .send({ channels: ['sms'] });

    expect(res.statusCode).toBe(200);
    expect(res.body.sentCount).toBe(1);
    expect(storeService.triggerBatchChaser).toHaveBeenCalledTimes(1);
  });

  test('an admin asking about an unknown RFQ gets 404 and the store is not called', async () => {
    const res = await request(app)
      .post('/api/rfqs/rfq-does-not-exist/batch-chaser')
      .set(authHeader('admin'))
      .send({ channels: ['sms'] });

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('RFQ with ID rfq-does-not-exist not found.');
    expect(storeService.triggerBatchChaser).not.toHaveBeenCalled();
  });

  test('a request with no signed-in user is refused with 401 and nothing is sent', async () => {
    const res = mockRes();
    const next = jest.fn();

    await rfqController.triggerBatchChaser({ params: { id: ownedRfqId }, body: {} }, res, next);

    expect(res.statusCode).toBe(401);
    expect(storeService.triggerBatchChaser).not.toHaveBeenCalled();
  });
});
