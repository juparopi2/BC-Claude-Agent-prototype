# PRD-107: OneDrive File UX Polish

**Phase**: OneDrive Enhancement
**Status**: DONE
**Prerequisites**: PRD-106 (File Type Validation)
**Estimated Effort**: 2–3 days
**Created**: 2026-03-09
**Completed**: 2026-03-09

---

## 1. Objective

Polish the OneDrive integration's user experience with four improvements:
1. Double-click on OneDrive files opens them in OneDrive (not downloads)
2. OneDrive folder tree in the Files sidebar shows synced folder structure
3. Frontend sync event listeners for real-time updates
4. Sync progress indicator during active sync operations

---

## 2. Current State (After PRD-106)

- Double-clicking a OneDrive file in the Files panel triggers `downloadFile()` for non-previewable files instead of opening `externalUrl` in a new tab
- `FolderTree.tsx` shows a single "OneDrive" button — not the synced folder structure
- Backend emits `sync:completed` and `sync:error` WebSocket events, but no frontend handler listens for them
- No progress indicator during sync operations

---

## 3. Features

### 3.1 Double-Click Opens in OneDrive — DONE

**File**: `frontend/components/files/FileDataTable.tsx`

For files with `source_type = 'onedrive'` and a valid `externalUrl`:
- Double-click → `window.open(externalUrl, '_blank')` (opens in OneDrive web)
- Single-click → select file (existing behavior unchanged)

For files with `source_type = 'local'`:
- Existing behavior unchanged (preview or download)

**Implementation**: Added a guard in `handleDoubleClick` after the `isFolder` check and before `isPreviewableFile`, checking `file.sourceType === FILE_SOURCE_TYPE.ONEDRIVE && file.externalUrl`.

### 3.2 OneDrive Folder Tree in Sidebar — DONE

#### 3.2.1 Backend: Store OneDrive Folders During Sync

**File**: `backend/src/services/sync/InitialSyncService.ts`

Previously, `_runSync()` filtered out folders entirely. Now:

1. **Folder extraction**: After file filtering, extracts `folderChanges` from `allChanges` (non-deleted items with `isFolder === true`).
2. **External-to-internal ID map**: Seeds from existing DB folders for the connection, used to resolve `parent_folder_id` during upsert.
3. **Depth-sorted folder upsert**: Sorts folders by `parentPath` depth (counting `/` separators) so parents are inserted before children. Each folder is created/updated as a `files` record with `is_folder: true`, `mime_type: 'inode/directory'`, `pipeline_status: 'ready'`, and resolved `parent_folder_id`.
4. **File `parent_folder_id`**: Both existing-file update and new-file create branches now resolve and persist `parent_folder_id` using the `externalToInternalId` map built during folder processing.

**Scope root handling**: Items whose `parentId` matches `scope.scope_resource_id` get `parent_folder_id = null` (they are at the scope root).

#### 3.2.2 Frontend: Isolate Local Folder Tree

**File**: `frontend/src/domains/files/hooks/useFolderNavigation.ts`

`initFolderTree()` now passes `sourceType: 'local'` to the `getFiles` API call, preventing OneDrive folders from appearing mixed with local folders in the "All Files" tree.

#### 3.2.3 Frontend: Expandable OneDrive Tree

**File**: `frontend/components/files/FolderTree.tsx`

Replaced the flat "OneDrive" button with an expandable `Collapsible` tree:

- **Chevron toggle**: Expand/collapse the OneDrive section.
- **OneDrive root click**: Sets `sourceTypeFilter('onedrive')` + navigates to root (flat view of all OneDrive files — preserves previous behavior).
- **Subfolder click**: Clears `sourceTypeFilter` + navigates into the specific folder (folder-scoped view).
- **Lazy loading**: OneDrive root folders loaded via `getFiles({ folderId: null, sourceType: 'onedrive' })` when expanded. Subfolders use `FolderTreeItem`'s existing lazy-load pattern.
- **Sync spinner**: Shows `<Loader2>` spinner when any sync is active (from `useSyncStatusStore`).

### 3.3 Frontend Sync Event Listeners — DONE

#### 3.3.1 Shared Types

**File**: `packages/shared/src/types/onedrive.types.ts`

Added three new types after existing `SyncProgress`:
- `SyncCompletedPayload` — `{ connectionId, scopeId, totalFiles }`
- `SyncErrorPayload` — `{ connectionId, scopeId, error }`
- `SyncWebSocketEvent` — Discriminated union of all three sync event types with `type` field

