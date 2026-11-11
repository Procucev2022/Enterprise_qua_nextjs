const auditLogQueries = require('../src/db/auditLogQueries');
const pool = require('../src/db/pool');
const { sealAuditEntry } = require('../src/services/auditService');

const pendingEntry1 = {
  id: 'audit-entry-1',
  timestamp: '2026-11-05 00:00:00 UTC',
  userEmail: 'buyer@example.test',
  action: 'Created an RFQ',
  rfqNumber: 'RFQ-AUDIT-1',
  status: 'TAMPER_CHECK_OK',
  ipAddress: '127.0.0.1',
};

const pendingEntry2 = {
  id: 'audit-entry-2',
  timestamp: '2026-11-05 01:00:00 UTC',
  userEmail: 'vendor@example.test',
  action: 'Submitted Quote',
  rfqNumber: 'RFQ-AUDIT-1',
  status: 'TAMPER_CHECK_OK',
  ipAddress: '127.0.0.1',
};

describe('in-memory decoupled audit-chain logging', () => {
  beforeEach(() => {
    auditLogQueries.resetInMemoryAuditChainForTesting();
    jest.restoreAllMocks();
  });

  test('returns null when no database is configured', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    await expect(auditLogQueries.appendAuditLogInDB(pendingEntry1)).resolves.toBeNull();
    await expect(auditLogQueries.readAuditChainStateInDB()).resolves.toBeNull();
    await expect(auditLogQueries.readAuditLogPageInDB()).resolves.toEqual([]);
    await expect(auditLogQueries.verifyAuditChainInDB()).resolves.toBeNull();
  });

  test('appends audit log entries and links their SHA-256 hash signatures', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

    const first = await auditLogQueries.appendAuditLogInDB(pendingEntry1);
    expect(first).toBeDefined();
    expect(first.id).toBe(pendingEntry1.id);
    expect(first.previousHash).toBe('');
    expect(first.shaSignature).toBeDefined();

    const second = await auditLogQueries.appendAuditLogInDB(pendingEntry2);
    expect(second).toBeDefined();
    expect(second.id).toBe(pendingEntry2.id);
    expect(second.previousHash).toBe(first.shaSignature);

    const state = await auditLogQueries.readAuditChainStateInDB();
    expect(state).toEqual({
      head_hash: second.shaSignature,
      root_hash: first.shaSignature,
      entry_count: 2,
      revision: 2,
    });
  });

  test('returns existing entry on idempotent append without moving chain head', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

    const first = await auditLogQueries.appendAuditLogInDB(pendingEntry1);
    const retry = await auditLogQueries.appendAuditLogInDB(pendingEntry1);

    expect(retry).toEqual(first);
    const state = await auditLogQueries.readAuditChainStateInDB();
    expect(state.entry_count).toBe(1);
    expect(state.revision).toBe(1);
  });

  test('reads paginated audit log entries with sequences', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

    await auditLogQueries.appendAuditLogInDB(pendingEntry1);
    await auditLogQueries.appendAuditLogInDB(pendingEntry2);

    const allPages = await auditLogQueries.readAuditLogPageInDB();
    expect(allPages).toHaveLength(2);
    expect(allPages[0].sequence).toBe(2);
    expect(allPages[1].sequence).toBe(1);

    const filtered = await auditLogQueries.readAuditLogPageInDB(2);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].sequence).toBe(1);
  });

  test('verifies an in-memory audit trail successfully', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

    await auditLogQueries.appendAuditLogInDB(pendingEntry1);
    await auditLogQueries.appendAuditLogInDB(pendingEntry2);

    const report = await auditLogQueries.verifyAuditChainInDB();
    expect(report).toMatchObject({
      valid: true,
      complete: true,
      source: 'in_memory',
      expectedCount: 2,
      verifiedCount: 2,
      compromisedEntries: [],
    });
  });

  test('parses object and JSON raw values and rejects malformed JSON', () => {
    expect(auditLogQueries.parseRaw({ id: 'test' })).toEqual({ id: 'test' });
    expect(auditLogQueries.parseRaw('{"id":"json-test"}')).toEqual({ id: 'json-test' });
    expect(auditLogQueries.parseRaw('[]')).toEqual({});
    expect(auditLogQueries.parseRaw(null)).toEqual({});
    expect(auditLogQueries.parseRaw(123)).toEqual({});
    expect(() => auditLogQueries.parseRaw('{ invalid')).toThrow('invalid JSON');
  });

  test('exports error helper generators', () => {
    const missingErr = auditLogQueries.missingChainStateError();
    expect(missingErr.code).toBe('AUDIT_CHAIN_STATE_MISSING');
    expect(missingErr.statusCode).toBe(503);

    const nonAtomicErr = auditLogQueries.nonAtomicAdapterError();
    expect(nonAtomicErr.code).toBe('ATOMIC_D1_BATCH_REQUIRED');
    expect(nonAtomicErr.statusCode).toBe(503);
  });
});
