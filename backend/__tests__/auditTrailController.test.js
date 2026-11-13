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
