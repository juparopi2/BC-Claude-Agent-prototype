# PRD-300: Sync Health & Recovery Service

**Status**: Complete
**Effort**: M-L
**Last Updated**: 2026-03-25

### Implementation Progress

| Component | Status | Notes |
|---|---|---|
| `health/types.ts` | **Done** | All PRD-300 types: health, reconciliation, recovery, metrics |
| `health/SyncRecoveryService.ts` | **Done** | `resetStuckScopes()`, `retryErrorScopes()`, `retryFailedFiles()`, `runFullRecovery()` |
| `health/SyncHealthCheckService.ts` | **Done** | `run()` (cron 15min), `getHealthForUser()` (API), Redis exponential backoff |
| `health/SyncReconciliationService.ts` | **Done** | `run()` (daily 04:00 UTC), dry-run default, auto-repair via env var |
| `health/index.ts` | **Done** | Barrel exports for all services + types |
| `routes/sync-health.routes.ts` | **Done** | `GET /api/sync/health` + `POST /api/sync/health/recover` with WS emit |
| `server.ts` route registration | **Done** | Mounted at `/api/sync` |
| Queue constants | **Done** | `SYNC_HEALTH_CHECK`, `SYNC_RECONCILIATION` in JOB_NAMES; `DAILY_AT_0400` in CRON_PATTERNS |
| ScheduledJobManager | **Done** | 2 new repeatable jobs in `initializeMaintenanceJobs()` |
| MaintenanceWorker | **Done** | 2 new switch cases with dynamic imports |
| `@bc-agent/shared` WS events | **Done** | `SYNC_HEALTH_REPORT`, `SYNC_RECOVERY_COMPLETED` + payload types + discriminated union |
| Frontend SocketClient + useSyncEvents | **Done** | Listeners registered, events forwarded (UI handling deferred to future PRD) |
| Redis exponential backoff | **Done** | `sync:error_retry:{scopeId}` counter + `sync:error_retry_ts:{scopeId}` timestamp, TTL 24h, fail-open |
| Unit tests: SyncRecoveryService | **Done** | 14 tests |
| Unit tests: SyncHealthCheckService | **Done** | 27 tests |
| Unit tests: SyncReconciliationService | **Done** | 20 tests |
| Unit tests: MaintenanceWorker | **Done** | 7 tests (2 new routing tests) |

**Also implemented (not in original PRD scope)**:
- **Deferred queue dispatch in `SyncFileIngestionService.ingestAll()`**: Prevents connection pool exhaustion during initial sync by completing ALL DB batch ingestion before dispatching files to the processing queue. Root cause fix for the "Unable to start a transaction" error that triggered the need for recovery.
- **EREQINPROG crash prevention**: Transaction errors from the MSSQL adapter are caught in `SyncFileIngestionService._ingestBatchCore()` and in `server.ts` `unhandledRejection` handler, preventing server crashes on transient DB errors.
- **Batch size reduced to 25** (from 50) and **transaction timeout increased to 60s** (from 30s) for Azure SQL dev tier reliability.

---

## 1. Problem Statement

The file synchronization system operates without any health monitoring at the sync level. Three concrete failure modes produce silent data loss:

1. **Stuck scopes**: A worker crash mid-sync leaves `connection_scopes.sync_status = 'syncing'` indefinitely. The polling fallback skips any scope not in `('synced', 'idle')`, so the scope is permanently excluded from future delta syncs. Users see no new files, with no error surface.

2. **Silent error accumulation**: Scopes in `sync_status = 'error'` have no automated retry path. They remain in error state until a user manually triggers re-sync (if that mechanism even exists in the UI). There is no backoff-aware retry, and no connection-validity guard before re-attempting.

3. **DB-to-Search index drift**: Files with `pipeline_status = 'ready'` in the database may not have corresponding chunk documents in Azure AI Search if the embedding pipeline crashed after the DB write. These files appear healthy in the system but return zero results in RAG queries, causing silent knowledge gaps.

Together these gaps mean users can lose access to synced content without any notification, error indicator, or automatic recovery.

---

## 2. Scope

This PRD introduces three new backend services and two API endpoints. All are integrated into the existing `FILE_MAINTENANCE` BullMQ queue (concurrency=1) following the `MaintenanceWorker` switch-case dispatch pattern. No new queues, no new workers, no schema migrations.

**In scope**:
- `SyncHealthCheckService`: scheduled every 15 minutes via `FILE_MAINTENANCE` queue
- `SyncReconciliationService`: scheduled daily at 04:00 UTC via `FILE_MAINTENANCE` queue
- `SyncRecoveryService`: called by the above services and by manual API requests
- `GET /api/sync/health`: per-user health report endpoint
- `POST /api/sync/health/recover`: manual recovery trigger endpoint
- Shared types in `backend/src/services/sync/health/types.ts`
- Two new job name constants in `queue.constants.ts`
- Two new cron pattern constants in `queue.constants.ts`
- Two new scheduled job registrations in `ScheduledJobManager.ts`
- Two new switch cases in `MaintenanceWorker.ts`
- Two new WebSocket event constants in `packages/shared/src/constants/sync-events.ts`
- Route registration in `backend/src/server.ts`

