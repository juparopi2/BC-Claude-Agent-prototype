# PRD-05: Error Recovery, Cleanup & Observability

**Status**: Draft
**Created**: 2026-02-10
**Owner**: Backend Team
**Dependencies**: PRD-01 (State Machine), PRD-04 (DLQ & Flow Producer)

---

## 1. Problem Statement

The current file upload pipeline has critical gaps in error recovery and operational visibility:

### 1.1 No Stuck File Recovery
Files that transition to intermediate states (`queued`, `extracting`, `chunking`, `embedding`) but fail to progress remain stuck indefinitely. Causes include:
- Worker crashes mid-processing
- Transient network errors during external service calls
- Race conditions in state transitions
- Queue stalls or connection drops

**Current remediation**: Manual SQL updates (`UPDATE files SET pipeline_status = 'failed'`) with no automatic retry.

### 1.2 Limited Cleanup Scope
`FileCleanupWorker.ts` (230 lines) only handles a narrow case:
- **What it does**: Deletes files with `pipeline_status = 'failed'` older than 30 days
- **What it misses**:
  - **Orphan blobs**: Blob paths in Azure Storage that have no DB record (failed uploads that wrote blob before DB insert)
  - **Abandoned uploads**: Files with `pipeline_status = 'registered'` for >24 hours (user closed browser, never confirmed batch)
  - **Expired batches**: Batches stuck in `active` status forever (never confirmed/cancelled)

**Result**: Storage costs accumulate from untracked blobs; database fills with dead metadata.

### 1.3 No Pipeline Visibility
Diagnosing issues requires:
1. Raw SQL queries against `files` table grouped by `pipeline_status`
2. Manual inspection of `upload_batches.status` distribution
3. BullMQ Dashboard for queue depths (requires separate deployment)
4. Zero programmatic access to metrics (no JSON API for monitoring tools)

**Impact**: Average incident resolution time >30 minutes due to manual data gathering.

### 1.4 Orphan Blob Accumulation
When a file upload fails after blob write but before DB commit:
```typescript
// FileUploadService.ts (simplified)
await azureStorage.uploadBlob(blobPath, buffer); // ✅ Success
// ❌ Network error here
await prisma.files.create({ blob_path: blobPath }); // Never reached
```
The blob remains in Azure Storage forever. No job detects or cleans these orphans.

**Estimated waste**: ~5-10% of total storage (based on staging environment profiling).

### 1.5 No Batch Timeout
Upload batches remain in `active` status indefinitely:
- User starts batch upload (5 files)
- Uploads 3 files successfully
- Closes browser tab
- Batch never confirmed → remains `active` forever
- Files 4-5 never uploaded → remain `registered` forever

**Current behavior**: 0 automatic cleanup. Orphan records accumulate.

---

## 2. Deprecation Registry (Before Implementation)

| Component | Path | Reason | Replacement |
|-----------|------|--------|-------------|
| `FileCleanupWorker` | `backend/src/infrastructure/queue/workers/FileCleanupWorker.ts` | Only handles 30-day-old `failed` files; scheduled externally; missing orphan/abandoned detection | `OrphanCleanupJob` (comprehensive, multi-scope, BullMQ scheduled) |
| `PartialDataCleaner` | `backend/src/shared/utils/PartialDataCleaner.ts` | Generic cleanup util with no pipeline-specific logic; unused in production | Logic absorbed into `StuckFileRecoveryJob` and `OrphanCleanupJob` |
| External cron (03:00 UTC) | Deployment config | Cleanup scheduled outside application (brittle, no logs) | BullMQ repeatable jobs (auditable, retryable) |

**Migration Strategy**: Mark deprecated classes with JSDoc `@deprecated` tag. Remove after PRD-05 verification (1 sprint buffer).

---

## 3. Solution Architecture

### 3.1 Design Principles

1. **Self-Healing**: System automatically detects and recovers from transient failures
2. **Idempotent Jobs**: All cleanup jobs safe to run multiple times without side effects
3. **Gradual Escalation**: Retry → Re-enqueue → Permanent Failure (with user notification)
4. **Observability First**: Metrics exposed as JSON APIs before building UI dashboards
5. **Configurable Thresholds**: All timeouts/limits via environment variables

### 3.2 Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Scheduled Jobs (BullMQ)                  │
├─────────────────────────────────────────────────────────────┤
│  StuckFileRecoveryJob    │  Every 15 min  │  Re-enqueue     │
│  OrphanCleanupJob        │  Daily 03:00   │  3 scopes       │
│  BatchTimeoutJob         │  Hourly        │  Expire batches │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Dashboard API Endpoints                    │
├─────────────────────────────────────────────────────────────┤
│  GET  /api/v2/uploads/dashboard     │  Overview metrics     │
│  GET  /api/v2/uploads/stuck         │  Stuck file details   │
│  GET  /api/v2/uploads/orphans       │  Orphan blob report   │
│  POST /api/v2/uploads/stuck/:id/retry   │  Manual recovery │
│  POST /api/v2/uploads/stuck/retry-all   │  Bulk recovery   │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Scheduled Jobs Specification

### 4.1 Job Registry Table

| Job Name | Schedule | Scope | Actions | Failure Mode |
|----------|----------|-------|---------|--------------|
| `StuckFileRecoveryJob` | Every 15 min | Files stuck >30min in non-terminal states | Re-enqueue (retry < 3) or Fail permanently | Alert to Slack, continue next file |
| `OrphanCleanupJob` | Daily 03:00 UTC | 3 scopes (orphan blobs, abandoned uploads, old failures) | Delete blobs + DB records | Log errors, skip to next scope |
| `BatchTimeoutJob` | Hourly | Batches in `active` >24h | Mark expired, delete unconfirmed files | Log error, continue next batch |

### 4.2 StuckFileRecoveryJob

**File**: `backend/src/infrastructure/queue/jobs/StuckFileRecoveryJob.ts`

**Purpose**: Automatically recover files stuck in processing states due to worker crashes or transient errors.

**Schedule**: Every 15 minutes (via BullMQ repeatable)

