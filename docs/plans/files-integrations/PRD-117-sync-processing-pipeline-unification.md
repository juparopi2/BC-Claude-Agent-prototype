# PRD-117: Sync Processing Pipeline Unification & Completion Fidelity

## Status: COMPLETED (2026-03-12)
## Priority: P0 (Critical — affects core UX and data integrity)
## Dependencies: PRD-116 (completed), PRD-108 (completed)

---

## 1. Problem Statement

The file upload (local) pipeline implements a robust, observable state machine with atomic CAS transitions, batch tracking, and accurate completion signaling. The file sync pipeline (OneDrive/SharePoint) reuses the same BullMQ processing workers but **lacks equivalent completion tracking, date fidelity, and processing observability**.

### 1.1 Root Problems (Not Symptoms)

| # | Problem | Impact | Root Cause |
|---|---|---|---|
| **P1** | User sees "Sync completed" when files are only listed, not processed | **Critical UX lie** — users search immediately and find nothing | `InitialSyncService` emits `sync:completed` after file discovery, not after extraction/embedding completes |
| **P2** | `file_modified_at` is NULL for all OneDrive/SharePoint files | **Broken date sorting** — cloud files have no user-facing date | Sync services only set `external_modified_at`, never `file_modified_at` |
| **P3** | No processing progress tracking per scope | **Zero observability** — after sync, user has no visibility into extraction/embedding status | `FilePipelineCompleteWorker` only updates `upload_batches`, not `connection_scopes` |
| **P4** | File creation during sync is non-atomic per batch | **Partial failure risk** — 25 of 50 files created, rest lost silently | `Promise.all` with individual `prisma.files.create()` inside catch-per-item pattern |
| **P5** | Sync and processing are architecturally coupled in `InitialSyncService` | **Poor separation of concerns** — discovery, persistence, and queue dispatch are interleaved in one 450-line method | No extraction of responsibilities into composable layers |
| **P6** | `FilePipelineCompleteWorker` is upload-batch-only | **Dead end for sync files** — worker increments `upload_batches.processed_count` even when `batchId` is a scopeId | No awareness of `connection_scopes` lifecycle |
| **P7** | No database index on `file_modified_at` | **Performance** — date-based queries do full table scans | Missing index in Prisma schema |

### 1.2 The Fundamental Architectural Gap

The local upload pipeline has a **closed-loop completion model**:

```
createBatch → confirmFile → BullMQ Flow → FilePipelineCompleteWorker
                                              ↓
                                    upload_batches.processed_count++
                                              ↓
                                    processed_count >= total_files?
                                              ↓
                                    batch:completed WebSocket event ← USER SEES REAL COMPLETION
```

The sync pipeline has an **open-loop model** — discovery completes and signals success, but processing runs fire-and-forget with no aggregation point:

```
InitialSyncService → files.create + addFileProcessingFlow → sync:completed ← PREMATURE
                                                               ↓
                                                  BullMQ Flow (runs async, nobody tracks)
                                                               ↓
                                         FilePipelineCompleteWorker updates upload_batches ← WRONG TABLE
                                                               ↓
                                                          ... silence
```

---

## 2. Design Principles

This PRD follows the architecture already proven in the upload pipeline:

| Principle | Upload Pipeline (Model) | Sync Pipeline (Current) | Sync Pipeline (Target) |
|---|---|---|---|
| **Single source of truth for status** | `upload_batches.processed_count` | None | `connection_scopes.processed_count` |
| **Closed-loop completion** | `batch:completed` when all files ready | `sync:completed` on discovery only | Two-phase: `sync:discovered` + `sync:ready` |
| **Atomic state transitions** | CAS on `pipeline_status` | CAS on `pipeline_status` (same ✅) | No change needed |
| **Observable progress** | `file:processing_progress` per file | None for sync files | Same `file:processing_progress` (already works ✅) + scope-level aggregation |
| **Date fidelity** | `file_modified_at` from `File.lastModified` | `external_modified_at` only | `file_modified_at` = `external_modified_at` |
| **Modular responsibility** | `BatchUploadOrchestrator` (3 phases) | `InitialSyncService` (monolith) | Decompose into Discovery → Persistence → Dispatch layers |

