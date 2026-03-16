# Files Domain (Business Logic)

## Purpose

Pure business logic for file lifecycle: upload sessions, processing flow control, retry policies, state computation, WebSocket events, cleanup, and deletion. This directory defines **rules and state machines** while `services/files/` implements infrastructure.

## Upload Session Flow (6-Step HTTP Sequence)

Each step is a separate API call managed by `UploadSessionManager`:

1. **POST /upload-sessions/init** — `FolderNameResolver` checks duplicates (topological sort), creates session in Redis
2. **POST /upload-sessions/:id/folders/:tempId/create** — Creates folder record, resolves parent ID
3. **POST .../register-files** — Creates file records with `'uploading'` readiness (visible in UI immediately)
4. **POST .../sas-urls** — Generates SAS URLs for direct-to-blob upload (3hr expiry)
5. **POST .../mark-uploaded** — Sets `processing_status='pending_processing'` (scheduler picks up later)
6. **POST .../complete** — Marks batch as `'processing'`, checks for next pending folder

### Status Transitions

```
Session:  initializing → active → completed | failed | cancelled
Batch:    pending → creating → registering → uploading → processing → completed | failed
```

## FileProcessingScheduler (Backpressure)

Decouples upload from processing to prevent Redis OOM during bulk uploads.

- Every `checkIntervalMs`: check queue depth → if < `maxQueueDepth`, enqueue batch of `pending_processing` files
- Upload completes immediately; files drain at controlled rate

| Config | Env Var | Default |
|---|---|---|
| Batch size | `FILE_SCHEDULER_BATCH_SIZE` | 10 |
| Check interval | `FILE_SCHEDULER_CHECK_INTERVAL_MS` | 5000ms |
| Max queue depth | `FILE_SCHEDULER_MAX_QUEUE_DEPTH` | 50 |

## 3-Stage Queue Pipeline

After scheduler enqueues a file:

```
FILE_PROCESSING → FILE_CHUNKING → EMBEDDING_GENERATION
(download + extract text) → (split into chunks, insert DB) → (generate embeddings, index in AI Search)
```

On success: `readinessState` → `ready` (available for RAG). On failure: `ProcessingRetryManager` decides retry vs permanent failure.

## Readiness State Computation

`ReadinessStateComputer` — pure function, no side effects:

| processingStatus | embeddingStatus | → readinessState |
|---|---|---|
| completed | completed | **ready** |
| failed | any | **failed** |
| any | failed | **failed** |
| (other combinations) | | processing |

## Directory Structure

| Subdirectory | Purpose |
|---|---|
| `config/` | Centralized config: retry limits, cleanup retention, rate limits (Zod-validated, env var overrides) |
| `status/` | `ReadinessStateComputer` — pure mapping function |
| `retry/` | `ProcessingRetryManager`, `FileRetryService` — exponential backoff + jitter |
| `cleanup/` | `PartialDataCleaner` — removes orphaned chunks from failed processing |
| `emission/` | `FileEventEmitter`, `FolderEventEmitter` — WebSocket events |
| `bulk-upload/` | `BulkUploadProcessor` — legacy single-step upload (pre-session) |
| `deletion/` | `FileDeletionProcessor` — cascade delete (DB → blob → search index) |
| `upload-session/` | `UploadSessionManager`, `UploadSessionStore`, `FolderNameResolver`, `SessionCancellationHandler` |
| `scheduler/` | `FileProcessingScheduler` — backpressure-controlled scheduling |

## WebSocket Events

### File Events (FileEventEmitter)
`file:readiness_changed`, `file:permanently_failed`, `file:processing_progress`, `file:processing_completed`, `file:processing_failed` — emit to both `user:{userId}` and `{sessionId}` rooms.

### Folder Events (FolderEventEmitter)
`folder:session_started/completed/failed/cancelled`, `folder:batch_started/progress/completed/failed` — emit to `user:{userId}` only.

## Configuration

Retry: `FILE_MAX_PROCESSING_RETRIES` (2), `FILE_MAX_EMBEDDING_RETRIES` (3), exponential backoff with jitter.
Cleanup: `FILE_FAILED_RETENTION_DAYS` (30), `FILE_ORPHANED_CHUNK_RETENTION_DAYS` (7).
Rate limit: `FILE_MAX_MANUAL_RETRIES_PER_HOUR` (10).

Formula: `delay = min(baseDelay × multiplier^retryCount, maxDelay) × (1 + random × jitter)`

## Key Patterns

1. **Singleton + Lazy Getters**: `getInstance()` with `() => getRepo()` to avoid circular init
2. **Fire-and-Forget**: WebSocket events and async cleanup never fail the main operation
3. **State Machine Enforcement**: Methods validate current status before proceeding
4. **Multi-Tenant Isolation**: Every query includes `userId`
5. **Topological Ordering**: `FolderNameResolver` sorts parents-first (DFS)
6. **Idempotent Cancellation**: `SessionCancellationHandler` safe to call multiple times

## Troubleshooting

- **Stuck in "processing"**: Check `processing_retry_count`, worker logs (`LOG_SERVICES=FileProcessingService`)
- **Stuck in "pending_processing"**: Verify `FileProcessingScheduler` running, check queue depth, Redis connection
- **Not in search**: Verify `embedding_status='completed'` + `readiness_state='ready'`
- **Upload session stuck**: Check Redis key `upload-session:{id}`, TTL, folder batch state

## Cross-References

- Infrastructure: `services/files/CLAUDE.md` | Search: `services/search/CLAUDE.md` | Queue: `infrastructure/queue/CLAUDE.md`