**Out of scope**:
- Frontend health dashboard UI (future PRD)
- Admin-level system-wide health reporting (requires admin auth role, future)
- Webhook rate limiting (separate concern)
- Graph API quota detection (separate concern)
- New database tables or Prisma migrations

---

## 3. Architecture Overview

### 3.1 Integration with Existing Infrastructure

PRD-300 components slot into the existing `FILE_MAINTENANCE` queue pattern:

```
ScheduledJobManager.initializeMaintenanceJobs()
  ├── stuck-file-recovery       (every 15 min) — existing
  ├── orphan-cleanup            (daily 03:00 UTC) — existing
  ├── batch-timeout             (every hour) — existing
  ├── sync-health-check   [NEW] (every 15 min, PRD-300)
  └── sync-reconciliation [NEW] (daily 04:00 UTC, PRD-300)

MaintenanceWorker.process(job)
  switch (job.name) {
    case STUCK_FILE_RECOVERY   → StuckFileRecoveryService
    case ORPHAN_CLEANUP        → OrphanCleanupService
    case BATCH_TIMEOUT         → BatchTimeoutService
    case SYNC_HEALTH_CHECK     → SyncHealthCheckService   [NEW]
    case SYNC_RECONCILIATION   → SyncReconciliationService [NEW]
  }
```

The `FILE_MAINTENANCE` queue already uses `lockDuration: LOCK_DURATION.EXTRA_LONG` (120 seconds) and `maxStalledCount: MAX_STALLED_COUNT.TOLERANT` — both appropriate for the health check operations.

### 3.2 File Layout

```
backend/src/services/sync/health/
  types.ts                    — Shared type definitions
  SyncHealthCheckService.ts   — Stuck/error scope detection + WebSocket reporting
  SyncReconciliationService.ts — DB-to-Search index reconciliation
  SyncRecoveryService.ts      — Reusable recovery actions (reset, retry, re-enqueue)
  index.ts                    — Barrel exports

backend/src/routes/
  sync-health.routes.ts       — GET /api/sync/health, POST /api/sync/health/recover
```

### 3.3 Service Interaction Diagram

```
ScheduledJobManager
  └── FILE_MAINTENANCE queue (cron)
        │
        ▼
MaintenanceWorker.process()
  ├── SYNC_HEALTH_CHECK → SyncHealthCheckService.run()
  │     ├── reads: connection_scopes (prisma)
  │     ├── reads: connections (prisma, connection.status guard)
  │     ├── reads/writes: Redis (sync:error_retry:{scopeId} counter)
  │     ├── calls: SyncRecoveryService.resetStuckScopes()
  │     ├── calls: SyncRecoveryService.retryErrorScopes()
  │     └── emits: sync:health_report (SyncProgressEmitter / SocketIO)
  │
  └── SYNC_RECONCILIATION → SyncReconciliationService.run()
        ├── reads: files (prisma, batched 500/page)
        ├── reads: VectorSearchService.getUniqueFileIds(userId)
        ├── calls [if AUTO_REPAIR=true]: SyncRecoveryService.retryFailedFiles()
        ├── calls [if AUTO_REPAIR=true]: VectorSearchService.deleteChunksForFile()
        └── logs: ReconciliationReport (structured)

HTTP Routes (authenticateMicrosoft)
  ├── GET  /api/sync/health   → SyncHealthCheckService.getHealthForUser(userId)
  └── POST /api/sync/health/recover → SyncRecoveryService (action-dispatched)
```

---

## 4. Component Specifications

### 4.1 Types (`backend/src/services/sync/health/types.ts`)

All types are defined in this file and re-exported from the barrel `index.ts`. No types cross into `@bc-agent/shared` (sync health is backend-only concern).

