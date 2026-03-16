---
description: Test conventions, patterns, and organization rules
globs:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
  - "**/__tests__/**"
---

# Testing Conventions

## Test Organization
- **Backend**: `backend/src/__tests__/{type}/path/matching/source/` (unit, integration, e2e)
- **Frontend**: Co-located with components

## Commands — ALWAYS workspace-scoped
```bash
npm run -w backend test:unit -- -t "TestName"
npm run -w bc-agent-frontend test
```
**NEVER** `npx vitest run "TestName"` from root.

## E2E Data
- User IDs: `e2e00001-...`, Session IDs: `e2e10001-...`
- `npm run e2e:seed` before, `npm run e2e:clean` after

## Patterns
- `expect.objectContaining()` for config assertions (resilient to new fields)
- Parametric tests: iterate configs to auto-cover future roles/entities
- Fresh `ExecutionContext` per test (see `createTestContext()` pattern)
- Reset Zustand stores in `beforeEach`

## Pre-Commit
1. `npm run verify:types`
2. `npm run -w backend lint`
3. `npm run -w bc-agent-frontend lint`