---

## 3. Architecture: Layered Decomposition

### 3.1 Current Architecture (Monolithic)

```
InitialSyncService._runSync()  (450 lines, 7 responsibilities)
├── 1. Mark scope as syncing
├── 2. Resolve drive ID (provider routing)
├── 3. Execute delta query (all pages)
├── 4. Filter files by type + exclusions
├── 5. Upsert folders (hierarchy resolution)
├── 6. Create files + enqueue processing (interleaved in same loop)
├── 7. Mark scope as synced + emit completed
```

### 3.2 Target Architecture (Layered)

```
                    ┌─────────────────────────────────────────────┐
                    │          SyncOrchestrator (NEW)              │
                    │  Coordinates phases, handles errors,         │
                    │  owns scope status transitions               │
                    └───────┬───────────────┬─────────────────────┘
                            │               │
              ┌─────────────┘               └──────────────┐
              ▼                                            ▼
   ┌───────────────────┐                    ┌────────────────────────┐
   │  Discovery Phase  │                    │  Ingestion Phase       │
   │  (existing logic) │                    │  (NEW — extracted)     │
   │  Delta query +    │                    │  Atomic batch create + │
   │  folder hierarchy │                    │  queue dispatch        │
   └───────────────────┘                    └────────────────────────┘
                                                       │
                                                       ▼
                                            ┌────────────────────────┐
                                            │  Processing Pipeline   │
                                            │  (existing — enhanced) │
                                            │  Extract → Chunk →     │
                                            │  Embed → Complete      │
                                            └────────────────────────┘
                                                       │
                                                       ▼
                                            ┌────────────────────────┐
                                            │  Completion Tracker    │
                                            │  (NEW — in worker)     │
                                            │  Scope-aware counter + │
                                            │  WebSocket events      │
                                            └────────────────────────┘
```

### 3.3 Key Design Decision: Enhance, Don't Replace

The upload pipeline is correct and battle-tested. The sync pipeline reuses its core (BullMQ Flow, CAS transitions, same workers). The only changes needed are:

1. **Add scope-aware tracking in `FilePipelineCompleteWorker`** — detect source type, update correct counter
2. **Set `file_modified_at` alongside `external_modified_at`** — 4 lines of code across 2 files
3. **Add processing columns to `connection_scopes`** — schema change + worker update
4. **New WebSocket events** for processing lifecycle — shared constants + frontend listeners
5. **Rename `sync:completed` semantics** — "discovery complete" not "all done"

**What does NOT change:**
- BullMQ Flow structure (`ProcessingFlowFactory`)
- CAS state machine (`pipeline-status.ts`, `PIPELINE_TRANSITIONS`)
- Workers (FileExtractWorker, FileChunkWorker, FileEmbedWorker)
- Content providers (GraphApiContentProvider, BlobContentProvider)
- Multi-tenant isolation (user_id in every WHERE)

---

## 4. Implementation Plan

### Phase 1: Completion Fidelity (P0 — Critical)

**Goal**: Users see accurate completion status. When sync says "done", files are searchable.

#### 4.1 Schema: Add processing tracking to `connection_scopes`

**File**: `backend/prisma/schema.prisma`

```prisma
model connection_scopes {
  // ... existing columns ...

  // NEW: Processing lifecycle tracking (PRD-117)
  processing_total     Int       @default(0)    // Files queued for processing during sync
  processing_completed Int       @default(0)    // Files that reached READY
  processing_failed    Int       @default(0)    // Files that reached FAILED
  processing_status    String?   @db.NVarChar(30) // idle | processing | completed | partial_failure
}
```

