const pool = require('../src/db/pool');
const d1Bridge = require('../src/db/d1Bridge');
const purchaseOrderQueries = require('../src/db/purchaseOrderQueries');
const { logger } = require('../src/services/loggerService');
const { sealAuditEntry } = require('../src/services/auditService');

describe('atomic purchase-order persistence', () => {
  const updates = { status: 'PO Generated', poFinalised: true, quotes: [] };
  const auditEntry = { id: 'audit-po-1', action: 'approved', shaSignature: 'signature' };

  afterEach(() => jest.restoreAllMocks());

  test('does not write when no storage is configured', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    await expect(purchaseOrderQueries.approvePurchaseOrderInDB({
      rfqIdOrNumber: 'RFQ-1', updates, auditEntry,
    })).resolves.toBeNull();
  });

  test('commits RFQ update in PostgreSQL transaction', async () => {
    const canonicalAudit = sealAuditEntry(auditEntry, '');
    const savedRFQ = { id: 'rfq-1', ...updates, poShaSignature: canonicalAudit.shaSignature };
    const client = {
      query: jest.fn().mockResolvedValueOnce({ rows: [{ raw: savedRFQ }] }),
    };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'withTransaction').mockImplementation(async (callback) => callback(client));
    jest.spyOn(pool.queryAuditor, 'auditQuery').mockImplementation(() => {});

    await expect(purchaseOrderQueries.approvePurchaseOrderInDB({
      rfqIdOrNumber: 'RFQ-1', updates, auditEntry,
    })).resolves.toEqual({ rfq: savedRFQ, auditEntry: canonicalAudit });

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][0]).toContain("COALESCE(raw->>'poFinalised', 'false') <> 'true'");
    expect(client.query.mock.calls[0][1]).toEqual([
      'RFQ-1',
      JSON.stringify({ ...updates, poShaSignature: canonicalAudit.shaSignature }),
    ]);
  });

  test('returns null when PostgreSQL conditional update loses a concurrent approval', async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({ rows: [] }),
    };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'withTransaction').mockImplementation(async (callback) => callback(client));
    jest.spyOn(pool.queryAuditor, 'auditQuery').mockImplementation(() => {});

    await expect(purchaseOrderQueries.approvePurchaseOrderInDB({
      rfqIdOrNumber: 'RFQ-1', updates, auditEntry,
    })).resolves.toBeNull();
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  test('logs and rethrows PostgreSQL transaction errors', async () => {
    const failure = new Error('database unavailable');
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'withTransaction').mockRejectedValue(failure);
    jest.spyOn(pool.queryAuditor, 'auditQuery').mockImplementation(() => {});
    const loggerSpy = jest.spyOn(logger, 'error');

    await expect(purchaseOrderQueries.approvePurchaseOrderInDB({
      rfqIdOrNumber: 'RFQ-1', updates, auditEntry,
    })).rejects.toBe(failure);
    expect(loggerSpy).toHaveBeenCalledWith('PostgreSQL purchase-order approval transaction failed', expect.any(Object), 'PURCHASE_ORDER');
  });

  test('commits the update in one Worker D1 batch', async () => {
    const binding = { batch: jest.fn() };
    const canonicalAudit = sealAuditEntry(auditEntry, '');
    const savedRFQ = { id: 'rfq-1', ...updates, poShaSignature: canonicalAudit.shaSignature };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
      { rows: [{ raw: savedRFQ }] },
    ]);
    jest.spyOn(pool.queryAuditor, 'auditQuery').mockImplementation(() => {});

    await expect(purchaseOrderQueries.approvePurchaseOrderInDB({
      rfqIdOrNumber: 'RFQ-1', updates, auditEntry,
    })).resolves.toEqual({ rfq: savedRFQ, auditEntry: canonicalAudit });

    const [receivedBinding, statements] = d1Bridge.batchD1.mock.calls[0];
    expect(receivedBinding).toBe(binding);
    expect(statements[0].text).toContain('json_patch(raw, $2)');
    expect(statements[0].params).toEqual([
      'RFQ-1', JSON.stringify({ ...updates, poShaSignature: canonicalAudit.shaSignature }),
    ]);
  });

  test('returns null when D1 batch update returns no row', async () => {
    const binding = { batch: jest.fn() };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([{ rows: [] }]);
    jest.spyOn(pool.queryAuditor, 'auditQuery').mockImplementation(() => {});

    await expect(purchaseOrderQueries.approvePurchaseOrderInDB({
      rfqIdOrNumber: 'RFQ-1', updates, auditEntry,
    })).resolves.toBeNull();
  });

  test('logs and rejects when D1 batch fails', async () => {
    const binding = { batch: jest.fn() };
    const failure = new Error('D1 write error');
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'batchD1').mockRejectedValue(failure);
    const loggerSpy = jest.spyOn(logger, 'error');
    const durationSpy = jest.spyOn(pool.queryAuditor, 'auditQuery').mockImplementation(() => {});

    await expect(purchaseOrderQueries.approvePurchaseOrderInDB({
      rfqIdOrNumber: 'RFQ-1', updates, auditEntry,
    })).rejects.toBe(failure);

    expect(loggerSpy).toHaveBeenCalledWith('Atomic D1 purchase-order approval failed', expect.any(Object), 'PURCHASE_ORDER');
    expect(durationSpy).toHaveBeenCalled();
  });

  test('rejects the non-atomic D1 HTTP adapter', async () => {
    const httpAdapter = { _isHttpClient: true };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(httpAdapter);

    await expect(purchaseOrderQueries.approvePurchaseOrderInDB({
      rfqIdOrNumber: 'RFQ-1', updates, auditEntry,
    })).rejects.toMatchObject({ statusCode: 503, code: 'ATOMIC_D1_BATCH_REQUIRED' });
  });

  test('parses string raw records and reports corrupt JSON', () => {
    expect(purchaseOrderQueries.parseRaw('{"id":"rfq-1"}')).toEqual({ id: 'rfq-1' });
    expect(purchaseOrderQueries.parseRaw(null)).toEqual({});
    expect(purchaseOrderQueries.parseRaw('[]')).toEqual({});
    expect(purchaseOrderQueries.parseRaw('"string"')).toEqual({});
    expect(purchaseOrderQueries.parseRaw(['array'])).toEqual({});
    expect(() => purchaseOrderQueries.parseRaw('{')).toThrow('invalid JSON');
    const statements = purchaseOrderQueries.makeStatements('RFQ-1', updates, auditEntry);
    expect(statements.postgres.update).toContain("COALESCE(raw->>'poFinalised'");
    expect(statements.d1.update).toContain("json_extract(raw, '$.poFinalised')");
  });
});
