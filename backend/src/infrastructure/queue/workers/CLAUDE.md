# Queue Workers

## Purpose

BullMQ job processors for the file processing pipeline, external sync, and scheduled maintenance. Each worker is a stateless class that receives a parent logger from `MessageQueue` and creates a per-job child logger for structured tracing.

## Worker Inventory

| Worker | Concurrency | Purpose |
|---|---|---|
| `FileExtractWorker` | 8 | Text extraction via `FileProcessingService`. First stage of processing flow. |
| `FileChunkWorker` | 5 | Text chunking via `FileChunkingService`. Second stage. |
| `FileEmbedWorker` | 5 | Embedding generation (Cohere) + Azure AI Search indexing. Third stage. Emits `readiness_changed` on success. |
| `FilePipelineCompleteWorker` | 10 | Final stage. Increments `processed_count`/`processing_completed`/`processing_failed` counters. Emits scope-level `SYNC_WS_EVENTS.PROCESSING_PROGRESS` and `PROCESSING_COMPLETED` when all files are done. |
| `FileDeletionWorker` | 1 | Cascade file deletion. Sequential to prevent SQL deadlocks. Delegates to `FileDeletionProcessor`. |
| `ExternalFileSyncWorker` | — | Runs initial or delta sync for a connection scope. Routes `triggerType='initial'` to `InitialSyncService` and all others to `DeltaSyncService`. Throws `UnrecoverableError` on `ConnectionTokenExpiredError`. |
| `MaintenanceWorker` | 1 | Routes `FILE_MAINTENANCE` queue jobs by `job.name` to maintenance service singletons (lazy-imported). |
| `SubscriptionRenewalWorker` | — | Renews expiring Graph API subscriptions or runs polling-fallback delta syncs. |

## CAS (Compare-And-Swap) State Transitions

All file pipeline workers use atomic `WHERE pipeline_status = @from` guards to prevent race conditions:

```
FileExtractWorker:  queued → extracting → chunking   (or → failed)
FileChunkWorker:    chunking → embedding              (or → failed)
FileEmbedWorker:    embedding → ready                 (or → failed)
```

`repo.transitionStatus(fileId, userId, fromStatus, toStatus)` returns `{ success, error, previousStatus }`. If `success` is false, the worker logs a warning and returns without throwing — another worker or retry already claimed the file.

## Two Pipelines, One Completion Worker

`FilePipelineCompleteWorker` handles both upload and sync files:

- **Upload pipeline**: `batchId` = upload batch UUID. Increments `upload_batches.processed_count`. Emits batch progress events.
- **Sync pipeline**: `batchId` = scope UUID (matches `connection_scopes.id`). Increments `connection_scopes.processing_completed` or `processing_failed`. Emits `SYNC_WS_EVENTS.PROCESSING_PROGRESS` and `PROCESSING_COMPLETED` when `totalProcessed >= processing_total`.
- **External sync files with no batch**: `batchId` is absent — batch tracking is skipped entirely.

## Logger Injection Pattern

All workers accept an optional `{ logger }` dependency. `MessageQueue` injects a child of its own logger so that all job logs share the queue-level context:

```typescript
// In MessageQueue.ts
const worker = new FileExtractWorker({ logger: this.log.child({ worker: 'extract' }) });

// In each worker process() method
const jobLogger = this.log.child({ fileId, batchId, userId, jobId: job.id, stage: 'extract' });
```

Never use `console.log` in workers. Always derive `jobLogger` from `this.log`.

## External File 404 Handling

`FileExtractWorker` catches `GraphApiError` with `statusCode === 404` for OneDrive/SharePoint files. Instead of retrying, it:

1. Soft-deletes the file record (sets BOTH `deleted_at` and `deletion_status: 'pending'`).
2. Best-effort cleans up vector chunks and DB chunks.
3. Returns without rethrowing — BullMQ marks the job as completed, not failed.

## Permanent Failure Path

When a non-404 error propagates after all BullMQ retry attempts:

1. CAS transition to `PIPELINE_STATUS.FAILED`.
2. Add a DLQ entry via `DLQService`.
3. Call `ProcessingRetryManager.handlePermanentFailure()` to emit `file:permanently_failed` + `file:readiness_changed` WebSocket events.
4. Rethrow for BullMQ.

## Worker Event Handling

`WorkerRegistry.setupWorkerEventHandlers()` attaches `error`, `failed`, and `stalled` listeners to every registered worker. Stalled jobs are automatically retried up to `MAX_STALLED_COUNT` (from `LOCK_CONFIG`).

## MaintenanceWorker Job Routing

| `job.name` | Service |
|---|---|
| `stuck-file-recovery` | `StuckFileRecoveryService` |
| `orphan-cleanup` | `OrphanCleanupService` |
| `batch-timeout` | `BatchTimeoutService` |
| `sync-health-check` | `SyncHealthCheckService` (PRD-300) |
| `sync-reconciliation` | `SyncReconciliationService` (PRD-300) |

All imports are dynamic (`await import(...)`) inside switch cases to avoid circular dependencies at module load.

## Related

- Flow orchestration: `../flow/CLAUDE.md` — BullMQ Flow tree structure
- Parent queue module: `../CLAUDE.md` — concurrency, constants, DI wiring
- File emission: `../../../domains/files/emission/CLAUDE.md` — WebSocket events emitted after embed
- Retry domain: `../../../domains/files/retry/CLAUDE.md` — permanent failure handling
- Sync services: `../../../services/sync/CLAUDE.md` — InitialSyncService, DeltaSyncService
