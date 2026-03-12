# PRD-116: Scope Batch Creation Atomicity & Sync Reliability

## Status: Completed
## Priority: P2 (post-SharePoint stabilization)
## Implemented: 2026-03-12

### Implementation Notes
- **Shared types**: `SYNC_STATUS` extended with `sync_queued` and `synced` in `packages/shared/src/constants/connection-status.ts`
- **DB CHECK constraint**: Updated via `backend/scripts/database/update-sync-status-check.ts`
- **BullMQ**: `addInitialSyncJob()` in `MessageQueue.ts`, `ExternalFileSyncWorker` routes `triggerType='initial'` to `InitialSyncService.syncScopeAsync()`
- **Atomicity**: `ConnectionService.batchUpdateScopes()` uses `prisma.$transaction()` for all scope creates; scopes start as `sync_queued`; BullMQ jobs enqueued post-transaction
- **Non-blocking UI**: `SyncProgressPanel` replaces blocking modal; `triggerSyncOperation()` module-level function with polling
- **Diagnostic scripts**: `verify-sync.ts` (cross-system verification) and enhanced `diagnose-sync.ts` (--health, --source-type, pipeline breakdown)

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

---

## 8. Post-Implementation Bug: Transaction Timeout (Fixed 2026-03-12)

### 8.1 Symptom

When adding 4+ scopes in a single batch (e.g., selecting multiple SharePoint libraries), the server crashed with:
1. **Transaction timeout** — exceeded the 5000ms default
2. **EREQINPROG** unhandled rejection — rollback fired while a query was still in-flight

### 8.2 Root Cause

`batchUpdateScopes()` wrapped scope creation in `prisma.$transaction(async (tx) => {...})`, but `repo.createScope()` used the **global Prisma client** instead of the transaction client `tx`. This caused:

- **Creates** via global `prisma` on connection pool A
- **Updates** via `tx` on connection pool B (the transaction connection)
- With 4 scopes × 2 ops = 8 sequential round-trips across 2 DB connections → exceeded 5000ms timeout
- No actual atomicity — creates via global `prisma` were not rolled back on failure

### 8.3 Fix: Scoped Repository Factory

Introduced `createScopeWriter(client)` factory in `ConnectionRepository.ts`:

- Accepts a `PrismaClientLike` (either global `PrismaClient` or `Prisma.TransactionClient`)
- All scope write operations (create, update, delete) go through the provided client
- Existing `ConnectionRepository` class methods delegate to the factory with default global client
- Transaction callers pass `createScopeWriter(tx)` to ensure all operations use the transaction connection

Additional improvements:
- `syncStatus` is set at creation time (eliminates the separate `update()` round-trip)
- DB round-trips cut from 8 to 4 for a 4-scope batch
- Explicit `timeout: 15000` on the transaction as safety margin
- Same fix applied to `_expandSiteScope()` which had the same two-step anti-pattern

---

## 9. Post-Implementation Bug: Concurrent Token Fetch Race Condition (Fixed 2026-03-12)

### 9.1 Symptom

When a user adds 3+ SharePoint folder scopes in a single batch, the BullMQ initial-sync workers start concurrently. 2 out of 3 (or more) fail with:

```
Error: Connection not found: 05BBE052-0286-4ACB-9412-C28C11CFA9F8
    at GraphTokenManager.getValidToken (GraphTokenManager.ts:81:13)
    at SharePointService.executeFolderDeltaQuery (SharePointService.ts:275:19)
    at InitialSyncService._runSync (InitialSyncService.ts:144:18)
```

The connection exists in the database — earlier browsing calls and the `_runSync` connection lookup at line 107 all succeed. Only the concurrent `getValidToken` calls fail.

### 9.2 Root Cause

The `PrismaMssql` adapter (backed by the `mssql` connection pool) intermittently returns `null` from `findUnique` when multiple workers issue the exact same query against the same row simultaneously. The sequence:

1. `batchUpdateScopes()` creates 3 scopes in a transaction, enqueues 3 BullMQ jobs post-commit
2. 3 `ExternalFileSyncWorker` instances pick up the jobs nearly simultaneously (~0ms apart)
3. Each `_runSync` call fetches the connection at line 107 → succeeds (sequential timing with scope updates)
4. Each `_runSync` calls `SharePointService.executeFolderDeltaQuery` → `getValidToken(connectionId)` → `prisma.connections.findUnique` at line 68
5. 3 concurrent `findUnique` queries against the same `connections` row: 2 return `null`, 1 succeeds

The DB connection pool (`max: 10`) was also undersized for the concurrent load pattern (3 sync workers × multiple queries each + UI browsing/listing queries).

### 9.3 Fix: Singleflight Pattern + Pool Increase

**1. Singleflight in `GraphTokenManager.getValidToken()`** (`backend/src/services/connectors/GraphTokenManager.ts`)

Added an `inflightTokenRequests` Map that deduplicates concurrent calls for the same `connectionId`. When multiple callers request the same token simultaneously, they share a single in-flight DB query instead of each issuing a separate one:

```typescript
private inflightTokenRequests = new Map<string, Promise<string>>();

async getValidToken(connectionId: string): Promise<string> {
  const inflight = this.inflightTokenRequests.get(connectionId);
  if (inflight) return inflight;

  const promise = this._getValidTokenImpl(connectionId);
  this.inflightTokenRequests.set(connectionId, promise);
  try {
    return await promise;
  } finally {
    this.inflightTokenRequests.delete(connectionId);
  }
}
```

Benefits:
- 3 concurrent calls → 1 DB query (shared result)
- No stale data concerns (no long-lived cache, result shared only during in-flight window)
- Also reduces DB load for delta pagination (each page used to call `getValidToken` separately)

**2. DB pool increase** (`backend/src/infrastructure/database/prisma.ts`)

Increased `PrismaMssql` pool `max` from 10 to 30 to accommodate concurrent sync workers + UI queries.

### 9.4 Architectural Lesson

When BullMQ workers run concurrently against the same connection, any shared resource lookup (`getValidToken`, `findUnique` on connections) becomes a concurrency hotspot. The singleflight pattern should be applied to any singleton service method that:
- Is called from concurrent BullMQ workers
- Queries the same row by the same key
- Returns an immutable or short-lived result (like a decrypted token)
