# PRD-04: Event-Driven Processing Pipeline with BullMQ Flows

**Status**: Draft
**Created**: 2026-02-10
**Owner**: Backend Team
**Epic**: File Upload System Overhaul

---

## 1. Problem Statement

The current file processing pipeline uses 3 separate BullMQ queues with manual chaining and fire-and-forget patterns, resulting in critical reliability issues.

### Current Architecture

```
FileProcessingScheduler (polls every 5s)
  → FILE_PROCESSING queue (concurrency: 8)
      → FILE_CHUNKING queue (concurrency: 5)  [fire-and-forget .catch()]
          → EMBEDDING_GENERATION queue (concurrency: 5)  [fire-and-forget .catch()]
```

### Critical Issues

1. **Polling Scheduler Race Conditions**
   - `FileProcessingScheduler` polls every 5 seconds for `pending_processing` files (batch=10, maxQueueDepth=50)
   - Concurrent polls create race conditions where files in `pending_processing` state are never picked up
   - **Evidence**: In 25-file test, 8 files reached `pending_processing` status but were never enqueued
   - No atomic state transitions during poll → enqueue flow

2. **Manual Queue Chaining**
   - Each worker enqueues the next stage with `.catch(err => logger.error(...))`
   - If enqueue fails (network blip, Redis connection issue), error is logged but file is stuck forever
   - No automatic retry or recovery mechanism
   - Example from `FileProcessingWorker.ts`:
     ```typescript
     this.queueService.enqueueFileChunking(fileId, userId)
       .catch(err => this.logger.error({ err, fileId }, 'Failed to enqueue chunking'));
     ```

3. **No Batch Tracking**
   - No way to know when all files in a batch complete processing
   - Frontend must poll individual file statuses
   - No atomic "batch completed" event

4. **Silent Rate Limiting Failures**
   - `RateLimiter.ts` silently rejects jobs when rate limited
   - Jobs disappear without error surfacing to user
   - No visibility into why files aren't processing

5. **No Stalled Job Handling**
   - If a worker crashes mid-processing, BullMQ marks the job as stalled
   - No handler to retry stalled jobs or alert users
   - Files stuck in `processing`, `chunking`, or `embedding` states indefinitely

6. **Temporal Gap Between Upload and Processing**
   - Files are marked `pending_processing` immediately after upload
   - Scheduler polls every 5 seconds to enqueue them
   - Gap creates window for race conditions and lost files

### Impact

- **Data Loss**: Files uploaded but never processed (8/25 files in test)
- **Silent Failures**: No user notification when processing stalls
- **Poor UX**: No batch-level progress tracking
- **Operational Burden**: Manual intervention required to identify and retry stuck files

---

## 2. Deprecation Registry (Before Implementation)

The following components will be **ELIMINATED** or **REPLACED**:

| Component | Action | Replacement |
|-----------|--------|-------------|
| `FileProcessingScheduler.ts` | **ELIMINATE** | Direct enqueue from PRD-03 confirm endpoint |
| `FileBulkUploadWorker.ts` | **ELIMINATE** | DB creation moved to batch orchestrator |
| `FileProcessingWorker.ts` | **REPLACE** | V2 worker with state machine transitions |
| `FileChunkingWorker.ts` | **REPLACE** | V2 worker as BullMQ Flow child |
| `EmbeddingGenerationWorker.ts` | **REPLACE** | V2 worker as BullMQ Flow child |
| Manual queue chaining (`.catch()` fire-and-forget) | **ELIMINATE** | BullMQ Flow dependencies |
| `RateLimiter.ts` silent rejection | **REPLACE** | BullMQ native rate limiting with error surfacing |
| Polling-based enqueue | **ELIMINATE** | Direct enqueue on upload confirm |

---

## 3. Solution Pattern

### 3.1 BullMQ FlowProducer Architecture

BullMQ Flows provide declarative parent-child job dependencies with guaranteed sequencing and batch tracking.

#### Key Concepts

1. **Flow Structure**: Parent job waits for all children to complete before executing
2. **Automatic Sequencing**: Children execute in dependency order (not parallel)
3. **Batch Tracking**: Parent job tracks completion of all child jobs
4. **Atomic State**: Flow structure stored in Redis, immune to worker crashes

#### Flow Definition for Single File

```typescript
// Note: BullMQ Flows execute children FIRST (bottom-up)
// To get extract → chunk → embed sequence, we structure children as dependencies

const fileFlow = {
  name: `file-pipeline:${fileId}`,
  queueName: 'file-pipeline-parent',
  data: { fileId, batchId, type: 'file-completion-tracker' },
  children: [
    {
      name: `extract:${fileId}`,
      queueName: 'file-extract',
      data: { fileId, batchId },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }
      },
      children: [
        {
          name: `chunk:${fileId}`,
          queueName: 'file-chunk',
          data: { fileId, batchId },
          opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 3000 }
          },
          children: [
            {
              name: `embed:${fileId}`,
              queueName: 'file-embed',
              data: { fileId, batchId },
              opts: {
                attempts: 3,
                backoff: { type: 'exponential', delay: 3000 }
              }
            }
          ]
        }
      ]
    }
  ]
};

await flowProducer.add(fileFlow);
```

**Execution Order**: `embed` → `chunk` → `extract` → `file-pipeline-parent`

Wait, this is inverted! BullMQ Flows execute children first. To get the correct sequence, we need to invert our mental model:

