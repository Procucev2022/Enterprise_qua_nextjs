#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { METRICS, metricPercentage, readCoverage } = require('./coverage-policy.cjs');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const PROJECTS = ['backend', 'frontend'];
const CHECKS = [
  ['Backend unit tests', 'CI_BACKEND_TESTS_STATUS'],
  ['Backend per-file coverage', 'CI_BACKEND_COVERAGE_STATUS'],
  ['Frontend unit tests', 'CI_FRONTEND_TESTS_STATUS'],
  ['Frontend per-file coverage', 'CI_FRONTEND_COVERAGE_STATUS'],
  ['Production build', 'CI_BUILD_STATUS'],
  ['TypeScript typecheck', 'CI_TYPECHECK_STATUS'],
  ['Lint', 'CI_LINT_STATUS'],
  ['Database migrations', 'CI_MIGRATIONS_STATUS'],
];

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readTestCounts(report) {
  const fields = ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests'];
  if (!report || !fields.every((field) => Number.isInteger(report[field]) && report[field] >= 0)) return null;
  return {
    total: report.numTotalTests,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    skipped: report.numPendingTests + report.numTodoTests,
  };
}

function loadProject(rootDir, project) {
  const projectRoot = path.join(rootDir, project);
  let coverage;
  try {
    coverage = readCoverage(projectRoot, project);
  } catch (error) {
    coverage = { files: [], failures: [`Coverage report unavailable: ${error.message}`], total: null };
  }
  const summary = readJsonSafe(path.join(projectRoot, 'coverage', 'coverage-summary.json'));
  const testResults = readJsonSafe(path.join(projectRoot, 'coverage', 'test-results.json'));
  return {
    project,
    coverage,
    coverageTotals: summary?.total,
    tests: readTestCounts(testResults),
  };
}

function formatMetric(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : 'Missing';
}

function aggregateMetric(projects, metric) {
  let covered = 0;
  let total = 0;
  for (const project of projects) {
    const coverage = project.coverageTotals?.[metric];
    if (metricPercentage(coverage) === null) return null;
    covered += coverage.covered;
    total += coverage.total;
  }
  return metricPercentage({ covered, total });
}

function checkStatus(value) {
  const statuses = { success: 'PASSED', failure: 'FAILED', cancelled: 'CANCELLED', skipped: 'SKIPPED' };
  return statuses[value] || 'NOT REPORTED';
}

function generateSummary(rootDir = WORKSPACE_ROOT, env = process.env) {
  const projects = PROJECTS.map((project) => loadProject(rootDir, project));
  const files = projects.flatMap((project) => project.coverage.files);
  const passedCount = files.filter((file) => file.passed).length;
  const failures = projects.flatMap((project) => project.coverage.failures.map((failure) => `${project.project}: ${failure}`));
  const gatePassed = failures.length === 0 && files.length > 0;
  const lines = [
    '## Procucev Enterprise CI Quality & Coverage Summary',
    '',
    `**Strict 90% per-file coverage gate: ${gatePassed ? 'PASSED' : 'FAILED'}**`,
    '',
    `${passedCount} / ${files.length} application files passed source verification.`,
    'Every executable file must meet at least 90% statements, branches, functions and lines. The source inventory rejects absent runtime files or invalid metrics.',
    '',
    '### Unit test results',
    '',
    '| Project | Total | Passed | Failed | Skipped / Todo |',
    '| :--- | ---: | ---: | ---: | ---: |',
  ];
  for (const project of projects) {
    const counts = project.tests;
    lines.push(`| ${project.project} | ${counts ? `${counts.total} | ${counts.passed} | ${counts.failed} | ${counts.skipped}` : 'Missing | Missing | Missing | Missing'} |`);
  }
  const testsAvailable = projects.every((project) => project.tests !== null);
  const countTotal = (field) => projects.reduce((sum, project) => sum + project.tests[field], 0);
  lines.push(`| **Workspace** | ${testsAvailable ? `${countTotal('total')} | ${countTotal('passed')} | ${countTotal('failed')} | ${countTotal('skipped')}` : 'Missing | Missing | Missing | Missing'} |`);
  lines.push('', '### Coverage', '', '| Project | Statements | Branches | Functions | Lines | Files passed |', '| :--- | ---: | ---: | ---: | ---: | ---: |');
  for (const project of projects) {
    const percentages = METRICS.map((metric) => formatMetric(project.coverage.total?.[metric]));
    const passed = project.coverage.files.filter((file) => file.passed).length;
    lines.push(`| ${project.project} | ${percentages.join(' | ')} | ${passed} / ${project.coverage.files.length} |`);
  }
  lines.push(`| **Workspace** | ${METRICS.map((metric) => formatMetric(aggregateMetric(projects, metric))).join(' | ')} | ${passedCount} / ${files.length} |`);
  const declarations = projects.flatMap((project) => project.coverage.files
    .filter((file) => file.declarationOnly)
    .map((file) => `${project.project}/${file.file}`));
  if (declarations.length > 0) {
    lines.push('', `Declaration-only modules (${declarations.join(', ')}) have no executable coverage metrics. Their parsed source is inventoried and their declarations are verified by TypeScript typecheck.`);
  }
  lines.push('', '### Quality checks', '', '| Check | Actual step status |', '| :--- | :--- |');
  for (const [label, variable] of CHECKS) lines.push(`| ${label} | ${checkStatus(env[variable])} |`);

  if (failures.length > 0) {
    lines.push('', '### Coverage failures', '');
    for (const failure of failures) lines.push(`- ${failure.replace(/\r?\n/g, ' ')}`);
  }
  return `${lines.join('\n')}\n`;
}

function runCli(rootDir = WORKSPACE_ROOT, env = process.env) {
  const markdown = generateSummary(rootDir, env);
  console.log(markdown);
  if (env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(env.GITHUB_STEP_SUMMARY, markdown, 'utf8');
    } catch (error) {
      console.error(`Failed to append CI summary: ${error.message}`);
    }
  }
  return markdown;
}

if (require.main === module) runCli();

module.exports = { readJsonSafe, readTestCounts, loadProject, formatMetric, aggregateMetric, checkStatus, generateSummary, runCli };