**CHECK constraint** (raw SQL migration):
```sql
ALTER TABLE connection_scopes ADD CONSTRAINT CK_connection_scopes_processing_status
CHECK (processing_status IN ('idle', 'processing', 'completed', 'partial_failure') OR processing_status IS NULL);
```

#### 4.2 `FilePipelineCompleteWorker`: Scope-Aware Completion

**File**: `backend/src/infrastructure/queue/workers/FilePipelineCompleteWorker.ts`

**Change**: After updating `upload_batches`, check if the file belongs to a connection scope and update scope counters too.

```typescript
// After existing upload_batches increment...

// PRD-117: Scope-aware processing tracking
const file = await prisma.files.findFirst({
  where: { id: fileId, user_id: userId },
  select: { connection_scope_id: true, source_type: true },
});

if (file?.connection_scope_id) {
  const isSuccess = finalStatus === PIPELINE_STATUS.READY;
  const incrementField = isSuccess ? 'processing_completed' : 'processing_failed';

  await prisma.$executeRaw`
    UPDATE connection_scopes
    SET ${Prisma.raw(incrementField)} = ${Prisma.raw(incrementField)} + 1,
        updated_at = GETUTCDATE()
    WHERE id = ${file.connection_scope_id}
      AND user_id = ${userId}
  `;

  // Check if scope processing is complete
  const scope = await prisma.connection_scopes.findFirst({
    where: { id: file.connection_scope_id },
    select: { processing_total: true, processing_completed: true, processing_failed: true },
  });

  if (scope) {
    const totalProcessed = (scope.processing_completed ?? 0) + (scope.processing_failed ?? 0);
    const isAllDone = totalProcessed >= (scope.processing_total ?? 0);

    if (isAllDone) {
      const processingStatus = (scope.processing_failed ?? 0) > 0 ? 'partial_failure' : 'completed';
      await prisma.connection_scopes.update({
        where: { id: file.connection_scope_id },
        data: { processing_status: processingStatus },
      });

      // Emit scope processing completed event
      this.emitScopeProcessingComplete(userId, file.connection_scope_id, scope);
    }
  }
}
```

#### 4.3 `InitialSyncService` / `DeltaSyncService`: Set `processing_total`

**Files**:
- `backend/src/services/sync/InitialSyncService.ts`
- `backend/src/services/sync/DeltaSyncService.ts`

**Change**: After file discovery/creation phase, before marking scope as `synced`, set `processing_total` and `processing_status`:

```typescript
// After Step 5 (file ingestion loop), before Step 6 (mark synced)
await repo.updateScope(scopeId, {
  syncStatus: 'synced',
  itemCount: totalFiles,
  lastSyncAt: new Date(),
  lastSyncError: null,
  lastSyncCursor: deltaLink,
  // PRD-117: Initialize processing tracking
  processingTotal: newFilesEnqueued,  // Only NEW files that were enqueued
  processingCompleted: 0,
  processingFailed: 0,
  processingStatus: newFilesEnqueued > 0 ? 'processing' : 'completed',
});
```

**Important**: `processingTotal` counts only **newly created** files that were enqueued for processing. Existing files that only got metadata updates are NOT counted (they already have embeddings).

#### 4.4 WebSocket Events: Two-Phase Completion

**File**: `packages/shared/src/constants/sync-events.ts`

```typescript
export const SYNC_WS_EVENTS = {
  // ... existing events ...

  // PRD-117: Processing lifecycle events
  /** All files discovered and enqueued — NOT yet searchable */
  SYNC_DISCOVERED: 'sync:discovered',
  /** Periodic processing progress for scope */
  PROCESSING_PROGRESS: 'processing:progress',
  /** All files in scope have finished processing (ready or failed) */
  PROCESSING_COMPLETED: 'processing:completed',
} as const;
```

