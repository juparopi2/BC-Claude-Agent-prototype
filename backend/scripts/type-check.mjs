/**
 * Incremental type-check script for the backend.
 * Runs `git diff HEAD~1` to find changed .ts files, filters to backend/src/ only.
 * If no backend files changed, skips the type-check.
 * Otherwise runs `tsc --noEmit` with the full project (uses tsconfig incremental cache).
 *
 * NOTE: Individual file paths cannot be combined with --project in tsc.
 * We use the full project type-check (with incremental cache) to correctly
 * resolve path aliases (@/) and project settings.
 *
 * This is cross-platform (works on Windows cmd.exe and Unix shells).
 */

import { execSync, spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(__dirname, '..');

// Get changed files from git diff (repo-relative paths)
let changedFiles;
try {
  const output = execSync('git diff --name-only --diff-filter=d HEAD~1', {
    cwd: backendDir,
    encoding: 'utf8',
  });
  changedFiles = output.split('\n').filter(Boolean);
} catch (err) {
  console.error('Failed to get git diff:', err.message);
  process.exit(1);
}

// Filter to only backend/src/ TypeScript files
const backendTsFiles = changedFiles.filter(
  (f) => f.startsWith('backend/src/') && f.endsWith('.ts')
);

if (backendTsFiles.length === 0) {
  console.log('No backend/src TypeScript files changed — skipping type-check.');
  process.exit(0);
}

console.log(`Found ${backendTsFiles.length} changed backend file(s). Running full project type-check...`);
backendTsFiles.forEach((f) => console.log(`  ${f}`));

// Run tsc --noEmit with the full project (uses incremental cache for speed)
// Cannot pass individual files + --project together; full project check is correct.
const result = spawnSync(
  'npx',
  ['tsc', '--noEmit', '--project', 'tsconfig.json'],
  {
    cwd: backendDir,
    stdio: 'inherit',
    shell: true,
  }
);

process.exit(result.status ?? 1);
