import { authClient } from '@/lib/authClient';
import { logger } from '@/lib/logger';
import { buildAuditCsvDataUrl, fetchAuditVerification } from '@/lib/auditClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { AuditVerificationReport } from '@/lib/types';

const validReport: AuditVerificationReport = {
  valid: true,
  complete: true,
  source: 'persisted',
  expectedCount: 2,
  verifiedCount: 2,
  compromisedEntries: [],
};

function response(body: unknown, options: { ok?: boolean; status?: number } = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => body,
  };
}

describe('auditClient', () => {
  const originalRemoteSync = logger.isRemoteSyncEnabled;

  beforeEach(() => {
    jest.clearAllMocks();
    logger.isRemoteSyncEnabled = false;
  });

  afterAll(() => {
    logger.isRemoteSyncEnabled = originalRemoteSync;
  });

  test('requests the persisted report with the signed-in bearer token', async () => {
    jest.spyOn(authClient, 'getToken').mockReturnValue('admin-token');
    global.fetch = jest.fn().mockResolvedValue(response({ success: true, report: validReport }));

    await expect(fetchAuditVerification()).resolves.toEqual(validReport);
    expect(global.fetch).toHaveBeenCalledWith('/api/audit/verify', {
      headers: { Authorization: 'Bearer admin-token' },
    });
  });

  test('accepts explicit incomplete reports and sends no authorization header without a token', async () => {
    const incompleteReport: AuditVerificationReport = {
      valid: null,
      complete: false,
      source: 'in_memory',
      expectedCount: null,
      verifiedCount: 1,
      compromisedEntries: [{ id: null, index: 1, reason: 'The database is unavailable.' }],
      reason: 'The process cache cannot verify persisted history.',
    };
    jest.spyOn(authClient, 'getToken').mockReturnValue(null);
    global.fetch = jest.fn().mockResolvedValue(response({ success: true, report: incompleteReport }));

    await expect(fetchAuditVerification()).resolves.toEqual(incompleteReport);
    expect(global.fetch).toHaveBeenCalledWith('/api/audit/verify', { headers: {} });
  });

  test('reports an expired session clearly', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({}, { ok: false, status: 401 }));
    await expect(fetchAuditVerification()).rejects.toThrow(UI_STRINGS.screens.auditLogs.sessionExpired);
  });

  test('reports insufficient audit permissions clearly', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({}, { ok: false, status: 403 }));
    await expect(fetchAuditVerification()).rejects.toThrow(UI_STRINGS.screens.auditLogs.permissionDenied);
  });

  test('rejects a successful response without a valid verification contract', async () => {
    const errorSpy = jest.spyOn(logger, 'error');
    global.fetch = jest.fn().mockResolvedValue(response({ success: true, report: { valid: true } }));
    await expect(fetchAuditVerification()).rejects.toThrow(UI_STRINGS.auth.serverErrorFallback);
    expect(errorSpy).toHaveBeenCalledWith(
      'Audit verification response did not match the expected contract',
      expect.any(Object),
      'AUDIT_VERIFICATION'
    );
  });

  test('rejects invalid issue entries and non-object response bodies', async () => {
    const invalidIssueReport = {
      ...validReport,
      compromisedEntries: [
        { id: 'entry-1', index: 'bad-index', reason: 'broken' },
        { id: null, index: 0, reason: 3 },
      ],
    };
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response({ success: true, report: invalidIssueReport }))
      .mockResolvedValueOnce(response(null));

    await expect(fetchAuditVerification()).rejects.toThrow(UI_STRINGS.auth.serverErrorFallback);
    await expect(fetchAuditVerification()).rejects.toThrow(UI_STRINGS.auth.serverErrorFallback);
  });

  test('surfaces database errors and network failures', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(
      { success: false, error: 'Apply migration 0017 before verifying.' },
      { ok: false, status: 503 }
    ));
    await expect(fetchAuditVerification()).rejects.toThrow('Apply migration 0017 before verifying.');

    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(fetchAuditVerification()).rejects.toThrow('offline');
  });

  test('uses actionable fallbacks for blank errors, invalid JSON, and unknown network failures', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response({ error: '   ' }, { ok: false, status: 503 }))
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => { throw new Error('not JSON'); } })
      .mockRejectedValueOnce(null);

    await expect(fetchAuditVerification()).rejects.toThrow(UI_STRINGS.screens.auditLogs.verificationUnavailable);
    await expect(fetchAuditVerification()).rejects.toThrow(UI_STRINGS.auth.serverErrorFallback);
    await expect(fetchAuditVerification()).rejects.toThrow(UI_STRINGS.screens.auditLogs.verificationUnavailable);
  });

  test('builds escaped CSV and prevents spreadsheet formula execution', () => {
    const url = buildAuditCsvDataUrl([{
      id: 'entry-1',
      timestamp: '2026-11-05 UTC',
      user: '=HYPERLINK("https://bad.test")',
      userEmail: 'buyer@example.test',
      action: 'Created, reviewed an RFQ',
      rfqNumber: 'RFQ-1',
      shaSignature: 'a'.repeat(64),
      previousHash: '',
      ipAddress: '127.0.0.1',
    }]);
    const csv = decodeURIComponent(url.split(',')[1]);

    expect(url).toMatch(/^data:text\/csv;charset=utf-8,/);
    expect(csv).toContain('"\'=HYPERLINK(""https://bad.test"")"');
    expect(csv).toContain('"Created, reviewed an RFQ"');
    expect(csv.split('\r\n')).toHaveLength(2);
  });

  test('exports missing optional fields as empty CSV cells', () => {
    const url = buildAuditCsvDataUrl([{
      id: 'entry-2',
      timestamp: '2026-11-05 UTC',
      action: 'Reviewed a record',
      shaSignature: 'b'.repeat(64),
    }]);
    const csv = decodeURIComponent(url.split(',')[1]);

    expect(csv).toContain('"entry-2","2026-11-05 UTC","","","Reviewed a record","","' + 'b'.repeat(64) + '","",""');
  });
});
