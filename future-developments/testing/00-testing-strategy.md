# Testing Strategy - BC-Claude-Agent

> **Document Status**: Phase 3 Implementation Plan
> **Author**: QA Manager & DevOps Team
> **Last Updated**: 2025-11-14
> **Related**: `TODO.md` Phase 3, `docs/01-architecture.md`

---

## Executive Summary

This document outlines the comprehensive testing strategy for the BC-Claude-Agent system. The goal is to achieve **70% test coverage** across unit, integration, and E2E tests, with **automated enforcement** via pre-push hooks and CI/CD pipelines.

**Key Decisions**:
- **Backend Testing**: Vitest (modern, TypeScript-native, fast)
- **Frontend Testing**: Vitest + React Testing Library (consistent stack)
- **E2E Testing**: Playwright (cross-browser, reliable)
- **Enforcement**: Husky pre-push hooks (local) + GitHub Actions (CI visibility)
- **Coverage Target**: 70% (industry standard, pragmatic for MVP)
- **Performance Testing**: **Postponed to Phase 4** (focus on correctness first)

**Total Estimated Effort**: 65-83 hours (8-10 days)

---

## Table of Contents

1. [Current State & Gap Analysis](#current-state--gap-analysis)
2. [Testing Tech Stack](#testing-tech-stack)
3. [Testing Types & Coverage Targets](#testing-types--coverage-targets)
4. [Implementation Phases](#implementation-phases)
5. [Critical Business Logic Paths](#critical-business-logic-paths)
6. [Risk Assessment & Mitigation](#risk-assessment--mitigation)
7. [Timeline & Resource Allocation](#timeline--resource-allocation)
8. [Success Criteria](#success-criteria)
9. [Appendix: Tech Stack Comparison](#appendix-tech-stack-comparison)

---

## Current State & Gap Analysis

### ✅ What We Have (MVP 100% Complete)

**Backend**:
- Express + TypeScript + Socket.IO (production-ready)
- Claude Agent SDK integration (DirectAgentService)
- Microsoft OAuth 2.0 authentication
- Approval system (ApprovalManager)
- Todo system (TodoManager)
- Azure SQL + Redis integration
- MCP server with 7 tools (324 BC endpoints indexed)

**Frontend**:
- Next.js 15 + React 19 + Tailwind CSS 4
- Chat interface with streaming
- WebSocket client (Socket.IO)
- Approval dialog + Todo list components
- Zustand state management

### ❌ What's Missing (Phase 3 Gap)

**Testing Infrastructure**: **ZERO**
- ❌ No testing frameworks installed
- ❌ No test files (*.test.ts, *.spec.ts)
- ❌ No E2E setup
- ❌ No CI/CD test workflows
- ❌ No coverage reporting

**Git Hooks**: None
- ❌ No pre-commit hooks (linting)
- ❌ No pre-push hooks (tests)
- ❌ No branch protection rules

**Risk**: High - Production deployment without tests is dangerous

---

## Testing Tech Stack

### Backend Testing

**Framework**: **Vitest** (chosen over Jest)

**Rationale**:
- ✅ Modern, fast (Vite-powered), TypeScript-native
- ✅ Compatible with Jest API (easy migration if needed)
- ✅ Better performance (parallel test execution)
- ✅ No additional TS configuration required
- ✅ Built-in coverage with v8 (faster than Istanbul)

**Stack**:
```json
{
  "vitest": "2.1.8",
  "@vitest/ui": "2.1.8",
  "@types/supertest": "6.0.2",
  "supertest": "7.0.0",
  "msw": "2.6.0"
}
```

**Alternatives Considered**:
- Jest + ts-jest (rejected: slower, requires extra config)
- Node test runner (rejected: limited ecosystem)

---

### Frontend Testing

**Framework**: **Vitest + React Testing Library**

**Rationale**:
- ✅ Consistent with backend (same framework)
- ✅ React Testing Library is industry standard
- ✅ Encourages testing user behavior (not implementation)
- ✅ jsdom environment for DOM testing
- ✅ Built-in support for React 19

**Stack**:
```json
{
  "vitest": "2.1.8",
  "@testing-library/react": "16.1.0",
  "@testing-library/jest-dom": "6.6.3",
  "@testing-library/user-event": "14.5.2",
  "jsdom": "25.0.1"
}
```

**Alternatives Considered**:
- Jest + React Testing Library (rejected: duplicate frameworks)
- Cypress component testing (rejected: overkill for unit tests)

---

### E2E Testing

**Framework**: **Playwright**

**Rationale**:
- ✅ Modern, reliable, maintained by Microsoft
- ✅ Cross-browser (Chromium, Firefox, WebKit)
- ✅ Parallel execution with workers
- ✅ Auto-wait for elements (no flaky tests)
- ✅ Built-in screenshots, videos, traces
- ✅ Network interception for mocking

**Stack**:
```json
{
  "@playwright/test": "1.49.1",
  "playwright": "1.49.1"
}
```

**Alternatives Considered**:
- Cypress (rejected: slower, limited multi-tab support)
- Selenium (rejected: outdated, flaky)

---

### CI/CD & Enforcement

**Git Hooks**: **Husky + lint-staged**

**Rationale**:
- ✅ Pre-push hook prevents bad commits (local enforcement)
- ✅ Bypassable with `--no-verify` (for emergencies)
- ✅ Fast feedback loop (runs before push, not in CI)

**Stack**:
```json
{
  "husky": "9.1.7",
  "lint-staged": "15.2.11"
}
```

**GitHub Actions**: **test.yml workflow**

**Rationale**:
- ✅ CI visibility for all PRs (non-blocking in Phase 3)
- ✅ Separate jobs (backend, frontend, E2E) for parallelism
- ✅ Coverage reporting (Codecov integration)
- ✅ Can be made blocking in future (branch protection)

**Configuration**:
- Trigger: PRs to `main` or `develop`
- Workers: 1 (E2E), unlimited (unit/integration)
- Retention: 30 days for artifacts

---

## Testing Types & Coverage Targets

### 1. Unit Tests

**Definition**: Test individual functions, components, services in isolation.

**Coverage Target**: **70%** (lines, branches, functions, statements)

**Scope**:

| Area | Files | Tests | Priority |
|------|-------|-------|----------|
| **Backend Services** | DirectAgentService, ApprovalManager, TodoManager | 19 tests | CRITICAL |
| **Backend Utils** | database.ts, databaseKeepalive.ts | 4 tests | HIGH |
| **Frontend Components** | ChatInterface, Message, ApprovalDialog | 10 tests | HIGH |
| **Frontend Hooks** | useChat, useSocket, useApprovals | 13 tests | HIGH |

**Tools**:
- Vitest (test runner)
- MSW (Mock Service Worker) for HTTP mocking
- Vitest mocks for database, Redis

**Effort**: 35-45 hours

---

### 2. Integration Tests

**Definition**: Test multiple components working together (API → Service → DB).

**Coverage Target**: **Key flows** (not % coverage)

**Scope**:

| Flow | Tests | Priority |
|------|-------|----------|
| **Auth Flow** | Login → OAuth callback → Session creation | HIGH |
| **Agent Execution** | Message → Agent → MCP → Response | CRITICAL |
| **Approval Flow** | Request → WebSocket event → Respond → DB update | CRITICAL |
| **Session CRUD** | Create → Get → Update → Delete | MEDIUM |

**Tools**:
- Supertest (HTTP testing)
- Real database (test schema)
- Real Redis instance (or ioredis-mock)

**Effort**: 15-20 hours

---

### 3. E2E Tests

**Definition**: Test complete user journeys in real browser (UI → Backend → DB).

**Coverage Target**: **5 critical user journeys**

**Scope**:

| Journey | Steps | Priority |
|---------|-------|----------|
| **Authentication** | Login → OAuth consent → Dashboard | HIGH |
| **Chat Flow** | Create session → Send message → Streaming → History | CRITICAL |
| **Approval Flow** | Trigger write op → Approval dialog → Approve → Success | CRITICAL |
| **Todo Flow** | Complex task → Auto-generate todos → Mark complete | MEDIUM |
| **Error Scenarios** | Network disconnect, session expiry | MEDIUM |

**Tools**:
- Playwright (test runner)
- Fixtures for auth setup
- Page Object Model (POM) pattern

**Effort**: 5-8 hours

---

### 4. Performance Tests (Postponed to Phase 4)

**Rationale**: Focus on correctness first, then performance.

**Planned Tools**:
- k6 (modern, scalable) or Artillery (simpler)
- Load testing: 10, 50, 100 concurrent users
- Stress testing: Connection pool exhaustion

**Postponed Effort**: 8-12 hours

---

## Implementation Phases

### Phase 1: Documentation (6-8 hours) ⏳ IN PROGRESS

**Goals**:
- [x] Strategy document (this file)
- [ ] Unit testing guide (Vitest patterns, examples)
- [ ] Integration testing guide (API, DB tests)
- [ ] E2E testing guide (Playwright setup)
- [ ] Edge cases catalog (40+ edge cases)
- [ ] CI/CD pipeline guide (GitHub Actions, Husky)

**Deliverables**: 6 markdown documents in `future-developments/testing/`

---

### Phase 2: Infrastructure Setup (10-12 hours)

**Goals**:
1. **Install dependencies** (backend, frontend, E2E)
2. **Configure test runners** (vitest.config.ts, playwright.config.ts)
3. **Create test directories** (`__tests__/`, `e2e/`)
4. **Setup mocks** (MSW handlers, DB fixtures)
5. **Install Husky** (pre-push hook)
6. **Create GitHub Actions workflow** (test.yml)

**Deliverables**:
- `backend/vitest.config.ts`
- `frontend/vitest.config.ts`
- `playwright.config.ts`
- `.github/workflows/test.yml`
- `.husky/pre-push`

**Validation**:
- ✅ `npm test` runs (even with 0 tests)
- ✅ Coverage report generated
- ✅ Playwright installed with browsers
- ✅ Pre-push hook blocks push if tests fail

---

### Phase 3: Critical Tests (40-50 hours)

**Backend Unit Tests** (20-25 hours):
1. `DirectAgentService.test.ts` (8 tests)
   - Tool execution (7 MCP tools)
   - Max turns limit (20)
   - Approval flow integration
   - MCP server failure handling
2. `ApprovalManager.test.ts` (6 tests)
   - Request/respond flow
   - Promise-based approval
   - Timeout expiration (5 min)
   - Concurrent approvals
3. `TodoManager.test.ts` (5 tests)
   - Sync from SDK TodoWrite tool
   - CRUD operations
   - Order index management
   - Active form conversion
4. `database.test.ts` (4 tests)
   - Retry logic (10 attempts)
   - Keepalive job
   - Connection pool exhaustion

**Frontend Unit Tests** (15-20 hours):
1. `ChatInterface.test.tsx` (6 tests)
   - Send message
   - Streaming states
   - Optimistic updates
   - Socket disconnect handling
2. `socket.test.ts` (4 tests)
   - Connection/reconnection
   - Room join retry (3 attempts)
   - Event listener management
3. `api.test.ts` (4 tests)
   - Request with auth (cookies)
   - 401 redirect to login
   - Network error handling
4. `useChat.test.ts` (5 tests)
   - Message management
   - Session switching
   - React Query cache invalidation

**E2E Tests** (5-8 hours):
1. `auth.spec.ts` - OAuth flow, login/logout
2. `chat.spec.ts` - Chat interface with streaming
3. `approval.spec.ts` - Approval dialog interaction
4. `todo.spec.ts` - Todo list generation
5. `errors.spec.ts` - Error scenarios (network, session)

**Deliverables**: 23+ test files with 60+ tests

---

### Phase 4: Enforcement & Documentation (4-5 hours)

**Goals**:
1. **Configure coverage thresholds** (70% in vitest configs)
2. **Setup Husky pre-push hook** (run tests before push)
3. **Update CLAUDE.md** (testing guidelines)
4. **Create testing README** (backend + frontend)
5. **Update TODO.md** (mark tasks complete)

**Deliverables**:
- `backend/README-TESTING.md`
- `frontend/README-TESTING.md`
- Updated `CLAUDE.md` with testing section

---

## Critical Business Logic Paths

### Backend Critical Paths (Priority Order)

1. **Agent Execution** (`DirectAgentService.ts`, 1,104 lines)
   - Agentic loop (max 20 turns)
   - 7 MCP tool implementations
   - Approval integration
   - Error handling

2. **Approval System** (`ApprovalManager.ts`, 479 lines)
   - Promise-based approval flow
   - WebSocket event emission
   - Timeout expiration (5 min)
   - Auto-expire background job

3. **Todo Generation** (`TodoManager.ts`, 351 lines)
   - SDK TodoWrite interception
   - CRUD operations
   - Order management
   - Active form conversion

4. **WebSocket Server** (`server.ts`, ~300 lines of Socket.IO)
   - Connection authentication
   - Room management
   - Streaming event propagation
   - Disconnect handling

5. **Authentication** (`auth-oauth.ts`, ~300 lines)
   - OAuth code exchange
   - Session management
   - BC token encryption (AES-256-GCM)

6. **Database Connection** (`database.ts`, ~300 lines)
   - Retry logic (exponential backoff)
   - Keepalive job (3 min interval)
   - Auto-reconnection
   - Error handling (ETIMEDOUT, ELOGIN)

---

### Frontend Critical Paths

1. **Chat Interface** (`ChatInterface.tsx`, ~400 lines)
   - Message sending
   - Streaming state management
   - Optimistic updates
   - Socket disconnect handling

2. **WebSocket Client** (`socket.ts`, 445 lines)
   - Connection with session cookies
   - Room join retry (3 attempts)
   - Reconnection logic
   - Event listener management

3. **API Client** (`api.ts`, 232 lines)
   - HTTP client with credentials
   - 401 redirect to login
   - Error handling
   - React Query integration

4. **State Management** (Zustand stores, ~300 lines)
   - chatStore (messages, sessions)
   - approvalStore (pending approvals)
   - todoStore (todos, status updates)
   - authStore (user, authentication)

---

## Risk Assessment & Mitigation

### HIGH RISK Issues

| Risk | Impact | Likelihood | Mitigation | Test Priority |
|------|--------|------------|------------|---------------|
| **Concurrent agent queries** | Race conditions, corrupted state | HIGH | Implement BullMQ queue (Phase 4) | CRITICAL - E2E test |
| **Socket disconnect during streaming** | Lost messages | HIGH | Server persists chunks to DB | CRITICAL - Unit + E2E |
| **Approval timeout during tool execution** | Orphaned operations | MEDIUM | Promise rejection cancels tool | HIGH - Integration test |
| **Database connection failures** | Service downtime | MEDIUM | Retry logic + keepalive | HIGH - Unit test |
| **BC token expiry mid-operation** | Operation failure | MEDIUM | Auto-refresh in BCTokenManager | HIGH - Integration test |

### MEDIUM RISK Issues

| Risk | Impact | Likelihood | Mitigation | Test Priority |
|------|--------|------------|------------|---------------|
| **Tool execution timeout** | Hanging requests | MEDIUM | Add timeout to tool calls | MEDIUM - Unit test |
| **MCP server down** | No BC operations | LOW | Health check warns user | MEDIUM - Integration test |
| **Stale React Query cache** | UI shows old data | MEDIUM | Invalidate on mutations | MEDIUM - Unit test |
| **Message before room join** | Lost messages | MEDIUM | waitForRoomJoin retry | HIGH - E2E test |

### LOW RISK Issues

| Risk | Impact | Likelihood | Mitigation | Test Priority |
|------|--------|------------|------------|---------------|
| **Max turns limit hit** | Agent gives up | LOW | maxTurns: 20 is sufficient | MEDIUM - Unit test |
| **Large response truncation** | Incomplete responses | LOW | max_tokens: 4096 is sufficient | LOW - Manual test |
| **OAuth code expired** | Login retry required | LOW | Error message guides user | LOW - Manual test |

---

## Timeline & Resource Allocation

### Phase-by-Phase Breakdown

| Phase | Duration | Effort | Dates | Status |
|-------|----------|--------|-------|--------|
| **Phase 1: Documentation** | 1-2 days | 6-8 hours | 2025-11-14 to 11-15 | ⏳ IN PROGRESS |
| **Phase 2: Infrastructure** | 2 days | 10-12 hours | 2025-11-15 to 11-17 | ⏳ PENDING |
| **Phase 3: Critical Tests** | 5-6 days | 40-50 hours | 2025-11-17 to 11-23 | ⏳ PENDING |
| **Phase 4: Enforcement** | 1 day | 4-5 hours | 2025-11-23 to 11-24 | ⏳ PENDING |

**Total Timeline**: 8-10 business days
**Total Effort**: 65-83 hours
**Target Completion**: 2025-11-24 (end of Week 9)

---

### Resource Allocation

**Single Developer** (full-time):
- Week 8: Documentation + Infrastructure + Start tests
- Week 9: Finish tests + Enforcement + Documentation updates

**Two Developers** (parallel):
- Developer A: Backend tests (35-40 hours)
- Developer B: Frontend + E2E tests (30-35 hours)
- Faster completion: ~5-6 days

---

## Success Criteria

### Quantitative Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Backend Coverage** | ≥70% | Vitest coverage report |
| **Frontend Coverage** | ≥70% | Vitest coverage report |
| **E2E Tests** | 5 journeys | Playwright test report |
| **Test Execution Time** | <5 min (unit/integration) | CI logs |
| **E2E Execution Time** | <10 min | CI logs |
| **Flaky Test Rate** | <5% | GitHub Actions metrics |

### Qualitative Goals

- ✅ All critical business logic paths tested
- ✅ Edge cases documented and tested
- ✅ Pre-push hook prevents broken code
- ✅ CI pipeline provides visibility on PRs
- ✅ Testing documentation complete
- ✅ Team onboarded to testing practices

---

## Appendix: Tech Stack Comparison

### Backend: Vitest vs Jest

| Feature | Vitest | Jest |
|---------|--------|------|
| **Speed** | ⚡ Fast (Vite-powered) | 🐌 Slower (Babel transform) |
| **TypeScript** | ✅ Native | ⚠️ Requires ts-jest |
| **ESM Support** | ✅ Native | ⚠️ Experimental |
| **API** | ✅ Compatible with Jest | ✅ Standard |
| **Coverage** | ✅ v8 (faster) | ⚠️ Istanbul (slower) |
| **Ecosystem** | 🌱 Growing | 🌳 Mature |
| **Recommendation** | ✅ **CHOSEN** | ❌ Rejected |

**Decision**: Vitest for modern, fast, TypeScript-native testing.

---

### E2E: Playwright vs Cypress

| Feature | Playwright | Cypress |
|---------|-----------|---------|
| **Speed** | ⚡ Fast (parallel) | 🐌 Slower (sequential) |
| **Cross-browser** | ✅ Chromium, Firefox, WebKit | ⚠️ Chrome, Edge, Firefox (limited) |
| **Multi-tab** | ✅ Native | ❌ Requires workarounds |
| **Auto-wait** | ✅ Built-in | ✅ Built-in |
| **Network Interception** | ✅ Native | ✅ Native |
| **Trace Viewer** | ✅ Excellent | ⚠️ Limited |
| **Recommendation** | ✅ **CHOSEN** | ❌ Rejected |

**Decision**: Playwright for reliability, speed, and cross-browser support.

---

## Next Steps

1. ✅ **Read this document** - Understand strategy
2. [ ] **Review unit testing guide** (`01-unit-testing-guide.md`)
3. [ ] **Review integration testing guide** (`02-integration-testing-guide.md`)
4. [ ] **Review E2E testing guide** (`03-e2e-testing-guide.md`)
5. [ ] **Review edge cases catalog** (`04-edge-cases-catalog.md`)
6. [ ] **Review CI/CD pipeline guide** (`05-ci-cd-pipeline.md`)
7. [ ] **Begin Phase 2: Infrastructure Setup**

---

**Document Version**: 1.0
**Related Documents**:
- `01-unit-testing-guide.md` - Vitest setup, patterns, examples
- `02-integration-testing-guide.md` - API, database, auth testing
- `03-e2e-testing-guide.md` - Playwright user journeys
- `04-edge-cases-catalog.md` - 40+ documented edge cases
- `05-ci-cd-pipeline.md` - GitHub Actions, Husky setup
- `TODO.md` - Phase 3 tasks and timeline
- `docs/01-architecture.md` - System architecture reference