```typescript
// CORRECT: Invert the dependency tree
// Parent = earliest stage, Children = later stages that depend on parent

const fileFlow = {
  name: `extract:${fileId}`,
  queueName: 'file-extract',
  data: { fileId, batchId },
  opts: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
  children: [
    {
      name: `chunk:${fileId}`,
      queueName: 'file-chunk',
      data: { fileId, batchId },
      opts: { attempts: 3, backoff: { type: 'exponential', delay: 3000 } },
      children: [
        {
          name: `embed:${fileId}`,
          queueName: 'file-embed',
          data: { fileId, batchId },
          opts: { attempts: 3, backoff: { type: 'exponential', delay: 3000 } }
        }
      ]
    }
  ]
};
```

**Execution Order**: `extract` completes → `chunk` starts → `chunk` completes → `embed` starts → `embed` completes

#### Flow Definition for Batch

```typescript
const batchFlow = {
  name: `batch:${batchId}`,
  queueName: 'batch-completion',
  data: { batchId, totalFiles: files.length },
  children: files.map(file => ({
    name: `extract:${file.id}`,
    queueName: 'file-extract',
    data: { fileId: file.id, batchId },
    opts: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    children: [
      {
        name: `chunk:${file.id}`,
        queueName: 'file-chunk',
        data: { fileId: file.id, batchId },
        opts: { attempts: 3, backoff: { type: 'exponential', delay: 3000 } },
        children: [
          {
            name: `embed:${file.id}`,
            queueName: 'file-embed',
            data: { fileId: file.id, batchId },
            opts: { attempts: 3, backoff: { type: 'exponential', delay: 3000 } }
          }
        ]
      }
    ]
  }))
};

await flowProducer.add(batchFlow);
```

**Execution Order**:
1. All `extract` jobs execute in parallel (BullMQ respects concurrency limits)
2. As each `extract` completes, its `chunk` job starts
3. As each `chunk` completes, its `embed` job starts
4. When ALL `embed` jobs complete, the `batch-completion` parent job executes

### 3.2 Atomic State Transitions

Each processing step uses the state machine from PRD-01 for atomic transitions.

#### Extract Worker (V2)

```typescript
export class FileExtractWorkerV2 {
  private worker: Worker;
  private fileRepo: IFileRepositoryV2;
  private processingService: FileProcessingService; // Reuse existing logic

  constructor(deps: WorkerDependencies) {
    this.fileRepo = deps.fileRepo;
    this.processingService = deps.processingService;

    this.worker = new Worker('file-extract', this.process.bind(this), {
      connection: deps.redis,
      concurrency: 8,
      settings: {
        backoffStrategies: {
          exponential: (attemptsMade) => Math.min(attemptsMade * 5000, 60000)
        }
      }
    });

    this.worker.on('stalled', this.handleStalled.bind(this));
    this.worker.on('failed', this.handleFailed.bind(this));
  }

  private async process(job: Job<FileJobData>): Promise<void> {
    const { fileId, batchId } = job.data;

    // Atomic transition: queued → extracting
    const transitioned = await this.fileRepo.transitionStatus(fileId, 'queued', 'extracting');
    if (!transitioned.success) {
      this.logger.warn({ fileId, expected: 'queued', actual: transitioned.currentStatus },
        'Cannot transition to extracting — another process already moved this file');
      return; // Abort safely — another worker is handling this
    }

    try {
      // Reuse existing processing logic (no rewrite needed)
      const result = await this.processingService.processFile(fileId);

      // Store extraction results
      await this.fileRepo.updateProcessingData(fileId, {
        extracted_text: result.text,
        extracted_images: result.images
      });

      // Atomic transition: extracting → chunking (ready for next stage)
      await this.fileRepo.transitionStatus(fileId, 'extracting', 'chunking');

      // Emit WebSocket event
      await this.socketService.emitToUser(result.userId, 'file:status-changed', {
        fileId,
        from: 'extracting',
        to: 'chunking',
        batchId
      });

    } catch (error) {
      this.logger.error({ error, fileId }, 'Extraction failed');
      throw error; // BullMQ will retry based on job.opts.attempts
    }
  }

  private async handleStalled(jobId: string): Promise<void> {
    this.logger.warn({ jobId }, 'Job stalled — will be retried by BullMQ');

    const job = await this.worker.getJob(jobId);
    if (job) {
      await this.socketService.emitToUser(job.data.userId, 'file:processing-stalled', {
        fileId: job.data.fileId,
        stage: 'extracting',
        retryCount: job.attemptsMade
      });
    }
  }

  private async handleFailed(job: Job<FileJobData>, error: Error): Promise<void> {
    if (job.attemptsMade >= job.opts.attempts) {
      // Move to DLQ
      await this.dlqQueue.add('failed-extraction', {
        fileId: job.data.fileId,
        batchId: job.data.batchId,
        error: error.message,
        stack: error.stack,
        attempts: job.attemptsMade,
        failedAt: new Date().toISOString()
      });

      // Transition to failed state
      await this.fileRepo.transitionStatus(job.data.fileId, 'extracting', 'failed');

      // Emit WebSocket event
      await this.socketService.emitToUser(job.data.userId, 'file:status-changed', {
        fileId: job.data.fileId,
        from: 'extracting',
        to: 'failed',
        batchId: job.data.batchId,
        error: error.message
      });
    }
  }
}
```

#### Chunk Worker (V2)

