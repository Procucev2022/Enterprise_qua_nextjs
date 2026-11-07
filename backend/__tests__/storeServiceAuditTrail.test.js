const pool = require('../src/db/pool');
const auditLogQueries = require('../src/db/auditLogQueries');
const domainQueries = require('../src/db/domainQueries');
const { logger } = require('../src/services/loggerService');
const storeService = require('../src/services/storeService');

describe('store service durable audit trail', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    storeService.reset();
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
  });

  test('waits for the database seal before returning and updating the process cache', async () => {
    const auditSpy = jest.spyOn(logger, 'audit');
    let releaseWrite;
    const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
    jest.spyOn(auditLogQueries, 'appendAuditLogInDB').mockImplementation(async (entry) => {
      await writeGate;
      return { ...entry, previousHash: '', shaSignature: 'database-sealed-signature' };
    });
    const pending = storeService.addAuditLogDurably({ action: 'Durable audit action' });

    await Promise.resolve();
    expect(auditLogQueries.appendAuditLogInDB).toHaveBeenCalledTimes(1);
    expect(storeService.getAuditLogs()).toHaveLength(0);
    releaseWrite();

    const saved = await pending;
    expect(saved.shaSignature).toBe('database-sealed-signature');
    expect(storeService.getAuditLogs()).toEqual([saved]);
    expect(auditSpy).toHaveBeenCalledWith('Durable audit action', 'system@procucev.ai', expect.any(Object), null);
  });

  test('serializes writes and refreshes the cache when the database head differs from process state', async () => {
    const persistedFirst = { id: 'first', shaSignature: 'first-hash', previousHash: '' };
    const persistedSecond = { id: 'second', shaSignature: 'second-hash', previousHash: 'first-hash' };
    jest.spyOn(auditLogQueries, 'appendAuditLogInDB')
      .mockResolvedValueOnce(persistedFirst)
      .mockResolvedValueOnce({ ...persistedSecond, previousHash: 'database-canonical-link' });
    jest.spyOn(domainQueries, 'getAuditLogsFromDB').mockResolvedValue([persistedSecond, persistedFirst]);

    const first = storeService.addAuditLogDurably({ action: 'First' });
    const second = storeService.addAuditLogDurably({ action: 'Second' });
    await Promise.all([first, second]);

    expect(auditLogQueries.appendAuditLogInDB).toHaveBeenCalledTimes(2);
    expect(domainQueries.getAuditLogsFromDB).toHaveBeenCalledWith(500, { fresh: true });
    expect(storeService.getAuditLogs()).toEqual([persistedSecond, persistedFirst]);
  });

  test('logs cache refresh failures while preserving the durably saved event', async () => {
    const errorSpy = jest.spyOn(logger, 'error');
    jest.spyOn(auditLogQueries, 'appendAuditLogInDB').mockResolvedValue({ id: 'saved', previousHash: 'db-head', shaSignature: 'saved-hash' });
    jest.spyOn(domainQueries, 'getAuditLogsFromDB').mockRejectedValue(new Error('read failed'));

    const saved = await storeService.addAuditLogDurably({ action: 'Saved despite cache refresh failure' });

    expect(saved.shaSignature).toBe('saved-hash');
    expect(errorSpy).toHaveBeenCalledWith(
      'Audit log was saved but the local chain cache could not be refreshed',
      expect.objectContaining({ entryId: 'saved', error: expect.any(Error) }),
      'STORE_SERVICE'
    );
  });

  test('reports durable append failures and never caches an unsaved row', async () => {
    const errorSpy = jest.spyOn(logger, 'error');
    jest.spyOn(auditLogQueries, 'appendAuditLogInDB').mockRejectedValue(new Error('database unavailable'));

    await expect(storeService.addAuditLogDurably({ action: 'Unsaved' })).rejects.toMatchObject({
      statusCode: 503,
      code: 'PERSISTENCE_UNAVAILABLE',
    });
    expect(storeService.getAuditLogs()).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith('Failed to durably append audit log entry', expect.any(Error), 'STORE_SERVICE');
  });

  test('keeps in-memory writes explicit when persistence is not configured', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    jest.spyOn(auditLogQueries, 'appendAuditLogInDB').mockResolvedValue(null);

    const saved = await storeService.addAuditLogDurably({ action: 'Local only' });
    const report = await storeService.verifyAuditIntegrityDurably();

    expect(saved.action).toBe('Local only');
    expect(report).toMatchObject({ valid: null, complete: false, source: 'in_memory', expectedCount: null });
  });

  test('returns the persisted verifier result and reports verifier failures to callers', async () => {
    const report = { valid: true, complete: true, source: 'persisted', expectedCount: 0, verifiedCount: 0, compromisedEntries: [] };
    jest.spyOn(auditLogQueries, 'verifyAuditChainInDB').mockResolvedValueOnce(report);
    await expect(storeService.verifyAuditIntegrityDurably()).resolves.toEqual(report);

    const failure = new Error('verification read failed');
    jest.spyOn(auditLogQueries, 'verifyAuditChainInDB').mockRejectedValueOnce(failure);
    await expect(storeService.verifyAuditIntegrityDurably()).rejects.toBe(failure);
  });
});