```typescript
// Scope-level health classification
export type SyncHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

// Issue type codes — used in structured logging and API responses
export type ScopeIssueType =
  | 'stuck_syncing'      // sync_status='syncing' for > threshold (default 10min)
  | 'error_state'        // sync_status='error'
  | 'stale_sync'         // last synced_at > 48h (scope hasn't synced recently)
  | 'high_failure_rate'; // > 50% of scope files in failed pipeline state

export type ScopeIssueSeverity = 'warning' | 'error' | 'critical';

export interface ScopeIssue {
  type: ScopeIssueType;
  severity: ScopeIssueSeverity;
  message: string;
  detectedAt: Date;
}

export interface ScopeFileStats {
  total: number;
  ready: number;
  failed: number;
  processing: number;
  queued: number;
}

export interface ScopeHealthReport {
  scopeId: string;
  connectionId: string;
  userId: string;
  scopeName: string;
  syncStatus: string;    // raw DB value
  healthStatus: SyncHealthStatus;
  issues: ScopeIssue[];
  fileStats: ScopeFileStats;
  lastSyncedAt: Date | null;
  checkedAt: Date;
}

export interface SyncHealthReport {
  timestamp: Date;
  overallStatus: SyncHealthStatus;
  summary: {
    totalScopes: number;
    healthyScopes: number;
    degradedScopes: number;
    unhealthyScopes: number;
  };
  scopes: ScopeHealthReport[];
}

export interface ReconciliationRepairs {
  missingRequeued: number;
  orphansDeleted: number;
  errors: number;
}

export interface ReconciliationReport {
  timestamp: Date;
  userId: string;
  dbReadyFiles: number;
  searchIndexedFiles: number;
  missingFromSearch: string[];   // fileIds in DB ready but not in index
  orphanedInSearch: string[];    // fileIds in index but not in DB
  repairs: ReconciliationRepairs;
  dryRun: boolean;
}

export interface RecoveryResult {
  scopesReset: number;
  scopesRequeued: number;
  filesRequeued: number;
  errors: string[];
}

// Metrics emitted to structured logs after each health check run
export interface SyncHealthCheckMetrics {
  scopesChecked: number;
  stuckSyncingDetected: number;
  stuckSyncingReset: number;
  errorScopesDetected: number;
  errorScopesRetried: number;
  errorScopesSkippedExpiredConnection: number;
  errorScopesBackoffDeferred: number;
  durationMs: number;
}
```

---

### 4.2 SyncHealthCheckService (`backend/src/services/sync/health/SyncHealthCheckService.ts`)

**Singleton** with `createChildLogger({ service: 'SyncHealthCheckService' })`.

#### 4.2.1 Purpose

Runs on the `SYNC_HEALTH_CHECK` scheduled job every 15 minutes. Detects two failure conditions and delegates remediation to `SyncRecoveryService`. Emits a `sync:health_report` WebSocket event to affected users. Provides `getHealthForUser(userId)` for the API endpoint.

#### 4.2.2 `run(): Promise<SyncHealthCheckMetrics>`

The main entry point called by `MaintenanceWorker`. Returns structured metrics for job-level logging.

**Algorithm**:

1. Record `startTime = Date.now()`.
2. Query all non-deleted `connection_scopes` rows (joined to `connections` for `connection.status`). Use `prisma.connection_scopes.findMany()`.
3. Initialize metrics with all counters at zero.
4. For each scope, call the private `inspectScope()` method (try-catch per scope — one failure must not abort the run).
5. Collect scopes to reset (stuck syncing) and scopes to retry (error state).
6. Delegate to `SyncRecoveryService.resetStuckScopes(scopeIds)` for stuck scopes.
7. Delegate to `SyncRecoveryService.retryErrorScopes(scopeIds)` for error scopes where backoff allows.
8. Emit `sync:health_report` via `getSocketIO()` to each affected `user:{userId}` room (guard with `isSocketServiceInitialized()`).
9. Set `metrics.durationMs = Date.now() - startTime`.
10. Return metrics.

**Stuck-syncing detection**:
- Threshold: `updated_at < NOW() - 10 minutes` (configurable default; exposed as optional constructor param for testability)
- Issue type: `stuck_syncing`, severity: `critical`
- Guard: do NOT reset if the connection itself is `'expired'` or `'disconnected'` (log and count as skipped)

**Error-state detection**:
- Issue type: `error_state`, severity: `error`
- Guard: skip retry if `connection.status IN ('expired', 'disconnected')` — count as `errorScopesSkippedExpiredConnection`
- Backoff logic: see section 4.2.3

**WebSocket payload** (`sync:health_report` event):
```typescript
{
  userId: string;
  report: SyncHealthReport;  // filtered to that user's scopes only
}
```

#### 4.2.3 Exponential Backoff via Redis

Redis key: `sync:error_retry:{scopeId}` (string, integer counter, TTL 24 hours)

Backoff schedule (retry attempt → minimum delay before next retry):
| Attempt | Min Wait |
|---------|----------|
| 0       | Retry immediately (first time seeing error) |
| 1       | 15 minutes |
| 2       | 30 minutes |
| 3       | 1 hour |
| 4       | 2 hours |
| >= 5    | Stop (do not retry until counter expires) |