```typescript
export class FileChunkWorkerV2 {
  private async process(job: Job<FileJobData>): Promise<void> {
    const { fileId, batchId } = job.data;

    // Atomic transition: chunking → embedding (no intermediate "chunking in progress" state)
    // State machine allows chunking → embedding directly
    const transitioned = await this.fileRepo.transitionStatus(fileId, 'chunking', 'chunking');
    if (!transitioned.success) {
      this.logger.warn({ fileId, expected: 'chunking', actual: transitioned.currentStatus },
        'Cannot process chunking — file not in chunking state');
      return;
    }

    try {
      // Fetch extracted text
      const file = await this.fileRepo.getById(fileId);
      if (!file.extracted_text) {
        throw new Error('No extracted text available for chunking');
      }

      // Reuse existing chunking logic
      const chunks = await this.chunkingService.processFileChunks(fileId, file.extracted_text);

      // Store chunks (in files table or separate chunks table)
      await this.fileRepo.updateProcessingData(fileId, {
        chunks: JSON.stringify(chunks)
      });

      // Atomic transition: chunking → embedding
      await this.fileRepo.transitionStatus(fileId, 'chunking', 'embedding');

      // Emit WebSocket event
      await this.socketService.emitToUser(file.user_id, 'file:status-changed', {
        fileId,
        from: 'chunking',
        to: 'embedding',
        batchId,
        chunkCount: chunks.length
      });

    } catch (error) {
      this.logger.error({ error, fileId }, 'Chunking failed');
      throw error;
    }
  }
}
```

#### Embed Worker (V2)

```typescript
export class FileEmbedWorkerV2 {
  private async process(job: Job<FileJobData>): Promise<void> {
    const { fileId, batchId } = job.data;

    // Atomic transition: embedding → ready
    const transitioned = await this.fileRepo.transitionStatus(fileId, 'embedding', 'embedding');
    if (!transitioned.success) {
      this.logger.warn({ fileId, expected: 'embedding', actual: transitioned.currentStatus },
        'Cannot process embedding — file not in embedding state');
      return;
    }

    try {
      // Fetch chunks
      const file = await this.fileRepo.getById(fileId);
      const chunks = JSON.parse(file.chunks || '[]');

      if (chunks.length === 0) {
        throw new Error('No chunks available for embedding');
      }

      // Reuse existing embedding logic
      const embeddings = await this.embeddingService.generateEmbeddings(chunks);

      // Index in Azure AI Search
      await this.searchService.indexDocuments(fileId, file.user_id, chunks, embeddings);

      // Atomic transition: embedding → ready (final state)
      await this.fileRepo.transitionStatus(fileId, 'embedding', 'ready');

      // Emit WebSocket event
      await this.socketService.emitToUser(file.user_id, 'file:status-changed', {
        fileId,
        from: 'embedding',
        to: 'ready',
        batchId
      });

    } catch (error) {
      this.logger.error({ error, fileId }, 'Embedding failed');
      throw error;
    }
  }
}
```

### 3.3 Batch Completion Tracker

The parent job in the batch flow waits for all child jobs to complete, then emits a batch completion event.

```typescript
export class BatchCompletionWorker {
  private async process(job: Job<BatchCompletionData>): Promise<void> {
    const { batchId, totalFiles } = job.data;

    // All child jobs have completed (either successfully or failed)
    // Query final state of all files in batch
    const files = await this.fileRepo.getByBatchId(batchId);

    const summary = {
      total: totalFiles,
      ready: files.filter(f => f.status === 'ready').length,
      failed: files.filter(f => f.status === 'failed').length
    };

    this.logger.info({ batchId, summary }, 'Batch processing completed');

    // Update batch record
    await this.batchRepo.markCompleted(batchId, summary);

    // Emit WebSocket event
    const batch = await this.batchRepo.getById(batchId);
    await this.socketService.emitToUser(batch.user_id, 'batch:completed', {
      batchId,
      summary
    });
  }
}
```

### 3.4 Direct Enqueue (No Scheduler)

Processing is triggered directly from PRD-03's confirm endpoint, eliminating the temporal gap and polling race conditions.

```typescript
// In UploadBatchOrchestrator.confirmFileUpload()
async confirmFileUpload(batchId: string, fileId: string, metadata: FileMetadata): Promise<void> {
  // ... validation and S3 checks ...

  // Atomic transition: uploaded → queued
  const transitioned = await this.fileRepo.transitionStatus(fileId, 'uploaded', 'queued');
  if (!transitioned.success) {
    throw new Error(`Cannot confirm file — expected 'uploaded', got '${transitioned.currentStatus}'`);
  }

  // Enqueue directly (no scheduler, no polling, no delay)
  await this.flowProducer.add(this.createFileFlow(fileId, batchId));

  // Emit WebSocket event
  const file = await this.fileRepo.getById(fileId);
  await this.socketService.emitToUser(file.user_id, 'file:status-changed', {
    fileId,
    from: 'uploaded',
    to: 'queued',
    batchId
  });
}

private createFileFlow(fileId: string, batchId: string): FlowJob {
  return {
    name: `extract:${fileId}`,
    queueName: 'file-extract',
    data: { fileId, batchId },
    opts: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    children: [
      {
        name: `chunk:${fileId}`,
        queueName: 'file-chunk',
        data: { fileId, batchId },
        opts: { attempts: 3, backoff: { type: 'exponential', delay: 3000 } },
        children: [
          {
            name: `embed:${fileId}`,
            queueName: 'file-embed',
            data: { fileId, batchId },
            opts: { attempts: 3, backoff: { type: 'exponential', delay: 3000 } }
          }
        ]
      }
    ]
  };
}
```

**Key Benefit**: Zero temporal gap. The instant a file is confirmed uploaded, it enters the processing pipeline. No scheduler. No polling. No race conditions.

### 3.5 Dead Letter Queue (DLQ)

Jobs that fail after max retries are moved to a dedicated DLQ for manual inspection and retry.

#### DLQ Structure

```typescript
interface DLQEntry {
  fileId: string;
  batchId: string;
  stage: 'extracting' | 'chunking' | 'embedding';
  error: string;
  stack?: string;
  attempts: number;
  failedAt: string;
  retriedAt?: string;
  retriedBy?: string;
}
```

