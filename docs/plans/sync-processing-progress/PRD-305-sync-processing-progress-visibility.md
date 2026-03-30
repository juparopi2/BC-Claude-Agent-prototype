# PRD-305: Sync Processing Progress Visibility

**Status**: In Progress (Phase 1 + Phase 2 implemented — remaining: Redis investigation, Redis upgrade, per-file PipelineStatusBadge list)
**Created**: 2026-03-29
**Priority**: High (blocking user confidence in sync reliability)

---

## 1. Problem Statement

After a user connects OneDrive/SharePoint and syncs files, the frontend shows a `SyncProgressPanel` that notifies "sync started" and "sync completed" but provides **zero visibility into the file processing pipeline** that follows. Users see files stuck in "queued" or "syncing" status with no indication of progress, estimated time, or whether the system is actively working.

Additionally, a production diagnostic on 2026-03-29 revealed that **BullMQ file pipeline workers (extract, chunk, embed) produce zero Application Insights traces in 7+ days**, while files are continuously being enqueued. This suggests a silent worker failure that the existing health system does not detect.

### User Experience Gap

```
Current UX timeline:
  [Sync starts] → toast "syncing..."
  [Sync discovers files] → toast "X files found"
  ....... DEAD ZONE (minutes to hours) .......
  [Files appear as "ready"] → no notification

Expected UX timeline (like upload system):
  [Sync starts] → toast "syncing..."
  [Files discovered] → panel "X files found, processing for search..."
  [Processing] → panel "3/15 files processed (20%)" with progress bar
  [Each file ready] → status badge updates in file list
  [All done] → panel "15 files ready" → auto-dismiss
  [Errors] → collapsible panel "2 files failed" → retry button
```

---

## 2. Production Diagnostic (2026-03-29)

### 2.1 Application Insights Findings

**Environment**: `ai-myworkmate-prod` (rg-myworkmate-app-prod)
**Sampling**: 50% (set at resource level)
**Query window**: 24h and 7d

#### Service Activity Summary (24h)

| Service | Traces | Status |
|---|---|---|
| Prisma | 871 | Normal |
| ProcessingRetryManager | 318 | **HIGH** - mass retries executing |
| FileProcessingRoutes | 300 | **HIGH** - retry API calls |
| FileRetryService | 292 | **HIGH** - retry state transitions |
| FileMetadataService | 292 | Normal (metadata fetches) |
| MessageQueue | 206 | Active - enqueuing + Redis events |
| DeltaSyncService | 16 | Normal - delta syncs completing |
| SyncReconciliationService | 1 | Normal - ran at 20:43 UTC |
| **FileExtractWorker** | **0** | **CRITICAL - never ran** |
| **FileChunkWorker** | **0** | **CRITICAL - never ran** |
| **EmbeddingGenerationWorker** | **0** | **CRITICAL - never ran** |
| **FilePipelineCompleteWorker** | **0** | **CRITICAL - never ran** |
| **WorkerRegistry** | **0** | **No registration logs in 7d** |

#### Timeline of Events (2026-03-29)

```
20:24:45 UTC  Socket.IO client connected (user FE44A9D3...)
20:26:09-13   ProcessingRetryManager: 159+ "Executing manual retry" / "Manual retry executed successfully"
              Files retried: 9857bd1e, 304010f6, 8e1fbc13, 8eccd3f1, ... (scope: full)
20:29:47      Socket.IO client reconnected
20:29:48      Login reconciliation completed
20:30:00      DeltaSyncService: 5x "Delta sync completed", "External file sync job enqueued"
20:33:14      Socket.IO client reconnected (3rd connection)
20:34:18      BullMQ IORedis: close event → reconnect
20:37:15      BullMQ IORedis: reconnect
20:42:58-43:14 Redis client errors (SESSION profile: "Socket closed unexpectedly")
20:43:08      Reconciliation report: 13 DB ready, 13 search indexed, 0 issues, 0 repairs
20:43:44      BullMQ IORedis: close → connect → ready cycle
20:45:06-08   MessageQueue: 20+ "Flow added to BullMQ" (files enqueued to pipeline)
```

#### Key Message Patterns (24h)

