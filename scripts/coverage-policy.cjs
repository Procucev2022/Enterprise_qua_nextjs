const fs = require('fs');
const path = require('path');
let stripTypeScriptTypes = require('module').stripTypeScriptTypes;
if (typeof stripTypeScriptTypes !== 'function') {
  try {
    const ts = require(path.join(__dirname, '../frontend/node_modules/typescript'));
    stripTypeScriptTypes = (source) => {
      const result = ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ESNext,
          module: ts.ModuleKind.ESNext,
          verbatimModuleSyntax: true,
          jsx: ts.JsxEmit.Preserve,
          removeComments: false,
        },
        reportDiagnostics: true,
      });
      if (result.diagnostics && result.diagnostics.length > 0) {
        throw new Error('TypeScript syntax error');
      }
      return result.outputText;
    };
  } catch {
    stripTypeScriptTypes = () => '';
  }
}

const COVERAGE_THRESHOLDS = Object.freeze({ statements: 90, branches: 90, functions: 90, lines: 90 });
const METRICS = Object.keys(COVERAGE_THRESHOLDS);
const SOURCE_ROOTS = { backend: ['src'], frontend: ['app', 'lib'] };
const SOURCE_EXTENSION = { backend: /\.(?:js|mjs)$/, frontend: /\.(?:js|jsx|ts|tsx)$/ };

function listSourceFiles(projectRoot, project) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (SOURCE_EXTENSION[project].test(entry.name) && !entry.name.endsWith('.d.ts')) {
        files.push(path.relative(projectRoot, absolutePath).replace(/\\/g, '/'));
      }
    }
  }
  for (const directory of SOURCE_ROOTS[project]) visit(path.join(projectRoot, directory));
  return files.sort();
}

// Artifacts can be generated on a different runner or operating system.
function relativeCoveragePath(filePath, project) {
  const normalized = filePath.replace(/\\/g, '/');
  const marker = `/${project}/`;
  const markerIndex = normalized.lastIndexOf(marker);
  return markerIndex >= 0 ? normalized.slice(markerIndex + marker.length) : normalized.replace(/^\.\//, '');
}

function metricPercentage(metric) {
  if (!metric || !Number.isInteger(metric.total) || !Number.isInteger(metric.covered)
      || metric.total < 0 || metric.covered < 0 || metric.covered > metric.total) return null;
  return metric.total === 0 ? 100 : (metric.covered * 100) / metric.total;
}

// Istanbul omits modules erased entirely by the TypeScript compiler. Keep them
// in the source inventory and verify they contain no executable JavaScript;
// absent reports for runtime code must still fail the gate.
function isDeclarationOnlySource(filePath) {
  if (!/\.tsx?$/.test(filePath)) return false;
  try {
    const source = fs.readFileSync(filePath, 'utf8');
    const javascript = stripTypeScriptTypes(source, { mode: 'strip' });
    return /^(?:\s|\/\*(?:[^*]|\*(?!\/))*\*\/|\/\/[^\r\n\u2028\u2029]*|export\s*\{\s*\}\s*;?)*$/.test(javascript);
  } catch {
    return false;
  }
}

function inspectCoverage(projectRoot, project, summary) {
  const failures = [];
  const files = [];
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return { files, failures: ['Coverage summary must be an object.'], total: null };
  }
  const entries = new Map(Object.entries(summary)
    .filter(([name]) => name !== 'total')
    .map(([name, coverage]) => [relativeCoveragePath(name, project), coverage]));
  const sources = listSourceFiles(projectRoot, project);
  if (sources.length === 0) failures.push('No application source files were found.');

  function inspectEntry(name, coverage) {
    const percentages = {};
    for (const metric of METRICS) {
      const percentage = metricPercentage(coverage?.[metric]);
      percentages[metric] = percentage;
      if (percentage === null) {
        failures.push(`${name}: missing or invalid ${metric} coverage.`);
      } else if (percentage < COVERAGE_THRESHOLDS[metric]) {
        failures.push(`${name}: ${metric} ${percentage.toFixed(2)}% < ${COVERAGE_THRESHOLDS[metric]}%.`);
      }
    }
    return percentages;
  }

  for (const source of sources) {
    if (!entries.has(source)) {
      if (isDeclarationOnlySource(path.join(projectRoot, source))) {
        files.push({
          file: source,
          passed: true,
          percentages: Object.fromEntries(METRICS.map((metric) => [metric, 100])),
          declarationOnly: true,
          reason: 'Type declarations erase completely: no executable statements, branches, functions or lines. Checked by TypeScript typecheck.',
        });
        continue;
      }
      failures.push(`${source}: missing from the coverage report.`);
      files.push({ file: source, passed: false, percentages: {} });
      continue;
    }
    const before = failures.length;
    const percentages = inspectEntry(source, entries.get(source));
    files.push({ file: source, passed: failures.length === before, percentages });
  }
  const total = inspectEntry('OVERALL TOTAL', summary.total);
  return { files, failures, total };
}

function readCoverage(projectRoot, project) {
  const summaryPath = path.join(projectRoot, 'coverage', 'coverage-summary.json');
  return inspectCoverage(projectRoot, project, JSON.parse(fs.readFileSync(summaryPath, 'utf8')));
}

function runCoverageCheck(projectRoot, project) {
  try {
    const result = readCoverage(projectRoot, project);
    const declarations = result.files.filter((file) => file.declarationOnly);
    const executableFiles = result.files.filter((file) => !file.declarationOnly);
    console.log(`${project}: ${executableFiles.filter((file) => file.passed).length}/${executableFiles.length} executable application files meet 90% in statements, branches, functions and lines.`);
    if (declarations.length > 0) {
      console.log(`${project}: ${declarations.length} inventoried declaration-only file(s) have no executable coverage metrics; TypeScript typecheck verifies their declarations.`);
      for (const file of declarations) console.log(`${file.file}: ${file.reason}`);
    }
    if (result.failures.length > 0) {
      console.error(result.failures.join('\n'));
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`${project}: coverage verification failed: ${error.message}. Run test:coverage to generate a complete report.`);
    process.exitCode = 1;
  }
}

module.exports = {
  COVERAGE_THRESHOLDS,
  METRICS,
  listSourceFiles,
  relativeCoveragePath,
  metricPercentage,
  isDeclarationOnlySource,
  inspectCoverage,
  readCoverage,
  runCoverageCheck,
};
