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
    test('resolves scope by query buyerAccountId', async () => {
      const scope = await aiFeedController.resolveAiFeedReadScope({ user: { role: 'admin' }, query: { buyerAccountId: 'acc-123' } });
      expect(scope).toEqual({ restricted: true, buyerAccountId: 'acc-123' });
    });

    test('resolves scope by query buyerId', async () => {
      const scope = await aiFeedController.resolveAiFeedReadScope({ user: { role: 'category_manager' }, query: { buyerId: 'acc-456' } });
      expect(scope).toEqual({ restricted: true, buyerAccountId: 'acc-456' });
    });

    test('buyer session scope overrides a requested account', async () => {
      const scope = await aiFeedController.resolveAiFeedReadScope({
        user: { role: 'buyer', email: 'aifeed.buyer@test.com' },
        query: { buyerAccountId: 'different-buyer-acc' },
      });
      expect(scope).toEqual({ restricted: true, buyerAccountId: createdBuyerAccount.id });
    });

    test('resolves scope for authenticated buyer session with known email', async () => {
      const scope = await aiFeedController.resolveAiFeedReadScope({
        user: { role: 'buyer', email: 'aifeed.buyer@test.com' },
      });
      expect(scope).toEqual({ restricted: true, buyerAccountId: createdBuyerAccount.id });
    });

    test('resolves scope for authenticated buyer session with orgId/sub fallback', async () => {
      const scope1 = await aiFeedController.resolveAiFeedReadScope({
        user: { role: 'buyer', email: 'unknown@test.com', orgId: 'org-fallback-1' },
      });
      expect(scope1).toEqual({ restricted: true, buyerAccountId: 'org-fallback-1' });

      const scope2 = await aiFeedController.resolveAiFeedReadScope({
        user: { role: 'buyer', email: 'unknown2@test.com', sub: 'sub-fallback-2' },
      });
      expect(scope2).toEqual({ restricted: true, buyerAccountId: 'sub-fallback-2' });

      const scope3 = await aiFeedController.resolveAiFeedReadScope({
        user: { role: 'buyer', email: 'unknown3@test.com' },
      });
      expect(scope3).toEqual({ restricted: true, buyerAccountId: null });
    });

    test('unauthenticated and unsupported principals resolve to an empty scope', async () => {
      expect(await aiFeedController.resolveAiFeedReadScope({})).toEqual({ restricted: true, buyerAccountId: null });
      expect(await aiFeedController.resolveAiFeedReadScope({ user: { role: 'vendor' } })).toEqual({
        restricted: true,
        buyerAccountId: null,
      });
      expect(await aiFeedController.resolveAiFeedReadScope({ user: { role: 'admin' } })).toEqual({
        restricted: false,
        buyerAccountId: null,
      });
    });
  });

  describe('getAIFeed controller', () => {
    test('filters feed items by buyer account ID query', async () => {
      const req = { user: { role: 'admin' }, query: { buyerAccountId: createdBuyerAccount.id } };
      const res = mockRes();
      const next = jest.fn();

      await aiFeedController.getAIFeed(req, res, next);
      expect(res.json).toHaveBeenCalled();
      const data = res.json.mock.calls[0][0].data;
      expect(data.some((i) => i.title === 'Feed Item Direct Buyer')).toBe(true);
      expect(data.some((i) => i.title === 'Feed Item By RFQ')).toBe(true);
      expect(data.some((i) => i.title === 'Other Buyer Feed Item')).toBe(false);
      expect(data.some((i) => i.title === 'Orphan Feed Item')).toBe(false);
    });

    test('returns empty array when buyer account ID is null in restricted scope', async () => {
      const req = { user: { role: 'buyer', email: 'noaccount@nowhere.test' } };
      const res = mockRes();
      const next = jest.fn();

      await aiFeedController.getAIFeed(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
    });

    test('returns all feed items for authorized management roles', async () => {
      const req = { user: { role: 'admin' } };
      const res = mockRes();
      const next = jest.fn();

      await aiFeedController.getAIFeed(req, res, next);
      expect(res.json).toHaveBeenCalled();
      const data = res.json.mock.calls[0][0].data;
      expect(data.length).toBeGreaterThan(0);
    });

    test('applies limit parameter to slice results', async () => {
      const req = { user: { role: 'admin' }, query: { limit: '2' } };
      const res = mockRes();
      const next = jest.fn();

      await aiFeedController.getAIFeed(req, res, next);
      expect(res.json).toHaveBeenCalled();
      const data = res.json.mock.calls[0][0].data;
      expect(data.length).toBeLessThanOrEqual(2);
    });

    test('calls next on error', async () => {
      const res = mockRes();
      const next = jest.fn();
      jest.spyOn(storeService, 'getAIFeed').mockImplementationOnce(() => {
        throw new Error('Test getAIFeed error');
      });

      await aiFeedController.getAIFeed({ user: { role: 'admin' } }, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('createFeedItem controller', () => {
    test('requires an allowed session role', async () => {
      const anonymousRes = mockRes();
      await aiFeedController.createFeedItem({ body: { title: 'x', message: 'y' } }, anonymousRes, jest.fn());
      expect(anonymousRes.status).toHaveBeenCalledWith(401);

      const vendorRes = mockRes();
      await aiFeedController.createFeedItem({ user: { role: 'vendor' }, body: { title: 'x', message: 'y' } }, vendorRes, jest.fn());
      expect(vendorRes.status).toHaveBeenCalledWith(403);
    });

    test('creates feed item stamped with explicit buyerAccountId in body', async () => {
      const req = {
        user: { role: 'admin' },
        body: { title: 'Explicit Buyer', message: 'Test message', buyerAccountId: 'explicit-acc-1' },
      };
      const res = mockRes();
      const next = jest.fn();

      await aiFeedController.createFeedItem(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
      const created = res.json.mock.calls[0][0].data;
      expect(created.buyerAccountId).toBe('explicit-acc-1');
    });

    test('creates feed item stamped with buyer session account', async () => {
      const req = {
        user: { role: 'buyer', email: 'aifeed.buyer@test.com' },
        body: { title: 'Session Stamped', message: 'Test message' },
      };
      const res = mockRes();
      const next = jest.fn();

      await aiFeedController.createFeedItem(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
      const created = res.json.mock.calls[0][0].data;
      expect(created.buyerAccountId).toBe(createdBuyerAccount.id);
    });

    test('ignores a buyer-supplied account ID and rejects an RFQ owned by another buyer', async () => {
      const ownRes = mockRes();
      await aiFeedController.createFeedItem({
        user: { role: 'buyer', email: 'aifeed.buyer@test.com' },
        body: { title: 'Owned item', message: 'Own account', buyerAccountId: 'different-buyer-acc' },
      }, ownRes, jest.fn());
      expect(ownRes.status).toHaveBeenCalledWith(201);
      expect(ownRes.json.mock.calls[0][0].data.buyerAccountId).toBe(createdBuyerAccount.id);

      const crossRfqRes = mockRes();
      await aiFeedController.createFeedItem({
        user: { role: 'buyer', email: 'other-account@test.com', orgId: 'different-buyer-acc' },
        body: { title: 'Cross account RFQ', message: 'Should not persist', rfqNumber: testRfq.rfqNumber },
      }, crossRfqRes, jest.fn());
      expect(crossRfqRes.status).toHaveBeenCalledWith(404);
    });

    test('rejects a management feed item whose buyer does not match its RFQ', async () => {
      const res = mockRes();
      await aiFeedController.createFeedItem({
        user: { role: 'category_manager' },
        body: {
          title: 'Mismatched link',
          message: 'Should not persist',
          buyerAccountId: 'different-buyer-acc',
          rfqNumber: testRfq.rfqNumber,
        },
      }, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('requires a buyer identity when the buyer account cannot be resolved', async () => {
      const req = {
        user: { role: 'buyer', email: 'unmatched.buyer@test.com' },
        body: { title: 'Unmatched Session Stamped', message: 'Test message' },
      };
      const res = mockRes();
      const next = jest.fn();

      await aiFeedController.createFeedItem(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json.mock.calls[0][0].success).toBe(false);
    });

    test('creates feed item stamped with rfqNumber buyerAccountId', async () => {
      const req = {
        user: { role: 'admin' },
        body: { title: 'RFQ Stamped', message: 'Test message', rfqNumber: testRfq.rfqNumber },
      };
      const res = mockRes();
      const next = jest.fn();

      await aiFeedController.createFeedItem(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
      const created = res.json.mock.calls[0][0].data;
      expect(created.buyerAccountId).toBe(createdBuyerAccount.id);
    });

    test('rejects a non-existent rfqNumber', async () => {
      const req = {
        user: { role: 'admin' },
        body: { title: 'Non-existent RFQ Stamped', message: 'Test message', rfqNumber: 'NON_EXISTENT_RFQ' },
      };
      const res = mockRes();
      const next = jest.fn();

      await aiFeedController.createFeedItem(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('rejects missing title or message', async () => {
      const res = mockRes();
      const next = jest.fn();

      await aiFeedController.createFeedItem({ user: { role: 'buyer', email: 'aifeed.buyer@test.com' }, body: { title: 'Only Title' } }, res, next);
      expect(res.status).toHaveBeenCalledWith(400);

      await aiFeedController.createFeedItem({ user: { role: 'buyer', email: 'aifeed.buyer@test.com' }, body: { message: 'Only Message' } }, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('calls next on creation error', async () => {
      const res = mockRes();
      const next = jest.fn();
      jest.spyOn(storeService, 'addAIFeedItemDurably').mockRejectedValueOnce(new Error('Test addAIFeedItemDurably error'));

      await aiFeedController.createFeedItem({ user: { role: 'admin' }, body: { title: 'Err', message: 'Err' } }, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('GraphQL aiFeed resolver', () => {
    test('scopes feed for buyer session in context', async () => {
      const ctx = {
        req: { user: { role: 'buyer', email: 'aifeed.buyer@test.com' } },
      };
      const feed = await rootResolvers.aiFeed({ limit: 10 }, ctx);
      expect(Array.isArray(feed)).toBe(true);
      expect(feed.some((i) => i.title === 'Feed Item Direct Buyer')).toBe(true);
      expect(feed.some((i) => i.title === 'Other Buyer Feed Item')).toBe(false);
    });

    test('returns empty for buyer session with no matched account', async () => {
      const ctx = {
        req: { user: { role: 'buyer', email: 'unregistered@test.com' } },
      };
      const feed = await rootResolvers.aiFeed({}, ctx);
      expect(feed).toEqual([]);
    });

    test('requires a session and returns all only for an authorized management role', async () => {
      await expect(rootResolvers.aiFeed({})).rejects.toThrow();

      const feed2 = await rootResolvers.aiFeed({}, { req: { user: { role: 'admin' } } });
      expect(feed2.length).toBeGreaterThan(0);
    });
  });
});
