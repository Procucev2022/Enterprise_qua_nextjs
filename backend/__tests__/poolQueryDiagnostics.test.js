const dbPool = require('../src/db/pool');
const { logger } = require('../src/services/loggerService');
const { createRequestContext, runWithRequestContext } = require('../src/services/requestContext');

const OVERLOAD_MESSAGE = 'D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window';

/** A Workers-style D1 binding whose prepared statements resolve or reject with the given `all`. */
function d1Binding(all) {
  return {
    DB: {
      prepare: jest.fn(() => ({
        bind: jest.fn(() => ({ all })),
        all,
      })),
    },
  };
}

function failureLine(spy) {
  return spy.mock.calls.find(([message]) => message === 'Database query failed');
}

describe('query failure diagnostics', () => {
  let originalPool;
  let originalBinding;
  let errorSpy;
  let infoSpy;

  beforeEach(() => {
    originalPool = dbPool.pool;
    originalBinding = globalThis.__CF_ENV__;
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    dbPool.pool = originalPool;
    if (originalBinding === undefined) delete globalThis.__CF_ENV__;
    else globalThis.__CF_ENV__ = originalBinding;
    jest.restoreAllMocks();
  });

  test('records the operation, a redacted SQL preview, the overload state and the attempts of a failed D1 query', async () => {
    const overload = new Error(OVERLOAD_MESSAGE);
    globalThis.__CF_ENV__ = d1Binding(jest.fn().mockRejectedValue(overload));
    const context = createRequestContext({ requestId: 'req-diag-1', method: 'GET', path: '/api/vendors' });

    await expect(runWithRequestContext(context, () => dbPool.query(
      "SELECT id FROM vendors WHERE email = $1 AND note = 'secret-literal'",
      ['someone@example.com'],
      { d1: true }
    ))).rejects.toBe(overload);

    expect(failureLine(errorSpy)[1]).toEqual(expect.objectContaining({
      operation: 'SELECT',
      table: 'vendors',
      sqlPreview: "SELECT id FROM vendors WHERE email = $1 AND note = '?'",
      parameterCount: 1,
      provider: 'cloudflare-d1',
      // An overload is retryable by the client after a pause, and it is never retried inside the Worker.
      retryable: true,
      overloaded: true,
      attempts: 1,
      errorName: 'Error',
    }));
    expect(failureLine(errorSpy)[1]).not.toHaveProperty('undefinedParameterIndexes');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret-literal');
    expect(context.d1).toEqual(expect.objectContaining({ queries: 1, errors: 1, overloadErrors: 1 }));
  });

  test('names the bind positions that were undefined and the SQLite code of a D1 type error', async () => {
    const typeError = new Error("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined' (SQLITE_MISMATCH)");
    globalThis.__CF_ENV__ = d1Binding(jest.fn().mockRejectedValue(typeError));

    await expect(dbPool.query(
      'insert into buyer_accounts (id, name, org_uuid) values ($1, $2, $3)',
      ['account-1', undefined, 'org-1'],
      { d1: true }
    )).rejects.toBe(typeError);

    expect(failureLine(errorSpy)[1]).toEqual(expect.objectContaining({
      operation: 'INSERT',
      table: 'buyer_accounts',
      undefinedParameterIndexes: [2],
      sqliteErrorCode: 'SQLITE_MISMATCH',
      retryable: false,
      overloaded: false,
      attempts: 1,
    }));
  });

  test('reports a transient error as retryable with the attempts it used', async () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    const transient = new Error('D1 storage temporarily unavailable');
    globalThis.__CF_ENV__ = d1Binding(jest.fn().mockRejectedValue(transient));

    await expect(dbPool.query('select id from rfqs', [], { d1: true })).rejects.toBe(transient);

    expect(failureLine(errorSpy)[1]).toEqual(expect.objectContaining({
      operation: 'SELECT',
      retryable: true,
      overloaded: false,
      attempts: 3,
    }));
    expect(failureLine(errorSpy)[1]).not.toHaveProperty('undefinedParameterIndexes');
    random.mockRestore();
  });

  test('keeps the PostgreSQL error code and marks no D1 state on a Neon failure', async () => {
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    dbPool.pool = { query: jest.fn().mockRejectedValue(pgError) };

    await expect(dbPool.query('insert into rfqs (id) values ($1)', ['rfq-1'])).rejects.toBe(pgError);

    expect(failureLine(errorSpy)[1]).toEqual(expect.objectContaining({
      provider: 'postgres',
      errorCode: '23505',
      operation: 'INSERT',
      retryable: false,
      overloaded: false,
    }));
    expect(failureLine(errorSpy)[1].sqliteErrorCode).toBeUndefined();
  });

  test('cuts a long statement preview to the configured length', async () => {
    const longSql = `SELECT ${'column_name, '.repeat(40)}last_column FROM vendors`;
    dbPool.pool = { query: jest.fn().mockRejectedValue(new Error('timeout')) };

    await expect(dbPool.query(longSql, [])).rejects.toThrow('timeout');

    const { sqlPreview } = failureLine(errorSpy)[1];
    expect(sqlPreview).toHaveLength(303);
    expect(sqlPreview.endsWith('...')).toBe(true);
  });

  test('adds the rows a successful slow D1 query read to the request and previews its SQL', async () => {
    const originalThreshold = dbPool.queryAuditor.slowQueryThresholdMs;
    dbPool.queryAuditor.slowQueryThresholdMs = 0;
    const all = jest.fn().mockResolvedValue({ results: [{ id: 1 }], meta: { rows_read: 4, rows_written: 0, changes: 0 } });
    globalThis.__CF_ENV__ = d1Binding(all);
    const context = createRequestContext({ requestId: 'req-diag-2', method: 'GET', path: '/api/rfqs' });

    try {
      await runWithRequestContext(context, () => dbPool.query('SELECT id FROM rfqs WHERE id = $1', ['rfq-9'], { d1: true }));
    } finally {
      dbPool.queryAuditor.slowQueryThresholdMs = originalThreshold;
    }

    expect(infoSpy).toHaveBeenCalledWith('D1 query completed', expect.objectContaining({
      slow: true,
      operation: 'SELECT',
      sqlPreview: 'SELECT id FROM rfqs WHERE id = $1',
    }), 'DATABASE_QUERY');
    expect(context.d1).toEqual(expect.objectContaining({ queries: 1, errors: 0, rowsRead: 4 }));
  });
});
