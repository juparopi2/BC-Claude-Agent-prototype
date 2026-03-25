# File Sync System — Diagnostic Report

**Last Updated**: 2026-03-25
**Scope**: SharePoint and OneDrive file synchronization pipeline
**Status**: Current state analysis for the file-sync-improvements initiative

---

## 1. Architecture Overview

The sync pipeline is implemented as seven stateless singletons in `backend/src/services/sync/`. Each singleton is instantiated lazily via a `get*()` factory and reset via `__reset*()` for tests. No shared mutable state exists between requests.

### 1.1 Service Inventory

| Service | File | Responsibility |
|---------|------|----------------|
| `InitialSyncService` | `InitialSyncService.ts` | Full enumeration on first connect. Routes by scope type (`root` / `folder` / `file` / `library`). Exposes both fire-and-forget (`syncScope`) and awaitable (`syncScopeAsync`) entry points. The awaitable variant is called by BullMQ `ExternalFileSyncWorker` (PRD-116). |
| `DeltaSyncService` | `DeltaSyncService.ts` | Incremental updates via delta cursor. Guards against concurrent syncs. Falls back to `InitialSyncService` when `last_sync_cursor` is absent. Three-phase processing: deletions → folders → files. |
| `SyncFileIngestionService` | `SyncFileIngestionService.ts` | Extracted shared ingestion logic (PRD-117). Atomic batch upsert inside `prisma.$transaction()` with a 30-second timeout. Queue dispatch executes strictly after the transaction commits. |
| `FolderHierarchyResolver` | `FolderHierarchyResolver.ts` | Exported as pure functions (no class). Maintains `FolderIdMap` (external Graph ID → internal UUID). Provides `buildFolderMap`, `ensureScopeRootFolder`, `resolveParentFolderId`, `sortFoldersByDepth`, and `upsertFolder`. |
| `SubscriptionManager` | `SubscriptionManager.ts` | Microsoft Graph webhook lifecycle. `clientState` is generated as a 64-byte hex string, stored UPPERCASE. Maximum subscription duration is capped at `SUBSCRIPTION_MAX_DURATION_DAYS` (30 days, Graph limit). 404 on delete is swallowed silently. |
| `ScopeCleanupService` | `ScopeCleanupService.ts` | Cascade deletion with a concurrency guard (rejects if scope is `syncing` or `sync_queued`). NULLs `message_citations.file_id` before deletion. Best-effort Azure AI Search cleanup. Breaks self-referential `parent_folder_id` FK before bulk delete. |
| `SyncProgressEmitter` | `SyncProgressEmitter.ts` | Centralizes Socket.IO emissions to per-user rooms (`user:{userId}`). Guards all calls with `isSocketServiceInitialized()`. Covers: discovery progress, discovery completed, processing progress/completed, error, file added/updated/removed. |

### 1.2 Architectural Constraints

- All seven services are **stateless singletons** — no per-request state is stored on instances.
- `ExecutionContext` is not used in sync services; context is passed as explicit parameters (`connectionId`, `scopeId`, `userId`).
- DB transaction rule: all repository calls inside `prisma.$transaction()` receive the `tx` client, not the global `prisma` instance (learned from PRD-116 crash).
- Soft-delete always sets **both** `deleted_at` and `deletion_status` (learned from PRD-118 — cleanup queries check `deletion_status`).

---

## 2. Sync Flow

### 2.1 Initial Sync