#### DLQ API Endpoints

```typescript
// GET /api/v2/uploads/dlq
// List all failed jobs (paginated)
router.get('/dlq', async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  const entries = await dlqService.listEntries({ limit, offset });
  res.json(entries);
});

// POST /api/v2/uploads/dlq/:fileId/retry
// Retry a single failed file
router.post('/dlq/:fileId/retry', async (req, res) => {
  const { fileId } = req.params;
  const userId = req.user.id;

  await dlqService.retryFile(fileId, userId);
  res.json({ success: true });
});

// POST /api/v2/uploads/dlq/retry-all
// Retry all failed files in DLQ
router.post('/dlq/retry-all', async (req, res) => {
  const userId = req.user.id;
  const results = await dlqService.retryAll(userId);
  res.json(results);
});
```

#### DLQ Service Implementation

```typescript
export class DLQService {
  async retryFile(fileId: string, retriedBy: string): Promise<void> {
    const entry = await this.dlqQueue.getJob(fileId);
    if (!entry) {
      throw new Error('DLQ entry not found');
    }

    const { batchId, stage } = entry.data;

    // Reset file to appropriate state for retry
    let resetState: FileStatus;
    switch (stage) {
      case 'extracting':
        resetState = 'queued';
        break;
      case 'chunking':
        resetState = 'extracting'; // Will trigger chunk after extract completes
        break;
      case 'embedding':
        resetState = 'chunking'; // Will trigger embed after chunk completes
        break;
    }

    // Atomic transition to reset state
    await this.fileRepo.updateStatus(fileId, resetState);

    // Re-enqueue flow (will resume from reset state)
    await this.flowProducer.add(this.createFileFlow(fileId, batchId));

    // Mark DLQ entry as retried
    await this.dlqQueue.update(entry.id, {
      ...entry.data,
      retriedAt: new Date().toISOString(),
      retriedBy
    });

    this.logger.info({ fileId, stage, resetState }, 'DLQ entry retried');
  }
}
```

### 3.6 WebSocket Events

Real-time events are emitted at each state transition, providing fine-grained progress tracking.

#### Event Schema

```typescript
// packages/shared/src/types/websocket.types.ts

export interface FileStatusChangedEvent {
  fileId: string;
  from: FileStatus;
  to: FileStatus;
  batchId?: string;
  error?: string;
  chunkCount?: number;
}

export interface BatchProgressEvent {
  batchId: string;
  total: number;
  queued: number;
  extracting: number;
  chunking: number;
  embedding: number;
  ready: number;
  failed: number;
}

export interface BatchCompletedEvent {
  batchId: string;
  summary: {
    total: number;
    ready: number;
    failed: number;
  };
}

export interface FileProcessingStalled {
  fileId: string;
  stage: 'extracting' | 'chunking' | 'embedding';
  retryCount: number;
}
```

#### Frontend Integration

```typescript
// frontend/src/domains/files/hooks/useFileProcessingEvents.ts

export function useFileProcessingEvents(batchId: string) {
  const socket = useSocket();
  const [progress, setProgress] = useState<BatchProgressEvent | null>(null);

  useEffect(() => {
    socket.on('file:status-changed', (event: FileStatusChangedEvent) => {
      if (event.batchId === batchId) {
        // Update local file status
        updateFileStatus(event.fileId, event.to);
      }
    });

    socket.on('batch:progress', (event: BatchProgressEvent) => {
      if (event.batchId === batchId) {
        setProgress(event);
      }
    });

    socket.on('batch:completed', (event: BatchCompletedEvent) => {
      if (event.batchId === batchId) {
        toast.success(`Batch completed: ${event.summary.ready}/${event.summary.total} files processed`);
      }
    });

    socket.on('file:processing-stalled', (event: FileProcessingStalled) => {
      toast.warning(`File processing stalled (retry ${event.retryCount}/3)`);
    });

    return () => {
      socket.off('file:status-changed');
      socket.off('batch:progress');
      socket.off('batch:completed');
      socket.off('file:processing-stalled');
    };
  }, [batchId, socket]);

  return progress;
}
```

---

## 4. Scope

### 4.1 Core Components

#### New Components

| Component | Path | Responsibility |
|-----------|------|----------------|
| `ProcessingFlowFactory` | `backend/src/domains/queue/flow/ProcessingFlowFactory.ts` | Creates BullMQ Flow definitions per file and batch |
| `FileExtractWorkerV2` | `backend/src/infrastructure/queue/workers/v2/FileExtractWorkerV2.ts` | Extract stage worker with state machine transitions |
| `FileChunkWorkerV2` | `backend/src/infrastructure/queue/workers/v2/FileChunkWorkerV2.ts` | Chunking stage worker with state machine transitions |
| `FileEmbedWorkerV2` | `backend/src/infrastructure/queue/workers/v2/FileEmbedWorkerV2.ts` | Embedding stage worker with state machine transitions |
| `BatchCompletionWorker` | `backend/src/infrastructure/queue/workers/v2/BatchCompletionWorker.ts` | Batch completion tracker and event emitter |
| `DLQService` | `backend/src/services/queue/DLQService.ts` | Dead letter queue management and retry logic |
| `DLQRoutes` | `backend/src/routes/files/dlq.routes.ts` | REST API for DLQ inspection and retry |

#### Modified Components

| Component | Path | Modification |
|-----------|------|-------------|
| `UploadBatchOrchestrator` | `backend/src/services/files/UploadBatchOrchestrator.ts` | Add direct enqueue logic in `confirmFileUpload()` |
| `QueueService` | `backend/src/services/queue/QueueService.ts` | Add FlowProducer initialization and flow creation methods |
| `SocketService` | `backend/src/services/chat/SocketService.ts` | Add event emission methods for file/batch events |

