# File Retry Module

## Purpose

Manages retry logic for failed file processing. Supports automatic retries with exponential backoff and manual retries triggered by users.

## Architecture

| Service | Responsibility |
|---|---|
| `ProcessingRetryManager` | Orchestrates retry decisions: should retry? manual retry flow, scope-based retries |
| `FileRetryService` | Atomic DB operations: increment count, set error, clear status, transition pipeline |

## Retry Strategy

- **Max retries**: 3 (configurable via `maxPipelineRetries`)
- **Backoff formula**: `min(baseDelay x multiplier^retryCount, maxDelay) x (1 + random x jitter)`
- **Default config**: base=5000ms, multiplier=2, maxDelay=60000ms, jitter=0.2

## Manual Retry Scopes

| Scope | Behavior |
|---|---|
| `pipeline` | Single file: validate failed state, reset to `queued`, re-enqueue |
| `scope` | All failed files in a connection scope |
| `full` | All failed files for the user |

## Flow

```
Auto-retry (BullMQ):
  Worker catches error → shouldRetry() → increment count → BullMQ backoff → re-process

Manual retry (API):
  POST /api/files/{id}/retry → executeManualRetry()
    → validate file is 'failed'
    → clearFailedStatus() (reset pipeline_retry_count)
    → transition to 'queued'
    → addFileProcessingFlow()
    → emit file:readiness_changed

After max retries:
  → emit file:permanently_failed (canRetryManually: true)
  → user can still trigger manual retry from UI
```

## Key Files

| File | Purpose |
|---|---|
| `ProcessingRetryManager.ts` | Retry orchestration, scope-based retry, manual retry |
| `FileRetryService.ts` | Atomic DB operations for retry state |

## Related

- Emission: `../emission/CLAUDE.md` — Emits `permanently_failed` event
- Queue workers: `../../infrastructure/queue/workers/CLAUDE.md` — Workers call retry manager on failure
- File health routes: `../../routes/file-processing.routes.ts` — Manual retry API endpoint
