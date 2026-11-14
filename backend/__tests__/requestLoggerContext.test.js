const requestLogger = require('../src/middleware/logger');
const { logger: structuredLogger } = require('../src/services/loggerService');
const { getRequestContext, recordD1Statement } = require('../src/services/requestContext');

describe('request logger runs each request in a request context', () => {
  let originalEnv;
  let logSpy;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    logSpy = jest.spyOn(structuredLogger, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  /** A response that records the handlers the middleware registers. */
  function createResponse() {
    const handlers = {};
    const res = {
      statusCode: 200,
      writableEnded: false,
      setHeader: jest.fn(),
      on: jest.fn((event, handler) => {
        handlers[event] = handler;
      }),
    };
    return { res, handlers };
  }

  const request = (headers) => ({
    method: 'GET',
    originalUrl: '/api/rfqs?limit=5',
    ip: '::1',
    headers,
  });

  const lineFor = (text) => logSpy.mock.calls.find(([, message]) => message.includes(text));

  test('runs the handler inside the context and reports the D1 work the request caused', () => {
    const { res, handlers } = createResponse();
    let seenRequestId;

    requestLogger(request({ 'x-request-id': 'client-req-1' }), res, () => {
      seenRequestId = getRequestContext().requestId;
      recordD1Statement({ durationMs: 7, rowsRead: 9, rowsWritten: 0 });
    });
    handlers.finish();

    expect(seenRequestId).toBe('client-req-1');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'client-req-1');
    const [level, , metadata, category] = lineFor('-> 200');
    expect(level).toBe('INFO');
    expect(category).toBe('HTTP_REQUEST');
    expect(metadata).toEqual(expect.objectContaining({
      requestId: 'client-req-1',
      d1Queries: 1,
      d1RowsRead: 9,
      d1DurationMs: 7,
      d1Errors: 0,
      d1OverloadErrors: 0,
    }));
  });

  test('logs a 503 at ERROR with the overload count for that request', () => {
    const { res, handlers } = createResponse();
    requestLogger(request(undefined), res, () => {
      recordD1Statement({ failed: true, overloaded: true });
    });
    res.statusCode = 503;

    handlers.finish();

    const [level, , metadata] = lineFor('-> 503');
    expect(level).toBe('ERROR');
    expect(metadata).toEqual(expect.objectContaining({
      d1Errors: 1,
      d1OverloadErrors: 1,
      requestId: expect.stringMatching(/^req-/),
    }));
  });

  test('logs a 4xx at WARN', () => {
    const { res, handlers } = createResponse();
    requestLogger(request({}), res, () => {});
    res.statusCode = 404;

    handlers.finish();

    expect(lineFor('-> 404')[0]).toBe('WARN');
  });

  test('replaces a malformed client request id with a generated one', () => {
    const { res } = createResponse();
    requestLogger(request({ 'x-request-id': 'bad id with spaces!' }), res, () => {});

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', expect.stringMatching(/^req-[0-9a-f-]{36}$/));
  });

  test('copes with a request that carries no headers and a response that cannot set headers', () => {
    const res = { statusCode: 200, writableEnded: false, on: jest.fn() };
    const next = jest.fn();

    requestLogger({ method: 'GET', originalUrl: '/api/health' }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('records a connection that closes before a response with the D1 work it had done', () => {
    const { res, handlers } = createResponse();
    requestLogger(request({}), res, () => recordD1Statement({ durationMs: 2 }));

    handlers.close();

    const [level, message, metadata] = lineFor('connection closed');
    expect(level).toBe('WARN');
    expect(message).toContain('/api/rfqs');
    expect(metadata).toEqual(expect.objectContaining({ d1Queries: 1, d1DurationMs: 2 }));
  });

  test('stays silent when the connection closes after the response was finished', () => {
    const { res, handlers } = createResponse();
    requestLogger(request({}), res, () => {});
    res.writableEnded = true;

    handlers.close();

    expect(lineFor('connection closed')).toBeUndefined();
  });
});
