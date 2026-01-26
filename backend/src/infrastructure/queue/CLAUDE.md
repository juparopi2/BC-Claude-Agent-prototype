# Infrastructure Queue Module

## Purpose

BullMQ-based message queue infrastructure for asynchronous job processing. Handles file processing, embedding generation, message persistence, and scheduled tasks.

## Architecture

```
queue/
├── core/                    # Core queue infrastructure
│   ├── RedisConnectionManager.ts  # Redis connection pooling
│   ├── QueueManager.ts            # Queue creation and management
│   ├── WorkerRegistry.ts          # Worker registration and lifecycle
│   ├── QueueEventManager.ts       # Event handling across queues
│   ├── ScheduledJobManager.ts     # Cron-based scheduled jobs
│   └── RateLimiter.ts             # Redis-based rate limiting
├── workers/                 # Job processors
│   ├── FileProcessingWorker.ts    # Text extraction (bottleneck worker)
│   ├── FileChunkingWorker.ts      # Text chunking for RAG
│   ├── EmbeddingGenerationWorker.ts # Vector embedding via OpenAI
│   ├── FileBulkUploadWorker.ts    # DB record creation for bulk uploads
│   ├── FileDeletionWorker.ts      # Cascade delete (sequential)
│   ├── FileCleanupWorker.ts       # Scheduled cleanup
│   ├── MessagePersistenceWorker.ts # Chat message persistence
│   ├── ToolExecutionWorker.ts     # Agent tool execution
│   ├── EventProcessingWorker.ts   # Event store processing
│   ├── CitationPersistenceWorker.ts # RAG citation storage
│   └── UsageAggregationWorker.ts  # Billing aggregation
├── constants/
│   └── queue.constants.ts   # Queue names, rate limits, concurrency
├── types/
│   └── jobs.types.ts        # Job data interfaces
├── MessageQueue.ts          # Main facade for enqueuing jobs
├── IMessageQueueDependencies.ts # DI interfaces
└── index.ts                 # Public exports
```

## Configuration

### Environment Variables

```bash
# Queue name prefix (use 'local' for dev to avoid conflicts)
QUEUE_NAME_PREFIX=local

# Worker concurrency settings
QUEUE_MESSAGE_CONCURRENCY=10    # Message persistence
QUEUE_TOOL_CONCURRENCY=5        # Tool execution
QUEUE_EVENT_CONCURRENCY=10      # Event processing
QUEUE_USAGE_CONCURRENCY=1       # Usage aggregation
QUEUE_FILE_PROCESSING_CONCURRENCY=8  # Text extraction (increased from 3)
QUEUE_FILE_CHUNKING_CONCURRENCY=5    # Text chunking
QUEUE_EMBEDDING_CONCURRENCY=5        # Vector embeddings
```

### Constants (`queue.constants.ts`)

| Constant | Default | Purpose |
|----------|---------|---------|
| `RATE_LIMIT.MAX_JOBS_PER_SESSION` | 1000 | Max jobs per user per hour |
| `RATE_LIMIT.WINDOW_SECONDS` | 3600 | Rate limit window (1 hour) |
| `DEFAULT_CONCURRENCY.FILE_PROCESSING` | 8 | Parallel text extraction workers |

## Rate Limiting

**Critical Behavior**: Jobs exceeding rate limit are **silently rejected** (not re-enqueued).

```typescript
// RateLimiter.ts behavior
async checkLimit(sessionId: string): Promise<boolean> {
  const count = await redis.incr(key);
  return count <= MAX_JOBS_PER_SESSION;  // 1000 jobs/hour
}
```

**Implication**: For 280 files with the old 100 limit, 180 jobs would be lost silently.

## Job Processing Pipeline (File Upload)