Exported from `packages/shared/src/index.ts`.

#### 3.3.2 SocketClient

**File**: `frontend/src/infrastructure/socket/SocketClient.ts`

Following the established file/job/folder event pattern:
- Added `private syncEventListeners` Set.
- Added `onSyncEvent(callback)` subscription method returning unsubscribe function.
- In `setupEventListeners()`: cleanup of 3 sync channels + `.on()` handlers for `SYNC_PROGRESS`, `SYNC_COMPLETED`, `SYNC_ERROR` that wrap payloads into `SyncWebSocketEvent` and dispatch to listeners.

#### 3.3.3 useSyncEvents Hook

**New file**: `frontend/src/domains/integrations/hooks/useSyncEvents.ts`

Follows the `useFileProcessingEvents` pattern (refs for stable callbacks, `useEffect` cleanup):
- `sync:completed` → Updates store to `idle`, refreshes current folder, shows success toast with file count.
- `sync:error` → Updates store to `error`, shows error toast with message.
- `sync:progress` → Updates store to `syncing` with percentage.

#### 3.3.4 Wired into FileExplorer

**File**: `frontend/components/files/FileExplorer.tsx`

Added `useSyncEvents()` call after `useFileProcessingEvents()`.

### 3.4 Sync Progress Indicator — DONE

#### 3.4.1 Sync Status Store

**New file**: `frontend/src/domains/integrations/stores/syncStatusStore.ts`

Zustand store tracking `activeSyncs: Record<scopeId, SyncEntry>` where `SyncEntry = { status: 'syncing' | 'idle' | 'error', percentage: number }`.

Actions: `setSyncStatus(scopeId, status, percentage?)`, `reset()`.

Selector: `selectIsAnySyncing(state)` — returns `true` if any scope has `status === 'syncing'`.

#### 3.4.2 FolderTree Spinner

In the OneDrive collapsible header (FolderTree.tsx), a `<Loader2>` spinner appears next to the "OneDrive" label when `isAnySyncing` is true.

---

## 4. Affected Files

### New Files
| File | Purpose |
|------|---------|
| `frontend/src/domains/integrations/hooks/useSyncEvents.ts` | WebSocket sync event listeners |
| `frontend/src/domains/integrations/stores/syncStatusStore.ts` | Active sync status tracking |

### Modified Files
| File | Change |
|------|--------|
| `frontend/components/files/FileDataTable.tsx` | OneDrive double-click → opens in browser |
| `frontend/components/files/FolderTree.tsx` | Expandable OneDrive folder tree + sync spinner |
| `frontend/components/files/FileExplorer.tsx` | Wire `useSyncEvents` hook |
| `frontend/src/infrastructure/socket/SocketClient.ts` | Add sync event listeners |
| `frontend/src/domains/files/hooks/useFolderNavigation.ts` | Filter local folders only in `initFolderTree` |
| `frontend/src/domains/integrations/index.ts` | Export new store and hook |
| `backend/src/services/sync/InitialSyncService.ts` | Upsert OneDrive folders + set `parent_folder_id` on files |
| `packages/shared/src/types/onedrive.types.ts` | `SyncCompletedPayload`, `SyncErrorPayload`, `SyncWebSocketEvent` |
| `packages/shared/src/index.ts` | Export new types |

---

## 5. Success Criteria

- [x] Double-clicking a OneDrive file opens it in OneDrive (new tab)
- [x] Double-clicking a local file behaves as before (preview/download)
- [x] OneDrive folder tree shows synced folder structure (expandable, not a single button)
- [x] `sync:completed` event triggers file list refresh and success toast
- [x] `sync:error` event shows error toast
- [x] `sync:progress` event updates sync status store
- [x] Sync progress indicator (spinner) visible on OneDrive tree header during active sync
- [x] Type-check and lint pass (`npm run verify:types`, backend lint, frontend lint — 0 errors)

---

## 6. Post-Implementation Bug Fixes (2026-03-09)

After manual E2E testing, six bugs were identified and fixed in the same session.

### 6.1 Bug 1 (Root Cause): FileRepository skipped `parent_folder_id` filter when sourceType set

**File**: `backend/src/services/files/repository/FileRepository.ts`

Both `findMany()` and `count()` had an `if (!sourceType)` guard around `where['parent_folder_id'] = null`. This was intended to enable a "flat view" for OneDrive files, but broke folder hierarchy for both local and OneDrive trees once PRD-107 introduced real folder structure.

