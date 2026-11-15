const errorHandler = require('../src/middleware/errorHandler');
const { logger } = require('../src/services/loggerService');

describe('error handler log levels and detail', () => {
  let originalEnv;
  let errorSpy;
  let warnSpy;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  const req = {
    method: 'POST',
    originalUrl: '/api/rfqs?draft=1',
    path: '/api/rfqs',
    requestId: 'req-err-1',
    ip: '::1',
  };

  const createResponse = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    setHeader: jest.fn(),
  });

  test('logs a 4xx as a warning with its code and request id, and without a stack trace', () => {
    const err = Object.assign(new Error('Your 3 free trial RFQ credits have been fully used.'), {
      statusCode: 403,
      code: 'FREE_RFQ_CREDITS_EXHAUSTED',
    });

    errorHandler(err, req, createResponse(), jest.fn());

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'API Error 403: Your 3 free trial RFQ credits have been fully used.',
      expect.objectContaining({
        statusCode: 403,
        requestId: 'req-err-1',
        url: '/api/rfqs',
        errorCode: 'FREE_RFQ_CREDITS_EXHAUSTED',
        errorMessage: err.message,
        retryable: false,
        databaseOverloaded: false,
      }),
      'GLOBAL_ERROR_HANDLER'
    );
    expect(warnSpy.mock.calls[0][1]).not.toHaveProperty('stack');
  });

  test('logs a 5xx as an error with the stack trace and the raw message', () => {
    const err = new Error('unexpected failure');

    errorHandler(err, req, createResponse(), jest.fn());

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      'API Error 500: Internal Server Error',
      expect.objectContaining({
        statusCode: 500,
        errorMessage: 'unexpected failure',
        clientMessage: 'Internal Server Error',
        stack: err.stack,
      }),
      'GLOBAL_ERROR_HANDLER'
    );
  });

  test('marks a D1 overload as retryable in both the log and the response', () => {
    const res = createResponse();

    errorHandler(new Error('D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window'), req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '15');
    expect(errorSpy).toHaveBeenCalledWith(
      'API Error 503: The database is busy handling other requests. Please retry in a few seconds.',
      expect.objectContaining({ databaseOverloaded: true, retryable: true, stack: expect.any(String) }),
      'GLOBAL_ERROR_HANDLER'
    );
  });
});
