# Sync Health & Recovery (PRD-300 + PRD-304)

## Purpose

Automated health monitoring and recovery for the file synchronization pipeline. Detects eight drift conditions and provides both automated remediation (cron) and manual recovery (API). The system uses a **Detector/Repairer** modular architecture for testability and extensibility.

## Architecture

### Services (3 Stateless Singletons)

| Service | Schedule | Responsibility |
|---|---|---|
| `SyncHealthCheckService` | Every 15 min (cron) | Inspect all scopes, detect stuck/error states, delegate recovery, emit WS health reports. Also serves `GET /api/sync/health`. |
| `SyncReconciliationService` | Every hour (cron, 24x/day) + on-demand per-user | **Orchestrator**: runs 11 detectors → 5 repairers. Cron checks all users with non-deleted files; respects `SYNC_RECONCILIATION_AUTO_REPAIR`; on-demand always repairs. Auto-triggered on Socket.IO `user:join` (login/refresh). |
| `SyncRecoveryService` | On-demand | Atomic recovery actions: reset stuck scopes, retry error scopes, re-enqueue failed files. Consumed by health check, reconciliation, and manual API. |

### Detector/Repairer Pattern (PRD-304)

Detection and repair are decoupled into independent modules under `detectors/` and `repairers/`:

```
health/
  SyncReconciliationService.ts  — Orchestrator (~250 lines)
  SyncHealthCheckService.ts     — Scope health + recovery delegation
  SyncRecoveryService.ts        — Atomic recovery actions
  detectors/
    types.ts                    — DriftDetector<T> interface
    SearchIndexComparator.ts    — Shared: paginated DB vs Search comparison
    MissingFromSearchDetector.ts
    OrphanedInSearchDetector.ts
    FailedRetriableDetector.ts
    StuckPipelineDetector.ts
    ExternalNotFoundDetector.ts
    ImageEmbeddingDetector.ts
    FolderHierarchyDetector.ts
    DisconnectedFilesDetector.ts
    ReadyWithoutChunksDetector.ts — Ready non-image files with 0 file_chunks
    StaleSearchMetadataDetector.ts — AI Search metadata mismatch vs DB
    StuckDeletionDetector.ts    — Files stuck in deletion_status='pending' > 1h
  repairers/
    FileRequeueRepairer.ts      — Re-enqueue files (missing, failed, stuck, images, no-chunks, stale-metadata) + adjust scope counters (PRD-305)
    StuckDeletionRepairer.ts    — Hierarchical truth: resurrect or hard-delete stuck deletions
    OrphanCleanupRepairer.ts    — Delete orphaned search docs
    ExternalFileCleanupRepairer.ts — Soft-delete 404 + disconnected files
    FolderHierarchyRepairer.ts  — Restore scope roots, queue resyncs, reparent
  types.ts                      — All type definitions
  index.ts                      — Barrel exports
```

Each detector implements `DriftDetector<T>` with a `detect(userId)` method.
Each repairer has specific repair methods for its domain.
The orchestrator instantiates detectors/repairers per-run (stateless, no singletons needed).

### Auto-Reconciliation on Login

When a user connects via Socket.IO (`user:join`), the server fires a reconciliation request (`reconcileUserOnDemand`). This respects the 5-min Redis cooldown, so rapid reconnects don't spam. The frontend `useSyncEvents` handler listens for `sync:reconciliation_completed` and invalidates the folder tree cache when repairs are made.

### Healthy File State (Single Source of Truth)

`@bc-agent/shared` exports `HEALTHY_FILE_STATES` — a complete matrix defining what a healthy file looks like per type:

| File Type | Blob | Chunks | Image Emb | Search Docs |
|-----------|------|--------|-----------|-------------|
| Local text | required | >=1 | no | >=1 |
| Local image | required | 0 | yes (1) | 1 |
| Cloud text | null | >=1 | no | >=1 |
| Cloud image | null | 0 | yes (1) | 1 |
| Folder | null | 0 | no | 0 |

Use `getExpectedHealthState(file)` and `validateFileHealth(file, resources)` for validation.

All three run via the existing `FILE_MAINTENANCE` BullMQ queue (`concurrency=1`, `lockDuration=120s`). No new queues or workers — they slot into `MaintenanceWorker`'s switch-case dispatch.

## Integration Points

