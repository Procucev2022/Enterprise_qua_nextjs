#!/usr/bin/env node

/**
 * Procucev Enterprise - Unified Quality Check Pipeline
 *
 * Sequence:
 * 1. Build Verification (Next.js / Frontend Production Bundle)
 * 2. Unit Test & Per-File 90% Code Coverage Benchmark (Backend + Frontend)
 * 3. Typecheck (TypeScript Static Type Analysis)
 * 4. Lint Verification (ESLint Core Web Vitals & Zero Warnings)
 * 5. Cross-Database Schema Parity & Migration Verification (PostgreSQL / D1)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function printHeader(title) {
  console.log('\n================================================================================');
  console.log(`  [QC STEP] ${title}`);
  console.log('================================================================================\n');
}

function runStep(title, command, cwd = rootDir, extraEnv = {}) {
  printHeader(title);
  const start = Date.now();
  try {
    execSync(command, { cwd, stdio: 'inherit', env: { ...process.env, CI: 'true', ...extraEnv } });
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`\n✔ [SUCCESS] ${title} passed in ${duration}s.\n`);
  } catch (error) {
    console.error(`\n✖ [FAILED] ${title} encountered an error.`);
    process.exit(1);
  }
}

console.log('\n🚀 Starting Procucev Enterprise Workspace Quality Check Pipeline...\n');

// 1. Build Verification
const qcDir = path.resolve(rootDir, 'frontend', '.next-qc');
if (!fs.existsSync(qcDir)) {
  try { fs.mkdirSync(qcDir, { recursive: true }); } catch (_) {}
}
// Built into a dedicated directory so the gate never contends with a running
// `next dev` server over `.next` (concurrent access causes EPERM on Windows).
// NODE_ENV is pinned: a shell left on NODE_ENV=development makes `next build`
// mix dev and prod React runtimes, failing every prerender with
// "Cannot read properties of null (reading 'useContext')".
runStep('Step 1: Production Build Verification', 'npm run build --prefix frontend', rootDir, {
  NEXT_DIST_DIR: '.next-qc',
  NODE_ENV: 'production',
  NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=6144',
});

// 2. Unit Test & Per-File Coverage (Backend + Frontend)
if (process.env.FAST_PRECOMMIT === 'true') {
  runStep('Step 2: Master Workspace Coverage Verification Gate (90% Per-File Enforcement)', 'npm run check:coverage');
} else {
  runStep('Step 2A: Backend Test Suite & 90% Per-File Coverage Enforcement', 'npm run test:coverage --prefix backend');
  runStep('Step 2B: Frontend Test Suite & 90% Per-File Coverage Enforcement', 'npm run test:coverage --prefix frontend');
  runStep('Step 2C: Master Workspace Coverage Verification Gate', 'npm run check:coverage');
}

// 3. TypeScript Typecheck
runStep('Step 3: TypeScript Static Typecheck Verification', 'npm run typecheck --prefix frontend');

// 4. Linter & Zero-Warning Enforcement
runStep('Step 4: Linter & Static Code Analysis Verification', 'npm run lint --prefix frontend');

// 5. Database Schema & Migration Health Check
const schemaPath = path.resolve(rootDir, 'backend/src/db/schema.sql');
runStep('Step 5A: PostgreSQL / D1 Schema Parity', 'npm run check:db-schema-parity');
runStep('Step 5B: Schema Parity Checker Regression Tests', 'npm run test:db-schema-parity');
// A commit gate must not write to the shared database. DATABASE_URL alone used
// to trigger a live migration, and VS Code injects the root .env into terminals
// ("python.terminal.useEnvFile"), so every commit applied schema.sql to the
// shared D1 database and failed whenever that .env held a stale Cloudflare
// token (403). A live migration now runs only when asked for explicitly.
if (process.env.QC_RUN_MIGRATIONS === 'true') {
  runStep('Step 5: Database Schema & Migration Verification', 'node backend/src/db/migrate.js');
} else if (fs.existsSync(schemaPath) && fs.statSync(schemaPath).size > 0) {
  printHeader('Step 5: Database Schema & Migration Verification');
  console.log(`[migrate] Schema file verified at ${schemaPath} (${fs.statSync(schemaPath).size} bytes).`);
  console.log('[migrate] Live migration skipped (set QC_RUN_MIGRATIONS=true to apply schema.sql to the configured database).');
  console.log(`\n✔ [SUCCESS] Step 5: Database Schema & Migration Verification passed.\n`);
} else {
  console.error(`\n✖ [FAILED] Step 5: Database Schema & Migration Verification: ${schemaPath} is missing or empty.`);
  process.exit(1);
}

console.log('================================================================================');
console.log('  🎉 ALL WORKSPACE QUALITY CHECKS PASSED SUCCESSFULLY');
console.log('================================================================================\n');
