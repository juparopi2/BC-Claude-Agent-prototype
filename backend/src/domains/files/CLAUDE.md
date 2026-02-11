# Files Domain (Business Logic)

## Purpose

Pure business logic for file lifecycle orchestration — upload sessions, processing flow control, retry policies, state computation, WebSocket event emission, cleanup, and deletion. This directory defines the **rules and state machines** while `services/files/` implements the infrastructure.

## Relationship to Other Directories

```
    Frontend (drag-and-drop)
           │
           ▼
    routes/files/upload-session.routes.ts  ──► HTTP endpoints
           │
           ▼
┌────────────────────────────────────────────────────────────────────────┐
│  domains/files/  (THIS DIRECTORY)                                      │
│                                                                        │
│  ┌────────────────────┐  ┌────────────────────┐  ┌─────────────────┐  │
│  │ UploadSessionManager│  │FileProcessing      │  │ FileEvent       │  │
│  │ (session lifecycle) │  │Scheduler           │  │ Emitter         │  │
│  │                    │  │(backpressure)       │  │ FolderEvent     │  │
│  │ FolderNameResolver │  │                    │  │ Emitter         │  │
│  │ SessionCancellation│  │                    │  │ (WebSocket)     │  │
│  │ Handler            │  │                    │  │                 │  │
│  └─────────┬──────────┘  └────────┬───────────┘  └─────────────────┘  │
│            │                      │                                    │
│  ┌─────────┴──────────┐  ┌───────┴────────────┐  ┌─────────────────┐  │
│  │ BulkUploadProcessor│  │ProcessingRetry     │  │ReadinessState   │  │
│  │ (legacy upload)    │  │Manager             │  │Computer         │  │
│  │                    │  │FileRetryService    │  │(pure function)  │  │
│  └────────────────────┘  └────────────────────┘  └─────────────────┘  │
│                                                                        │
│  ┌────────────────────┐  ┌────────────────────┐                       │
│  │ FileDeletion       │  │ PartialData        │                       │
│  │ Processor          │  │ Cleaner            │                       │
│  │ (cascade delete)   │  │ (orphan cleanup)   │                       │
│  └────────────────────┘  └────────────────────┘                       │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │ delegates to
                                  ▼
                    services/files/  (infrastructure)
                    services/search/ (Azure AI Search)
                    infrastructure/queue/ (BullMQ)
```

## Upload Session Flow (6-Step HTTP Sequence)

The frontend uploads folders via a multi-step HTTP protocol. Each step is a separate API call managed by `UploadSessionManager`:

```
Step 1: POST /upload-sessions/init
  ├── Input: { folders: FolderInput[], targetFolderId? }
  ├── FolderNameResolver checks for duplicates (topological sort, suffix resolution)
  ├── Creates UploadSession in Redis (TTL-based, multi-session support)
  ├── Status: session='active', batches='pending'
  └── Output: { session, renamedFolders[] }

Step 2: POST /upload-sessions/:id/folders/:tempId/create
  ├── Creates folder record in database
  ├── Resolves parent folder ID (from DB or from earlier batch)
  ├── Status: batch='creating' → 'registering'
  └── Output: { folderId, folderBatch }

Step 3: POST /upload-sessions/:id/folders/:tempId/register-files
  ├── Creates file records in DB with 'uploading' readiness (files visible in UI immediately)
  ├── Generates placeholder blob paths
  ├── Validates/sanitizes file names server-side
  ├── Status: batch='registering' → 'uploading'
  └── Output: { registered: [{tempId, fileId}], folderBatch }

Step 4: POST /upload-sessions/:id/folders/:tempId/sas-urls
  ├── Generates SAS URLs for direct-to-blob upload (3hr expiry)
  ├── Includes retry logic for state transition race conditions (3 attempts, 100ms delay)
  └── Output: FileSasInfo[] with sasUrl, blobPath, expiresAt

Step 5: POST /upload-sessions/:id/folders/:tempId/mark-uploaded  (per file)
  ├── Updates file record with real blobPath + contentHash
  ├── Sets processing_status='pending_processing' (NOT 'pending')
  ├── FileProcessingScheduler will pick up the file later (backpressure)
  └── Output: { success, folderBatch }

Step 6: POST /upload-sessions/:id/folders/:tempId/complete
  ├── Marks batch as 'processing'
  ├── Increments session completed folder count
  ├── Checks for next pending folder
  └── Output: { success, hasNextFolder, session }
```

### Session Status Transitions

```
Session:  initializing → active → completed
                           ↓
                         failed (too many folder failures)
                           ↓
                       cancelled (user-initiated via SessionCancellationHandler)

Batch:    pending → creating → registering → uploading → processing → completed
                       ↓           ↓            ↓
                     failed      failed        failed
```

### Session Limits (from FOLDER_UPLOAD_CONFIG)

- Max folders per session: configurable
- Max concurrent sessions per user: configurable
- Session TTL: Redis-based with heartbeat extension
- Max consecutive failures before abort: configurable