**On each health check run, per error-scope**:
1. `INCR sync:error_retry:{scopeId}` → `attemptCount`. Set TTL to 86400s if key is new.
2. If `attemptCount >= 5`: skip, log `'Max retries reached, scope will not be retried until TTL expires'`, increment `errorScopesBackoffDeferred`.
3. Compute time since last retry: `GET sync:error_retry_ts:{scopeId}` (timestamp of last attempt).
4. If not enough time has elapsed per the schedule: skip, increment `errorScopesBackoffDeferred`.
5. Otherwise: include in retry list, update `sync:error_retry_ts:{scopeId}` to `Date.now()`.

**On successful sync** (called from `DeltaSyncService` on completion — future integration point, noted as TODO in code): delete `sync:error_retry:{scopeId}` to reset backoff.

#### 4.2.4 `getHealthForUser(userId: string): Promise<SyncHealthReport>`

Called by the API endpoint. Reads all scopes for the user and computes a fresh `SyncHealthReport` (not from cache — the API path is user-initiated). Uses the same `inspectScope()` logic but does not trigger any remediation.

#### 4.2.5 Per-Scope Isolation

Each `inspectScope()` call is wrapped in `try/catch`. On error, log `{ scopeId, error: errorInfo }` at warn level and continue. This ensures one corrupt scope row does not abort the entire health check batch.

---

### 4.3 SyncReconciliationService (`backend/src/services/sync/health/SyncReconciliationService.ts`)

**Singleton** with `createChildLogger({ service: 'SyncReconciliationService' })`.

#### 4.3.1 Purpose

Runs daily at 04:00 UTC on the `SYNC_RECONCILIATION` scheduled job. Compares the set of files marked `pipeline_status = 'ready'` in the database against the set of fileIds present in Azure AI Search. Detects and optionally repairs two classes of drift:

- **Missing from search**: File is ready in DB but has no chunks in the search index (embedding pipeline crashed after the DB write).
- **Orphaned in search**: FileId exists in search index but has no corresponding DB row (file was deleted from DB but search cleanup failed).

#### 4.3.2 `run(): Promise<ReconciliationReport[]>`

Returns one `ReconciliationReport` per user processed. The service processes a maximum of 50 users per run to bound execution time.

**Algorithm**:

1. Query distinct `user_id` values from `files` where `pipeline_status = 'ready'` and `deleted_at IS NULL`, ordered by `user_id`, limit 50.
2. For each user (sequential, not concurrent — to avoid overwhelming the search service):
   a. Query all `files.id` where `pipeline_status = 'ready'` and `user_id = userId` and `deleted_at IS NULL`. Paginate in batches of 500 using `skip/take`.
   b. Call `VectorSearchService.getInstance().getUniqueFileIds(userId)` to get the search-indexed set.
   c. Compute: `missingFromSearch = dbReadyFileIds - searchIndexedFileIds`, `orphanedInSearch = searchIndexedFileIds - dbReadyFileIds`.
   d. Log the `ReconciliationReport` fields (counts, lists) as structured data at `info` level (for operational dashboards).
   e. If `process.env.SYNC_RECONCILIATION_AUTO_REPAIR === 'true'`: call `performRepairs(userId, missingFromSearch, orphanedInSearch)`.
   f. Append the report to the results array.
3. Return all reports.

#### 4.3.3 `performRepairs(userId, missingFromSearch, orphanedInSearch)`

- **Missing from search**: Call `getMessageQueue().addFileProcessingFlow(fileId, userId)` for each missing fileId. Also reset `pipeline_status = 'queued'` in DB so the processing pipeline re-runs. Wrapped per-file in try-catch.
- **Orphaned in search**: Call `VectorSearchService.getInstance().deleteChunksForFile(fileId, userId)` for each orphaned fileId. Wrapped per-file in try-catch.
- Track `repairs.missingRequeued`, `repairs.orphansDeleted`, `repairs.errors` counts.

#### 4.3.4 Dry-Run Behavior

When `SYNC_RECONCILIATION_AUTO_REPAIR` is absent or `'false'` (the default), the service completes the comparison and logs findings but takes no repair action. Reports include `dryRun: true`. This is the correct default for first deployment, allowing operators to review drift before enabling auto-repair.

#### 4.3.5 Per-User Isolation

Each user's reconciliation is wrapped in `try/catch`. A failure for one user is logged at `warn` level and processing continues with the next user.

---

### 4.4 SyncRecoveryService (`backend/src/services/sync/health/SyncRecoveryService.ts`)

**Singleton** with `createChildLogger({ service: 'SyncRecoveryService' })`.

This service provides the atomic recovery actions consumed by `SyncHealthCheckService` (scheduled), `SyncReconciliationService` (scheduled), and the `POST /api/sync/health/recover` API endpoint (manual).

#### 4.4.1 `resetStuckScopes(scopeIds?: string[], thresholdMs?: number): Promise<RecoveryResult>`

Resets scopes stuck in `syncing` state back to `idle`.

