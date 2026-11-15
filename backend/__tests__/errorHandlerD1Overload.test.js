jest.mock('../src/services/loggerService', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const errorHandler = require('../src/middleware/errorHandler');
const { logger } = require('../src/services/loggerService');
const { D1_OVERLOAD_CONFIG } = require('../src/config/constants');

const D1_OVERLOAD_TEXT = 'D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window.';

function makeResponse() {
  const res = { setHeader: jest.fn(), status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function handle(err) {
  const res = makeResponse();
  errorHandler(err, { method: 'GET', path: '/api/vendor-ingestion/session', requestId: 'req-9' }, res, jest.fn());
  return res;
}

describe('errorHandler with D1 overload', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.clearAllMocks();
  });

  test('answers a D1 overload with a retryable 503 and Retry-After', () => {
    const res = handle(new Error(D1_OVERLOAD_TEXT));
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', String(D1_OVERLOAD_CONFIG.RETRY_AFTER_SECONDS));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      retryable: true,
      error: D1_OVERLOAD_CONFIG.MESSAGE,
    }));
  });

  test('does not expose the database error text to the client', () => {
    const res = handle(new Error(D1_OVERLOAD_TEXT));
    const body = res.json.mock.calls[0][0];
    expect(JSON.stringify(body)).not.toContain('D1_ERROR');
    expect(JSON.stringify(body)).not.toContain('overloaded');
  });

  test('keeps the original database error in the structured log', () => {
    handle(new Error(D1_OVERLOAD_TEXT));
    const [message, metadata] = logger.error.mock.calls[0];
    expect(message).toBe(`API Error 503: ${D1_OVERLOAD_CONFIG.MESSAGE}`);
    expect(metadata.stack).toContain('D1 DB is overloaded');
    expect(metadata.statusCode).toBe(503);
  });

  test('leaves unrelated internal errors as a generic 500', () => {
    const res = handle(new Error('column "foo" does not exist'));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Internal Server Error' }));
    expect(res.json.mock.calls[0][0].retryable).toBeUndefined();
  });

  test('does not treat another provider rate limit as a database overload', () => {
    const res = handle(new Error('Gemini rate limit exceeded for this key'));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  test('keeps an explicit status that the error already carries', () => {
    const err = Object.assign(new Error(D1_OVERLOAD_TEXT), { statusCode: 409 });
    const res = handle(err);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].retryable).toBeUndefined();
  });

  test('shows the underlying message for unrelated 500 errors only in development', () => {
    process.env.NODE_ENV = 'development';
    const res = handle(new Error('debug detail'));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'debug detail' }));
  });
});
