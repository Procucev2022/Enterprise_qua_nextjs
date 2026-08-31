const fs = require('fs');
const path = require('path');

const summaryPath = path.join(process.cwd(), 'coverage', 'coverage-summary.json');

if (!fs.existsSync(summaryPath)) {
  console.error('\x1b[31m[Coverage Verification Error]\x1b[0m coverage/coverage-summary.json not found. Run tests with --coverage first.');
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

const BENCHMARK = 90.0;
const metrics = ['statements', 'branches', 'functions', 'lines'];

console.log('\n========================================================================================================');
console.log('                          PER-FILE 90% UNIT TEST CODE COVERAGE REPORT                          ');
console.log('========================================================================================================\n');

let failedFiles = [];
let passedFiles = [];
const projectRoot = process.cwd();

// Table header
console.log(
  `| ${'File Path'.padEnd(58)} | ${'Statements'.padEnd(10)} | ${'Branches'.padEnd(10)} | ${'Functions'.padEnd(10)} | ${'Lines'.padEnd(10)} | ${'Status'.padEnd(6)} |`
);
console.log('|' + '-'.repeat(60) + '|' + '-'.repeat(12) + '|' + '-'.repeat(12) + '|' + '-'.repeat(12) + '|' + '-'.repeat(12) + '|' + '-'.repeat(8) + '|');

Object.keys(summary).forEach((filePath) => {
  if (filePath === 'total') return;

  // Relative path
  let relPath = filePath;
  if (filePath.startsWith(projectRoot)) {
    relPath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
  } else {
    relPath = filePath.replace(/\\/g, '/');
  }

  // Filter only app and lib source files
  if (!relPath.startsWith('app/') && !relPath.startsWith('lib/')) {
    return;
  }

  const fileCov = summary[filePath];
  const stPct = fileCov.statements ? fileCov.statements.pct : 100;
  const brPct = fileCov.branches ? fileCov.branches.pct : 100;
  const fnPct = fileCov.functions ? fileCov.functions.pct : 100;
  const lnPct = fileCov.lines ? fileCov.lines.pct : 100;

  const isPassed = stPct >= BENCHMARK && brPct >= BENCHMARK && fnPct >= BENCHMARK && lnPct >= BENCHMARK;

  const stDisplay = `${stPct.toFixed(1)}%`.padEnd(10);
  const brDisplay = `${brPct.toFixed(1)}%`.padEnd(10);
  const fnDisplay = `${fnPct.toFixed(1)}%`.padEnd(10);
  const lnDisplay = `${lnPct.toFixed(1)}%`.padEnd(10);
  const statusDisplay = isPassed ? '\x1b[32mPASS\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m  ';

  let shortRelPath = relPath;
  if (shortRelPath.length > 58) {
    shortRelPath = '...' + shortRelPath.slice(-55);
  }

  console.log(
    `| ${shortRelPath.padEnd(58)} | ${stDisplay} | ${brDisplay} | ${fnDisplay} | ${lnDisplay} | ${statusDisplay} |`
  );

  if (isPassed) {
    passedFiles.push({ file: relPath, stPct, brPct, fnPct, lnPct });
  } else {
    failedFiles.push({ file: relPath, stPct, brPct, fnPct, lnPct });
  }
});

console.log('|' + '='.repeat(60) + '|' + '='.repeat(12) + '|' + '='.repeat(12) + '|' + '='.repeat(12) + '|' + '='.repeat(12) + '|' + '='.repeat(8) + '|');

if (summary.total) {
  const tot = summary.total;
  const stPct = tot.statements ? tot.statements.pct.toFixed(1) : '100.0';
  const brPct = tot.branches ? tot.branches.pct.toFixed(1) : '100.0';
  const fnPct = tot.functions ? tot.functions.pct.toFixed(1) : '100.0';
  const lnPct = tot.lines ? tot.lines.pct.toFixed(1) : '100.0';
  const totalPassed = parseFloat(stPct) >= BENCHMARK && parseFloat(brPct) >= BENCHMARK && parseFloat(fnPct) >= BENCHMARK && parseFloat(lnPct) >= BENCHMARK;
  const totalStatus = totalPassed ? '\x1b[32mPASS\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m  ';

  console.log(
    `| ${'OVERALL TOTAL COVERAGE'.padEnd(58)} | ${(stPct + '%').padEnd(10)} | ${(brPct + '%').padEnd(10)} | ${(fnPct + '%').padEnd(10)} | ${(lnPct + '%').padEnd(10)} | ${totalStatus} |`
  );
  console.log('========================================================================================================\n');
}

console.log(`Files Processed: ${passedFiles.length + failedFiles.length}`);
console.log(`Passed (>= 90% in all metrics): \x1b[32m${passedFiles.length}\x1b[0m`);
console.log(`Failed (< 90% in any metric):   \x1b[31m${failedFiles.length}\x1b[0m\n`);

if (failedFiles.length > 0) {
  console.error('\x1b[31m[ERROR] The following files do not meet the 90% unit test coverage requirement:\x1b[0m');
  failedFiles.forEach((f) => {
    console.error(
      ` - ${f.file} -> Statements: ${f.stPct.toFixed(1)}%, Branches: ${f.brPct.toFixed(1)}%, Functions: ${f.fnPct.toFixed(1)}%, Lines: ${f.lnPct.toFixed(1)}%`
    );
  });
  console.error('\n\x1b[31mCoverage benchmark failed. All files must achieve >= 90% coverage across Statements, Branches, Functions, and Lines.\x1b[0m\n');
  process.exit(1);
} else {
  console.log('\x1b[32m[SUCCESS] All files successfully achieved >= 90% unit test coverage across Statements, Branches, Functions, and Lines!\x1b[0m\n');
  process.exit(0);
}
