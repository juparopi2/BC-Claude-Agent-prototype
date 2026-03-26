# Sync Health & Recovery (PRD-300)

## Purpose

Automated health monitoring and recovery for the file synchronization pipeline. Detects three failure modes — stuck scopes, error scopes, DB-to-Search index drift — and provides both automated remediation (cron) and manual recovery (API).

## Architecture — 3 Stateless Singletons

| Service | Schedule | Responsibility |
|---|---|---|
| `SyncHealthCheckService` | Every 15 min (cron) | Inspect all scopes, detect stuck/error states, delegate recovery, emit WS health reports. Also serves `GET /api/sync/health`. |
| `SyncReconciliationService` | Daily 04:00 UTC (cron) | Compare DB `pipeline_status='ready'` files vs Azure AI Search index. Detect missing/orphaned documents. Optional auto-repair. |
| `SyncRecoveryService` | On-demand | Atomic recovery actions: reset stuck scopes, retry error scopes, re-enqueue failed files. Consumed by health check, reconciliation, and manual API. |

All three run via the existing `FILE_MAINTENANCE` BullMQ queue (`concurrency=1`, `lockDuration=120s`). No new queues or workers — they slot into `MaintenanceWorker`'s switch-case dispatch.

## Integration Points

```
ScheduledJobManager.initializeMaintenanceJobs()
  ├── stuck-file-recovery       (every 15 min) — existing
  ├── orphan-cleanup            (daily 03:00)  — existing
  ├── batch-timeout             (every hour)   — existing
  ├── sync-health-check         (every 15 min) — PRD-300
  └── sync-reconciliation       (daily 04:00)  — PRD-300

MaintenanceWorker.process(job)
  switch (job.name) → dynamic import → service.run()
```

## Health Classification

Each scope is inspected and classified into one of three statuses:

| Status | Condition | Issue Severities |
|---|---|---|
| `healthy` | No issues detected | — |
| `degraded` | Only `warning` issues | `stale_sync` |
| `unhealthy` | Any `critical` or `error` issue | `stuck_syncing`, `error_state`, `high_failure_rate` |

### Issue Types

| Type | Severity | Detection |
|---|---|---|
| `stuck_syncing` | critical | `sync_status='syncing'` AND `updated_at` > 10 min ago |
| `error_state` | error | `sync_status='error'` |
| `stale_sync` | warning | `last_sync_at` is null or > 48 hours ago |
| `high_failure_rate` | error | > 50% of scope files have `pipeline_status='failed'` |

## Redis Exponential Backoff

Error scopes are not retried infinitely. Two Redis keys per scope:

- `sync:error_retry:{scopeId}` — attempt counter (integer, TTL 24h)
- `sync:error_retry_ts:{scopeId}` — last attempt timestamp (ms, TTL 24h)

| Attempt | Min Wait |
|---------|----------|
| 1 | Immediate |
| 2 | 15 minutes |
| 3 | 30 minutes |
| 4 | 1 hour |
| 5 | 2 hours |
| > 5 | Stop until TTL expires |

**Fail-open**: If Redis is unavailable, the scope IS retried (better to retry than silently block recovery).

## DB-to-Search Reconciliation

Detects five drift conditions:

| Drift | Detection | Repair Action |
|---|---|---|
| Missing from search | `pipeline_status='ready'` but no chunks in AI Search index | Reset to `'queued'`, re-enqueue processing |
| Orphaned in search | Chunks exist in index but no matching DB file row | Delete chunks via `VectorSearchService` |
| Failed retriable | `pipeline_status='failed'` with `pipeline_retry_count < 3` | Reset to `'queued'`, clear retry count, re-enqueue |
| Stuck pipeline | `pipeline_status IN ('extracting','chunking','embedding')` for > 30 min | Reset to `'queued'`, re-enqueue |
| Images missing embeddings | Ready image files with no `image_embeddings` record | Reset to `'queued'`, re-enqueue |

**Default: dry-run**. Set `SYNC_RECONCILIATION_AUTO_REPAIR=true` to enable mutations. Processes max 50 users per run, paginates DB queries in batches of 500.

### File Type Awareness

The reconciliation service accounts for different expected states per file type:
- **Text files**: Must have `file_chunks` + AI Search docs when `ready`
- **Image files**: Must have `image_embeddings` record when `ready` (0 chunks is correct)
- **External files**: `blob_path=null` is correct (content fetched via Graph API)
- See `scripts/storage/CLAUDE.md` for the full expected state matrix

## API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/sync/health` | `authenticateMicrosoft` | Per-user health report (all scopes) |
| `POST` | `/api/sync/health/recover` | `authenticateMicrosoft` | Manual recovery trigger |

### POST Actions

| Action | Required Body | Effect |
|---|---|---|
| `reset_stuck` | `scopeId?` | Reset stuck scopes to `'idle'` |
| `retry_errors` | `scopeId?` | Re-enqueue error scopes (delta or initial sync) |
| `retry_files` | `scopeId` (required) | Re-enqueue failed files for pipeline processing |
| `full_recovery` | — | Reset stuck + retry errors (scoped to authenticated user) |

Multi-tenant isolation: `scopeId` ownership validated against `req.userId`.

## WebSocket Events

| Event | Emitted By | Payload |
|---|---|---|
| `sync:health_report` | `SyncHealthCheckService.run()` | Per-user health report after each 15-min check |
| `sync:recovery_completed` | POST `/recover` endpoint | Recovery action result |

Both emitted to `user:{userId}` rooms via `getSocketIO()`.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SYNC_HEALTH_STUCK_THRESHOLD_MS` | `600000` (10 min) | How long a scope must be stuck before reset |
| `SYNC_RECONCILIATION_AUTO_REPAIR` | `'false'` | Enable auto-repair during reconciliation |

## Error Handling

| Layer | Strategy |
|---|---|
| Per-scope (health check) | try/catch per `inspectScope()` — one failure does not abort the run |
| Per-user (reconciliation) | try/catch per user — one failure does not abort remaining users |
| Per-file (recovery) | try/catch per file — errors counted in `result.errors` |
| Redis backoff | Fail-open on Redis error (allow retry rather than silently block) |
| Connection guard | Skip recovery for scopes on `'expired'`/`'disconnected'` connections |

## Key Files

| File | Purpose |
|---|---|
| `SyncHealthCheckService.ts` | Cron health check + per-user API query |
| `SyncReconciliationService.ts` | Daily DB-to-Search reconciliation |
| `SyncRecoveryService.ts` | Atomic recovery actions (reset, retry, re-enqueue) |
| `types.ts` | All type definitions (health, reconciliation, recovery, metrics) |
| `index.ts` | Barrel exports |

## Related

- Parent: `../CLAUDE.md` — Sync pipeline overview (discovery, ingestion, processing)
- Queue: `../../../infrastructure/queue/CLAUDE.md` — MaintenanceWorker, ScheduledJobManager
- Search: `../../search/CLAUDE.md` — VectorSearchService (reconciliation uses `getUniqueFileIds`, `deleteChunksForFile`)
- Connectors: `../../connectors/CLAUDE.md` — Connection status checks before recovery
