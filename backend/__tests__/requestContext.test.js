const {
  createRequestContext,
  runWithRequestContext,
  getRequestContext,
  recordD1Statement,
  summarizeD1Counters,
} = require('../src/services/requestContext');

describe('request context', () => {
  test('starts every D1 counter at zero for a new request', () => {
    const context = createRequestContext({ requestId: 'req-1', method: 'GET', path: '/api/rfqs' });

    expect(context).toEqual({
      requestId: 'req-1',
      requestMethod: 'GET',
      requestPath: '/api/rfqs',
      d1: { queries: 0, errors: 0, overloadErrors: 0, rowsRead: 0, rowsWritten: 0, durationMs: 0 },
    });
  });

  test('is visible to work started inside the request, including work after an await', async () => {
    const context = createRequestContext({ requestId: 'req-2', method: 'POST', path: '/api/x' });
    expect(getRequestContext()).toBeUndefined();

    const seen = await runWithRequestContext(context, async () => {
      await new Promise((resolve) => setImmediate(resolve));
      return getRequestContext();
    });

    expect(seen).toBe(context);
    expect(getRequestContext()).toBeUndefined();
  });

  test('counts each statement and its failures into the active request', () => {
    const context = createRequestContext({ requestId: 'req-3', method: 'GET', path: '/' });

    runWithRequestContext(context, () => {
      recordD1Statement({ durationMs: 12, rowsRead: 40, rowsWritten: 2 });
      recordD1Statement({ durationMs: 3, failed: true });
      recordD1Statement({ durationMs: 1, failed: true, overloaded: true });
    });

    expect(context.d1).toEqual({
      queries: 3,
      errors: 2,
      overloadErrors: 1,
      rowsRead: 40,
      rowsWritten: 2,
      durationMs: 16,
    });
  });

  test('ignores measurements that are not finite numbers', () => {
    const context = createRequestContext({ requestId: 'req-4', method: 'GET', path: '/' });

    runWithRequestContext(context, () => recordD1Statement({ durationMs: NaN, rowsRead: undefined, rowsWritten: 'n/a' }));

    expect(context.d1).toEqual({ queries: 1, errors: 0, overloadErrors: 0, rowsRead: 0, rowsWritten: 0, durationMs: 0 });
  });

  test('does nothing outside a request, or in a context that has no counters', () => {
    expect(() => recordD1Statement()).not.toThrow();
    expect(() => recordD1Statement({ durationMs: 5 })).not.toThrow();

    const bare = { requestId: 'req-bare' };
    runWithRequestContext(bare, () => recordD1Statement({ durationMs: 5 }));
    expect(bare).toEqual({ requestId: 'req-bare' });
  });

  test('names the totals with the access-log field names', () => {
    const context = createRequestContext({ requestId: 'req-5', method: 'GET', path: '/' });
    runWithRequestContext(context, () => recordD1Statement({ durationMs: 4, rowsRead: 8, rowsWritten: 1, failed: true }));

    expect(summarizeD1Counters(context)).toEqual({
      d1Queries: 1,
      d1Errors: 1,
      d1OverloadErrors: 0,
      d1RowsRead: 8,
      d1RowsWritten: 1,
      d1DurationMs: 4,
    });
  });

  test('summarizes nothing when there is no context or no counters', () => {
    expect(summarizeD1Counters(undefined)).toEqual({});
    expect(summarizeD1Counters({ requestId: 'no-counters' })).toEqual({});
  });
});
