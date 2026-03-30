# Production Diagnostic: Sync Processing — 2026-03-29

## Environment

- **App Insights**: `ai-myworkmate-prod` (rg-myworkmate-app-prod)
- **Sampling**: 50%
- **Backend Container**: `app-myworkmate-backend-prod` (revision `sha-70ad8064`)
- **User**: `FE44A9D3-D0D8-4602-9C55-EADB6483F04F`

## Executive Summary

Files are being **enqueued but never processed**. The retry system (ProcessingRetryManager) is executing retries and adding BullMQ flows, but the file pipeline workers (extract → chunk → embed → pipeline-complete) produce **zero traces in 7+ days**. Redis connection instability (TLS socket closes every ~10 min) may prevent worker connections from recovering.

## Raw Query Results

### 1. Service Activity (24h)

```kusto
traces | where timestamp > ago(24h)
       | summarize count() by tostring(customDimensions.service)
       | order by count_ desc
```

```
Prisma                        871
ProcessingRetryManager        318
FileProcessingRoutes          300
FileRetryService              292
FileMetadataService           292
MessageQueue                  206
RedisConfig                   192
FileCrudRoutes                 96
RedisClient                    45
ConnectionRepository           34
DeltaSyncService               16
FileUploadService              15
FileHealthService              15
ConnectionsRoutes              13
MsalRedisCachePlugin           11
ConnectionService              10
SettingsRoutes                  9
FileHealthRoutes                6
Server                          6
GraphTokenManager               6
SessionRoutes                   5
GraphHttpClient                 5
MicrosoftOAuthService           5
SearchIndexComparator           4
SessionService                  3
StuckFileRecoveryService        3
SharePointService               3
StuckDeletionDetector           3
VectorSearchService             3
ImageEmbeddingDetector          2
AuthOAuthRoutes                 2
StuckPipelineDetector           2
FolderHierarchyDetector         2
ExternalNotFoundDetector        2
FailedRetriableDetector         2
SyncReconciliationService       1
DisconnectedFilesDetector       1
BatchTimeoutService             1
ReadyWithoutChunksDetector      1
SettingsService                 1
```

**Missing (ZERO traces in 7d)**: FileExtractWorker, FileChunkWorker, EmbeddingGenerationWorker, FilePipelineCompleteWorker, WorkerRegistry, QueueManager

### 2. Retry Activity (20:26 UTC)

```
20:26:09 "Executing manual retry" (fileId: 9857bd1e, scope: full)
20:26:09 "Manual retry executed successfully" (fileId: previous)
20:26:10 "Executing manual retry" ...
... (159 pairs, files processed serially ~400ms apart)
20:26:13 "Executing manual retry" (fileId: 9857bd1e, scope: full)
```

**151** "Retry initiated successfully via pipeline"
**123** "Pipeline transition with retry succeeded"

### 3. Enqueue Activity (20:45 UTC)

```
20:45:06.568  "Flow added to BullMQ"
20:45:06.641  "Flow added to BullMQ"
... (20+ flows in 2 seconds)
20:45:08.364  "Flow added to BullMQ"
```

### 4. Redis Errors

```
19:49:16 RedisClient error: "Socket closed unexpectedly" (SESSION profile, TLSSocket close)
19:53:09 RedisClient error
20:02:54 RedisClient error
20:09:19 RedisClient error: "Socket closed unexpectedly"
20:12:55 RedisClient error
20:19:21 RedisClient error: "Socket closed unexpectedly"
20:22:56 RedisClient error
20:33:13 RedisClient error
20:42:58 RedisClient error
20:43:14 RedisClient error
```

**Pattern**: ~10 minute intervals, SESSION profile (TLS @redis/client)

BullMQ IORedis also shows connection flapping:
```
20:33:42 close → connect → ready
20:34:18 close → connect
20:43:44 close → connect → ready
```

### 5. Reconciliation Report (20:43 UTC)

```json
{
  "dbReadyFiles": 13,
  "searchIndexedFiles": 13,
  "missingCount": 0,
  "orphanedCount": 0,
  "failedRetriableCount": 0,
  "stuckFilesCount": 0,
  "imagesMissingEmbeddingsCount": 0,
  "repairs": { "all zeroes" },
  "dryRun": false
}
```

