const auditLogQueries = require('../src/db/auditLogQueries');
const pool = require('../src/db/pool');
const d1Bridge = require('../src/db/d1Bridge');
const { queryCache } = require('../src/db/queryCache');
const { logger } = require('../src/services/loggerService');
const { sealAuditEntry } = require('../src/services/auditService');
const { AUDIT_CHAIN_VERIFY_PAGE_SIZE, AUDIT_CHAIN_VERIFY_MAX_ROWS } = require('../src/config/constants');

const pendingEntry = {
  id: 'audit-entry-1',
  timestamp: '2026-11-05 00:00:00 UTC',
  userEmail: 'buyer@example.test',
  action: 'Created an RFQ',
  rfqNumber: 'RFQ-AUDIT-1',
  previousHash: 'stale-cache-hash',
  shaSignature: 'stale-signature',
  status: 'TAMPER_CHECK_OK',
  ipAddress: '127.0.0.1',
};

describe('database-serialized audit-chain appends', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    queryCache.clear();
  });

  test('returns null when no database is configured', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    await expect(auditLogQueries.appendAuditLogInDB(pendingEntry)).resolves.toBeNull();
  });

  test('rejects D1 HTTP persistence because it cannot atomically update the head and append the entry', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue({ _isHttpClient: true });
    const loggerSpy = jest.spyOn(logger, 'error');

    await expect(auditLogQueries.appendAuditLogInDB(pendingEntry)).rejects.toMatchObject({
      code: 'ATOMIC_D1_BATCH_REQUIRED',
      statusCode: 503,
    });
    expect(loggerSpy).toHaveBeenCalledWith('Durable audit-chain append failed', expect.any(Object), 'AUDIT_CHAIN');
  });

  test('appends a D1 row using the authoritative head and invalidates cached audit reads', async () => {
    const binding = { batch: jest.fn() };
    const canonicalEntry = sealAuditEntry(pendingEntry, 'authoritative-head');
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
    const querySpy = jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ head_hash: 'authoritative-head', revision: 4 }] });
    const batchSpy = jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
      { rows: [{ head_hash: canonicalEntry.shaSignature }], rowCount: 1 },
      { rows: [{ raw: JSON.stringify(canonicalEntry) }], rowCount: 1 },
    ]);
    const invalidateSpy = jest.spyOn(queryCache, 'invalidate');

    await expect(auditLogQueries.appendAuditLogInDB(pendingEntry)).resolves.toEqual(canonicalEntry);

    expect(querySpy).toHaveBeenCalledTimes(2);
    expect(querySpy.mock.calls[0][2]).toEqual(expect.objectContaining({ d1: true, useCache: false }));
    expect(batchSpy.mock.calls[0][1]).toHaveLength(2);
    expect(batchSpy.mock.calls[0][1][0].text).toContain('head_hash = $2 AND revision = $3');
    expect(batchSpy.mock.calls[0][1][1].text).toContain('WHERE changes() = 1');
    expect(invalidateSpy).toHaveBeenCalledWith('audit_logs');
  });

  test('returns an existing D1 row on an idempotent retry without moving the head', async () => {
    const existing = { ...pendingEntry, previousHash: 'persisted-head', shaSignature: 'persisted-signature' };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue({ batch: jest.fn() });
    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ raw: JSON.stringify(existing) }] });
    const batchSpy = jest.spyOn(d1Bridge, 'batchD1');

    await expect(auditLogQueries.appendAuditLogInDB(pendingEntry)).resolves.toEqual(existing);
    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(batchSpy).not.toHaveBeenCalled();
  });

  test('re-reads and retries after a D1 audit-head compare-and-swap loses', async () => {
    const canonicalEntry = sealAuditEntry(pendingEntry, 'newer-head');
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue({ batch: jest.fn() });
    jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ head_hash: 'stale-head', revision: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ head_hash: 'newer-head', revision: 2 }] });
    jest.spyOn(d1Bridge, 'batchD1')
      .mockResolvedValueOnce([{ rows: [] }, { rows: [] }])
      .mockResolvedValueOnce([
        { rows: [{ head_hash: canonicalEntry.shaSignature }], rowCount: 1 },
        { rows: [{ raw: canonicalEntry }], rowCount: 1 },
      ]);

    await expect(auditLogQueries.appendAuditLogInDB(pendingEntry)).resolves.toEqual(canonicalEntry);
    expect(d1Bridge.batchD1).toHaveBeenCalledTimes(2);
  });

  test('fails closed when the D1 chain state row is missing', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue({ batch: jest.fn() });
    jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(auditLogQueries.appendAuditLogInDB(pendingEntry)).rejects.toMatchObject({
      code: 'AUDIT_CHAIN_STATE_MISSING',
      statusCode: 503,
    });
  });

  test('fails when a D1 append advances the head but returns no inserted row', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue({ batch: jest.fn() });
    jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ head_hash: 'head', revision: 3 }] });
    jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
      { rows: [{ head_hash: 'advanced' }], rowCount: 1 },
      { rows: [] },
    ]);

    await expect(auditLogQueries.appendAuditLogInDB(pendingEntry)).rejects.toThrow(
      'Audit-chain head advanced without inserting its audit log entry.'
    );
  });

  test('reports repeated D1 head contention after the bounded retry count', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue({ batch: jest.fn() });
    jest.spyOn(pool, 'query').mockImplementation(async (sql) => (
      sql.includes('FROM audit_logs')
        ? { rows: [] }
        : { rows: [{ head_hash: 'head', revision: 1 }] }
    ));
    const batchSpy = jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([{ rows: [] }, { rows: [] }]);

    await expect(auditLogQueries.appendAuditLogInDB(pendingEntry)).rejects.toMatchObject({
      code: 'AUDIT_CHAIN_CONTENTION',
      statusCode: 503,
    });
    expect(batchSpy).toHaveBeenCalledTimes(5);
  });

  test('locks the PostgreSQL chain head and commits the sealed entry in one transaction', async () => {
    const canonicalEntry = sealAuditEntry(pendingEntry, 'pg-authoritative-head');
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ head_hash: 'pg-authoritative-head', revision: 6 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ head_hash: canonicalEntry.shaSignature }] })
        .mockResolvedValueOnce({ rows: [{ raw: canonicalEntry }] }),
    };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));
    const invalidateSpy = jest.spyOn(queryCache, 'invalidate');

    await expect(auditLogQueries.appendAuditLogInDB(pendingEntry)).resolves.toEqual(canonicalEntry);

    expect(client.query).toHaveBeenCalledTimes(5);
    expect(client.query.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(client.query.mock.calls[2][0]).toContain('SELECT raw FROM audit_logs');
    expect(client.query.mock.calls[3][1]).toEqual([canonicalEntry.shaSignature, 'pg-authoritative-head', 6]);
    expect(client.query.mock.calls[4][0]).toContain('INSERT INTO audit_logs');
    expect(invalidateSpy).toHaveBeenCalledWith('audit_logs');
  });

  test('returns a concurrent PostgreSQL retry after locking the chain head', async () => {
    const existing = { ...pendingEntry, shaSignature: 'committed-concurrent-signature' };
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ head_hash: 'committed-head', revision: 7 }] })
        .mockResolvedValueOnce({ rows: [{ raw: existing }] }),
    };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));

    await expect(auditLogQueries.appendAuditLogInDB(pendingEntry)).resolves.toEqual(existing);
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  test('returns an existing PostgreSQL row idempotently', async () => {
    const existing = { ...pendingEntry, shaSignature: 'already-saved' };
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ raw: existing }] }) };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));

    await expect(auditLogQueries.appendAuditLogInDB(pendingEntry)).resolves.toEqual(existing);
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  test('fails closed when PostgreSQL has no chain state row', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));

    await expect(auditLogQueries.appendAuditLogInDB(pendingEntry)).rejects.toMatchObject({
      code: 'AUDIT_CHAIN_STATE_MISSING',
      statusCode: 503,
    });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  test('parses object and JSON raw values and rejects malformed JSON', () => {
    expect(auditLogQueries.parseRaw({ id: 'object-entry' })).toEqual({ id: 'object-entry' });
    expect(auditLogQueries.parseRaw('{"id":"json-entry"}')).toEqual({ id: 'json-entry' });
    expect(auditLogQueries.parseRaw('[]')).toEqual({});
    expect(auditLogQueries.parseRaw(null)).toEqual({});
    expect(auditLogQueries.parseRaw(0)).toEqual({});
    expect(() => auditLogQueries.parseRaw('{')).toThrow('invalid JSON');
  });

  test('reads newest-first audit pages with a keyset cursor and uncached dialect SQL', async () => {
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ sequence: 7, raw: JSON.stringify({ id: 'audit-7' }) }] });

    await expect(auditLogQueries.readAuditLogPageInDB()).resolves.toEqual([
      { sequence: 7, entry: { id: 'audit-7' } },
    ]);
    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('ORDER BY sequence DESC LIMIT $1'),
      [AUDIT_CHAIN_VERIFY_PAGE_SIZE],
      expect.objectContaining({ d1: true, useCache: false, d1Text: expect.stringContaining('ORDER BY rowid DESC') })
    );

    await auditLogQueries.readAuditLogPageInDB(7);
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('WHERE sequence < $1 ORDER BY sequence DESC LIMIT $2'),
      [7, AUDIT_CHAIN_VERIFY_PAGE_SIZE],
      expect.objectContaining({ d1Text: expect.stringContaining('WHERE rowid < $1') })
    );
  });

  test('verifies the complete persisted chain against stable database anchors', async () => {
    const oldest = sealAuditEntry({ id: 'audit-old', timestamp: '2026-11-01 UTC', userEmail: 'a@b.test', action: 'old' });
    const newest = sealAuditEntry({ id: 'audit-new', timestamp: '2026-11-02 UTC', userEmail: 'a@b.test', action: 'new' }, oldest.shaSignature);
    const state = {
      head_hash: newest.shaSignature,
      root_hash: oldest.shaSignature,
      entry_count: 2,
      revision: 2,
    };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
      if (sql.includes('FROM audit_chain_state')) return { rows: [state] };
      return { rows: [
        { sequence: 2, raw: JSON.stringify(newest) },
        { sequence: 1, raw: JSON.stringify(oldest) },
      ] };
    });

    await expect(auditLogQueries.verifyAuditChainInDB()).resolves.toMatchObject({
      valid: true,
      complete: true,
      source: 'persisted',
      expectedCount: 2,
      verifiedCount: 2,
      chainRevision: 2,
    });
  });

  test('walks multiple audit pages without offset scans', async () => {
    const entries = [];
    let previousHash = '';
    for (let index = 0; index <= AUDIT_CHAIN_VERIFY_PAGE_SIZE; index += 1) {
      const entry = sealAuditEntry({
        id: `audit-${index}`,
        timestamp: `2026-11-05 00:${String(index % 60).padStart(2, '0')}:00 UTC`,
        userEmail: 'audit@example.test',
        action: `event-${index}`,
      }, previousHash);
      entries.push(entry);
      previousHash = entry.shaSignature;
    }
    const newestFirst = [...entries].reverse();
    const state = {
      head_hash: newestFirst[0].shaSignature,
      root_hash: newestFirst[newestFirst.length - 1].shaSignature,
      entry_count: newestFirst.length,
      revision: newestFirst.length,
    };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'query').mockImplementation(async (sql, params = []) => {
      if (sql.includes('FROM audit_chain_state')) return { rows: [state] };
      const cursor = sql.includes('WHERE sequence < $1') ? Number(params[0]) : Number.POSITIVE_INFINITY;
      const page = newestFirst.filter((_, index) => newestFirst.length - index < cursor)
        .slice(0, AUDIT_CHAIN_VERIFY_PAGE_SIZE);
      const sortedPage = cursor === Number.POSITIVE_INFINITY
        ? newestFirst.slice(0, AUDIT_CHAIN_VERIFY_PAGE_SIZE)
        : newestFirst.slice(AUDIT_CHAIN_VERIFY_PAGE_SIZE);
      return { rows: (cursor === Number.POSITIVE_INFINITY ? page : sortedPage).map((entry, index) => ({
        sequence: cursor === Number.POSITIVE_INFINITY ? newestFirst.length - index : 1,
        raw: JSON.stringify(entry),
      })) };
    });

    await expect(auditLogQueries.verifyAuditChainInDB()).resolves.toMatchObject({
      valid: true,
      complete: true,
      expectedCount: AUDIT_CHAIN_VERIFY_PAGE_SIZE + 1,
      verifiedCount: AUDIT_CHAIN_VERIFY_PAGE_SIZE + 1,
    });
    expect(pool.query.mock.calls.filter(([sql]) => sql.includes('FROM audit_logs'))).toHaveLength(2);
  });

  test('returns incomplete instead of claiming verification beyond the configured scan bound', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{
      head_hash: 'head', root_hash: 'root', entry_count: AUDIT_CHAIN_VERIFY_MAX_ROWS + 1, revision: 99,
    }] });

    await expect(auditLogQueries.verifyAuditChainInDB()).resolves.toMatchObject({
      valid: null,
      complete: false,
      source: 'persisted',
      expectedCount: AUDIT_CHAIN_VERIFY_MAX_ROWS + 1,
      verifiedCount: 0,
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('retries moving snapshots and reports repeated concurrent writes', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    let stateRead = 0;
    jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
      if (sql.includes('FROM audit_chain_state')) {
        stateRead += 1;
        return { rows: [{ head_hash: `head-${stateRead}`, root_hash: '', entry_count: 0, revision: stateRead }] };
      }
      return { rows: [] };
    });

    await expect(auditLogQueries.verifyAuditChainInDB()).rejects.toMatchObject({
      code: 'AUDIT_CHAIN_SNAPSHOT_UNSTABLE',
      statusCode: 503,
    });
  });

  test('returns null when durable chain-state reads have no configured database', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    await expect(auditLogQueries.readAuditChainStateInDB()).resolves.toBeNull();
    await expect(auditLogQueries.verifyAuditChainInDB()).resolves.toBeNull();
  });

  test('returns null when the chain-state adapter returns no row collection', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'query').mockResolvedValue({});
    await expect(auditLogQueries.readAuditChainStateInDB()).resolves.toBeNull();
  });

  test('returns an empty list when a page response omits rows', async () => {
    jest.spyOn(pool, 'query').mockResolvedValue({});
    await expect(auditLogQueries.readAuditLogPageInDB()).resolves.toEqual([]);
  });

  test('rejects PostgreSQL chain-head contention after taking the row lock', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ head_hash: 'head', revision: 1 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));

    await expect(auditLogQueries.appendAuditLogInDB(pendingEntry)).rejects.toMatchObject({
      code: 'AUDIT_CHAIN_CONTENTION',
    });
  });

  test('rejects a PostgreSQL append that returns no inserted record', async () => {
    const canonicalEntry = sealAuditEntry(pendingEntry, 'head');
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ head_hash: 'head', revision: 1 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ head_hash: canonicalEntry.shaSignature }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));

    await expect(auditLogQueries.appendAuditLogInDB(pendingEntry)).rejects.toThrow(
      'Audit-chain append returned no persisted row.'
    );
  });

  test('fails verification when chain state is absent or malformed', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
    await expect(auditLogQueries.verifyAuditChainInDB()).rejects.toMatchObject({
      code: 'AUDIT_CHAIN_STATE_MISSING',
      statusCode: 503,
    });

    querySpy.mockResolvedValue({ rows: [{ head_hash: '', root_hash: '', entry_count: -1, revision: 0 }] });
    await expect(auditLogQueries.verifyAuditChainInDB()).rejects.toMatchObject({
      code: 'INVALID_AUDIT_CHAIN_STATE',
      statusCode: 503,
    });
  });

  test('verifies an anchored empty chain and refuses a snapshot that disappears', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const emptyState = { head_hash: '', root_hash: '', entry_count: 0, revision: 0 };
    const querySpy = jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
      if (sql.includes('FROM audit_chain_state')) return { rows: [emptyState] };
      return { rows: [] };
    });
    await expect(auditLogQueries.verifyAuditChainInDB()).resolves.toMatchObject({
      valid: true,
      complete: true,
      expectedCount: 0,
      verifiedCount: 0,
    });

    let stateReads = 0;
    querySpy.mockImplementation(async (sql) => {
      if (!sql.includes('FROM audit_chain_state')) return { rows: [] };
      stateReads += 1;
      return stateReads === 1 ? { rows: [emptyState] } : { rows: [] };
    });
    await expect(auditLogQueries.verifyAuditChainInDB()).rejects.toMatchObject({
      code: 'AUDIT_CHAIN_STATE_MISSING',
    });
  });
});
