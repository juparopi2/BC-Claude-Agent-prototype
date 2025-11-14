# Testing Documentation - BC-Claude-Agent

> **Status**: Phase 3 Implementation Plan
> **Last Updated**: 2025-11-14
> **Total Documents**: 6 comprehensive guides (~35,000 words)

---

## Quick Navigation

| Document | Purpose | Pages | Status |
|----------|---------|-------|--------|
| **[00-testing-strategy.md](00-testing-strategy.md)** | Overall strategy, tech stack, timeline | ~20 | ✅ Complete |
| **[01-unit-testing-guide.md](01-unit-testing-guide.md)** | Vitest setup, patterns, examples | ~25 | ✅ Complete |
| **[02-integration-testing-guide.md](02-integration-testing-guide.md)** | API, DB, WebSocket tests | ~22 | ✅ Complete |
| **[03-e2e-testing-guide.md](03-e2e-testing-guide.md)** | Playwright user journeys | ~20 | ✅ Complete |
| **[04-edge-cases-catalog.md](04-edge-cases-catalog.md)** | 32 edge cases documented | ~18 | ✅ Complete |
| **[05-ci-cd-pipeline.md](05-ci-cd-pipeline.md)** | GitHub Actions, Husky hooks | ~15 | ✅ Complete |

**Total**: ~120 pages, 35,000+ words

---

## Documentation Overview

### Purpose

This documentation provides a **complete testing strategy** for the BC-Claude-Agent system, covering:
- ✅ Testing frameworks (Vitest, Playwright)
- ✅ Test patterns and examples
- ✅ Edge cases and failure modes
- ✅ CI/CD automation (GitHub Actions + Husky)
- ✅ Coverage enforcement (70% threshold)

---

## Executive Summary

**Current State**: ❌ **ZERO TEST COVERAGE**
- No testing frameworks installed
- No test files (*.test.ts, *.spec.ts)
- No E2E setup
- No CI/CD test workflows

**Target State**: ✅ **70% TEST COVERAGE**
- Unit tests: Backend + Frontend
- Integration tests: API + Database
- E2E tests: 5 critical user journeys
- Automated enforcement: Husky + GitHub Actions

**Timeline**: 65-83 hours (8-10 days)

---

## Reading Path

### For Developers (Implementing Tests)

**Week 8 - Day 1-2: Setup**
1. ✅ Read **[00-testing-strategy.md](00-testing-strategy.md)** - Understand overall approach (30 min)
2. ✅ Read **[01-unit-testing-guide.md](01-unit-testing-guide.md)** - Vitest patterns (1 hour)
3. ⏳ Install testing frameworks (Backend + Frontend) (2 hours)
4. ⏳ Write first test (DirectAgentService) (2 hours)

**Week 8 - Day 3-5: Backend Tests**
5. ⏳ Read **[04-edge-cases-catalog.md](04-edge-cases-catalog.md)** - Edge cases to test (30 min)
6. ⏳ Write backend unit tests (20-25 hours)
   - DirectAgentService, ApprovalManager, TodoManager
   - Database utils, BCTokenManager

**Week 8 - Day 6-7: Frontend Tests**
7. ⏳ Write frontend unit tests (15-20 hours)
   - ChatInterface, Message, ApprovalDialog
   - useChat, useSocket, useApprovals hooks

**Week 9 - Day 1-2: Integration Tests**
8. ✅ Read **[02-integration-testing-guide.md](02-integration-testing-guide.md)** - API patterns (1 hour)
9. ⏳ Write integration tests (15-20 hours)
   - Auth flow, Sessions CRUD, Agent execution, Approvals

**Week 9 - Day 3-5: E2E Tests**
10. ✅ Read **[03-e2e-testing-guide.md](03-e2e-testing-guide.md)** - Playwright setup (1 hour)
11. ⏳ Write E2E tests (5-8 hours)
    - Authentication, Chat, Approval, Todo, Errors

**Week 9 - Day 6: CI/CD**
12. ✅ Read **[05-ci-cd-pipeline.md](05-ci-cd-pipeline.md)** - GitHub Actions (30 min)
13. ⏳ Setup Husky pre-push hooks (2 hours)
14. ⏳ Create GitHub Actions workflow (2 hours)

---

### For QA Managers (Reviewing Strategy)

**Quick Read** (2 hours):
1. **[00-testing-strategy.md](00-testing-strategy.md)** - Strategy overview, tech stack, timeline
2. **[04-edge-cases-catalog.md](04-edge-cases-catalog.md)** - Risk assessment (32 edge cases)
3. **[05-ci-cd-pipeline.md](05-ci-cd-pipeline.md)** - Enforcement strategy

**Key Metrics**:
- Coverage target: **70%**
- Total effort: **65-83 hours**
- Test types: **Unit + Integration + E2E**
- Critical edge cases: **24 high/critical priority**
- CI/CD: **Husky (local) + GitHub Actions (CI)**

---

### For DevOps Engineers (Setting Up CI/CD)

