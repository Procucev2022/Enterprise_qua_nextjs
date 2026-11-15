#!/usr/bin/env node

/**
 * Procucev Enterprise - Fast Quality Check (Changed Files & Fast Iteration)
 * Rapid iterative verification for quick code changes during pair-programming.
 *
 * Detects modified/staged files via Git and runs only the relevant typechecks,
 * unit test suites, and linters for the touched areas.
 */

const { execSync } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const backendDir = path.resolve(rootDir, 'backend');
const frontendDir = path.resolve(rootDir, 'frontend');

const isAll = process.argv.includes('--all') || process.argv.includes('-a');

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

function getChangeContext() {
  try {
    const statusOut = execSync('git status --porcelain', { cwd: rootDir, encoding: 'utf8' });
    const uncommitted = statusOut
      .split('\n')
      .map((line) => line.slice(3).trim())
      .filter(Boolean);

    const hasCodeInUncommitted = uncommitted.some(
      (f) => f.startsWith('frontend/') || f.startsWith('backend/') || f === 'package.json'
    );

    if (hasCodeInUncommitted) {
      return { mode: 'uncommitted', files: uncommitted };
    }

    // If no uncommitted code changes, inspect the most recent commit
    const diffOut = execSync('git diff --name-only HEAD~1', { cwd: rootDir, encoding: 'utf8' }).toString().trim();
    const committed = diffOut.split('\n').map((l) => l.trim()).filter(Boolean);
    return { mode: 'committed', files: committed };
  } catch {
    return { mode: 'fallback', files: [] };
  }
}

console.log('\n⚡ Running Procucev Fast Incremental Quality Check...\n');

const changeCtx = getChangeContext();
const changedFiles = changeCtx.files;
const hasFrontendChanges = isAll || changedFiles.length === 0 || changedFiles.some((f) => f.startsWith('frontend/') || f === 'package.json');
const hasBackendChanges = isAll || changedFiles.length === 0 || changedFiles.some((f) => f.startsWith('backend/') || f === 'package.json');

console.log(`[INFO] Mode: ${changeCtx.mode.toUpperCase()} (${changedFiles.length} files detected: ${changedFiles.slice(0, 4).join(', ')}${changedFiles.length > 4 ? '...' : ''})`);
console.log(`[INFO] Scope: Frontend = ${hasFrontendChanges ? 'ACTIVE' : 'SKIPPED'}, Backend = ${hasBackendChanges ? 'ACTIVE' : 'SKIPPED'}\n`);

// 1. TypeScript Typecheck (runs when frontend touched or --all)
if (hasFrontendChanges) {
  runFastStep('TypeScript Typecheck', 'npm run typecheck', frontendDir);
} else {
  console.log('⚡ [FAST QC] TypeScript Typecheck skipped (no frontend modifications).');
}

// 2. Backend Unit Tests (runs only tests affected by changed files)
if (hasBackendChanges) {
  let backendTestCmd;
  if (isAll) {
    backendTestCmd = 'npm test -- --bail --maxWorkers=2 --passWithNoTests';
  } else if (changeCtx.mode === 'committed') {
    backendTestCmd = 'npm test -- --bail --changedSince=HEAD~1 --passWithNoTests';
  } else {
    backendTestCmd = 'npm test -- --bail --onlyChanged --passWithNoTests';
  }
  runFastStep('Backend Fast Unit Tests', backendTestCmd, backendDir);
} else {
  console.log('⚡ [FAST QC] Backend Unit Tests skipped (no backend modifications).');
}

// 3. Frontend Unit Tests (runs only tests affected by changed files)
if (hasFrontendChanges) {
  let frontendTestCmd;
  if (isAll) {
    frontendTestCmd = 'npm test -- --bail --maxWorkers=2 --passWithNoTests';
  } else if (changeCtx.mode === 'committed') {
    frontendTestCmd = 'npm test -- --bail --changedSince=HEAD~1 --passWithNoTests';
  } else {
    frontendTestCmd = 'npm test -- --bail --onlyChanged --passWithNoTests';
  }
  runFastStep('Frontend Fast Unit Tests', frontendTestCmd, frontendDir);
} else {
  console.log('⚡ [FAST QC] Frontend Unit Tests skipped (no frontend modifications).');
}

// 4. Fast Lint Check
if (hasFrontendChanges) {
  runFastStep('Frontend Fast Lint', 'npm run lint', frontendDir);
} else {
  console.log('⚡ [FAST QC] Frontend Lint skipped (no frontend modifications).');
}

console.log('\n✔ ⚡ FAST QUALITY CHECK COMPLETE - ALL CHANGED PATHS HEALTHY\n');
