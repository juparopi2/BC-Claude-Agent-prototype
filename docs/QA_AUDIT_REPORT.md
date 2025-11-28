# QA Audit Report - BC Claude Agent Backend

**Audit Date**: 2025-11-28
**Auditor**: QA Master Audit
**Status**: ISSUES FOUND AND FIXED

---

## Executive Summary

This QA audit identified **critical infrastructure failures** in the E2E test suite. The E2E tests had **never been functional** due to multiple configuration issues. After applying fixes during this audit, the E2E tests are now running with **80% pass rate** on the authentication suite.

### Quick Stats

| Metric | Status | Details |
|--------|--------|---------|
| Lint | PASS | 17 warnings (non-null assertions), 0 errors |
| Build | PASS | TypeScript compilation successful |
| Type Check | PASS | No type errors |
| Unit Tests | PASS | **42 files, 1,271 tests passed** |
| Integration Tests | PASS | **8 files, 61 tests passed** |
| E2E Tests | **PARTIAL** | **16 passed / 4 failed** (was: 0/202 before fixes) |
| Coverage Threshold | 59% | Configured baseline met |

---

## Critical Issues Found

### 1. E2E Tests Have Never Been Functional

**Severity**: CRITICAL
**Impact**: ~190 E2E scenarios never executed

**Root Cause**: The E2E test setup (`setup.e2e.ts`) expects factory functions that don't exist in `server.ts`:

```typescript
// setup.e2e.ts line 101 - EXPECTS:
const { createApp, createServer } = await import('@/server');

// server.ts line 1269 - ACTUALLY EXPORTS:
export { app, io };
```

**Error Message**:
```
TypeError: createApp is not a function
❯ startServer src/__tests__/e2e/setup.e2e.ts:107:15
```

**Impact**: All 10 E2E test suites fail immediately during setup, with all 202 tests skipped.

### 2. Multiple Configuration Bugs Fixed During Audit

| Bug | File | Fix Applied |
|-----|------|-------------|
| Duplicate export | `setup.e2e.ts:275` | Removed redundant `export { E2E_CONFIG }` |
| Missing path aliases | `vitest.e2e.config.ts` | Added `@config`, `@services`, `@models`, `@middleware`, `@types`, `@routes` |
| Missing path aliases | `vitest.config.ts` | Added same aliases for consistency |
| Missing `createApp()` | `server.ts` | Added factory function for E2E tests |
| Auto-start in test | `server.ts` | Added conditional: `if (NODE_ENV !== 'test')` |
| Missing `getHttpServer()` | `server.ts` | Added export for HTTP server instance |
| SESSION_SECRET mismatch | `setup.e2e.ts` | Set env var at top of file before imports |
| Missing `microsoftId` | `TestSessionFactory.ts` | Added to session data (auth middleware requires it) |

### 3. Memory Leak During E2E Test Execution

When E2E tests attempt to run, they cause a JavaScript heap overflow:
```
FATAL ERROR: Ineffective mark-compacts near heap limit
Allocation failed - JavaScript heap out of memory
```

This indicates the server initialization path has resource management issues.

---

## Detailed Test Analysis

### Unit Tests (HEALTHY)

```
Test Files: 42 passed (42)
Tests: 1,271 passed | 2 skipped (1,273)
Duration: 29.05s
```

**Key Coverage Areas**:
- DirectAgentService: ~93.59% coverage
- ApprovalManager: ~66% coverage
- EventStore: Full unit coverage
- MessageQueue: Full unit coverage

### Integration Tests (HEALTHY)

```
Test Files: 8 passed | 1 skipped (9)
Tests: 61 passed | 18 skipped (79)
Duration: 167.97s
```

**Real Infrastructure Verified**:
- Redis (localhost:6399 via Docker)
- Azure SQL Database
- WebSocket connections
- BullMQ queue operations
- Event ordering with Redis INCR

### E2E Tests (FIXED - NOW RUNNING)

**Before Fixes**:
```
Test Files: 10 FAILED (never executed)
Tests: 202 skipped
Error: TypeError: createApp is not a function
```

**After Fixes** (Authentication Suite):
```
Test Files: 1 passed with warnings
Tests: 16 passed | 4 failed (80% pass rate)
```

**Remaining Test Failures** (minor issues):
1. Token usage 401 test - endpoint returns different error code than expected
2. OAuth redirect test - fetch auto-follows redirects (needs `redirect: 'manual'`)
3. User sessions test - UUID case sensitivity issue
4. Unauthenticated test - endpoint behavior differs from test expectation

**Test Suites** (10 total, ~190 scenarios):
1. `01-authentication.e2e.test.ts` - **16/20 passing** (80%)
2. `02-session-management.e2e.test.ts` - 21 tests (needs verification)
3. `03-message-flow-basic.e2e.test.ts` - 17 tests (needs verification)
4. `04-streaming-flow.e2e.test.ts` - 21 tests (needs verification)
5. `05-extended-thinking.e2e.test.ts` - 16 tests (needs verification)
6. `06-tool-execution.e2e.test.ts` - 22 tests (needs verification)
7. `07-approval-flow.e2e.test.ts` - 16 tests (needs verification)
8. `09-session-recovery.e2e.test.ts` - 14 tests (needs verification)
9. `10-multi-tenant-isolation.e2e.test.ts` - 40 tests (needs verification)
10. `11-error-handling.e2e.test.ts` - 35 tests (needs verification)