## FileProcessingScheduler (Backpressure)

Decouples upload from processing to prevent Redis OOM during bulk uploads.

```
┌─────────────────────────────────────────────────────────┐
│                  FileProcessingScheduler                  │
│                                                          │
│  Every {checkIntervalMs}:                                │
│  1. Check FILE_PROCESSING queue depth (waiting+active)   │
│  2. If depth >= maxQueueDepth → skip (backpressure)      │
│  3. Calculate available slots                            │
│  4. Query DB for files with status='pending_processing'  │
│  5. Enqueue min(batchSize, availableSlots) files         │
│  6. Update each file status → 'pending'                  │
└─────────────────────────────────────────────────────────┘
```

| Config | Env Var | Default |
|---|---|---|
| Batch size | `FILE_SCHEDULER_BATCH_SIZE` | 10 |
| Check interval | `FILE_SCHEDULER_CHECK_INTERVAL_MS` | 5000ms |
| Max queue depth | `FILE_SCHEDULER_MAX_QUEUE_DEPTH` | 50 |

**Key property**: Upload completes immediately. Files sit in `pending_processing` status until the scheduler picks them up. This means a user uploading 500 files won't flood Redis — the scheduler drains them at a controlled rate.

## 3-Stage Queue Pipeline

After the scheduler enqueues a file, it flows through three sequential queues:

```
┌───────────────┐     ┌───────────────┐     ┌─────────────────────┐
│FILE_PROCESSING│────►│FILE_CHUNKING  │────►│EMBEDDING_GENERATION │
│               │     │               │     │                     │
│ Download blob │     │ Split text    │     │ Generate embeddings │
│ Extract text  │     │ into chunks   │     │ Index in AI Search  │
│ (PDF/DOCX/    │     │ (512 tokens,  │     │                     │
│  XLSX/Text/   │     │  50 overlap)  │     │ Text: 1536d OpenAI  │
│  Image)       │     │ Insert to DB  │     │ Image: 1024d Vision │
│               │     │               │     │                     │
│ Concurrency:  │     │ Enqueue next  │     │ Emit readiness_     │
│ per worker    │     │ stage         │     │ changed event       │
└───────────────┘     └───────────────┘     └─────────────────────┘
```

On success: `readinessState` transitions to `ready` (file available for RAG).
On failure: `ProcessingRetryManager` decides retry vs. permanent failure.

## Directory Structure

| Subdirectory | Files | Purpose |
|---|---|---|
| `config/` | `file-processing.config.ts` | Centralized config: retry limits, cleanup retention, rate limits. Zod-validated, env var overrides, cached |
| `status/` | `ReadinessStateComputer.ts` | Pure function mapping (processingStatus, embeddingStatus) → readinessState |
| `retry/` | `ProcessingRetryManager.ts`, `FileRetryService.ts`, interfaces | Retry decision logic with exponential backoff + jitter |
| `cleanup/` | `PartialDataCleaner.ts`, interface | Removes orphaned chunks and search documents from failed processing |
| `emission/` | `FileEventEmitter.ts`, `FolderEventEmitter.ts`, interfaces | WebSocket event emission for file and folder status updates |
| `bulk-upload/` | `BulkUploadProcessor.ts`, interface | Legacy single-step bulk upload (pre-session flow) |
| `deletion/` | `FileDeletionProcessor.ts`, interface | Cascade deletion orchestration (DB → blob → search index) |
| `upload-session/` | `UploadSessionManager.ts`, `UploadSessionStore.ts`, `FolderNameResolver.ts`, `SessionCancellationHandler.ts`, interfaces | Full upload session lifecycle (see 6-step flow above) |
| `scheduler/` | `FileProcessingScheduler.ts` | Backpressure-controlled scheduling of file processing jobs |

## Readiness State Computation

`ReadinessStateComputer` is a **pure function** — no side effects, no I/O:

| processingStatus | embeddingStatus | readinessState |
|---|---|---|
| pending | pending | processing |
| processing | pending | processing |
| completed | pending | processing |
| completed | processing | processing |
| completed | completed | **ready** |
| failed | any | **failed** |
| any | failed | **failed** |

## WebSocket Events

### File Events (FileEventEmitter)

| Event | Channel | Trigger |
|---|---|---|
| `file:readiness_changed` | `file:status` | State transition (processing → ready, etc.) |
| `file:permanently_failed` | `file:status` | Max retries exceeded |
| `file:processing_progress` | `file:processing` | Progress update (0–100%) with attempt number |
| `file:processing_completed` | `file:processing` | Text extraction completed |
| `file:processing_failed` | `file:processing` | Processing error (pre-retry) |

File events emit to **both** `user:{userId}` room (file explorer) and `{sessionId}` room (chat context).

### Folder Events (FolderEventEmitter)

