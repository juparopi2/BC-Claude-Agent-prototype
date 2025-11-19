# PRD 09: Execution Roadmap - 11-Day Sprint Plan

**Document Version**: 1.0.0
**Created**: 2025-11-19
**Total Time**: 88 hours (11 days)

---

## Sprint Overview

**Phase 1**: Critical Services (26 hours)
**Phase 2**: Edge Cases (12 hours)
**Phase 3**: Integration Tests (20 hours)
**Phase 4**: CI/CD (6 hours)
**Phase 5**: Documentation (4.5 hours)
**Buffer**: 8 hours

---

## Week 8 - Critical Services & Edge Cases (40 hours)

### Day 1 (8 hours)

**09:00-11:00** - Preparation
- Build, lint, baseline coverage
- Review PRD 02 (EventStore + MessageQueue)

**11:00-15:00** - EventStore Tests (4 hours)
- Tests 1-10 from PRD 02
- Atomic sequencing, event replay

**15:00-18:00** - MessageQueue Tests (3 hours)
- Tests 1-6 from PRD 02

**Checkpoint**: Run `npm test` - All EventStore tests passing

---

### Day 2 (8 hours)

**09:00-12:00** - MessageQueue Tests (3 hours)
- Tests 7-12 from PRD 02
- Rate limiting, DLQ, health checks

**13:00-15:00** - Auth Tests Start (2 hours)
- Review PRD 03
- Tests 1-4 (OAuth flow)

**15:00-18:00** - Auth Tests (3 hours)
- Tests 5-8 (BC token, errors)

**Checkpoint**: EventStore + MessageQueue 100% complete

---

### Day 3 (8 hours)

**09:00-11:00** - Auth Tests Complete (2 hours)
- Tests 9-10 (Token expiry, concurrent refresh)

**11:00-15:00** - BCTokenManager Tests (4 hours)
- Tests 1-8 from PRD 03
- Encryption, decryption, tamper detection

**15:00-18:00** - TodoManager Tests (3 hours)
- Review PRD 04
- Tests 1-4 (CRUD, active form)

**Checkpoint**: Auth services 100% complete

---

### Day 4 (8 hours)

**09:00-12:00** - TodoManager Tests (3 hours)
- Tests 5-8 (List, reorder, bulk ops)

**13:00-16:00** - DirectAgentService Tests (3 hours)
- Tests 9-12 from PRD 04
- Context management, caching

**16:00-18:00** - Database Connection Tests (2 hours)
- Retry logic, connection pool

**Checkpoint**: Business logic 100% complete

---

### Day 5 (8 hours)

**09:00-15:00** - Edge Cases (6 hours)
- Tests 1-6 from PRD 06 (Agent edge cases)
- Concurrent queries, timeouts

**15:00-18:00** - Edge Cases (3 hours)
- Tests 7-10 from PRD 06 (Auth & WebSocket)

**Checkpoint 1**: Critical services complete (26 hours)
**Decision**: Continue to integration tests or debug

---

## Week 9 - Integration Tests & CI/CD (40 hours)

### Day 6 (8 hours)

**09:00-12:00** - Integration Setup (3 hours)
- Docker Compose for Redis
- In-memory SQLite
- MSW handlers

**13:00-18:00** - Auth Flow Integration (5 hours)
- Tests 1-3 from PRD 05
- Login, BC consent, token refresh

**Checkpoint**: Integration test infrastructure ready

---

### Day 7 (8 hours)

**09:00-12:00** - Auth Flow Complete (3 hours)
- Test 4 (Logout + cleanup)

**13:00-18:00** - Agent Execution Integration (5 hours)
- Test 5 from PRD 05
- Full pipeline: User → Agent → Tool → Response

**Checkpoint 2**: Auth flow integration complete
**Decision**: Test from Frontend or continue

---

### Day 8 (8 hours)

**09:00-15:00** - Agent Execution Integration (6 hours)
- Test 6: Approval flow end-to-end
- Test 7: Event sourcing pipeline

**15:00-18:00** - WebSocket Integration (3 hours)
- Test 8 from PRD 05
- Connection, streaming, room join

**Checkpoint**: Agent execution integration complete

---

### Day 9 (8 hours)

