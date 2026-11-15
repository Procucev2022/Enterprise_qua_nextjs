const authService = require('../src/services/authService');
const authSessionQueries = require('../src/db/authSessionQueries');
const dbPool = require('../src/db/pool');
const identityQueries = require('../src/db/identityQueries');
const mailerService = require('../src/services/mailerService');
const smsService = require('../src/services/smsService');
const storeService = require('../src/services/storeService');
const { AUTH_MESSAGES } = require('../src/config/constants');

// ==============================================================================
// OTP DELIVERY CONFIRMATION
// ==============================================================================
// requestOtp used to fire the email and SMS and immediately report "sent". When
// every outbound mailbox was rate-limited or revoked, visitors were told a code
// was on its way that never arrived. These tests pin the new contract: delivery
// is awaited and a failure is reported, per channel, to the caller.
// ==============================================================================

const EMAIL = 'otp.user@example.com';
const MOBILE = '9876543210';
const { OTP_DELIVERY_STATUS } = authService;

function activeBuyer() {
  return {
    id: 'user-otp-1',
    email: EMAIL,
    name: 'OTP User',
    role: 'buyer',
    rawRoleName: 'ClientInitiator',
    orgId: 'org-1',
    orgName: 'Org',
    password: 'Pass@123',
    mobile: `+91${MOBILE}`,
    status: 'ACTIVE',
    isActive: true,
    isApproved: true,
    isSelfClient: false,
    resetPasswordRequired: false,
  };
}