**Detection Query**:
```typescript
const STUCK_THRESHOLD_MS = parseInt(process.env.STUCK_FILE_THRESHOLD_MS || '1800000'); // 30 min
const MAX_STUCK_RETRIES = parseInt(process.env.MAX_STUCK_RETRIES || '3');

const stuckFiles = await prisma.files.findMany({
  where: {
    pipeline_status: {
      in: ['queued', 'extracting', 'chunking', 'embedding']
    },
    updated_at: {
      lt: new Date(Date.now() - STUCK_THRESHOLD_MS)
    }
  },
  select: {
    id: true,
    file_name: true,
    pipeline_status: true,
    retry_count: true,
    updated_at: true,
    user_id: true,
    batch_id: true
  }
});
```

**Recovery Logic**:
```typescript
for (const file of stuckFiles) {
  const currentRetries = file.retry_count || 0;

  if (currentRetries < MAX_STUCK_RETRIES) {
    // Re-enqueue for processing
    await fileRepository.transitionStatus(
      file.id,
      file.pipeline_status,
      'queued',
      { retry_count: currentRetries + 1 }
    );

    // Add back to flow
    await flowProducer.add({
      name: 'file-processing-flow',
      queueName: 'file-extract',
      data: { fileId: file.id, batchId: file.batch_id },
      children: [
        { name: 'chunk-job', queueName: 'file-chunk', data: { fileId: file.id } },
        { name: 'embed-job', queueName: 'file-embed', data: { fileId: file.id } }
      ]
    });

    this.logger.warn({
      fileId: file.id,
      fileName: file.file_name,
      previousStatus: file.pipeline_status,
      retryCount: currentRetries + 1,
      stuckDuration: Date.now() - file.updated_at.getTime()
    }, 'Re-enqueued stuck file');

  } else {
    // Permanently fail after max retries
    await fileRepository.transitionStatus(
      file.id,
      file.pipeline_status,
      'failed'
    );

    this.logger.error({
      fileId: file.id,
      fileName: file.file_name,
      retryCount: currentRetries,
      lastStatus: file.pipeline_status
    }, 'Stuck file permanently failed after max retries');

    // Enqueue user notification
    await notificationQueue.add('file-failure-notification', {
      userId: file.user_id,
      fileId: file.id,
      fileName: file.file_name,
      reason: 'Maximum retries exceeded'
    });
  }
}
```

**Configuration** (`.env`):
```bash
STUCK_FILE_THRESHOLD_MS=1800000      # 30 minutes
MAX_STUCK_RETRIES=3                   # Retry up to 3 times
STUCK_RECOVERY_SCHEDULE="*/15 * * * *"  # Every 15 min (cron)
```

**Metrics**:
```typescript
interface StuckFileMetrics {
  totalStuck: number;
  reEnqueued: number;
  permanentlyFailed: number;
  averageStuckDuration: number;
  byStatus: Record<PipelineStatus, number>;
}
```

---

### 4.3 OrphanCleanupJob

**File**: `backend/src/infrastructure/queue/jobs/OrphanCleanupJob.ts`

**Purpose**: Comprehensive cleanup across 3 scopes: orphan blobs, abandoned uploads, and old failures.

**Schedule**: Daily at 03:00 UTC (via BullMQ repeatable)

**Scope 1: Orphan Blob Detection & Cleanup**

Detect blobs in Azure Storage that have no corresponding DB record:

```typescript
async cleanupOrphanBlobs(userId: string): Promise<OrphanBlobReport> {
  // List all blob paths for user
  const blobPaths = await this.azureStorage.listBlobs(`uploads/${userId}`);

  // Get all DB blob paths
  const dbFiles = await prisma.files.findMany({
    where: { user_id: userId },
    select: { blob_path: true }
  });
  const dbPathSet = new Set(dbFiles.map(f => f.blob_path));

  // Find orphans (in storage but not in DB)
  const orphanPaths = blobPaths.filter(path => !dbPathSet.has(path));

  // Delete orphan blobs
  const deleted: string[] = [];
  const errors: Array<{ path: string; error: string }> = [];

  for (const orphanPath of orphanPaths) {
    try {
      await this.azureStorage.deleteBlob(orphanPath);
      deleted.push(orphanPath);
      this.logger.info({ blobPath: orphanPath, userId }, 'Deleted orphan blob');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      errors.push({ path: orphanPath, error: errMsg });
      this.logger.error({ blobPath: orphanPath, userId, error: errMsg }, 'Failed to delete orphan blob');
    }
  }

  return {
    totalOrphans: orphanPaths.length,
    deleted: deleted.length,
    errors
  };
}
```

**Scope 2: Abandoned Upload Cleanup**

Files with `pipeline_status = 'registered'` for >24 hours (upload never completed):

```typescript
const ABANDONED_THRESHOLD_MS = parseInt(process.env.ABANDONED_UPLOAD_THRESHOLD_MS || '86400000'); // 24h

const abandonedFiles = await prisma.files.findMany({
  where: {
    pipeline_status: 'registered',
    created_at: { lt: new Date(Date.now() - ABANDONED_THRESHOLD_MS) }
  },
  select: { id: true, file_name: true, blob_path: true, user_id: true }
});

for (const file of abandonedFiles) {
  // Delete blob if exists
  if (file.blob_path) {
    try {
      await azureStorage.deleteBlob(file.blob_path);
    } catch (error) {
      this.logger.warn({ fileId: file.id, blobPath: file.blob_path }, 'Blob already deleted or missing');
    }
  }

  // Delete DB record
  await prisma.files.delete({ where: { id: file.id } });

  this.logger.info({
    fileId: file.id,
    fileName: file.file_name,
    userId: file.user_id,
    age: Date.now() - file.created_at.getTime()
  }, 'Cleaned up abandoned upload');
}
```

**Scope 3: Old Failed File Cleanup**

Replaces `FileCleanupWorker` logic:

```typescript
const FAILED_RETENTION_DAYS = parseInt(process.env.FAILED_FILE_RETENTION_DAYS || '30');
const retentionDate = new Date(Date.now() - FAILED_RETENTION_DAYS * 24 * 60 * 60 * 1000);

const oldFailedFiles = await prisma.files.findMany({
  where: {
    pipeline_status: 'failed',
    updated_at: { lt: retentionDate }
  },
  select: { id: true, file_name: true, blob_path: true, user_id: true }
});

// Notify users before deletion (7-day warning period)
const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const toDelete = oldFailedFiles.filter(f => f.updated_at < sevenDaysAgo);
const toWarn = oldFailedFiles.filter(f => f.updated_at >= sevenDaysAgo);

// Send warnings for files 23-30 days old
for (const file of toWarn) {
  await notificationQueue.add('file-deletion-warning', {
    userId: file.user_id,
    fileId: file.id,
    fileName: file.file_name,
    deletionDate: new Date(file.updated_at.getTime() + 30 * 24 * 60 * 60 * 1000)
  });
}

// Delete files >30 days old
for (const file of toDelete) {
  if (file.blob_path) {
    await azureStorage.deleteBlob(file.blob_path);
  }
  await prisma.files.delete({ where: { id: file.id } });

  this.logger.info({ fileId: file.id, fileName: file.file_name }, 'Deleted old failed file');
}
```

**Configuration** (`.env`):
```bash
ABANDONED_UPLOAD_THRESHOLD_MS=86400000   # 24 hours
FAILED_FILE_RETENTION_DAYS=30            # 30 days
ORPHAN_CLEANUP_SCHEDULE="0 3 * * *"     # Daily at 03:00 UTC (cron)
```

**Metrics**:
```typescript
interface OrphanCleanupMetrics {
  orphanBlobs: { total: number; deleted: number; errors: number };
  abandonedUploads: { total: number; deleted: number };
  oldFailures: { warnings: number; deleted: number };
  executionTime: number;
}
```

---

### 4.4 BatchTimeoutJob

**File**: `backend/src/infrastructure/queue/jobs/BatchTimeoutJob.ts`

**Purpose**: Expire upload batches stuck in `active` status for >24 hours.

**Schedule**: Hourly (via BullMQ repeatable)

**Detection & Cleanup**:
```typescript
const BATCH_TIMEOUT_MS = parseInt(process.env.BATCH_TIMEOUT_MS || '86400000'); // 24 hours

const expiredBatches = await prisma.upload_batches.findMany({
  where: {
    status: 'active',
    created_at: { lt: new Date(Date.now() - BATCH_TIMEOUT_MS) }
  },
  select: {
    id: true,
    user_id: true,
    created_at: true,
    _count: { select: { files: true } }
  }
});

for (const batch of expiredBatches) {
  // Mark batch as expired
  await prisma.upload_batches.update({
    where: { id: batch.id },
    data: { status: 'expired' }
  });

  // Delete unconfirmed files (still in 'registered' status)
  const unconfirmedFiles = await prisma.files.findMany({
    where: {
      batch_id: batch.id,
      pipeline_status: 'registered'
    },
    select: { id: true, blob_path: true }
  });

  for (const file of unconfirmedFiles) {
    if (file.blob_path) {
      await azureStorage.deleteBlob(file.blob_path);
    }
  }

  await prisma.files.deleteMany({
    where: {
      batch_id: batch.id,
      pipeline_status: 'registered'
    }
  });

  this.logger.warn({
    batchId: batch.id,
    userId: batch.user_id,
    age: Date.now() - batch.created_at.getTime(),
    totalFiles: batch._count.files,
    deletedFiles: unconfirmedFiles.length
  }, 'Expired batch due to timeout');
}
```

**Configuration** (`.env`):
```bash
BATCH_TIMEOUT_MS=86400000               # 24 hours
BATCH_TIMEOUT_SCHEDULE="0 * * * *"     # Hourly (cron)
```

**Metrics**:
```typescript
interface BatchTimeoutMetrics {
  expiredBatches: number;
  deletedFiles: number;
  averageBatchAge: number;
}
```

---

## 5. Dashboard API Endpoints

### 5.1 Overview Endpoint

**Route**: `GET /api/v2/uploads/dashboard`

**Auth**: Required (JWT)

**Response Schema**:
```typescript
interface UploadDashboard {
  statusDistribution: Record<PipelineStatus, number>;
  activeBatches: number;
  dlqDepth: number;
  stuckFiles: number;
  queueDepths: {
    'file-extract': number;
    'file-chunk': number;
    'file-embed': number;
  };
  recentErrors: Array<{
    fileId: string;
    fileName: string;
    error: string;
    timestamp: string;
  }>;
  metrics: {
    averageProcessingTime: number;  // milliseconds
    throughput24h: number;          // files completed in last 24h
    failureRate24h: number;         // percentage
  };
}
```