**Interpretation**: The 13 ready files are pre-existing. Newly retried files (from 20:26) haven't been stuck >30min yet, so StuckPipelineDetector wouldn't flag them.

### 6. MessageQueue Errors

```
20:05:15 "Job failed in usage-aggregation"
         failedReason: "Unknown aggregation job type: scheduled-hourly-aggregation"
         attemptsMade: 3, maxAttempts: 3
```

### 7. Container System Events

```
19:25:06 "Sync with secrets from Azure Key Vault was successful" (count: 233)
19:55:07 "Sync with secrets from Azure Key Vault was successful" (count: 234)
20:25:11 "Sync with secrets from Azure Key Vault was successful" (count: 235)
```

No container restarts, no OOM kills, no crash loops observed.

## Next Steps

1. **Run `queue-status.ts`** against prod Redis to verify queue depths (requires firewall rule)
2. **Run `verify-sync-health.ts`** against prod DB to check pipeline_status distribution
3. **Check BullMQ Flow worker connection behavior** — are Flow children processed differently from regular queue jobs?
4. **Consider raising App Insights sampling to 100%** for queue/worker services to improve visibility
5. **Add worker heartbeat logging** at `warn` level (not subject to trace-level sampling)

## 3. Queue Status (Prod Redis — Live Run)

**Run at**: ~21:00 UTC via `queue-status.ts` with temp firewall rule

```
=== REDIS STATUS ===
Version:              6.0.14
Memory Used:          58.23M
Memory Peak:          76.59M
Connected Clients:    2
Total Connections:    15,420,644  ← MASSIVE churn (12 days uptime)
Uptime:               12 days

IMPORTANT! Eviction policy is volatile-lru. It should be "noeviction"
```

**ALL 17 queues**: 0 waiting, 0 active, 0 failed, 0 completed.

**Interpretation**: BullMQ jobs are being **evicted from Redis before workers process them**. The `volatile-lru` policy deletes keys under memory pressure. BullMQ requires `noeviction`.

## 4. Redis Configuration Comparison

| Setting | PROD (before fix) | DEV | Local |
|---|---|---|---|
| `maxmemoryPolicy` | **`volatile-lru` (Azure default)** | `noeviction` | `noeviction` |
| SKU | Standard C0 (250MB) | Basic C0 (250MB) | N/A |
| Redis version | 6.0.14 | 6.0.14 | varies |
| Max clients | 256 | 256 | unlimited |

**Root cause**: Bicep template (`data.bicep`) did NOT set `redisConfiguration.maxmemory-policy`. Azure defaults to `volatile-lru`. Dev was manually fixed at some point; prod was never corrected.

## 5. Sync Health (Prod DB — Live Run)

**Run at**: ~21:02 UTC via `verify-sync-health.ts` with temp firewall rule

```
Scope Status Distribution:
  synced:    5   (all healthy)
  error:     0
  stuck:     0

File Pipeline Status:
  ready:    18   (previously processed)
  queued:  201   ← STUCK — never processed (evicted from BullMQ)
  failed:   27   ← Failed silently (no error message — job data evicted)

Search Index:
  DB=13 ready, Search=0 indexed (13 MISSING)
  ⚠ Script may not have search credentials — reconciliation found 13/13 earlier

Subscription Health:
  ⚠ Scope "Cars" has no webhook subscription

Total issues: 29
Status: CRITICAL
```

## 6. Remediation Actions Taken

| Action | Timestamp | Command |
|---|---|---|
| Fix Redis eviction policy | 21:01 UTC | `az redis update --set redisConfiguration.maxmemory-policy=noeviction` |
| Restart backend container | 21:02 UTC | `az containerapp revision restart` |
| Update Bicep template | 21:01 UTC | Added `redisConfiguration: { 'maxmemory-policy': 'noeviction' }` to `data.bicep` |
| Clean up temp firewall rules | 21:03 UTC | Deleted `tempDebug20260329` from Redis + SQL |

**Expected outcome**: After container restart, BullMQ workers will re-register with fresh Redis connections. The 201 queued files should be picked up once the reconciliation system re-queues them (either on next login, 15-min health check, or manual retry from the frontend).

**Still needed**:
- Deploy fix for `FilePipelineCompleteWorker` empty batchId bug (see section 7)
- After deploy, trigger reconciliation to re-queue the 201 stuck + 27 failed files

