# PRD-103: File-Level Browsing (Lite) in Connection Wizard

**Phase**: OneDrive Enhancement
**Status**: **COMPLETED** (2026-03-09)
**Prerequisites**: PRD-101 (Completed), PRD-102 (Completed)
**Estimated Effort**: 1 day
**Created**: 2026-03-09
**Completed**: 2026-03-09

---

## 1. Objective

Extend the OneDrive Connection Wizard to display individual files alongside folders and allow users to select specific files (not just folders) for sync. This gives users fine-grained control over what enters their Knowledge Base.

> **Note**: This PRD covers Phase 1 (file visibility and selection) only. Phase 2 (file type validation with `isFileSyncSupported()`, grayed-out unsupported files, and pipeline guards) has been extracted to **PRD-106**.

---

## 2. Current State (After PRD-101)

- The Connection Wizard browse step only shows **folders** (frontend filters `data.items.filter(i => i.isFolder)`)
- Backend `OneDriveService.listFolder()` already returns all items (files + folders) from Graph API
- No file type validation exists anywhere in the browse or sync pipeline
- Supported file types are defined in `@bc-agent/shared` (`SUPPORTED_FILE_TYPES`, `SUPPORTED_EXTENSIONS_DISPLAY` in `constants/file-type-categories.ts`)
- The `FolderNode` component only supports folder UI elements (expand/collapse, folder icons)

---

## 3. Expected State (After PRD-103)

### Browse Step Changes

1. **Files visible in tree**: Each folder's contents show both subfolders AND files
2. **File icons**: Files display appropriate icons based on MIME type (reuse existing `FileIcon` mapping from `frontend/components/files/`)
3. **File metadata**: Each file shows name, size (human-readable), and last modified date
4. **Type validation visual**:
   - Supported files: normal appearance, selectable checkbox
   - Unsupported files: grayed out (reduced opacity), no checkbox, tooltip on hover: "Unsupported file type. Supported: PDF, DOCX, XLSX, PPTX, CSV, TXT, MD, JPG, PNG, GIF, WebP, SVG, BMP, TIFF, JSON, JS, HTML, CSS"
5. **Individual file selection**: Users can check/uncheck individual supported files
6. **Folder selection behavior**: Selecting a folder selects ALL supported files within it (recursively). Unsupported files within the folder are automatically excluded.
7. **Mixed selection**: Users can combine folder-level and file-level selections

### Sync Behavior Changes

1. When syncing, only supported file types are processed through the RAG pipeline
2. Unsupported files are silently skipped during initial sync AND delta sync (PRD-108)
3. File type validation uses the shared `SUPPORTED_MIME_TYPES` constant (single source of truth)

---

## 4. Detailed Specifications

### 4.1 Backend Changes

**`OneDriveService.listFolder()`** — No changes needed. Already returns all items.

**New utility** (shared package): `isFileSyncSupported(mimeType: string): boolean`
- Checks against `SUPPORTED_MIME_TYPES` from `file-type-categories.ts`
- Used by both frontend (visual indication) and backend (sync filtering)
- Location: `packages/shared/src/utils/file-support.ts`

**`InitialSyncService`**: Add file type filter before creating `files` records. Skip items where `!isFileSyncSupported(item.mimeType)`.

**Browse API response**: Add `isSupported: boolean` field to each item in the browse response. Computed server-side using `isFileSyncSupported()`. This prevents the frontend from needing to duplicate MIME type logic.

### 4.2 Frontend Changes

**`ConnectionWizard.tsx`**:
- Remove `data.items.filter(i => i.isFolder)` filter on lines 333 and 401
- Render both files and folders in the tree
- Files are leaf nodes (no expand chevron, no children)
- Sort order: folders first (alphabetical), then files (alphabetical)

**New component: `FileNodeItem`** (or extend `FolderNode`):
- Renders file name + icon + size + modified date
- If `isSupported === false`: reduced opacity, no checkbox, tooltip with supported types message
- If `isSupported === true`: normal appearance, selectable checkbox
- Uses `FileIcon` component from existing `frontend/components/files/` for MIME-based icons

