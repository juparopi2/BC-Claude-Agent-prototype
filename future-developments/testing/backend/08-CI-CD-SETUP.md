# PRD 08: CI/CD Setup - Husky & GitHub Actions

**Document Version**: 1.0.0
**Created**: 2025-11-19
**Implementation Time**: 6 hours

---

## Part 1: Husky Pre-push Hook (2 hours)

### Installation

```bash
cd backend
npm install -D husky
npx husky init
```

### Configure Pre-push Hook

**File**: `.husky/pre-push`

```bash
#!/bin/sh
echo "Running tests before push..."

cd backend
npm run test:coverage

if [ $? -ne 0 ]; then
  echo "❌ Tests failed. Push aborted."
  exit 1
fi

echo "✅ All tests passed. Proceeding with push."
```

### Make Executable

```bash
chmod +x .husky/pre-push
```

### Bypass Strategy

```bash
# Emergency bypass (use sparingly)
git push --no-verify
```

---

## Part 2: GitHub Actions Workflow (4 hours)

### Workflow File

**File**: `.github/workflows/test.yml`

```yaml
name: Backend Tests

on:
  pull_request:
    branches: [main, develop]
    paths:
      - 'backend/**'
  push:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
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

      - name: Run tests
        working-directory: backend
        run: npm run test:coverage
        env:
          NODE_ENV: test
          REDIS_URL: redis://localhost:6379

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          files: ./backend/coverage/lcov.info
          flags: backend
          token: ${{ secrets.CODECOV_TOKEN }}

      - name: Comment PR with coverage
        if: github.event_name == 'pull_request'
        uses: romeovs/lcov-reporter-action@v0.3.1
        with:
          lcov-file: ./backend/coverage/lcov.info
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

---

## Part 3: Branch Protection Rules

### GitHub Settings

1. Go to **Settings** → **Branches**
2. Add rule for `main` branch:
   - ✅ Require status checks to pass before merging
   - ✅ Require branches to be up to date before merging
   - ✅ Status checks required: `test`
   - ✅ Require review from Code Owners

---

## Part 4: Codecov Integration

### Setup

1. Sign up at https://codecov.io
2. Add repository
3. Get upload token
4. Add to GitHub Secrets: `CODECOV_TOKEN`

### Badge

```markdown
[![codecov](https://codecov.io/gh/username/repo/branch/main/graph/badge.svg)](https://codecov.io/gh/username/repo)
```

---

## Implementation Checklist

- [ ] Install Husky (30 min)
- [ ] Configure pre-push hook (30 min)
- [ ] Test hook locally (30 min)
- [ ] Create GitHub Actions workflow (2 hours)
- [ ] Setup Codecov (30 min)
- [ ] Configure branch protection (30 min)

---

**End of PRD 08: CI/CD Setup**