```
ScheduledJobManager.initializeMaintenanceJobs()
  ├── stuck-file-recovery       (every 15 min) — existing
  ├── orphan-cleanup            (daily 03:00)  — existing
  ├── batch-timeout             (every hour)   — existing
  ├── sync-health-check         (every 15 min) — PRD-300
  └── sync-reconciliation       (daily 04:00)  — PRD-300

MaintenanceWorker.process(job)
  switch (job.name) → dynamic import → service.run()
```

## Health Classification

Each scope is inspected and classified into one of three statuses:

| Status | Condition | Issue Severities |
|---|---|---|
| `healthy` | No issues detected | — |
| `degraded` | Only `warning` issues | `stale_sync` |
| `unhealthy` | Any `critical` or `error` issue | `stuck_syncing`, `stuck_sync_queued`, `error_state`, `high_failure_rate` |

### Issue Types

| Type | Severity | Detection |
|---|---|---|
| `stuck_syncing` | critical | `sync_status='syncing'` AND `updated_at` > 10 min ago |
| `stuck_sync_queued` | critical | `sync_status='sync_queued'` AND `updated_at` > 1 hour ago |
| `error_state` | error | `sync_status='error'` |
| `stale_sync` | warning | `last_sync_at` is null or > 48 hours ago |
| `high_failure_rate` | error | > 50% of scope files have `pipeline_status='failed'` |

## Redis Exponential Backoff

Error scopes are not retried infinitely. Two Redis keys per scope:

- `sync:error_retry:{scopeId}` — attempt counter (integer, TTL 24h)
- `sync:error_retry_ts:{scopeId}` — last attempt timestamp (ms, TTL 24h)

| Attempt | Min Wait |
|---------|----------|
| 1 | Immediate |
| 2 | 15 minutes |
| 3 | 30 minutes |
| 4 | 1 hour |
| 5 | 2 hours |
| > 5 | Stop until TTL expires |

**Fail-open**: If Redis is unavailable, the scope IS retried (better to retry than silently block recovery).

## DB-to-Search Reconciliation

Detects eleven drift conditions:

| Drift | Detection | Repair Action |
|---|---|---|
| Missing from search | `pipeline_status='ready'` but no chunks in AI Search index | Reset to `'queued'`, re-enqueue processing |
| Orphaned in search | Chunks exist in index but no matching DB file row | Delete chunks via `VectorSearchService` |
| Failed retriable | `pipeline_status='failed'` with `pipeline_retry_count < 3` | Reset to `'queued'`, clear retry count, re-enqueue |
| Stuck pipeline | `pipeline_status IN ('extracting','chunking','embedding')` for > 30 min | Reset to `'queued'`, re-enqueue |
| Images missing embeddings | Ready image files with no `image_embeddings` record | Reset to `'queued'`, re-enqueue |
| External not found | External files (SP/OD) failed with `Graph API error (404)` | Soft-delete + vector cleanup (file no longer exists in source) |
| Broken folder hierarchy | Files/folders with `parent_folder_id` referencing non-existent folder, or scope root folders missing from DB | Recreate scope roots via `ensureScopeRootFolder()`, queue full resync (clears delta cursor), reparent local orphans to root |
| Disconnected connection files | Files with `connection_id` pointing to a `disconnected`/`expired` connection, or a connection that was hard-deleted | Soft-delete + vector cleanup (files are inaccessible, Graph API will fail) |
| Ready without chunks | `pipeline_status='ready'` AND `file_chunks` count = 0 (non-image files only) | Reset to `'queued'`, re-enqueue — pipeline will re-extract, chunk, and index |
| Stale search metadata | AI Search `sourceType`/`parentFolderId` differs from DB `source_type`/`parent_folder_id` | Reset to `'queued'`, re-enqueue — pipeline reads fresh metadata from `FileRepository.getFileWithScopeMetadata()` |
| Stuck deletions | Two-path: (1) `deletion_status='pending'` on connected+synced scopes → **immediate** (no threshold); (2) all other `deletion_status='pending'` → after 1h | **Hierarchical truth**: if connection connected → RESURRECT (clear deletion, re-queue); if connection dead → HARD-DELETE directly |

