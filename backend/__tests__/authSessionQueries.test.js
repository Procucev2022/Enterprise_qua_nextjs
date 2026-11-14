// The shared harness replaces this module's exports with an in-memory double so
// every authenticated request in the suite can resolve a session without a
// database (see setup/noRealDatabase.js). That double would otherwise shadow the
// real implementations for the whole run, so it stashes them on `__real` and this
// file exercises those against a stubbed pool — the SQL itself is what needs
// covering here.
const authSessionQueries = require('../src/db/authSessionQueries');
const pool = require('../src/db/pool');

const real = authSessionQueries.__real;

describe('Auth session queries (Neon PostgreSQL)', () => {
  let querySpy;
  let rowsSpy;

  beforeEach(() => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [], rowCount: 0 });
    rowsSpy = jest.spyOn(pool, 'rows').mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── OTP codes ─────────────────────────────────────────────────────────────
  describe('saveOtp', () => {
    test('upserts so a resend supersedes the previous code and resets the attempts', async () => {
      const expiresAt = Date.now() + 60_000;

      await real.saveOtp('+919157154504_EMAIL_a@b.com', '123456', expiresAt);

      const [sql, params] = querySpy.mock.calls[0];
      expect(sql).toContain('insert into auth_otp_codes');
      // Two rows for one key would leave the older code still redeemable.
      expect(sql).toContain('on conflict (otp_key) do update set');
      expect(sql).toContain('attempts = 0');
      expect(sql).toContain('email = excluded.email');
      expect(params[0]).toBe('+919157154504_EMAIL_a@b.com');
      // The email is written with every OTP: the live D1 table declares it NOT NULL.
      expect(params[1]).toBe('a@b.com');
      expect(params[2]).toBe('123456');
      // An ISO string, not a raw Date object — D1's bind() only accepts
      // TEXT/INTEGER/REAL/BLOB/NULL, and pg accepts an ISO string for a
      // timestamptz column exactly as well as a Date.
      expect(params[3]).toBe(new Date(expiresAt).toISOString());
    });
    test('falls back to delete and insert, keeping the email, when the upsert rejects', async () => {
      const expiresAt = Date.now() + 60_000;
      querySpy
        .mockRejectedValueOnce(new Error('null value in column "email" violates not-null constraint: auth_otp_codes.email'))
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 });

      await real.saveOtp('+919157154504_EMAIL_a@b.com', '123456', expiresAt);
      expect(querySpy).toHaveBeenCalledTimes(3);
      expect(querySpy.mock.calls[1][0]).toContain('delete from auth_otp_codes where otp_key = $1');
      expect(querySpy.mock.calls[2][0]).toContain('insert into auth_otp_codes (otp_key, email, code, attempts, expires_at, created_at)');
      expect(querySpy.mock.calls[2][1]).toEqual(['+919157154504_EMAIL_a@b.com', 'a@b.com', '123456', new Date(expiresAt).toISOString()]);
    });

    test('uses the email hint when the OTP key does not carry one', async () => {
      const expiresAt = Date.now() + 60_000;
      querySpy
        .mockRejectedValueOnce(new Error('ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint'))
        .mockResolvedValueOnce({ rowCount: 0 })
        .mockResolvedValueOnce({ rowCount: 1 });

      await real.saveOtp('customKey', '654321', expiresAt, 'test@example.com');
      expect(querySpy).toHaveBeenCalledTimes(3);
      expect(querySpy.mock.calls[1][0]).toContain('delete from auth_otp_codes where otp_key = $1');
      expect(querySpy.mock.calls[2][0]).toContain('insert into auth_otp_codes (otp_key, email, code, attempts, expires_at, created_at)');
      expect(querySpy.mock.calls[2][1]).toEqual(['customKey', 'test@example.com', '654321', new Date(expiresAt).toISOString()]);
    });

    test('refuses to store an OTP that names no email, before touching the database', async () => {
      await expect(real.saveOtp('noEmailKey', '123456', Date.now() + 60_000)).rejects.toMatchObject({
        code: 'OTP_EMAIL_REQUIRED',
      });
      expect(querySpy).not.toHaveBeenCalled();
    });

    test('fails closed if delete-insert fallback also fails', async () => {
      const expiresAt = Date.now() + 60_000;
      querySpy
        .mockRejectedValueOnce(new Error('primary failure'))
        .mockRejectedValueOnce(new Error('delete failure'));

      await expect(real.saveOtp('plainKey', '111111', expiresAt, 'plain@example.com')).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
        cause: expect.objectContaining({ message: 'delete failure' }),
      });
    });

    test('fails closed on a non-Error database rejection', async () => {
      const expiresAt = Date.now() + 60_000;
      querySpy.mockRejectedValue('raw string error');
      await expect(real.saveOtp('plainKey', '123456', expiresAt, 'plain@example.com')).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
      });
    });

    test('parses Date object and empty string in parseExpiryTimestamp', async () => {
      const d = new Date('2026-05-01T10:00:00Z');
      rowsSpy.mockResolvedValueOnce([{ otp_key: 'kd', code: '1', attempts: 0, expires_at: d }]);
      const fd = await real.findOtp('kd');
      expect(fd.expiresAt).toBe(d.getTime());

      rowsSpy.mockResolvedValueOnce([{ otp_key: 'ke', code: '1', attempts: 0, expires_at: '' }]);
      const fe = await real.findOtp('ke');
      expect(fe.expiresAt).toBe(0);

      // Branch where raw is undefined/null
      rowsSpy.mockResolvedValueOnce([{ otp_key: 'kf', code: '1', attempts: 0, expires_at: undefined }]);
      const ff = await real.findOtp('kf');
      expect(ff.expiresAt).toBe(0);
    });
  });

  describe('findOtp', () => {
    test('returns the stored code with its expiry as epoch milliseconds', async () => {
      const expiresAt = new Date(Date.now() + 60_000);
      rowsSpy.mockResolvedValue([
        { otp_key: 'k', code: '123456', attempts: 2, expires_at: expiresAt },
      ]);

      const found = await real.findOtp('k');
      expect(found).toEqual({
        otpKey: 'k',
        code: '123456',
        attempts: 2,
        expiresAt: expiresAt.getTime(),
      });
    });

    test('parses numeric epoch and string timestamps in various formats', async () => {
      const now = Date.now();
      rowsSpy.mockResolvedValueOnce([{ otp_key: 'k1', code: '1', attempts: 1, expires_at: now }]);
      const f1 = await real.findOtp('k1');
      expect(f1.expiresAt).toBe(now);

      rowsSpy.mockResolvedValueOnce([{ otp_key: 'k2', code: '2', attempts: 1, expires_at: String(now) }]);
      const f2 = await real.findOtp('k2');
      expect(f2.expiresAt).toBe(now);

      rowsSpy.mockResolvedValueOnce([{ otp_key: 'k3', code: '3', attempts: 1, expires_at: '2026-10-24 12:00:00' }]);
      const f3 = await real.findOtp('k3');
      expect(f3.expiresAt).toBe(new Date('2026-10-24T12:00:00Z').getTime());

      rowsSpy.mockResolvedValueOnce([{ otp_key: 'k4', code: '4', attempts: 1, expires_at: 'invalid-date-string' }]);
      const f4 = await real.findOtp('k4');
      expect(f4.expiresAt).toBe(0);

      rowsSpy.mockResolvedValueOnce([{ otp_key: 'k5', code: '5', attempts: 1, expires_at: null }]);
      const f5 = await real.findOtp('k5');
      expect(f5.expiresAt).toBe(0);
    });

    test('does not return a stale memory OTP when the configured database has no row', async () => {
      const expiresAt = Date.now() + 10_000;
      await real.saveOtp('memKey', '999888', expiresAt, 'mem@example.com');
      rowsSpy.mockResolvedValueOnce([]);

      await expect(real.findOtp('memKey')).resolves.toBeNull();
    });

    test('fails closed when configured OTP lookup fails', async () => {
      const cause = new Error('Connection failure');
      rowsSpy.mockRejectedValueOnce(cause);

      await expect(real.findOtp('memKey2')).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
        cause,
      });
    });

    test('fails closed when configured OTP lookup fails for a missing key', async () => {
      rowsSpy.mockRejectedValueOnce(new Error('Connection failure'));

      await expect(real.findOtp('absentKey')).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
      });
    });

    test('returns null when there is no code for the key', async () => {
      rowsSpy.mockResolvedValue([]);
      await expect(real.findOtp('missing')).resolves.toBeNull();
    });

    test('defaults a null attempts column to zero', async () => {
      rowsSpy.mockResolvedValue([
        { otp_key: 'k', code: '1', attempts: null, expires_at: new Date() },
      ]);
      await expect(real.findOtp('k')).resolves.toMatchObject({ attempts: 0 });
    });
  });

  describe('deleteOtp', () => {
    test('reports whether a row was consumed', async () => {
      querySpy.mockResolvedValue({ rowCount: 1 });
      await expect(real.deleteOtp('k')).resolves.toBe(true);

      querySpy.mockResolvedValue({ rowCount: 0 });
      await expect(real.deleteOtp('k')).resolves.toBe(false);
    });

    test('treats an absent rowCount as nothing deleted', async () => {
      querySpy.mockResolvedValue({});
      await expect(real.deleteOtp('k')).resolves.toBe(false);
    });

    test('fails closed if OTP deletion fails in configured storage', async () => {
      await real.saveOtp('toDeleteMem', '123456', Date.now() + 60000, 'delete@example.com');
      querySpy.mockRejectedValueOnce(new Error('DB failure'));

      await expect(real.deleteOtp('toDeleteMem')).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
    });
  });

  describe('incrementOtpAttempts', () => {
    test('increments in SQL and returns the new count', async () => {
      querySpy.mockResolvedValue({ rows: [{ attempts: 3 }] });

      await expect(real.incrementOtpAttempts('k')).resolves.toBe(3);
      expect(querySpy.mock.calls[0][0]).toContain('attempts = attempts + 1');
    });

    test('returns 0 when the key no longer exists', async () => {
      querySpy.mockResolvedValue({ rows: [] });
      await expect(real.incrementOtpAttempts('k')).resolves.toBe(0);
    });

    test('fails closed when configured attempt counter update fails', async () => {
      await real.saveOtp('memInc', '111222', Date.now() + 60000, 'inc@example.com');
      querySpy.mockRejectedValue(new Error('DB failure'));

      await expect(real.incrementOtpAttempts('memInc')).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
    });
  });

  // ── Revoked tokens ────────────────────────────────────────────────────────
  describe('revokeToken', () => {
    test('records the signature and is idempotent', async () => {
      const expiresAt = Date.now() + 60_000;

      await real.revokeToken('sig-1', expiresAt);

      const [sql, params] = querySpy.mock.calls[0];
      expect(sql).toContain('insert into auth_revoked_tokens');
      expect(sql).toContain('on conflict (signature) do nothing');
      expect(params).toEqual(['sig-1', new Date(expiresAt).toISOString()]);
    });

    test('handles fallback when primary insert fails', async () => {
      const expiresAt = Date.now() + 60_000;
      querySpy
        .mockRejectedValueOnce(new Error('no on conflict'))
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 });

      await real.revokeToken('sig-fallback', expiresAt);
      expect(querySpy).toHaveBeenCalledTimes(3);
      expect(querySpy.mock.calls[1][0]).toContain('delete from auth_revoked_tokens where signature = $1');
      expect(querySpy.mock.calls[2][0]).toContain('insert into auth_revoked_tokens');
    });

    test('fails closed if token revocation cannot be persisted', async () => {
      const expiresAt = Date.now() + 60_000;
      querySpy
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'));

      await expect(real.revokeToken('sig-memory-fallback', expiresAt)).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
      });
    });
  });

  describe('isTokenRevoked', () => {
    test('reports true when a revocation row exists', async () => {
      rowsSpy.mockResolvedValue([{ '?column?': 1 }]);
      await expect(real.isTokenRevoked('sig-1')).resolves.toBe(true);
    });

    test('reports false when there is none', async () => {
      rowsSpy.mockResolvedValue([]);
      await expect(real.isTokenRevoked('sig-1')).resolves.toBe(false);
    });

    test('propagates a read failure so the caller can fail closed', async () => {
      rowsSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(real.isTokenRevoked('sig-1')).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
      });
    });

    test('fails closed when the database is overloaded and no positive memory revocation exists', async () => {
      const d1Bridge = require('../src/db/d1Bridge');
      const spy = jest.spyOn(d1Bridge, 'isD1Overloaded').mockReturnValue(true);
      await expect(real.isTokenRevoked('sig-overload-test')).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
      });
      spy.mockRestore();
    });

    test('fails closed when pool.rows throws a D1 overload error', async () => {
      rowsSpy.mockRejectedValue(new Error('D1_ERROR: D1 DB is overloaded'));
      await expect(real.isTokenRevoked('sig-retryable-test')).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
      });
    });

    test('uses a known positive memory revocation during a database overload', async () => {
      const d1Bridge = require('../src/db/d1Bridge');
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      await real.revokeToken('sig-known-revoked', Date.now() + 60_000);
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(d1Bridge, 'isD1Overloaded').mockReturnValue(true);

      await expect(real.isTokenRevoked('sig-known-revoked')).resolves.toBe(true);
    });
  });

  // ── Sweep ─────────────────────────────────────────────────────────────────
  describe('purgeExpiredAuthState', () => {
    test('drops expired codes and revoked entries, reporting both counts', async () => {
      querySpy
        .mockResolvedValueOnce({ rowCount: 4 })
        .mockResolvedValueOnce({ rowCount: 7 });

      await expect(real.purgeExpiredAuthState()).resolves.toEqual({
        otpsPurged: 4,
        revokedTokensPurged: 7,
      });

      const statements = querySpy.mock.calls.map(([sql]) => sql);
      expect(statements[0]).toContain('delete from auth_otp_codes where expires_at < now()');
      expect(statements[1]).toContain('delete from auth_revoked_tokens where expires_at < now()');
    });

    test('reports zeroes when the driver gives no row counts', async () => {
      querySpy.mockResolvedValue({});
      await expect(real.purgeExpiredAuthState()).resolves.toEqual({
        otpsPurged: 0,
        revokedTokensPurged: 0,
      });
    });

    test('fails closed if auth-state cleanup fails in configured storage', async () => {
      querySpy.mockRejectedValueOnce(new Error('DB failure'));
      await expect(real.purgeExpiredAuthState()).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
    });
  });

  // ── The harness double ────────────────────────────────────────────────────
  describe('the harness double', () => {
    test('round-trips an OTP in memory without touching the pool', async () => {
      const expiresAt = Date.now() + 60_000;
      await authSessionQueries.saveOtp('double-key', '999999', expiresAt);

      await expect(authSessionQueries.findOtp('double-key')).resolves.toMatchObject({
        code: '999999',
        attempts: 0,
      });
      await expect(authSessionQueries.incrementOtpAttempts('double-key')).resolves.toBe(1);
      await expect(authSessionQueries.deleteOtp('double-key')).resolves.toBe(true);
      await expect(authSessionQueries.findOtp('double-key')).resolves.toBeNull();

      expect(querySpy).not.toHaveBeenCalled();
      expect(rowsSpy).not.toHaveBeenCalled();
    });

    test('round-trips a revocation in memory', async () => {
      await expect(authSessionQueries.isTokenRevoked('double-sig')).resolves.toBe(false);
      await authSessionQueries.revokeToken('double-sig', Date.now() + 60_000);
      await expect(authSessionQueries.isTokenRevoked('double-sig')).resolves.toBe(true);
    });

    test('sweeps only entries whose expiry has passed', async () => {
      await authSessionQueries.saveOtp('expired', '1', Date.now() - 1000);
      await authSessionQueries.saveOtp('live', '2', Date.now() + 60_000);
      await authSessionQueries.revokeToken('expired-sig', Date.now() - 1000);

      const purged = await authSessionQueries.purgeExpiredAuthState();

      expect(purged).toEqual({ otpsPurged: 1, revokedTokensPurged: 1 });
      await expect(authSessionQueries.findOtp('live')).resolves.toMatchObject({ code: '2' });
      await expect(authSessionQueries.findOtp('expired')).resolves.toBeNull();
    });

    test('incrementing a key the double does not hold reports zero', async () => {
      await expect(authSessionQueries.incrementOtpAttempts('never-stored')).resolves.toBe(0);
    });
  });

  describe('unconfigured development storage', () => {
    beforeEach(() => {
      pool.hasStorage.mockReturnValue(false);
    });

    test('uses process memory only when no persistent database is configured', async () => {
      const expiresAt = Date.now() + 60_000;
      await real.saveOtp('offline-key', '111222', expiresAt);
      await expect(real.findOtp('offline-key')).resolves.toMatchObject({ code: '111222', attempts: 0 });
      await expect(real.incrementOtpAttempts('offline-key')).resolves.toBe(1);
      await expect(real.deleteOtp('offline-key')).resolves.toBe(true);
      await expect(real.findOtp('offline-key')).resolves.toBeNull();

      await real.revokeToken('offline-signature', expiresAt);
      await expect(real.isTokenRevoked('offline-signature')).resolves.toBe(true);
      await expect(real.purgeExpiredAuthState()).resolves.toEqual({ otpsPurged: 0, revokedTokensPurged: 0 });
      expect(querySpy).not.toHaveBeenCalled();
      expect(rowsSpy).not.toHaveBeenCalled();
    });

    test('removes expired OTP and revocation entries during memory cleanup', async () => {
      await real.saveOtp('expired-offline-key', '111222', Date.now() - 1000);
      await real.revokeToken('expired-offline-signature', Date.now() - 1000);

      await expect(real.purgeExpiredAuthState()).resolves.toEqual({
        otpsPurged: 1,
        revokedTokensPurged: 1,
      });
      await expect(real.findOtp('expired-offline-key')).resolves.toBeNull();
      await expect(real.isTokenRevoked('expired-offline-signature')).resolves.toBe(false);
    });
  });
});