#### Reused Components (No Changes)

| Component | Path | Usage |
|-----------|------|-------|
| `FileProcessingService` | `backend/src/services/files/FileProcessingService.ts` | Reused by `FileExtractWorkerV2` for extraction logic |
| `FileChunkingService` | `backend/src/services/files/FileChunkingService.ts` | Reused by `FileChunkWorkerV2` for chunking logic |
| `EmbeddingGenerationWorker` | `backend/src/infrastructure/queue/workers/EmbeddingGenerationWorker.ts` | Core logic reused by `FileEmbedWorkerV2` |
| Document Processors | `backend/src/services/files/processors/*` | PDF, DOCX, XLSX, image processors reused as-is |
| `ProcessingRetryManager` | `backend/src/services/files/ProcessingRetryManager.ts` | Retry logic patterns reused |

### 4.2 BullMQ Queue Configuration

#### Queue Definitions

```typescript
// backend/src/infrastructure/queue/queues.ts

export const QUEUE_NAMES = {
  FILE_EXTRACT: 'file-extract',
  FILE_CHUNK: 'file-chunk',
  FILE_EMBED: 'file-embed',
  BATCH_COMPLETION: 'batch-completion',
  DLQ: 'dead-letter-queue'
} as const;

export const QUEUE_CONFIG = {
  [QUEUE_NAMES.FILE_EXTRACT]: {
    concurrency: 8,
    limiter: {
      max: 100,
      duration: 60000 // 100 jobs per minute
    }
  },
  [QUEUE_NAMES.FILE_CHUNK]: {
    concurrency: 5,
    limiter: {
      max: 50,
      duration: 60000
    }
  },
  [QUEUE_NAMES.FILE_EMBED]: {
    concurrency: 5,
    limiter: {
      max: 50,
      duration: 60000
    }
  },
  [QUEUE_NAMES.BATCH_COMPLETION]: {
    concurrency: 2 // Low concurrency — just emits events
  },
  [QUEUE_NAMES.DLQ]: {
    concurrency: 1 // Sequential processing of DLQ retries
  }
};
```

#### FlowProducer Initialization

```typescript
// backend/src/infrastructure/queue/flowProducer.ts

import { FlowProducer } from 'bullmq';
import { redisConnection } from '@/infrastructure/redis';

export const flowProducer = new FlowProducer({
  connection: redisConnection
});

export async function closeFlowProducer(): Promise<void> {
  await flowProducer.close();
}
```

### 4.3 State Transition Sequences

#### Happy Path

```
uploaded
  → (confirm endpoint) → queued
  → (extract worker) → extracting
  → (extract complete) → chunking
  → (chunk worker) → chunking (in-progress, no separate state)
  → (chunk complete) → embedding
  → (embed worker) → embedding (in-progress, no separate state)
  → (embed complete) → ready
```

#### Retry Path (Transient Failure)

```
extracting
  → (worker crashes) → extracting (BullMQ marks stalled)
  → (BullMQ retry) → extracting
  → (retry succeeds) → chunking
  → ...
```

#### DLQ Path (Permanent Failure)

```
extracting
  → (attempt 1) → extracting
  → (attempt 2) → extracting
  → (attempt 3) → extracting
  → (all retries exhausted) → failed + DLQ entry created
```

#### DLQ Retry Path

```
failed
  → (admin triggers DLQ retry) → queued
  → (extract worker) → extracting
  → ...
```

### 4.4 Concurrency and Rate Limiting

BullMQ provides native rate limiting per queue, eliminating the need for custom `RateLimiter.ts`.

#### Rate Limit Configuration

```typescript
const queue = new Queue('file-extract', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 }, // Keep last 100 completed jobs
    removeOnFail: { count: 500 }      // Keep last 500 failed jobs
  },
  limiter: {
    max: 100,        // Max 100 jobs
    duration: 60000, // Per 60 seconds
    bounceBack: false // Drop jobs if limit exceeded (don't requeue)
  }
});
```

#### Error Handling on Rate Limit

```typescript
worker.on('error', (err) => {
  if (err.message.includes('rate limit')) {
    this.logger.error({ err }, 'Rate limit exceeded — jobs dropped');

    // Emit WebSocket alert to admins
    this.socketService.emitToAdmins('queue:rate-limit-exceeded', {
      queue: 'file-extract',
      timestamp: new Date().toISOString()
    });
  }
});
```

---

## 5. Comparison: Old vs New Pipeline

| Aspect | Old Pipeline | New Pipeline |
|--------|-------------|--------------|
| **Enqueue Mechanism** | Polling scheduler (every 5s, batch=10) | Direct enqueue on upload confirm (instant) |
| **Queue Chaining** | Manual fire-and-forget with `.catch()` | BullMQ Flow dependencies (automatic) |
| **State Transitions** | Non-atomic (`UPDATE ... SET status = ?`) | Atomic CAS (`UPDATE ... WHERE status = ?`) |
| **Batch Tracking** | None (frontend polls individual files) | Parent job tracks all child jobs (automatic) |
| **Stalled Jobs** | No handling (files stuck forever) | BullMQ emits `stalled` event → auto-retry |
| **Failed Jobs** | Lost in logs | Moved to DLQ with retry API |
| **Rate Limiting** | Custom `RateLimiter.ts` (silent rejection) | BullMQ native rate limiting (error surfacing) |
| **WebSocket Events** | None during processing | Real-time events for every state transition |
| **Race Conditions** | Scheduler polls create races | Atomic transitions eliminate races |
| **Temporal Gap** | 0-5s between upload and processing | 0s (instant enqueue) |
| **Job Ordering** | Undefined (depends on poll timing) | Deterministic (Flow dependencies enforce order) |
| **Observability** | Logs only | Logs + WebSocket events + DLQ API |
| **Recovery** | Manual DB queries + re-enqueue | DLQ UI with one-click retry |

