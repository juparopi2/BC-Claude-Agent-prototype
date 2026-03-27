# PRD-304: Sync Health Modular Architecture Refactor

**Status**: Implemented
**Date**: 2026-03-27
**Depends on**: PRD-300 (Sync Health & Recovery)

## Motivation

PRD-300 implemented sync health monitoring with 3 services detecting 8 drift conditions. As the system grew, `SyncReconciliationService.ts` became a 1035-line godfile with detection and repair logic coupled in a single method. Key issues:

1. **Godfile**: `doReconcileUser()` was 400+ lines mixing 8 detection queries with repair logic
2. **No healthy state definition**: Each file type (local/cloud, text/image, folder) had different expectations scattered across services
3. **Soft-delete inconsistency**: `ensureScopeRootFolder()` and `upsertFolder()` didn't check `deletion_status` — soft-deleted folders were invisible but treated as existing
4. **Folders in extract pipeline**: Folders could enter the file processing pipeline, fail with Graph 404, and get soft-deleted
5. **No auto-reconciliation on login**: Users had to wait for the hourly cron or manually trigger

### Bug Discovery (2026-03-27)

A disconnect/reconnect race condition caused scope root folders to be soft-deleted. The reconciliation detected them as "missing" but `ensureScopeRootFolder()` found the soft-deleted records (no `deletion_status` filter) and returned early. The folders remained invisible indefinitely.

## Changes Implemented

### 1. Detector/Repairer Pattern

Decomposed `SyncReconciliationService.ts` (1035 lines) into:
- **Orchestrator** (~250 lines) — runs detectors, conditionally runs repairers
- **8 Detectors** in `detectors/` — one per drift condition
- **4 Repairers** in `repairers/` — grouped by repair action type
- **SearchIndexComparator** — shared helper for DB vs Search comparison

Zero breaking changes to the public API (`getSyncReconciliationService`, `reconcileUser`, `ReconciliationReport`).

### 2. Healthy File State Definitions

`@bc-agent/shared` exports `HEALTHY_FILE_STATES` — a typed constant matrix defining the expected healthy state for every file type. Functions `getFileHealthKey()`, `getExpectedHealthState()`, and `validateFileHealth()` provide validation.

### 3. Bug Fixes

| Fix | File |
|-----|------|
| `ensureScopeRootFolder` restores soft-deleted folders | `FolderHierarchyResolver.ts` |
| `upsertFolder` clears soft-delete on resync | `FolderHierarchyResolver.ts` |
| Reconciliation only checks folder scopes for missing roots (not library scopes) | `SyncReconciliationService.ts` |
| `FileExtractWorker` rejects folders (`mimeType='inode/directory'`) | `FileExtractWorker.ts` |

### 4. Auto-Reconciliation on Login

Socket.IO `user:join` handler fires `reconcileUserOnDemand()` (fire-and-forget, respects 5-min cooldown). Frontend `useSyncEvents` invalidates folder tree cache on repairs.

### 5. Updated WS Event Type

`SyncReconciliationCompletedPayload` in `@bc-agent/shared` now includes `folderHierarchy` and `disconnectedConnectionFilesCount` fields.

## File Inventory

### New Files
- `packages/shared/src/constants/file-health-state.ts` — Healthy state definitions
- `backend/src/services/sync/health/detectors/types.ts` — DriftDetector interface
- `backend/src/services/sync/health/detectors/SearchIndexComparator.ts`
- `backend/src/services/sync/health/detectors/MissingFromSearchDetector.ts`
- `backend/src/services/sync/health/detectors/OrphanedInSearchDetector.ts`
- `backend/src/services/sync/health/detectors/FailedRetriableDetector.ts`
- `backend/src/services/sync/health/detectors/StuckPipelineDetector.ts`
- `backend/src/services/sync/health/detectors/ExternalNotFoundDetector.ts`
- `backend/src/services/sync/health/detectors/ImageEmbeddingDetector.ts`
- `backend/src/services/sync/health/detectors/FolderHierarchyDetector.ts`
- `backend/src/services/sync/health/detectors/DisconnectedFilesDetector.ts`
- `backend/src/services/sync/health/detectors/index.ts`
- `backend/src/services/sync/health/repairers/FileRequeueRepairer.ts`
- `backend/src/services/sync/health/repairers/OrphanCleanupRepairer.ts`
- `backend/src/services/sync/health/repairers/ExternalFileCleanupRepairer.ts`
- `backend/src/services/sync/health/repairers/FolderHierarchyRepairer.ts`
- `backend/src/services/sync/health/repairers/index.ts`
- `backend/scripts/connectors/debug-scope-folders.ts` — Diagnostic script

### Modified Files
- `backend/src/services/sync/health/SyncReconciliationService.ts` — Refactored to orchestrator
- `backend/src/services/sync/health/index.ts` — Added detector/repairer exports
- `backend/src/services/sync/health/CLAUDE.md` — Updated documentation
- `backend/src/services/sync/FolderHierarchyResolver.ts` — Soft-delete handling fixes
- `backend/src/infrastructure/queue/workers/FileExtractWorker.ts` — Folder guard
- `backend/src/server.ts` — Auto-reconciliation on login
- `frontend/src/domains/integrations/hooks/useSyncEvents.ts` — Tree invalidation
- `packages/shared/src/constants/index.ts` — Health state exports
- `packages/shared/src/constants/file-health-state.ts` — New module
- `packages/shared/src/types/onedrive.types.ts` — Updated WS event type
- `backend/scripts/diagnostics/simulate-file-health-issues.ts` — New scenario

## Verification

- Unit tests: 4181 passed, 0 failed (includes existing 50+ reconciliation tests)
- Type check: 0 errors (shared + frontend + backend)
- Lint: 0 errors
- Integration tests: 261 passed, 1 pre-existing failure (API version mismatch in SemanticSearchService, unrelated)
