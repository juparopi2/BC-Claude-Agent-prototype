# Phase 1 Completion - Task Index

**Parent Document**: [PRD-QA-PHASE1-COMPLETION.md](../PRD-QA-PHASE1-COMPLETION.md)

**Purpose**: Individual task files with extreme rigor, detailed success criteria, and complete implementation guides for completing Phase 1 of the BC Claude Agent QA initiative.

---

## 📋 Task Overview

| Task | Priority | Estimation | Status | Sprint |
|------|----------|------------|--------|--------|
| [TASK-001](#task-001-bullmq-cleanup-resolution) | 🔴 CRÍTICA | 4-6 horas | 🔴 NOT STARTED | Sprint 1 |
| [TASK-002](#task-002-bctoken-race-condition) | 🔴 CRÍTICA | 3-4 horas | 🔴 NOT STARTED | Sprint 1 |
| [TASK-003](#task-003-integration-tests-overmocked) | 🟡 ALTA | 6-8 horas | 🔴 NOT STARTED | Sprint 2 |
| [TASK-004](#task-004-skipped-tests-rehabilitation) | 🟡 ALTA | 3-4 horas | 🔴 NOT STARTED | Sprint 3 |

**Total Estimation**: 16-22 horas (2-3 semanas en 3 sprints)

---

## 🎯 Quick Navigation

### TASK-001: BullMQ Cleanup Resolution
**File**: [TASK-001-bullmq-cleanup-resolution.md](./TASK-001-bullmq-cleanup-resolution.md)

**Problem**: 18 MessageQueue integration tests pass functionally but exit with code 1 due to "Connection is closed" error in cleanup. Blocking CI/CD for 2+ weeks.

**Impact**: 🔴 CRÍTICO - Cannot trust CI/CD pipeline, blocks deployments

**Solution Options**:
- **Opción A** (RECOMENDADA): Fix shutdown order (workers → queues → redis)
- **Opción B**: Redesign test structure with try-finally
- **Opción C**: Integration tests without workers

**Success Criteria**:
- ✅ 5 consecutive test runs with exit code 0
- ✅ No "Connection is closed" errors
- ✅ Cleanup completes in < 5 seconds
- ✅ All 18 tests remain passing

**Key Files**:
- `backend/src/services/queue/MessageQueue.ts:679-728`
- `backend/src/__tests__/integration/services/queue/MessageQueue.integration.test.ts`

---

### TASK-002: BCToken Race Condition
**File**: [TASK-002-bctoken-race-condition.md](./TASK-002-bctoken-race-condition.md)

**Problem**: Multiple concurrent refresh requests for same user cause duplicate OAuth calls. No promise deduplication implemented.

**Impact**: 🔴 CRÍTICO - Risk of rate limiting, OAuth failures, token corruption

**Solution**: Implement Map-based promise deduplication pattern

**Success Criteria**:
- ✅ 10 concurrent calls → 1 OAuth call (measured)
- ✅ 100 test runs without race conditions
- ✅ Memory cleanup verified (Map size = 0 after operations)
- ✅ Error handling preserves promise cleanup

**Key Files**:
- `backend/src/services/bctoken/BCTokenManager.ts`
- `backend/src/__tests__/unit/BCTokenManager.raceCondition.test.ts:59-104`

**Anti-pattern to Fix**:
```typescript
// Line 357-361: Placeholder test that always passes
it('should handle concurrent refresh requests gracefully', async () => {
  expect(true).toBe(true); // ❌ ANTI-PATTERN
});
```

---

### TASK-003: Integration Tests for Over-Mocked Services
**File**: [TASK-003-overmocked-services-integration.md](./TASK-003-overmocked-services-integration.md)

**Problem**: Critical services have 5+ mocks in unit tests, preventing architecture bug detection:
- `DirectAgentService.test.ts`: 5 mocks (client, approvalManager, eventStore, messageQueue, fs)
- `BCTokenManager.test.ts`: Database mocked

**Impact**: 🟡 ALTA - Architecture bugs won't be caught until production

**Solution**: Create integration tests with **REAL INFRASTRUCTURE**:
- ✅ Real Azure SQL (setupDatabaseForTests)
- ✅ Real Redis (Docker port 6399)
- ✅ Real EventStore, MessageQueue, ApprovalManager
- ✅ Only mock: FakeAnthropicClient (external API via DI)

**Success Criteria**:
- ✅ DirectAgentService integration test validates complete flow
- ✅ EventStore sequence numbers validated (0, 1, 2, 3...)
- ✅ MessageQueue jobs processed and persisted
- ✅ ApprovalManager timeout handling validated
- ✅ All tests use mandatory "REAL INFRASTRUCTURE" comment template

**Key Principle**:
```typescript
/**
 * INTEGRATION TEST - REAL INFRASTRUCTURE
 *
 * Infrastructure used:
 * - Azure SQL: setupDatabaseForTests()
 * - Redis: Docker container (port 6399)
 *
 * Mocks allowed:
 * - FakeAnthropicClient (external API via DI)
 *
 * NO MOCKS of:
 * - Database, Redis, EventStore, MessageQueue, ApprovalManager
 */
```

---

### TASK-004: Rehabilitate Skipped Tests
**File**: [TASK-004-skipped-tests-rehabilitation.md](./TASK-004-skipped-tests-rehabilitation.md)

**Problem**: 3 critical tests are skipped and NOT running in CI/CD:
1. `DirectAgentService.test.ts:204` - Max turns limit (timeout 12+ seconds)
2. `DirectAgentService.test.ts:486` - Prompt caching (feature not implemented)
3. `retry.test.ts:373` - Retry decorator (not implemented)

**Impact**: 🟡 ALTA - Critical functionality not validated

**Solutions**:
1. **Max Turns**: Use `vi.useFakeTimers()` to eliminate actual waiting (< 5 seconds)
2. **Prompt Caching**: Implement ENABLE_PROMPT_CACHING check or remove test
3. **Retry Decorator**: Implement decorator or remove test with documentation

**Success Criteria**:
- ✅ 0 tests skipped in `npm test` output
- ✅ 0 tests skipped in GitHub Actions logs
- ✅ Max turns test runs in < 5 seconds
- ✅ Coverage increases by +0.5%

**Key Code Fix**:
```typescript
it('should enforce max turns limit (20 turns)', async () => {
  vi.useFakeTimers();

  // Mock 21 tool_use responses
  for (let i = 0; i < 21; i++) {
    mockClient.createChatCompletionStream.mockResolvedValueOnce({
      stopReason: 'tool_use',
      content: [{ type: 'tool_use', id: `tool_${i}`, name: 'test_tool', input: {} }],
    });
  }

  const resultPromise = service.executeQueryStreaming({...});
  await vi.runAllTimersAsync(); // No actual waiting!
  const result = await resultPromise;

  expect(result.success).toBe(false);
  expect(mockClient.createChatCompletionStream).toHaveBeenCalledTimes(20);

  vi.useRealTimers();
});
```

---

## 🚀 Execution Order (Recommended)

### Sprint 1 - Critical Blockers (Week 1)
**Goal**: Unblock CI/CD and eliminate race conditions

1. **Day 1-2**: TASK-001 (BullMQ Cleanup)
   - Bloqueando CI/CD por 2+ semanas
   - Must fix before any other CI/CD work

2. **Day 3-4**: TASK-002 (Race Condition)
   - Prevenir rate limiting de OAuth
   - Risk of token corruption

**Sprint 1 DoD**:
- [ ] Exit code 0 en 5 runs consecutivos
- [ ] No race conditions en 100 test runs
- [ ] GitHub Actions passing sin errores

---

### Sprint 2 - Architectural Coverage (Week 2)
**Goal**: Ensure integration tests validate architecture

3. **Day 5-9**: TASK-003 (Integration Tests)
   - Validar arquitectura end-to-end
   - Detectar bugs que unit tests no capturan

**Sprint 2 DoD**:
- [ ] DirectAgentService integration test passing
- [ ] BCTokenManager integration test passing
- [ ] Todos los tests usan real infrastructure
- [ ] Coverage aumenta 1.5%+

---

### Sprint 3 - Refinement (Days 10-12)
**Goal**: Complete test suite with 0 skipped tests

4. **Day 10-12**: TASK-004 (Skipped Tests)
   - Re-enable max turns test (mock timer)
   - Implementar o remover prompt caching test
   - Implementar o remover retry decorator test

**Sprint 3 DoD**:
- [ ] 0 tests skipped en npm test
- [ ] 0 tests skipped en CI/CD
- [ ] Max turns test < 5 segundos
- [ ] Coverage aumenta 0.5%

---

## 📊 Success Metrics

### Phase 1 Completion Targets

| Métrica | Baseline | Target | Current | Status |
|---------|----------|--------|---------|--------|
| **Tests Passing** | 65/71 | 71/71 | - | 🔴 |
| **Exit Code** | 1 (BullMQ error) | 0 | - | 🔴 |
| **Tests Skipped** | 3 tests | 0 tests | - | 🔴 |
| **Coverage** | 59% | 70% | - | 🟡 (Phase 3) |
| **Race Conditions** | Unhandled | 0 in 100 runs | - | 🔴 |
| **CI/CD Stability** | Blocked | 20 runs passing | - | 🔴 |

### Non-Negotiable Principles

1. **Real Infrastructure Only**: Integration tests MUST use Azure SQL, Redis (no mocks)
2. **Exit Code 0**: All test runs must exit with code 0
3. **No Skipped Tests**: 0 tests skipped in CI/CD
4. **Documented Architecture**: Every integration test has "REAL INFRASTRUCTURE" comment
5. **Promise Deduplication**: Concurrent operations must deduplicate at service layer

---

## 🔗 Related Documentation

### Core Documents
- [PRD-QA-PHASE1-COMPLETION.md](../PRD-QA-PHASE1-COMPLETION.md) - Master PRD with objectives and roadmap
- [DIAGNOSTIC-AND-TESTING-PLAN.md](../../DIAGNOSTIC-AND-TESTING-PLAN.md) - Original Phase 1 diagnostic plan
- [AUDIT-INTEGRATION-TESTS-MOCKS.md](../../AUDIT-INTEGRATION-TESTS-MOCKS.md) - Real infrastructure principles

### Architecture Documentation
- [docs/backend/architecture-deep-dive.md](../../backend/architecture-deep-dive.md) - System architecture patterns
- [docs/common/03-database-schema.md](../../common/03-database-schema.md) - Database schema
- [CLAUDE.md](../../../CLAUDE.md) - Project instructions

### Audit Reports
- QA Master Audit (previous session) - Found 7 integration test files, 82 tests, 100% real infrastructure

---

## ✅ Validation Process

### Pre-Merge Checklist (All Tasks)

Before merging any task:

- [ ] **Tests Pass**: All existing tests remain passing
- [ ] **Exit Code 0**: `npm test` returns exit code 0
- [ ] **No Regressions**: No new failures introduced
- [ ] **Code Review**: 2 approvals from team
- [ ] **Documentation**: CHANGELOG entry added
- [ ] **Real Infrastructure**: Integration tests use Azure SQL + Redis
- [ ] **No Skipped Tests**: 0 `.skip` in test files
- [ ] **Lint Passing**: `npm run lint` returns 0 errors
- [ ] **Type Check**: `npm run type-check` returns 0 errors

### Post-Merge Validation (Sprint Level)

After sprint completion:

- [ ] **CI/CD**: 20 consecutive runs passing
- [ ] **Coverage**: Increased by target %
- [ ] **Performance**: Test execution time acceptable
- [ ] **Stability**: No flaky tests detected

---

## 📝 Task Status Updates

**Last Updated**: 2025-11-27

| Task | Status | Last Updated | Notes |
|------|--------|--------------|-------|
| TASK-001 | 🔴 NOT STARTED | 2025-11-27 | BullMQ cleanup blocker |
| TASK-002 | 🔴 NOT STARTED | 2025-11-27 | Race condition risk |
| TASK-003 | 🔴 NOT STARTED | 2025-11-27 | Integration tests needed |
| TASK-004 | 🔴 NOT STARTED | 2025-11-27 | 3 tests skipped |

**Next Review**: After Sprint 1 completion

---

## 🎓 Learning Resources

### Testing Patterns
- **Promise Deduplication**: TASK-002 demonstrates Map-based pattern
- **Graceful Shutdown**: TASK-001 demonstrates BullMQ cleanup order
- **Real Infrastructure Testing**: TASK-003 demonstrates DI pattern for mocking
- **Mock Timers**: TASK-004 demonstrates vi.useFakeTimers() for performance

### Anti-Patterns to Avoid
- ❌ Placeholder tests that always pass (TASK-002:357-361)
- ❌ "KNOWN ISSUE" tests without fixes (TASK-002:59-104)
- ❌ Skipped tests in CI/CD (TASK-004)
- ❌ Incorrect shutdown order (TASK-001: queues before workers)
- ❌ Over-mocking core services (TASK-003: 5+ mocks)

---

## 💬 Questions & Support

**For Implementation Questions**:
1. Read task file completely (each is 2,000-3,000 lines with full context)
2. Check success criteria section for validation requirements
3. Review code examples in implementation steps
4. Consult PRD for sprint-level context

**For Architectural Questions**:
- See `docs/backend/architecture-deep-dive.md`
- See `CLAUDE.md` for project patterns

**For Test Strategy Questions**:
- See `AUDIT-INTEGRATION-TESTS-MOCKS.md` for real infrastructure principles
- See individual task files for test templates

---

**Owner**: QA Master + Product Manager + Scrum Master
**Created**: 2025-11-27
**Version**: 1.0