- If `scopeIds` provided: reset only those specific scopes.
- If `scopeIds` omitted: query all scopes where `sync_status = 'syncing'` and `updated_at < NOW() - thresholdMs` (default: 600000ms / 10 minutes).
- For each qualifying scope, verify `connection.status = 'connected'` before resetting.
- Update: `prisma.connection_scopes.update({ data: { sync_status: 'idle', updated_at: new Date() } })`.
- Log each reset at `info` level: `{ scopeId, previousStatus: 'syncing', newStatus: 'idle' }`.
- Per-scope try-catch; count errors in `result.errors`.

#### 4.4.2 `retryErrorScopes(scopeIds?: string[]): Promise<RecoveryResult>`

Re-enqueues delta sync for error scopes.

- If `scopeIds` provided: process those scopes.
- If `scopeIds` omitted: query all scopes where `sync_status = 'error'`.
- For each scope:
  1. Verify `connection.status = 'connected'`. Skip (log, count) if not.
  2. Update `sync_status = 'idle'` in DB.
  3. Call `getMessageQueue().addExternalFileSyncJob({ scopeId, userId, connectionId, triggerType: 'manual' })`.
- Per-scope try-catch; count errors in `result.errors`.
- Returns `RecoveryResult` with `scopesRequeued` count.

#### 4.4.3 `retryFailedFiles(scopeId: string, userId: string): Promise<RecoveryResult>`

Re-enqueues files from a specific scope that have failed processing.

- Query `files` where `scope_id = scopeId` and `user_id = userId` and `pipeline_status = 'failed'` and `pipeline_retry_count < 3` (max retry constant).
- For each file:
  1. Increment `pipeline_retry_count`.
  2. Update `pipeline_status = 'queued'`.
  3. Call `getMessageQueue().addFileProcessingFlow(fileId, userId)`.
- Files where `pipeline_retry_count >= 3` are skipped and logged at `warn` level — they require manual intervention.
- Per-file try-catch; count errors in `result.errors`.
- Returns `RecoveryResult` with `filesRequeued` count.

#### 4.4.4 `runFullRecovery(userId?: string): Promise<RecoveryResult>`

Orchestrates all three operations in sequence. If `userId` provided, scoped to that user's data only. Called by `POST /api/sync/health/recover` with action `'full_recovery'`. Aggregates results across all three sub-operations.

---

### 4.5 API Endpoints (`backend/src/routes/sync-health.routes.ts`)

Both routes use `authenticateMicrosoft` middleware (same pattern as `connections.routes.ts`). Route file exports an Express `Router`.

#### 4.5.1 `GET /api/sync/health`

Returns a `SyncHealthReport` for the authenticated user's scopes.

**Request**: `GET /api/sync/health` (no body, no query params)

**Response `200`**:
```typescript
{
  timestamp: string;        // ISO 8601
  overallStatus: SyncHealthStatus;
  summary: {
    totalScopes: number;
    healthyScopes: number;
    degradedScopes: number;
    unhealthyScopes: number;
  };
  scopes: Array<{
    scopeId: string;
    connectionId: string;
    scopeName: string;
    syncStatus: string;
    healthStatus: SyncHealthStatus;
    issues: ScopeIssue[];
    fileStats: ScopeFileStats;
    lastSyncedAt: string | null;
    checkedAt: string;
  }>;
}
```

**Response `500`**: `{ error: 'Failed to retrieve sync health report' }` — error details logged server-side.

**Implementation**: delegates to `getSyncHealthCheckService().getHealthForUser(req.userId)`. The `userId` is obtained from the authenticated session (same pattern as other authenticated routes).

**Performance target**: < 2 seconds (DB read + simple computation, no external API calls).

#### 4.5.2 `POST /api/sync/health/recover`

Triggers manual recovery for a specific action type.

**Request body**:
```typescript
{
  action: 'reset_stuck' | 'retry_errors' | 'retry_files' | 'full_recovery';
  scopeId?: string;   // required for 'retry_files', optional filter for others
}
```

**Scope ownership validation**: If `scopeId` is provided, verify that the scope belongs to `req.userId` before proceeding. Return `403 Forbidden` if ownership check fails. This guard is mandatory for multi-tenant isolation.

**Action dispatch**:
- `reset_stuck`: calls `getSyncRecoveryService().resetStuckScopes(scopeId ? [scopeId] : undefined)`
- `retry_errors`: calls `getSyncRecoveryService().retryErrorScopes(scopeId ? [scopeId] : undefined)`
- `retry_files`: requires `scopeId`. Calls `getSyncRecoveryService().retryFailedFiles(scopeId, req.userId)`
- `full_recovery`: calls `getSyncRecoveryService().runFullRecovery(req.userId)`

**Response `200`**:
```typescript
{
  success: true;
  result: RecoveryResult;
}
```

**Response `400`**: Invalid `action` value or missing `scopeId` when required.
**Response `403`**: `scopeId` does not belong to the authenticated user.
**Response `500`**: Unexpected error (logged server-side).