```
Route handler (POST /api/connections/:id/scopes/:scopeId/sync)
  │
  ├── [PRD-116] Enqueue to BullMQ ExternalFileSyncWorker (triggerType: 'initial')
  │     └── ExternalFileSyncWorker.process()
  │           └── InitialSyncService.syncScopeAsync()
  │
  └── [Legacy / direct path] InitialSyncService.syncScope() — fire-and-forget

InitialSyncService._runSync():
  1. updateScope(syncStatus: 'syncing')
  2. Route by scope_type:
     - 'file'     → _runFileLevelSync() [lightweight, single Graph item fetch]
     - 'folder'   → executeFolderDeltaQuery(driveId, folderId)
     - 'library'  → executeDeltaQuery(driveId)           [SharePoint]
     - 'root'     → executeDeltaQuery(connectionId)       [OneDrive]
  3. Paginate until no nextPageLink remains
  4. Filter: exclude deleted items, folders, unsupported MIME types
  5. Apply exclusion scopes (PRD-112)
  6. buildFolderMap() — seed external→internal folder ID cache from DB
  7. ensureScopeRootFolder() — create root folder record (not in delta results)
  8. sortFoldersByDepth() → upsertFolder() for each (parents before children)
  9. For each file batch (BATCH_SIZE = 50):
       Phase A: prisma.$transaction() { upsert files } (timeout: 30s)
       Phase B: messageQueue.addFileProcessingFlow() for new files only
  10. updateScope(syncStatus: 'synced', lastSyncCursor: deltaLink, ...)
  11. Emit sync:completed via Socket.IO
  12. createSubscription() — non-fatal if GRAPH_WEBHOOK_BASE_URL unset
```

### 2.2 Delta Sync

```
Trigger: webhook notification | polling (30 min) | manual

DeltaSyncService.syncDelta():
  1. findScopeById() — load current scope state
  2. Guard: if sync_status === 'syncing' → return early (skip)
  3. updateScope(syncStatus: 'syncing')
  4. If no last_sync_cursor → delegate to InitialSyncService.syncScope() + return
  5. Resolve effectiveDriveId (scope.remote_drive_id ?? library scope ID ?? connection drive ID)
  6. Execute delta query from cursor, paginate all pages
  7. buildFolderMap() + ensureScopeRootFolder() (if folder-type scope)
  8. Categorize changes:
       - deleted      → deletedChanges[]
       - isFolder     → folderChanges[] (exclude scope root)
       - file         → fileChanges[]
  9. Apply exclusion scopes (PRD-112)
  10. Phase 1 — Deletions:
       For each deleted item:
         - Folder: recursively collect descendants → soft-delete files, hard-delete folders bottom-up
         - File: delete vector chunks → delete file_chunks → soft-delete (deleted_at + deletion_status: 'pending')
  11. Phase 2 — Folders: sortFoldersByDepth() → upsertFolder() for each
  12. Phase 3 — Files:
       - Skip unsupported MIME types
       - If eTag unchanged → skip
       - If eTag changed → delete chunks/vectors → reset pipeline_status → re-enqueue
       - If new → create record → enqueue processing flow
  13. updateScope(syncStatus: 'synced', lastSyncCursor: deltaLink, ...)
  14. Emit sync:completed
  15. Return DeltaSyncResult { newFiles, updatedFiles, deletedFiles, skipped }
```

### 2.3 Sync Triggers

| Trigger | Path | Notes |
|---------|------|-------|
| Webhook (primary) | `POST /api/webhooks/graph` → `SubscriptionRenewalWorker.pollDelta()` | ~3-minute notification delay from Graph |
| Polling (safety net) | `SubscriptionRenewalWorker.pollDelta()` every 30 min | Picks up scopes with `sync_status IN ('synced', 'idle')` and `last_sync_at < 30 min ago` |
| Manual | Route handler → BullMQ `ExternalFileSyncWorker` | User-initiated |
| Startup | `ScheduledJobManager` enqueues a one-time `poll-delta` job with 10-second delay | Catches missed changes from downtime |

---

## 3. Database Models

### 3.1 `connection_scopes` — Sync Status Lifecycle

