# Files Domain

## Purpose

Business logic for file lifecycle management: upload, processing, chunking, embedding, retry, cleanup, and deletion. Pure domain logic that orchestrates file state transitions without infrastructure concerns.

## Architecture

```
domains/files/
├── config/                  # Configuration
│   └── file-processing.config.ts   # Retry, cleanup, rate limit settings
├── status/                  # State management
│   └── ReadinessStateComputer.ts   # Pure function: status → readinessState
├── retry/                   # Retry orchestration
│   ├── ProcessingRetryManager.ts   # Decides retry vs permanent failure
│   └── FileRetryService.ts         # Executes retry logic
├── cleanup/                 # Data cleanup
│   └── PartialDataCleaner.ts       # Removes orphaned chunks/search docs
├── emission/                # WebSocket events
│   └── FileEventEmitter.ts         # Emits file:* events
├── bulk-upload/             # Bulk upload orchestration
│   └── BulkUploadProcessor.ts      # SAS URLs, job enqueuing
├── deletion/                # File deletion
│   └── FileDeletionProcessor.ts    # Cascade delete orchestration
└── index.ts                 # Public exports
```

## File Lifecycle States

```
┌──────────────────────────────────────────────────────────────────────┐
│                        FILE LIFECYCLE                                 │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Upload                                                               │
│    │                                                                  │
│    ▼                                                                  │
│  ┌─────────────┐                                                      │
│  │ processing  │◄────────────────────────────────────┐               │
│  │ pending     │                                      │               │
│  └──────┬──────┘                                      │               │
│         │                                             │               │
│         ▼ (FILE_PROCESSING worker)                    │               │
│  ┌─────────────┐     ┌─────────────┐                 │               │
│  │ processing  │────►│ processing  │  (retry)        │               │
│  │ processing  │     │ failed      │─────────────────┘               │
│  └──────┬──────┘     └──────┬──────┘                                 │
│         │                   │                                         │
│         │                   │ (max retries)                          │
│         │                   ▼                                         │
│         │            ┌─────────────┐                                 │
│         │            │   FAILED    │ ← Permanent failure             │
│         │            │ (user can   │                                 │
│         │            │  manually   │                                 │
│         │            │  retry)     │                                 │
│         │            └─────────────┘                                 │
│         ▼                                                             │
│  ┌─────────────┐                                                      │
│  │ embedding   │                                                      │
│  │ pending     │                                                      │
│  └──────┬──────┘                                                      │
│         │                                                             │
│         ▼ (EMBEDDING_GENERATION worker)                               │
│  ┌─────────────┐                                                      │
│  │ embedding   │                                                      │
│  │ completed   │                                                      │
│  └──────┬──────┘                                                      │
│         │                                                             │
│         ▼                                                             │
│  ┌─────────────┐                                                      │
│  │   READY     │ ← File available for RAG                            │
│  └─────────────┘                                                      │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## Readiness State Computation

**ReadinessStateComputer** is a pure function that determines unified state:

| processingStatus | embeddingStatus | readinessState |
|-----------------|-----------------|----------------|
| pending         | pending         | processing     |
| processing      | pending         | processing     |
| completed       | pending         | processing     |
| completed       | processing      | processing     |
| completed       | completed       | **ready**      |
| failed          | any             | **failed**     |
| any             | failed          | **failed**     |

## Configuration

### Environment Variables

```bash
# Retry settings
FILE_MAX_PROCESSING_RETRIES=2    # Default: 2
FILE_MAX_EMBEDDING_RETRIES=3     # Default: 3
FILE_RETRY_BASE_DELAY_MS=5000    # Default: 5000
FILE_RETRY_MAX_DELAY_MS=60000    # Default: 60000
FILE_RETRY_BACKOFF_MULTIPLIER=2  # Default: 2

# Cleanup settings
FILE_FAILED_RETENTION_DAYS=30    # Keep failed files 30 days
FILE_CLEANUP_BATCH_SIZE=100      # Cleanup batch size