**Implementation**:
```typescript
router.get('/dashboard', async (req, res) => {
  const userId = req.user!.id;

  // Status distribution
  const statusCounts = await prisma.files.groupBy({
    by: ['pipeline_status'],
    where: { user_id: userId },
    _count: { id: true }
  });
  const statusDistribution = Object.fromEntries(
    statusCounts.map(s => [s.pipeline_status, s._count.id])
  );

  // Active batches
  const activeBatches = await prisma.upload_batches.count({
    where: { user_id: userId, status: 'active' }
  });

  // DLQ depth
  const dlqJob = await Queue.fromName('file-processing-dlq');
  const dlqDepth = await dlqJob.count();

  // Stuck files (using same logic as recovery job)
  const stuckFiles = await prisma.files.count({
    where: {
      user_id: userId,
      pipeline_status: { in: ['queued', 'extracting', 'chunking', 'embedding'] },
      updated_at: { lt: new Date(Date.now() - STUCK_THRESHOLD_MS) }
    }
  });

  // Queue depths (from BullMQ)
  const extractQueue = Queue.fromName('file-extract');
  const chunkQueue = Queue.fromName('file-chunk');
  const embedQueue = Queue.fromName('file-embed');

  const queueDepths = {
    'file-extract': await extractQueue.count(),
    'file-chunk': await chunkQueue.count(),
    'file-embed': await embedQueue.count()
  };

  // Recent errors (last 10 from DLQ)
  const recentDLQJobs = await dlqJob.getJobs(['failed'], 0, 10);
  const recentErrors = recentDLQJobs.map(job => ({
    fileId: job.data.fileId,
    fileName: job.data.fileName,
    error: job.failedReason || 'Unknown error',
    timestamp: new Date(job.processedOn!).toISOString()
  }));

  // Metrics (last 24h)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const completedLast24h = await prisma.files.count({
    where: {
      user_id: userId,
      pipeline_status: 'ready',
      updated_at: { gte: oneDayAgo }
    }
  });

  const failedLast24h = await prisma.files.count({
    where: {
      user_id: userId,
      pipeline_status: 'failed',
      updated_at: { gte: oneDayAgo }
    }
  });

  const totalLast24h = completedLast24h + failedLast24h;
  const failureRate24h = totalLast24h > 0
    ? (failedLast24h / totalLast24h) * 100
    : 0;

  // Average processing time (last 100 completed files)
  const recentCompleted = await prisma.files.findMany({
    where: {
      user_id: userId,
      pipeline_status: 'ready',
      created_at: { not: null },
      updated_at: { not: null }
    },
    select: { created_at: true, updated_at: true },
    orderBy: { updated_at: 'desc' },
    take: 100
  });

  const processingTimes = recentCompleted.map(f =>
    f.updated_at.getTime() - f.created_at.getTime()
  );
  const averageProcessingTime = processingTimes.length > 0
    ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length
    : 0;

  res.json({
    statusDistribution,
    activeBatches,
    dlqDepth,
    stuckFiles,
    queueDepths,
    recentErrors,
    metrics: {
      averageProcessingTime: Math.round(averageProcessingTime),
      throughput24h: completedLast24h,
      failureRate24h: parseFloat(failureRate24h.toFixed(2))
    }
  });
});
```

---

### 5.2 Stuck Files Endpoint

**Route**: `GET /api/v2/uploads/stuck`

**Auth**: Required (JWT)

**Response Schema**:
```typescript
interface StuckFileDetails {
  files: Array<{
    id: string;
    fileName: string;
    status: PipelineStatus;
    stuckDuration: number;  // milliseconds
    retryCount: number;
    batchId: string | null;
    updatedAt: string;
  }>;
  total: number;
}
```

**Implementation**:
```typescript
router.get('/stuck', async (req, res) => {
  const userId = req.user!.id;

  const stuckFiles = await prisma.files.findMany({
    where: {
      user_id: userId,
      pipeline_status: { in: ['queued', 'extracting', 'chunking', 'embedding'] },
      updated_at: { lt: new Date(Date.now() - STUCK_THRESHOLD_MS) }
    },
    select: {
      id: true,
      file_name: true,
      pipeline_status: true,
      retry_count: true,
      batch_id: true,
      updated_at: true
    },
    orderBy: { updated_at: 'asc' }
  });

  const files = stuckFiles.map(f => ({
    id: f.id,
    fileName: f.file_name,
    status: f.pipeline_status,
    stuckDuration: Date.now() - f.updated_at.getTime(),
    retryCount: f.retry_count || 0,
    batchId: f.batch_id,
    updatedAt: f.updated_at.toISOString()
  }));

  res.json({ files, total: files.length });
});
```

---

### 5.3 Orphan Report Endpoint

**Route**: `GET /api/v2/uploads/orphans`

**Auth**: Required (JWT)

**Response Schema**:
```typescript
interface OrphanReport {
  lastScanTime: string | null;
  orphanBlobs: {
    count: number;
    totalSize: number;  // bytes
    samples: string[];  // First 10 orphan blob paths
  };
  abandonedUploads: {
    count: number;
    oldestAge: number;  // milliseconds
  };
}
```

**Implementation**:
```typescript
router.get('/orphans', async (req, res) => {
  const userId = req.user!.id;

  // Get last scan time from Redis
  const lastScanKey = `orphan-scan:${userId}:last-run`;
  const lastScanTime = await redis.get(lastScanKey);

  // Count abandoned uploads
  const abandonedCount = await prisma.files.count({
    where: {
      user_id: userId,
      pipeline_status: 'registered',
      created_at: { lt: new Date(Date.now() - ABANDONED_THRESHOLD_MS) }
    }
  });

  const oldestAbandoned = await prisma.files.findFirst({
    where: {
      user_id: userId,
      pipeline_status: 'registered',
      created_at: { lt: new Date(Date.now() - ABANDONED_THRESHOLD_MS) }
    },
    orderBy: { created_at: 'asc' },
    select: { created_at: true }
  });

  const oldestAge = oldestAbandoned
    ? Date.now() - oldestAbandoned.created_at.getTime()
    : 0;

  // Orphan blob detection (scan on-demand, cache for 1 hour)
  const orphanCacheKey = `orphan-blobs:${userId}`;
  let orphanData = await redis.get(orphanCacheKey);

  if (!orphanData) {
    // Perform scan
    const blobPaths = await azureStorage.listBlobs(`uploads/${userId}`);
    const dbFiles = await prisma.files.findMany({
      where: { user_id: userId },
      select: { blob_path: true }
    });
    const dbPathSet = new Set(dbFiles.map(f => f.blob_path));

    const orphanPaths = blobPaths.filter(path => !dbPathSet.has(path));

    // Get sizes (expensive, limit to first 100)
    const samplePaths = orphanPaths.slice(0, 100);
    const sizes = await Promise.all(
      samplePaths.map(path => azureStorage.getBlobSize(path).catch(() => 0))
    );
    const totalSize = sizes.reduce((a, b) => a + b, 0);

    orphanData = JSON.stringify({
      count: orphanPaths.length,
      totalSize: Math.round(totalSize * (orphanPaths.length / samplePaths.length)),
      samples: orphanPaths.slice(0, 10)
    });

    await redis.setex(orphanCacheKey, 3600, orphanData); // Cache 1 hour
  }

  const orphanBlobs = JSON.parse(orphanData);

  res.json({
    lastScanTime,
    orphanBlobs,
    abandonedUploads: {
      count: abandonedCount,
      oldestAge
    }
  });
});
```

---

### 5.4 Manual Recovery Endpoints

**Route 1**: `POST /api/v2/uploads/stuck/:fileId/retry`