describe('authService OTP delivery confirmation', () => {
  let originalPool;

  beforeEach(() => {
    originalPool = dbPool.pool;
    dbPool.pool = { query: jest.fn() };
    jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(activeBuyer());
    jest.spyOn(authSessionQueries, 'saveOtp').mockResolvedValue(true);
    jest.spyOn(storeService, 'addAuditLog').mockImplementation(() => { });
    delete globalThis.__CF_WAIT_UNTIL__;
  });

  afterEach(() => {
    dbPool.pool = originalPool;
    delete globalThis.__CF_WAIT_UNTIL__;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('dispatchOtpCodes', () => {
    const args = { email: EMAIL, emailCode: '111111', mobile: MOBILE, mobileCode: '222222', isRegistration: false };

    test('reports both channels sent when the mailer and SMS gateway accept', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ sent: true, messageId: 'm1' });
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true });
      await expect(authService.dispatchOtpCodes(args)).resolves.toEqual({
        email: OTP_DELIVERY_STATUS.SENT,
        sms: OTP_DELIVERY_STATUS.SENT,
      });
    });

    test('treats an unconfigured mailer as failed, never as sent', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ sent: false, reason: 'SMTP not configured' });
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true });
      const delivery = await authService.dispatchOtpCodes(args);
      expect(delivery.email).toBe(OTP_DELIVERY_STATUS.FAILED);
      expect(delivery.sms).toBe(OTP_DELIVERY_STATUS.SENT);
    });

    test('reports a thrown mail error and an unsuccessful or thrown SMS as failed', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockRejectedValue(new Error('User-rate limit exceeded'));
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: false, error: 'gateway down' });
      expect(await authService.dispatchOtpCodes(args)).toEqual({
        email: OTP_DELIVERY_STATUS.FAILED,
        sms: OTP_DELIVERY_STATUS.FAILED,
      });

      smsService.sendOtpSms.mockRejectedValue(new Error('socket hang up'));
      mailerService.sendOtpEmail.mockResolvedValue(undefined);
      expect(await authService.dispatchOtpCodes(args)).toEqual({
        email: OTP_DELIVERY_STATUS.FAILED,
        sms: OTP_DELIVERY_STATUS.FAILED,
      });

      smsService.sendOtpSms.mockResolvedValue(undefined);
      expect((await authService.dispatchOtpCodes(args)).sms).toBe(OTP_DELIVERY_STATUS.FAILED);
    });

    test.each([
      ['throttled', { success: false, status: 'throttled' }],
      ['not_configured', { success: false, status: 'not_configured' }],
      ['skipped', { success: false, status: 'skipped' }],
      ['failed', { success: false, status: 'failed' }],
      ['link_only', { success: false, status: 'link_only' }],
      ['throttled flag on a success', { success: true, throttled: true, messageId: 'throttled-cooldown' }],
    ])('maps a non-delivered send (%s) to FAILED', async (_label, result) => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue(result);
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue(result);
      await expect(authService.dispatchOtpCodes(args)).resolves.toEqual({
        email: OTP_DELIVERY_STATUS.FAILED,
        sms: OTP_DELIVERY_STATUS.FAILED,
      });
    });

    test('maps only a provider-accepted send to SENT, whether it reports success or the legacy sent flag', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ success: true, status: 'sent', messageId: 'm2' });
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true, status: 'sent' });
      await expect(authService.dispatchOtpCodes(args)).resolves.toEqual({
        email: OTP_DELIVERY_STATUS.SENT,
        sms: OTP_DELIVERY_STATUS.SENT,
      });
    });

    test('toOtpDeliveryStatus prefers the success field and never reads an empty result as sent', () => {
      const { toOtpDeliveryStatus } = authService;
      expect(toOtpDeliveryStatus(undefined)).toBe(OTP_DELIVERY_STATUS.FAILED);
      expect(toOtpDeliveryStatus('accepted')).toBe(OTP_DELIVERY_STATUS.FAILED);
      expect(toOtpDeliveryStatus({})).toBe(OTP_DELIVERY_STATUS.FAILED);
      expect(toOtpDeliveryStatus({ sent: true })).toBe(OTP_DELIVERY_STATUS.SENT);
      expect(toOtpDeliveryStatus({ sent: false })).toBe(OTP_DELIVERY_STATUS.FAILED);
      expect(toOtpDeliveryStatus({ success: false, sent: true })).toBe(OTP_DELIVERY_STATUS.FAILED);
      expect(toOtpDeliveryStatus({ success: true })).toBe(OTP_DELIVERY_STATUS.SENT);
    });

    test('does not expose a NOT_ATTEMPTED state any more', () => {
      expect(OTP_DELIVERY_STATUS).not.toHaveProperty('NOT_ATTEMPTED');
    });

    test('hands both sends to waitUntil on Workers so they survive the response', async () => {
      const waitUntil = jest.fn();
      globalThis.__CF_WAIT_UNTIL__ = waitUntil;
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ sent: true });
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true });
      await authService.dispatchOtpCodes(args);
      expect(waitUntil).toHaveBeenCalledTimes(2);
    });

    test('reports a send still running at the wait bound as pending', async () => {
      jest.useFakeTimers();
      jest.spyOn(mailerService, 'sendOtpEmail').mockReturnValue(new Promise(() => { }));
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true });
      const pending = authService.dispatchOtpCodes(args);
      await jest.advanceTimersByTimeAsync(20 * 1000 + 1);
      await expect(pending).resolves.toEqual({ email: OTP_DELIVERY_STATUS.PENDING, sms: OTP_DELIVERY_STATUS.SENT });
    });
  });

  describe('requestOtp (sign-in)', () => {
    test('succeeds and says so when both channels deliver', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ sent: true });
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true });
      const res = await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1');
      expect(res.success).toBe(true);
      expect(res.delivery).toEqual({ email: 'sent', sms: 'sent' });
      expect(res.message).toBe(`Verification OTP dispatched to ${EMAIL} and mobile`);
    });

    test('still succeeds on SMS alone when the email fails, and tells the visitor where the code went', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockRejectedValue(new Error('invalid_grant'));
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true });
      const res = await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1');
      expect(res.success).toBe(true);
      expect(res.message).toContain('sent to your mobile');
      expect(res.message).toContain('email could not be delivered');
    });

    test('still succeeds on email alone when the SMS fails', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ sent: true });
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: false, error: 'DLT rejected' });
      const res = await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1');
      expect(res.message).toBe(`Verification OTP sent to ${EMAIL}. The SMS could not be delivered right now.`);
    });

    test('fails with a clear message when neither channel delivers', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockRejectedValue(new Error('User-rate limit exceeded'));
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: false });
      await expect(authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1')).rejects.toThrow(AUTH_MESSAGES.OTP_DELIVERY_FAILED);
    });

    test.each([
      ['development', undefined],
      ['test', 'test'],
      ['production with SMTP configured', 'production'],
    ])('never returns the issued code in the response (%s)', async (_label, nodeEnv) => {
      const originalEnv = process.env.NODE_ENV;
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
      jest.spyOn(mailerService, 'isConfigured').mockReturnValue(nodeEnv === 'production');
      const emailSend = jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ success: true, status: 'sent' });
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true, status: 'sent' });
      try {
        const res = await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1');
        const issuedCode = emailSend.mock.calls[0][1];
        expect(issuedCode).toMatch(/^\d{6}$/);
        expect(res).not.toHaveProperty('demoCode');
        expect(res).not.toHaveProperty('demoEmailCode');
        expect(res).not.toHaveProperty('demoMobileCode');
        expect(JSON.stringify(res)).not.toContain(issuedCode);
      } finally {
        if (originalEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = originalEnv;
      }
    });

    test('never returns the issued code in a registration response either', async () => {
      const emailSend = jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ success: true, status: 'sent' });
      const smsSend = jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true, status: 'sent' });
      const res = await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1', true);
      expect(res).not.toHaveProperty('demoCode');
      expect(res).not.toHaveProperty('demoMobileCode');
      expect(JSON.stringify(res)).not.toContain(emailSend.mock.calls[0][1]);
      expect(JSON.stringify(res)).not.toContain(smsSend.mock.calls[0][1]);
    });

    test('does not say a pending channel was sent, and names what is still in flight', async () => {
      jest.useFakeTimers();
      jest.spyOn(mailerService, 'sendOtpEmail').mockReturnValue(new Promise(() => { }));
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true, status: 'sent' });
      const pending = authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1');
      await jest.advanceTimersByTimeAsync(20 * 1000 + 1);
      const res = await pending;
      expect(res.delivery).toEqual({ email: 'pending', sms: 'sent' });
      expect(res.message).toBe(
        `Verification OTP status: the email to ${EMAIL} is still being sent, and the SMS to +91 ${MOBILE} was sent.`
      );
      expect(res.message).not.toMatch(/dispatched|sent to/);
      jest.useRealTimers();
    });
  });

  describe('requestOtp storage and lookup failures', () => {
    test('a failed account lookup does not block a registration OTP', async () => {
      identityQueries.findUserByEmailAndPhone.mockRejectedValue(new Error('D1 hiccup'));
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ sent: true });
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true });
      await expect(authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1', true)).resolves.toEqual(
        expect.objectContaining({ success: true })
      );
    });

    test('a code that could not be stored is never sent', async () => {
      authSessionQueries.saveOtp.mockRejectedValue(new Error('write failed'));
      const send = jest.spyOn(mailerService, 'sendOtpEmail');
      await expect(authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1')).rejects.toThrow(AUTH_MESSAGES.OTP_STORAGE_FAILED);
      expect(send).not.toHaveBeenCalled();
    });

    test('preserves configured persistence failure so the API can return a retryable error', async () => {
      authSessionQueries.saveOtp.mockRejectedValue(
        Object.assign(new Error('D1 unavailable'), { code: 'PERSISTENCE_UNAVAILABLE' })
      );
      const send = jest.spyOn(mailerService, 'sendOtpEmail');

      await expect(authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1')).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('requestOtp (registration)', () => {
    test('requires the email to go out, since registration verifies the email code', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockRejectedValue(new Error('invalid_grant'));
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true });
      await expect(authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1', true)).rejects.toThrow(
        AUTH_MESSAGES.OTP_EMAIL_DELIVERY_FAILED
      );
    });

    test('requires the SMS to go out, since registration verifies the mobile code', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ sent: true });
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: false });
      await expect(authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1', true)).rejects.toThrow(
        AUTH_MESSAGES.OTP_SMS_DELIVERY_FAILED
      );
    });

    test('succeeds when both registration codes are delivered', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ sent: true });
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true });
      const res = await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1', true);
      expect(res.success).toBe(true);
      expect(res.message).toContain('Email OTP sent to');
    });
  });
});

