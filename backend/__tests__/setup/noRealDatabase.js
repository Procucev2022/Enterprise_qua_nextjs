// ==============================================================================
// TEST SAFETY NET: NO REAL DATABASE
// ==============================================================================
// Severs the PostgreSQL connection for every test file before any test runs.
//
// This exists because it went wrong. `backend/.env` is loaded by src/app.js, so
// under `npm test` the pool connected to the real database, and any suite that
// exercised a write without doubling the query layer inserted rows for real. It
// left dozens of fixture records sitting in the live tables alongside genuine
// buyer data.
//
// Nulling the pool makes that impossible rather than merely discouraged: any query
// that reaches the driver now throws pool.NOT_CONFIGURED_MESSAGE, which is a loud,
// obvious failure in the suite that forgot its double.
//
// Tests that need a configured pool assign their own stub and restore it after
// (see buyerAccountResolver.test.js and migrate.test.js).
//
// One pool covers everything now. This used to null two — a MySQL identity pool
// and a Postgres domain pool — and the MySQL one is gone along with its driver.
// ==============================================================================

const pool = require('../../src/db/pool');
const authSessionQueries = require('../../src/db/authSessionQueries');

beforeAll(async () => {
  if (pool.pool) {
    // Close it rather than dropping the reference, so no socket is left open and
    // jest does not have to be forced to exit.
    try {
      await pool.pool.end();
    } catch {
      // Already closed, or never actually connected. Either is fine.
    }
  }
  pool.pool = null;
  pool.isConfigured = false;
});

// ==============================================================================
// AUTH SESSION STATE DOUBLE
// ==============================================================================
// Issued OTPs and revoked session tokens live in PostgreSQL now, and
// `authenticate` reads the revocation table on every authenticated request. With
// the pool severed above, that read throws, and `assertSessionActive` fails
// closed — which is the correct production behaviour, but it would reject every
// authenticated request in the suite.
//
// So the harness supplies a working in-memory double of just that table. This is
// deliberately here and not in the application module: the app has no in-memory
// fallback for auth state, and adding one to make tests pass is exactly the kind
// of thing this change set removed. Tests get a double; production gets the
// database or an error.
//
// Assigned directly onto the module rather than via jest.spyOn, because several
// suites call jest.restoreAllMocks() in afterEach and would otherwise strip the
// double half way through a file.
const otpRows = new Map();
const revokedSignatures = new Map();

/** Wipe the doubled state. Called between tests so suites cannot leak into each other. */
function resetAuthSessionDouble() {
  otpRows.clear();
  revokedSignatures.clear();
}

authSessionQueries.saveOtp = async (otpKey, code, expiresAt) => {
  otpRows.set(otpKey, { otpKey, code, attempts: 0, expiresAt: new Date(expiresAt).getTime() });
};

authSessionQueries.findOtp = async (otpKey) => {
  const row = otpRows.get(otpKey);
  return row ? { ...row } : null;
};

authSessionQueries.deleteOtp = async (otpKey) => otpRows.delete(otpKey);

authSessionQueries.incrementOtpAttempts = async (otpKey) => {
  const row = otpRows.get(otpKey);
  if (!row) return 0;
  row.attempts += 1;
  return row.attempts;
};

authSessionQueries.revokeToken = async (signature, expiresAt) => {
  if (!revokedSignatures.has(signature)) {
    revokedSignatures.set(signature, new Date(expiresAt).getTime());
  }
};

authSessionQueries.isTokenRevoked = async (signature) => revokedSignatures.has(signature);

authSessionQueries.purgeExpiredAuthState = async () => {
  const now = Date.now();
  let otpsPurged = 0;
  let revokedTokensPurged = 0;
  otpRows.forEach((row, key) => {
    if (row.expiresAt < now) {
      otpRows.delete(key);
      otpsPurged += 1;
    }
  });
  revokedSignatures.forEach((expiresAt, key) => {
    if (expiresAt < now) {
      revokedSignatures.delete(key);
      revokedTokensPurged += 1;
    }
  });
  return { otpsPurged, revokedTokensPurged };
};

authSessionQueries.__resetForTests = resetAuthSessionDouble;

afterEach(() => {
  resetAuthSessionDouble();
});