**Auth**: Required (JWT)

**Response**:
```typescript
interface RetryResponse {
  success: boolean;
  fileId: string;
  previousStatus: PipelineStatus;
  newStatus: 'queued';
  retryCount: number;
}
```

**Implementation**:
```typescript
router.post('/stuck/:fileId/retry', async (req, res) => {
  const userId = req.user!.id;
  const { fileId } = req.params;

  const file = await prisma.files.findFirst({
    where: { id: fileId, user_id: userId },
    select: {
      id: true,
      pipeline_status: true,
      retry_count: true,
      batch_id: true
    }
  });

  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  const terminalStates: PipelineStatus[] = ['ready', 'failed'];
  if (terminalStates.includes(file.pipeline_status)) {
    return res.status(400).json({ error: 'File is in terminal state' });
  }

  const newRetryCount = (file.retry_count || 0) + 1;

  // Transition to queued
  await fileRepository.transitionStatus(
    file.id,
    file.pipeline_status,
    'queued',
    { retry_count: newRetryCount }
  );

  // Re-enqueue
  await flowProducer.add({
    name: 'file-processing-flow',
    queueName: 'file-extract',
    data: { fileId: file.id, batchId: file.batch_id },
    children: [
      { name: 'chunk-job', queueName: 'file-chunk', data: { fileId: file.id } },
      { name: 'embed-job', queueName: 'file-embed', data: { fileId: file.id } }
    ]
  });

  res.json({
    success: true,
    fileId: file.id,
    previousStatus: file.pipeline_status,
    newStatus: 'queued',
    retryCount: newRetryCount
  });
});
```

**Route 2**: `POST /api/v2/uploads/stuck/retry-all`

**Auth**: Required (JWT)

**Response**:
```typescript
interface BulkRetryResponse {
  success: boolean;
  retriedCount: number;
  skippedCount: number;
  errors: Array<{ fileId: string; error: string }>;
}
```

**Implementation**:
```typescript
router.post('/stuck/retry-all', async (req, res) => {
  const userId = req.user!.id;

  const stuckFiles = await prisma.files.findMany({
    where: {
      user_id: userId,
      pipeline_status: { in: ['queued', 'extracting', 'chunking', 'embedding'] },
      updated_at: { lt: new Date(Date.now() - STUCK_THRESHOLD_MS) }
    },
    select: {
      id: true,
      pipeline_status: true,
      retry_count: true,
      batch_id: true
    }
  });

  let retriedCount = 0;
  let skippedCount = 0;
  const errors: Array<{ fileId: string; error: string }> = [];

  for (const file of stuckFiles) {
    try {
      const currentRetries = file.retry_count || 0;

      if (currentRetries >= MAX_STUCK_RETRIES) {
        skippedCount++;
        continue;
      }

      await fileRepository.transitionStatus(
        file.id,
        file.pipeline_status,
        'queued',
        { retry_count: currentRetries + 1 }
      );

      await flowProducer.add({
        name: 'file-processing-flow',
        queueName: 'file-extract',
        data: { fileId: file.id, batchId: file.batch_id },
        children: [
          { name: 'chunk-job', queueName: 'file-chunk', data: { fileId: file.id } },
          { name: 'embed-job', queueName: 'file-embed', data: { fileId: file.id } }
        ]
      });

      retriedCount++;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      errors.push({ fileId: file.id, error: errMsg });
    }
  }

  res.json({
    success: true,
    retriedCount,
    skippedCount,
    errors
  });
});
```

---

## 6. Implementation Scope

### 6.1 File Structure

```
backend/src/infrastructure/queue/jobs/
├── StuckFileRecoveryJob.ts          (NEW)
├── OrphanCleanupJob.ts               (NEW)
├── BatchTimeoutJob.ts                (NEW)
└── index.ts                          (export all jobs)

backend/src/routes/v2/
└── upload-dashboard.routes.ts        (NEW - 5 endpoints)

backend/src/domains/files/
├── recovery/                         (NEW)
│   ├── IStuckFileDetector.ts
│   ├── StuckFileDetector.ts
│   └── RecoveryStrategy.ts
└── cleanup/                          (NEW)
    ├── IOrphanDetector.ts
    ├── OrphanBlobDetector.ts
    └── CleanupPolicy.ts

backend/src/infrastructure/queue/
└── JobScheduler.ts                   (NEW - BullMQ repeatable job manager)
```

### 6.2 Affected Components

| Component | Change Type | Reason |
|-----------|-------------|--------|
| `FileCleanupWorker.ts` | **Deprecate** | Replaced by `OrphanCleanupJob` |
| `PartialDataCleaner.ts` | **Deprecate** | Logic moved to recovery/cleanup jobs |
| `FileRepository.ts` | **Extend** | Add `transitionStatus()` method for retry_count updates |
| `AzureStorageService.ts` | **Extend** | Add `listBlobs()` and `getBlobSize()` methods |
| `upload-session.routes.ts` | **No change** | Coexists with new dashboard routes |

### 6.3 Database Schema Changes

**Add column to `files` table**:
```sql
ALTER TABLE files ADD COLUMN retry_count INT DEFAULT 0;
```

**Add column to `upload_batches` table** (if not exists):
```sql
ALTER TABLE upload_batches ADD COLUMN status VARCHAR(20) DEFAULT 'active';
-- Allowed values: 'active', 'completed', 'expired'
```

**Update Prisma schema** (`backend/prisma/schema.prisma`):
```prisma
model files {
  // ... existing fields ...
  retry_count Int @default(0)
}

model upload_batches {
  // ... existing fields ...
  status String @default("active") @db.VarChar(20)
}
```

---

## 7. Testing Strategy

### 7.1 Unit Tests

**StuckFileRecoveryJob.test.ts**:
```typescript
describe('StuckFileRecoveryJob', () => {
  it('should re-enqueue files stuck for >30 min with retry_count < 3');
  it('should permanently fail files with retry_count >= 3');
  it('should not touch files updated within threshold');
  it('should handle flow producer errors gracefully');
  it('should emit metrics after each run');
});
```

