const request = require('supertest');
const app = require('../src/app');
const {
  clientErrorRateLimiter,
  validateClientError,
  rateLimiter,
} = require('../src/middleware/rateLimiter');

describe('Rate Limiter & Client Error Validation Middleware Suite', () => {
  beforeEach(() => {
    clientErrorRateLimiter.reset();
  });

  describe('clientErrorRateLimiter unit coverage', () => {
    test('getClientIp handles x-forwarded-for, req.ip, req.connection, and fallback', () => {
      let passedReq = null;
      const next = jest.fn();
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      // 1. x-forwarded-for with multiple IPs
      clientErrorRateLimiter(
        { headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18' } },
        res,
        next
      );
      expect(next).toHaveBeenCalledTimes(1);

      // 2. req.ip
      clientErrorRateLimiter(
        { ip: '192.168.1.1' },
        res,
        next
      );
      expect(next).toHaveBeenCalledTimes(2);

      // 3. req.connection.remoteAddress
      clientErrorRateLimiter(
        { connection: { remoteAddress: '10.0.0.1' } },
        res,
        next
      );
      expect(next).toHaveBeenCalledTimes(3);

      // 4. complete fallback
      clientErrorRateLimiter({}, res, next);
      expect(next).toHaveBeenCalledTimes(4);
    });

    test('window expiration resets count', () => {
      const now = Date.now();
      const originalNow = Date.now;
      try {
        Date.now = jest.fn(() => now);
        const req = { ip: '1.2.3.4' };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        clientErrorRateLimiter(req, res, next);

        // Advance past window (61 seconds)
        Date.now = jest.fn(() => now + 61000);
        clientErrorRateLimiter(req, res, next);
        expect(next).toHaveBeenCalledTimes(2);
      } finally {
        Date.now = originalNow;
      }
    });

    test('rate limiter blocks request when limit is exceeded and sets Retry-After header', () => {
      const oldLimit = process.env.CLIENT_ERROR_RATE_LIMIT;
      process.env.CLIENT_ERROR_RATE_LIMIT = '2';
      try {
        const req = { ip: '1.2.3.4' };
        const res = {
          setHeader: jest.fn(),
          status: jest.fn().mockReturnThis(),
          json: jest.fn(),
        };
        const next = jest.fn();

        clientErrorRateLimiter(req, res, next); // 1
        clientErrorRateLimiter(req, res, next); // 2
        clientErrorRateLimiter(req, res, next); // 3 (exceeded)

        expect(next).toHaveBeenCalledTimes(2);
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '60');
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ success: false, error: expect.stringMatching(/too many/i) })
        );
      } finally {
        process.env.CLIENT_ERROR_RATE_LIMIT = oldLimit;
      }
    });

    test('store pruning triggers when size exceeds 1000', () => {
      const now = Date.now();
      const originalNow = Date.now;
      try {
        Date.now = jest.fn(() => now);
        const next = jest.fn();
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        // Fill store with 1001 entries
        for (let i = 0; i <= 1005; i++) {
          clientErrorRateLimiter({ ip: `10.0.${Math.floor(i / 255)}.${i % 255}` }, res, next);
        }

        // Advance time to make them stale
        Date.now = jest.fn(() => now + 200000);
        clientErrorRateLimiter({ ip: '99.99.99.99' }, res, next);
        expect(next).toHaveBeenCalled();
      } finally {
        Date.now = originalNow;
      }
    });
  });

  describe('validateClientError unit coverage', () => {
    function runValidator(body) {
      let statusVal = null;
      let jsonVal = null;
      let nextCalled = false;
      const req = { body };
      const res = {
        status: (s) => {
          statusVal = s;
          return {
            json: (j) => {
              jsonVal = j;
            },
          };
        },
      };
      const next = () => {
        nextCalled = true;
      };

      validateClientError(req, res, next);
      return { status: statusVal, json: jsonVal, nextCalled, body: req.body };
    }

    test('rejects non-object or array body', () => {
      expect(runValidator(null).status).toBe(400);
      expect(runValidator('string').status).toBe(400);
      expect(runValidator([]).status).toBe(400);
    });

    test('rejects invalid message', () => {
      expect(runValidator({}).status).toBe(400);
      expect(runValidator({ message: '' }).status).toBe(400);
      expect(runValidator({ message: '   ' }).status).toBe(400);
      expect(runValidator({ message: 123 }).status).toBe(400);
      expect(runValidator({ message: 'a'.repeat(2001) }).status).toBe(400);
    });

    test('validates and normalizes level', () => {
      expect(runValidator({ message: 'ok', level: 123 }).status).toBe(400);
      expect(runValidator({ message: 'ok', level: 'INVALID' }).status).toBe(400);

      const resWarn = runValidator({ message: 'ok', level: 'warn' });
      expect(resWarn.status).toBeNull();
      expect(resWarn.nextCalled).toBe(true);
      expect(resWarn.body.level).toBe('WARN');

      const resDefault = runValidator({ message: 'ok' });
      expect(resDefault.body.level).toBe('ERROR');
    });

    test('validates and normalizes category', () => {
      expect(runValidator({ message: 'ok', category: 123 }).status).toBe(400);
      expect(runValidator({ message: 'ok', category: '  ' }).status).toBe(400);
      expect(runValidator({ message: 'ok', category: 'c'.repeat(65) }).status).toBe(400);

      const resGood = runValidator({ message: 'ok', category: 'CUSTOM_CAT ' });
      expect(resGood.status).toBeNull();
      expect(resGood.body.category).toBe('CUSTOM_CAT');

      const resDefault = runValidator({ message: 'ok' });
      expect(resDefault.body.category).toBe('CLIENT_ERROR');
    });

    test('validates metadata object, key count, and JSON payload size', () => {
      expect(runValidator({ message: 'ok', metadata: null }).status).toBe(400);
      expect(runValidator({ message: 'ok', metadata: 'string' }).status).toBe(400);
      expect(runValidator({ message: 'ok', metadata: [1, 2] }).status).toBe(400);

      // Too many keys (> 50)
      const bigMeta = {};
      for (let i = 0; i < 55; i++) bigMeta[`k${i}`] = i;
      expect(runValidator({ message: 'ok', metadata: bigMeta }).status).toBe(400);

      // JSON size exceeded (> 10000 bytes)
      const hugeMeta = { longStr: 'x'.repeat(10050) };
      expect(runValidator({ message: 'ok', metadata: hugeMeta }).status).toBe(400);

      // Unstringifiable / circular
      const circular = {};
      circular.self = circular;
      expect(runValidator({ message: 'ok', metadata: circular }).status).toBe(400);

      // Valid metadata
      const resOk = runValidator({ message: 'ok', metadata: { err: 'Timeout', code: 504 } });
      expect(resOk.status).toBeNull();
      expect(resOk.body.metadata).toEqual({ err: 'Timeout', code: 504 });
    });
  });

  describe('Integration with Express route: POST /api/logs/client-error', () => {
    test('public unauthenticated client can report client-error successfully', async () => {
      const res = await request(app)
        .post('/api/logs/client-error')
        .send({
          message: 'Early boot script failed to mount React root',
          level: 'fatal',
          category: 'BOOT_FAILURE',
          metadata: { route: '/buyer/login', userAgent: 'Chrome/120' },
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toBe('Early boot script failed to mount React root');
      expect(res.body.data.level).toBe('FATAL');
      expect(res.body.data.category).toBe('BOOT_FAILURE');
    });

    test('malformed payload returns 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/logs/client-error')
        .send({ level: 'INFO' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/message is required/i);
    });

    test('rate limiter blocks spamming client with 429', async () => {
      const oldLimit = process.env.CLIENT_ERROR_RATE_LIMIT;
      process.env.CLIENT_ERROR_RATE_LIMIT = '3';
      try {
        for (let i = 0; i < 3; i++) {
          await request(app)
            .post('/api/logs/client-error')
            .send({ message: `Log test ${i}` })
            .expect(201);
        }

        const resBlocked = await request(app)
          .post('/api/logs/client-error')
          .send({ message: 'Spam log' })
          .expect(429);

        expect(resBlocked.body.success).toBe(false);
        expect(resBlocked.body.error).toMatch(/too many/i);
        expect(resBlocked.headers['retry-after']).toBe('60');
      } finally {
        process.env.CLIENT_ERROR_RATE_LIMIT = oldLimit;
      }
    });
  });
});

