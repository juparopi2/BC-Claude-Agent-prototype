# CI/CD Pipeline Guide

> **Document Status**: Phase 3 Implementation Guide
> **Tools**: GitHub Actions + Husky + Codecov
> **Last Updated**: 2025-11-14
> **Related**: `00-testing-strategy.md`

---

## Table of Contents

1. [CI/CD Strategy Overview](#cicd-strategy-overview)
2. [Husky Pre-Push Hooks](#husky-pre-push-hooks)
3. [GitHub Actions Workflows](#github-actions-workflows)
4. [Branch Protection Rules](#branch-protection-rules)
5. [Coverage Reporting](#coverage-reporting)
6. [Best Practices](#best-practices)

---

## CI/CD Strategy Overview

### Testing Enforcement Points

| Stage | Tool | Trigger | Bypassable | Purpose |
|-------|------|---------|------------|---------|
| **Local** | Husky pre-push | Before `git push` | Yes (`--no-verify`) | Fast feedback loop |
| **CI** | GitHub Actions | On PR to `main`/`develop` | No | Gatekeeper, all PRs must pass |
| **Merge** | Branch Protection | Before merge to `main` | No (admin override) | Final safeguard |

**Strategy**: Defense in depth - multiple layers of protection

---

## Husky Pre-Push Hooks

### Installation

```bash
cd backend  # Or frontend
npm install --save-dev --save-exact husky@9.1.7
npm install --save-dev --save-exact lint-staged@15.2.11
```

---

### Setup Script

**Add to `package.json`**:
```json
{
  "scripts": {
    "prepare": "husky install",
    "test:pre-push": "npm run lint && npm test"
  }
}
```

**Initialize Husky**:
```bash
npm run prepare
npx husky add .husky/pre-push "npm run test:pre-push"
```

---

### Pre-Push Hook Configuration

**File**: `.husky/pre-push`

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

echo "🔍 Running pre-push checks..."

# Run linter
echo "📝 Linting..."
npm run lint
if [ $? -ne 0 ]; then
  echo "❌ Lint failed. Fix errors before pushing."
  exit 1
fi

# Run tests
echo "🧪 Running tests..."
npm test
if [ $? -ne 0 ]; then
  echo "❌ Tests failed. Fix tests before pushing."
  exit 1
fi

# Check coverage threshold
echo "📊 Checking coverage..."
npm run test:coverage -- --reporter=silent
if [ $? -ne 0 ]; then
  echo "❌ Coverage below 70% threshold."
  exit 1
fi

echo "✅ All checks passed. Pushing..."
```

---

### Lint-Staged for Pre-Commit (Optional)

**File**: `.lintstagedrc.json`

```json
{
  "*.{ts,tsx}": [
    "eslint --fix",
    "prettier --write"
  ],
  "*.{json,md}": [
    "prettier --write"
  ]
}
```

**Add to `.husky/pre-commit`**:
```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npx lint-staged
```

---

### Bypass for Emergencies

```bash
# Bypass pre-push hook (NOT recommended)
git push --no-verify

# Why bypass should be rare:
# - Breaks CI/CD contract
# - May introduce broken code
# - Use only for hotfixes in production emergencies
```

---

## GitHub Actions Workflows

### Workflow Structure

```
.github/
└── workflows/
    ├── test.yml              # Main test workflow (backend + frontend + E2E)
    ├── backend-deploy.yml    # Backend deployment (existing)
    └── frontend-deploy.yml   # Frontend deployment (existing)
```

---

### Test Workflow

**File**: `.github/workflows/test.yml`

```yaml
name: Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  backend-tests:
    name: Backend Tests
    runs-on: ubuntu-latest

    strategy:
      matrix:
        node-version: [20.x]

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json

      - name: Install dependencies
        working-directory: backend
        run: npm ci

      - name: Run linter
        working-directory: backend
        run: npm run lint

      - name: Run type check
        working-directory: backend
        run: npm run type-check

      - name: Run unit tests
        working-directory: backend
        run: npm test

      - name: Run integration tests
        working-directory: backend
        run: npm run test:integration
        env:
          DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}
          REDIS_URL: ${{ secrets.TEST_REDIS_URL }}
          ANTHROPIC_API_KEY: ${{ secrets.TEST_ANTHROPIC_API_KEY }}

      - name: Generate coverage report
        working-directory: backend
        run: npm run test:coverage

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          files: ./backend/coverage/lcov.info
          flags: backend
          name: backend-coverage
          token: ${{ secrets.CODECOV_TOKEN }}

  frontend-tests:
    name: Frontend Tests
    runs-on: ubuntu-latest

    strategy:
      matrix:
        node-version: [20.x]

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        working-directory: frontend
        run: npm ci

      - name: Run linter
        working-directory: frontend
        run: npm run lint

      - name: Run type check
        working-directory: frontend
        run: npm run type-check

      - name: Run tests
        working-directory: frontend
        run: npm test

      - name: Generate coverage report
        working-directory: frontend
        run: npm run test:coverage

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          files: ./frontend/coverage/lcov.info
          flags: frontend
          name: frontend-coverage
          token: ${{ secrets.CODECOV_TOKEN }}

  e2e-tests:
    name: E2E Tests
    runs-on: ubuntu-latest
    needs: [backend-tests, frontend-tests]  # Only run if unit/integration pass

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20.x

      - name: Install backend dependencies
        working-directory: backend
        run: npm ci

      - name: Install frontend dependencies
        working-directory: frontend
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium firefox

      - name: Start backend server
        working-directory: backend
        run: npm start &
        env:
          NODE_ENV: test
          PORT: 3002

      - name: Start frontend server
        working-directory: frontend
        run: npm start &
        env:
          NODE_ENV: test
          PORT: 3000

      - name: Wait for servers to start
        run: |
          npx wait-on http://localhost:3002/health -t 120000
          npx wait-on http://localhost:3000 -t 120000

      - name: Run E2E tests
        run: npx playwright test

      - name: Upload Playwright report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30

      - name: Upload test videos
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-videos
          path: test-results/
          retention-days: 7
```

---

### Workflow Optimization

**Caching Dependencies**:
```yaml
- name: Cache node modules
  uses: actions/cache@v4
  with:
    path: |
      backend/node_modules
      frontend/node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-
```

**Parallel Execution**:
```yaml
jobs:
  backend-tests:
    # ...
  frontend-tests:
    # Runs in parallel with backend-tests
    # ...
  e2e-tests:
    needs: [backend-tests, frontend-tests]  # Runs after both complete
```

---

### Required Secrets

Add these secrets to your GitHub repository:

**Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `TEST_DATABASE_URL` | Azure SQL test database | `sqlsrv-bcagent-dev.database.windows.net` |
| `TEST_REDIS_URL` | Redis test instance | `redis://localhost:6379/1` |
| `TEST_ANTHROPIC_API_KEY` | Anthropic API key (test) | `sk-ant-api03-...` |
| `CODECOV_TOKEN` | Codecov upload token | `f3d8a912-...` |

---

## Branch Protection Rules

### Enable Branch Protection

**GitHub Repository → Settings → Branches → Add branch protection rule**

**Branch name pattern**: `main`

**Settings**:
- ✅ **Require a pull request before merging**
  - ✅ Require approvals: 1
  - ✅ Dismiss stale pull request approvals when new commits are pushed

- ✅ **Require status checks to pass before merging**
  - ✅ Require branches to be up to date before merging
  - **Status checks**:
    - `Backend Tests`
    - `Frontend Tests`
    - `E2E Tests`

- ✅ **Require conversation resolution before merging**

- ✅ **Require linear history** (optional, prevents merge commits)

- ✅ **Include administrators** (admins must follow rules)

- ❌ **Allow force pushes** (disabled)

- ❌ **Allow deletions** (disabled)

---

### Status Check Example

When a PR is created, GitHub Actions runs the `test.yml` workflow:

```
✅ Backend Tests (passed)
✅ Frontend Tests (passed)
✅ E2E Tests (passed)

Coverage: 73% (+2%) ✅
```

**Merge button**: Enabled ✅ (all checks passed)

---

## Coverage Reporting

### Codecov Setup

1. **Create Codecov account**: https://about.codecov.io/
2. **Add repository**: GitHub OAuth → Select `BC-Claude-Agent-prototype`
3. **Get upload token**: Copy `CODECOV_TOKEN`
4. **Add to GitHub secrets**: Repository → Settings → Secrets → New secret

---

### Codecov Configuration

**File**: `codecov.yml` (root)

```yaml
coverage:
  status:
    project:
      default:
        target: 70%  # Overall coverage target
        threshold: 2%  # Allow 2% drop before failing
    patch:
      default:
        target: 70%  # New code must have 70% coverage

comment:
  layout: "reach, diff, flags, files"
  behavior: default
  require_changes: false
  require_base: no
  require_head: yes

ignore:
  - "**/__tests__/**"
  - "**/*.test.ts"
  - "**/*.spec.ts"
  - "**/node_modules/**"
  - "dist/"
  - ".next/"

flags:
  backend:
    paths:
      - backend/src/
  frontend:
    paths:
      - frontend/src/
```

---

### Coverage Badge

Add to `README.md`:

```markdown
[![codecov](https://codecov.io/gh/your-username/BC-Claude-Agent-prototype/branch/main/graph/badge.svg)](https://codecov.io/gh/your-username/BC-Claude-Agent-prototype)
```

---

## Best Practices

### 1. Fast Feedback Loop

```
Local (Husky):     ~30s  (lint + tests)
CI (GitHub):       ~5min  (full suite)
E2E (GitHub):      ~10min (browser tests)
```

**Optimize**:
- Run unit tests locally (fast)
- Run integration tests in CI (slower, needs DB)
- Run E2E tests in CI only (slowest)

---

### 2. Test Parallelization

```yaml
# ✅ GOOD - Parallel jobs
jobs:
  backend:
    # ...
  frontend:
    # Runs in parallel
    # ...

# ❌ BAD - Sequential jobs
jobs:
  backend:
    # ...
  frontend:
    needs: backend  # Waits for backend
```

---

### 3. Fail Fast

```yaml
strategy:
  fail-fast: true  # Stop all jobs if one fails
  matrix:
    node-version: [20.x]
```

---

### 4. Artifacts for Debugging

```yaml
- name: Upload test artifacts
  uses: actions/upload-artifact@v4
  if: failure()  # Only on failure
  with:
    name: test-results
    path: test-results/
    retention-days: 7
```

---

### 5. Conditional Workflows

```yaml
on:
  push:
    branches: [main, develop]
    paths:
      - 'backend/**'  # Only run if backend files changed
      - '.github/workflows/test.yml'
```

---

### 6. Secrets Management

```yaml
# ✅ GOOD - Use secrets
env:
  DATABASE_URL: ${{ secrets.DATABASE_URL }}

# ❌ BAD - Hardcoded secrets
env:
  DATABASE_URL: sqlsrv-bcagent-dev.database.windows.net
```

---

## Workflow Execution Example

### PR Created

```
User: Creates PR #42 "Add approval timeout"

GitHub Actions:
  1. Checkout code
  2. Install dependencies (cached, ~30s)
  3. Run backend tests (~2min)
  4. Run frontend tests (~2min)
  5. Run E2E tests (~8min)
  6. Upload coverage to Codecov (~10s)

Total: ~12 minutes
```

### Status Check Report

```
✅ Backend Tests (2m 15s)
   - Lint: passed
   - Type check: passed
   - Unit tests: 42 passed, 0 failed
   - Integration tests: 12 passed, 0 failed
   - Coverage: 72% (+1%)

✅ Frontend Tests (1m 45s)
   - Lint: passed
   - Type check: passed
   - Unit tests: 38 passed, 0 failed
   - Coverage: 74% (+2%)

✅ E2E Tests (8m 30s)
   - auth.spec.ts: 4 passed
   - chat.spec.ts: 6 passed
   - approval.spec.ts: 5 passed
   - todo.spec.ts: 3 passed
   - errors.spec.ts: 5 passed

📊 Overall Coverage: 73% (+1.5%)
```

**Result**: ✅ All checks passed → **Merge button enabled**

---

## Troubleshooting

### Issue 1: "Tests pass locally but fail in CI"

**Causes**:
- Environment differences (Node version, OS)
- Missing environment variables
- Race conditions (timing issues)

**Solution**:
```yaml
# Match local Node version
- uses: actions/setup-node@v4
  with:
    node-version: 20.x

# Add debug logging
- run: npm test -- --verbose
```

---

### Issue 2: "CI runs too long (>15 minutes)"

**Solutions**:
- Cache dependencies
- Parallelize jobs
- Skip E2E on non-main branches
- Use `--maxWorkers=2` for tests

---

### Issue 3: "Coverage upload fails"

**Solution**:
```yaml
# Ensure CODECOV_TOKEN secret exists
- uses: codecov/codecov-action@v4
  with:
    token: ${{ secrets.CODECOV_TOKEN }}
    fail_ci_if_error: false  # Don't fail CI if Codecov is down
```

---

## Next Steps

1. ✅ **Read this guide** - Understand CI/CD strategy
2. [ ] **Install Husky** (Phase 2: Infrastructure setup)
3. [ ] **Create `.github/workflows/test.yml`** (Phase 2)
4. [ ] **Setup Codecov** (Phase 4: Enforcement)
5. [ ] **Enable branch protection** (Phase 4: After tests written)
6. [ ] **Test workflow** (`git push` with failing test)

---

**Document Version**: 1.0
**Related Documents**:
- `00-testing-strategy.md` - Overall strategy
- `01-unit-testing-guide.md` - Unit test patterns
- `02-integration-testing-guide.md` - Integration test patterns
- `03-e2e-testing-guide.md` - E2E test patterns
- `04-edge-cases-catalog.md` - Edge cases to test
