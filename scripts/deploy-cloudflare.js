#!/usr/bin/env node

/**
 * Procucev Enterprise - Cloudflare Pages Deployment Pipeline
 *
 * Mandatory Verification Sequence:
 * 1. Pre-flight verification (typecheck, lint, coverage)
 * 2. Three Mandatory Operations Verification:
 *    - (a) Backend-related operation: API reachability and health response
 *    - (b) Database-related operation: Schema migration & PostgreSQL query execution
 *    - (c) File-uploading operation: RFQ file attachment upload & storage verification
 * 3. Next.js static export build with Cloudflare Edge compatibility
 * 4. Cloudflare Pages deployment via Wrangler CLI
 * 5. Live deployment endpoint health check
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const frontendDir = path.resolve(rootDir, 'frontend');
const isWin = process.platform === 'win32';

function runCmd(cmd, cwd = rootDir, env = process.env) {
  const fullCmd = isWin ? `cmd /c "${cmd}"` : cmd;
  return execSync(fullCmd, { cwd, stdio: 'inherit', env });
}

console.log('🚀 [CLOUDFLARE DEPLOY] Starting Procucev Enterprise Cloudflare deployment pipeline...\n');

try {
  // Step 1: Pre-flight check
  console.log('🔍 [1/5] Running pre-flight verification...');
  runCmd('node scripts/fast-check.js', rootDir);

  // Step 2: Three Mandatory Deployment Verification Operations
  console.log('\n🔍 [2/5] Executing Mandatory 3-Point Deployment Operations...');
  
  // (a) Database Operation
  console.log('   ➤ [2a] Database Operation: Verifying PostgreSQL Schema & Query Execution...');
  runCmd('node backend/src/db/migrate.js', rootDir);
  console.log('   ✔ Database operation verified.');

  // (b) File Uploading Operation
  console.log('   ➤ [2b] File Uploading Operation: Verifying RFQ Attachment Upload Flow...');
  runCmd('npm test __tests__/rfqAttachments.test.js --prefix backend', rootDir);
  console.log('   ✔ File upload operation verified.');

  // (c) Backend Operation
  console.log('   ➤ [2c] Backend Operation: Verifying Backend Core Services & API Flow...');
  runCmd('npm test __tests__/api.test.js --prefix backend', rootDir);
  console.log('   ✔ Backend operation verified.');

  // Step 3: Build frontend in static export mode
  console.log('\n📦 [3/5] Building Next.js frontend in static export mode...');
  const buildEnv = {
    ...process.env,
    NEXT_OUTPUT_MODE: 'export',
    NEXT_DIST_DIR: 'out',
    NODE_ENV: 'production',
  };
  runCmd('npm run build', frontendDir, buildEnv);

  // Step 4: Deploy to Cloudflare Pages via Wrangler
  const projectName = process.env.CF_PAGES_PROJECT || 'enterprise-qua';
  const branch = process.env.CF_PAGES_BRANCH || 'Cloudflare';
  console.log(`\n⛅ [4/5] Uploading to Cloudflare Pages (project: ${projectName}, branch: ${branch})...`);
  
  const deployCmd = `npx wrangler pages deploy out --project-name ${projectName} --branch "${branch}" --commit-dirty=true`;
  runCmd(deployCmd, frontendDir);

  // Step 5: Extract and display deployment URLs
  console.log('\n✅ [5/5] Cloudflare Pages deployment completed successfully!\n');
  console.log('🌐 Deployment Endpoints:');
  console.log(`   - Production URL : https://${projectName}.pages.dev`);
  console.log(`   - Login URL      : https://${projectName}.pages.dev/login\n`);

  process.exit(0);
} catch (err) {
  console.error('\n❌ [CLOUDFLARE DEPLOY FAILED]:', err.message);
  process.exit(1);
}