**09:00-12:00** - WebSocket Integration (3 hours)
- Tests 9-10 from PRD 05
- Disconnect/reconnect, event ordering

**13:00-15:00** - Husky Setup (2 hours)
- Install Husky
- Configure pre-push hook
- Test locally

**15:00-18:00** - GitHub Actions (3 hours)
- Create workflow YAML
- Test on branch

**Checkpoint 3**: Integration tests complete
**Decision**: Identify critical bugs or proceed

---

### Day 10 (8 hours)

**09:00-12:00** - GitHub Actions Complete (3 hours)
- Codecov integration
- Branch protection rules

**13:00-16:00** - Documentation Updates (3 hours)
- Update CLAUDE.md (testing guidelines)
- Update TODO.md (progress tracking)

**16:00-18:00** - Final Test Run (2 hours)
- `npm test` - All tests
- `npm run test:coverage` - Verify ≥70%

**Checkpoint**: CI/CD complete

---

## Week 10 - Buffer & Documentation (8 hours)

### Day 11 (8 hours)

**09:00-12:00** - Documentation (3 hours)
- Create `backend/README-TESTING.md`
- Update `docs/backend/README.md`

**13:00-18:00** - Buffer (5 hours)
- Fix any remaining issues
- Address bugs found during testing
- Refactor flakey tests

**Final Checkpoint**: All complete
- ✅ ≥70% backend coverage
- ✅ 20+ integration tests
- ✅ 12+ edge case tests
- ✅ CI/CD enforced

---

## Checkpoints and Decisions

### Checkpoint 1 (Day 5, 17:00)
**Status**: Critical services complete (EventStore, MessageQueue, Auth, TodoManager, DB)

**Questions**:
1. All tests passing?
2. Coverage ≥50%?
3. Any critical bugs found?

**Decision Tree**:
- ✅ All passing → Continue to integration tests (Day 6)
- ⚠️ Some failures → Debug Day 6 morning (2 hours), then continue
- ❌ Critical bugs → Pause testing, fix bugs, resume

---

### Checkpoint 2 (Day 7, 17:00)
**Status**: Auth flow integration complete

**Questions**:
1. Can user log in end-to-end?
2. BC token acquisition working?
3. Token refresh automatic?

**Decision Tree**:
- ✅ All working → Continue to agent execution (Day 8)
- ⚠️ Frontend testing needed → Spend Day 8 morning testing from UI
- ❌ Auth broken → Critical fix required before proceeding

---

### Checkpoint 3 (Day 9, 17:00)
**Status**: All integration tests complete

**Questions**:
1. Agent execution end-to-end working?
2. Approval flow functional?
3. WebSocket streaming reliable?

**Decision Tree**:
- ✅ All working → Proceed to CI/CD (Day 10)
- ⚠️ Minor bugs → Document as known issues, proceed
- ❌ Critical bugs → Use Day 10 for fixes

---

## Contingency Plans

### If Timeline Extends

**Option 1**: Reduce scope to 70% coverage
- Skip edge cases 17-24 (P2 priority)
- Keep all critical services + integration tests

**Option 2**: Two developers in parallel
- Dev A: Critical services (26 hours)
- Dev B: Integration tests + CI/CD (26 hours)
- **Completion**: 7-8 days instead of 11

**Option 3**: Defer CI/CD to Phase 3
- Focus on tests first
- Add CI/CD later (6 hours)

---

### If Tests Reveal Critical Bugs

**Priority 1 Bugs** (Block testing):
- EventStore sequence number collisions
- Auth flow completely broken
- Agent loop infinite

**Action**: Stop testing, fix bug, resume

**Priority 2 Bugs** (Continue testing):
- Edge case failures
- Performance issues
- UI glitches

**Action**: Document in GitHub Issues, continue

---

## Success Criteria

After Day 11, verify:

✅ **Backend Coverage**: ≥70%
✅ **Unit Tests**: 96-109 tests passing
✅ **Integration Tests**: 20+ tests passing
✅ **Edge Case Tests**: 12+ tests passing
✅ **CI/CD**: Husky + GitHub Actions enforced
✅ **Documentation**: PRDs + README-TESTING.md complete
✅ **No Regressions**: Existing 58 tests still passing

---

**End of PRD 09: Execution Roadmap**