| Field | Type | Notes |
|-------|------|-------|
| `sync_status` | `NVarChar(20)` | CHECK constraint: `idle \| sync_queued \| syncing \| synced \| error` |
| `last_sync_at` | `DateTime?` | Timestamp of last successful sync completion |
| `last_sync_cursor` | `NVarChar(Max)?` | Microsoft Graph delta link (absolute URL) |
| `last_sync_error` | `NVarChar(Max)?` | Error message when `sync_status = 'error'` |
| `processing_status` | `NVarChar(30)?` | `processing \| completed` — tracks file pipeline progress |
| `processing_total` | `Int` | Files enqueued for processing in this sync cycle |
| `processing_completed` | `Int` | Files that reached `ready` state |
| `processing_failed` | `Int` | Files that permanently failed |
| `subscription_id` | `NVarChar(512)?` | Microsoft Graph subscription ID |
| `subscription_expires_at` | `DateTime?` | Subscription expiry; renewal triggered when within buffer window |
| `client_state` | `NVarChar(Max)?` | 64-byte UPPERCASE hex — validates incoming webhook payloads |
| `remote_drive_id` | `NVarChar(512)?` | Set for SharePoint folder scopes (library driveId) and OD shared scopes |

**Status lifecycle:**

```
idle → sync_queued → syncing → synced
                            → error
```

### 3.2 `files` — Processing Pipeline Status

| Field | Type | Notes |
|-------|------|-------|
| `pipeline_status` | `NVarChar(50)` | See states below |
| `pipeline_retry_count` | `Int` | Incremented on each automatic recovery attempt |
| `deletion_status` | `NVarChar(20)?` | Set to `'pending'` on soft-delete; must be set alongside `deleted_at` |
| `deleted_at` | `DateTime?` | Soft-delete timestamp |
| `external_id` | `NVarChar(512)?` | Microsoft Graph item ID |
| `external_drive_id` | `NVarChar(512)?` | Drive ID for the item |
| `content_hash_external` | `NVarChar(512)?` | eTag from Graph API; change detection in delta sync |
| `is_shared` | `Boolean` | True for OD shared items and SP items accessed via remote drive |

**Pipeline status states:**

```
queued → [FileExtractWorker]
    → extracting → [FileChunkWorker]
        → chunking → [FileEmbedWorker]
            → embedding → ready
                       → failed
    → failed (max retries exceeded)
```

A filtered unique index `UQ_files_connection_external` on `(connection_id, external_id)` prevents duplicate entries per connection (PRD-104).

---

## 4. Existing Maintenance Jobs

Scheduled by `ScheduledJobManager.initializeScheduledJobs()` on startup. All use BullMQ repeatable jobs; existing jobs are removed before re-registration to prevent duplicates on restart.

| Job Name | Queue | Schedule | Handler | Purpose |
|----------|-------|----------|---------|---------|
| `stuck-file-recovery` | `FILE_MAINTENANCE` | Every 15 minutes (`*/15 * * * *`) | `StuckFileRecoveryService.run()` | Detect files stuck in non-terminal pipeline states (`queued`, `extracting`, `chunking`, `embedding`). Re-enqueue if `pipeline_retry_count < 3`; permanently fail otherwise. |
| `orphan-cleanup` | `FILE_MAINTENANCE` | Daily 03:00 UTC | `OrphanCleanupService.run()` | Delete orphaned blobs in Azure Storage, abandoned upload sessions, and old permanently failed files beyond retention period (`FILE_FAILED_RETENTION_DAYS`, default 30 days). |
| `batch-timeout` | `FILE_MAINTENANCE` | Every hour | `BatchTimeoutService.run()` | Timeout stale upload batches that have been in non-terminal states beyond the allowed window. |
| `renew-subscriptions` | `SUBSCRIPTION_MGMT` | Every 12 hours | `SubscriptionRenewalWorker.renewExpiring()` | Proactively renew Microsoft Graph subscriptions expiring within `SUBSCRIPTION_RENEWAL_BUFFER_HOURS`. On 404: recreate subscription and enqueue delta sync. |
| `poll-delta` | `SUBSCRIPTION_MGMT` | Every 30 minutes + startup (10s delay) | `SubscriptionRenewalWorker.pollDelta()` | Safety net: find scopes with `sync_status IN ('synced', 'idle')` and `last_sync_at < 30 min ago`, enqueue delta sync for each. |

---

## 5. Identified Gaps

