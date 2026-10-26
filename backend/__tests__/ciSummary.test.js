const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const summary = require('../../scripts/generate-ci-summary');

let workspace;

function metricCounts(covered = 95, total = 100) {
  return Object.fromEntries(['statements', 'branches', 'functions', 'lines'].map((metric) => [metric, { covered, total, pct: (covered / total) * 100 }]));
}

function writeProject(project, coverage = metricCounts(), tests = {}) {
  const projectRoot = path.join(workspace, project);
  const source = project === 'backend' ? 'src/main.js' : 'app/page.tsx';
  for (const directory of project === 'backend' ? ['src', 'coverage'] : ['app', 'lib', 'coverage']) {
    fs.mkdirSync(path.join(projectRoot, directory), { recursive: true });
  }
  fs.writeFileSync(path.join(projectRoot, source), 'export const value = 1;');
  fs.writeFileSync(path.join(projectRoot, 'coverage', 'coverage-summary.json'), JSON.stringify({ total: coverage, [`/home/runner/work/repo/${project}/${source}`]: coverage }));
  fs.writeFileSync(path.join(projectRoot, 'coverage', 'test-results.json'), JSON.stringify({ numTotalTests: 10, numPassedTests: 7, numFailedTests: 1, numPendingTests: 1, numTodoTests: 1, ...tests }));
}

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'procucev-ci-summary-'));
  writeProject('backend');
  writeProject('frontend');
});

afterEach(() => {
  if (path.dirname(path.resolve(workspace)) !== path.resolve(os.tmpdir())
      || !path.basename(workspace).startsWith('procucev-ci-summary-')) {
    throw new Error('Refusing to remove an unexpected CI summary fixture directory');
  }
  fs.rmSync(workspace, { recursive: true, force: true });
  jest.restoreAllMocks();
});

test('reports counts from Jest artifacts and uses actual quality step outcomes', () => {
  const markdown = summary.generateSummary(workspace, {
    CI_BACKEND_TESTS_STATUS: 'success', CI_BACKEND_COVERAGE_STATUS: 'success',
    CI_FRONTEND_TESTS_STATUS: 'failure', CI_FRONTEND_COVERAGE_STATUS: 'success',
    CI_BUILD_STATUS: 'failure', CI_TYPECHECK_STATUS: 'cancelled',
    CI_LINT_STATUS: 'skipped', CI_MIGRATIONS_STATUS: 'success',
  });
  expect(markdown).toContain('Strict 90% per-file coverage gate: PASSED');
  expect(markdown).toContain('2 / 2 application files');
  expect(markdown).toContain('| backend | 10 | 7 | 1 | 2 |');
  expect(markdown).toContain('| **Workspace** | 20 | 14 | 2 | 4 |');
  expect(markdown).toContain('| Frontend unit tests | FAILED |');
  expect(markdown).toContain('| Production build | FAILED |');
  expect(markdown).toContain('| TypeScript typecheck | CANCELLED |');
  expect(markdown).toContain('| Lint | SKIPPED |');
  expect(markdown).toContain('| Database migrations | PASSED |');
});