| Message | Count | Source |
|---|---|---|
| "Retry initiated successfully via pipeline" | 151 | FileRetryService |
| "Pipeline transition with retry succeeded" | 123 | FileRetryService |
| "Flow added to BullMQ" | 20+ | MessageQueue |
| "Delta sync completed" | 5 | DeltaSyncService |
| "Extract worker started" | **0** | FileExtractWorker |
| "Chunk worker started" | **0** | FileChunkWorker |
| "Pipeline-complete worker started" | **0** | FilePipelineCompleteWorker |

#### Redis Connection Stability

```
Pattern repeating every ~10 minutes:
  Redis SESSION client: "Socket closed unexpectedly" (TLSSocket close)
  BullMQ IORedis: "close event" → "connect event" → "ready event"
```

**Redis errors (24h)**: 12 RedisClient errors, all "Socket closed unexpectedly" on SESSION profile.
**BullMQ IORedis**: Connection flapping but reconnecting. However, **worker polling may not recover** after Redis reconnection in BullMQ Flows.

#### Other Errors

| Error | Count | Impact |
|---|---|---|
| `Job failed in usage-aggregation: "Unknown aggregation job type: scheduled-hourly-aggregation"` | 2 | Non-critical - billing aggregation |
| Redis SESSION "Socket closed unexpectedly" | 12 | Medium - session disruption |

### 2.2 Reconciliation Report (20:43 UTC)

```json
{
  "userId": "fe44a9d3-d0d8-4602-9c55-eadb6483f04f",
  "dbReadyFiles": 13,
  "searchIndexedFiles": 13,
  "missingCount": 0,
  "orphanedCount": 0,
  "failedRetriableCount": 0,
  "stuckFilesCount": 0,
  "dryRun": false
}
```

**Note**: This report shows 0 issues, but the StuckPipelineDetector requires files to be stuck for >30 minutes. Files retried at 20:26 had only been queued for 17 minutes by 20:43, so they wouldn't trigger the detector yet. **The 13 "ready" files are the ones that were already processed before the retry attempt.**

### 2.3 Root Cause — CONFIRMED

**Root cause**: Production Redis eviction policy was `volatile-lru` instead of `noeviction`. BullMQ jobs were being **evicted from Redis under memory pressure** before workers could process them.

| Environment | `maxmemoryPolicy` | Result |
|---|---|---|
| **PROD** | `volatile-lru` (Azure default) | Jobs evicted, workers starved, 201 files stuck |
| **DEV** | `noeviction` (manually set) | Works correctly |
| **Local** | `noeviction` | Works correctly |

**Why this happened**: The Bicep template (`infrastructure/bicep/modules/data.bicep`) did not set `redisConfiguration.maxmemory-policy`. Azure Redis defaults to `volatile-lru`. Dev was manually corrected; prod was never fixed.

**Queue status (live run)**: ALL 17 BullMQ queues show 0 waiting, 0 active, 0 failed, 0 completed — jobs are permanently lost after eviction. Redis shows 15.4M total connections in 12 days (massive connection churn exacerbating memory pressure).

**DB status (live run)**: 201 files stuck in `queued`, 27 files `failed` (no error message — job data evicted), only 18 `ready`.

**Contributing factors**:
1. **Redis connection churn**: 15.4M connections in 12 days (~890/min). TLS socket closes every ~10 min. Each BullMQ Worker creates its own connection — churn inflates memory usage
2. **No queue depth monitoring**: The health system checks scope status and file pipeline status but never inspects Redis queue depths
3. **50% App Insights sampling**: Reduced visibility into the problem

### 2.4 Immediate Investigation Required

1. **Run `queue-status.ts` against prod Redis** (requires temporary firewall rule):
   ```bash
   cd backend
   REDIS_HOST=<prod-redis> REDIS_PORT=6380 REDIS_PASSWORD=<key> npx tsx scripts/redis/queue-status.ts --verbose
   ```
   This will show if v2-file-extract, v2-file-chunk, v2-file-embed queues have jobs stuck in `waiting` state.

2. **Run `verify-sync-health.ts` against prod DB** (requires temporary SQL firewall rule):
   ```bash
   cd backend
   DATABASE_URL=<prod-url> npx tsx scripts/sync/verify-sync-health.ts
   ```
   This will show the actual pipeline_status distribution across all files.