**Fix**: Removed the `if (!sourceType)` guard. Root-level queries now always filter `parent_folder_id = null`, regardless of `sourceType`. Users navigate into folders to see contents.

### 6.2 Bug 2: "All Files" showed OneDrive files mixed with local

**File**: `frontend/src/domains/files/hooks/useFiles.ts`

When `sourceTypeFilter` was null (default "All Files"), no `sourceType` was sent to the API. This returned all root-level items including OneDrive scope roots.

**Fix**: Default to `FILE_SOURCE_TYPE.LOCAL` when no explicit filter is set. Applied in both `fetchFiles()` and the filter-change `useEffect`.

### 6.3 Bug 3: Breadcrumb didn't show "OneDrive" as root

**File**: `frontend/components/files/FileBreadcrumb.tsx`

Only toggled between "Files" and "Favorites". No handling for `sourceTypeFilter === 'onedrive'`.

**Fix**: Added Cloud icon + "OneDrive" label when browsing OneDrive. Clicking breadcrumb root clears `sourceTypeFilter` (returns to "All Files"). Uses `PROVIDER_DISPLAY_NAME` and `PROVIDER_ACCENT_COLOR` constants.

### 6.4 Bug 4: OneDrive cloud badge too small

**File**: `frontend/components/files/FileIcon.tsx`

Badge was `size-2.5` (~10px) with stroke only — too subtle.

**Fix**: Increased to `size-3.5`, added `fill`, `strokeWidth: 1.5`, and `drop-shadow-sm`.

### 6.5 Bug 5: No OneDrive indicator on folder tree items

**File**: `frontend/components/files/FolderTreeItem.tsx`

All folders used the same amber `Folder` icon regardless of source.

**Fix**: Added a small filled Cloud badge overlay on OneDrive folders in the sidebar tree.

### 6.6 Bug 6: Diagnostic tooling for stuck scopes

Created scripts for investigating and repairing sync issues:

| File | Purpose |
|------|---------|
| `backend/scripts/connectors/diagnose-sync.ts` | Scope inspection, stuck detection, orphan analysis |
| `backend/scripts/connectors/fix-stuck-scopes.ts` | Reset scopes stuck in 'syncing' status |

Moved existing SQL scripts to `backend/scripts/connectors/` and updated `backend/scripts/CLAUDE.md`.

### 6.7 Magic String Cleanup

Replaced all `'onedrive'`, `'local'`, `'#0078D4'`, `'OneDrive'`, `'connected'` magic strings in modified files with constants from `@bc-agent/shared`: `FILE_SOURCE_TYPE`, `PROVIDER_ACCENT_COLOR`, `PROVIDER_DISPLAY_NAME`, `PROVIDER_ID`, `CONNECTION_STATUS`.

### 6.8 Additional Files Modified/Created

| File | Change |
|------|--------|
| `backend/src/services/files/repository/FileRepository.ts` | Remove `if (!sourceType)` guard in `findMany()` and `count()` |
| `frontend/src/domains/files/hooks/useFiles.ts` | Default to `FILE_SOURCE_TYPE.LOCAL` |
| `frontend/components/files/FileBreadcrumb.tsx` | OneDrive root label + cloud icon |
| `frontend/components/files/FileIcon.tsx` | Larger filled cloud badge |
| `frontend/components/files/FolderTreeItem.tsx` | Cloud indicator on OneDrive folders, removed unused import |
| `frontend/components/files/FolderTree.tsx` | Replace magic strings with constants |
| `frontend/src/domains/files/hooks/useFolderNavigation.ts` | Replace `'local'` with `FILE_SOURCE_TYPE.LOCAL` |
| `backend/scripts/connectors/diagnose-sync.ts` | New: sync diagnostic script |
| `backend/scripts/connectors/fix-stuck-scopes.ts` | New: stuck scope repair script |
| `backend/scripts/connectors/cleanup-duplicate-files.sql` | Moved from `scripts/` |
| `backend/scripts/connectors/cleanup-user-onedrive-files.sql` | Moved from `scripts/` |
| `backend/scripts/CLAUDE.md` | Added `connectors/` section |

---

## 7. Out of Scope

- Real-time file add/remove during webhook sync (PRD-108)
- SharePoint folder tree (PRD-111)
- Shared files tree structure (PRD-110)
- Offline sync indicators
- Sync history/log view
- File counts per folder in sidebar (deferred — requires aggregation query)
- Backend unit tests for folder upsert (can be added separately)
