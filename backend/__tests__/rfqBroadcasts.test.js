const rfqController = require('../src/controllers/rfqController');
const storeService = require('../src/services/storeService');

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    send(content) {
      this.data = content;
      return this;
    },
  };
  return res;
}

describe('RFQ Information Broadcasts', () => {
  beforeEach(() => {
    jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue({ id: 'org-1' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getBroadcasts controller', () => {
    test('returns 404 if RFQ not found', async () => {
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(null);
      const req = {
        params: { id: 'rfq-none' },
        user: { role: 'buyer', id: 'buyer-1', buyerAccountId: 'org-1' },
      };
      const res = mockRes();
      const next = jest.fn();

      await rfqController.getBroadcasts(req, res, next);
      expect(res.statusCode).toBe(404);
      expect(res.data.success).toBe(false);
    });

    test('returns 404 if user cannot access RFQ', async () => {
      const mockRfq = { id: 'rfq-secret', buyerAccountId: 'org-other', broadcasts: [] };
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(mockRfq);
      const req = {
        params: { id: 'rfq-secret' },
        user: { role: 'buyer', id: 'buyer-1', buyerAccountId: 'org-1' },
      };
      const res = mockRes();
      const next = jest.fn();

      await rfqController.getBroadcasts(req, res, next);
      expect(res.statusCode).toBe(404);
      expect(res.data.success).toBe(false);
    });

    test('returns 200 with broadcasts list for authorized buyer', async () => {
      const mockBroadcasts = [
        {
          id: 'bcast-1',
          title: 'Addendum 1',
          message: 'Delivery milestone adjusted by 3 days',
          createdAt: new Date().toISOString(),
        },
      ];
      const mockRfq = { id: 'rfq-1', buyerAccountId: 'org-1', broadcasts: mockBroadcasts };
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(mockRfq);
      const req = {
        params: { id: 'rfq-1' },
        user: { role: 'buyer', id: 'buyer-1', buyerAccountId: 'org-1' },
      };
      const res = mockRes();
      const next = jest.fn();

      await rfqController.getBroadcasts(req, res, next);
      expect(res.statusCode).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.data).toEqual(mockBroadcasts);
    });

    test('invokes next(err) on unexpected exception', async () => {
      jest.spyOn(storeService, 'getRFQByIdAsync').mockRejectedValue(new Error('DB failure'));
      const req = {
        params: { id: 'rfq-err' },
        user: { role: 'buyer', id: 'buyer-1', buyerAccountId: 'org-1' },
      };
      const res = mockRes();
      const next = jest.fn();

      await rfqController.getBroadcasts(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('addBroadcast controller', () => {
    test('returns 400 if broadcast message is missing or blank', async () => {
      const req = {
        params: { id: 'rfq-1' },
        body: { message: '   ' },
        user: { role: 'buyer', id: 'buyer-1', buyerAccountId: 'org-1' },
      };
      const res = mockRes();
      const next = jest.fn();

      await rfqController.addBroadcast(req, res, next);
      expect(res.statusCode).toBe(400);
      expect(res.data.success).toBe(false);
      expect(res.data.error).toMatch(/required/i);
    });

    test('returns 404 if RFQ does not exist', async () => {
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(null);
      const req = {
        params: { id: 'rfq-missing' },
        body: { message: 'Important technical update' },
        user: { role: 'buyer', id: 'buyer-1', buyerAccountId: 'org-1' },
      };
      const res = mockRes();
      const next = jest.fn();

      await rfqController.addBroadcast(req, res, next);
      expect(res.statusCode).toBe(404);
      expect(res.data.success).toBe(false);
    });

    test('publishes broadcast and returns 201 with updated RFQ', async () => {
      const mockRfq = { id: 'rfq-1', rfqNumber: 'RFQ1001', buyerAccountId: 'org-1', broadcasts: [] };
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(mockRfq);
      const addBroadcastSpy = jest.spyOn(storeService, 'addBroadcastToRFQ').mockResolvedValue({
        broadcast: {
          id: 'bcast-new',
          rfqId: 'rfq-1',
          rfqNumber: 'RFQ1001',
          title: 'Drawing Revision C',
          message: 'Updated sheet 4 for pump dimensions',
          attachments: [{ id: 'att-1', fileName: 'rev_c.pdf', size: 1024 }],
          authorName: 'John Buyer',
          authorRole: 'buyer',
          createdAt: new Date().toISOString(),
        },
        updatedRfq: {
          ...mockRfq,
          broadcasts: [{ id: 'bcast-new' }],
        },
      });

      const req = {
        params: { id: 'rfq-1' },
        body: {
          title: 'Drawing Revision C',
          message: 'Updated sheet 4 for pump dimensions',
          attachments: [{ id: 'att-1', fileName: 'rev_c.pdf', size: 1024 }],
        },
        user: { role: 'buyer', id: 'buyer-1', name: 'John Buyer', email: 'john@buyer.com', buyerAccountId: 'org-1' },
      };
      const res = mockRes();
      const next = jest.fn();

      await rfqController.addBroadcast(req, res, next);
      expect(res.statusCode).toBe(201);
      expect(res.data.success).toBe(true);
      expect(res.data.data.title).toBe('Drawing Revision C');
      expect(res.data.data.attachments).toHaveLength(1);
      expect(addBroadcastSpy).toHaveBeenCalled();
    });

    test('returns 500 if storeService fails to persist broadcast', async () => {
      const mockRfq = { id: 'rfq-1', rfqNumber: 'RFQ1001', buyerAccountId: 'org-1', broadcasts: [] };
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(mockRfq);
      jest.spyOn(storeService, 'addBroadcastToRFQ').mockResolvedValue(null);

      const req = {
        params: { id: 'rfq-1' },
        body: { message: 'Some update' },
        user: { role: 'buyer', id: 'buyer-1', name: 'John Buyer', buyerAccountId: 'org-1' },
      };
      const res = mockRes();
      const next = jest.fn();

      await rfqController.addBroadcast(req, res, next);
      expect(res.statusCode).toBe(500);
      expect(res.data.success).toBe(false);
    });

    test('invokes next(err) on error', async () => {
      jest.spyOn(storeService, 'getRFQByIdAsync').mockRejectedValue(new Error('Fatal error'));
      const req = {
        params: { id: 'rfq-err' },
        body: { message: 'Broadcast' },
        user: { role: 'buyer', id: 'buyer-1', buyerAccountId: 'org-1' },
      };
      const res = mockRes();
      const next = jest.fn();

      await rfqController.addBroadcast(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('storeService.addBroadcastToRFQ', () => {
    test('returns null if RFQ does not exist', async () => {
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(null);
      const res = await storeService.addBroadcastToRFQ('missing', { message: 'hello' });
      expect(res).toBeNull();
    });

    test('appends broadcast and durably saves RFQ', async () => {
      const rfq = {
        id: 'rfq-store-1',
        rfqNumber: 'RFQ-ST-1',
        broadcasts: [{ id: 'b-existing', message: 'First' }],
      };
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(rfq);
      const updateSpy = jest.spyOn(storeService, 'updateRFQDurably').mockImplementation(async (id, updates) => {
        return { ...rfq, ...updates };
      });

      const result = await storeService.addBroadcastToRFQ('rfq-store-1', {
        title: 'Notice 2',
        message: 'Second broadcast',
        attachments: [{ id: 'att-2', fileName: 'spec.pdf' }],
        authorName: 'Category Manager',
        authorRole: 'category_manager',
      });

      expect(result).not.toBeNull();
      expect(result.broadcast.title).toBe('Notice 2');
      expect(result.broadcast.attachments).toHaveLength(1);
      expect(updateSpy).toHaveBeenCalledWith('rfq-store-1', expect.objectContaining({
        broadcasts: expect.arrayContaining([
          expect.objectContaining({ id: 'b-existing' }),
          expect.objectContaining({ title: 'Notice 2', message: 'Second broadcast' }),
        ]),
      }));
    });
  });
});
