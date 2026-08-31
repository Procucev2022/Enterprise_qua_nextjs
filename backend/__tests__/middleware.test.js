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
