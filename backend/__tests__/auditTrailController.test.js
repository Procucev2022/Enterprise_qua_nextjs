jest.mock('../src/services/storeService', () => ({
  getAuditLogs: jest.fn(),
  addAuditLogDurably: jest.fn(),
  verifyAuditIntegrityDurably: jest.fn(),
  isHydratedFromDB: false,
}));

const auditController = require('../src/controllers/auditController');
const storeService = require('../src/services/storeService');

function response() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('audit controller identity, persistence, and verification contract', () => {
  beforeEach(() => jest.clearAllMocks());

  test('serves audit rows with an explicit source and a bounded requested limit', () => {
    storeService.getAuditLogs.mockReturnValue([{ id: 'audit-1' }]);
    const res = response();

    auditController.getAuditLogs({ query: { limit: '900' } }, res, jest.fn());

    expect(storeService.getAuditLogs).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      source: 'in_memory',
      data: [{ id: 'audit-1' }],
    });
  });

  test('forwards read failures to the error handler', () => {
    const failure = new Error('audit read failed');
    storeService.getAuditLogs.mockImplementation(() => { throw failure; });
    const next = jest.fn();

    auditController.getAuditLogs({ query: {} }, response(), next);

    expect(next).toHaveBeenCalledWith(failure);
  });

  test('requires a signed-in identity before accepting an audit event', async () => {
    const res = response();

    await auditController.createAuditLog({ body: { action: 'Reviewed RFQ' } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(storeService.addAuditLogDurably).not.toHaveBeenCalled();
  });

  test('rejects invalid event data with field-level feedback', async () => {
    const res = response();

    await auditController.createAuditLog({ user: { email: 'buyer@example.test' }, body: { action: '' } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].fieldErrors).toHaveProperty('action');
    expect(storeService.addAuditLogDurably).not.toHaveBeenCalled();
  });

  test('uses session identity and request IP, then returns the durably stored entry', async () => {
    const savedEntry = { id: 'audit-2', userEmail: 'buyer@example.test', action: 'Reviewed RFQ', shaSignature: 'sealed' };
    storeService.addAuditLogDurably.mockResolvedValue(savedEntry);
    const res = response();

    await auditController.createAuditLog({
      user: { email: 'buyer@example.test', role: 'buyer' },
      ip: '192.0.2.8',
      body: { userEmail: 'forged@example.test', ipAddress: 'spoofed', action: 'Reviewed RFQ', rfqNumber: 'RFQ-1' },
    }, res, jest.fn());

    expect(storeService.addAuditLogDurably).toHaveBeenCalledWith({
      userEmail: 'buyer@example.test',
      action: 'Reviewed RFQ',
      rfqNumber: 'RFQ-1',
      ipAddress: '192.0.2.8',
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: savedEntry });
  });

  test('forwards durable write failures to the error handler', async () => {
    const failure = new Error('audit storage unavailable');
    storeService.addAuditLogDurably.mockRejectedValue(failure);
    const next = jest.fn();

    await auditController.createAuditLog({ user: { email: 'buyer@example.test' }, body: { action: 'Reviewed RFQ' } }, response(), next);

    expect(next).toHaveBeenCalledWith(failure);
  });

  test('returns persisted verification reports and forwards verification errors', async () => {
    const report = { valid: true, complete: true, source: 'persisted', expectedCount: 1, verifiedCount: 1, compromisedEntries: [] };
    storeService.verifyAuditIntegrityDurably.mockResolvedValueOnce(report);
    const res = response();

    await auditController.verifyIntegrity({}, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ success: true, report });

    const failure = new Error('verification unavailable');
    storeService.verifyAuditIntegrityDurably.mockRejectedValueOnce(failure);
    const next = jest.fn();
    await auditController.verifyIntegrity({}, response(), next);
    expect(next).toHaveBeenCalledWith(failure);
  });
});
