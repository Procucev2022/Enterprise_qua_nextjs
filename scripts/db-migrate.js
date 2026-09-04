#!/usr/bin/env node
// ==============================================================================
// DATABASE MIGRATION ENTRY POINT
// ==============================================================================
// Wired to `npm run db:migrate`, which is step 5 of the quality pipeline.
//
// This replaces the previous target, `node backend/src/db/seed.js`, which only
// loaded a JavaScript fixture module and exited 0 — it never verified or applied
// a schema, so the gate reported success against nothing.
//
// Exit codes:
//   0  migrations applied, or already up to date, or the database is not
//      configured (CI and local checkouts have no MySQL credentials, and that
//      must not fail the gate)
//   1  a real migration error against a configured database
// ==============================================================================

const path = require('path');
const { createRequire } = require('module');

const backendDir = path.join(__dirname, '..', 'backend');

// dotenv and mysql2 are backend dependencies; the workspace root only carries
// tooling. Anchoring the require at backend/package.json resolves them from
// backend/node_modules instead of failing at the root.
const backendRequire = createRequire(path.join(backendDir, 'package.json'));
backendRequire('dotenv').config({ path: path.join(backendDir, '.env') });

const { runMigrations, MIGRATION_STATUS } = require('../backend/src/db/migrationRunner');

async function main() {
  const report = await runMigrations();

  if (report.status === MIGRATION_STATUS.SKIPPED_NOT_CONFIGURED) {
    process.stdout.write(
      'Database not configured; skipped ' + report.total + ' migration(s).\n'
    );
    return 0;
  }

  process.stdout.write(
    `Migrations up to date: ${report.applied.length} applied, ` +
      `${report.alreadyApplied.length} already present, ${report.total} total.\n`
  );
  if (report.applied.length > 0) {
    process.stdout.write(`  Applied: ${report.applied.join(', ')}\n`);
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`Migration failed: ${err.message}\n`);
    if (err.stack) process.stderr.write(`${err.stack}\n`);
    process.exit(1);
  });