describe('authService registration OTP verification and startup', () => {
  let originalPool;
  const payload = { name: 'New User', email: EMAIL, password: 'Pass@1234', mobile: MOBILE, orgName: 'Org' };
  const future = () => Date.now() + 60 * 1000;
  const past = () => Date.now() - 1000;

  function storedCodes({ email, mobile, single } = {}) {
    jest.spyOn(authSessionQueries, 'findOtp').mockImplementation(async (key) => {
      if (/^\+\d+_email/.test(key)) return email || null;
      if (/^\+\d+_mobile/.test(key)) return mobile || null;
      return single || null;
    });
  }

  beforeEach(() => {
    originalPool = dbPool.pool;
    dbPool.pool = { query: jest.fn() };
    jest.spyOn(authSessionQueries, 'deleteOtp').mockResolvedValue(true);
    jest.spyOn(authSessionQueries, 'incrementOtpAttempts').mockResolvedValue(true);
    jest.spyOn(storeService, 'addAuditLog').mockImplementation(() => { });
    jest.spyOn(identityQueries, 'insertBuyerAccount').mockResolvedValue({
      created: true,
      user: { id: 'u1', email: EMAIL, name: 'New User', role: 'buyer', orgId: 'o1', orgName: 'Org' },
    });
  });

  afterEach(() => {
    dbPool.pool = originalPool;
    jest.restoreAllMocks();
  });

  test('both registration codes are required and checked independently', async () => {
    storedCodes({ email: { code: '111111', expiresAt: future() }, mobile: { code: '222222', expiresAt: future() } });
    await expect(authService.registerUser(payload, '::1')).rejects.toThrow('Please enter the 6-digit Email OTP');
    await expect(authService.registerUser({ ...payload, emailOtp: '999999' }, '::1')).rejects.toThrow('Invalid Email OTP');
    expect(authSessionQueries.incrementOtpAttempts).toHaveBeenCalledWith(expect.stringMatching(/^\+\d+_email/));
    await expect(authService.registerUser({ ...payload, emailOtp: '111111' }, '::1')).rejects.toThrow(
      'Please enter the 6-digit Mobile SMS OTP'
    );
    await expect(authService.registerUser({ ...payload, emailOtp: '111111', mobileOtp: '12345' }, '::1')).rejects.toThrow(
      'Invalid Mobile SMS OTP'
    );
    const ok = await authService.registerUser({ ...payload, emailOtp: '111111', mobileOtp: '222222' }, '::1');
    expect(ok.success).toBe(true);
    expect(authSessionQueries.deleteOtp).toHaveBeenCalledTimes(3);
  });

  test('expired registration codes are deleted and rejected', async () => {
    storedCodes({ email: { code: '111111', expiresAt: past() }, mobile: { code: '222222', expiresAt: future() } });
    await expect(authService.registerUser({ ...payload, emailOtp: '111111', mobileOtp: '222222' }, '::1')).rejects.toThrow(
      'Email OTP has expired'
    );
    storedCodes({ mobile: { code: '222222', expiresAt: past() } });
    await expect(authService.registerUser({ ...payload, emailOtp: '111111', mobileOtp: '222222' }, '::1')).rejects.toThrow(
      'Mobile SMS OTP has expired'
    );
    storedCodes({ email: { code: '111111', expiresAt: future() } });
    await expect(authService.registerUser({ ...payload, emailOtp: '111111', mobileOtp: '222222' }, '::1')).resolves.toEqual(
      expect.objectContaining({ success: true })
    );
  });

  test('the single-code fallback rejects expired and wrong codes and accepts the right one', async () => {
    storedCodes({ single: { code: '333333', expiresAt: past() } });
    await expect(authService.registerUser({ ...payload, code: '333333' }, '::1')).rejects.toThrow(AUTH_MESSAGES.INVALID_OTP);
    storedCodes({ single: { code: '333333', expiresAt: future() } });
    await expect(authService.registerUser({ ...payload, code: '000000' }, '::1')).rejects.toThrow(AUTH_MESSAGES.INVALID_OTP);
    await expect(authService.registerUser({ ...payload, emailOtp: '333333' }, '::1')).resolves.toEqual(
      expect.objectContaining({ success: true })
    );
  });

  test('resolveAuthSecret uses the configured key, refuses to run keyless in production, and otherwise generates one', () => {
    expect(authService.resolveAuthSecret({ AUTH_SECRET: 'configured' })).toBe('configured');
    expect(authService.resolveAuthSecret({ JWT_SECRET: 'jwt' })).toBe('jwt');
    expect(() => authService.resolveAuthSecret({ NODE_ENV: 'production' })).toThrow('AUTH_SECRET (or JWT_SECRET) must be set');
    expect(authService.resolveAuthSecret({})).toMatch(/^[0-9a-f]{96}$/);
  });

  test('hydrateFromDB sweeps expired state and survives a failed sweep', async () => {
    jest.spyOn(dbPool, 'checkDatabaseHealth').mockResolvedValue({ isConnected: true });
    const purge = jest.spyOn(authSessionQueries, 'purgeExpiredAuthState').mockResolvedValue({ otpsPurged: 2, revokedTokensPurged: 0 });
    await authService.hydrateFromDB();
    expect(purge).toHaveBeenCalled();
    purge.mockResolvedValue({ otpsPurged: 0, revokedTokensPurged: 0 });
    await authService.hydrateFromDB();
    purge.mockRejectedValue(new Error('sweep failed'));
    await expect(authService.hydrateFromDB()).resolves.not.toThrow();
  });
});