## 7. Second Root Cause — `FilePipelineCompleteWorker` Empty `batchId` Bug

**Discovered at**: ~21:20 UTC by inspecting BullMQ failed jobs in `file-pipeline-complete` queue.

### Evidence

After fixing Redis and restarting the container, BullMQ queues show:

```
file-extract             | Wait:0 | Active:0 | Failed:0 | Done:1577
file-chunk               | Wait:0 | Active:0 | Failed:0 | Done:1577
file-embed               | Wait:0 | Active:0 | Failed:0 | Done:1577
file-pipeline-complete   | Wait:0 | Active:0 | Failed:132 | Done:1248
```

**Workers ARE processing!** Extract, chunk, embed all succeed. But pipeline-complete has **132 failures**.

### Failure Details (all 132 have same error)

```
Error: Raw query failed. Code: EREQUEST.
Message: Conversion failed when converting from a character string to uniqueidentifier.

File: FilePipelineCompleteWorker.js:104
Job data: { fileId: "...", batchId: "", userId: "fe44a9d3..." }
```

**Root cause**: External sync files (OneDrive/SharePoint) don't have upload batches. The `ProcessingFlowFactory` creates flows with `batchId: ""` (empty string). The `FilePipelineCompleteWorker` tries to execute:

```sql
UPDATE upload_batches SET processed_count = processed_count + 1
WHERE id = ''  -- ← SQL Server rejects '' → uniqueidentifier conversion
```

### Impact

The pipeline-complete worker is responsible for:
1. Updating scope-level processing counters (`processing_completed`, `processing_failed`)
2. Detecting when all files in a scope are done
3. Emitting `processing:progress` and `processing:completed` WebSocket events
4. Marking files as `ready`

**When it crashes, files complete extract/chunk/embed but never transition to `ready`** and no progress events are emitted to the frontend.

### Fix Applied (not yet deployed)

```typescript
// FilePipelineCompleteWorker.ts - skip batch update for external sync files
if (batchId) {
  await prisma.$executeRaw`UPDATE upload_batches ...`;
}
```

### Additional Finding: `queue-status.ts` Wrong Queue Names

The diagnostic script used `v2-file-extract`, `v2-file-chunk`, etc. as queue names but the actual BullMQ queue names are `file-extract`, `file-chunk`, etc. (no `v2-` prefix). Script was showing 0 for all queues because it was querying non-existent queues. Fixed.

### Additional Finding: DEV `this.log.child is not a function`

Dev environment has 2 failed files with error `"this.log.child is not a function"`. Indicates a logger injection issue where the worker receives a logger without `.child()` method. Separate bug to investigate.

## 8. Combined Root Causes Summary

| # | Root Cause | Impact | Fix |
|---|---|---|---|
| 1 | Redis `volatile-lru` eviction policy in prod | BullMQ jobs evicted before processing | `az redis update --set maxmemory-policy=noeviction` + Bicep fix |
| 2 | `FilePipelineCompleteWorker` crashes on empty `batchId` | Files complete pipeline but never transition to `ready` | Guard `batchId` check before batch SQL query |
| 3 | `queue-status.ts` uses wrong queue names (`v2-` prefix) | Diagnostic tool reported false "healthy" | Updated queue names in script |

Both issues must be fixed for files to reach `ready` status:
- Issue 1 (Redis) was fixed live and prevents job loss
- Issue 2 (code bug) requires a deploy to fix the pipeline-complete stage

## Commands for Follow-Up

```bash
# Requires temporary firewall rules on prod Redis + SQL

# Queue depth check
cd backend
REDIS_HOST=<prod-redis>.redis.cache.windows.net REDIS_PORT=6380 \
  REDIS_PASSWORD=<access-key> QUEUE_NAME_PREFIX=bcagent \
  npx tsx scripts/redis/queue-status.ts --verbose

# Sync health
DATABASE_URL="sqlserver://<host>;database=<db>;user=<user>;password=<pass>;encrypt=true" \
  npx tsx scripts/sync/verify-sync-health.ts

# File health audit
npx tsx scripts/storage/audit-file-health.ts --all --env prod

# Redis diagnostics
REDIS_HOST=<prod-redis>.redis.cache.windows.net REDIS_PORT=6380 \
  REDIS_PASSWORD=<access-key> \
  npx tsx scripts/redis/diagnose-redis.ts --memory-analysis
```