### Gap 1: No Sync-Level Health Monitoring

**Description**: The `stuck-file-recovery` job only handles the file processing pipeline (the `pipeline_status` column). It has no awareness of sync-level states stored in `connection_scopes.sync_status`.

**Specific failures this gap causes:**

- A scope enters `syncing` status when `_runSync()` begins. If the BullMQ worker process crashes mid-sync, the scope remains stuck at `sync_status = 'syncing'` indefinitely.
- No job detects or resets these stuck scopes.
- A scope that transitions to `sync_status = 'error'` stays there forever. The delta poll job filters for `sync_status IN ('synced', 'idle')` — errored scopes are excluded.
- No API endpoint exposes sync health metrics (stuck syncs, error rate, time since last successful sync per scope).

**Evidence in code**: `SubscriptionRenewalWorker.pollDelta()` (line 89-90):

```typescript
sync_status: { in: ['synced', 'idle'] },
```

Scopes in `'syncing'` (crashed worker) or `'error'` states are silently skipped by all polling.

**Impact**: A scope that crashes during initial sync for a large OneDrive library (e.g., 10,000 files) will never recover without manual database intervention.

---

### Gap 2: No DB-to-Search-Index Reconciliation

**Description**: There is no scheduled job or on-demand tool to verify that files marked `pipeline_status = 'ready'` in the `files` table actually have corresponding vector chunks in Azure AI Search.

**Specific failures this gap causes:**

- If Azure AI Search becomes temporarily unavailable during the embedding step, the file may be marked `ready` in the DB but have zero chunks in the index.
- If a `ScopeCleanupService.removeScope()` AI Search cleanup call silently fails (the `try/catch` logs and continues), orphaned search documents persist in the index but the file record is deleted from the DB.
- RAG queries return empty results or incorrect citations for affected files. Users discover the problem only when a query fails to surface expected content.

**Evidence in code**: `ScopeCleanupService.removeScope()` (lines 104-127):

```typescript
// 5. Best-effort AI Search cleanup
for (const file of files) {
  try {
    await vectorService.deleteChunksForFile(file.id, userId);
  } catch (error) {
    searchCleanupFailures++;
    // log + continue — no retry, no reconciliation
  }
}
```

**Impact**: Discrepancies between the DB and search index accumulate silently over time, degrading RAG quality without any alert.

---

### Gap 3: Scope Selection UX Bug (Deselect-All Folders)

**Description**: The connection wizard's `hasChanges` detection logic fails when a user deselects all previously selected folders, making it impossible to remove all scopes from a connection without also adding a new one.

**Root cause**: The wizard tracks pending changes in two structures:
- `explicitSelections`: a `Set` of scope IDs the user has explicitly acted on in this session
- `selectedScopes`: a map of scope ID → scope object with a `status` field (`'active'`, `'removed'`, etc.)

When the user deselects the last selected folder:
- `explicitSelections` becomes empty (`explicitSelections.size > 0` evaluates to `false`)
- No scope in `selectedScopes` has `status === 'removed'` because only changes from the prior saved state produce `'removed'` entries

The `hasChanges` guard returns `false`, and the wizard closes without persisting the deselection.

**Backend state**: The `POST /api/connections/:id/scopes/batch` route accepts a payload with an empty `add` array and a non-empty `remove` array. The `batchScopesSchema` validation (in `@bc-agent/shared`) allows this. `ConnectionService.batchUpdateScopes()` processes removes independently of adds. The bug is purely frontend.

**Impact**: Users cannot remove all folders from a connection without disconnecting entirely. Attempting to do so produces no error — the wizard simply closes as if nothing changed.

---

### Gap 4: Destructive Scope Replacement on Re-sync

**Description**: When a user modifies their scope selection (e.g., replaces one folder scope with another that overlaps), `batchUpdateScopes()` runs removes first, then creates. For removed scopes, `ScopeCleanupService.removeScope()` deletes all associated files and their Azure AI Search chunks. When the new scope is subsequently synced, `InitialSyncService` re-discovers the same external files and re-processes them from scratch.

