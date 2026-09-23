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
      expect(params[0]).toBe('+919157154504_EMAIL_a@b.com');
      expect(params[1]).toBe('123456');
      // An ISO string, not a raw Date object — D1's bind() only accepts
      // TEXT/INTEGER/REAL/BLOB/NULL, and pg accepts an ISO string for a
      // timestamptz column exactly as well as a Date.
      expect(params[2]).toBe(new Date(expiresAt).toISOString());
    });
  });

  describe('findOtp', () => {
    test('returns the stored code with its expiry as epoch milliseconds', async () => {
      const expiresAt = new Date(Date.now() + 60_000);
      rowsSpy.mockResolvedValue([
        { otp_key: 'k', code: '123456', attempts: 2, expires_at: expiresAt },
      ]);

      const found = await real.findOtp('k');

      // Milliseconds, so the caller compares numbers rather than reasoning about
      // how the driver rendered the timestamp.
      expect(found).toEqual({
        otpKey: 'k',
        code: '123456',
        attempts: 2,
        expiresAt: expiresAt.getTime(),
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
  });

  describe('incrementOtpAttempts', () => {
    test('increments in SQL and returns the new count', async () => {
      querySpy.mockResolvedValue({ rows: [{ attempts: 3 }] });

      await expect(real.incrementOtpAttempts('k')).resolves.toBe(3);
      // Incremented in the statement, not read-modify-written, so two
      // simultaneous wrong guesses both count.
      expect(querySpy.mock.calls[0][0]).toContain('attempts = attempts + 1');
    });

    test('returns 0 when the key no longer exists', async () => {
      querySpy.mockResolvedValue({ rows: [] });
      await expect(real.incrementOtpAttempts('k')).resolves.toBe(0);
    });
  });

  // ── Revoked tokens ────────────────────────────────────────────────────────
  describe('revokeToken', () => {
    test('records the signature and is idempotent', async () => {
      const expiresAt = Date.now() + 60_000;

      await real.revokeToken('sig-1', expiresAt);

      const [sql, params] = querySpy.mock.calls[0];
      expect(sql).toContain('insert into auth_revoked_tokens');
      // Logging out twice is not an error, and the first revocation time is the
      // one worth keeping.
      expect(sql).toContain('on conflict (signature) do nothing');
      expect(params).toEqual(['sig-1', new Date(expiresAt).toISOString()]);
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
      // Treating an unreachable database as "not revoked" would turn an outage
      // into a window where every logged-out token worked again.
      rowsSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(real.isTokenRevoked('sig-1')).rejects.toThrow('ECONNREFUSED');
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
      // A revoked entry is only needed until its own expiry; after that the token
      // fails the expiry check on its own.
      expect(statements[1]).toContain('delete from auth_revoked_tokens where expires_at < now()');
    });

    test('reports zeroes when the driver gives no row counts', async () => {
      querySpy.mockResolvedValue({});
      await expect(real.purgeExpiredAuthState()).resolves.toEqual({
        otpsPurged: 0,
        revokedTokensPurged: 0,
      });
    });
  });

  // ── The harness double ────────────────────────────────────────────────────
  // Asserted so a future change to the double cannot silently stop standing in
  // for the real module and leave authenticated requests failing suite-wide.
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
});