**Cron: dry-run by default**. Set `SYNC_RECONCILIATION_AUTO_REPAIR=true` to enable mutations. Cron checks all users with non-deleted files (not just ready). On-demand always repairs. Processes max 50 users per cron run, paginates DB queries in batches of 500.

### Stuck Deletion Two-Path Strategy

The StuckDeletionDetector uses a two-path OR query to handle disconnect/reconnect race conditions:

1. **Fast path** (no time threshold) — files with `deletion_status='pending'` on scopes where `connection.status='connected'` AND `sync_status NOT IN ('error')`. These were soft-deleted during a disconnect/reconnect race but the scope is now active. The delta cursor won't re-deliver unchanged files, so without this path they'd remain stuck indefinitely.

2. **Slow path** (1-hour threshold) — all other stuck deletions (disconnected, expired, no scope, or error scopes). The 1-hour delay gives the `FileDeletionWorker` time to complete legitimate cleanup.

The StuckDeletionRepairer applies **hierarchical truth**: resurrect if connection is `'connected'`, hard-delete otherwise.

### Defensive Guards (Cross-Detector)

All detectors that query for active/ready files include these defensive guards:

- **`deletion_status: null`** — prevents re-queueing files that are marked for deletion. Applied in: StuckPipelineDetector, FailedRetriableDetector, ImageEmbeddingDetector, ReadyWithoutChunksDetector, StaleSearchMetadataDetector.
- **`is_folder: false`** — excludes folders from search-based comparisons (folders have `pipeline_status='ready'` but no search docs by design). Applied in: SearchIndexComparator (affects MissingFromSearch + OrphanedInSearch), ReadyWithoutChunksDetector, StaleSearchMetadataDetector.
- **Transient sync guard** — excludes files in scopes with `sync_status IN ('syncing', 'sync_queued')` to avoid false positives during active sync. Applied in: StuckPipelineDetector, FailedRetriableDetector, FolderHierarchyDetector (orphan detection).

### External File Deletion Detection

When SharePoint/OneDrive files are deleted or moved externally, the delta sync normally detects them via the `deleted` facet. However, if delta sync misses a deletion (stale cursor, webhook failure), the file processing pipeline will fail with `Graph API error (404)`. After retries are exhausted, these files become permanently failed.

The reconciliation service detects these by matching `last_processing_error` containing `'Graph API error (404)'`, `'itemNotFound'`, or `'resource could not be found'` for files with `source_type IN ('onedrive', 'sharepoint')`. Repair action: soft-delete (set both `deleted_at` + `deletion_status='pending'`) and clean up vector chunks.

Additionally, `FileExtractWorker` now detects `GraphApiError(404)` at extraction time and immediately soft-deletes the file instead of retrying — preventing future accumulation of 404-failed files.

### File Type Awareness

The reconciliation service accounts for different expected states per file type:
- **Text files**: Must have `file_chunks` + AI Search docs when `ready`
- **Image files**: Must have `image_embeddings` record when `ready` (0 chunks is correct)
- **External files**: `blob_path=null` is correct (content fetched via Graph API)
- See `scripts/storage/CLAUDE.md` for the full expected state matrix

### Folder Hierarchy Integrity

The reconciliation service verifies that the folder tree in the DB is structurally sound. Three issue types are detected:

1. **Orphaned children**: Files/folders whose `parent_folder_id` references a non-existent (or soft-deleted) folder. Detected via raw SQL `NOT EXISTS` subquery.
2. **Missing scope root folders**: `scope_type='folder'` scopes whose root folder (`external_id = scope_resource_id`) doesn't exist in the `files` table. The root folder is normally created by `ensureScopeRootFolder()` during initial sync.
3. **Broken chains**: Subset of #1 where the orphan is itself a folder — its descendants are also unreachable.

**Repair actions**:
- Recreate missing scope root folders via `ensureScopeRootFolder()` (quick DB create, no Graph API call)
- Queue full resync for affected scopes: clear `last_sync_cursor` → `addInitialSyncJob()` → `InitialSyncService` rebuilds complete folder hierarchy via `buildFolderMap()` + `sortFoldersByDepth()` + `upsertFolder()`
- Reparent orphaned local files (no `connection_scope_id`) to root (`parent_folder_id = null`)

**Rate limiting**: Max 5 scopes resynced per reconciliation run. Redis 30-min cooldown per scope (`sync:hierarchy_resync:{scopeId}`) prevents repeated resync.

