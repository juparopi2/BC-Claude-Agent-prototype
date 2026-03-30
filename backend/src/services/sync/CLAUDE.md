# Sync Service

## Purpose

Three-tier sync pipeline for OneDrive and SharePoint: Discovery → Ingestion → Processing. Manages incremental delta sync, webhook subscriptions, folder hierarchy resolution, and scope lifecycle.

## Architecture — 10 Stateless Singletons

| Service | Responsibility |
|---|---|
| `InitialSyncService` | Full enumeration on first connect. Routes by scope type (root/folder/file/library). Delegates file ingestion to `SyncFileIngestionService.ingestAll()`. |
| `DeltaSyncService` | Incremental updates via delta cursor. Three-phase processing: deletions → folders → files. |
| `SyncFileIngestionService` | Batch upsert in `prisma.$transaction()` (`INGESTION_TX_TIMEOUT=60s`, `INGESTION_BATCH_SIZE=25`). Post-commit queue dispatch. EREQINPROG-safe. |
| `FolderHierarchyResolver` | External→internal ID mapping (`FolderIdMap`). `ensureScopeRootFolder()`. Sort by depth. |
| `SubscriptionManager` | Graph webhook lifecycle. `clientState` = 64-byte hex UPPERCASE. Max 30-day expiry. |
| `ScopeCleanupService` | Cascade deletion (guard: reject if syncing). NULL message_citations. Vector cleanup. |
| `SyncProgressEmitter` | WebSocket events to per-user rooms (`user:{userId}`). Includes `emitProcessingStarted()` (PRD-305). |
| `SyncHealthCheckService` | PRD-300. Cron every 15min: detect stuck/error scopes, delegate recovery, emit health reports. Also serves `GET /api/sync/health`. |
| `SyncReconciliationService` | PRD-300. Cron hourly (24x/day) + on-demand per-user: compare DB ready files vs Search index, detect 6 drift types (incl. externally deleted files), optional auto-repair. On-demand always repairs. |
| `SyncRecoveryService` | PRD-300. Atomic recovery actions: reset stuck scopes, retry error scopes, re-enqueue failed files. Manual + automated. |

## Delta Query Patterns

### Initial Sync (folder-scoped)
```
executeFolderDeltaQuery(driveId, folderId) → pages of DriveItems
```
Walks all items under the scoped folder. Stores cursor for incremental updates.

### Incremental Sync
```
executeDeltaFromCursor(absoluteCursorUrl) → changed items since last sync
```
Cursor URL is absolute — pass directly to GraphHttpClient.

### Expired Cursor (HTTP 410)
Clear stored cursor → fallback to full initial sync for that scope.

## Three-Phase Delta Processing

For each delta response, process in strict order:
1. **Deletions**: Items with `deleted` facet → soft-delete from DB
2. **Folders**: Create/update folder hierarchy (sort by depth, parents first)
3. **Files**: Upsert file records, dispatch to processing queue

## Webhook + Polling Fallback

- **Webhooks** (primary): Graph subscription → notification in ~3min. `SubscriptionManager` handles create/renew/delete.
- **Polling** (safety net): Every 30min, check scopes with `sync_status IN ('synced', 'idle')` and run delta query.
- **On webhook failure**: Polling catches up. On 410 (expired cursor): full re-sync.

## Scope Exclusion Cascade

Tri-state inheritance for include/exclude scoping (PRD-112):
- **included**: Folder and all descendants are synced
- **excluded**: Folder and all descendants are excluded
- **inherited**: Follows parent's state

## Folder Hierarchy Resolution

`FolderHierarchyResolver` maps Graph API folder IDs to internal DB IDs:
- Maintains `FolderIdMap` (externalId → internalId) during sync
- `ensureScopeRootFolder()`: Root folder is NOT in delta results — must be created explicitly
- Sort by depth (parents before children) to ensure parent IDs exist before children reference them

## Critical Gotchas

1. **Scope root folder missing from delta**: Microsoft Graph delta does NOT include the scoped folder itself. `ensureScopeRootFolder()` must create it explicitly before processing delta items.

2. **Graph includes scoped folder in results**: When querying children, the scoped folder appears in results. Filter: `item.id !== scope.scope_resource_id`.

3. **Soft-delete requires BOTH fields**:
   ```typescript
   // ✅ Set BOTH — cleanup queries check deletion_status, not deleted_at
   { deleted_at: new Date(), deletion_status: 'pending' }
   ```

4. **Folder deletion is bottom-up**: Collect descendants recursively, delete from deepest to shallowest (FK constraints).

5. **DB transaction — pass `tx`**:
   ```typescript
   // ✅ All repo methods receive tx, not global prisma
   await prisma.$transaction(async (tx) => {
     await this.repo.upsertFiles(files, tx);
     await this.repo.upsertFolders(folders, tx);
   }, { timeout: 30000 });
   ```
   **Why**: PRD-116 crash — global `prisma` inside transaction creates separate connection.

6. **Polling fallback status check**:
   ```typescript
   // ✅ Check BOTH — after initial sync, status is 'synced' not 'idle'
   WHERE sync_status IN ('synced', 'idle')
   ```

7. **SharePoint folder scopes**: Have `remote_drive_id` (the library driveId) but DO need webhook subscriptions (PRD-118 fix — previously skipped).

8. **File dedup**: Unique index on `(connection_id, external_id)`. Handle P2002 (unique violation) for race conditions between concurrent workers.

9. **Error resilience**: Try-catch per individual change item. One file failure doesn't abort the entire sync batch.

10. **Post-commit dispatch**: Files are enqueued to processing queue AFTER `$transaction()` commits, never inside the transaction.

## Key Files

| File | Purpose |
|---|---|
| `DeltaSyncService.ts` | Delta query execution + three-phase processing |
| `InitialSyncService.ts` | First-time full enumeration + BullMQ dispatch |
| `SyncFileIngestionService.ts` | Batch upsert + post-commit queue dispatch |
| `FolderHierarchyResolver.ts` | External→internal folder ID mapping |
| `SubscriptionManager.ts` | Graph webhook create/renew/delete |
| `ScopeCleanupService.ts` | Cascade scope deletion + cleanup |
| `SyncProgressEmitter.ts` | WebSocket sync progress events |
| `health/` | Health monitoring + recovery subsystem (see `health/CLAUDE.md`) |

## Related

- Health & Recovery: `health/CLAUDE.md` — PRD-300 health check, reconciliation, recovery
- Connectors: `../connectors/CLAUDE.md` — Graph API clients, token management
- Queue: `../../infrastructure/queue/CLAUDE.md` — BullMQ workers for sync jobs
- Files domain: `../../domains/files/CLAUDE.md` — Processing pipeline after sync