---

## 6. Success Criteria

### 6.1 Reliability

- **Zero File Loss**: 25-file test → 25 files reach terminal state (`ready` or `failed`)
- **Atomic Transitions**: No files stuck in intermediate states after worker crashes
- **Deterministic Sequencing**: Extract → Chunk → Embed order guaranteed for every file
- **Batch Completion**: Batch completion event fires when all files reach terminal state

### 6.2 Observability

- **Real-Time Progress**: WebSocket events emitted for every state transition
- **Stalled Job Alerts**: Users notified when jobs stall and are being retried
- **DLQ Visibility**: Failed jobs queryable via REST API
- **Batch Summary**: Final success/failure counts available after batch completes

### 6.3 Recovery

- **Automatic Retry**: Stalled jobs automatically retried by BullMQ (up to 3 attempts)
- **DLQ Retry**: Failed jobs retryable via API (individual or bulk)
- **No Manual Intervention**: No need for DB queries or manual re-enqueue scripts

### 6.4 Performance

- **Instant Enqueue**: Processing starts immediately on upload confirm (0s delay)
- **Concurrency Limits Respected**: Extract (8), Chunk (5), Embed (5)
- **Rate Limiting**: BullMQ enforces per-queue rate limits with error surfacing

---

## 7. Dependencies

### 7.1 PRDs

- **PRD-01**: State machine for atomic transitions (`queued → extracting → chunking → embedding → ready`)
- **PRD-03**: Direct enqueue from confirm endpoint (eliminates scheduler)

### 7.2 External Libraries

- **BullMQ**: v5.x with Flow support
- **ioredis**: v5.x (Redis client for BullMQ)

### 7.3 Infrastructure

- **Redis**: BullMQ requires Redis 6.2+ for Flow support
- **Azure SQL**: File status updates (state machine transitions)
- **Azure Storage**: File retrieval during processing (no changes)
- **Azure AI Search**: Embedding indexing (no changes)

---

## 8. Implementation Plan

### Phase 1: Core Flow Infrastructure (Week 1)

1. **FlowProducer Setup**
   - Initialize FlowProducer in `QueueService`
   - Create `ProcessingFlowFactory` with flow definitions
   - Add flow creation methods to `UploadBatchOrchestrator`

2. **V2 Workers (Stateless Wrappers)**
   - `FileExtractWorkerV2` wraps `FileProcessingService`
   - `FileChunkWorkerV2` wraps `FileChunkingService`
   - `FileEmbedWorkerV2` wraps existing embedding logic
   - All workers use state machine transitions from PRD-01

3. **Direct Enqueue**
   - Modify `UploadBatchOrchestrator.confirmFileUpload()` to enqueue flows
   - Eliminate `FileProcessingScheduler` (deprecate file)

### Phase 2: Observability & Recovery (Week 2)

1. **WebSocket Events**
   - Add event emission in each V2 worker
   - Create frontend hook `useFileProcessingEvents`

2. **Batch Completion Tracker**
   - Implement `BatchCompletionWorker`
   - Emit `batch:completed` event when all child jobs finish

3. **Stalled Job Handling**
   - Add `stalled` event handlers in all V2 workers
   - Emit WebSocket alerts to users

### Phase 3: Dead Letter Queue (Week 3)

1. **DLQ Service**
   - Create DLQ queue and worker
   - Implement `DLQService` with retry logic

2. **DLQ API**
   - `GET /api/v2/uploads/dlq` (list failed jobs)
   - `POST /api/v2/uploads/dlq/:fileId/retry` (retry one)
   - `POST /api/v2/uploads/dlq/retry-all` (retry all)

3. **DLQ Frontend**
   - Add DLQ view in admin panel
   - One-click retry buttons

### Phase 4: Testing & Cutover (Week 4)

1. **Integration Tests**
   - 25-file batch test (verify 25 reach `ready` or `failed`)
   - Stalled job test (kill worker mid-processing, verify retry)
   - DLQ test (fail job 3 times, verify DLQ entry, retry)

2. **Load Testing**
   - 100-file batch test
   - Concurrent batch test (multiple users)

3. **Cutover**
   - Deploy V2 workers alongside V1 (feature flag)
   - Monitor for 48 hours
   - Deprecate V1 workers and scheduler

---

## 9. Verification Plan

### 9.1 Manual Testing (curl)

#### Test 1: Single File Happy Path

```bash
# Step 1: Initialize batch
curl -X POST http://localhost:3002/api/v2/uploads/batches \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fileCount": 1}'

# Response: {"batchId": "BATCH123", "status": "pending_upload", ...}

# Step 2: Get upload URL
curl -X POST http://localhost:3002/api/v2/uploads/batches/BATCH123/upload-urls \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fileName": "test.pdf", "fileSize": 1024}'

# Response: {"fileId": "FILE456", "uploadUrl": "https://...", ...}

# Step 3: Upload file to S3
curl -X PUT "https://..." \
  -H "Content-Type: application/pdf" \
  --data-binary @test.pdf

# Step 4: Confirm upload (triggers direct enqueue)
curl -X POST http://localhost:3002/api/v2/uploads/batches/BATCH123/files/FILE456/confirm \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"size": 1024, "md5": "abc123"}'

# Response: {"fileId": "FILE456", "status": "queued", ...}

# Step 5: Poll file status (should progress: queued → extracting → chunking → embedding → ready)
while true; do
  curl http://localhost:3002/api/v2/uploads/files/FILE456 \
    -H "Authorization: Bearer $TOKEN" | jq '.status'
  sleep 2
done

# Expected: "queued" → "extracting" → "chunking" → "embedding" → "ready"
```

