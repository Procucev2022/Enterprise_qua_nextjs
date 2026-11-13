const authController = require('../src/controllers/authController');
const authService = require('../src/services/authService');
const loginLogsQueries = require('../src/db/loginLogsQueries');
const { logger } = require('../src/services/loggerService');

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('authController login audit branches', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('audits successful vendor OTP logins and returns rejected OTP results unchanged', async () => {
    const loginResult = {
      success: true,
      user: {
        id: 'vendor-1',
        name: 'Vendor One',
        email: 'vendor@example.test',
        mobile: '9876543210',
        role: 'vendor',
        orgName: '',
        companyName: 'Vendor Supplies',
      },
    };
    jest.spyOn(authService, 'verifyOtp').mockResolvedValueOnce(loginResult).mockResolvedValueOnce({
      success: false,
      error: 'Invalid verification code.',
    });
    const recordLoginLog = jest.spyOn(loginLogsQueries, 'recordLoginLog').mockResolvedValue({ id: 'login-1' });
    const successResponse = createResponse();

    await authController.login({ body: { email: 'vendor@example.test', code: '123456' } }, successResponse);

    expect(successResponse.json).toHaveBeenCalledWith(loginResult);
    expect(recordLoginLog).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'vendor-1',
      companyName: 'Vendor Supplies',
      userType: 'vendor',
    }));

    const failureResult = { success: false, error: 'Invalid verification code.' };
    const failureResponse = createResponse();
    await authController.login({ body: { email: 'vendor@example.test', code: '654321' } }, failureResponse);

    expect(failureResponse.json).toHaveBeenCalledWith(failureResult);
    expect(recordLoginLog).toHaveBeenCalledTimes(1);
  });

  test('logs login-history persistence failures without failing successful authentication', async () => {
    const loginResult = {
      success: true,
      user: {
        id: 'buyer-1',
        name: 'Buyer One',
        email: 'buyer@example.test',
        mobile: '9876543210',
        role: 'buyer',
      },
    };
    const persistenceError = new Error('login history unavailable');
    jest.spyOn(authService, 'verifyOtp').mockResolvedValue(loginResult);
    jest.spyOn(loginLogsQueries, 'recordLoginLog').mockRejectedValue(persistenceError);
    const errorLogSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const response = createResponse();

    await authController.login({ body: { email: loginResult.user.email, code: '123456' } }, response);

    expect(response.json).toHaveBeenCalledWith(loginResult);
    expect(errorLogSpy).toHaveBeenCalledWith(
      'Login succeeded but login history could not be persisted',
      expect.objectContaining({
        error: persistenceError,
        operation: 'record-successful-login',
        authenticationMethod: 'otp',
        userIdPresent: true,
        userRole: 'buyer',
      }),
      'AUTH_CONTROLLER'
    );
  });
});

describe('authController session identity and placeholder fallbacks', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getClientIp returns null, not a fixed address, when no client address is known', () => {
    expect(authController.getClientIp({})).toBeNull();
    expect(authController.getClientIp({ ip: '198.51.100.7' })).toBe('198.51.100.7');
  });

  test('a logout without a session token names no account, even when the body carries an email', async () => {
    const audit = jest.spyOn(logger, 'audit').mockImplementation(() => {});
    const logoutLog = jest.spyOn(loginLogsQueries, 'recordLogoutLog').mockResolvedValue(true);
    const res = createResponse();

    await authController.logout({ headers: {}, body: { email: 'someone@else.test' } }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(audit).not.toHaveBeenCalled();
    expect(logoutLog).not.toHaveBeenCalled();
  });

  test('a logout with a valid session records the account from the verified token, not the body', async () => {
    const token = authService.generateSessionToken({ id: 'u-9', email: 'real@session.test', role: 'buyer', name: 'Real' });
    const logoutLog = jest.spyOn(loginLogsQueries, 'recordLogoutLog').mockResolvedValue(true);
    jest.spyOn(authService, 'revokeSessionToken').mockResolvedValue(true);
    const res = createResponse();

    await authController.logout(
      { headers: { authorization: `Bearer ${token}` }, body: { email: 'spoofed@body.test' } },
      res,
      jest.fn()
    );

    expect(logoutLog).toHaveBeenCalledWith(expect.objectContaining({ email: 'real@session.test' }));
    expect(logoutLog).not.toHaveBeenCalledWith(expect.objectContaining({ email: 'spoofed@body.test' }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('a successful login with no company on record stores an empty company, not a placeholder', async () => {
    const recordLoginLog = jest.spyOn(loginLogsQueries, 'recordLoginLog').mockResolvedValue(true);
    jest.spyOn(authService, 'authenticateWithPassword').mockResolvedValue({
      success: true,
      token: 'token-value',
      user: { id: 'u-1', name: 'No Org', email: 'noorg@test.com', role: 'buyer', mobile: '9000000000' },
    });
    const res = createResponse();

    await authController.login(
      { body: { email: 'noorg@test.com', password: 'Pass@123', mobile: '9000000000' }, ip: '198.51.100.8' },
      res,
      jest.fn()
    );

    expect(recordLoginLog).toHaveBeenCalledWith(expect.objectContaining({ companyName: '' }));
  });
});
