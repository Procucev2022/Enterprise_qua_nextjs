const logger = require('../src/middleware/logger');
const errorHandler = require('../src/middleware/errorHandler');

describe('Middleware Unit Tests', () => {
  test('logger logs request duration on response finish when not test env', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const req = { method: 'GET', originalUrl: '/api/test', headers: { 'x-request-id': 'request-fixture-1' } };
    let finishHandler;
    const res = {
      statusCode: 200,
      writableEnded: true,
      setHeader: jest.fn(),
      on: jest.fn((event, handler) => {
        if (event === 'finish') finishHandler = handler;
      }),
    };
    const next = jest.fn();

    logger(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.requestId).toBe('request-fixture-1');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'request-fixture-1');
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
    expect(res.json).toHaveBeenLastCalledWith(
      expect.objectContaining({ error: 'Internal Server Error' })
    );

    process.env.NODE_ENV = originalEnv;
  });

  test('errorHandler preserves parser status codes and strips query data from logs', () => {
    const { logger: structuredLogger } = require('../src/services/loggerService');
    const errorSpy = jest.spyOn(structuredLogger, 'error').mockImplementation(() => undefined);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const req = {
      method: 'POST',
      originalUrl: '/graphql?query=private-value',
      path: '/graphql',
      requestId: 'request-test-1',
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    errorHandler(Object.assign(new Error('request entity too large'), { status: 413 }), req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'request entity too large' }));
    expect(errorSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ url: '/graphql', requestId: 'request-test-1' }),
      'GLOBAL_ERROR_HANDLER'
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('private-value');
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    process.env.NODE_ENV = originalEnv;
  });

  test('uses a safe console fallback only when structured error logging fails', () => {
    const { logger: structuredLogger } = require('../src/services/loggerService');
    const errorSpy = jest.spyOn(structuredLogger, 'error').mockImplementation(() => {
      throw { message: 'logger unavailable' };
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const req = { method: 'POST', path: '/api/test', requestId: 'request-fallback-1' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    errorHandler(new Error('database failed for private@example.com'), req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[GLOBAL_ERROR_HANDLER] Structured logging failed',
      expect.objectContaining({ requestId: 'request-fallback-1', statusCode: 500, loggingErrorName: 'Error' })
    );
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain('private@example.com');

    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    process.env.NODE_ENV = originalEnv;
  });

  test('uses a safe client-error message when the status and request path are sparse', () => {
    const { logger: structuredLogger } = require('../src/services/loggerService');
    const errorSpy = jest.spyOn(structuredLogger, 'error').mockImplementation(() => undefined);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    errorHandler(Object.assign(new Error(''), { status: 400 }), { method: 'GET' }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Request failed.' }));
    expect(errorSpy).toHaveBeenCalledWith(
      'API Error 400: Request failed.',
      expect.objectContaining({ url: '', statusCode: 400 }),
      'GLOBAL_ERROR_HANDLER'
    );

    errorSpy.mockRestore();
    process.env.NODE_ENV = originalEnv;
  });

  test('errorHandler exposes service-level 503/502/504 errors, codes, details and dev mode messages', () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const err503 = Object.assign(new Error('Cloudflare D1 is temporarily unavailable'), {
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
      details: { retryAfter: 5 },
    });
    errorHandler(err503, { method: 'POST', path: '/rfqs' }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: 'Cloudflare D1 is temporarily unavailable',
      code: 'DATABASE_UNAVAILABLE',
      details: { retryAfter: 5 },
    }));

    const empty503 = Object.assign(new Error(''), { statusCode: 503 });
    errorHandler(empty503, { method: 'GET', path: '/health' }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Service temporarily unavailable. Please retry.',
    }));

    const exposed500 = Object.assign(new Error('Exposed internal error'), { statusCode: 500, expose: true });
    errorHandler(exposed500, { method: 'GET', path: '/api' }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Exposed internal error',
    }));

    process.env.NODE_ENV = 'development';
    const dev500 = Object.assign(new Error('Detailed crash reason'), { statusCode: 500 });
    errorHandler(dev500, { method: 'GET', path: '/api' }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Detailed crash reason',
    }));

    const badStatusErr = Object.assign(new Error('Bad status code test'), { statusCode: 999 });
    errorHandler(badStatusErr, { method: 'GET', path: '/api' }, res, jest.fn());
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

  test('omits query string secrets from request logs', () => {
    const logSpy = jest.spyOn(structuredLogger, 'log').mockImplementation(() => {});
    let finishHandler;
    const req = {
      method: 'GET',
      originalUrl: '/api/auth/verify?code=654321&email=person%40example.com',
    };
    const res = {
      statusCode: 200,
      writableEnded: true,
      on: jest.fn((event, handler) => {
        if (event === 'finish') finishHandler = handler;
      }),
    };

    logger(req, res, jest.fn());
    finishHandler();

    const [level, message, metadata] = logSpy.mock.calls[0];
    expect(level).toBe('INFO');
    expect(message).toContain('/api/auth/verify');
    expect(message).not.toContain('654321');
    expect(message).not.toContain('person%40example.com');
    expect(metadata.url).toBe('/api/auth/verify');
    expect(JSON.stringify(metadata)).not.toContain('654321');
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
