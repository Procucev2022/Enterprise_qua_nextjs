// Backend tests must never touch the real, shared Neon database. `app.js`
// loads `.env` via dotenv, which does NOT override a variable that already
// exists in `process.env` — so pre-setting this here (before any test file's
// own requires run) permanently blanks it out for the whole test process.
// `pool.js`'s resolveConfig() treats an empty string exactly like "unset"
// (`env.DATABASE_URL || ''`), so every storeService persistence call
// gracefully no-ops instead of writing real fixture data into Neon, matching
// the app's own designed fallback behavior. Tests that specifically exercise
// pool/migrate/view CLI logic (pool.test.js, migrate.test.js, view.test.js,
// storeServiceRemainingBranches.test.js) already set their own fake
// DATABASE_URL value per test case and are unaffected by this default.
process.env.DATABASE_URL = '';