---

## 5. Constants & Configuration Changes

### 5.1 `backend/src/infrastructure/queue/constants/queue.constants.ts`

Add to `JOB_NAMES.FILE_MAINTENANCE`:
```typescript
FILE_MAINTENANCE: {
  STUCK_FILE_RECOVERY: 'stuck-file-recovery',   // existing
  ORPHAN_CLEANUP: 'orphan-cleanup',             // existing
  BATCH_TIMEOUT: 'batch-timeout',               // existing
  SYNC_HEALTH_CHECK: 'sync-health-check',       // NEW — PRD-300
  SYNC_RECONCILIATION: 'sync-reconciliation',   // NEW — PRD-300
}
```

Add to `CRON_PATTERNS`:
```typescript
/** Every day at 04:00 UTC (sync reconciliation) */
DAILY_AT_0400: '0 4 * * *',   // NEW — PRD-300
```

Note: `EVERY_15_MIN` (`'*/15 * * * *'`) already exists and is reused for `SYNC_HEALTH_CHECK`.

### 5.2 `backend/src/infrastructure/queue/core/ScheduledJobManager.ts`

Add calls within `initializeMaintenanceJobs()` after the existing three jobs:

```typescript
// Sync health check (every 15 minutes) — PRD-300
await queue.add(
  JOB_NAMES.FILE_MAINTENANCE.SYNC_HEALTH_CHECK,
  { type: 'sync-health-check' },
  {
    repeat: { pattern: CRON_PATTERNS.EVERY_15_MIN },
    jobId: JOB_NAMES.FILE_MAINTENANCE.SYNC_HEALTH_CHECK,
  }
);

// Sync reconciliation (daily at 04:00 UTC) — PRD-300
await queue.add(
  JOB_NAMES.FILE_MAINTENANCE.SYNC_RECONCILIATION,
  { type: 'sync-reconciliation' },
  {
    repeat: { pattern: CRON_PATTERNS.DAILY_AT_0400 },
    jobId: JOB_NAMES.FILE_MAINTENANCE.SYNC_RECONCILIATION,
  }
);
```

Update the `jobs` array in the `log.info` call to include the two new job names.

### 5.3 `backend/src/infrastructure/queue/workers/MaintenanceWorker.ts`

Add two cases to the `switch (jobName)` block:

```typescript
case JOB_NAMES.FILE_MAINTENANCE.SYNC_HEALTH_CHECK: {
  const { getSyncHealthCheckService } = await import(
    '@/services/sync/health/SyncHealthCheckService'
  );
  const service = getSyncHealthCheckService();
  const metrics = await service.run();
  jobLog.info({ metrics }, 'Sync health check completed');
  break;
}

case JOB_NAMES.FILE_MAINTENANCE.SYNC_RECONCILIATION: {
  const { getSyncReconciliationService } = await import(
    '@/services/sync/health/SyncReconciliationService'
  );
  const service = getSyncReconciliationService();
  const reports = await service.run();
  jobLog.info({ reportCount: reports.length }, 'Sync reconciliation completed');
  break;
}
```

Update the JSDoc block comment at the top of `MaintenanceWorker.ts` to list the two new job names.

### 5.4 `packages/shared/src/constants/sync-events.ts`

Add two new event names to `SYNC_WS_EVENTS`:

```typescript
SYNC_HEALTH_REPORT: 'sync:health_report',         // NEW — PRD-300
SYNC_RECOVERY_COMPLETED: 'sync:recovery_completed', // NEW — PRD-300
```

### 5.5 `backend/src/server.ts`

Add import and route registration following the existing pattern for other sync-adjacent routes (near `webhookRoutes`):

```typescript
import syncHealthRoutes from './routes/sync-health.routes';
// ...
app.use('/api/sync', syncHealthRoutes);
```

---

## 6. Environment Variables

| Variable | Default | Type | Description |
|---|---|---|---|
| `SYNC_RECONCILIATION_AUTO_REPAIR` | `'false'` | `'true' \| 'false'` | Enable auto-repair during reconciliation. Default is dry-run. |
| `SYNC_HEALTH_STUCK_THRESHOLD_MS` | `600000` | number (ms) | How long a scope must be stuck in 'syncing' before it is reset. Default: 10 minutes. |

Both variables are read at service instantiation time (not cached at module load), allowing runtime changes without restart (within the polling interval).

---

## 7. Error Handling Strategy

| Layer | Strategy |
|---|---|
| Per-scope (health check) | try-catch per `inspectScope()` call; log warning; continue |
| Per-user (reconciliation) | try-catch per user loop iteration; log warning; continue |
| Per-file (recovery) | try-catch per file action; log warning; increment error count |
| Redis backoff | On Redis error: log warning, fall back to "allow retry" (fail safe — better to retry than to silently stop) |
| Connection guard | Check `connection.status` before every retry action; skip with explicit log entry if not 'connected' |
| Reconciliation repairs | Auto-repair errors do not fail the reconciliation run; counted in `repairs.errors` |
| API endpoint | 500 response with generic message; detailed error logged server-side with `errorInfo` serialization pattern |

