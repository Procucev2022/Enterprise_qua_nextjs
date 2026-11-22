#!/usr/bin/env node

/**
 * Procucev Enterprise - Fast Incremental Quality & Pre-Commit Gate
 *
 * Detects changed files (staged files in --staged / git pre-commit mode, or
 * uncommitted/recent changes in manual mode) and enforces:
 * 1. TypeScript Typecheck & ESLint (when frontend or shared configs change)
 * 2. PostgreSQL / D1 Schema Parity & Regression Tests (when backend/db/scripts change)
 * 3. Related Unit Tests + STRICT 90% Per-File Coverage Verification across
 *    Statements, Branches, Functions, and Lines on every changed source file
 * 4. Next.js Production Build Verification into .next-qc (in --pre-commit / --with-build mode)
 */

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  COVERAGE_THRESHOLDS,
  METRICS,
  isDeclarationOnlySource,
  metricPercentage,
  relativeCoveragePath,
} = require('./coverage-policy.cjs');

const rootDir = path.resolve(__dirname, '..');
const backendDir = path.resolve(rootDir, 'backend');
const frontendDir = path.resolve(rootDir, 'frontend');

const FAST_COVERAGE_DIR = 'coverage-fast';

function parseNullDelimitedList(raw) {
  if (!raw) return [];
  return String(raw)
    .split('\0')
    .map((item) => item.trim().replace(/\\/g, '/'))
    .filter(Boolean);
}

function parsePorcelainStatusZ(raw) {
  if (!raw) return { active: [], deleted: [] };
  const tokens = String(raw).split('\0');
  const active = [];
  const deleted = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const entry = tokens[i];
    if (!entry || entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const filePath = entry.slice(3).replace(/\\/g, '/');
    if (status.startsWith('R') || status.startsWith('C')) {
      // In `git status --porcelain -z`, renames/copies put the new path first and old path second.
      if (filePath) active.push(filePath);
      i += 1;
      continue;
    }
    if (status.includes('D')) {
      if (filePath) deleted.push(filePath);
    } else if (filePath) {
      active.push(filePath);
    }
  }
  return { active, deleted };
}

function runGitNull(args) {
  return execFileSync('git', args, { cwd: rootDir, encoding: 'utf8' });
}