**Evidence in code**: `ConnectionService.batchUpdateScopes()` (lines 266-273):

```typescript
// Phase 1: Process removes (outside transaction — external side effects)
for (const scopeId of input.remove) {
  const result = await cleanupService.removeScope(normalizedConnectionId, normalizedScopeId, normalizedUserId);
  removed.push(result);
}
```

`InitialSyncService._runSync()` checks for existing files by `(connection_id, external_id)`, but because the previous scope deletion called `prisma.files.deleteMany()`, no existing record is found — the file is created fresh and enqueued for full reprocessing.

**Processing cost per re-synced file**:
1. Graph API metadata fetch (counted against Microsoft throttling limits)
2. Azure Blob Storage download
3. Text extraction (CPU-bound)
4. Chunking
5. Cohere Embed v4 API call (billed per token)
6. Azure AI Search indexing

**Impact**: For a user reorganizing a 500-file SharePoint library from one folder scope to a parent folder scope that contains the same files, all 500 files incur the full processing cost again.

---

### Gap 5: Multi-Tenant File Duplication

**Description**: `user_id` isolation is deeply embedded in every query in both the database and the Azure AI Search index. The same SharePoint document (same `external_id`) synced by two users belonging to the same organization results in two completely independent processing pipelines, two sets of stored chunks, and two sets of embeddings.

**Evidence in code**: Every DB query includes `user_id` as a filter:

```typescript
// FolderHierarchyResolver.ts — buildFolderMap()
const existingFolders = await prisma.files.findMany({
  where: {
    connection_id: connectionId,
    is_folder: true,
    source_type: ...,
  },
});

// DeltaSyncService.ts — file lookup
const existing = await prisma.files.findFirst({
  where: { connection_id: connectionId, external_id: item.id },
});
```

Note that these queries do not filter by `user_id` directly, but the `connection_id` is user-scoped: the `connections` table has `user_id` as a field and the filtered unique index `UQ_files_connection_external` is per `connection_id`. Two users have different `connection_id` values for the same SharePoint site.

**Current state**:
- No `organization_id` or `tenant_id` concept exists in the schema.
- No shared file mechanism (e.g., a single canonical `files` record referenced by multiple users).
- The Azure AI Search index uses `user_id` as a filter field in all RAG queries (PRD multi-tenant isolation rule).

**Impact**: At N users accessing the same SharePoint library, costs scale as O(N) for storage, O(N) for Cohere API calls, and O(N) for Azure AI Search index size. For an organization of 20 users sharing a 1,000-document library, this is 20× the necessary processing cost.

---

## 6. Error Handling Assessment

### 6.1 BullMQ Worker Layer (`ExternalFileSyncWorker`)

- **Retry policy**: BullMQ default exponential backoff — 3 attempts before moving to the failed queue.
- **Token expiry**: `ConnectionTokenExpiredError` is caught and re-thrown as `UnrecoverableError` — BullMQ skips retries immediately. `GraphTokenManager` has already marked the connection as expired.
- **Other errors**: Re-thrown to BullMQ for retry. No dead letter queue; failed jobs remain in BullMQ's failed state indefinitely.

### 6.2 Delta Sync Processing (`DeltaSyncService`)

- Per-item `try/catch` wraps every change (deletion, folder upsert, file upsert). One failed item does not abort the batch.
- Scope status is updated to `'error'` if the outer `syncDelta()` throws (e.g., Graph API authentication failure, DB connection loss).
- Vector chunk deletion failures are caught per-item and logged as warnings — deletion continues regardless.

### 6.3 Initial Sync (`InitialSyncService`)

- Fire-and-forget outer wrapper (`syncScope`) has a safety-net `.catch()` to prevent silent unhandled rejections if the inner catch block itself throws.
- Per-file `try/catch` inside the `prisma.$transaction()` callback — one file failure logs a warning and skips that file; the batch commits with remaining files.
- Folder upsert failures are individually caught with `logger.warn` — folder processing continues.
- On outer failure: scope is updated to `sync_status = 'error'` and `sync:error` is emitted via WebSocket.

