// Backend tests must never touch the real, shared Neon database. `app.js`
// loads `.env` via dotenv, which does NOT override a variable that already
// exists in `process.env` — so pre-setting this here (before any test file's
// own requires run) permanently blanks it out for the whole test process.
// `pool.js`'s resolveConfig() treats an empty string exactly like "unset"
// (`env.DATABASE_URL || ''`), so a query is refused outright rather than
// reaching the real database. Tests that specifically exercise pool/migrate/view
// CLI logic (pool.test.js, migrate.test.js, view.test.js,
// storeServiceRemainingBranches.test.js) set their own fake DATABASE_URL value
// per test case and are unaffected by this default.
process.env.DATABASE_URL = '';

// Session-signing key, pinned for the whole test process.
//
// authService resolves this once at module load. Without it, a non-production
// process generates a random key, which is correct behaviour but leaves the suite
// unable to sign a token itself — and the tests that build deliberately malformed
// tokens have to produce a valid signature first in order to reach the payload
// checks at all.
//
// It used to work because authService shipped a hardcoded fallback secret and
// three tests re-signed with that literal. That literal is gone: it meant the
// signing key for any deployment that forgot to set AUTH_SECRET was sitting in
// the repository. Pinning it here is the test-side replacement.
process.env.AUTH_SECRET = 'test-only-session-signing-key-not-used-anywhere-else';