function getChangeContext({ stagedOnly = false, isAll = false } = {}) {
  if (isAll) {
    return { mode: 'all', active: [], deleted: [] };
  }

  if (stagedOnly) {
    const active = parseNullDelimitedList(
      runGitNull(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'])
    );
    const deleted = parseNullDelimitedList(
      runGitNull(['diff', '--cached', '--name-only', '-z', '--diff-filter=D'])
    );
    return { mode: 'staged', active, deleted };
  }

  try {
    const statusOut = runGitNull(['status', '--porcelain', '-z', '--untracked-files=all']);
    const uncommitted = parsePorcelainStatusZ(statusOut);
    if (uncommitted.active.length > 0 || uncommitted.deleted.length > 0) {
      return { mode: 'uncommitted', active: uncommitted.active, deleted: uncommitted.deleted };
    }

    const committedActive = parseNullDelimitedList(
      runGitNull(['diff', '--name-only', '-z', '--diff-filter=ACMR', 'HEAD~1'])
    );
    const committedDeleted = parseNullDelimitedList(
      runGitNull(['diff', '--name-only', '-z', '--diff-filter=D', 'HEAD~1'])
    );
    return { mode: 'committed', active: committedActive, deleted: committedDeleted };
  } catch {
    return { mode: 'fallback', active: [], deleted: [] };
  }
}

function classifyChanges(activeFiles = [], deletedFiles = []) {
  const all = [...activeFiles, ...deletedFiles];
  const isBackendSource = (f) => /^backend\/src\/.*\.(?:js|mjs)$/.test(f);
  const isFrontendSource = (f) => /^frontend\/(?:app|lib)\/.*\.(?:js|jsx|ts|tsx)$/.test(f) && !f.endsWith('.d.ts');

  const backendSources = activeFiles.filter(isBackendSource);
  const frontendSources = activeFiles.filter(isFrontendSource);
  const backendFiles = all.filter((f) => f.startsWith('backend/'));
  const frontendFiles = all.filter((f) => f.startsWith('frontend/'));

  const touchedRootPackage = all.includes('package.json');
  const touchedBackendConfig =
    touchedRootPackage || all.includes('backend/package.json') || all.includes('backend/jest.config.js');
  const touchedFrontendConfig =
    touchedRootPackage ||
    all.includes('frontend/package.json') ||
    all.includes('frontend/jest.config.cjs') ||
    all.includes('frontend/tsconfig.json') ||
    all.includes('frontend/.eslintrc.json') ||
    all.includes('frontend/next.config.mjs');
  const touchedPolicyOrWorkflow = all.some(
    (f) =>
      f === 'scripts/coverage-policy.cjs' ||
      f === 'scripts/generate-ci-summary.js' ||
      f === 'scripts/fast-check.js' ||
      f === 'scripts/quality-check.js' ||
      f.startsWith('.github/workflows/')
  );
  const touchedDbOrParity = all.some(
    (f) =>
      f.startsWith('backend/src/db/') ||
      f === 'scripts/check-db-schema-parity.cjs' ||
      f === 'scripts/check-db-schema-parity.test.cjs'
  );

  return {
    all,
    backendSources,
    frontendSources,
    backendFiles,
    frontendFiles,
    touchedBackendConfig,
    touchedFrontendConfig,
    touchedPolicyOrWorkflow,
    touchedDbOrParity,
    hasBackendChanges: backendFiles.length > 0 || touchedBackendConfig,
    hasFrontendChanges: frontendFiles.length > 0 || touchedFrontendConfig,
  };
}

function verifyChangedFilesCoverage(projectRoot, project, changedSourceRelPaths, summaryPath) {
  if (changedSourceRelPaths.length === 0) {
    return { checked: [], failures: [] };
  }

  const executableFiles = [];
  const declarationOnlyFiles = [];
  for (const relPath of changedSourceRelPaths) {
    const absPath = path.join(projectRoot, relPath);
    if (project === 'frontend' && isDeclarationOnlySource(absPath)) {
      declarationOnlyFiles.push(relPath);
    } else {
      executableFiles.push(relPath);
    }
  }

  if (executableFiles.length === 0) {
    return { checked: declarationOnlyFiles, failures: [] };
  }

  if (!fs.existsSync(summaryPath)) {
    return {
      checked: [],
      failures: [
        `${project}: missing coverage summary at ${summaryPath}. Every modified source file must have unit test coverage >= 90%.`,
      ],
    };
  }

  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  } catch (err) {
    return {
      checked: [],
      failures: [`${project}: invalid coverage summary JSON (${err.message}).`],
    };
  }

  const entries = new Map(
    Object.entries(summary)
      .filter(([name]) => name !== 'total')
      .map(([name, coverage]) => [relativeCoveragePath(name, project), coverage])
  );

  const failures = [];
  for (const relPath of executableFiles) {
    const coverage = entries.get(relPath);
    if (!coverage) {
      failures.push(`${project}: ${relPath} is missing from the coverage report (no covering tests ran).`);
      continue;
    }
    for (const metric of METRICS) {
      const pct = metricPercentage(coverage[metric]);
      if (pct === null) {
        failures.push(`${project}: ${relPath}: missing or invalid ${metric} coverage.`);
      } else if (pct < COVERAGE_THRESHOLDS[metric]) {
        failures.push(
          `${project}: ${relPath}: ${metric} ${pct.toFixed(2)}% < ${COVERAGE_THRESHOLDS[metric]}%.`
        );
      }
    }
  }

  return { checked: [...executableFiles, ...declarationOnlyFiles], failures };
}

function printFastHeader(title) {
  console.log(`\n⚡ [FAST QC] ${title}...`);
}

function runFastStep(title, command, cwd = rootDir, extraEnv = {}) {
  printFastHeader(title);
  const start = Date.now();
  try {
    execSync(command, { cwd, stdio: 'inherit', env: { ...process.env, CI: 'true', ...extraEnv } });
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`✔ ${title} passed (${duration}s)`);
  } catch {
    console.error(`✖ ${title} failed.`);
    process.exit(1);
  }
}

function runJestWithArgs(title, projectDir, args) {
  printFastHeader(title);
  const start = Date.now();
  const isBackend = projectDir === backendDir;
  const nodeArgs = isBackend
    ? ['--max-old-space-size=4096', '--experimental-vm-modules', path.join(projectDir, 'node_modules/jest/bin/jest.js'), ...args]
    : [path.join(projectDir, 'node_modules/jest/bin/jest.js'), ...args];
  try {
    execFileSync(process.execPath, nodeArgs, {
      cwd: projectDir,
      stdio: 'inherit',
      env: { ...process.env, CI: 'true' },
    });
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`✔ ${title} passed (${duration}s)`);
  } catch {
    console.error(`✖ ${title} failed.`);
    process.exit(1);
  }
}

function cleanupDir(targetDir) {
  try {
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup of ephemeral coverage-fast artifacts
  }
}