```
1. FILE_BULK_UPLOAD (20 concurrent)
   └─ Creates DB record, emits file:uploaded
       │
       ▼
2. FILE_PROCESSING (8 concurrent) ← BOTTLENECK
   └─ Extracts text (PDF, DOCX, images via OCR)
       │
       ▼
3. FILE_CHUNKING (5 concurrent)
   └─ Splits text into ~1000 token chunks
       │
       ▼
4. EMBEDDING_GENERATION (5 concurrent)
   └─ Generates vectors via OpenAI API
       │
       ▼
5. file:readiness_changed → ready (via WebSocket)
```

## Worker Concurrency Matrix

| Queue | Concurrency | Constraint |
|-------|-------------|------------|
| FILE_BULK_UPLOAD | 20 | DB pool (30 connections) |
| FILE_PROCESSING | 8 | CPU-bound text extraction |
| FILE_CHUNKING | 5 | Memory for large documents |
| EMBEDDING_GENERATION | 5 | OpenAI TPM rate limits |
| FILE_DELETION | 1 | Prevents SQL deadlocks |
| USAGE_AGGREGATION | 1 | Sequential aggregation |

## Inputs/Outputs

### Input (Enqueue)

```typescript
import { getMessageQueue } from '@/infrastructure/queue';

const queue = getMessageQueue();
await queue.enqueueFileProcessing({
  fileId: 'FILE-123',
  userId: 'USER-456',
  sessionId: 'SESSION-789',
});
```

### Output (WebSocket Events)

Workers emit events via `FileEventEmitterService`:
- `file:uploaded` - Bulk upload record created
- `file:readiness_changed` - Status transition
- `file:processing_progress` - Progress updates
- `file:permanently_failed` - Max retries exceeded

## Interconexions

### Consumes

- **Redis**: Connection via `RedisConnectionManager`
- **Database Pool**: Via `getPool()` for worker DB operations
- **Azure Blob Storage**: File content access
- **OpenAI API**: Embedding generation
- **Azure AI Search**: Vector indexing

### Consumed By

- **FileProcessingService**: Enqueues processing jobs
- **BulkUploadProcessor**: Enqueues bulk upload jobs
- **FileRepository**: Enqueues deletion jobs
- **AgentOrchestrator**: Enqueues message persistence

## Patterns to Follow

### Adding a New Worker

1. Create `workers/MyNewWorker.ts`:
```typescript
export class MyNewWorker {
  private readonly log = createChildLogger({ service: 'MyNewWorker' });

  async process(job: Job<MyJobData>): Promise<void> {
    // Process job
  }
}
```

2. Add queue name to `QueueName` enum in `queue.constants.ts`
3. Register worker in `WorkerRegistry.ts`
4. Add concurrency env var to `environment.ts`

### Error Handling

```typescript
// Workers should use exponential backoff
const backoff = DEFAULT_BACKOFF.FILE_PROCESSING; // { type: 'exponential', delay: 5000, attempts: 2 }
```

## Known Limitations

1. **Rate limit on jobs, not throughput**: The rate limit counts jobs, not bytes/tokens
2. **No dead letter queue**: Failed jobs stay in BullMQ failed state
3. **Sequential deletion**: FILE_DELETION runs at concurrency=1 to avoid deadlocks
4. **OpenAI TPM bottleneck**: Embedding worker limited by API rate limits

## Troubleshooting

### Jobs Being Lost

Check rate limit:
```typescript
const status = await rateLimiter.getStatus(sessionId);
console.log(status); // { count: 150, limit: 1000, remaining: 850, withinLimit: true }
```

### Queue Backlog

Monitor via BullMQ:
```bash
# Connect to Redis and check queue length
redis-cli LLEN "bull:file-processing:wait"
```

### Worker Not Processing

Verify worker registration:
```typescript
// WorkerRegistry registers workers on init
const registry = getWorkerRegistry();
await registry.startAll();
```

## Related Documentation

- Main CLAUDE.md: Section 3.1 (Message Processing)
- File processing pipeline: `domains/files/CLAUDE.md`
- WebSocket events: `@bc-agent/shared` FILE_WS_EVENTS