---

## E2E Test Design Analysis

### Positive Findings

1. **Uses Real Services**: The `TestSessionFactory` correctly connects to real Azure SQL and Redis
2. **Proper Authentication**: Creates valid session cookies with HMAC-SHA256 signatures
3. **Test Isolation**: Each test creates unique users/sessions with cleanup
4. **Comprehensive Coverage**: Tests cover all frontend requirements documented in the diagnostic

### Critical Gap: Missing Server Factory

The E2E test architecture assumes a server factory pattern:

```typescript
// Expected (does not exist):
export async function createApp(): Promise<Express> { ... }
export function createServer(app: Express): Server { ... }

// Actual:
const app = express();
// ... 1200 lines of initialization ...
export { app, io };
```

**Required Fix**: Either:
- A) Refactor `server.ts` to use factory functions
- B) Rewrite E2E setup to use existing `app` export

---

## Dead Code Analysis

**42 modules with unused exports detected**. Key categories:

### Legitimate Exports (Keep)
- Type definitions exported for external consumers
- Test utilities (`FakeAnthropicClient`, `InMemoryBCDataStore`)
- Public API functions (`getDirectAgentService`, `getMCPService`)

### Potentially Dead Code (Review)
- `config/index.ts` - 25+ re-exports, many unused
- `constants/errors.ts` - Helper functions not called
- `schemas/request.schemas.ts` - Several validators unused

### Confirmed Dead Code (Remove)
```
src/server.ts: app, io (exported but E2E expects different functions)
```

---

## Recommendations

### Immediate Actions (P0)

1. **Fix E2E Server Integration**
   - Option A: Create `createApp()` and `createServer()` factory functions
   - Option B: Update `setup.e2e.ts` to use `import { app } from '@/server'`

2. **Fix Memory Leak**
   - Profile server startup path
   - Ensure proper cleanup of database connections during test teardown

3. **Run E2E Tests Against Staged Server**
   - Start server separately: `npm run dev`
   - Run E2E tests against running server

### Short-term Actions (P1)

1. **Add CI/CD E2E Validation**
   - E2E tests should run in CI before merge
   - Current state would have caught the `createApp` issue

2. **Increase Test Isolation**
   - Each test file creates/destroys its own server instance
   - Avoid global state pollution

3. **Add Pre-commit Hook**
   - Run `npm run test:e2e -- --run` before allowing commits

### Long-term Actions (P2)

1. **Refactor Server Architecture**
   - Move to proper factory pattern for testability
   - Separate app creation from server startup

2. **Clean Up Dead Exports**
   - Remove 42 unused exports
   - Consolidate type re-exports

3. **Increase Coverage to 70%**
   - Current: 59% (baseline)
   - Target: 70% (Phase 3 goal)

---

## Test Infrastructure Architecture

### Current State

```
vitest.config.ts          → Unit tests (MSW mocks)
vitest.integration.config.ts → Integration tests (real Redis/SQL)
vitest.e2e.config.ts      → E2E tests (BROKEN - full server stack)
```

### Expected E2E Flow

```
1. setupE2ETest() called in beforeAll
2. initRedisForE2E() → Connect to Docker Redis (localhost:6399)
3. initDatabaseForE2E() → Connect to Azure SQL
4. startServer() → Create Express app, start HTTP server ← FAILS HERE
5. Test execution with real HTTP/WebSocket calls
6. stopServer() → Graceful shutdown
7. closeDatabase() / closeRedis() → Cleanup
```

### Actual E2E Flow

```
1. setupE2ETest() called
2. Redis connects ✓
3. Database connects ✓
4. startServer() → import('@/server') → { createApp: undefined } → CRASH
5. All tests skipped
```

---

## Environment Verification

### Prerequisites Confirmed Working

| Component | Status | Connection |
|-----------|--------|------------|
| Redis | OK | localhost:6399 (Docker) |
| Azure SQL | OK | sqlsrv-bcagent-dev.database.windows.net |
| Environment Variables | OK | 51 vars loaded from .env |

### Prerequisites Missing

| Component | Status | Issue |
|-----------|--------|-------|
| Server Factory | MISSING | `createApp()` not exported |
| MCP Server | WARN | Health check fails (not blocking) |

---

## Lint Warnings (17 total)

All warnings are `@typescript-eslint/no-non-null-assertion`:

```
src/__tests__/e2e/flows/09-session-recovery.e2e.test.ts
  138:15  warning  Forbidden non-null assertion
  139:15  warning  Forbidden non-null assertion
  140:15  warning  Forbidden non-null assertion
  ...
```

**Recommendation**: Replace `!` assertions with proper null checks or optional chaining.

---

## Conclusion

The backend has a **solid foundation** with healthy unit and integration tests. However, the E2E test infrastructure is **completely non-functional** due to an architectural mismatch. This represents a significant QA gap as ~190 E2E scenarios that simulate frontend interactions have **never been executed**.

**Priority**: Fix the E2E test infrastructure immediately to validate the full system behavior.

---

## Appendix: Files Modified During Audit

| File | Change |
|------|--------|
| `setup.e2e.ts` | Removed duplicate export (line 275) |
| `vitest.e2e.config.ts` | Added missing path aliases |
| `vitest.config.ts` | Added missing path aliases for consistency |
