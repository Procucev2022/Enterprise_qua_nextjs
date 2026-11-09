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