**Implementation Path** (4 hours):
1. **[05-ci-cd-pipeline.md](05-ci-cd-pipeline.md)** - Full CI/CD guide
   - Husky pre-push hooks
   - GitHub Actions workflow (`test.yml`)
   - Branch protection rules
   - Codecov integration

**Deliverables**:
- `.husky/pre-push` hook (local enforcement)
- `.github/workflows/test.yml` (CI enforcement)
- Branch protection rules on `main` (merge gatekeeper)
- Codecov badge in README.md

---

## Key Decisions

### Testing Frameworks

| Component | Framework | Why? |
|-----------|-----------|------|
| **Backend Unit** | Vitest | Modern, fast, TypeScript-native |
| **Frontend Unit** | Vitest + RTL | Consistent with backend, React best practice |
| **E2E** | Playwright | Cross-browser, reliable, auto-wait |
| **Mocking** | MSW | HTTP mocking, realistic |

**Alternatives Rejected**:
- Jest (slower, requires ts-jest)
- Cypress (slower E2E, limited multi-tab)

---

### Enforcement Strategy

| Stage | Tool | Bypassable? | Purpose |
|-------|------|-------------|---------|
| **Local** | Husky pre-push | Yes (`--no-verify`) | Fast feedback |
| **CI** | GitHub Actions | No | Gatekeeper |
| **Merge** | Branch Protection | No (admin override) | Final safeguard |

**Philosophy**: Defense in depth - multiple layers

---

### Coverage Target

**70%** (lines, branches, functions, statements)

**Rationale**:
- ✅ Pragmatic (achievable in 2-3 weeks)
- ✅ Industry standard
- ✅ Covers critical paths
- ❌ 80%+ requires 4-5 weeks, diminishing returns

---

## Implementation Phases

### Phase 1: Documentation ✅ COMPLETE (6-8 hours)

**Status**: **DONE** - All 6 documents written

**Deliverables**:
- ✅ `00-testing-strategy.md` (6,500 words)
- ✅ `01-unit-testing-guide.md` (8,000 words)
- ✅ `02-integration-testing-guide.md` (7,000 words)
- ✅ `03-e2e-testing-guide.md` (6,500 words)
- ✅ `04-edge-cases-catalog.md` (5,500 words)
- ✅ `05-ci-cd-pipeline.md` (4,500 words)
- ✅ `README.md` (this file)

---

### Phase 2: Infrastructure Setup ⏳ PENDING (10-12 hours)

**Status**: Ready to start

**Tasks**:
- [ ] Install Vitest (backend + frontend)
- [ ] Install Playwright
- [ ] Configure vitest.config.ts (both)
- [ ] Configure playwright.config.ts
- [ ] Create test directories (`__tests__/`, `e2e/`)
- [ ] Setup MSW mocks
- [ ] Install Husky + lint-staged
- [ ] Create GitHub Actions workflow (`.github/workflows/test.yml`)

**Reference**: `01-unit-testing-guide.md` (Vitest Setup), `03-e2e-testing-guide.md` (Playwright Setup)

---

### Phase 3: Critical Tests ⏳ PENDING (40-50 hours)

**Status**: Waiting for Phase 2

**Backend Unit Tests** (20-25h):
- [ ] `DirectAgentService.test.ts` (8 tests)
- [ ] `ApprovalManager.test.ts` (6 tests)
- [ ] `TodoManager.test.ts` (5 tests)
- [ ] `database.test.ts` (4 tests)

**Frontend Unit Tests** (15-20h):
- [ ] `ChatInterface.test.tsx` (6 tests)
- [ ] `socket.test.ts` (4 tests)
- [ ] `api.test.ts` (4 tests)
- [ ] `useChat.test.ts` (5 tests)

**E2E Tests** (5-8h):
- [ ] `auth.spec.ts` - OAuth flow
- [ ] `chat.spec.ts` - Chat interface
- [ ] `approval.spec.ts` - Approval workflow
- [ ] `todo.spec.ts` - Todo list
- [ ] `errors.spec.ts` - Error scenarios

**Reference**: `01-unit-testing-guide.md` (Examples), `03-e2e-testing-guide.md` (User Journeys)

---

### Phase 4: Enforcement & Docs ⏳ PENDING (4-5 hours)

**Status**: Waiting for Phase 3

**Tasks**:
- [ ] Configure Husky pre-push hook
- [ ] Add coverage thresholds (70%) to vitest configs
- [ ] Update `CLAUDE.md` with testing guidelines
- [ ] Update `TODO.md` with progress
- [ ] Create `backend/README-TESTING.md`
- [ ] Create `frontend/README-TESTING.md`
- [ ] Enable GitHub branch protection rules

**Reference**: `05-ci-cd-pipeline.md` (Husky + GitHub Actions)

---

## Critical Edge Cases

**Total**: 32 documented edge cases

**High/Critical Priority** (24 cases):

| Category | High Priority Cases | Status |
|----------|---------------------|--------|
| **Agent** | Tool timeout, Malformed response, Concurrent queries | ❌ Not handled |
| **Database** | Connection timeout, Transaction deadlock | ⚠️ Partial |
| **Auth** | BC token expiry, User denies consent | ✅ Handled |
| **WebSocket** | Disconnect during streaming, Message before room join | ⚠️ Mixed |
| **Frontend** | Session switch during streaming, Stale cache | ❌ Not handled |