**Selection model changes**:
- Current: `selectedFolderIds: Set<string>` — only folder IDs
- New: `selectedItemIds: Set<string>` — both folder and file IDs
- Scope creation: folders create scope_type='folder', individual files create scope_type='file' (new scope type, needs DB CHECK constraint update)
- When a folder is selected, individual files within it don't need separate scope records (the folder scope covers them)

### 4.3 Schema Changes

**`connection_scopes.scope_type`** CHECK constraint update:
- Current: `root, folder, site, library`
- New: `root, folder, file, site, library`

This allows individual file sync scopes alongside folder scopes.

### 4.4 Sync Filtering (Pipeline Guard)

Add a pipeline guard in `FileProcessingService.processFile()` or earlier (at file creation time):
```typescript
if (!isFileSyncSupported(file.mimeType)) {
  logger.info({ fileId, mimeType }, 'Skipping unsupported file type');
  // Mark as 'skipped' or don't create the file record at all
  return;
}
```

This protects against unsupported files entering the pipeline even if the frontend selection has gaps (defense in depth).

---

## 5. Implementation Order

### Step 1: Shared Utility (0.5 day)
1. Create `isFileSyncSupported()` in `packages/shared/src/utils/file-support.ts`
2. Export from shared package
3. Unit tests covering all supported MIME types + common unsupported types
4. Add `isSupported` field to browse API response

### Step 2: Frontend File Rendering (1 day)
1. Remove folder-only filter in `ConnectionWizard.tsx`
2. Create `FileNodeItem` component (or extend `FolderNode`)
3. Implement supported/unsupported visual states
4. Implement tooltip for unsupported files
5. Add file icons using existing `FileIcon` mapping
6. Sort: folders first, then files

### Step 3: Selection Model + Scope Changes (0.5 day)
1. Extend selection to support file IDs
2. Update scope creation to handle `scope_type='file'`
3. Update CHECK constraint for `connection_scopes.scope_type`
4. Unit tests for mixed folder/file selection

### Step 4: Pipeline Guard (0.5 day)
1. Add MIME type check in `InitialSyncService`
2. Add MIME type check in `DeltaSyncService` (PRD-108 prep)
3. Unit tests for filtering behavior

---

## 6. UI Mockup (Text)

```
Select folders to sync
Choose which OneDrive folders to make available for the Knowledge Base Expert agent

▼ 📁 Documents                              ☑
    📄 report-2026.pdf         2.3 MB   Mar 5   ☑
    📄 budget.xlsx             890 KB   Mar 1   ☑
    📄 notes.txt               12 KB    Feb 28  ☑
    📄 backup.zip              45 MB    Feb 15  ⊘ (grayed, tooltip: "Unsupported file type...")
  ▶ 📁 Invoices                              ☐
▼ 📁 Projects                               ☐
    📄 architecture.docx       1.1 MB   Mar 8   ☐
    📄 design.pptx             5.4 MB   Mar 7   ☐
    📄 data.csv                320 KB   Mar 6   ☐
  ▶ 📁 Alpha                                ☐
  ▶ 📁 Beta                                 ☐
📁 Empty folder                              ☐
```

---

## 7. Affected Files

### New Files
| File | Purpose |
|---|---|
| `packages/shared/src/utils/file-support.ts` | `isFileSyncSupported()` utility |
| `packages/shared/src/__tests__/file-support.test.ts` | Unit tests |

### Modified Files
| File | Change |
|---|---|
| `frontend/components/connections/ConnectionWizard.tsx` | Remove folder filter, render files, selection model |
| `backend/src/routes/connections.ts` | Add `isSupported` to browse response items |
| `backend/src/services/connectors/onedrive/OneDriveService.ts` | Add `mimeType` to mapped items if not already present |
| `backend/src/services/sync/InitialSyncService.ts` | File type filter |
| `backend/prisma/schema.prisma` | CHECK constraint update for scope_type |
| `packages/shared/src/utils/index.ts` | Export new utility |
| `packages/shared/src/index.ts` | Re-export |

---

## 8. Phase 1 (Lite) — Completed 2026-03-09