**Behavioral change**:
- Current `SYNC_COMPLETED` keeps its name but frontend reinterprets it as "discovery done"
- New `PROCESSING_COMPLETED` signals when files are actually searchable
- Frontend shows two-phase progress: "Discovering files..." → "Processing files... (32/50)"

#### 4.5 Frontend: Two-Phase Progress Display

**File**: `frontend/src/domains/integrations/hooks/useSyncEvents.ts`

**Changes**:
- `SYNC_COMPLETED` handler: Set scope to `'processing'` state (not `'idle'`) when `processingTotal > 0`
- New `PROCESSING_PROGRESS` handler: Update progress bar with `{ completed, failed, total }`
- New `PROCESSING_COMPLETED` handler: Set scope to `'idle'`, show success toast: "50 files ready for search"

**File**: `frontend/src/domains/integrations/stores/syncStatusStore.ts`

**Changes**:
- Extend `SyncEntry` with processing state:
```typescript
interface SyncEntry {
  status: 'syncing' | 'processing' | 'idle' | 'error';
  syncPercentage: number;      // Discovery progress (0-100)
  processingTotal: number;     // Files to process
  processingCompleted: number; // Files processed
  processingFailed: number;    // Files failed
  lastSyncedAt?: string;
  error?: string;
}
```

---

### Phase 2: Date Fidelity (P0 — 4 lines of code)

**Goal**: Cloud files have the same `file_modified_at` as local uploads for consistent sorting/filtering.

#### 4.6 `InitialSyncService`: Set `file_modified_at` on create and update

**File**: `backend/src/services/sync/InitialSyncService.ts`

**Line 321 (existing file update)** — add:
```typescript
file_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
```

**Line 352 (new file create)** — add:
```typescript
file_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
```

#### 4.7 `DeltaSyncService`: Set `file_modified_at` on create and update

**File**: `backend/src/services/sync/DeltaSyncService.ts`

**Line 489-491 (existing file update)** — add:
```typescript
file_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
```

**Line 540-542 (new file create)** — add:
```typescript
file_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
```

#### 4.8 Backfill Migration Script

**New file**: `backend/scripts/migrations/backfill-file-modified-at.ts`

```typescript
// Backfill file_modified_at for existing cloud files using external_modified_at
await prisma.$executeRaw`
  UPDATE files
  SET file_modified_at = external_modified_at
  WHERE file_modified_at IS NULL
    AND external_modified_at IS NOT NULL
    AND source_type IN ('onedrive', 'sharepoint')
    AND deletion_status IS NULL
`;

// Backfill legacy local files using created_at as fallback
await prisma.$executeRaw`
  UPDATE files
  SET file_modified_at = created_at
  WHERE file_modified_at IS NULL
    AND source_type = 'local'
    AND deletion_status IS NULL
`;
```

#### 4.9 Add Database Index

**File**: `backend/prisma/schema.prisma`

```prisma
model files {
  // ... existing ...
  @@index([user_id, file_modified_at(sort: Desc)], map: "IX_files_user_modified_date")
}
```

---

### Phase 3: Ingestion Atomicity (P1 — Robustness)

**Goal**: File creation during sync is atomic per batch, preventing partial writes.

#### 4.10 Batch Transaction in `InitialSyncService`

**Current pattern** (fragile):
```typescript
// Each file created individually inside Promise.all — partial failures possible
await Promise.all(
  batch.map(async (change) => {
    await prisma.files.create({ data: { ... } }); // Individual, no TX
    await messageQueue.addFileProcessingFlow({ ... }); // Fire-and-forget
  })
);
```