function runFastCheckCli(argv = process.argv.slice(2)) {
  const isAll = argv.includes('--all') || argv.includes('-a');
  const isPreCommit = argv.includes('--pre-commit');
  const stagedOnly = argv.includes('--staged');
  const withBuild = argv.includes('--with-build') || isPreCommit;

  console.log('\n⚡ Running Procucev Incremental Quality & Coverage Gate...\n');

  const changeCtx = getChangeContext({ stagedOnly, isAll });
  const scope = classifyChanges(changeCtx.active, changeCtx.deleted);

  const shouldCheckAll = isAll || changeCtx.mode === 'fallback' || (!stagedOnly && changeCtx.mode === 'committed' && scope.all.length === 0);
  const hasFrontendChanges = shouldCheckAll || scope.hasFrontendChanges;
  const hasBackendChanges = shouldCheckAll || scope.hasBackendChanges;
  const runParity = shouldCheckAll || hasBackendChanges || scope.touchedDbOrParity;

  console.log(
    `[INFO] Mode: ${changeCtx.mode.toUpperCase()} (${scope.all.length} files: ${scope.all.slice(0, 4).join(', ')}${scope.all.length > 4 ? '...' : ''})`
  );
  console.log(
    `[INFO] Scope: Frontend = ${hasFrontendChanges ? 'ACTIVE' : 'SKIPPED'}, Backend = ${hasBackendChanges ? 'ACTIVE' : 'SKIPPED'}, Parity = ${runParity ? 'ACTIVE' : 'SKIPPED'}, Build = ${withBuild && hasFrontendChanges ? 'ACTIVE' : 'SKIPPED'}\n`
  );

  if (stagedOnly && scope.all.length === 0) {
    console.log('ℹ️  No staged files detected for commit check. Nothing to verify.');
    return;
  }

  if (
    !shouldCheckAll &&
    !hasFrontendChanges &&
    !hasBackendChanges &&
    !scope.touchedPolicyOrWorkflow &&
    !scope.touchedDbOrParity
  ) {
    console.log('✔ Only non-code documentation/metadata files changed. Fast check passed.\n');
    return;
  }

  // 1. PostgreSQL / D1 Schema Parity
  if (runParity) {
    runFastStep('PostgreSQL / D1 Schema Parity', 'npm run check:db-schema-parity');
    runFastStep('Schema Parity Regression Tests', 'npm run test:db-schema-parity');
  }

  // 2. Policy / CI Workflow / Fast-check Tests
  if (scope.touchedPolicyOrWorkflow && !shouldCheckAll && !scope.touchedBackendConfig) {
    runJestWithArgs('CI Policy & Summary Regression Tests', backendDir, [
      '--bail',
      '--maxWorkers=2',
      '__tests__/coveragePolicy.test.js',
      '__tests__/ciSummary.test.js',
      '__tests__/fastCheck.test.js',
    ]);
  }

  // 3. TypeScript Typecheck (runs when frontend touched or --all)
  if (hasFrontendChanges) {
    runFastStep('TypeScript Typecheck', 'npm run typecheck', frontendDir);
  } else {
    console.log('⚡ [FAST QC] TypeScript Typecheck skipped (no frontend modifications).');
  }

  // 4. ESLint Check (runs when frontend touched or --all)
  if (hasFrontendChanges) {
    runFastStep('Frontend ESLint Check', 'npm run lint', frontendDir);
  } else {
    console.log('⚡ [FAST QC] Frontend Lint skipped (no frontend modifications).');
  }

  // 5. Backend Unit Tests + Strict 90% Per-File Coverage Gate on Changed Files
  const maxWorkersArg = `--maxWorkers=${process.env.JEST_MAX_WORKERS || '2'}`;
  if (hasBackendChanges) {
    if (shouldCheckAll || scope.touchedBackendConfig) {
      runFastStep('Backend Full Test Suite & 90% Per-File Coverage Gate', 'npm run test:coverage --prefix backend');
    } else {
      const backendRelFiles = scope.backendFiles.map((f) => f.slice('backend/'.length));
      const backendSrcRelFiles = scope.backendSources.map((f) => f.slice('backend/'.length));
      const fastCovAbs = path.join(backendDir, FAST_COVERAGE_DIR);
      cleanupDir(fastCovAbs);
      try {
        if (backendSrcRelFiles.length > 0) {
          const jestArgs = [
            '--bail',
            maxWorkersArg,
            '--passWithNoTests',
            '--coverage',
            `--coverageDirectory=${FAST_COVERAGE_DIR}`,
            '--coverageReporters=json-summary',
            '--coverageThreshold={}',
            ...backendSrcRelFiles.map((file) => `--collectCoverageFrom=${file}`),
            '--findRelatedTests',
            ...backendRelFiles,
          ];
          runJestWithArgs('Backend Related Tests & 90% Per-File Coverage', backendDir, jestArgs);
          const result = verifyChangedFilesCoverage(
            backendDir,
            'backend',
            backendSrcRelFiles,
            path.join(fastCovAbs, 'coverage-summary.json')
          );
          if (result.failures.length > 0) {
            console.error(`\n✖ Backend 90% per-file coverage check failed:\n${result.failures.join('\n')}`);
            process.exit(1);
          }
          console.log(`✔ Backend per-file 90% coverage verified for ${result.checked.length} modified file(s).`);
        } else {
          runJestWithArgs('Backend Related Unit Tests', backendDir, [
            '--bail',
            maxWorkersArg,
            '--passWithNoTests',
            '--findRelatedTests',
            ...backendRelFiles,
          ]);
        }
      } finally {
        cleanupDir(fastCovAbs);
      }
    }
  } else {
    console.log('⚡ [FAST QC] Backend Unit Tests skipped (no backend modifications).');
  }

  // 6. Frontend Unit Tests + Strict 90% Per-File Coverage Gate on Changed Files
  if (hasFrontendChanges) {
    if (shouldCheckAll || scope.touchedFrontendConfig) {
      runFastStep('Frontend Full Test Suite & 90% Per-File Coverage Gate', 'npm run test:coverage --prefix frontend');
    } else {
      const frontendRelFiles = scope.frontendFiles.map((f) => f.slice('frontend/'.length));
      const frontendSrcRelFiles = scope.frontendSources.map((f) => f.slice('frontend/'.length));
      const fastCovAbs = path.join(frontendDir, FAST_COVERAGE_DIR);
      cleanupDir(fastCovAbs);
      const testFilesToFind = frontendRelFiles.flatMap((f) =>
        f === 'lib/uiStrings.ts' ? ['__tests__/lib/uiStrings.test.ts'] : [f]
      );
      try {
        if (frontendSrcRelFiles.length > 0) {
          const jestArgs = [
            '--bail',
            maxWorkersArg,
            '--passWithNoTests',
            '--coverage',
            `--coverageDirectory=${FAST_COVERAGE_DIR}`,
            '--coverageReporters=json-summary',
            '--coverageThreshold={}',
            ...frontendSrcRelFiles.map((file) => `--collectCoverageFrom=${file}`),
            '--findRelatedTests',
            ...testFilesToFind,
          ];
          runJestWithArgs('Frontend Related Tests & 90% Per-File Coverage', frontendDir, jestArgs);
          const result = verifyChangedFilesCoverage(
            frontendDir,
            'frontend',
            frontendSrcRelFiles,
            path.join(fastCovAbs, 'coverage-summary.json')
          );
          if (result.failures.length > 0) {
            console.error(`\n✖ Frontend 90% per-file coverage check failed:\n${result.failures.join('\n')}`);
            process.exit(1);
          }
          console.log(`✔ Frontend per-file 90% coverage verified for ${result.checked.length} modified file(s).`);
        } else {
          runJestWithArgs('Frontend Related Unit Tests', frontendDir, [
            '--bail',
            maxWorkersArg,
            '--passWithNoTests',
            '--findRelatedTests',
            ...frontendRelFiles,
          ]);
        }
      } finally {
        cleanupDir(fastCovAbs);
      }
    }
  } else {
    console.log('⚡ [FAST QC] Frontend Unit Tests skipped (no frontend modifications).');
  }

  // 7. Next.js Production Build Verification (pre-commit / --with-build)
  if (withBuild && hasFrontendChanges) {
    const qcDir = path.resolve(frontendDir, '.next-qc');
    if (!fs.existsSync(qcDir)) {
      try {
        fs.mkdirSync(qcDir, { recursive: true });
      } catch { }
    }
    runFastStep('Next.js Production Build Verification', 'npm run build --prefix frontend', rootDir, {
      NEXT_DIST_DIR: '.next-qc',
      NODE_ENV: 'production',
      NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=6144',
    });
  }

  console.log('\n✔ ⚡ QUALITY GATE COMPLETE - ALL CHECKED PATHS MEET 90% COVERAGE & BUILD STANDARDS\n');
}

if (require.main === module) {
  runFastCheckCli();
}

module.exports = {
  FAST_COVERAGE_DIR,
  parseNullDelimitedList,
  parsePorcelainStatusZ,
  getChangeContext,
  classifyChanges,
  verifyChangedFilesCoverage,
  runFastCheckCli,
};