| Event | Channel | Trigger |
|---|---|---|
| `folder:session_started` | `folder:status` | Upload session initialized |
| `folder:session_completed` | `folder:status` | All folders processed |
| `folder:session_failed` | `folder:status` | Session aborted |
| `folder:session_cancelled` | `folder:status` | User cancelled session |
| `folder:batch_started` | `folder:status` | Folder processing began |
| `folder:batch_progress` | `folder:status` | Folder upload progress |
| `folder:batch_completed` | `folder:status` | Folder processing done |
| `folder:batch_failed` | `folder:status` | Folder processing error |

Folder events emit to `user:{userId}` room only.

## Configuration Reference

### Retry Settings

| Env Var | Default | Description |
|---|---|---|
| `FILE_MAX_PROCESSING_RETRIES` | 2 | Max retries for text extraction |
| `FILE_MAX_EMBEDDING_RETRIES` | 3 | Max retries for embedding generation |
| `FILE_RETRY_BASE_DELAY_MS` | 5000 | Base delay for exponential backoff |
| `FILE_RETRY_MAX_DELAY_MS` | 60000 | Max delay cap |
| `FILE_RETRY_BACKOFF_MULTIPLIER` | 2 | Backoff multiplier |
| `FILE_RETRY_JITTER_FACTOR` | 0.1 | Jitter to prevent thundering herd |

### Retry Formula

```
delay = min(baseDelay * multiplier^retryCount, maxDelay) * (1 + random * jitter)
```

### Cleanup Settings

| Env Var | Default | Description |
|---|---|---|
| `FILE_FAILED_RETENTION_DAYS` | 30 | Days to keep failed files |
| `FILE_ORPHANED_CHUNK_RETENTION_DAYS` | 7 | Days to keep orphaned chunks |
| `FILE_CLEANUP_BATCH_SIZE` | 100 | Cleanup batch size |
| `FILE_MAX_MANUAL_RETRIES_PER_HOUR` | 10 | Rate limit for user-initiated retries |

### Scheduler Settings

| Env Var | Default | Description |
|---|---|---|
| `FILE_SCHEDULER_BATCH_SIZE` | 10 | Max files to enqueue per cycle |
| `FILE_SCHEDULER_CHECK_INTERVAL_MS` | 5000 | Polling interval |
| `FILE_SCHEDULER_MAX_QUEUE_DEPTH` | 50 | Max queue depth before pausing |

## Key Patterns

1. **Singleton + Lazy Getters**: All domain classes use `getInstance()` with dependency injection. Dependencies use lazy getter functions (`() => getRepo()`) to avoid circular initialization issues.

2. **Fire-and-Forget for Side Effects**: WebSocket events, usage tracking, and async cleanup never fail the main operation. Errors are logged but swallowed.

3. **State Machine Enforcement**: Upload session batches follow strict status transitions (`pending` → `creating` → `registering` → `uploading` → `processing`). Methods validate current status before proceeding.

4. **Multi-Tenant Isolation**: Every database query and file operation includes `userId`. Session ownership is verified on every API call.

5. **Topological Ordering**: `FolderNameResolver` sorts folders parents-first (DFS) to resolve parent IDs before children.

6. **Idempotent Cancellation**: `SessionCancellationHandler` is safe to call multiple times. Reuses `SoftDeleteService` for consistent cleanup.

## Known Limitations

1. **No partial processing recovery**: If text extraction fails mid-way, it starts over from scratch
2. **Sequential embedding within a file**: Chunks for a single file are embedded one at a time (batching possible but not implemented)
3. **Rate limit on manual retry**: 10 retries/hour/user
4. **No webhook notifications**: Only WebSocket events (no HTTP callbacks)
5. **Resumable upload**: `refreshExpiredSasUrls()` is stubbed — not yet implemented

## Troubleshooting

### File Stuck in "processing"
1. Check `processing_retry_count` in database
2. Look for errors in worker logs (`LOG_SERVICES=FileProcessingService`)
3. Verify Azure Blob Storage is accessible (blob download may fail)

### File Stuck in "pending_processing"
1. Verify `FileProcessingScheduler` is running (`isSchedulerRunning()`)
2. Check FILE_PROCESSING queue depth (may be at capacity)
3. Check Redis connection for BullMQ

### Files Not Appearing in Search
1. Verify `embedding_status = 'completed'`
2. Check `readiness_state = 'ready'`
3. See `services/search/CLAUDE.md` for index troubleshooting

### Upload Session Stuck
1. Check Redis for session key (`upload-session:{id}`)
2. Verify session TTL hasn't expired
3. Check for folder batch in `'failed'` state
4. Cancel stale session via `SessionCancellationHandler`

## Cross-References

- **Infrastructure services**: `services/files/CLAUDE.md` — FileProcessingService, FileChunkingService, processors
- **Search integration**: `services/search/CLAUDE.md` — VectorSearchService, SemanticSearchService
- **Queue infrastructure**: `infrastructure/queue/` — MessageQueue, workers
- **HTTP routes**: `routes/files/upload-session.routes.ts` — Upload session endpoints
- **Shared types**: `@bc-agent/shared` — FILE_WS_EVENTS, FOLDER_WS_EVENTS, FOLDER_UPLOAD_CONFIG, upload-session types