describe('Vendor Directory OTP delivery', () => {
  let originalPool;

  beforeEach(() => {
    originalPool = dbPool.pool;
    dbPool.pool = { query: jest.fn() };
    jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
    jest.spyOn(authSessionQueries, 'saveOtp').mockResolvedValue(true);
    jest.spyOn(storeService, 'addAuditLog').mockImplementation(() => { });
  });

  afterEach(() => {
    dbPool.pool = originalPool;
    jest.restoreAllMocks();
  });

  test('says the code was sent only when the mail provider accepted it', async () => {
    const send = jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ success: true, status: 'sent' });

    const res = await authService.requestVendorDirectoryOtp('analyst@procucev.com', '::1');

    expect(res.message).toBe(AUTH_MESSAGES.VENDOR_DIRECTORY_OTP_SENT);
    expect(send.mock.calls[0][1]).toMatch(/^\d{6}$/);
    expect(JSON.stringify(res)).not.toContain(send.mock.calls[0][1]);
  });

  test.each([
    ['the provider refused', { success: false, status: 'not_configured' }],
    ['the send was throttled', { sent: false, reason: 'throttled' }],
    ['the mailer threw', 'throw'],
  ])('fails the request and does not claim the code was sent when %s', async (_label, outcome) => {
    const send = jest.spyOn(mailerService, 'sendOtpEmail');
    if (outcome === 'throw') send.mockRejectedValue(new Error('SMTP down'));
    else send.mockResolvedValue(outcome);

    await expect(authService.requestVendorDirectoryOtp('analyst@procucev.com', '::1')).rejects.toThrow(
      /could not send the verification code/
    );
  });
});
