const logger = require('../src/middleware/logger');
const errorHandler = require('../src/middleware/errorHandler');

describe('Middleware Unit Tests', () => {
  test('logger logs request duration on response finish when not test env', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const req = { method: 'GET', originalUrl: '/api/test' };
    let finishHandler;
    const res = {
      statusCode: 200,
      writableEnded: true,
      on: jest.fn((event, handler) => {
        if (event === 'finish') finishHandler = handler;
      }),
    };
    const next = jest.fn();

    logger(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(finishHandler).toBeDefined();

    finishHandler();

    res.statusCode = 302;
    finishHandler();

    res.statusCode = 404;
    finishHandler();

    res.statusCode = 500;
    finishHandler();

    process.env.NODE_ENV = 'test';
    logger(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);

    process.env.NODE_ENV = originalEnv;
  });

  test('errorHandler formats error response with custom statusCode and dev stack', () => {
    const err = new Error('Custom Validation Error');
    err.statusCode = 400;
    const req = { method: 'POST', originalUrl: '/api/test' };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'Custom Validation Error',
      })
    );

    process.env.NODE_ENV = 'production';
    errorHandler(new Error(), req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);

    process.env.NODE_ENV = originalEnv;
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Hung / aborted request visibility
//
// Only 'finish' used to be observed, so a request that never produced a response
// left no trace and the log could not even confirm it had arrived.
// ══════════════════════════════════════════════════════════════════════════════
describe('requestLogger connection-close reporting', () => {
  const { logger: structuredLogger } = require('../src/services/loggerService');

  /** Captures both handlers the middleware registers. */
  function attach(res) {
    const handlers = {};
    res.on = jest.fn((event, handler) => {
      handlers[event] = handler;
    });
    logger({ method: 'POST', originalUrl: '/api/rfqs/extract', ip: '::1' }, res, jest.fn());
    return handlers;
  }

  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  test('reports a connection that closed before any response was written', () => {
    const logSpy = jest.spyOn(structuredLogger, 'log').mockImplementation(() => {});
    const res = { statusCode: 200, writableEnded: false };

    attach(res).close();

    const [level, message, metadata, category] = logSpy.mock.calls[0];
    expect(level).toBe('WARN');
    expect(message).toContain('/api/rfqs/extract');
    expect(message).toContain('closed with no response');
    expect(metadata.url).toBe('/api/rfqs/extract');
    expect(category).toBe('HTTP_REQUEST');
  });

  // 'close' always follows 'finish', so a completed response must not be reported
  // twice or mislabelled as a hang.
  test('stays quiet when the response completed normally', () => {
    const logSpy = jest.spyOn(structuredLogger, 'log').mockImplementation(() => {});
    const res = { statusCode: 200, writableEnded: true };

    attach(res).close();

    expect(logSpy).not.toHaveBeenCalled();
  });
});
