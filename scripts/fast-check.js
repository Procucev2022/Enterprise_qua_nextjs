#!/usr/bin/env node

/**
 * Procucev Enterprise - Fast Quality Check (Changed Files & Fast Iteration)
 * Rapid iterative verification for quick code changes during pair-programming.
 */

const { execSync } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const backendDir = path.resolve(rootDir, 'backend');
const frontendDir = path.resolve(rootDir, 'frontend');

function printFastHeader(title) {
  console.log(`\n⚡ [FAST QC] ${title}...`);
}

function runFastStep(title, command, cwd = rootDir) {
  printFastHeader(title);
  const start = Date.now();
  try {
    execSync(command, { cwd, stdio: 'inherit', env: { ...process.env, CI: 'true' } });
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`✔ ${title} passed (${duration}s)`);
  } catch (error) {
    console.error(`✖ ${title} failed.`);
    process.exit(1);
  }
}

console.log('\n⚡ Running Procucev Fast Incremental Quality Check...\n');

// 1. Fast TypeScript Typecheck
runFastStep('TypeScript Typecheck', 'npm run typecheck', frontendDir);

// 2. Fast Backend Tests
runFastStep('Backend Fast Unit Tests', 'npm test -- --bail --maxWorkers=2 --passWithNoTests', backendDir);

// 3. Fast Frontend Tests
runFastStep('Frontend Fast Unit Tests', 'npm test -- --bail --maxWorkers=2 --passWithNoTests', frontendDir);

// 4. Fast Lint Check
runFastStep('Frontend Fast Lint', 'npm run lint', frontendDir);

console.log('\n✔ ⚡ FAST QUALITY CHECK COMPLETE - ALL CHANGED PATHS HEALTHY\n');
