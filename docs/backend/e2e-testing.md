# E2E Testing Requirements

This document outlines the requirements and blockers for enabling end-to-end (E2E) tests in the BC Claude Agent project.

## Current Status

**E2E tests are disabled in CI** - see `.github/workflows/test.yml` (commented out e2e-tests job)

### What Works

- Playwright configuration: `playwright.config.ts`
- Test directory structure: `e2e/`
- Test fixtures: `e2e/fixtures/`
- Database seed/cleanup scripts: `e2e/scripts/`
- Example placeholder tests: `e2e/example.spec.ts`

### Blocking Issues

#### 1. Authentication Requirements

The backend requires Microsoft OAuth credentials that aren't available in CI:

- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `SESSION_SECRET`

**Solution Options:**

1. **Mock Authentication Mode** (Recommended for CI)
   - Add `AUTH_MODE=mock` environment variable
   - Create `MockAuthMiddleware` that bypasses OAuth flow
   - Auto-create test user sessions without Microsoft login
   - Implementation: `backend/src/middleware/MockAuthMiddleware.ts`

2. **Test-Specific OAuth App**
   - Register a separate Azure AD app for testing
   - Store credentials in GitHub Secrets
   - Requires Microsoft Azure access for CI service principal

3. **Session Injection**
   - Create valid session cookies programmatically
   - Inject into Playwright browser context
   - Requires exposed endpoint for session creation in test mode

#### 2. Database Isolation

E2E tests need isolated database state:

- Current: Tests share database with development
- Needed: Dedicated test data that can be reset between runs

**Implementation:**
- Use existing `e2e/scripts/seed-test-data.ts` before test runs
- Use `e2e/scripts/clean-test-data.ts` after test runs
- Prefix all test data (users, sessions) with `e2e_test_` for easy cleanup

#### 3. Redis Dependency

E2E tests require Redis for sessions:

- Local: Use `docker-compose.test.yml` (port 6399)
- CI: Add Redis service container (already configured in integration test job)

#### 4. Business Central API Mocking

E2E tests should not call real Business Central APIs:

**Solution:**
- Create `BC_API_MODE=mock` environment variable
- `BCClient` returns mock data when `BC_API_MODE=mock`
- Alternatively, use MSW (Mock Service Worker) for HTTP interception

## Implementation Plan

### Phase 1: Local E2E Tests (No CI)

1. Implement mock authentication mode
2. Add mock BC API responses
3. Update Playwright config for local development
4. Create core E2E test scenarios:
   - Login flow (mocked)
   - Chat session creation
   - Message sending and streaming
   - Approval flow (UI interaction)

### Phase 2: CI Integration

1. Add GitHub Secrets for E2E (if using real OAuth):
   ```
   E2E_MICROSOFT_CLIENT_ID
   E2E_MICROSOFT_CLIENT_SECRET
   E2E_SESSION_SECRET
   ```

2. Or implement mock auth mode for CI:
   ```yaml
   env:
     AUTH_MODE: mock
     BC_API_MODE: mock
     NODE_ENV: test
   ```

3. Enable e2e-tests job in `.github/workflows/test.yml`

### Phase 3: Full E2E Coverage

Priority test scenarios:

1. **Authentication Flow**
   - Login redirect to Microsoft
   - OAuth callback handling
   - Session persistence across page reloads

2. **Chat Functionality**
   - Create new session
   - Send message and receive streaming response
   - View message history

3. **Approval Flow**
   - Trigger approval-required action
   - Approve/reject from UI
   - Verify action execution

4. **Error Handling**
   - Network disconnection recovery
   - Session expiration handling
   - API error display

## Configuration Files

### playwright.config.ts

Current configuration:
- Single worker (sessions are stateful)
- Auto-start backend (port 3002) and frontend (port 3000)
- Chromium + Firefox browsers
- Retries only in CI

### Environment Variables for E2E

```bash
# Required for E2E tests
NODE_ENV=test
AUTH_MODE=mock          # or 'real' with OAuth secrets
BC_API_MODE=mock        # or 'real' with BC credentials
SESSION_SECRET=test-secret-for-e2e

# Database (same as integration tests)
DATABASE_SERVER=...
DATABASE_NAME=...
DATABASE_USER=...
DATABASE_PASSWORD=...

# Redis (same as integration tests)
REDIS_TEST_HOST=localhost
REDIS_TEST_PORT=6399
```

## Related Files

- `playwright.config.ts` - Playwright configuration
- `e2e/example.spec.ts` - Placeholder test
- `e2e/fixtures/db-helpers.ts` - Database test utilities
- `e2e/fixtures/test-data.ts` - Test data constants
- `e2e/scripts/seed-test-data.ts` - Database seeding
- `e2e/scripts/clean-test-data.ts` - Test cleanup
- `.github/workflows/test.yml` - CI workflow (e2e-tests job commented out)

## Commands

```bash
# Run E2E tests locally
npm run test:e2e

# Run with UI (debug mode)
npm run test:e2e:ui

# Run with visible browser
npm run test:e2e:headed

# Run specific browser only
npm run test:e2e:chromium
npm run test:e2e:firefox
```

## Known Issues

1. **Backend startup time**: Backend takes 10-30s to start, Playwright waits 120s max
2. **WebSocket reconnection**: Tests may fail if WebSocket disconnects during test
3. **Database state leakage**: Tests should clean up created data even on failure

## Next Steps

1. [ ] Implement `MockAuthMiddleware` for CI testing
2. [ ] Add mock responses to `BCClient` for test mode
3. [ ] Create actual E2E tests for core flows
4. [ ] Enable E2E job in CI workflow
5. [ ] Add E2E test coverage to pre-push hook (optional, may be too slow)

---

*Last updated: 2024-11-26*
*Status: E2E infrastructure exists, tests disabled pending auth mocking implementation*