3. **Run `audit-file-health.ts` against prod** (requires firewall rules for SQL + Blob + Search):
   ```bash
   cd backend
   npx tsx scripts/storage/audit-file-health.ts --all --env prod
   ```

4. **Check container restart history**:
   ```bash
   az containerapp revision list --name app-myworkmate-backend-prod --resource-group rg-myworkmate-app-prod -o table
   ```

---

## 3. Two Workstreams

### Workstream A: Fix Silent Worker Failure (Bug)

**Goal**: Ensure BullMQ file pipeline workers actually process enqueued flows.

#### A.1 Fix Redis Eviction Policy (DONE 2026-03-29)

- [x] Fixed prod Redis `maxmemory-policy` from `volatile-lru` to `noeviction` via `az redis update`
- [x] Updated Bicep template (`infrastructure/bicep/modules/data.bicep`) to include `redisConfiguration.maxmemory-policy: noeviction`
- [x] Restarted backend container to re-register workers

#### A.2 Fix FilePipelineCompleteWorker Empty batchId (DONE 2026-03-29)

- [x] Added `if (batchId)` guard before `upload_batches` SQL update (line 65)
- [x] Added `if (batchId)` guard before batch progress read and event emission (line 120)
- [x] External sync files (batchId = scopeId) now skip batch tracking gracefully

#### A.3 Fix queue-status.ts Wrong Queue Names (DONE 2026-03-29)

- [x] Changed `v2-file-extract` → `file-extract`, etc. in `scripts/redis/queue-status.ts`
- [x] Added `file-maintenance` queue to the list

#### A.4 Remaining (Future)

- [x] Add dedicated health endpoint: `GET /api/queue/health` returning per-queue job counts
- [x] Add worker heartbeat logging at `warn` level to avoid 50% sampling loss
- [ ] Investigate Redis connection churn (15.4M connections in 12 days)
- [ ] Consider upgrading Redis from 6.0 to 6.2+ (BullMQ recommendation)

### Workstream B: Processing Progress UI (Feature)

**Goal**: Show real-time file processing progress, matching the upload system's UX pattern.

#### B.1 Backend: Ensure Progress Events Emit

The backend already emits `processing:progress` and `processing:completed` via `FilePipelineCompleteWorker.emitScopeProgress()`. Once Workstream A fixes the workers, these events will flow.

- [x] Fixed `FileRequeueRepairer` scope counter adjustments so `FilePipelineCompleteWorker` emits correct progress after reconciliation requeue
- [x] Add `processing:started` event when first file in a scope begins extraction (new event via Redis SETNX in FileExtractWorker)

#### B.2 Frontend: Enhance SyncProgressPanel

Currently `SyncProgressPanel` only shows `op.status` (syncing/complete/error) and scope count. It ignores the `activeSyncs` store data that has per-scope processing progress.

**Reference pattern**: `BatchUploadProgressPanel.tsx` — shows dual progress bars (upload % + processing %), per-file status badges, expandable file list.

- [x] Added `selectOperationProgress()` selector to `syncStatusStore` — aggregates per-scope progress into operation-level totals
- [x] Added `OperationProgress` interface: `{ total, completed, failed, percentage, phase }`
- [x] Added `selectHasActiveProcessing()` selector
- [x] Rewrote `SyncProgressPanel` as `SyncProgressPanel` + `SyncOperationCard` sub-component
- [x] Shows progress bar with `Processing X/Y files` count
- [x] Shows phase transitions: "Discovering..." → "Processing X/Y files..." → "X files ready"
- [x] Shows failed count with amber warning: "(N failed)"
- [x] Info banner during processing: "Files are being indexed for search. Your Knowledge Base will update as each file completes."
- [x] Add retry button for failed files via `SyncFailedFilesSection` collapsible with `useSyncRetry` hook
- [ ] Add expandable file list showing per-file `PipelineStatusBadge` (future)

#### B.3 Frontend: Processing Notification Toast Flow

```
sync:completed (processingTotal > 0)
  → SyncProgressPanel enters "processing" phase
  → Shows "Processing X files for search..."
  → processing:progress events update count + %
  → processing:completed
    → If 0 failed: "All files ready for search" (auto-dismiss 3s)
    → If N failed: "X files ready, N failed" (persist with retry button)
```

