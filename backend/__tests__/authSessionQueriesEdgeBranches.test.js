// The auth-session store's less common paths: a missing key, an ISO timestamp with a zone,
// an in-memory OTP that was never issued, and revocations that have already expired.
const authSessionQueries = require('../src/db/authSessionQueries');
const pool = require('../src/db/pool');

const real = authSessionQueries.__real;

describe('auth session queries - less common paths', () => {
  let querySpy;
  let rowsSpy;
  let hasStorageSpy;

  beforeEach(() => {
    hasStorageSpy = jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [], rowCount: 0 });
    rowsSpy = jest.spyOn(pool, 'rows').mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('refuses an OTP that has neither a key nor an email hint, before the database is touched', async () => {
    await expect(real.saveOtp(undefined, '123456', Date.now() + 60_000)).rejects.toMatchObject({
      code: 'OTP_EMAIL_REQUIRED',
    });
    expect(querySpy).not.toHaveBeenCalled();
  });

  test('reads a timestamp that carries a zone designator as an absolute time', async () => {
    rowsSpy.mockResolvedValueOnce([
      { otp_key: 'iso-zone', code: '1', attempts: 0, expires_at: '2026-10-24T12:00:00Z' },
    ]);

    await expect(real.findOtp('iso-zone')).resolves.toMatchObject({
      expiresAt: new Date('2026-10-24T12:00:00Z').getTime(),
    });
  });

  test('reports zero attempts for an in-memory OTP that was never issued', async () => {
    hasStorageSpy.mockReturnValue(false);

    await expect(real.incrementOtpAttempts('never-issued')).resolves.toBe(0);
  });

  test('keeps the upsert failure as the cause when the fallback rejects without an error object', async () => {
    querySpy
      .mockRejectedValueOnce(new Error('upsert rejected'))
      .mockRejectedValueOnce(null);

    await expect(real.revokeToken('sig-upsert-fail', Date.now() + 60_000)).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
      cause: expect.objectContaining({ message: 'upsert rejected' }),
    });
  });

  test('treats an in-memory revocation that has already expired as not revoked', async () => {
    hasStorageSpy.mockReturnValue(false);
    await real.revokeToken('sig-expired-memory', Date.now() - 1000);

    await expect(real.isTokenRevoked('sig-expired-memory')).resolves.toBe(false);
  });

  test('drops an expired in-memory revocation before it asks the database', async () => {
    hasStorageSpy.mockReturnValue(false);
    await real.revokeToken('sig-stale', Date.now() - 1000);
    hasStorageSpy.mockReturnValue(true);
    rowsSpy.mockResolvedValueOnce([]);

    await expect(real.isTokenRevoked('sig-stale')).resolves.toBe(false);
    expect(rowsSpy).toHaveBeenCalledTimes(1);
  });
});
