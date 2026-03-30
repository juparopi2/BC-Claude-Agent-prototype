# Queue Flow

## Purpose

BullMQ Flow orchestration for the per-file processing pipeline. `ProcessingFlowFactory` builds nested parent-child job trees that guarantee strict execution order across four queues.

## Execution Order

BullMQ Flows execute deepest children first and root parents last. The nesting is deliberately inverted so that the logical order (extract → chunk → embed → complete) maps to deepest-to-root:

```
pipeline-complete (root — runs LAST)
  └── embed       (runs 3rd)
        └── chunk (runs 2nd)
              └── extract (deepest — runs FIRST)
```

`pipeline-complete` only starts once `embed` finishes, `embed` only starts once `chunk` finishes, and so on. BullMQ enforces this via internal dependency tracking — no manual signalling is needed.

## Queue Names

| Stage | `QueueName` enum | Redis queue key |
|---|---|---|
| Extract | `QueueName.FILE_EXTRACT` | `file-extract` |
| Chunk | `QueueName.FILE_CHUNK` | `file-chunk` |
| Embed | `QueueName.FILE_EMBED` | `file-embed` |
| Pipeline complete | `QueueName.FILE_PIPELINE_COMPLETE` | `file-pipeline-complete` |

`QueueManager` prepends `QUEUE_NAME_PREFIX` env var if set (e.g., `local` for dev). There is no hardcoded `v2-` prefix.

## Job ID Convention

Each job uses `{stage}--{fileId}` as its `jobId` (e.g., `extract--abc123`). The `--` separator is required because BullMQ reserves `:` for Redis key namespacing. Stable job IDs make adds idempotent — if the same `fileId` is submitted twice, BullMQ deduplicates within the queue.

## `ProcessingFlowFactory.createFileFlow(params)`

Accepts `FileFlowParams`:

```typescript
interface FileFlowParams {
  fileId: string;
  batchId: string;   // upload batch UUID or scope UUID
  userId: string;
  mimeType: string;
  blobPath?: string; // defaults to '' if absent (external files fetched via Graph API)
  fileName: string;
}
```

Returns a `FlowJob` tree ready to submit via `FlowProducerManager`. Only the `extract` job carries `mimeType`, `blobPath`, and `fileName`. Later stages retrieve content from DB or already-created chunks, not the blob directly.

## batchId Semantics

`batchId` is passed unchanged through all four stages but carries different meaning:

- **Upload pipeline**: `batchId` = `upload_batches.id` UUID. `FilePipelineCompleteWorker` increments `upload_batches.processed_count`.
- **Sync pipeline**: `batchId` = `connection_scopes.id` UUID. `FilePipelineCompleteWorker` increments `connection_scopes.processing_completed` or `processing_failed`.

`ProcessingFlowFactory` is unaware of this distinction.

## Backoff Configuration

Each stage reads retry settings from `DEFAULT_BACKOFF` in `queue.constants.ts`:

| Stage | Attempts | Initial delay | Type |
|---|---|---|---|
| extract | 3 | 5000ms | exponential |
| chunk | 3 | 3000ms | exponential |
| embed | 3 | 3000ms | exponential |
| pipeline-complete | 2 | 1000ms | exponential |

## Key Files

| File | Purpose |
|---|---|
| `ProcessingFlowFactory.ts` | Creates nested `FlowJob` trees from file params |

`FlowProducerManager` lives in `../core/` and wraps BullMQ `FlowProducer` with Redis config.

## Related

- Workers: `../workers/CLAUDE.md` — processors for each stage
- Parent queue module: `../CLAUDE.md` — `FlowProducerManager`, `MessageQueue` facade, queue constants
- Files domain: `../../../domains/files/CLAUDE.md` — upstream scheduler that calls `addFileProcessingFlow()`