**Error serialization** follows project conventions from `.claude/rules/gotchas.md`:
```typescript
const errorInfo = error instanceof Error
  ? { message: error.message, stack: error.stack, name: error.name }
  : { value: String(error) };
logger.warn({ error: errorInfo, scopeId }, 'Health check failed for scope');
```

---

## 8. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Health check total duration | < 120 seconds (within `LOCK_DURATION.EXTRA_LONG`) |
| API response latency | < 2 seconds for `GET /api/sync/health` |
| Reconciliation max users per run | 50 (prevents runaway job duration) |
| Reconciliation batch size | 500 files/query (prevents OOM on large accounts) |
| Redis backoff key TTL | 24 hours (auto-expiry clears stuck counters) |
| Max retry attempts per scope | 5 within 24 hours, then stop until TTL expires |
| DB query impact | Read-heavy (health check, reconciliation); write is targeted single-row updates |
| Normal sync interference | Zero — health services use separate DB queries; no locking conflicts with sync workers |

---

## 9. Files to Create

| File | Description |
|---|---|
| `backend/src/services/sync/health/types.ts` | All shared type definitions |
| `backend/src/services/sync/health/SyncHealthCheckService.ts` | Scheduled health check + per-user API query |
| `backend/src/services/sync/health/SyncReconciliationService.ts` | Daily DB-to-Search index comparison |
| `backend/src/services/sync/health/SyncRecoveryService.ts` | Atomic recovery actions |
| `backend/src/services/sync/health/index.ts` | Barrel exports for all health module exports |
| `backend/src/routes/sync-health.routes.ts` | Express router for health endpoints |

---

## 10. Files to Modify

| File | Change |
|---|---|
| `backend/src/infrastructure/queue/constants/queue.constants.ts` | Add `SYNC_HEALTH_CHECK`, `SYNC_RECONCILIATION` to `JOB_NAMES.FILE_MAINTENANCE`; add `DAILY_AT_0400` to `CRON_PATTERNS` |
| `backend/src/infrastructure/queue/core/ScheduledJobManager.ts` | Register 2 new repeatable jobs in `initializeMaintenanceJobs()` |
| `backend/src/infrastructure/queue/workers/MaintenanceWorker.ts` | Add 2 switch cases; update JSDoc header |
| `backend/src/server.ts` | Import and register `sync-health.routes.ts` under `/api/sync` |
| `packages/shared/src/constants/sync-events.ts` | Add `SYNC_HEALTH_REPORT` and `SYNC_RECOVERY_COMPLETED` constants |

---

## 11. Testing Requirements

Unit tests are required for all three service classes. Integration tests are not required (no new DB schema or migration).

### 11.1 SyncHealthCheckService Tests

Location: `backend/src/__tests__/unit/services/sync/health/SyncHealthCheckService.test.ts`

- `run()` resets scopes stuck in syncing state
- `run()` skips stuck scopes on expired/disconnected connections
- `run()` retries error scopes respecting backoff schedule
- `run()` stops retrying error scopes after 5 attempts
- `run()` emits `sync:health_report` WebSocket event
- `run()` is per-scope isolated (one scope error does not abort run)
- `getHealthForUser(userId)` returns scopes filtered to that user only
- `getHealthForUser(userId)` correctly classifies health statuses

### 11.2 SyncReconciliationService Tests

Location: `backend/src/__tests__/unit/services/sync/health/SyncReconciliationService.test.ts`

- `run()` correctly identifies missing-from-search files
- `run()` correctly identifies orphaned-in-search files
- `run()` does NOT perform repairs when `SYNC_RECONCILIATION_AUTO_REPAIR=false`
- `run()` DOES perform repairs when `SYNC_RECONCILIATION_AUTO_REPAIR=true`
- `run()` limits to 50 users per execution
- `run()` paginates DB queries in batches of 500
- Per-user isolation: one user error does not abort processing of remaining users

### 11.3 SyncRecoveryService Tests

Location: `backend/src/__tests__/unit/services/sync/health/SyncRecoveryService.test.ts`

- `resetStuckScopes()` updates `sync_status` to `'idle'`
- `resetStuckScopes()` skips scopes on disconnected connections
- `retryErrorScopes()` updates status and enqueues delta sync
- `retryErrorScopes()` skips scopes on expired connections
- `retryFailedFiles()` increments retry count and re-enqueues
- `retryFailedFiles()` skips files at max retry count (3)
- `runFullRecovery()` aggregates results from all three operations

