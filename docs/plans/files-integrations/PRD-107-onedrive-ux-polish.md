# PRD-107: OneDrive File UX Polish

**Phase**: OneDrive Enhancement
**Status**: TODO
**Prerequisites**: PRD-106 (File Type Validation)
**Estimated Effort**: 2–3 days
**Created**: 2026-03-09

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

### 3.1 Double-Click Opens in OneDrive

**File**: `frontend/components/files/FileDataTable.tsx`

For files with `source_type = 'onedrive'` and a valid `externalUrl`:
- Double-click → `window.open(externalUrl, '_blank')` (opens in OneDrive web)
- Single-click → select file (existing behavior unchanged)
- Context menu "Open in OneDrive" already exists (from PRD-101)

For files with `source_type = 'local'`:
- Existing behavior unchanged (preview or download)

### 3.2 OneDrive Folder Tree in Sidebar

**File**: `frontend/components/files/FolderTree.tsx`

Replace the single "OneDrive" button with a proper tree structure showing synced folders:

```
My Files
  ├── 📁 Documents/
  └── 📁 Reports/

☁️ OneDrive
  ├── 📁 Documents/ (47 files)
  │   ├── 📁 Invoices/
  │   └── 📁 Contracts/
  └── 📁 Projects/ (23 files)
      ├── 📁 Alpha/
      └── 📁 Beta/
```

**Data source**: Query the `files` table grouped by `connection_scope_id` and `parent_folder_id` to build the tree structure. The `scope_path` field provides display breadcrumbs.

**Lazy loading**: Expand folders on click (existing FolderTree pattern).

### 3.3 Frontend Sync Event Listeners

**New hook**: `frontend/src/domains/integrations/hooks/useSyncEvents.ts`

Listen for WebSocket events and update stores:

```typescript
export function useSyncEvents() {
  const socket = useSocket();

  useEffect(() => {
    socket.on('sync:completed', (data) => {
      // Refresh file list for the affected scope
      fileListStore.getState().refreshFiles();
      // Show success toast
      toast.success(`Sync completed: ${data.filesProcessed} files synced`);
    });

    socket.on('sync:error', (data) => {
      // Show error toast
      toast.error(`Sync error: ${data.error}`);
    });

    return () => {
      socket.off('sync:completed');
      socket.off('sync:error');
    };
  }, [socket]);
}
```

Wire this hook into the main layout or chat container.

### 3.4 Sync Progress Indicator

When a sync is in progress (`sync_status = 'syncing'`):
- The OneDrive root in the folder tree shows a spinner
- The Connections panel shows "Syncing..." with a progress indicator
- When sync completes (via WebSocket event), the spinner stops and file count updates

---

## 4. Affected Files

### New Files
| File | Purpose |
|------|---------|
| `frontend/src/domains/integrations/hooks/useSyncEvents.ts` | WebSocket sync event listeners |

### Modified Files
| File | Change |
|------|--------|
| `frontend/components/files/FileDataTable.tsx` | OneDrive double-click behavior |
| `frontend/components/files/FolderTree.tsx` | OneDrive folder tree structure |
| `frontend/src/domains/files/stores/fileListStore.ts` | Support sync event refresh |
| `frontend/src/domains/integrations/stores/integrationListStore.ts` | Sync status tracking |

---

## 5. Success Criteria

- [ ] Double-clicking a OneDrive file opens it in OneDrive (new tab)
- [ ] Double-clicking a local file behaves as before (preview/download)
- [ ] OneDrive folder tree shows synced folder structure (not just a single button)
- [ ] Folder tree shows file counts per folder
- [ ] `sync:completed` event triggers file list refresh and success toast
- [ ] `sync:error` event shows error toast
- [ ] Sync progress indicator visible during active sync
- [ ] All existing tests pass
- [ ] Type-check and lint pass

---

## 6. Out of Scope

- Real-time file add/remove during webhook sync (PRD-108)
- SharePoint folder tree (PRD-111)
- Shared files tree structure (PRD-110)
- Offline sync indicators
- Sync history/log view
