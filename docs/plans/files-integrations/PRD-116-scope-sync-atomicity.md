# PRD-116: Scope Batch Creation Atomicity & Sync Reliability

## Status: Proposed
## Priority: P2 (post-SharePoint stabilization)

---

## 1. Problem Statement

During SharePoint integration testing, a user added 2 sites with folders but logs showed only 1 scope was added (`addCount:1, removeCount:1`) and 1 sync completed (185 files). Investigation revealed architectural gaps in how batch scope creation and initial sync dispatch are handled.

### Root Cause Candidates

1. **Frontend sent only 1 add** — the user may have been reconfiguring (removing one scope, adding another), not adding 2 fresh scopes. The batch endpoint correctly processed the request it received.
2. **Second scope DB insert failed silently** — no transaction wrapping means partial failures are invisible to the caller.

Regardless of which occurred, the architecture has gaps that would cause real data loss under failure conditions.

---

## 2. Diagnosis

### 2.1 No Transaction Wrapping

**File**: `backend/src/services/connections/ConnectionService.ts` (batchUpdateScopes method)

`batchUpdateScopes()` creates scopes in a sequential loop with individual `repo.createScope()` calls. If scope N+1 fails after scope 1..N succeeded:
- Scopes 1..N are orphaned in the DB
- Fire-and-forget syncs for 1..N are already dispatched
- The HTTP response returns an error, but the partial writes persist
- No rollback mechanism exists

### 2.2 Fire-and-Forget Sync Dispatch

**File**: `backend/src/services/sync/InitialSyncService.ts`

`initialSyncService.syncScope()` returns `void`. The HTTP response is sent BEFORE any sync completes. Failure modes:
- If the Node.js process restarts, queued syncs never start
- If the event loop stalls under load, sync promises may be garbage-collected
- No persistence of "sync intent" — the system has no record that a sync was requested

### 2.3 No Per-Scope Error Feedback

The batch endpoint returns `{ added, removed }` counts but if a sync fails AFTER the HTTP response, the only feedback is a WebSocket `sync:error` event. If the frontend disconnected between the HTTP response and the sync failure, the error is lost entirely.

### 2.4 Initial Sync Not Queued

Unlike delta sync (which uses BullMQ jobs triggered by webhooks), initial sync is dispatched as a bare `_runSync().catch()` promise:
- No retry on failure
- No persistence of intent
- No visibility into pending syncs (no job ID, no status tracking)
- Lost on process restart

---

## 3. What Works Well (Delta Sync)

For reference, delta sync already handles these concerns correctly:
- **BullMQ job queuing** for webhook-triggered syncs
- **Per-item error isolation** (failed files don't abort the entire sync)
- **Cursor management** with deltaLink for incremental processing
- **Subscription lifecycle** (create, renew, handle lifecycle events)
- **Provider-aware dispatch** (OneDrive/SharePoint routing)
- **Polling fallback** every 30 minutes as safety net

---

## 4. Proposed Changes

### 4.1 Wrap Batch Scope Creation in a Transaction

```typescript
// ConnectionService.ts - batchUpdateScopes
async batchUpdateScopes(connectionId: string, scopes: ScopeBatchUpdate): Promise<BatchResult> {
  return prisma.$transaction(async (tx) => {
    // All creates and deletes happen atomically
    for (const scope of scopes.add) {
      await repo.createScope(tx, connectionId, scope);
    }
    for (const scopeId of scopes.remove) {
      await repo.deleteScope(tx, scopeId);
    }
    return { added: scopes.add.length, removed: scopes.remove.length };
  });
  // Sync dispatch happens AFTER transaction commits (see 4.2)
}
```

### 4.2 Queue Initial Syncs as BullMQ Jobs

Replace bare promise dispatch with BullMQ jobs:

```typescript
// After transaction commits successfully:
for (const scope of createdScopes) {
  await syncQueue.add('initial-sync', {
    scopeId: scope.id,
    connectionId,
    provider: scope.provider,
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
}
```

Benefits:
- Survives process restarts (persisted in Redis)
- Automatic retry with exponential backoff
- Visible in BullMQ dashboard
- Consistent with delta sync architecture

### 4.3 Per-Scope Error Tracking in Batch Response

Extend the batch response to include per-scope status:

```typescript
interface BatchScopeResult {
  added: Array<{ scopeId: string; syncJobId: string }>;
  removed: string[];
  errors: Array<{ scope: ScopeInput; error: string }>;
}
```

### 4.4 Scope Status State Machine

Add explicit status transitions for scopes:

```
CREATED → SYNC_QUEUED → SYNCING → SYNCED → ERROR
```

This provides visibility into where each scope is in its lifecycle, both for the frontend and for debugging.

### 4.5 Consider: Fully Async Batch Endpoint

Evaluate whether the batch endpoint should only create scopes and return scope IDs, with ALL sync processing happening asynchronously via BullMQ. The frontend would then poll scope status or receive WebSocket updates.

---

## 5. Implementation Priority

| Change | Effort | Impact | Priority |
|--------|--------|--------|----------|
| 4.1 Transaction wrapping | Small | Prevents orphaned scopes | P1 |
| 4.2 BullMQ initial sync | Medium | Prevents lost syncs | P1 |
| 4.3 Per-scope error tracking | Small | Better error visibility | P2 |
| 4.4 Scope status machine | Medium | Full lifecycle visibility | P2 |
| 4.5 Fully async endpoint | Large | Architectural alignment | P3 |

---

## 6. Relevant Code Locations

- `backend/src/services/connections/ConnectionService.ts` — `batchUpdateScopes()` method
- `backend/src/services/sync/InitialSyncService.ts` — `syncScope()` and `_runSync()`
- `backend/src/services/sync/DeltaSyncService.ts` — Reference implementation (BullMQ-based)
- `backend/src/domains/queue/` — BullMQ abstraction layer
- `backend/prisma/schema.prisma` — `connection_scopes` model

---

## 7. Out of Scope

- Delta sync changes (already well-architected)
- Webhook subscription management (working correctly)
- Frontend scope selection UI (separate PRD)
