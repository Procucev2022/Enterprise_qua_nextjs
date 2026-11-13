const authService = require('../src/services/authService');
const authSessionQueries = require('../src/db/authSessionQueries');
const { authenticateTelemetry } = require('../src/middleware/auth');
const logsController = require('../src/controllers/logsController');
const { logger } = require('../src/services/loggerService');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('authenticateTelemetry (POST /api/logs)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('rejects a request without a session token', () => {
    const res = mockRes();
    const next = jest.fn();

    authenticateTelemetry({ headers: {} }, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects a token whose signature or expiry does not verify, and returns the reason', () => {
    jest.spyOn(authService, 'verifySessionToken').mockReturnValue({ valid: false, error: 'Session expired.' });
    const res = mockRes();
    const next = jest.fn();

    authenticateTelemetry({ headers: { authorization: 'Bearer expired.token' } }, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Session expired.' });
    expect(next).not.toHaveBeenCalled();
  });

  test('uses the default message when a rejected token gives no reason', () => {
    jest.spyOn(authService, 'verifySessionToken').mockReturnValue({ valid: false });
    const res = mockRes();

    authenticateTelemetry({ headers: { authorization: 'Bearer bad.token' } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].success).toBe(false);
    expect(typeof res.json.mock.calls[0][0].error).toBe('string');
  });

  test('passes a verified token without any revocation or session lookup', () => {
    const user = { sub: 'usr-1', email: 'buyer@procucev.com', role: 'buyer' };
    jest.spyOn(authService, 'verifySessionToken').mockReturnValue({ valid: true, user, signature: 'sig-1' });
    const sessionSpy = jest.spyOn(authService, 'assertSessionActive');
    const revokedSpy = jest.spyOn(authSessionQueries, 'isTokenRevoked');
    const req = { headers: { authorization: 'Bearer valid.token' } };
    const next = jest.fn();

    authenticateTelemetry(req, mockRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBe(user);
    expect(sessionSpy).not.toHaveBeenCalled();
    expect(revokedSpy).not.toHaveBeenCalled();
  });
});

describe('logsController.createLog actor attribution', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('stamps the verified session email onto authenticated log lines', () => {
    const logSpy = jest.spyOn(logger, 'log').mockReturnValue({});
    const res = mockRes();

    logsController.createLog({
      user: { email: 'buyer@procucev.com' },
      body: { level: 'audit', message: 'Created RFQ-1', category: 'AUDIT_TRAIL', metadata: { rfqNumber: 'RFQ-1' } },
    }, res, jest.fn());

    expect(logSpy).toHaveBeenCalledWith(
      'AUDIT',
      'Created RFQ-1',
      expect.objectContaining({ rfqNumber: 'RFQ-1', actorEmail: 'buyer@procucev.com' }),
      'AUDIT_TRAIL'
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('leaves the actor off unauthenticated client-error lines', () => {
    const logSpy = jest.spyOn(logger, 'log').mockReturnValue({});

    logsController.createLog({
      body: { level: 'error', message: 'Boot failed', metadata: {} },
    }, mockRes(), jest.fn());

    const metadata = logSpy.mock.calls[0][2];
    expect(metadata).not.toHaveProperty('actorEmail');
  });
});