# Rate limits
FILE_MAX_MANUAL_RETRIES_PER_HOUR=10  # Manual retry limit
```

### Retry Policy

Exponential backoff with jitter:
```typescript
delay = min(baseDelay * multiplier^retryCount, maxDelay) * (1 + random * jitter)

// Example: baseDelay=5000, multiplier=2, jitter=0.1
// Retry 1: ~5000ms
// Retry 2: ~10000ms
// Retry 3: ~20000ms (capped at maxDelay if exceeded)
```

## WebSocket Events Emitted

| Event | Channel | Trigger |
|-------|---------|---------|
| `file:uploaded` | file:status | Bulk upload record created |
| `file:readiness_changed` | file:status | State transition |
| `file:processing_progress` | file:processing | Progress update (0-100%) |
| `file:processing_completed` | file:processing | Text extraction done |
| `file:processing_failed` | file:processing | Processing error (pre-retry) |
| `file:permanently_failed` | file:status | Max retries exceeded |
| `file:deleted` | file:status | Deletion completed |

## Inputs/Outputs

### BulkUploadProcessor

**Input**: Bulk upload init request
```typescript
const result = await processor.initiateBulkUpload({
  userId: 'USER-123',
  files: [{ tempId: 'temp-1', fileName: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 1024 }],
  parentFolderId: 'FOLDER-456',
});
```

**Output**: SAS URLs for direct blob upload
```typescript
{
  batchId: 'BATCH-789',
  files: [{
    tempId: 'temp-1',
    sasUrl: 'https://storage.blob...',
    blobPath: 'users/USER-123/files/...',
    expiresAt: '2026-01-15T12:00:00Z'
  }]
}
```

### ProcessingRetryManager

**Input**: File processing failure
```typescript
const decision = await retryManager.shouldRetry('FILE-123', 'processing');
```

**Output**: Retry decision
```typescript
{
  shouldRetry: true,
  newRetryCount: 2,
  maxRetries: 2,
  backoffDelayMs: 10000,
  reason: 'within_limit'
}
```

## Interconexions

### Consumes

- **FileRepository** (services/files): Database operations
- **MessageQueue** (infrastructure/queue): Job enqueuing
- **Azure Blob Storage**: SAS URL generation
- **Azure AI Search**: Search document deletion (cleanup)

### Consumed By

- **FileRoutes** (routes/files): HTTP endpoints
- **FileProcessingWorker** (queue/workers): Processing pipeline
- **EmbeddingGenerationWorker** (queue/workers): Embedding pipeline

## Patterns to Follow

### State Changes

Always use `FileEventEmitter` for state transitions:
```typescript
// Don't update DB directly without emitting
await repository.updateStatus(fileId, { processingStatus: 'completed' });
await emitter.emitReadinessChanged(fileId, userId, newState); // Required!
```

### Error Handling

Use `ProcessingRetryManager` for retry decisions:
```typescript
const decision = await retryManager.shouldRetry(fileId, phase);
if (decision.shouldRetry) {
  await queue.enqueueWithDelay(job, decision.backoffDelayMs);
} else {
  await emitter.emitPermanentlyFailed(fileId, userId, error);
}
```

## Known Limitations

1. **No partial processing recovery**: If processing fails mid-chunk, starts over
2. **Sequential embedding**: Chunks are embedded one at a time (could batch)
3. **Rate limit on manual retry**: 10 retries/hour/user
4. **No webhook notifications**: Only WebSocket events

## Troubleshooting

### File Stuck in "processing"

1. Check `processing_retry_count` in database
2. Look for errors in worker logs
3. Verify OpenAI API is accessible (for embeddings)

### Files Not Appearing in Search

1. Verify `embedding_status = 'completed'`
2. Check Azure AI Search index has the document
3. Verify `readiness_state = 'ready'`

### Cleanup Not Running

1. Check `FileCleanupWorker` is registered
2. Verify cron schedule in `ScheduledJobManager`
3. Check Redis connection for BullMQ

## Related Documentation

- Queue infrastructure: `infrastructure/queue/CLAUDE.md`
- HTTP endpoints: `routes/files/CLAUDE.md`
- Shared types: `@bc-agent/shared` FILE_WS_EVENTS