**OrphanCleanupJob.test.ts**:
```typescript
describe('OrphanCleanupJob - Orphan Blobs', () => {
  it('should detect blobs in storage but not in DB');
  it('should skip blobs that exist in DB');
  it('should delete orphan blobs via Azure Storage API');
  it('should log errors for blobs that fail to delete');
});

describe('OrphanCleanupJob - Abandoned Uploads', () => {
  it('should delete files with pipeline_status=registered older than 24h');
  it('should delete corresponding blobs');
  it('should skip files uploaded within threshold');
});

describe('OrphanCleanupJob - Old Failures', () => {
  it('should send warning notification for files 23-30 days old');
  it('should delete files with pipeline_status=failed older than 30 days');
  it('should delete corresponding blobs');
});
```

**BatchTimeoutJob.test.ts**:
```typescript
describe('BatchTimeoutJob', () => {
  it('should expire batches in active status older than 24h');
  it('should delete unconfirmed files from expired batches');
  it('should preserve files in processing/ready states');
  it('should handle batches with no files');
});
```

### 7.2 Integration Tests

**Dashboard Endpoints** (`upload-dashboard.routes.integration.test.ts`):
```typescript
describe('GET /api/v2/uploads/dashboard', () => {
  it('should return status distribution for authenticated user');
  it('should calculate stuck files correctly');
  it('should return queue depths from BullMQ');
  it('should filter by user_id (no cross-user data leak)');
});

describe('POST /api/v2/uploads/stuck/:fileId/retry', () => {
  it('should re-enqueue stuck file and increment retry_count');
  it('should reject files in terminal states');
  it('should reject files not owned by user');
});

describe('POST /api/v2/uploads/stuck/retry-all', () => {
  it('should re-enqueue all stuck files below max retries');
  it('should skip files at max retries');
  it('should handle partial failures gracefully');
});
```

### 7.3 E2E Test Scenarios

**Scenario 1: Stuck File Recovery**
1. Upload file, kill worker mid-processing
2. Wait 35 minutes (>STUCK_THRESHOLD)
3. Run `StuckFileRecoveryJob` manually
4. Verify file transitions to `queued` and retry_count increments
5. Verify file completes processing after re-enqueue

**Scenario 2: Orphan Blob Cleanup**
1. Upload file to Azure Storage
2. Simulate DB insert failure (rollback transaction)
3. Run `OrphanCleanupJob`
4. Verify blob deleted from storage
5. Verify no DB record exists

**Scenario 3: Batch Timeout**
1. Start batch upload (5 files)
2. Upload 2 files, wait 25 hours
3. Run `BatchTimeoutJob`
4. Verify batch status = `expired`
5. Verify unconfirmed files (3) deleted
6. Verify uploaded files (2) preserved

---

## 8. Configuration Reference

### 8.1 Environment Variables

```bash
# Stuck File Recovery
STUCK_FILE_THRESHOLD_MS=1800000       # 30 minutes
MAX_STUCK_RETRIES=3
STUCK_RECOVERY_SCHEDULE="*/15 * * * *"  # Every 15 min

# Orphan Cleanup
ABANDONED_UPLOAD_THRESHOLD_MS=86400000  # 24 hours
FAILED_FILE_RETENTION_DAYS=30
ORPHAN_CLEANUP_SCHEDULE="0 3 * * *"    # Daily at 03:00 UTC

# Batch Timeout
BATCH_TIMEOUT_MS=86400000              # 24 hours
BATCH_TIMEOUT_SCHEDULE="0 * * * *"    # Hourly

# Dashboard
DASHBOARD_CACHE_TTL=300                # 5 minutes (Redis cache for metrics)
```

### 8.2 BullMQ Job Registration

**File**: `backend/src/infrastructure/queue/JobScheduler.ts`

```typescript
import { Queue } from 'bullmq';
import { StuckFileRecoveryJob } from './jobs/StuckFileRecoveryJob';
import { OrphanCleanupJob } from './jobs/OrphanCleanupJob';
import { BatchTimeoutJob } from './jobs/BatchTimeoutJob';

export class JobScheduler {
  static async initialize() {
    const maintenanceQueue = new Queue('maintenance', { connection: redisConnection });

    // Register repeatable jobs
    await maintenanceQueue.add(
      'stuck-file-recovery',
      {},
      {
        repeat: {
          pattern: process.env.STUCK_RECOVERY_SCHEDULE || '*/15 * * * *'
        },
        jobId: 'stuck-file-recovery-job'  // Prevent duplicates
      }
    );

    await maintenanceQueue.add(
      'orphan-cleanup',
      {},
      {
        repeat: {
          pattern: process.env.ORPHAN_CLEANUP_SCHEDULE || '0 3 * * *'
        },
        jobId: 'orphan-cleanup-job'
      }
    );

    await maintenanceQueue.add(
      'batch-timeout',
      {},
      {
        repeat: {
          pattern: process.env.BATCH_TIMEOUT_SCHEDULE || '0 * * * *'
        },
        jobId: 'batch-timeout-job'
      }
    );

    logger.info('Scheduled maintenance jobs registered');
  }

  static async shutdown() {
    // Remove all repeatable jobs (for graceful shutdown)
    const maintenanceQueue = new Queue('maintenance', { connection: redisConnection });
    const repeatableJobs = await maintenanceQueue.getRepeatableJobs();

    for (const job of repeatableJobs) {
      await maintenanceQueue.removeRepeatableByKey(job.key);
    }

    logger.info('Scheduled maintenance jobs removed');
  }
}
```

**Initialize on server startup** (`backend/src/index.ts`):
```typescript
import { JobScheduler } from '@/infrastructure/queue/JobScheduler';

// After Express app setup
await JobScheduler.initialize();

// On shutdown
process.on('SIGTERM', async () => {
  await JobScheduler.shutdown();
  process.exit(0);
});
```

---

## 9. Metrics & Monitoring

### 9.1 Logging Standards

All jobs must log structured events:

