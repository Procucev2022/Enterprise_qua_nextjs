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

  test('commits RFQ update and audit entry in one PostgreSQL transaction', async () => {
    const auditState = { head_hash: 'pg-head', revision: 11 };
    const transactionAudit = sealAuditEntry(auditEntry, auditState.head_hash);
    const savedRFQ = { id: 'rfq-1', ...updates, poShaSignature: transactionAudit.shaSignature };
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [auditState] })
        .mockResolvedValueOnce({ rows: [{ raw: savedRFQ }] })
        .mockResolvedValueOnce({ rows: [{ head_hash: transactionAudit.shaSignature }] })
        .mockResolvedValueOnce({ rows: [{ raw: transactionAudit }] }),
    };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'withTransaction').mockImplementation(async (callback) => callback(client));
    jest.spyOn(pool.queryAuditor, 'auditQuery').mockImplementation(() => {});

    await expect(purchaseOrderQueries.approvePurchaseOrderInDB({
      rfqIdOrNumber: 'RFQ-1', updates, auditEntry,
    })).resolves.toEqual({ rfq: savedRFQ, auditEntry: transactionAudit });

    expect(client.query).toHaveBeenCalledTimes(4);
    expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(client.query.mock.calls[1][0]).toContain("COALESCE(raw->>'poFinalised', 'false') <> 'true'");
    expect(client.query.mock.calls[1][1]).toEqual([
      'RFQ-1',
      JSON.stringify({ ...updates, poShaSignature: transactionAudit.shaSignature }),
    ]);
    expect(client.query.mock.calls[2][0]).toContain('UPDATE audit_chain_state');
    expect(client.query.mock.calls[3][0]).toContain('INSERT INTO audit_logs');
    expect(client.query.mock.calls[3][1]).toEqual([auditEntry.id, JSON.stringify(transactionAudit)]);
  });

  test('returns null when PostgreSQL conditional update loses a concurrent approval', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ head_hash: 'pg-head', revision: 11 }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'withTransaction').mockImplementation(async (callback) => callback(client));
    jest.spyOn(pool.queryAuditor, 'auditQuery').mockImplementation(() => {});

    await expect(purchaseOrderQueries.approvePurchaseOrderInDB({
      rfqIdOrNumber: 'RFQ-1', updates, auditEntry,
    })).resolves.toBeNull();
    expect(client.query).toHaveBeenCalledTimes(2);
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

  test('commits the update and conditional audit insert in one Worker D1 batch', async () => {
    const binding = { batch: jest.fn() };
    const auditState = { head_hash: 'd1-head', revision: 3 };
    const savedAudit = sealAuditEntry(auditEntry, auditState.head_hash);
    const savedRFQ = { id: 'rfq-1', ...updates, poShaSignature: savedAudit.shaSignature };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [auditState] });
    jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
      { rows: [{ head_hash: savedAudit.shaSignature }], rowCount: 1 },
      { rows: [{ raw: savedRFQ }] },
      { rows: [{ raw: savedAudit }] },
    ]);
    jest.spyOn(pool.queryAuditor, 'auditQuery').mockImplementation(() => {});

    await expect(purchaseOrderQueries.approvePurchaseOrderInDB({
      rfqIdOrNumber: 'RFQ-1', updates, auditEntry,
    })).resolves.toEqual({ rfq: savedRFQ, auditEntry: savedAudit });

    const [receivedBinding, statements] = d1Bridge.batchD1.mock.calls[0];
    expect(receivedBinding).toBe(binding);
    expect(statements[0].text).toContain('UPDATE audit_chain_state');
    expect(statements[1].text).toContain('json_patch(raw, $2)');
    expect(statements[1].text).toContain('changes() = 1');
    expect(statements[2].text).toContain('WHERE changes() = 1');
    expect(statements[0].params).toEqual([savedAudit.shaSignature, 'd1-head', 3, 'RFQ-1']);
    expect(statements[1].params).toEqual([
      'RFQ-1', JSON.stringify({ ...updates, poShaSignature: savedAudit.shaSignature }),
    ]);
    expect(statements[2].params).toEqual([auditEntry.id, JSON.stringify(savedAudit)]);
  });

  test('returns null after bounded D1 head compare-and-swap retries lose', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue({});
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ head_hash: 'moving-head', revision: 8 }] });
    jest.spyOn(pool.queryAuditor, 'auditQuery').mockImplementation(() => {});
    const batchSpy = jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
      { rows: [] }, { rows: [] }, { rows: [] },
    ]);

    await expect(purchaseOrderQueries.approvePurchaseOrderInDB({
      rfqIdOrNumber: 'RFQ-1', updates, auditEntry,
    })).resolves.toBeNull();
    expect(batchSpy).toHaveBeenCalledTimes(5);
  });

  test('fails closed and logs when D1 audit-chain state is missing', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue({});
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
    const loggerSpy = jest.spyOn(logger, 'error');
    const durationSpy = jest.spyOn(pool.queryAuditor, 'auditQuery').mockImplementation(() => {});

    await expect(purchaseOrderQueries.approvePurchaseOrderInDB({
      rfqIdOrNumber: 'RFQ-1', updates, auditEntry,
    })).rejects.toMatchObject({ code: 'AUDIT_CHAIN_STATE_MISSING', statusCode: 503 });

    expect(loggerSpy).toHaveBeenCalledWith('Atomic D1 purchase-order approval failed', expect.any(Object), 'PURCHASE_ORDER');
    expect(durationSpy).toHaveBeenCalled();
  });

  test('logs and rejects an incomplete atomic D1 result', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue({});
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ head_hash: 'd1-head', revision: 3 }] });
    jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
      { rows: [{ head_hash: 'advanced-head' }] },
      { rows: [] },
      { rows: [] },
    ]);
    const loggerSpy = jest.spyOn(logger, 'error');
    jest.spyOn(pool.queryAuditor, 'auditQuery').mockImplementation(() => {});

    await expect(purchaseOrderQueries.approvePurchaseOrderInDB({
      rfqIdOrNumber: 'RFQ-1', updates, auditEntry,
    })).rejects.toThrow('Atomic purchase-order batch advanced the audit head without saving both records.');
    expect(loggerSpy).toHaveBeenCalledWith('Atomic D1 purchase-order approval failed', expect.any(Object), 'PURCHASE_ORDER');
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

  test('fails closed and logs when PostgreSQL audit-chain state is missing', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'withTransaction').mockImplementation(async (callback) => callback(client));
    const loggerSpy = jest.spyOn(logger, 'error');
    jest.spyOn(pool.queryAuditor, 'auditQuery').mockImplementation(() => {});

    await expect(purchaseOrderQueries.approvePurchaseOrderInDB({
      rfqIdOrNumber: 'RFQ-1', updates, auditEntry,
    })).rejects.toMatchObject({ code: 'AUDIT_CHAIN_STATE_MISSING', statusCode: 503 });
    expect(loggerSpy).toHaveBeenCalledWith('PostgreSQL purchase-order approval transaction failed', expect.any(Object), 'PURCHASE_ORDER');
  });

  test('rolls back and logs when the PostgreSQL audit head update returns no row', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ head_hash: 'pg-head', revision: 11 }] })
        .mockResolvedValueOnce({ rows: [{ raw: { id: 'rfq-1' } }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'withTransaction').mockImplementation(async (callback) => callback(client));
    const loggerSpy = jest.spyOn(logger, 'error');
    jest.spyOn(pool.queryAuditor, 'auditQuery').mockImplementation(() => {});

    await expect(purchaseOrderQueries.approvePurchaseOrderInDB({
      rfqIdOrNumber: 'RFQ-1', updates, auditEntry,
    })).rejects.toThrow('Audit-chain head changed during purchase-order approval.');
    expect(loggerSpy).toHaveBeenCalledWith('PostgreSQL purchase-order approval transaction failed', expect.any(Object), 'PURCHASE_ORDER');
  });

  test('logs when the PostgreSQL audit insert returns no persisted row', async () => {
    const transactionAudit = sealAuditEntry(auditEntry, 'pg-head');
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ head_hash: 'pg-head', revision: 11 }] })
        .mockResolvedValueOnce({ rows: [{ raw: { id: 'rfq-1' } }] })
        .mockResolvedValueOnce({ rows: [{ head_hash: transactionAudit.shaSignature }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'withTransaction').mockImplementation(async (callback) => callback(client));
    const loggerSpy = jest.spyOn(logger, 'error');
    jest.spyOn(pool.queryAuditor, 'auditQuery').mockImplementation(() => {});

    await expect(purchaseOrderQueries.approvePurchaseOrderInDB({
      rfqIdOrNumber: 'RFQ-1', updates, auditEntry,
    })).rejects.toThrow('Purchase-order approval transaction did not persist its audit record.');
    expect(loggerSpy).toHaveBeenCalledWith('PostgreSQL purchase-order approval transaction failed', expect.any(Object), 'PURCHASE_ORDER');
  });

  test('parses string raw records and reports corrupt JSON', () => {
    expect(purchaseOrderQueries.parseRaw('{"id":"rfq-1"}')).toEqual({ id: 'rfq-1' });
    expect(purchaseOrderQueries.parseRaw(null)).toEqual({});
    expect(() => purchaseOrderQueries.parseRaw('{')).toThrow('invalid JSON');
    const statements = purchaseOrderQueries.makeStatements('RFQ-1', updates, auditEntry);
    expect(statements.postgres.audit).toContain('INSERT INTO audit_logs');
    expect(statements.d1.update).toContain("json_extract(raw, '$.poFinalised')");
    expect(statements.d1.updateAuditHead).toContain('audit_chain_state');
  });
});