### 11.4 API Route Tests

Location: `backend/src/__tests__/unit/routes/sync-health.routes.test.ts`

- `GET /api/sync/health` requires authentication (401 without token)
- `GET /api/sync/health` returns `SyncHealthReport` for authenticated user
- `POST /api/sync/health/recover` rejects unknown action with 400
- `POST /api/sync/health/recover` with `retry_files` and no `scopeId` returns 400
- `POST /api/sync/health/recover` with `scopeId` belonging to another user returns 403
- `POST /api/sync/health/recover` returns 200 with `RecoveryResult` on success

---

## 12. Success Criteria

- [x] Scopes stuck in `sync_status = 'syncing'` for more than 10 minutes are automatically reset to `'idle'` within the next 15-minute health check window.
- [x] Error scopes are retried with exponential backoff: 15 min, 30 min, 1 h, 2 h, then stopped for the remainder of the 24-hour Redis TTL window.
- [x] Connection expiry/disconnection prevents retry attempts (no wasted delta sync jobs on dead connections).
- [x] `GET /api/sync/health` returns accurate per-scope health status within 2 seconds.
- [x] `POST /api/sync/health/recover` triggers manual recovery scoped to the authenticated user's data only.
- [x] Daily reconciliation detects and logs DB-to-Search index discrepancies in dry-run mode by default.
- [x] All health check and reconciliation operations complete within the 120-second `LOCK_DURATION.EXTRA_LONG` window.
- [x] Normal sync operations (`DeltaSyncService`, `InitialSyncService`) show no regression.
- [x] Unit tests pass: SyncRecoveryService (14), SyncHealthCheckService (27), SyncReconciliationService (20), MaintenanceWorker (7), SyncFileIngestionService (25).
- [x] TypeScript type-check passes (`npm run verify:types`).
- [x] Backend lint passes (`npm run -w backend lint`).
- [x] Frontend lint passes (`npm run -w bc-agent-frontend lint`).

---

## 13. Out of Scope

- **Frontend health dashboard UI**: A UI surface for surfacing `SyncHealthReport` data is a future PRD. The API endpoints provide the data layer for when that is built.
- **Admin-level system-wide health reporting**: Aggregate health across all users would require an admin auth role check (not yet implemented). Future PRD.
- **Webhook rate limiting**: Separate operational concern, tracked separately.
- **Graph API quota detection**: Detecting Microsoft Graph throttling is a separate concern; health check only monitors scope sync statuses, not API call budgets.
- **Backoff state UI**: The Redis backoff counter is an internal recovery mechanism. The API health report surfaces the issue (scope in error state) but not the retry countdown.
- **Alerting integrations**: Structured logs from health check runs feed into Azure Application Insights automatically via the existing pino instrumentation. Alert rules on those logs are an infrastructure/ops concern outside this PRD.

---

## 14. Implementation Notes

### 14.1 Singleton Pattern

All three services follow the project singleton pattern used by `StuckFileRecoveryService`, `OrphanCleanupService`, and `BatchTimeoutService`:

```typescript
let instance: SyncHealthCheckService | undefined;

export function getSyncHealthCheckService(): SyncHealthCheckService {
  if (!instance) {
    instance = new SyncHealthCheckService();
  }
  return instance;
}

export function __resetSyncHealthCheckService(): void {
  instance = undefined;
}
```

The `__reset*` export is for test isolation only (clears singleton between tests).

### 14.2 Dynamic Import in MaintenanceWorker

The `MaintenanceWorker` uses dynamic `import()` inside each switch case (same pattern as existing cases) to avoid loading all services at startup. This is intentional — these services import Prisma, Redis, and SocketIO, and lazy loading improves startup time.

### 14.3 UUID Casing

File IDs and scope IDs use uppercase UUIDs per project convention. When comparing fileIds between the DB result set and `VectorSearchService.getUniqueFileIds()`, normalize both sides to uppercase before set comparison.

### 14.4 No Logic in Route Handlers

The route handlers in `sync-health.routes.ts` validate input (action, scopeId ownership) and delegate immediately to the service layer. No business logic belongs in the route file.

### 14.5 Reconciliation Sequencing

The reconciliation service processes users sequentially (not in parallel) to avoid issuing concurrent `getUniqueFileIds()` calls to Azure AI Search. The search service has no documented per-app rate limit, but concurrent large fan-out queries risk throttling. Sequential processing with a 50-user cap bounds worst-case runtime to approximately `50 × (DB query time + Search API time)` — estimated under 60 seconds in production.

### 14.6 Redis Dependency

The backoff counter logic in `SyncHealthCheckService` requires Redis (via `getRedisClient()`). If Redis is unavailable, log the error and treat the scope as "allow retry" (fail-open). This is the safer default: it may cause a premature retry, but will not cause a scope to be silently blocked from recovery.