**Target pattern** (atomic per batch):
```typescript
// Phase A: Create all files in batch atomically
const createdFiles = await prisma.$transaction(async (tx) => {
  const results: Array<{ fileId: string; mimeType: string; fileName: string }> = [];

  for (const change of batch) {
    const item = change.item;
    const existing = await tx.files.findFirst({
      where: { connection_id: connectionId, external_id: item.id },
      select: { id: true, pipeline_status: true },
    });

    if (existing) {
      // Metadata update only
      await tx.files.update({ where: { id: existing.id }, data: { ... } });
    } else {
      const fileId = randomUUID().toUpperCase();
      await tx.files.create({ data: { id: fileId, ... } });
      results.push({ fileId, mimeType: item.mimeType ?? 'application/octet-stream', fileName: item.name });
    }
  }

  return results;
}, { timeout: 30000 });

// Phase B: Enqueue processing AFTER transaction commits (safe: files exist in DB)
for (const file of createdFiles) {
  await messageQueue.addFileProcessingFlow({
    fileId: file.fileId,
    batchId: scopeId,
    userId,
    mimeType: file.mimeType,
    fileName: file.fileName,
  });
}
```

**Benefits**:
- All 50 files in batch commit together or none do
- Queue dispatch only happens after DB commit (no orphaned jobs)
- Same pattern as `BatchUploadOrchestrator.createBatch()`

#### 4.11 Apply Same Pattern to `DeltaSyncService`

The DeltaSyncService processes files individually (not batched). This is acceptable for delta sync since changes are typically small (1-10 files per webhook). However, the create-then-enqueue pattern should still be sequential (create first, enqueue second) with proper error handling.

**No change needed** — DeltaSyncService already creates then enqueues per file, and errors are caught per-item.

---

### Phase 4: Architecture Cleanup (P2 — Maintainability)

**Goal**: Improve separation of concerns for long-term maintainability.

#### 4.12 Extract `SyncFileIngestionService`

**New file**: `backend/src/services/sync/SyncFileIngestionService.ts`

Extract the file upsert logic from `InitialSyncService` into a reusable service:

```typescript
/**
 * SyncFileIngestionService (PRD-117)
 *
 * Responsible for persisting file records from external sync discovery.
 * Extracted from InitialSyncService for reuse by both Initial and Delta sync.
 *
 * Single Responsibility: File record creation/update + queue dispatch.
 * Does NOT handle: scope status, delta queries, folder hierarchy, WebSocket events.
 */
export class SyncFileIngestionService {
  /**
   * Ingest a batch of discovered files into the database and enqueue processing.
   *
   * @param batch - External file items discovered by delta query
   * @param context - Sync context (connectionId, scopeId, userId, provider, driveId)
   * @returns { created: number, updated: number, failed: number }
   */
  async ingestBatch(
    batch: DeltaChange[],
    context: SyncIngestionContext
  ): Promise<IngestionResult> { ... }
}
```

**Consumed by**: Both `InitialSyncService` and `DeltaSyncService`.

**Benefits**:
- Single point for file creation logic (no duplication between initial and delta)
- Easier to test in isolation
- Clear interface for adding new providers in the future

#### 4.13 Extract `SyncProgressEmitter`

**New file**: `backend/src/services/sync/SyncProgressEmitter.ts`

Extract WebSocket emission from both sync services:

```typescript
/**
 * SyncProgressEmitter (PRD-117)
 *
 * Centralized WebSocket event emission for sync lifecycle.
 * Single Responsibility: Emit sync/processing events to user rooms.
 */
export class SyncProgressEmitter {
  emitDiscoveryProgress(userId: string, data: SyncProgressPayload): void;
  emitDiscoveryCompleted(userId: string, data: SyncCompletedPayload): void;
  emitProcessingProgress(userId: string, data: ProcessingProgressPayload): void;
  emitProcessingCompleted(userId: string, data: ProcessingCompletedPayload): void;
  emitSyncError(userId: string, data: SyncErrorPayload): void;
}
```

#### 4.14 Define Shared Processing Event Types

**File**: `packages/shared/src/types/sync-processing-events.types.ts`

