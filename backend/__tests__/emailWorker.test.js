const { handleEmail, readRawStreamToBuffer } = require('../src/workers/emailWorker');
const emailIngestionService = require('../src/services/emailIngestionService');
const rfqIngestionService = require('../src/services/rfqIngestionService');
const geminiService = require('../src/services/geminiService');
const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const pool = require('../src/db/pool');
const { EMAIL_INGESTION_STATUS } = require('../src/config/constants');
const { EventEmitter } = require('events');

jest.mock('../src/services/emailIngestionService');
jest.mock('../src/services/rfqIngestionService');
jest.mock('../src/services/geminiService');
jest.mock('../src/services/storeService');
jest.mock('../src/services/mailerService');
jest.mock('../src/db/pool');
jest.mock('../src/services/loggerService', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('Cloudflare Email Worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('readRawStreamToBuffer helper', () => {
    test('handles empty or falsy raw inputs', async () => {
      expect((await readRawStreamToBuffer(null)).length).toBe(0);
      expect((await readRawStreamToBuffer(undefined)).length).toBe(0);
    });

    test('handles Buffer directly', async () => {
      const buf = Buffer.from('hello world');
      const res = await readRawStreamToBuffer(buf);
      expect(res).toBe(buf);
    });

    test('handles ArrayBuffer', async () => {
      const uint8 = new Uint8Array([1, 2, 3]);
      const res = await readRawStreamToBuffer(uint8.buffer);
      expect(Buffer.isBuffer(res)).toBe(true);
      expect(res[0]).toBe(1);
    });

    test('handles Web Stream ReadableStream', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('stream content'));
          controller.close();
        },
      });
      const res = await readRawStreamToBuffer(stream);
      expect(res.toString()).toBe('stream content');
    });

    test('handles Node Readable stream events', async () => {
      const emitter = new EventEmitter();
      const promise = readRawStreamToBuffer(emitter);
      emitter.emit('data', Buffer.from('chunk1'));
      emitter.emit('data', 'chunk2');
      emitter.emit('end');
      const res = await promise;
      expect(res.toString()).toBe('chunk1chunk2');
    });

    test('handles Node Readable stream error', async () => {
      const emitter = new EventEmitter();
      const promise = readRawStreamToBuffer(emitter);
      const testErr = new Error('stream exploded');
      emitter.emit('error', testErr);
      await expect(promise).rejects.toThrow('stream exploded');
    });

    test('falls through to Node stream handling if Response construction fails', async () => {
      const lockedStream = new ReadableStream();
      lockedStream.getReader(); // locks stream so new Response() throws
      lockedStream.on = (event, cb) => {
        if (event === 'data') cb(Buffer.from('fallback'));
        if (event === 'end') cb();
      };
      const res = await readRawStreamToBuffer(lockedStream);
      expect(res.toString()).toBe('fallback');
    });

    test('handles non-stream primitive values', async () => {
      const res = await readRawStreamToBuffer(12345);
      expect(res.toString()).toBe('12345');
    });
  });

  describe('handleEmail', () => {
    test('rejects email if from address is missing', async () => {
      const message = {
        from: '',
        to: 'rfq@procucev.com',
        setReject: jest.fn(),
      };

      const result = await handleEmail(message);

      expect(message.setReject).toHaveBeenCalledWith('Sender address is missing.');
      expect(result.outcome).toBe('REJECTED_NO_SENDER');
    });

    test('handles missing from address without setReject function', async () => {
      const message = {
        from: null,
      };

      const result = await handleEmail(message);
      expect(result.outcome).toBe('REJECTED_NO_SENDER');
    });

    test('initializes database pool when env bindings are present', async () => {
      const env = { HYPERDRIVE: { connectionString: 'hyperdrive-url' } };
      const message = { from: '' };
      await handleEmail(message, env);
      expect(pool.initFromEnv).toHaveBeenCalledWith(env);
    });

    test('ignores emails with NO_CONTENT status', async () => {
      const message = {
        from: 'buyer@example.com',
        to: 'rfq@procucev.com',
        raw: Buffer.from('empty email'),
        headers: {
          get: jest.fn((k) => (k === 'message-id' ? 'msg-123' : null)),
        },
      };

      emailIngestionService.prepareEmailForExtraction.mockResolvedValue({
        status: EMAIL_INGESTION_STATUS.NO_CONTENT,
      });

      const result = await handleEmail(message);

      expect(result.outcome).toBe('IGNORED_NO_CONTENT');
      expect(result.messageId).toBe('msg-123');
    });

    test('sends registration notification for unauthorized buyer', async () => {
      const message = {
        from: 'unregistered@example.com',
        to: 'rfq@procucev.com',
        raw: Buffer.from('rfq text'),
        headers: {
          get: jest.fn(() => null),
        },
      };

      emailIngestionService.prepareEmailForExtraction.mockResolvedValue({
        status: 'READY',
        message: { subject: 'Inquiry for laptops' },
      });
      storeService.getBuyerAccountByEmail.mockResolvedValue(null);
      mailerService.sendUnauthorizedBuyerNotificationEmail.mockResolvedValue({ success: true });

      const result = await handleEmail(message);

      expect(storeService.getBuyerAccountByEmail).toHaveBeenCalledWith('unregistered@example.com');
      expect(mailerService.sendUnauthorizedBuyerNotificationEmail).toHaveBeenCalledWith(
        'unregistered@example.com',
        {
          subject: 'Inquiry for laptops',
        }
      );
      expect(result.outcome).toBe('UNAUTHORIZED_BUYER_NOTIFICATION_SENT');
    });

    test('handles mailer service failure gracefully for unauthorized buyer', async () => {
      const message = {
        from: 'unregistered2@example.com',
        to: 'rfq@procucev.com',
        raw: Buffer.from('rfq text'),
      };

      emailIngestionService.prepareEmailForExtraction.mockResolvedValue({
        status: 'READY',
        message: null,
      });
      storeService.getBuyerAccountByEmail.mockResolvedValue(null);
      mailerService.sendUnauthorizedBuyerNotificationEmail.mockRejectedValue(new Error('SMTP down'));

      const result = await handleEmail(message);

      expect(mailerService.sendUnauthorizedBuyerNotificationEmail).toHaveBeenCalledWith(
        'unregistered2@example.com',
        {
          subject: 'Enterprise QUA - Buyer Registration Required',
        }
      );
      expect(result.outcome).toBe('UNAUTHORIZED_BUYER_NOTIFICATION_SENT');
    });

    test('extracts line items and creates RFQ for authorized buyer', async () => {
      const message = {
        from: 'buyer@corp.com',
        to: 'rfq@procucev.com',
        raw: Buffer.from('Order 50 Dell Laptops'),
        headers: {
          get: jest.fn(() => '<msg-456@corp.com>'),
        },
      };

      const mockBuyer = { id: 'buyer-001', companyName: 'Corp Global' };
      emailIngestionService.prepareEmailForExtraction.mockResolvedValue({
        status: 'READY',
        extractionInput: { text: 'Order 50 Dell Laptops' },
        message: { subject: 'Urgent Laptop RFQ' },
      });
      storeService.getBuyerAccountByEmail.mockResolvedValue(mockBuyer);
      geminiService.extractLineItems.mockResolvedValue({
        lineItems: [{ title: 'Dell Laptop', qty: 50 }],
        category: 'IT Hardware',
        estimatedBudget: 500000,
      });
      rfqIngestionService.buildRFQDraft.mockResolvedValue({
        draft: { title: 'Urgent Laptop RFQ', lineItems: [{ title: 'Dell Laptop', qty: 50 }] },
      });
      storeService.createRFQ.mockResolvedValue({ id: 'RFQ-99901' });

      const result = await handleEmail(message);

      expect(geminiService.extractLineItems).toHaveBeenCalledWith({ text: 'Order 50 Dell Laptops' });
      expect(rfqIngestionService.buildRFQDraft).toHaveBeenCalled();
      expect(storeService.createRFQ).toHaveBeenCalled();
      expect(result).toEqual({
        outcome: 'RFQ_CREATED',
        rfqId: 'RFQ-99901',
        buyerId: 'buyer-001',
        messageId: '<msg-456@corp.com>',
      });
    });

    test('handles authorized buyer when created RFQ has rfqId property instead of id', async () => {
      const message = {
        from: 'buyer@corp.com',
        to: 'rfq@procucev.com',
        raw: Buffer.from('Order'),
      };

      const mockBuyer = { id: 'buyer-002', companyName: 'Corp Two' };
      emailIngestionService.prepareEmailForExtraction.mockResolvedValue({
        status: 'READY',
        extractionInput: { text: 'Order' },
      });
      storeService.getBuyerAccountByEmail.mockResolvedValue(mockBuyer);
      geminiService.extractLineItems.mockResolvedValue(null);
      rfqIngestionService.buildRFQDraft.mockResolvedValue({ draft: {} });
      storeService.createRFQ.mockResolvedValue({ rfqId: 'RFQ-ALT-88' });

      const result = await handleEmail(message);
      expect(result.rfqId).toBe('RFQ-ALT-88');
    });

    test('handles top-level exception and returns ERROR outcome', async () => {
      const message = {
        from: 'buyer@corp.com',
        raw: Buffer.from('boom'),
      };

      emailIngestionService.prepareEmailForExtraction.mockRejectedValue(new Error('Parser failure'));

      const result = await handleEmail(message);

      expect(result.outcome).toBe('ERROR');
      expect(result.error).toBe('Parser failure');
    });

    test('handles invocation with completely default arguments', async () => {
      const result = await handleEmail();
      expect(result.outcome).toBe('REJECTED_NO_SENDER');
    });
  });
});