Phase 1 implements file-level browsing and selection without type validation (graying out unsupported files). All files are visible and selectable; type validation is deferred to Phase 2.

### What was implemented

#### Frontend
- **`file-type-utils.tsx`**: Added `video`, `audio`, `onenote` icon types with `FileVideo`, `FileAudio`, `NotebookPen` icons. Added extension mappings (`.one`, `.onetoc2`, `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`, `.wmv`, `.mp3`, `.wav`, `.m4a`, `.flac`, `.ogg`, `.wma`, `.loop`) and MIME prefix checks (`video/*`, `audio/*`). Added color entries (onenote=purple, video=slate, audio=pink).
- **`ConnectionWizard.tsx`**: Major refactor:
  - Renamed `FolderNodeData` -> `TreeNodeData`, `FolderNode` -> `TreeNode`
  - Removed `.filter(i => i.isFolder)` from root fetch and subfolder fetch — all items now visible
  - Added `sortItems()` helper (folders first, then files, both alphabetical)
  - Added inline `formatFileSize()` helper
  - `TreeNode` renders files with type-specific icons (via `getFileIconType`/`FileTypeIcon`) and right-aligned file size
  - Files are leaf nodes (no expand chevron, spacer instead)
  - Added `isFolder` field to `SelectedScope` to distinguish scope types on creation
  - Scope creation uses `scopeType: s.isFolder ? 'folder' : 'file'`
  - Updated all UI text: "Select Items to Sync", "Loading contents...", "No items found"
  - Selection summary now shows separate counts: "2 folders, 3 files selected"

#### Shared Package
- **`onedrive.schemas.ts`**: Added `'file'` to `scopeType` enum: `z.enum(['root', 'folder', 'file', 'site', 'library'])`
- **`onedrive.types.ts`**: Added `childCount: number | null` to `ExternalFileItem`

#### Backend
- **`OneDriveService.ts`**: Added `childCount` mapping in `mapDriveItem()` from Graph API folder facet. Added `getItemMetadata()` method for single-item metadata fetch.
- **`InitialSyncService.ts`**: Added scope type check — `file` scopes route to new `_runFileLevelSync()` method. This lightweight path fetches single file metadata, creates one DB record, enqueues for processing, and updates scope status. Full error handling with scope status updates and WebSocket emission.

#### Database / Schema
- **`schema.prisma`**: Updated CHECK constraint comment to include `'file'`
- **`backend/prisma/CLAUDE.md`**: Updated constraint table
- **CHECK constraint SQL** (must be run manually against Azure SQL):
  ```sql
  ALTER TABLE connection_scopes DROP CONSTRAINT CK_connection_scopes_scope_type;
  ALTER TABLE connection_scopes ADD CONSTRAINT CK_connection_scopes_scope_type
    CHECK (scope_type IN ('root','folder','file','site','library'));
  ```

### Verification results
- `npm run build:shared` — passed
- `npm run verify:types` (shared + frontend) — passed
- `npm run -w backend build` — passed (610 files)
- `npm run -w bc-agent-frontend lint` — 0 errors (46 pre-existing warnings)
- `npx prisma db push` — schema in sync (CHECK constraint is SQL-level, not Prisma)

### What was NOT implemented (deferred to Phase 2)
- `isFileSyncSupported()` utility — no file type validation
- Grayed out unsupported files with tooltip
- `isSupported` field in browse API response
- Pipeline guard for unsupported MIME types
- Folder selection recursively selecting all supported files

---

## 9. Phase 2 — Success Criteria (Remaining)

- [x] Files are visible in the folder tree alongside folders
- [ ] Unsupported files are grayed out with informative tooltip
- [x] Supported files are selectable via checkbox
- [x] Individual files can be selected for sync without selecting entire folder
- [ ] Folder selection includes all supported files within it
- [ ] Unsupported files are never processed through the RAG pipeline
- [ ] `isFileSyncSupported()` uses shared constants (single source of truth)
- [x] All existing tests pass
- [x] Type-check and lint pass

---

## 10. Out of Scope

- Folder size estimation (total sync size preview)
- File preview from the folder picker
- Drag-and-drop file selection
- Bulk select/deselect all
- File search within the folder picker