```typescript
/** Payload for processing:progress events (PRD-117) */
export interface ProcessingProgressPayload {
  connectionId: string;
  scopeId: string;
  total: number;
  completed: number;
  failed: number;
  percentage: number;
}

/** Payload for processing:completed events (PRD-117) */
export interface ProcessingCompletedPayload {
  connectionId: string;
  scopeId: string;
  totalProcessed: number;
  totalReady: number;
  totalFailed: number;
}
```

---

## 5. Microsoft Graph `fileSystemInfo` Investigation

### 5.1 Current Date Source

The sync services use `item.lastModifiedDateTime` from the top-level Graph API response. This is the **server-side modification date** — it updates when OneDrive/SharePoint modifies the item (rename, move, metadata change), not just when the file content changes.

### 5.2 `fileSystemInfo` Alternative

Microsoft Graph exposes `fileSystemInfo.lastModifiedDateTime` which is the **client-side modification date** — the timestamp from the user's local filesystem before upload:

```json
{
  "lastModifiedDateTime": "2026-03-12T10:00:00Z",  // Server modified
  "fileSystemInfo": {
    "lastModifiedDateTime": "2026-01-15T14:32:00Z"  // Original file date
  }
}
```

### 5.3 Recommendation

**Phase 2 (date fidelity)** uses `item.lastModifiedAt` (top-level) because:
1. It's already available in `ExternalFileItem` (no API change needed)
2. `fileSystemInfo` requires requesting `$select=fileSystemInfo` in delta queries
3. Top-level `lastModifiedDateTime` is the most comparable to what users see in OneDrive UI
4. It's better to ship the fix now and refine the date source later if needed

**Future enhancement**: If users report that file dates don't match what they see in their file explorer, investigate adding `fileSystemInfo.lastModifiedDateTime` to the delta query response mapping and using it as the primary source for `file_modified_at`.

---

## 6. Diagnostic LOG_SERVICES

For verifying the implementation, use these service groups:

### 6.1 Full Sync → Processing Pipeline

```bash
LOG_SERVICES=InitialSyncService,DeltaSyncService,ExternalFileSyncWorker,FileExtractWorker,FileChunkWorker,FileEmbedWorker,FilePipelineCompleteWorker,PipelineStateMachine npm run dev
```

### 6.2 Scope Status Transitions Only

```bash
LOG_SERVICES=InitialSyncService,DeltaSyncService,ConnectionService,FilePipelineCompleteWorker npm run dev
```

### 6.3 File Processing Only (Embedding/Extraction Issues)

```bash
LOG_SERVICES=FileExtractWorker,FileProcessingService,FileChunkingService,EmbeddingService,VectorSearchService npm run dev
```

### 6.4 Queue Infrastructure (Stuck Jobs)

```bash
LOG_SERVICES=MessageQueue,QueueManager,WorkerRegistry,FlowProducerManager,StuckFileRecoveryService,DLQService npm run dev
```

### 6.5 Graph API Connectivity

```bash
LOG_SERVICES=OneDriveService,SharePointService,GraphHttpClient,GraphTokenManager,GraphRateLimiter npm run dev
```

---

## 7. Database Migration Steps

```bash
# 1. Add new columns to schema
# Edit backend/prisma/schema.prisma (Section 4.1, 4.9)

# 2. Push schema changes
cd backend && npx prisma db push

# 3. Add CHECK constraint
npx tsx scripts/database/add-processing-status-check.ts

# 4. Regenerate Prisma client
npx prisma generate

# 5. Run backfill for file_modified_at
npx tsx scripts/migrations/backfill-file-modified-at.ts

# 6. Verify
npx tsx scripts/storage/verify-sync.ts --health
```

---

## 8. Testing Strategy

### 8.1 Unit Tests