#### B.4 Frontend: Error Recovery Collapsible

When files fail processing, show a collapsible notification (like the reconciliation toast but persistent):

```
┌─────────────────────────────────────────┐
│ ⚠ 2 files failed processing            │
│ ┌─ report-q3.xlsx: extraction error ───┐│
│ │  budget-v2.docx: embedding timeout   ││
│ └──────────────────────────────────────┘│
│ [Retry All]  [Dismiss]                  │
└─────────────────────────────────────────┘
```

- [x] `SyncFailedFilesSection` sub-component reuses FileHealthWarning pattern (collapsible error list with per-file retry)
- [x] Calls `POST /api/files/{fileId}/retry-processing` for each failed file via `useSyncRetry` hook
- [x] Aggregates retry results and shows summary toast (success/warning/error)

---

## 4. Data Flow (Current vs Proposed)

### Current

```
Backend                          Frontend
─────────                        ────────
sync:progress ──────────────────→ setSyncStatus('syncing', %)
sync:completed ─────────────────→ setSyncStatus('processing') ──→ toast "X files found"
                                  [DEAD ZONE - no UI updates]
processing:progress ────────────→ setProcessingProgress()    ──→ stored but NOT displayed
processing:completed ───────────→ setSyncStatus('idle')      ──→ toast "files ready"
```

### Proposed

```
Backend                          Frontend
─────────                        ────────
sync:progress ──────────────────→ SyncProgressPanel: "Discovering: X%"
sync:completed ─────────────────→ SyncProgressPanel: "Processing 0/15 files..."
processing:progress ────────────→ SyncProgressPanel: "Processing 3/15 (20%)" + progress bar
                                  File list: PipelineStatusBadge per file
processing:completed ───────────→ SyncProgressPanel: "15 files ready" (auto-dismiss)
                                  OR: "13 ready, 2 failed" (persist + retry button)
```

---

## 5. Files to Modify

### Workstream A (Worker Fix)

| File | Change |
|---|---|
| `backend/src/infrastructure/queue/core/WorkerRegistry.ts` | Add heartbeat, enhanced error logging |
| `backend/src/infrastructure/queue/core/RedisConnectionManager.ts` | Worker-specific connection config |
| `backend/src/infrastructure/queue/MessageQueue.ts` | Worker health check method |
| `backend/src/services/sync/health/SyncHealthCheckService.ts` | Include queue depth in health reports |
| `backend/src/routes/sync-health.routes.ts` | Add `GET /api/queue/health` endpoint |

### Workstream B (Progress UI)

| File | Change |
|---|---|
| `frontend/components/connections/SyncProgressPanel.tsx` | Add progress bar, file counts, failed state, retry button |
| `frontend/src/domains/integrations/stores/syncStatusStore.ts` | Add selectors for processing progress per operation |
| `frontend/src/domains/integrations/hooks/useSyncEvents.ts` | Map processing progress to operation-level state |
| `frontend/src/domains/files/hooks/useFileReconciliation.ts` | Integrate with progress panel for retry actions |

### Shared

| File | Change |
|---|---|
| `@bc-agent/shared` | Add `SYNC_WS_EVENTS.PROCESSING_STARTED` event type |

---

## 6. Success Criteria

1. **Worker health**: File pipeline workers produce traces in Application Insights within 5 minutes of a file being enqueued
2. **Progress visibility**: User sees file-by-file processing progress in SyncProgressPanel during sync
3. **Error recovery**: Failed files show in a collapsible notification with "Retry All" button
4. **No dead zone**: The time between "files discovered" and "files ready" is fully covered by UI updates
5. **Queue alerting**: Backlog of >50 files waiting >10 minutes triggers a user-visible warning

---

## 7. Open Questions

1. **Why do Flow-based workers fail silently while regular workers work?** Need to verify with `queue-status.ts` against prod Redis
2. **Is the 50% sampling sufficient for operational visibility?** Consider reducing to 100% for queue/worker services or using structured custom events
3. **Should we add a dedicated queue monitoring dashboard in Application Insights?** Kusto workbook with queue depth, worker throughput, error rates
4. **Can we deduplicate the upload + sync progress panels?** Both use floating bottom-right panels — could conflict visually when both are active