```typescript
// Start event
this.logger.info({
  job: 'StuckFileRecoveryJob',
  threshold: STUCK_THRESHOLD_MS,
  maxRetries: MAX_STUCK_RETRIES
}, 'Starting stuck file recovery scan');

// Detection event
this.logger.warn({
  fileId: file.id,
  fileName: file.file_name,
  status: file.pipeline_status,
  stuckDuration: Date.now() - file.updated_at.getTime(),
  retryCount: file.retry_count
}, 'Detected stuck file');

// Recovery event
this.logger.info({
  fileId: file.id,
  action: 'reEnqueued',
  newRetryCount: file.retry_count + 1
}, 'Re-enqueued stuck file');

// Failure event
this.logger.error({
  fileId: file.id,
  action: 'permanentlyFailed',
  retryCount: file.retry_count,
  lastStatus: file.pipeline_status
}, 'Stuck file permanently failed');

// Completion event
this.logger.info({
  job: 'StuckFileRecoveryJob',
  metrics: {
    totalStuck: stuckFiles.length,
    reEnqueued: recoveredCount,
    permanentlyFailed: failedCount,
    duration: Date.now() - startTime
  }
}, 'Stuck file recovery completed');
```

### 9.2 Prometheus Metrics (Future)

Expose metrics for Grafana dashboards:

```typescript
// File state gauges
file_pipeline_status{status="queued"} 45
file_pipeline_status{status="extracting"} 12
file_pipeline_status{status="ready"} 1847
file_pipeline_status{status="failed"} 23

// Recovery job metrics
stuck_file_recovery_total{action="reEnqueued"} 127
stuck_file_recovery_total{action="permanentlyFailed"} 8
stuck_file_detection_duration_seconds 1.23

// Cleanup job metrics
orphan_blobs_deleted_total 342
abandoned_uploads_deleted_total 18
cleanup_execution_duration_seconds 45.67

// Dashboard request latency
dashboard_request_duration_seconds{endpoint="/dashboard"} 0.125
dashboard_request_duration_seconds{endpoint="/stuck"} 0.087
```

---

## 10. Success Criteria

### 10.1 Functional Requirements

- [ ] Files stuck >30 min in non-terminal states are detected and re-enqueued automatically
- [ ] Files with retry_count >= 3 are permanently failed with user notification
- [ ] Orphan blobs (no DB record) are detected and deleted daily
- [ ] Abandoned uploads (pipeline_status=registered >24h) are cleaned up daily
- [ ] Old failed files (>30 days) are deleted with 7-day warning notification
- [ ] Expired batches (active >24h) are marked expired and unconfirmed files deleted
- [ ] Dashboard endpoint returns accurate real-time metrics (status distribution, stuck files, queue depths)
- [ ] Manual retry endpoint re-enqueues individual stuck files
- [ ] Bulk retry endpoint re-enqueues all stuck files below max retries
- [ ] All scheduled jobs are idempotent (safe to run multiple times)

### 10.2 Non-Functional Requirements

- [ ] All jobs log structured events (JSON format, service context)
- [ ] All endpoints return responses in <200ms (cached where applicable)
- [ ] Dashboard API endpoints enforce user isolation (no cross-user data leaks)
- [ ] Jobs handle partial failures gracefully (continue to next item)
- [ ] Configuration via environment variables (no hardcoded thresholds)
- [ ] Unit test coverage >80% for recovery/cleanup logic
- [ ] Integration tests verify dashboard data accuracy
- [ ] E2E tests verify end-to-end recovery flows

### 10.3 Verification Checklist

**Curl Test Suite**:
```bash
# 1. Check dashboard (should show current state)
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3002/api/v2/uploads/dashboard

# 2. List stuck files
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3002/api/v2/uploads/stuck

# 3. Retry single stuck file
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3002/api/v2/uploads/stuck/$FILE_ID/retry

# 4. Retry all stuck files
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3002/api/v2/uploads/stuck/retry-all

# 5. Check orphan report
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3002/api/v2/uploads/orphans
```

**Manual Testing**:
1. Upload file, kill worker mid-processing → Wait 35 min → Verify auto-recovery
2. Upload blob without DB insert → Run OrphanCleanupJob → Verify blob deleted
3. Start batch, abandon after 2 files → Wait 25h → Verify batch expired
4. Check dashboard after each scenario → Verify metrics accurate

---

## 11. Reusable Patterns

### 11.1 Generic Stuck Detection Pattern

```typescript
interface StuckDetectionConfig<T> {
  findStuckItems: () => Promise<T[]>;
  getStuckDuration: (item: T) => number;
  getRetryCount: (item: T) => number;
  recover: (item: T) => Promise<void>;
  fail: (item: T) => Promise<void>;
}

class StuckItemRecovery<T> {
  async run(config: StuckDetectionConfig<T>) {
    const items = await config.findStuckItems();

    for (const item of items) {
      const retries = config.getRetryCount(item);

      if (retries < MAX_RETRIES) {
        await config.recover(item);
      } else {
        await config.fail(item);
      }
    }
  }
}
```

### 11.2 Orphan Detection Pattern

```typescript
interface OrphanDetectionConfig {
  listStorageItems: () => Promise<string[]>;
  listDatabaseItems: () => Promise<string[]>;
  deleteOrphan: (item: string) => Promise<void>;
}

class OrphanDetector {
  async run(config: OrphanDetectionConfig) {
    const storageItems = await config.listStorageItems();
    const dbItems = await config.listDatabaseItems();
    const dbSet = new Set(dbItems);

    const orphans = storageItems.filter(item => !dbSet.has(item));

    for (const orphan of orphans) {
      await config.deleteOrphan(orphan);
    }
  }
}
```

---

## 12. Dependencies

### 12.1 Internal Dependencies

- **PRD-01 (State Machine)**: Detection queries rely on `pipeline_status` field and valid state transitions
- **PRD-04 (DLQ & Flow Producer)**: Re-enqueue logic uses `FlowProducer` from PRD-04; DLQ metrics surfaced in dashboard

### 12.2 External Dependencies

- **BullMQ**: Repeatable jobs for scheduling
- **Prisma**: State queries and updates
- **Azure Blob Storage SDK**: Blob listing and deletion
- **Redis**: Metrics caching for dashboard

---

## 13. Closing Deliverables

### 13.1 Code Deliverables

