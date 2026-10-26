const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const policy = require('../../scripts/coverage-policy.cjs');

const REPO_ROOT = path.resolve(__dirname, '../..');
const JEST_CLI = path.resolve(__dirname, '../node_modules/jest/bin/jest.js');
const FIXTURE_DIRECTORY = path.join(REPO_ROOT, 'scratch/coverage-policy-tests');
const METRICS = ['statements', 'branches', 'functions', 'lines'];
const fixtureRoots = [];

function coverage(covered = 90, total = 100) {
  return Object.fromEntries(METRICS.map((metric) => [metric, { covered, total, skipped: 0, pct: total ? (covered / total) * 100 : 100 }]));
}

function writeFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function fixture(project = 'backend', sourceNames = project === 'backend' ? ['src/feature.js'] : ['app/page.tsx', 'lib/client.ts']) {
  fs.mkdirSync(FIXTURE_DIRECTORY, { recursive: true });
  const root = fs.mkdtempSync(path.join(FIXTURE_DIRECTORY, 'procucev-coverage-test-'));
  fixtureRoots.push(root);
  const projectRoot = path.join(root, project);
  for (const source of sourceNames) writeFile(path.join(projectRoot, source), 'module.exports = 1;\n');
  if (project === 'frontend') {
    fs.mkdirSync(path.join(projectRoot, 'app'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'lib'), { recursive: true });
  } else {
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  }
  return { root, projectRoot, project, sourceNames };
}

function summaryFor(testFixture, covered = 90, total = 100) {
  return {
    total: coverage(covered, total),
    ...Object.fromEntries(testFixture.sourceNames.map((source) => [source, coverage(covered, total)])),
  };
}

function writeSummary(testFixture, summary) {
  writeFile(path.join(testFixture.projectRoot, 'coverage/coverage-summary.json'), typeof summary === 'string' ? summary : JSON.stringify(summary));
}

afterEach(() => {
  jest.restoreAllMocks();
  process.exitCode = 0;
});