**Transient orphan guard**: Files belonging to scopes with `sync_status IN ('syncing', 'sync_queued')` are excluded from detection to avoid false positives during active sync.

### Disconnected Connection Cleanup

When a user disconnects a connection (via `DELETE /api/connections/:id/full-disconnect`), `ScopeCleanupService.removeScope()` handles cascade deletion of files, chunks, embeddings, and search docs. However, if files persist after disconnection (e.g., partial cleanup failure, or connection status changed to `disconnected` without triggering full cleanup), the reconciliation service detects and cleans them.

**Detection**: Two-pass query:
1. Prisma query: files with `connections.status IN ('disconnected', 'expired')`
2. Raw SQL: files with `connection_id IS NOT NULL` but no matching `connections` row (hard-deleted connection)

**Repair**: Same soft-delete pattern as `external_not_found` — vector cleanup (best-effort) + hard-delete `file_chunks` + soft-delete file (set both `deleted_at` + `deletion_status='pending'`). The `FileDeletionWorker` handles physical cleanup (blob, search index, hard delete) asynchronously.

**Safety**: The unsafe `DELETE /api/connections/:id` endpoint (which bypassed cleanup) has been removed. Only `DELETE /api/connections/:id/full-disconnect` exists now.

### FileHealthService — Folder Exclusion

`FileHealthService.getHealthIssues()` excludes folders (`is_folder=true`) from both failed and stuck queries. Folders are metadata-only records that don't go through the extract→chunk→embed pipeline. Their `pipeline_status` is set to `'ready'` on creation. If a folder's status is corrupted (e.g., by a simulation script), the folder hierarchy reconciliation handles it, not the file health system.

## API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/sync/health` | `authenticateMicrosoft` | Per-user health report (all scopes) |
| `POST` | `/api/sync/health/recover` | `authenticateMicrosoft` | Manual recovery trigger |
| `POST` | `/api/sync/health/reconcile` | `authenticateMicrosoft` | On-demand per-user reconciliation (diagnose + repair) |

### POST /health/reconcile

On-demand file health reconciliation for the authenticated user. Diagnoses 6 drift conditions and repairs them.

- **Body**: `{ trigger?: 'login' | 'manual' }` (defaults to `'manual'`)
- **Rate limit**: Redis cooldown — 5 min between calls per user (429 if too soon)
- **Concurrency**: In-memory guard — one reconciliation per user at a time (409 if in progress)
- **Auto-repair**: Always repairs (bypasses `SYNC_RECONCILIATION_AUTO_REPAIR` env var)
- **WebSocket**: Emits `sync:reconciliation_completed` to `user:{userId}` on completion

**Optimistic concurrency**: All repair DB updates use `updateMany` with expected `pipeline_status` in WHERE clause. If a worker transitions the file between detection and repair, the update is a no-op (count=0) and enqueue is skipped.

### Scope Counter Adjustments (PRD-305)

When `FileRequeueRepairer` re-enqueues files, `adjustScopeCounters()` decrements the appropriate `connection_scopes` counter to prevent double-counting when `FilePipelineCompleteWorker` re-processes the files:

| Requeue method | Counter decremented |
|---|---|
| `requeueFailedRetriable` | `processing_failed` -N |
| `requeueMissingFromSearch`, `requeueImagesMissing...`, `requeueReadyWithoutChunks`, `requeueStaleMetadata` | `processing_completed` -N |
| `requeueStuckFiles` | None (status reset only) |

Uses `CASE WHEN col >= N THEN col - N ELSE 0 END` guards to prevent negatives. All set `processing_status = 'processing'`.

### POST Actions

| Action | Required Body | Effect |
|---|---|---|
| `reset_stuck` | `scopeId?` | Reset stuck scopes to `'idle'` |
| `retry_errors` | `scopeId?` | Re-enqueue error scopes (delta or initial sync) |
| `retry_files` | `scopeId` (required) | Re-enqueue failed files for pipeline processing |
| `full_recovery` | — | Reset stuck + retry errors (scoped to authenticated user) |

Multi-tenant isolation: `scopeId` ownership validated against `req.userId`.

## WebSocket Events