test.each(['statements', 'branches', 'functions', 'lines'])('flags a single file below 90%% %s despite a high overall report', (metric) => {
  const reportPath = path.join(workspace, 'frontend/coverage/coverage-summary.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  report['/home/runner/work/repo/frontend/app/page.tsx'] = metricCounts();
  report['/home/runner/work/repo/frontend/app/page.tsx'][metric] = { covered: 8999, total: 10000, pct: 90 };
  fs.writeFileSync(reportPath, JSON.stringify(report));

  const markdown = summary.generateSummary(workspace, {});
  expect(markdown).toContain('Strict 90% per-file coverage gate: FAILED');
  expect(markdown).toContain(`frontend: app/page.tsx: ${metric} 89.99% < 90%`);
  expect(markdown).toContain('1 / 2 application files');
});

test('detects source files absent from the report instead of declaring complete compliance', () => {
  fs.writeFileSync(path.join(workspace, 'frontend/lib/untested.ts'), 'export const untested = true;');
  const markdown = summary.generateSummary(workspace, {});
  expect(markdown).toContain('Strict 90% per-file coverage gate: FAILED');
  expect(markdown).toContain('lib/untested.ts: missing from the coverage report');
  expect(markdown).toContain('2 / 3 application files');
});

test('identifies erased type declarations explicitly without claiming executable coverage', () => {
  fs.writeFileSync(path.join(workspace, 'frontend/lib/types.ts'), 'export interface Buyer { id: string; }');
  const markdown = summary.generateSummary(workspace, {});
  expect(markdown).toContain('3 / 3 application files');
  expect(markdown).toContain('Declaration-only modules (frontend/lib/types.ts) have no executable coverage metrics.');
});

test('never labels missing or invalid coverage artifacts as passing', () => {
  fs.writeFileSync(path.join(workspace, 'backend/coverage/coverage-summary.json'), '{ invalid json');
  fs.rmSync(path.join(workspace, 'frontend/coverage/coverage-summary.json'));
  const markdown = summary.generateSummary(workspace, {});
  expect(markdown).toContain('Strict 90% per-file coverage gate: FAILED');
  expect(markdown).toContain('Coverage report unavailable');
  expect(markdown).toContain('| **Workspace** | Missing | Missing | Missing | Missing | 0 / 0 |');
});

test('leaves absent test reports and unreported step statuses explicit', () => {
  fs.rmSync(path.join(workspace, 'frontend/coverage/test-results.json'));
  const markdown = summary.generateSummary(workspace, {});
  expect(markdown).toContain('| frontend | Missing | Missing | Missing | Missing |');
  expect(markdown).toContain('| **Workspace** | Missing | Missing | Missing | Missing |');
  expect(markdown).toContain('| Production build | NOT REPORTED |');
  expect(summary.readTestCounts({ numTotalTests: '10' })).toBeNull();
  expect(summary.readTestCounts({ numTotalTests: -1 })).toBeNull();
});

test('weights workspace metrics by the number of instrumented items', () => {
  writeProject('backend', metricCounts(900, 1000));
  writeProject('frontend', metricCounts(100, 100));
  const markdown = summary.generateSummary(workspace, {});
  expect(markdown).toContain('| **Workspace** | 90.91% | 90.91% | 90.91% | 90.91% | 2 / 2 |');
  expect(summary.formatMetric(null)).toBe('Missing');
  expect(summary.aggregateMetric([{ coverageTotals: metricCounts(0, 0) }], 'lines')).toBe(100);
});

test('prints the report and appends the same content to the GitHub step summary', () => {
  const output = path.join(workspace, 'step-summary.md');
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const markdown = summary.runCli(workspace, { GITHUB_STEP_SUMMARY: output });
  expect(log).toHaveBeenCalledWith(markdown);
  expect(fs.readFileSync(output, 'utf8')).toBe(markdown);
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => summary.runCli(workspace, { GITHUB_STEP_SUMMARY: path.join(workspace, 'missing/summary.md') })).not.toThrow();
  expect(error).toHaveBeenCalledWith(expect.stringContaining('Failed to append CI summary'));
});

test.each(['deploy-dev.yml', 'deploy-prod.yml'])('%s blocks deployment on both workspace coverage gates', (workflow) => {
  const yaml = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows', workflow), 'utf8');
  const testsAt = yaml.indexOf('run: npm run test:coverage');
  const checkerAt = yaml.indexOf('run: npm run check:coverage');
  const buildAt = yaml.indexOf('- name: Build Frontend');
  expect(testsAt).toBeGreaterThan(0);
  expect(checkerAt).toBeGreaterThan(testsAt);
  expect(buildAt).toBeGreaterThan(checkerAt);
  expect(yaml).not.toContain('continue-on-error');
  expect(yaml).toMatch(/Upload Coverage & Test Results\s+if: always\(\)/);
  expect(yaml.indexOf('secrets.CLOUDFLARE_API_TOKEN')).toBeGreaterThan(buildAt);
});

test('the workspace workflow verifies migrations and both project inventories, including on pushes', () => {
  const yaml = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/pr-quality-check.yml'), 'utf8').replace(/\r\n/g, '\n');
  expect(yaml).toContain('branches: [main, prod,');
  expect(yaml).toContain('image: postgres:16');
  expect(yaml).toContain('run: npm run db:migrate --prefix backend');
  expect(yaml).toContain('run: npm run check:coverage --prefix backend');
  expect(yaml).toContain('run: npm run check:coverage --prefix frontend');
  expect(yaml).toContain('run: npm run check:coverage\n');
  expect(yaml).toContain('CI_MIGRATIONS_STATUS: ${{ needs.backend-gate.outputs.migrations }}');
  expect(yaml).toMatch(/Upload Backend Coverage & Test Results\s+if: always\(\)/);
  expect(yaml).toMatch(/Upload Frontend Coverage & Test Results\s+if: always\(\)/);
});

test('PostgreSQL readiness arguments stay inside one Docker health command', () => {
  const workflow = yaml.safeLoad(fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/pr-quality-check.yml'), 'utf8'));
  const postgres = workflow.jobs['backend-gate'].services.postgres;
  // Service options are passed directly to Docker, rather than through bash.
  // Only double quotes group the readiness command for the runner's argument parser.
  const argumentsList = postgres.options.match(/"[^"]*"|\S+/g)
    .map((argument) => argument.startsWith('"') ? argument.slice(1, -1) : argument);

  expect(argumentsList).toEqual([
    '--health-cmd', `pg_isready -U ${postgres.env.POSTGRES_USER} -d ${postgres.env.POSTGRES_DB}`,
    '--health-interval', '10s', '--health-timeout', '5s', '--health-retries', '5',
  ]);
  expect(argumentsList).not.toContain('-U');
  expect(argumentsList).not.toContain('-d');
});
