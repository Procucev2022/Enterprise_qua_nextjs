#!/usr/bin/env node

/**
 * Git Pre-Commit Hook Setup Script
 * Installs executable pre-commit hooks to ensure strict quality gates before any commit.
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const gitHooksDir = path.resolve(rootDir, '.git/hooks');
const huskyDir = path.resolve(rootDir, '.husky');

const hookContent = `#!/bin/sh
# Procucev Enterprise Automated Pre-Commit Quality Gate
# Enforces Linting, Typechecking, Building, and 90% Unit Test Code Coverage

echo "🛡️  [PRE-COMMIT GATE] Executing full workspace quality check..."

npm run check:quality

EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "❌ [PRE-COMMIT REJECTED] Quality check failed. Please resolve all errors/coverage benchmarks before committing."
  exit 1
fi

echo "✅ [PRE-COMMIT APPROVED] All quality gates and coverage benchmarks verified."
exit 0
`;

try {
  // 1. Create .husky/pre-commit
  if (!fs.existsSync(huskyDir)) {
    fs.mkdirSync(huskyDir, { recursive: true });
  }
  const huskyHookPath = path.join(huskyDir, 'pre-commit');
  fs.writeFileSync(huskyHookPath, hookContent, { encoding: 'utf8', mode: 0o755 });
  console.log('✔ .husky/pre-commit hook configured successfully.');

  // 2. Create .git/hooks/pre-commit if .git exists
  if (fs.existsSync(gitHooksDir)) {
    const gitHookPath = path.join(gitHooksDir, 'pre-commit');
    fs.writeFileSync(gitHookPath, hookContent, { encoding: 'utf8', mode: 0o755 });
    console.log('✔ .git/hooks/pre-commit hook installed successfully.');
  }
} catch (err) {
  console.warn('⚠️  Could not install git hook directly:', err.message);
}