| Test | Validates |
|---|---|
| `FilePipelineCompleteWorker` with sync file | Scope counter increments correctly |
| `FilePipelineCompleteWorker` with upload file | Upload batch counter still works (regression) |
| `FilePipelineCompleteWorker` scope completion detection | `processing_completed + processing_failed >= processing_total` triggers event |
| `InitialSyncService` sets `processing_total` | Count matches newly enqueued files only |
| `DeltaSyncService` sets `processing_total` | Count matches newly enqueued + re-enqueued files |
| Date setting on create (Initial + Delta) | `file_modified_at` equals `external_modified_at` |
| Date setting on update (Delta only) | `file_modified_at` updated when eTag changes |
| Backfill migration | NULL → populated for cloud files, NULL → `created_at` for legacy local |
| Batch atomic create | All-or-nothing within `prisma.$transaction()` |

### 8.2 Integration Tests

| Test | Validates |
|---|---|
| End-to-end sync → processing → completion | `processing:completed` event fires after all files reach READY |
| Partial processing failure | `processing_status = 'partial_failure'` when some files fail |
| Upload pipeline regression | `batch:completed` still works (no changes to upload path) |
| Delta sync with processing tracking | Updated files increment counters correctly |

### 8.3 E2E Verification

1. Connect OneDrive, select folder with 10 files
2. Trigger sync — observe "Discovering files..." phase
3. After discovery: UI shows "Processing files... 0/10"
4. Watch progress increment: "Processing files... 5/10"
5. After all files processed: "10 files ready for search"
6. Search for file content — results should appear
7. Check file dates: cloud files should show original modification dates
8. Sort by date: cloud and local files should interleave correctly

---

## 9. Rollout Strategy

### Phase 1 (Week 1): Date Fidelity + Schema

- Steps 4.6-4.9: Set `file_modified_at` in sync services (4 code lines)
- Step 4.1: Add processing columns to `connection_scopes` schema
- Run backfill migration
- **Risk**: Minimal — additive schema change, no behavioral change

### Phase 2 (Week 1-2): Completion Tracking

- Step 4.2: Enhance `FilePipelineCompleteWorker` with scope awareness
- Step 4.3: Set `processing_total` in sync services
- Step 4.4: Add WebSocket events
- Step 4.5: Frontend two-phase display
- **Risk**: Medium — changes completion signaling, needs frontend coordination

### Phase 3 (Week 2-3): Ingestion Atomicity

- Step 4.10: Batch transaction in `InitialSyncService`
- **Risk**: Medium — changes write pattern, needs thorough testing

### Phase 4 (Week 3+): Architecture Cleanup

- Steps 4.12-4.14: Extract services and shared types
- **Risk**: Low — refactoring only, no behavioral change

---

## 10. Files Modified (Complete Inventory)

### Backend

| File | Change | Phase |
|---|---|---|
| `backend/prisma/schema.prisma` | Add `processing_*` columns to `connection_scopes`, add index on `file_modified_at` | 1 |
| `backend/src/services/sync/InitialSyncService.ts` | Set `file_modified_at`, set `processing_total`/`processing_status`, batch TX | 1-3 |
| `backend/src/services/sync/DeltaSyncService.ts` | Set `file_modified_at`, set `processing_total`/`processing_status` | 1-2 |
| `backend/src/infrastructure/queue/workers/FilePipelineCompleteWorker.ts` | Scope-aware counter + completion detection + WebSocket emission | 2 |
| `backend/scripts/migrations/backfill-file-modified-at.ts` | New — backfill script | 1 |
| `backend/scripts/database/add-processing-status-check.ts` | New — CHECK constraint | 1 |
| `backend/src/services/sync/SyncFileIngestionService.ts` | New — extracted file ingestion | 4 |
| `backend/src/services/sync/SyncProgressEmitter.ts` | New — centralized WebSocket emission | 4 |

### Shared Package

| File | Change | Phase |
|---|---|---|
| `packages/shared/src/constants/sync-events.ts` | Add `PROCESSING_PROGRESS`, `PROCESSING_COMPLETED` events | 2 |
| `packages/shared/src/types/sync-processing-events.types.ts` | New — processing event payload types | 2 |
| `packages/shared/src/index.ts` | Export new types and constants | 2 |