#### Test 2: 25-File Batch

```bash
# Initialize batch with 25 files
curl -X POST http://localhost:3002/api/v2/uploads/batches \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"fileCount": 25}'

# Upload and confirm 25 files (loop)
for i in {1..25}; do
  # Get upload URL
  RESPONSE=$(curl -X POST http://localhost:3002/api/v2/uploads/batches/$BATCH_ID/upload-urls \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"fileName\": \"test$i.pdf\", \"fileSize\": 1024}")

  FILE_ID=$(echo $RESPONSE | jq -r '.fileId')
  UPLOAD_URL=$(echo $RESPONSE | jq -r '.uploadUrl')

  # Upload to S3
  curl -X PUT "$UPLOAD_URL" -H "Content-Type: application/pdf" --data-binary @test.pdf

  # Confirm upload
  curl -X POST http://localhost:3002/api/v2/uploads/batches/$BATCH_ID/files/$FILE_ID/confirm \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"size": 1024, "md5": "abc123"}'
done

# Poll batch status
curl http://localhost:3002/api/v2/uploads/batches/$BATCH_ID \
  -H "Authorization: Bearer $TOKEN" | jq '.summary'

# Expected: {"total": 25, "ready": 25, "failed": 0}
```

#### Test 3: Stalled Job Recovery

```bash
# Start file processing
curl -X POST http://localhost:3002/api/v2/uploads/batches/$BATCH_ID/files/$FILE_ID/confirm \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"size": 1024, "md5": "abc123"}'

# Kill worker process mid-extraction
# (In another terminal: pkill -f FileExtractWorkerV2)

# Wait 10 seconds (BullMQ stalledInterval default)
sleep 10

# Verify job is retried automatically
curl http://localhost:3002/api/v2/uploads/files/$FILE_ID \
  -H "Authorization: Bearer $TOKEN" | jq '.status'

# Expected: "extracting" (retrying) → "chunking" → "embedding" → "ready"
```

#### Test 4: DLQ Retry

```bash
# Trigger file that will fail (e.g., corrupt PDF)
curl -X POST http://localhost:3002/api/v2/uploads/batches/$BATCH_ID/files/$FILE_ID/confirm \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"size": 1024, "md5": "abc123"}'

# Wait for 3 retries to exhaust (3 attempts × 5s backoff = ~15s)
sleep 20

# Verify file is in DLQ
curl http://localhost:3002/api/v2/uploads/dlq \
  -H "Authorization: Bearer $TOKEN" | jq '.entries[] | select(.fileId == "'$FILE_ID'")'

# Expected: {"fileId": "FILE456", "stage": "extracting", "attempts": 3, ...}

# Retry from DLQ
curl -X POST http://localhost:3002/api/v2/uploads/dlq/$FILE_ID/retry \
  -H "Authorization: Bearer $TOKEN"

# Verify file is back in processing
curl http://localhost:3002/api/v2/uploads/files/$FILE_ID \
  -H "Authorization: Bearer $TOKEN" | jq '.status'

# Expected: "queued" → "extracting" → ...
```

### 9.2 Automated Tests

#### Unit Tests

```typescript
// backend/src/infrastructure/queue/workers/v2/__tests__/FileExtractWorkerV2.test.ts

describe('FileExtractWorkerV2', () => {
  it('should transition queued → extracting → chunking', async () => {
    const worker = new FileExtractWorkerV2({ fileRepo, processingService, socketService });

    const job = createMockJob({ fileId: 'FILE123', batchId: 'BATCH456' });

    await worker.process(job);

    expect(fileRepo.transitionStatus).toHaveBeenCalledWith('FILE123', 'queued', 'extracting');
    expect(fileRepo.transitionStatus).toHaveBeenCalledWith('FILE123', 'extracting', 'chunking');
    expect(socketService.emitToUser).toHaveBeenCalledWith(userId, 'file:status-changed', {
      fileId: 'FILE123',
      from: 'extracting',
      to: 'chunking',
      batchId: 'BATCH456'
    });
  });

  it('should abort if file is not in queued state', async () => {
    fileRepo.transitionStatus.mockResolvedValueOnce({ success: false, currentStatus: 'extracting' });

    const worker = new FileExtractWorkerV2({ fileRepo, processingService, socketService });
    const job = createMockJob({ fileId: 'FILE123', batchId: 'BATCH456' });

    await worker.process(job);

    expect(processingService.processFile).not.toHaveBeenCalled();
  });

  it('should move to DLQ after 3 failed attempts', async () => {
    const worker = new FileExtractWorkerV2({ fileRepo, processingService, socketService, dlqQueue });

    processingService.processFile.mockRejectedValue(new Error('Extraction failed'));

    const job = createMockJob({
      fileId: 'FILE123',
      batchId: 'BATCH456',
      attemptsMade: 3,
      opts: { attempts: 3 }
    });

    await worker.handleFailed(job, new Error('Extraction failed'));

    expect(dlqQueue.add).toHaveBeenCalledWith('failed-extraction', {
      fileId: 'FILE123',
      batchId: 'BATCH456',
      error: 'Extraction failed',
      attempts: 3,
      failedAt: expect.any(String)
    });
    expect(fileRepo.transitionStatus).toHaveBeenCalledWith('FILE123', 'extracting', 'failed');
  });
});
```