- [ ] `StuckFileRecoveryJob.ts` with unit tests
- [ ] `OrphanCleanupJob.ts` with unit tests
- [ ] `BatchTimeoutJob.ts` with unit tests
- [ ] `JobScheduler.ts` with initialization logic
- [ ] `upload-dashboard.routes.ts` with 5 endpoints
- [ ] `FileRepository.transitionStatus()` method with retry_count support
- [ ] `AzureStorageService` extensions (listBlobs, getBlobSize)
- [ ] Integration tests for dashboard endpoints
- [ ] E2E tests for recovery flows

### 13.2 Documentation Deliverables

- [ ] Environment variable reference (`.env.example` updates)
- [ ] API documentation for 5 dashboard endpoints (OpenAPI/Swagger)
- [ ] Runbook: "How to diagnose stuck files" (for ops team)
- [ ] Runbook: "How to manually trigger recovery jobs"
- [ ] Dashboard metric interpretation guide

### 13.3 Migration Deliverables

- [ ] Database migration script (add `retry_count` column)
- [ ] Deprecation warnings in `FileCleanupWorker.ts` and `PartialDataCleaner.ts`
- [ ] Rollback plan (revert to manual SQL cleanup if needed)

### 13.4 Verification Deliverables

- [ ] Curl test suite (bash script for all 5 endpoints)
- [ ] Grafana dashboard JSON (if Prometheus metrics implemented)
- [ ] Load test results (dashboard endpoint performance under 1000 files)

---

## 14. Appendix

### 14.1 State Transition Diagram (with Recovery)

```
┌──────────────┐
│  registered  │
└──────┬───────┘
       │ (upload completes)
       ▼
┌──────────────┐   STUCK >30min   ┌──────────────────┐
│   uploaded   │ ────────────────▶│ StuckFileRecovery│
└──────┬───────┘                  │  Job (retry)     │
       │                          └────────┬─────────┘
       │                                   │
       ▼                                   ▼
┌──────────────┐   STUCK >30min   ┌──────────────────┐
│    queued    │◀──────────────────│   back to queued │
└──────┬───────┘                  └──────────────────┘
       │                                   │
       │ (worker picks up)                 │ (retry_count++)
       ▼                                   │
┌──────────────┐   STUCK >30min           │
│  extracting  │──────────────────────────┤
└──────┬───────┘                          │
       │                                   │
       ▼                                   │
┌──────────────┐   STUCK >30min           │
│   chunking   │──────────────────────────┤
└──────┬───────┘                          │
       │                                   │
       ▼                                   │
┌──────────────┐   STUCK >30min           │
│  embedding   │──────────────────────────┤
└──────┬───────┘                          │
       │                                   │
       ▼                                   │
┌──────────────┐                          │
│     ready    │                          │
└──────────────┘                          │
                                          │
                          retry_count >= 3│
                                          ▼
                                  ┌──────────────┐
                                  │    failed    │
                                  └──────────────┘
                                          │
                                          │ (>30 days)
                                          ▼
                                  [OrphanCleanupJob]
                                          │
                                          ▼
                                      [DELETED]
```

### 14.2 Orphan Detection Flow

```
┌─────────────────────────────────────────────────────────────┐
│                  OrphanCleanupJob (Daily)                    │
└─────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
            ▼                 ▼                 ▼
   ┌────────────────┐ ┌──────────────┐ ┌─────────────────┐
   │ Orphan Blobs   │ │  Abandoned   │ │  Old Failures   │
   │   Detection    │ │   Uploads    │ │   Cleanup       │
   └────────┬───────┘ └──────┬───────┘ └────────┬────────┘
            │                │                   │
            │                │                   │
   ┌────────▼────────┐      │          ┌────────▼────────┐
   │ List blobs in   │      │          │ Query files:    │
   │ Azure Storage   │      │          │ - status=failed │
   │                 │      │          │ - >30 days old  │
   └────────┬────────┘      │          └────────┬────────┘
            │                │                   │
   ┌────────▼────────┐ ┌────▼────────┐ ┌────────▼────────┐
   │ Query DB for    │ │ Query files:│ │ Send warnings   │
   │ all blob_paths  │ │ - registered│ │ (23-30 days)    │
   └────────┬────────┘ │ - >24h old  │ └────────┬────────┘
            │          └─────┬───────┘          │
   ┌────────▼────────┐       │          ┌───────▼─────────┐
   │ Find difference │       │          │ Delete blobs +  │
   │ (orphan blobs)  │       │          │ DB records      │
   └────────┬────────┘       │          │ (>30 days only) │
            │                │          └─────────────────┘
   ┌────────▼────────┐ ┌─────▼───────┐
   │ Delete orphan   │ │ Delete blobs│
   │ blobs from      │ │ + DB records│
   │ Azure Storage   │ └─────────────┘
   └─────────────────┘
```

### 14.3 Dashboard Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│          GET /api/v2/uploads/dashboard                       │
└─────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
            ▼                 ▼                 ▼
   ┌────────────────┐ ┌──────────────┐ ┌─────────────────┐
   │   Prisma       │ │   BullMQ     │ │     Redis       │
   │   Queries      │ │   Queries    │ │     Cache       │
   └────────┬───────┘ └──────┬───────┘ └────────┬────────┘
            │                │                   │
            │                │                   │
   ┌────────▼────────────────▼───────────────────▼────────┐
   │                  Aggregate Metrics                    │
   │  - Status distribution (Prisma groupBy)               │
   │  - Stuck files (Prisma count + date filter)           │
   │  - Queue depths (BullMQ Queue.count())                │
   │  - DLQ depth (BullMQ Queue.getFailedCount())          │
   │  - Recent errors (BullMQ Job.getJobs(['failed']))     │
   │  - 24h metrics (Prisma count + date range)            │
   └───────────────────────────┬───────────────────────────┘
                               │
                               ▼
                      ┌────────────────┐
                      │ Cache in Redis │
                      │ (TTL: 5 min)   │
                      └────────┬───────┘
                               │
                               ▼
                      ┌────────────────┐
                      │ Return JSON    │
                      └────────────────┘
```

---

**End of PRD-05**
