const { LoggerService } = require('../src/services/loggerService');
const { createRequestContext, runWithRequestContext } = require('../src/services/requestContext');

// A logger instance that writes nothing to disk, so the spies below see every line the
// shared logger would have written during a request.
describe('log lines carry the active request', () => {
  let logger;
  let createEntrySpy;
  const context = createRequestContext({ requestId: 'req-log-1', method: 'POST', path: '/api/rfqs' });
  const requestFields = { requestId: 'req-log-1', requestMethod: 'POST', requestPath: '/api/rfqs' };

  beforeEach(() => {
    logger = new LoggerService({ isLocalLoggingEnabled: false });
    createEntrySpy = jest.spyOn(logger, 'createLogEntry');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('adds the request id, method and path to lines written during a request', () => {
    runWithRequestContext(context, () => logger.error('Database query failed', { queryId: 'q1' }, 'DATABASE_QUERY'));

    expect(createEntrySpy).toHaveBeenCalledWith(
      'ERROR',
      'Database query failed',
      { queryId: 'q1', ...requestFields },
      'DATABASE_QUERY'
    );
  });

  test('keeps a request id the caller already set on the line', () => {
    runWithRequestContext(context, () => logger.warn('Upstream call', { requestId: 'caller-owned-id' }, 'SYSTEM'));

    expect(createEntrySpy.mock.calls[0][2]).toEqual({
      requestId: 'caller-owned-id',
      requestMethod: 'POST',
      requestPath: '/api/rfqs',
    });
  });

  test('keeps an Error and its name on the line together with the request fields', () => {
    const error = new Error('boom');

    runWithRequestContext(context, () => logger.error('Failed to store', error, 'AUTH_SERVICE'));

    expect(createEntrySpy.mock.calls[0][2]).toEqual({ error, errorName: 'Error', ...requestFields });
  });

  test('gives a line without a metadata object the request fields alone', () => {
    runWithRequestContext(context, () => logger.info('No metadata', null, 'SYSTEM'));
    runWithRequestContext(context, () => logger.info('Array metadata', ['ignored'], 'SYSTEM'));

    expect(createEntrySpy.mock.calls[0][2]).toEqual(requestFields);
    expect(createEntrySpy.mock.calls[1][2]).toEqual(requestFields);
  });

  test('gives a line an Error with no metadata the request fields and the error', () => {
    const error = new Error('lone error');

    runWithRequestContext(context, () => logger.error('Lone error', error, 'SYSTEM'));

    expect(createEntrySpy.mock.calls[0][2]).toEqual({ error, errorName: 'Error', ...requestFields });
  });

  test('leaves lines written outside a request exactly as they were passed', () => {
    const meta = { orphan: true };

    logger.warn('Background work', meta, 'EVENT_OUTBOX');

    expect(createEntrySpy.mock.calls[0][2]).toBe(meta);
  });
});