### Frontend

| File | Change | Phase |
|---|---|---|
| `frontend/src/domains/integrations/hooks/useSyncEvents.ts` | Handle `PROCESSING_PROGRESS`, `PROCESSING_COMPLETED` events | 2 |
| `frontend/src/domains/integrations/stores/syncStatusStore.ts` | Extend `SyncEntry` with processing state | 2 |
| `frontend/src/domains/integrations/components/SyncProgressPanel.tsx` | Two-phase progress display | 2 |

### Tests

| File | Type | Phase |
|---|---|---|
| `backend/src/__tests__/unit/infrastructure/queue/workers/FilePipelineCompleteWorker.test.ts` | Unit — scope-aware completion | 2 |
| `backend/src/__tests__/unit/services/sync/InitialSyncService.test.ts` | Unit — processing_total + file_modified_at | 1-3 |
| `backend/src/__tests__/unit/services/sync/DeltaSyncService.test.ts` | Unit — processing_total + file_modified_at | 1-2 |
| `backend/src/__tests__/integration/sync-processing-pipeline.test.ts` | Integration — end-to-end tracking | 2 |

---

## 11. Success Criteria

| # | Criterion | How to Verify |
|---|---|---|
| SC-1 | "Sync completed" toast appears only after discovery phase | UI shows "Discovering files..." → "Processing files..." two-step |
| SC-2 | "Ready for search" appears only when all files have embeddings | Search for file content immediately after "ready" — results found |
| SC-3 | Cloud files have `file_modified_at` populated | `SELECT COUNT(*) FROM files WHERE source_type IN ('onedrive','sharepoint') AND file_modified_at IS NULL AND deletion_status IS NULL` = 0 |
| SC-4 | File sorting by date works across all source types | Sort file list by "Modified" — cloud and local files interleave by original date |
| SC-5 | Partial processing failure shows correct status | Corrupt one file in scope → scope shows `partial_failure` with `49 ready, 1 failed` |
| SC-6 | Upload pipeline unchanged (regression) | Run full upload E2E test — `batch:completed` fires correctly |
| SC-7 | Scope processing counters are accurate | `processing_completed + processing_failed = processing_total` for completed scopes |
| SC-8 | `file_modified_at` has index | `SELECT name FROM sys.indexes WHERE object_id = OBJECT_ID('files') AND name = 'IX_files_user_modified_date'` returns 1 row |

---

## 12. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| `FilePipelineCompleteWorker` queries add latency to every file completion | Medium | Low | Queries are indexed (user_id + id), adds ~5ms per file |
| Scope counter race condition (concurrent workers) | Low | Medium | Raw SQL `SET col = col + 1` is atomic in SQL Server |
| Frontend shows "processing" indefinitely if worker crashes | Medium | Medium | `StuckFileRecoveryService` already detects stuck files (15min threshold) — add scope-level check in `MaintenanceWorker` |
| Backfill migration on large table blocks writes | Low | Medium | Use batched UPDATE with `TOP 1000` and loop |
| New WebSocket events not received by disconnected clients | Medium | Low | Frontend refreshes scope status via REST API on reconnect (existing pattern) |

---

## 13. Out of Scope

- **Full refactor of `InitialSyncService`** into separate orchestrator (Phase 4 is optional cleanup, not required for P0 fixes)
- **`fileSystemInfo` date source** — future enhancement if users report date discrepancies
- **Processing progress bar per-file for sync files** — `file:processing_progress` already emits per-file events; frontend can subscribe if needed
- **Retry UI for failed sync processing** — uses existing `StuckFileRecoveryService` + manual retry mechanisms
- **Multi-tenant deduplication** — deferred per 00-INDEX.md Section 7.1