| Event | Emitted By | Payload |
|---|---|---|
| `sync:health_report` | `SyncHealthCheckService.run()` | Per-user health report after each 15-min check |
| `sync:recovery_completed` | POST `/recover` endpoint | Recovery action result |
| `sync:reconciliation_completed` | POST `/reconcile` endpoint | Reconciliation report summary (counts + repairs) |

Both emitted to `user:{userId}` rooms via `getSocketIO()`.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SYNC_HEALTH_STUCK_THRESHOLD_MS` | `600000` (10 min) | How long a scope must be stuck before reset |
| `SYNC_RECONCILIATION_AUTO_REPAIR` | `'false'` | Enable auto-repair during reconciliation |

## Error Handling

| Layer | Strategy |
|---|---|
| Per-scope (health check) | try/catch per `inspectScope()` — one failure does not abort the run |
| Per-user (reconciliation) | try/catch per user — one failure does not abort remaining users |
| Per-file (recovery) | try/catch per file — errors counted in `result.errors` |
| Redis backoff | Fail-open on Redis error (allow retry rather than silently block) |
| Connection guard | Skip recovery for scopes on `'expired'`/`'disconnected'` connections |

## Key Files

| File | Purpose |
|---|---|
| `SyncHealthCheckService.ts` | Cron health check + per-user API query |
| `SyncReconciliationService.ts` | **Orchestrator** — runs detectors → repairers (~250 lines) |
| `SyncRecoveryService.ts` | Atomic recovery actions (reset, retry, re-enqueue) |
| `detectors/*.ts` | 8 drift detectors (one per condition) + `SearchIndexComparator` helper |
| `repairers/*.ts` | 4 repairers (FileRequeue, OrphanCleanup, ExternalFileCleanup, FolderHierarchy) |
| `types.ts` | All type definitions (health, reconciliation, recovery, metrics) |
| `index.ts` | Barrel exports |

## Common Failure Scenarios

| Scenario | Root Cause | Detection | Recovery |
|---|---|---|---|
| Disconnect/reconnect race | `ScopeCleanupService` soft-deletes folders, new sync finds soft-deleted records via `external_id` | `FolderHierarchyDetector`: orphaned children + missing scope roots | `FolderHierarchyRepairer`: restore scope roots via `ensureScopeRootFolder()`, queue full resync |
| Graph API 404 | File deleted in SharePoint/OneDrive but delta sync missed it | `ExternalNotFoundDetector`: `last_error` contains '404' | `ExternalFileCleanupRepairer`: soft-delete + vector cleanup |
| Folder in extract pipeline | Folder mistakenly enqueued for file processing | `FileExtractWorker` guard: rejects `mimeType='inode/directory'` | Immediate reset to `pipeline_status='ready'` |
| Search index drift | Processing completed but search indexing failed silently | `MissingFromSearchDetector`: DB ready files not in AI Search | `FileRequeueRepairer`: reset to `queued`, re-enqueue |
| Stuck processing | Worker crashed mid-pipeline | `StuckPipelineDetector`: intermediate status > 30 min | `FileRequeueRepairer`: reset to `queued`, re-enqueue |

## Testing

### Simulation Script
```bash
npx tsx scripts/diagnostics/simulate-file-health-issues.ts --userId <ID> --confirm-dev
```
Simulates 5 scenarios: `retry_exhausted`, `blob_missing`, `failed_retriable`, `stuck_processing`, `soft_deleted_scope_root`.

### Diagnostic Script
```bash
npx tsx scripts/connectors/debug-scope-folders.ts --scopeIds <ID1>,<ID2>
```
Queries DB to inspect scope root folders, parent hierarchy, and soft-delete status.

### Unit Tests
Tests for each detector and repairer live in `__tests__/unit/services/sync/health/`. The orchestrator test (`SyncReconciliationService.test.ts`) validates end-to-end behavior with mocked detectors/repairers.

## Related

- Healthy file state definitions: `@bc-agent/shared` → `constants/file-health-state.ts`
- Parent: `../CLAUDE.md` — Sync pipeline overview (discovery, ingestion, processing)
- Queue: `../../../infrastructure/queue/CLAUDE.md` — MaintenanceWorker, ScheduledJobManager
- Search: `../../search/CLAUDE.md` — VectorSearchService (reconciliation uses `getUniqueFileIds`, `deleteChunksForFile`)
- Connectors: `../../connectors/CLAUDE.md` — Connection status checks before recovery