afterAll(() => {
  for (const root of fixtureRoots) {
    if (path.dirname(root) !== path.resolve(FIXTURE_DIRECTORY) || !path.basename(root).startsWith('procucev-coverage-test-')) {
      throw new Error('Refusing to remove an unexpected coverage fixture directory');
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('strict per-file coverage inspection', () => {
  test('keeps the same immutable 90% requirement for all four metrics', () => {
    expect(policy.COVERAGE_THRESHOLDS).toEqual({ statements: 90, branches: 90, functions: 90, lines: 90 });
    expect(Object.isFrozen(policy.COVERAGE_THRESHOLDS)).toBe(true);
    expect(policy.METRICS).toEqual(METRICS);
  });

  test.each(METRICS)('rejects one file below 90% %s even with 100% aggregate coverage', (metric) => {
    const testFixture = fixture();
    const summary = summaryFor(testFixture, 100);
    summary['src/feature.js'][metric] = { covered: 89, total: 100, pct: 100 };
    const result = policy.inspectCoverage(testFixture.projectRoot, 'backend', summary);
    expect(result.failures).toEqual([`src/feature.js: ${metric} 89.00% < 90%.`]);
    expect(result.files).toEqual([expect.objectContaining({ file: 'src/feature.js', passed: false })]);
  });

  test.each(['backend', 'frontend'])('accepts exactly 90% in every metric for every %s source file', (project) => {
    const testFixture = fixture(project);
    const result = policy.inspectCoverage(testFixture.projectRoot, project, summaryFor(testFixture));
    expect(result.failures).toEqual([]);
    expect(result.files.every((file) => file.passed)).toBe(true);
    expect(result.files).toHaveLength(testFixture.sourceNames.length);
    expect(result.total).toEqual(Object.fromEntries(METRICS.map((metric) => [metric, 90])));
  });

  test('checks the exact ratio, so a rounded report percentage cannot hide a sub-90 value', () => {
    const testFixture = fixture();
    const summary = summaryFor(testFixture);
    summary['src/feature.js'].branches = { covered: 89999, total: 100000, pct: 90 };
    expect(policy.inspectCoverage(testFixture.projectRoot, 'backend', summary).files[0].passed).toBe(false);
  });

  test('detects a missing source file even when another file and the overall total pass', () => {
    const testFixture = fixture('backend', ['src/feature.js', 'src/newFeature.mjs']);
    const summary = summaryFor(testFixture, 100);
    delete summary['src/newFeature.mjs'];
    const result = policy.inspectCoverage(testFixture.projectRoot, 'backend', summary);
    expect(result.failures).toEqual(['src/newFeature.mjs: missing from the coverage report.']);
    expect(result.files.find((file) => file.file === 'src/newFeature.mjs')).toEqual({ file: 'src/newFeature.mjs', passed: false, percentages: {} });
  });

  test.each([null, undefined, [], 'invalid', 42])('rejects a malformed coverage summary: %p', (summary) => {
    const testFixture = fixture();
    expect(policy.inspectCoverage(testFixture.projectRoot, 'backend', summary)).toEqual({
      files: [], failures: ['Coverage summary must be an object.'], total: null,
    });
  });

  test.each([{}, { total: coverage(100) }])('rejects an empty or aggregate-only report: %p', (summary) => {
    const testFixture = fixture();
    const result = policy.inspectCoverage(testFixture.projectRoot, 'backend', summary);
    expect(result.failures).toContain('src/feature.js: missing from the coverage report.');
    expect(result.files[0].passed).toBe(false);
  });

  test('rejects a project without application files instead of passing zero inspected files', () => {
    const testFixture = fixture('backend', []);
    expect(policy.inspectCoverage(testFixture.projectRoot, 'backend', { total: coverage(100) }).failures)
      .toContain('No application source files were found.');
  });

  test.each(METRICS)('also rejects missing or failing aggregate %s coverage', (metric) => {
    const testFixture = fixture();
    const summary = summaryFor(testFixture, 100);
    summary.total[metric] = coverage(89)[metric];
    expect(policy.inspectCoverage(testFixture.projectRoot, 'backend', summary).failures)
      .toEqual([`OVERALL TOTAL: ${metric} 89.00% < 90%.`]);
    delete summary.total[metric];
    expect(policy.inspectCoverage(testFixture.projectRoot, 'backend', summary).failures)
      .toEqual([`OVERALL TOTAL: missing or invalid ${metric} coverage.`]);
  });

  test('treats files with no executable counters as 100%, while requiring real metric records', () => {
    const testFixture = fixture('frontend');
    const result = policy.inspectCoverage(testFixture.projectRoot, 'frontend', summaryFor(testFixture, 0, 0));
    expect(result.failures).toEqual([]);
    expect(result.files[0].percentages).toEqual(Object.fromEntries(METRICS.map((metric) => [metric, 100])));
    const summary = summaryFor(testFixture);
    delete summary['app/page.tsx'].functions;
    expect(policy.inspectCoverage(testFixture.projectRoot, 'frontend', summary).failures)
      .toContain('app/page.tsx: missing or invalid functions coverage.');
  });
});

describe('metric record validation', () => {
  test.each([
    undefined, null, {}, { pct: 100 },
    { covered: NaN, total: 100 }, { covered: 90, total: NaN },
    { covered: Infinity, total: Infinity }, { covered: '90', total: 100 },
    { covered: 90, total: '100' }, { covered: -1, total: 100 },
    { covered: 0, total: -1 }, { covered: 101, total: 100 },
    { covered: 1, total: 0 }, { covered: 89.5, total: 100 }, { covered: 90, total: 100.5 },
  ])('rejects invalid or impossible counters: %p', (metric) => {
    expect(policy.metricPercentage(metric)).toBeNull();
    const testFixture = fixture();
    const summary = summaryFor(testFixture, 100);
    summary['src/feature.js'].lines = metric;
    expect(policy.inspectCoverage(testFixture.projectRoot, 'backend', summary).failures)
      .toContain('src/feature.js: missing or invalid lines coverage.');
  });

  test('calculates percentages from counters rather than trusting the report percentage', () => {
    expect(policy.metricPercentage({ total: 10, covered: 9, pct: 0 })).toBe(90);
    expect(policy.metricPercentage({ total: 0, covered: 0, pct: 'Unknown' })).toBe(100);
  });
});

describe('source discovery and cross-platform coverage paths', () => {
  test.each([
    ['C:\\agent\\repo\\backend\\src\\feature.js', 'backend', 'src/feature.js'],
    ['/home/runner/repo/backend/src/feature.js', 'backend', 'src/feature.js'],
    ['./src/feature.js', 'backend', 'src/feature.js'],
    ['src/feature.js', 'backend', 'src/feature.js'],
    ['C:\\agent\\frontend\\frontend\\app\\page.tsx', 'frontend', 'app/page.tsx'],
    ['/home/runner/frontend/lib/client.ts', 'frontend', 'lib/client.ts'],
  ])('normalizes %s to the relevant %s source', (input, project, expected) => {
    expect(policy.relativeCoveragePath(input, project)).toBe(expected);
  });

  test.each(['backend', 'frontend'])('accepts artifacts produced on Windows or Linux for a %s project', (project) => {
    const testFixture = fixture(project);
    for (const prefix of [`C:\\agent\\repo\\${project}\\`, `/home/runner/repo/${project}/`, './']) {
      const summary = { total: coverage() };
      testFixture.sourceNames.forEach((source) => { summary[`${prefix}${prefix.startsWith('C:') ? source.replace(/\//g, '\\') : source}`] = coverage(); });
      expect(policy.inspectCoverage(testFixture.projectRoot, project, summary).failures).toEqual([]);
    }
  });

  test('discovers every executable frontend extension recursively and ignores declarations/assets', () => {
    const testFixture = fixture('frontend', ['app/page.tsx', 'app/nested/handler.js', 'app/nested/widget.jsx', 'lib/model.ts', 'lib/widget.tsx', 'lib/helper.js']);
    writeFile(path.join(testFixture.projectRoot, 'app/page.d.ts'), 'declare const page: string;');
    writeFile(path.join(testFixture.projectRoot, 'lib/asset.json'), '{}');
    writeFile(path.join(testFixture.projectRoot, '__tests__/page.test.tsx'), 'test');
    expect(policy.listSourceFiles(testFixture.projectRoot, 'frontend')).toEqual([...testFixture.sourceNames].sort());
  });

  test('includes public JavaScript and Worker modules in backend coverage', () => {
    const testFixture = fixture('backend', ['src/server.js', 'src/worker.mjs', 'src/public/browser.js']);
    writeFile(path.join(testFixture.projectRoot, 'src/schema.sql'), 'select 1;');
    expect(policy.listSourceFiles(testFixture.projectRoot, 'backend')).toEqual([...testFixture.sourceNames].sort());
  });
});

describe('declaration-only TypeScript files remain in the coverage inventory', () => {
  const declarations = [
    'export type UserRole = \'buyer\' | \'vendor\';',
    'export interface User { id: string; readonly tags?: string[]; }',
    'import type { User } from \'./model\'; export type Result = User | null;',
    '/* model */\n// Domain declarations\nexport interface Model {}\nexport {};',
    'declare const value: string; declare function lookup(id: string): string;',
    '// declarations only\n\n',
  ];

  test.each(declarations)('recognizes erased declarations without adding synthetic coverage counters: %s', (source) => {
    const testFixture = fixture('frontend', ['app/page.tsx', 'lib/types.ts']);
    writeFile(path.join(testFixture.projectRoot, 'lib/types.ts'), source);
    const summary = summaryFor(testFixture);
    delete summary['lib/types.ts'];
    const originalSummary = JSON.stringify(summary);
    const result = policy.inspectCoverage(testFixture.projectRoot, 'frontend', summary);
    expect(result.failures).toEqual([]);
    expect(result.files).toHaveLength(2);
    expect(result.files.find((file) => file.file === 'lib/types.ts')).toEqual({
      file: 'lib/types.ts', passed: true, declarationOnly: true,
      percentages: Object.fromEntries(METRICS.map((metric) => [metric, 100])),
      reason: expect.stringContaining('no executable statements'),
    });
    expect(JSON.stringify(summary)).toBe(originalSummary);
  });

  test.each([
    'export enum Status { Active, Closed }',
    'import { lookup } from \'./model\';',
    'import \'./side-effect\';',
    'export const value: number = 1;',
    'export function lookup(id: string) { return id; }',
    'export class Model { static value = 1; }',
    'class Model { static { console.log(1); } }',
    'console.log(1);',
    'const update = () => console.log(1);',
    '\'/* a string is not a comment */\';',
    '\'// a string is not a comment\';',
    '// comment\u2028console.log(1);',
    '// comment\u2029console.log(1);',
    'export interface Broken {',
    'export interface User {}\nconst token = \'secret\';',
    '/* first comment */ console.log(\'danger\') /* second comment */',
    '/* first comment */ import \'./side-effect\'; /* second comment */',
    '/* first comment */ export const value = 1; /* second comment */',
    '/** stars **/ class Model {} /** more stars **/',
    'export namespace Example { export const value = 1; }',
    'export default <div />;',
  ])('keeps a missing runtime or invalid TypeScript source as a failure: %s', (source) => {
    const testFixture = fixture('frontend', ['app/page.tsx', 'lib/types.ts']);
    writeFile(path.join(testFixture.projectRoot, 'lib/types.ts'), source);
    const summary = summaryFor(testFixture);
    delete summary['lib/types.ts'];
    expect(policy.inspectCoverage(testFixture.projectRoot, 'frontend', summary).failures)
      .toEqual(['lib/types.ts: missing from the coverage report.']);
  });

  test('never exempts JavaScript files, unreadable files, or reported invalid type-module metrics', () => {
    const testFixture = fixture('frontend', ['app/page.tsx', 'lib/types.ts', 'lib/empty.js']);
    writeFile(path.join(testFixture.projectRoot, 'lib/types.ts'), 'export type User = string;');
    writeFile(path.join(testFixture.projectRoot, 'lib/empty.js'), '// no executable JavaScript');
    expect(policy.isDeclarationOnlySource(path.join(testFixture.projectRoot, 'lib/empty.js'))).toBe(false);
    expect(policy.isDeclarationOnlySource(path.join(testFixture.projectRoot, 'missing.ts'))).toBe(false);
    const summary = summaryFor(testFixture);
    delete summary['lib/types.ts'].functions;
    expect(policy.inspectCoverage(testFixture.projectRoot, 'frontend', summary).failures)
      .toEqual(['lib/types.ts: missing or invalid functions coverage.']);
  });

  test('accepts erased TSX declarations while failing safely on unsupported JSX syntax', () => {
    const testFixture = fixture('frontend', ['app/model.tsx']);
    const sourcePath = path.join(testFixture.projectRoot, 'app/model.tsx');
    writeFile(sourcePath, 'export interface Props { label: string; }');
    expect(policy.isDeclarationOnlySource(sourcePath)).toBe(true);
    writeFile(sourcePath, 'export const View = <div />;');
    expect(policy.isDeclarationOnlySource(sourcePath)).toBe(false);
  });

  test('explicitly reports a declaration-only file as inventoried rather than unit-tested executable code', () => {
    const testFixture = fixture('frontend', ['app/page.tsx', 'lib/types.ts']);
    writeFile(path.join(testFixture.projectRoot, 'lib/types.ts'), 'export type User = string;');
    const summary = summaryFor(testFixture);
    delete summary['lib/types.ts'];
    writeSummary(testFixture, summary);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    policy.runCoverageCheck(testFixture.projectRoot, 'frontend');
    expect(process.exitCode || 0).toBe(0);
    expect(error).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('1 inventoried declaration-only file'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('lib/types.ts: Type declarations erase completely'));
  });
});

describe('file-backed coverage checks and CLI wrappers', () => {
  test('reads only the selected project report and reports missing or invalid JSON clearly', () => {
    const testFixture = fixture();
    expect(() => policy.readCoverage(testFixture.projectRoot, 'backend')).toThrow();
    writeSummary(testFixture, '{not-json');
    expect(() => policy.readCoverage(testFixture.projectRoot, 'backend')).toThrow(SyntaxError);
    writeSummary(testFixture, summaryFor(testFixture));
    expect(policy.readCoverage(testFixture.projectRoot, 'backend').failures).toEqual([]);
  });

  test('sets a nonzero exit code for any coverage failure or report read error', () => {
    const testFixture = fixture();
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    policy.runCoverageCheck(testFixture.projectRoot, 'backend');
    expect(process.exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Run test:coverage'));
    process.exitCode = 0;
    writeSummary(testFixture, summaryFor(testFixture, 89));
    policy.runCoverageCheck(testFixture.projectRoot, 'backend');
    expect(process.exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('src/feature.js: statements 89.00%'));
    process.exitCode = 0;
    writeSummary(testFixture, summaryFor(testFixture));
    policy.runCoverageCheck(testFixture.projectRoot, 'backend');
    expect(process.exitCode).toBe(0);
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('1/1 executable application files meet 90%'));
  });

  test.each(['backend', 'frontend'])('the real %s wrapper exits 0 at 90% and 1 below it, with no report, or with invalid JSON', (project) => {
    const testFixture = fixture(project);
    const wrapperName = project === 'frontend' ? 'verify-coverage.cjs' : 'verify-coverage.js';
    const wrapper = path.join(testFixture.projectRoot, 'scripts', wrapperName);
    writeFile(wrapper, fs.readFileSync(path.join(REPO_ROOT, project, 'scripts', wrapperName)));
    writeFile(path.join(testFixture.root, 'scripts/coverage-policy.cjs'), fs.readFileSync(path.join(REPO_ROOT, 'scripts/coverage-policy.cjs')));
    // A passing report in the working directory must never replace the selected
    // project's report. Each wrapper resolves its own project from __dirname.
    writeFile(path.join(testFixture.root, 'coverage/coverage-summary.json'), JSON.stringify(summaryFor(testFixture, 100)));
    const run = () => spawnSync(process.execPath, [wrapper], { cwd: testFixture.root, encoding: 'utf8', timeout: 5000 });
    expect(run().status).toBe(1);
    writeSummary(testFixture, summaryFor(testFixture));
    expect(run().status).toBe(0);
    const failing = summaryFor(testFixture, 100);
    failing[testFixture.sourceNames[0]].branches = coverage(89).branches;
    writeSummary(testFixture, failing);
    const rejected = run();
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('branches 89.00% < 90%');
    writeSummary(testFixture, 'not JSON');
    expect(run().status).toBe(1);
  });
});

describe('native Jest coverage enforcement', () => {
  function projectConfig(project) {
    if (project === 'backend') return require('../jest.config.js');
    let frontendConfig;
    const nextJestPath = require.resolve('../../frontend/node_modules/next/jest');
    jest.isolateModules(() => {
      jest.doMock(nextJestPath, () => () => (config) => config);
      frontendConfig = require('../../frontend/jest.config.cjs');
    });
    jest.dontMock(nextJestPath);
    return frontendConfig;
  }

  test.each(['backend', 'frontend'])('%s instruments every application file and enforces thresholds per source file', (project) => {
    const config = projectConfig(project);
    expect(config.testTimeout).toBe(20000);
    const sourceGlobs = Object.keys(config.coverageThreshold).filter((glob) => glob !== 'global');
    expect(sourceGlobs).toEqual(project === 'backend' ? ['./src/**/*.{js,mjs}'] : ['./app/**/*.{js,jsx,ts,tsx}', './lib/**/*.{js,jsx,ts,tsx}']);
    sourceGlobs.forEach((glob) => expect(config.coverageThreshold[glob]).toEqual(policy.COVERAGE_THRESHOLDS));
    expect(config.collectCoverageFrom.filter((glob) => glob.startsWith('!'))).toEqual(project === 'backend' ? [] : ['!**/*.d.ts', '!**/node_modules/**']);
  });

  test.each(['backend', 'frontend'])('%s Jest itself fails a low file despite high overall coverage and passes the 90% boundary', (project) => {
    const sourceDirectory = project === 'backend' ? 'src' : 'app';
    const testFixture = fixture(project, [`${sourceDirectory}/low.js`, `${sourceDirectory}/high.js`]);
    const config = projectConfig(project);
    const createModule = (count) => `module.exports = {\n${Array.from({ length: count }, (_, index) => `f${index}(value) { return value ? 1 : 0; },`).join('\n')}\n};\n`;
    writeFile(path.join(testFixture.projectRoot, sourceDirectory, 'low.js'), createModule(10));
    writeFile(path.join(testFixture.projectRoot, sourceDirectory, 'high.js'), createModule(100));
    const testPath = path.join(testFixture.projectRoot, 'coverage.test.js');
    const testSource = (lowCount) => `const low = require('./${sourceDirectory}/low.js');\nconst high = require('./${sourceDirectory}/high.js');\ntest('exercises real exported branches', () => {\nfor (const [target, count] of [[low, ${lowCount}], [high, 100]]) {\nfor (let index = 0; index < count; index++) { expect(target['f' + index](true)).toBe(1); expect(target['f' + index](false)).toBe(0); }\n}\n});\n`;
    const fixtureConfig = {
      rootDir: testFixture.projectRoot, testEnvironment: 'node', testMatch: ['<rootDir>/coverage.test.js'],
      collectCoverage: true, collectCoverageFrom: config.collectCoverageFrom,
      coverageThreshold: config.coverageThreshold, coverageReporters: ['json-summary'], transform: {},
    };
    if (project === 'frontend') {
      // Include a real library source because the frontend gate independently
      // requires both application routes and library modules to meet the floor.
      writeFile(path.join(testFixture.projectRoot, 'lib/constant.js'), 'module.exports = 1;\n');
      testFixture.sourceNames.push('lib/constant.js');
    }
    const configPath = path.join(testFixture.projectRoot, 'jest.config.json');
    writeFile(configPath, JSON.stringify(fixtureConfig));
    const run = () => spawnSync(process.execPath, [JEST_CLI, '--config', configPath, '--runInBand', '--silent'], { cwd: testFixture.projectRoot, encoding: 'utf8', timeout: 15000 });
    writeFile(testPath, `${project === 'frontend' ? "require('./lib/constant.js');\n" : ''}${testSource(8)}`);
    const rejected = run();
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('Tests:       1 passed');
    expect(rejected.stderr).toContain('coverage threshold for functions (90%) not met');
    let summary = JSON.parse(fs.readFileSync(path.join(testFixture.projectRoot, 'coverage/coverage-summary.json'), 'utf8'));
    expect(summary.total.functions.pct).toBeGreaterThan(90);
    expect(summary[path.join(testFixture.projectRoot, sourceDirectory, 'low.js')].functions.pct).toBe(80);
    writeFile(testPath, `${project === 'frontend' ? "require('./lib/constant.js');\n" : ''}${testSource(9)}`);
    const accepted = run();
    expect(accepted.status).toBe(0);
    summary = JSON.parse(fs.readFileSync(path.join(testFixture.projectRoot, 'coverage/coverage-summary.json'), 'utf8'));
    expect(summary[path.join(testFixture.projectRoot, sourceDirectory, 'low.js')].functions.pct).toBe(90);
    expect(summary[path.join(testFixture.projectRoot, sourceDirectory, 'low.js')].branches.pct).toBe(90);
  });
});
