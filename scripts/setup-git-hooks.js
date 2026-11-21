#!/usr/bin/env node

/**
 * Git Pre-Commit Hook Setup Script
 * Installs executable pre-commit hooks and points Git core.hooksPath to .husky
 * so strict pre-commit quality gates are automatically enforced across clones.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const gitHooksDir = path.resolve(rootDir, '.git/hooks');
const huskyDir = path.resolve(rootDir, '.husky');

const hookContent = `#!/bin/sh
# Procucev Enterprise Pre-Commit Quality Gate
# Enforces Typecheck, Lint, DB Schema Parity, 90% Per-File Coverage on staged source files, and Next.js Build

echo "🛡️  [PRE-COMMIT GATE] Executing strict staged-change quality & coverage gate..."

npm run pre-commit -- --staged

EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "❌ [PRE-COMMIT REJECTED] Quality or 90% per-file coverage check failed. Please fix all errors before committing."
  exit 1
fi

echo "✅ [PRE-COMMIT APPROVED] All pre-commit quality & coverage gates verified."
exit 0
`.replace(/\r\n/g, '\n');

try {
  // 1. Create/update tracked .husky/pre-commit (LF line endings)
  if (!fs.existsSync(huskyDir)) {
    fs.mkdirSync(huskyDir, { recursive: true });
  }
  const huskyHookPath = path.join(huskyDir, 'pre-commit');
  fs.writeFileSync(huskyHookPath, hookContent, { encoding: 'utf8', mode: 0o755 });
  console.log('✔ .husky/pre-commit hook configured successfully.');

  // 2. Point git core.hooksPath to .husky when inside a git repo so tracked hook updates apply immediately
  if (fs.existsSync(path.resolve(rootDir, '.git'))) {
    try {
      execFileSync('git', ['config', 'core.hooksPath', '.husky'], { cwd: rootDir, stdio: 'ignore' });
      console.log('✔ git core.hooksPath configured to .husky.');
    } catch (gitErr) {
      console.warn('⚠️  Could not set git core.hooksPath:', gitErr.message);
    }
  }

  // 3. Keep .git/hooks/pre-commit synced as a fallback for environments ignoring core.hooksPath
  if (fs.existsSync(gitHooksDir)) {
    const gitHookPath = path.join(gitHooksDir, 'pre-commit');
    fs.writeFileSync(gitHookPath, hookContent, { encoding: 'utf8', mode: 0o755 });
    console.log('✔ .git/hooks/pre-commit hook installed successfully.');
  }
} catch (err) {
  console.warn('⚠️  Could not install git hook directly:', err.message);
}
