const aiFeedController = require('../src/controllers/aiFeedController');
const storeService = require('../src/services/storeService');
const rootResolvers = require('../src/graphql/resolvers');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('aiFeedController & resolvers coverage', () => {
  let createdBuyerAccount;
  let testRfq;

  beforeAll(() => {
    createdBuyerAccount = storeService.addBuyerAccount({
      companyName: 'AI Feed Test Corp',
      corporateEmail: 'aifeed.buyer@test.com',
    });

    testRfq = storeService.createRFQ(
      {
        rfqNumber: 'RFQ-AIFEED-999',
        title: 'Feed Test RFQ',
      },
      createdBuyerAccount
    );

    storeService.addAIFeedItem({
      title: 'Feed Item Direct Buyer',
      message: 'Direct buyer message',
      buyerAccountId: createdBuyerAccount.id,
      channel: 'whatsapp',
    });

    storeService.addAIFeedItem({
      title: 'Feed Item By RFQ',
      message: 'Linked via RFQ',
      rfqNumber: testRfq.rfqNumber,
      channel: 'call',
    });

    storeService.addAIFeedItem({
      title: 'Other Buyer Feed Item',
      message: 'Other buyer message',
      buyerAccountId: 'different-buyer-acc',
      rfqNumber: 'RFQ-OTHER-111',
      channel: 'sms',
    });

    storeService.addAIFeedItem({
      title: 'Orphan Feed Item',
      message: 'No buyer and no rfq',
      channel: 'system',
    });
  });

  describe('resolveAiFeedReadScope', () => {
    test('resolves scope by query buyerAccountId', () => {
      const scope = aiFeedController.resolveAiFeedReadScope({ query: { buyerAccountId: 'acc-123' } });
      expect(scope).toEqual({ restricted: true, buyerAccountId: 'acc-123' });
    });

    test('resolves scope by query buyerId', () => {
      const scope = aiFeedController.resolveAiFeedReadScope({ query: { buyerId: 'acc-456' } });
      expect(scope).toEqual({ restricted: true, buyerAccountId: 'acc-456' });
    });

    test('resolves scope for authenticated buyer session with known email', () => {
      const scope = aiFeedController.resolveAiFeedReadScope({
        user: { role: 'buyer', email: 'aifeed.buyer@test.com' },
      });
      expect(scope).toEqual({ restricted: true, buyerAccountId: createdBuyerAccount.id });
    });

    test('resolves scope for authenticated buyer session with orgId/sub fallback', () => {
      const scope1 = aiFeedController.resolveAiFeedReadScope({
        user: { role: 'buyer', email: 'unknown@test.com', orgId: 'org-fallback-1' },
      });
      expect(scope1).toEqual({ restricted: true, buyerAccountId: 'org-fallback-1' });

      const scope2 = aiFeedController.resolveAiFeedReadScope({
        user: { role: 'buyer', email: 'unknown2@test.com', sub: 'sub-fallback-2' },
      });
      expect(scope2).toEqual({ restricted: true, buyerAccountId: 'sub-fallback-2' });

      const scope3 = aiFeedController.resolveAiFeedReadScope({
        user: { role: 'buyer', email: 'unknown3@test.com' },
      });
      expect(scope3).toEqual({ restricted: true, buyerAccountId: null });
    });

    test('unrestricted for unauthenticated or non-buyer', () => {
      expect(aiFeedController.resolveAiFeedReadScope({})).toEqual({ restricted: false, buyerAccountId: null });
      expect(aiFeedController.resolveAiFeedReadScope({ user: { role: 'vendor' } })).toEqual({
        restricted: false,
        buyerAccountId: null,
      });
    });
  });

  describe('getAIFeed controller', () => {
    test('filters feed items by buyer account ID query', () => {
      const req = { query: { buyerAccountId: createdBuyerAccount.id } };
      const res = mockRes();
      const next = jest.fn();

      aiFeedController.getAIFeed(req, res, next);
      expect(res.json).toHaveBeenCalled();
      const data = res.json.mock.calls[0][0].data;
      expect(data.some((i) => i.title === 'Feed Item Direct Buyer')).toBe(true);
      expect(data.some((i) => i.title === 'Feed Item By RFQ')).toBe(true);
      expect(data.some((i) => i.title === 'Other Buyer Feed Item')).toBe(false);
      expect(data.some((i) => i.title === 'Orphan Feed Item')).toBe(false);
    });

    test('returns empty array when buyer account ID is null in restricted scope', () => {
      const req = { user: { role: 'buyer', email: 'noaccount@nowhere.test' } };
      const res = mockRes();
      const next = jest.fn();

      aiFeedController.getAIFeed(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
    });

    test('returns all feed items for unrestricted non-buyer', () => {
      const req = {};
      const res = mockRes();
      const next = jest.fn();

      aiFeedController.getAIFeed(req, res, next);
      expect(res.json).toHaveBeenCalled();
      const data = res.json.mock.calls[0][0].data;
      expect(data.length).toBeGreaterThan(0);
    });

    test('calls next on error', () => {
      const res = mockRes();
      const next = jest.fn();
      jest.spyOn(storeService, 'getAIFeed').mockImplementationOnce(() => {
        throw new Error('Test getAIFeed error');
      });

      aiFeedController.getAIFeed({}, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('createFeedItem controller', () => {
    test('creates feed item stamped with explicit buyerAccountId in body', () => {
      const req = {
        body: { title: 'Explicit Buyer', message: 'Test message', buyerAccountId: 'explicit-acc-1' },
      };
      const res = mockRes();
      const next = jest.fn();

      aiFeedController.createFeedItem(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
      const created = res.json.mock.calls[0][0].data;
      expect(created.buyerAccountId).toBe('explicit-acc-1');
    });

    test('creates feed item stamped with buyer session account', () => {
      const req = {
        user: { role: 'buyer', email: 'aifeed.buyer@test.com' },
        body: { title: 'Session Stamped', message: 'Test message' },
      };
      const res = mockRes();
      const next = jest.fn();

      aiFeedController.createFeedItem(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
      const created = res.json.mock.calls[0][0].data;
      expect(created.buyerAccountId).toBe(createdBuyerAccount.id);
    });

    test('creates feed item stamped with buyer session without matched account', () => {
      const req = {
        user: { role: 'buyer', email: 'unmatched.buyer@test.com' },
        body: { title: 'Unmatched Session Stamped', message: 'Test message' },
      };
      const res = mockRes();
      const next = jest.fn();

      aiFeedController.createFeedItem(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
      const created = res.json.mock.calls[0][0].data;
      expect(created.buyerAccountId).toBeNull();
    });

    test('creates feed item stamped with rfqNumber buyerAccountId', () => {
      const req = {
        body: { title: 'RFQ Stamped', message: 'Test message', rfqNumber: testRfq.rfqNumber },
      };
      const res = mockRes();
      const next = jest.fn();

      aiFeedController.createFeedItem(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
      const created = res.json.mock.calls[0][0].data;
      expect(created.buyerAccountId).toBe(createdBuyerAccount.id);
    });

    test('creates feed item stamped with non-existent rfqNumber', () => {
      const req = {
        body: { title: 'Non-existent RFQ Stamped', message: 'Test message', rfqNumber: 'NON_EXISTENT_RFQ' },
      };
      const res = mockRes();
      const next = jest.fn();

      aiFeedController.createFeedItem(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
      const created = res.json.mock.calls[0][0].data;
      expect(created.buyerAccountId).toBeNull();
    });

    test('rejects missing title or message', () => {
      const res = mockRes();
      const next = jest.fn();

      aiFeedController.createFeedItem({ body: { title: 'Only Title' } }, res, next);
      expect(res.status).toHaveBeenCalledWith(400);

      aiFeedController.createFeedItem({ body: { message: 'Only Message' } }, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('calls next on creation error', () => {
      const res = mockRes();
      const next = jest.fn();
      jest.spyOn(storeService, 'addAIFeedItem').mockImplementationOnce(() => {
        throw new Error('Test addAIFeedItem error');
      });

      aiFeedController.createFeedItem({ body: { title: 'Err', message: 'Err' } }, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('GraphQL aiFeed resolver', () => {
    test('scopes feed for buyer session in context', () => {
      const ctx = {
        req: { user: { role: 'buyer', email: 'aifeed.buyer@test.com' } },
      };
      const feed = rootResolvers.aiFeed({ limit: 10 }, ctx);
      expect(Array.isArray(feed)).toBe(true);
      expect(feed.some((i) => i.title === 'Feed Item Direct Buyer')).toBe(true);
      expect(feed.some((i) => i.title === 'Other Buyer Feed Item')).toBe(false);
    });

    test('returns empty for buyer session with no matched account', () => {
      const ctx = {
        req: { user: { role: 'buyer', email: 'unregistered@test.com' } },
      };
      const feed = rootResolvers.aiFeed({}, ctx);
      expect(feed).toEqual([]);
    });

    test('returns all for non-buyer or unauthenticated GraphQL context', () => {
      const feed1 = rootResolvers.aiFeed({});
      expect(feed1.length).toBeGreaterThan(0);

      const feed2 = rootResolvers.aiFeed({}, { req: { user: { role: 'admin' } } });
      expect(feed2.length).toBeGreaterThan(0);
    });
  });
});