#### Integration Tests

```typescript
// backend/src/__tests__/integration/processing-flow.test.ts

describe('Processing Flow Integration', () => {
  it('should process file through all stages', async () => {
    // Initialize batch
    const batchId = await batchOrchestrator.initialize(userId, 1);

    // Get upload URL
    const { fileId, uploadUrl } = await batchOrchestrator.getUploadUrl(batchId, {
      fileName: 'test.pdf',
      fileSize: 1024
    });

    // Upload to S3 (mock)
    await s3Client.putObject({ Key: fileId, Body: Buffer.from('...') });

    // Confirm upload (triggers direct enqueue)
    await batchOrchestrator.confirmFileUpload(batchId, fileId, { size: 1024, md5: 'abc123' });

    // Wait for processing to complete (use BullMQ test helpers)
    await waitForJobCompletion('file-embed', `embed:${fileId}`);

    // Verify file reached ready state
    const file = await fileRepo.getById(fileId);
    expect(file.status).toBe('ready');

    // Verify batch completed
    const batch = await batchRepo.getById(batchId);
    expect(batch.status).toBe('completed');
    expect(batch.processed_count).toBe(1);
  });

  it('should handle stalled job and retry', async () => {
    // ... similar setup ...

    // Simulate worker crash by pausing queue
    await extractQueue.pause();

    // Confirm upload (job will stall)
    await batchOrchestrator.confirmFileUpload(batchId, fileId, { size: 1024, md5: 'abc123' });

    // Wait for stalled event
    await waitForEvent(extractWorker, 'stalled');

    // Resume queue (BullMQ will retry)
    await extractQueue.resume();

    // Verify file eventually reaches ready state
    await waitForJobCompletion('file-embed', `embed:${fileId}`);
    const file = await fileRepo.getById(fileId);
    expect(file.status).toBe('ready');
  });
});
```

---

## 10. Closing Deliverables

### 10.1 Code Artifacts

- [ ] `ProcessingFlowFactory.ts` (Flow definitions)
- [ ] `FileExtractWorkerV2.ts` (V2 worker with state machine)
- [ ] `FileChunkWorkerV2.ts` (V2 worker with state machine)
- [ ] `FileEmbedWorkerV2.ts` (V2 worker with state machine)
- [ ] `BatchCompletionWorker.ts` (Batch completion tracker)
- [ ] `DLQService.ts` (Dead letter queue management)
- [ ] `DLQRoutes.ts` (REST API for DLQ)
- [ ] Modified `UploadBatchOrchestrator.ts` (Direct enqueue logic)
- [ ] Modified `QueueService.ts` (FlowProducer initialization)
- [ ] WebSocket event types in `@bc-agent/shared`
- [ ] Frontend hook `useFileProcessingEvents.ts`

### 10.2 Tests

- [ ] Unit tests for all V2 workers
- [ ] Integration tests for full processing flow
- [ ] Stalled job recovery test
- [ ] DLQ retry test
- [ ] 25-file batch test (zero file loss verification)

### 10.3 Documentation

- [ ] Update `CLAUDE.md` with BullMQ Flow architecture
- [ ] Add section to `02-PAGINATION.md` for DLQ pagination
- [ ] Architecture diagram showing Flow structure
- [ ] Comparison table (old vs new pipeline)

### 10.4 Deprecation

- [ ] Mark `FileProcessingScheduler.ts` as deprecated (add `@deprecated` comment)
- [ ] Mark `FileBulkUploadWorker.ts` as deprecated
- [ ] Mark old workers (`FileProcessingWorker.ts`, etc.) as deprecated
- [ ] Add migration guide for any code using old queue service methods

### 10.5 Monitoring & Alerts

- [ ] Grafana dashboard for queue metrics (depth, latency, stalled rate)
- [ ] Alert for DLQ growth (>10 entries in 1 hour)
- [ ] Alert for high stalled job rate (>5% of total jobs)
- [ ] Log aggregation queries for processing errors

---

## 11. Open Questions

1. **BullMQ Flow Execution Order**: Confirm that nested children execute in the correct sequence (extract → chunk → embed). Need to test with real BullMQ instance.

2. **Redis Memory Usage**: With 1000+ concurrent files, each with a Flow structure in Redis, will memory usage become an issue? Consider TTL for completed flows.

3. **Batch Completion Timing**: When does the parent job execute — immediately after all children complete, or is there a delay? Need to test real-world timing.

4. **DLQ Retention Policy**: How long should DLQ entries be retained? 30 days? 90 days? Add TTL to DLQ queue?

5. **Rate Limiting Strategy**: Should rate limits be per-user or global? Currently global per queue. May need user-level quotas for fairness.

6. **Concurrency Tuning**: Extract (8), Chunk (5), Embed (5) are initial guesses. Need load testing to optimize.

7. **WebSocket Event Batching**: Should we batch per-file events into periodic batch progress updates to reduce socket traffic? (e.g., emit batch progress every 5 seconds instead of every file transition)

---

## 12. Success Metrics (Post-Deployment)

### Week 1

- **Zero File Loss**: 100% of confirmed uploads reach terminal state (`ready` or `failed`)
- **Stalled Job Recovery**: 100% of stalled jobs successfully retry
- **DLQ Size**: <1% of total files processed

### Week 4

- **Processing Latency**: P95 time from upload confirm to `ready` state
- **User Satisfaction**: <5% of users report missing files
- **DLQ Retry Success Rate**: >90% of DLQ retries succeed on first retry

### Month 3

- **Scalability**: Support 10,000 files/day with <0.1% failure rate
- **Operational Overhead**: Zero manual interventions required for stuck files

---

**End of PRD-04**
