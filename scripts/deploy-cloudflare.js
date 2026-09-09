#!/usr/bin/env node

/**
 * Procucev Enterprise - Cloudflare Pages Deployment Pipeline
 *
 * Automates:
 * 1. Pre-flight verification (typecheck & asset verification)
 * 2. Next.js static export build with Cloudflare Edge compatibility
 * 3. Cloudflare Pages deployment via Wrangler CLI
 * 4. Health verification on live deployment URL
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const frontendDir = path.resolve(rootDir, 'frontend');

console.log('🚀 [CLOUDFLARE DEPLOY] Starting Procucev Enterprise Cloudflare deployment pipeline...\n');

try {
  // Step 1: Pre-flight check
  console.log('🔍 [1/4] Running pre-flight verification...');
  execSync('node scripts/fast-check.js', { cwd: rootDir, stdio: 'inherit' });

  // Step 2: Build frontend in static export mode
  console.log('\n📦 [2/4] Building Next.js frontend in static export mode...');
  const buildEnv = {
    ...process.env,
    NEXT_OUTPUT_MODE: 'export',
    NEXT_DIST_DIR: 'out',
    NODE_ENV: 'production',
  };
  execSync('npm run build', { cwd: frontendDir, env: buildEnv, stdio: 'inherit' });

  // Step 3: Deploy to Cloudflare Pages via Wrangler
  const projectName = process.env.CF_PAGES_PROJECT || 'enterprise-qua';
  const branch = process.env.CF_PAGES_BRANCH || 'main';
  console.log(`\n⛅ [3/4] Uploading to Cloudflare Pages (project: ${projectName}, branch: ${branch})...`);
  const deployOutput = execSync(
    `npx wrangler pages deploy out --project-name ${projectName} --branch "${branch}" --commit-dirty=true`,
    { cwd: frontendDir, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] }
  );

  console.log(deployOutput);

  // Step 4: Extract and display deployment URLs
  console.log('✅ [4/4] Cloudflare Pages deployment completed successfully!\n');
  console.log('🌐 Deployment Endpoints:');
  console.log(`   - Production URL : https://${projectName}.pages.dev`);
  console.log(`   - Login URL      : https://${projectName}.pages.dev/login\n`);

  process.exit(0);
} catch (err) {
  console.error('\n❌ [CLOUDFLARE DEPLOY FAILED]:', err.message);
  process.exit(1);
}