**Reference**: `04-edge-cases-catalog.md` (Full list with tests)

---

## Tech Stack Summary

### Backend
- **Vitest** 2.1.8 - Unit test runner
- **@vitest/ui** 2.1.8 - Test UI
- **Supertest** 7.0.0 - HTTP testing
- **MSW** 2.6.0 - HTTP mocking

### Frontend
- **Vitest** 2.1.8 - Unit test runner
- **@testing-library/react** 16.1.0 - Component testing
- **@testing-library/jest-dom** 6.6.3 - DOM assertions
- **@testing-library/user-event** 14.5.2 - User interactions
- **jsdom** 25.0.1 - DOM environment

### E2E
- **@playwright/test** 1.49.1 - E2E framework
- **Playwright** 1.49.1 - Browser automation

### CI/CD
- **Husky** 9.1.7 - Git hooks
- **lint-staged** 15.2.11 - Pre-commit linting
- **GitHub Actions** - CI/CD
- **Codecov** - Coverage reporting

---

## Success Criteria

### Quantitative Metrics

| Metric | Target | Current | Gap |
|--------|--------|---------|-----|
| **Backend Coverage** | ≥70% | 0% | -70% |
| **Frontend Coverage** | ≥70% | 0% | -70% |
| **E2E Tests** | 5 journeys | 0 | -5 |
| **Test Execution Time** | <5 min (unit) | N/A | N/A |
| **E2E Execution Time** | <10 min | N/A | N/A |
| **Flaky Test Rate** | <5% | N/A | N/A |

---

### Qualitative Goals

- ✅ All critical business logic paths tested
- ✅ Edge cases documented and tested
- ✅ Pre-push hook prevents broken code
- ✅ CI pipeline provides visibility on PRs
- ✅ Testing documentation complete
- ✅ Team onboarded to testing practices

---

## Resource Allocation

**Single Developer** (full-time):
- Week 8: Documentation ✅ + Infrastructure + Start tests
- Week 9: Finish tests + Enforcement + Documentation updates

**Two Developers** (parallel):
- Developer A: Backend tests (35-40 hours)
- Developer B: Frontend + E2E tests (30-35 hours)
- Faster completion: ~5-6 days

---

## Postponed to Phase 4

The following items were **intentionally postponed** to focus on correctness first:

**Performance Testing** (8-12 hours):
- Load testing (k6 or Artillery)
- Stress testing (connection pool, DB limits)
- WebSocket performance

**Monitoring & Observability** (6-8 hours):
- Structured logging (Winston/Pino)
- APM integration (Application Insights)
- Dashboards (latency, errors, tokens)

**Production Optimizations** (4-6 hours):
- Redis caching for BC queries
- Database query optimization
- Rate limiting

**Reference**: `TODO.md` Phase 4

---

## FAQ

### Q: Why Vitest over Jest?

**A**: Vitest is faster, TypeScript-native, and has better DX. Jest requires ts-jest config and is slower.

### Q: Why 70% coverage, not 80%+?

**A**: 70% is the industry standard and achievable in 2-3 weeks. 80%+ requires 4-5 weeks with diminishing returns.

### Q: Can tests be skipped for hotfixes?

**A**: Yes, use `git push --no-verify` to bypass Husky pre-push hook. **Use sparingly** - only for production emergencies.

### Q: Do E2E tests run on every commit?

**A**: No, E2E tests only run in CI (GitHub Actions), not locally. Too slow for local development.

### Q: What if CI is failing?

**A**: PRs cannot be merged until CI passes. Fix tests, then push again. Branch protection enforces this.

---

## Next Steps

### Immediate Actions

1. ✅ **Read testing-strategy.md** - Understand overall approach
2. [ ] **Setup Vitest (backend)** - Install dependencies, config
3. [ ] **Write first test** - `DirectAgentService.test.ts`
4. [ ] **Run tests** - `npm test`
5. [ ] **Check coverage** - `npm run test:coverage`
6. [ ] **Iterate** - Write more tests until 70% coverage

### For Project Leads

1. ✅ **Review this README** - Understand scope and timeline
2. [ ] **Approve Phase 2 start** - Infrastructure setup (10-12 hours)
3. [ ] **Allocate resources** - Assign developers to testing tasks
4. [ ] **Set deadline** - Target Week 9 completion (2025-11-24)

---

## Document Metadata

**Created**: 2025-11-14
**Last Updated**: 2025-11-14
**Version**: 1.0
**Authors**: QA Manager + DevOps Team
**Status**: ✅ **COMPLETE** - Ready for implementation

**Related Documents**:
- `../../TODO.md` - Phase 3 tasks and timeline
- `../../docs/01-architecture.md` - System architecture
- `../../docs/03-database-schema.md` - Database schema
- `../../CLAUDE.md` - Project instructions

---

**Total Documentation**: 6 documents, ~35,000 words, 120 pages

✅ **Testing documentation is complete and ready for Phase 2 implementation.**
