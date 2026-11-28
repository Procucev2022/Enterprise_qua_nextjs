const fs = require('fs');
const os = require('os');
const path = require('path');
const fastCheck = require('../../scripts/fast-check');

describe('scripts/fast-check.js pre-commit and coverage verification', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'procucev-fast-check-'));
    fs.mkdirSync(path.join(tempRoot, 'backend/src'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'frontend/app'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'frontend/lib'), { recursive: true });
  });

  afterEach(() => {
    if (tempRoot && tempRoot.startsWith(os.tmpdir())) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('parses null-delimited git paths and porcelain v1 -z statuses including renames and deletions', () => {
    expect(fastCheck.parseNullDelimitedList('')).toEqual([]);
    expect(
      fastCheck.parseNullDelimitedList('backend\\src\\a.js\0frontend/app/b.tsx\0\0')
    ).toEqual(['backend/src/a.js', 'frontend/app/b.tsx']);

    const porcelain = [
      'M  backend/src/a.js',
      'R  frontend/app/new.tsx\0frontend/app/old.tsx',
      ' D backend/src/removed.js',
      '?? frontend/lib/helper.ts',
      '',
    ].join('\0');
    expect(fastCheck.parsePorcelainStatusZ(porcelain)).toEqual({
      active: ['backend/src/a.js', 'frontend/app/new.tsx', 'frontend/lib/helper.ts'],
      deleted: ['backend/src/removed.js'],
    });
  });

  test('classifies backend, frontend, policy, DB parity, and documentation changes accurately', () => {
    const scope = fastCheck.classifyChanges(
      [
        'backend/src/controllers/bootstrapController.js',
        'frontend/app/buyer/vendor-summary.tsx',
        'frontend/lib/types.d.ts',
        'scripts/coverage-policy.cjs',
        'backend/src/db/schema.sql',
        'prompts.md',
      ],
      ['backend/src/old.js']
    );

    expect(scope.backendSources).toEqual(['backend/src/controllers/bootstrapController.js']);
    expect(scope.frontendSources).toEqual(['frontend/app/buyer/vendor-summary.tsx']);
    expect(scope.touchedPolicyOrWorkflow).toBe(true);
    expect(scope.touchedDbOrParity).toBe(true);
    expect(scope.hasBackendChanges).toBe(true);
    expect(scope.hasFrontendChanges).toBe(true);
    expect(scope.touchedBackendConfig).toBe(false);
    expect(scope.touchedFrontendConfig).toBe(false);

    const docsOnly = fastCheck.classifyChanges(['prompts.md', 'README.md'], []);
    expect(docsOnly.hasBackendChanges).toBe(false);
    expect(docsOnly.hasFrontendChanges).toBe(false);
    expect(docsOnly.touchedPolicyOrWorkflow).toBe(false);
    expect(docsOnly.touchedDbOrParity).toBe(false);
  });

  test('rejects modified source files that lack coverage reports or fall below 90% in any metric', () => {
    const backendDir = path.join(tempRoot, 'backend');
    const summaryPath = path.join(backendDir, 'coverage-fast', 'coverage-summary.json');

    // Missing coverage summary file altogether
    expect(
      fastCheck.verifyChangedFilesCoverage(
        backendDir,
        'backend',
        ['src/controllers/bootstrapController.js'],
        summaryPath
      ).failures
    ).toEqual([expect.stringContaining('missing coverage summary')]);

    // Missing specific modified file from summary (e.g., new file with zero tests)
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    fs.writeFileSync(summaryPath, JSON.stringify({ total: {}, 'backend/src/other.js': {} }));
    expect(
      fastCheck.verifyChangedFilesCoverage(
        backendDir,
        'backend',
        ['src/controllers/bootstrapController.js'],
        summaryPath
      ).failures
    ).toEqual(['backend: src/controllers/bootstrapController.js is missing from the coverage report (no covering tests ran).']);

    // Sub-90% branch coverage rejected
    const full = {
      statements: { total: 100, covered: 95 },
      branches: { total: 100, covered: 89 },
      functions: { total: 100, covered: 95 },
      lines: { total: 100, covered: 95 },
    };
    fs.writeFileSync(
      summaryPath,
      JSON.stringify({
        total: full,
        '/workspace/backend/src/controllers/bootstrapController.js': full,
      })
    );
    expect(
      fastCheck.verifyChangedFilesCoverage(
        backendDir,
        'backend',
        ['src/controllers/bootstrapController.js'],
        summaryPath
      ).failures
    ).toEqual(['backend: src/controllers/bootstrapController.js: branches 89.00% < 90%.']);

    // >= 90% across all four metrics passes
    full.branches.covered = 90;
    fs.writeFileSync(
      summaryPath,
      JSON.stringify({
        total: full,
        '/workspace/backend/src/controllers/bootstrapController.js': full,
      })
    );
    const passed = fastCheck.verifyChangedFilesCoverage(
      backendDir,
      'backend',
      ['src/controllers/bootstrapController.js'],
      summaryPath
    );
    expect(passed.failures).toEqual([]);
    expect(passed.checked).toEqual(['src/controllers/bootstrapController.js']);
  });

  test('exempts declaration-only frontend TypeScript modules while rejecting invalid JSON summaries', () => {
    const frontendDir = path.join(tempRoot, 'frontend');
    fs.writeFileSync(path.join(frontendDir, 'lib/types.ts'), 'export interface VendorItem { id: string; }\n');
    const summaryPath = path.join(frontendDir, 'coverage-fast', 'coverage-summary.json');

    const declOnly = fastCheck.verifyChangedFilesCoverage(frontendDir, 'frontend', ['lib/types.ts'], summaryPath);
    expect(declOnly.failures).toEqual([]);
    expect(declOnly.checked).toEqual(['lib/types.ts']);

    fs.writeFileSync(path.join(frontendDir, 'app/page.tsx'), 'export const val = 1;\n');
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    fs.writeFileSync(summaryPath, '{bad json');
    expect(
      fastCheck.verifyChangedFilesCoverage(frontendDir, 'frontend', ['app/page.tsx'], summaryPath).failures
    ).toEqual([expect.stringContaining('invalid coverage summary JSON')]);
  });
});