### 6.4 Subscription Management (`SubscriptionRenewalWorker`)

- Per-scope `try/catch` in renewal loop — one scope failure does not abort others.
- `ConnectionTokenExpiredError`: logs warning and skips that scope (continues loop).
- HTTP 404 from Graph: recreates the subscription and enqueues a delta sync.
- Subscription creation failure during renewal logs an error but does not propagate.

### 6.5 Scope Cleanup (`ScopeCleanupService`)

- AI Search cleanup is best-effort: `try/catch` per file, logs warning, increments `searchCleanupFailures` counter, continues.
- No retry on AI Search cleanup failure — orphaned documents remain in the index.
- Subscription deletion: 404 is swallowed (subscription already gone); other errors are re-thrown.
- `ScopeCurrentlySyncingError` is a typed guard error — callers must handle it.

### 6.6 Missing Recovery Path

After `ExternalFileSyncWorker` exhausts its BullMQ retries:
- The scope remains at `sync_status = 'error'` permanently.
- No job re-enqueues or resets it.
- The polling fallback explicitly excludes `'error'` scopes.
- Manual recovery requires direct database update: `UPDATE connection_scopes SET sync_status = 'idle' WHERE id = '...'`.

---

## 7. Key File Locations

| Component | Path |
|-----------|------|
| Initial sync service | `backend/src/services/sync/InitialSyncService.ts` |
| Delta sync service | `backend/src/services/sync/DeltaSyncService.ts` |
| File ingestion service | `backend/src/services/sync/SyncFileIngestionService.ts` |
| Folder hierarchy resolver | `backend/src/services/sync/FolderHierarchyResolver.ts` |
| Subscription manager | `backend/src/services/sync/SubscriptionManager.ts` |
| Scope cleanup service | `backend/src/services/sync/ScopeCleanupService.ts` |
| Sync progress emitter | `backend/src/services/sync/SyncProgressEmitter.ts` |
| Sync service CLAUDE.md | `backend/src/services/sync/CLAUDE.md` |
| Scheduled job manager | `backend/src/infrastructure/queue/core/ScheduledJobManager.ts` |
| External file sync worker | `backend/src/infrastructure/queue/workers/ExternalFileSyncWorker.ts` |
| Subscription renewal worker | `backend/src/infrastructure/queue/workers/SubscriptionRenewalWorker.ts` |
| Maintenance worker | `backend/src/infrastructure/queue/workers/MaintenanceWorker.ts` |
| Stuck file recovery service | `backend/src/domains/files/recovery/StuckFileRecoveryService.ts` |
| Orphan cleanup service | `backend/src/domains/files/cleanup/OrphanCleanupService.ts` |
| Batch timeout service | `backend/src/domains/files/cleanup/BatchTimeoutService.ts` |
| Queue CLAUDE.md | `backend/src/infrastructure/queue/CLAUDE.md` |
| Connection service | `backend/src/domains/connections/ConnectionService.ts` |
| Connections route | `backend/src/routes/connections.ts` |
| Connection wizard (frontend) | `frontend/src/domains/integrations/components/ConnectionWizard.tsx` |
| Integration stores | `frontend/src/domains/integrations/stores/integrationListStore.ts` |
| Sync status store | `frontend/src/domains/integrations/stores/syncStatusStore.ts` |
| Prisma schema | `backend/prisma/schema.prisma` |
| OneDrive connector | `backend/src/services/connectors/onedrive/` |
| SharePoint connector | `backend/src/services/connectors/sharepoint/` |
| Vector search service | `backend/src/services/search/VectorSearchService.ts` |
| Files domain CLAUDE.md | `backend/src/domains/files/CLAUDE.md` |
| Integrations domain CLAUDE.md | `frontend/src/domains/integrations/CLAUDE.md` |
| Initiative index | `docs/plans/file-sync-improvements/00-INDEX.md` |
