const errorHandler = require('../src/middleware/errorHandler');
const requestLogger = require('../src/middleware/logger');

describe('Middleware Unit Tests', () => {
  describe('errorHandler', () => {
    test('handles standard error object with custom status code', () => {
      const err = new Error('Custom failure');
      err.statusCode = 403;
      const req = { method: 'GET', originalUrl: '/test' };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      errorHandler(err, req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Custom failure',
        })
      );
    });

    test('defaults to 500 when statusCode is missing', () => {
      const err = new Error('Unexpected crash');
      const req = { method: 'POST', originalUrl: '/crash' };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      errorHandler(err, req, res, next);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Unexpected crash',
        })
      );
    });
  });

  describe('requestLogger', () => {
    test('passes through to next() middleware in test environment', () => {
      const req = { method: 'GET', originalUrl: '/api/rfqs' };
      const res = { on: jest.fn(), statusCode: 200 };
      const next = jest.fn();

      requestLogger(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('registers on finish listener when NODE_ENV is development', () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const req = { method: 'GET', originalUrl: '/api/test' };
      let finishCallback;
      const res = {
        on: jest.fn((event, cb) => {
          if (event === 'finish') finishCallback = cb;
        }),
        statusCode: 200,
      };
      const next = jest.fn();

      requestLogger(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(typeof finishCallback).toBe('function');
      finishCallback(); // Trigger finish log

      res.statusCode = 404;
      finishCallback();

      res.statusCode = 500;
      finishCallback();

      process.env.NODE_ENV = origEnv;
    });
  });
});
