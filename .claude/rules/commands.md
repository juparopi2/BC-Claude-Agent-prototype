---
description: Development commands, test commands, and pre-commit verification
globs:
---

# Commands & Testing

## Development
```bash
npm install                          # Install all deps (from root)
npm run build:shared                 # Build shared package (required before type-check)
cd backend && npm run dev            # Backend dev server (:3002)
cd frontend && npm run dev           # Frontend dev server (:3000)
```

## Testing — ALWAYS use workspace-scoped commands
```bash
npm run -w backend test:unit                    # Backend unit tests
npm run -w backend test:unit -- -t "TestName"   # Specific test
npm run -w backend test:integration             # Integration (requires Redis)
npm run -w backend test:e2e                     # E2E (requires Azurite + full stack)
npm run -w bc-agent-frontend test               # Frontend unit tests
npm run test:e2e                                # Playwright E2E (auto-starts servers)
npm run test:e2e:ui                             # Playwright interactive UI
npm run test:e2e:debug                          # Playwright debug mode
```

**NEVER** run `npx vitest run "TestName"` from root — `@/` alias resolution fails.

## Type Checking & Linting
```bash
npm run verify:types                 # Full type verification (builds shared first, checks shared + frontend)
npm run -w backend type-check        # Backend incremental (only changed files from last commit)
npm run -w backend lint              # Backend lint
npm run -w bc-agent-frontend lint    # Frontend lint
```

**NEVER** run `npx tsc --noEmit` directly on backend — consumes too much RAM and crashes.

## Pre-Commit Checklist
1. `npm run verify:types`
2. `npm run -w backend lint`
3. `npm run -w bc-agent-frontend lint`

## Constraint Verification
```bash
cd backend
npx tsx scripts/database/verify-constraints.ts              # Human-readable report
npx tsx scripts/database/verify-constraints.ts --strict     # Fail on drift (CI mode)
npx tsx scripts/database/export-constraints.ts              # Show DB constraints
npx tsx scripts/database/export-constraints.ts --write      # Regenerate constraints.sql from DB
npx tsx scripts/database/export-constraints.ts --diff       # Diff DB vs constraints.sql
```

## Test Organization
- **Backend**: `backend/src/__tests__/{type}/path/matching/source/` (unit, integration, e2e)
- **Frontend**: Co-located with components
- Use `expect.objectContaining()` for constructor/config assertions (resilient to new fields)
- Use parametric tests to iterate configs and cover future roles/entities automatically
- **E2E data prefixes**: User IDs `e2e00001-...`, Session IDs `e2e10001-...`
- Run `npm run e2e:seed` before tests, `npm run e2e:clean` after
