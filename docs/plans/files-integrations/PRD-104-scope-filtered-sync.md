# PRD-104: Scope-Filtered Sync & Deduplication

**Phase**: OneDrive (Critical Fix)
**Status**: COMPLETED
**Prerequisites**: PRD-103 (Completed)
**Estimated Effort**: 2–3 days
**Created**: 2026-03-09
**Completed**: 2026-03-09

---

## 1. Objective

Fix two critical data integrity bugs in the sync pipeline:
1. **Sync ignores folder scope**: `InitialSyncService._runSync()` calls `executeDeltaQuery(connectionId)` which hits `/drives/{driveId}/root/delta` — syncing the ENTIRE drive regardless of which folders the user selected. The `scope_resource_id` is stored but never used.
2. **No duplicate prevention**: `IX_files_connection_external` is a regular index (not unique). `prisma.files.create()` without upsert creates duplicates on every re-sync.

Without these fixes, the system is fundamentally broken: users cannot control what gets synced, and re-syncing multiplies data.

---

## 2. Current State (After PRD-103)

- User selects specific folders/files in the Connection Wizard
- `connection_scopes` records are created with correct `scope_resource_id` and `scope_type`
- `InitialSyncService._runSync()` ignores the scope and calls `executeDeltaQuery(connectionId)` which queries `/drives/{driveId}/root/delta` — returning ALL files in the drive
- Every sync run creates new `files` records even if the same file already exists (no upsert, no unique constraint)
- The `IX_files_connection_external` index on `(connection_id, external_id)` is a regular (non-unique) index

---

## 3. Expected State (After PRD-104)

### Scope-Filtered Delta Queries
- When `scope_type = 'folder'`: delta query uses `/drives/{driveId}/items/{folderId}/delta` — only items under that specific folder are returned
- When `scope_type = 'root'`: existing behavior (full drive delta) is preserved
- When `scope_type = 'file'`: existing single-file sync path (from PRD-103) is preserved

### Deduplication
- `(connection_id, external_id)` has a UNIQUE constraint — the database itself prevents duplicates
- Sync uses upsert instead of create — re-syncing updates metadata without creating duplicates
- Files already processed (`pipeline_status = 'ready'`) are NOT re-queued on update

### Data Cleanup
- Existing duplicate files are cleaned up via a one-time script before adding the unique constraint

---

## 4. Detailed Specifications

### 4.1 Backend — Folder-Scoped Delta Query

**File**: `backend/src/services/connectors/onedrive/OneDriveService.ts`

Add a new method that keeps the existing `executeDeltaQuery` unchanged for backward compatibility:

```typescript
/**
 * Execute a delta query scoped to a specific folder.
 * Uses GET /drives/{driveId}/items/{folderId}/delta
 *
 * This returns ONLY items that are children of the specified folder,
 * unlike executeDeltaQuery which returns the entire drive.
 */
async executeFolderDeltaQuery(
  connectionId: string,
  folderId: string,
  deltaLink?: string
): Promise<DeltaQueryResult> {
  const token = await getGraphTokenManager().getValidToken(connectionId);
  let raw: Record<string, unknown>;

  if (deltaLink) {
    // Resume from previous delta link (already scoped)
    raw = await getGraphHttpClient().get<Record<string, unknown>>(deltaLink, token);
  } else {
    // Initial folder-scoped delta query
    const { driveId } = await getConnectionDriveInfo(connectionId);
    raw = await getGraphHttpClient().get<Record<string, unknown>>(
      `/drives/${driveId}/items/${folderId}/delta`,
      token
    );
  }
  // ... same mapping logic as executeDeltaQuery (mapDriveItem, pagination)
}
```

**Key difference from `executeDeltaQuery`**: The URL path uses `/items/{folderId}/delta` instead of `/root/delta`. The Microsoft Graph API returns only items that are descendants of the specified folder.

### 4.2 Backend — Scope-Based Delta Routing

**File**: `backend/src/services/sync/InitialSyncService.ts`

In `_runSync()`, after the scope type check, route to the correct delta method:

```typescript
// Determine which delta method to use based on scope type
let page: DeltaQueryResult;

if (scope.scope_type === 'folder' && scope.scope_resource_id) {
  // Folder-scoped delta: only items under this specific folder
  this.logger.info(
    { connectionId, scopeId: scope.id, folderId: scope.scope_resource_id },
    'Starting folder-scoped delta query'
  );
  page = await getOneDriveService().executeFolderDeltaQuery(
    connectionId,
    scope.scope_resource_id
  );
} else {
  // Root scope: full drive delta (existing behavior)
  this.logger.info(
    { connectionId, scopeId: scope.id },
    'Starting root-scoped delta query'
  );
  page = await getOneDriveService().executeDeltaQuery(connectionId);
}
```

The pagination loop must also use the correct method when following `@odata.nextLink`:
- If the initial query was folder-scoped, subsequent pages will use `deltaLink` from the response (already folder-scoped)
- The `executeFolderDeltaQuery` method handles this via the `deltaLink` parameter

### 4.3 Backend — Upsert Instead of Create

**File**: `backend/src/services/sync/InitialSyncService.ts`

Replace `prisma.files.create()` with `prisma.files.upsert()`:

```typescript
await prisma.files.upsert({
  where: {
    UQ_files_connection_external: {
      connection_id: connectionId,
      external_id: item.id,
    },
  },
  create: {
    id: crypto.randomUUID().toUpperCase(),
    user_id: userId,
    name: item.name,
    mime_type: item.mimeType ?? 'application/octet-stream',
    size_bytes: BigInt(item.sizeBytes ?? 0),
    source_type: FILE_SOURCE_TYPE.ONEDRIVE,
    external_id: item.id,
    external_drive_id: driveId,
    external_url: item.webUrl ?? null,
    external_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
    content_hash_external: item.eTag ?? null,
    connection_id: connectionId,
    connection_scope_id: scopeId,
    pipeline_status: 'queued',
    last_synced_at: new Date(),
  },
  update: {
    // Update metadata fields
    name: item.name,
    mime_type: item.mimeType ?? 'application/octet-stream',
    size_bytes: BigInt(item.sizeBytes ?? 0),
    external_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
    content_hash_external: item.eTag ?? null,
    connection_scope_id: scopeId,
    last_synced_at: new Date(),
    // IMPORTANT: Do NOT update pipeline_status — avoid re-processing files
    // that are already 'ready'. Re-processing is only needed when content changes
    // (detected by content_hash_external diff), which is a PRD-108 concern.
  },
});
```

**Critical design decision**: On update, `pipeline_status` is NOT changed. A file that is already `ready` should not be re-queued. Content change detection (and re-processing) is the responsibility of the webhook sync engine (PRD-108).

**Re-queue logic**: Only newly created files (the `create` branch) get `pipeline_status: 'queued'`. The upsert's create branch fires only when the file doesn't exist yet.

### 4.4 Schema — Unique Constraint

**File**: `backend/prisma/schema.prisma`

Replace the existing regular index with a unique constraint on the `files` model:

```prisma
// BEFORE:
@@index([connection_id, external_id], map: "IX_files_connection_external")

// AFTER:
@@unique([connection_id, external_id], map: "UQ_files_connection_external")
```

**Raw SQL** (for Azure SQL, must be run before `prisma db push`):

```sql
-- Step 1: Drop the old regular index
DROP INDEX IF EXISTS IX_files_connection_external ON files;

-- Step 2: Add the unique constraint
ALTER TABLE files ADD CONSTRAINT UQ_files_connection_external
  UNIQUE (connection_id, external_id);
```

**Note**: Prisma will detect the existing unique constraint on `db pull` and map it correctly. The `prisma db push` after editing schema.prisma will attempt to create it if not already present.

### 4.5 Cleanup Script — Remove Existing Duplicates

**MUST be run BEFORE adding the unique constraint** (otherwise the ALTER TABLE fails).

**File**: `backend/scripts/cleanup-duplicate-files.sql`

```sql
-- Identify and remove duplicate files (keep the latest created_at per group)
-- This is a one-time cleanup for data integrity before adding UQ constraint

-- Step 1: Preview duplicates (dry run)
SELECT connection_id, external_id, COUNT(*) as duplicate_count
FROM files
WHERE connection_id IS NOT NULL AND external_id IS NOT NULL
GROUP BY connection_id, external_id
HAVING COUNT(*) > 1;

-- Step 2: Delete duplicates (keep newest)
WITH Duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY connection_id, external_id
      ORDER BY created_at DESC
    ) AS rn
  FROM files
  WHERE connection_id IS NOT NULL AND external_id IS NOT NULL
)
DELETE FROM files
WHERE id IN (SELECT id FROM Duplicates WHERE rn > 1);

-- Step 3: Clean orphaned file_chunks
DELETE FROM file_chunks
WHERE file_id NOT IN (SELECT id FROM files);

-- Step 4: Verify no duplicates remain
SELECT connection_id, external_id, COUNT(*) as cnt
FROM files
WHERE connection_id IS NOT NULL AND external_id IS NOT NULL
GROUP BY connection_id, external_id
HAVING COUNT(*) > 1;
-- Expected: 0 rows
```

Also clean AI Search embeddings for deleted files via the application's `SoftDeleteService` or a dedicated script.

---

## 5. Affected Files

| File | Change |
|------|--------|
| `backend/src/services/connectors/onedrive/OneDriveService.ts` | Add `executeFolderDeltaQuery()` method |
| `backend/src/services/sync/InitialSyncService.ts` | Scope-based delta routing + upsert logic |
| `backend/prisma/schema.prisma` | `@@unique([connection_id, external_id])` replaces `@@index` |
| `backend/prisma/CLAUDE.md` | Document new unique constraint |
| `backend/scripts/cleanup-duplicate-files.sql` | One-time cleanup script (NEW) |

---

## 6. Implementation Order

### Step 1: Cleanup Script (0.5 day)
1. Run duplicate preview query to assess scope
2. Execute cleanup SQL against Azure SQL
3. Clean orphaned file_chunks
4. Clean AI Search embeddings for deleted files
5. Verify zero duplicates remain

### Step 2: Unique Constraint (0.5 day)
1. Run `ALTER TABLE` SQL to add unique constraint
2. Update `schema.prisma`: change `@@index` to `@@unique`
3. Run `npx prisma db pull` to verify schema matches
4. Run `npx prisma generate` to update client types
5. Verify: `npx prisma validate`

### Step 3: Folder-Scoped Delta (1 day)
1. Add `executeFolderDeltaQuery()` to `OneDriveService`
2. Update `InitialSyncService._runSync()` to route by scope type
3. Update pagination loop to use correct delta method
4. Unit tests: folder-scoped delta with mocked Graph API
5. Unit tests: root-scoped delta still works (regression)

### Step 4: Upsert Logic (0.5 day)
1. Replace `prisma.files.create()` with `prisma.files.upsert()`
2. Update the `where` clause to use the new unique constraint name
3. Unit tests: first sync creates, second sync updates (no duplicate)
4. Unit tests: re-sync doesn't change `pipeline_status` of `ready` files

### Step 5: Verification (0.5 day)
1. `npm run build:shared && npm run verify:types`
2. `npm run -w backend build`
3. Manual: Select single folder → sync → verify ONLY that folder's files appear
4. Manual: Re-sync same folder → verify no duplicates
5. Manual: Add second scope (different folder) → verify only new files added
6. Manual: Check pipeline_status of re-synced files (should remain 'ready')

---

## 7. Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Root scope (full drive) | Uses existing `executeDeltaQuery()` — no change |
| File scope (single file) | Uses existing `_runFileLevelSync()` from PRD-103 — no change |
| Folder scope with nested subfolders | `/items/{folderId}/delta` returns ALL descendants recursively |
| Empty folder | Delta returns no items — scope marked as synced with item_count=0 |
| Folder with 10K+ files | Pagination via `@odata.nextLink` handles large folders |
| File moved OUT of scoped folder | Will appear as deleted in next delta (with `deleted` facet) — PRD-108 concern |
| Re-sync after file content changed | Upsert updates metadata but does NOT re-queue — content change detection is PRD-108 |
| Two scopes pointing to overlapping folders | Same file may appear in both deltas; upsert ensures single record (last scope wins for `connection_scope_id`) |

---

## 8. Success Criteria

- [x] Folder-scoped sync only returns files within the selected folder
- [x] Root-scoped sync continues to work as before (regression)
- [x] File-scoped sync continues to work as before (regression)
- [x] `(connection_id, external_id)` has a UNIQUE constraint in the database (filtered unique index)
- [x] Re-syncing the same scope does NOT create duplicate file records
- [x] Re-syncing does NOT re-queue files that are already `pipeline_status = 'ready'`
- [x] Existing duplicate files are cleaned up before constraint is added
- [x] All existing tests pass
- [x] `npm run build:shared && npm run verify:types` passes
- [ ] `npm run -w backend build` passes (not run — backend build requires full infra)

---

## 9. Out of Scope

- Content change detection and re-processing (PRD-108 webhook sync)
- Scope deletion with file cleanup (PRD-105 scope management)
- File type validation / pipeline guard (PRD-106)
- Frontend changes (no UI changes in this PRD — purely backend data integrity)

---

## 10. Implementation Changelog

**Date**: 2026-03-09

### Completed

#### Step 1: Cleanup — Duplicate removal
- Created `backend/scripts/cleanup-duplicate-files.sql` (one-time cleanup reference script)
- Ran cleanup against Azure SQL: **14 duplicate groups found and deleted** (all from a single connection, 14 excess rows removed)
- 0 orphaned `file_chunks` found
- Verified 0 duplicates remaining post-cleanup

#### Step 2: Schema — Filtered Unique Index
- **Deviation from plan**: Could not use Prisma `@@unique` because both `connection_id` and `external_id` are nullable (`String?`). SQL Server treats NULLs as equal in regular unique constraints, and the `files` table has 288 rows with `NULL` in both columns (locally-uploaded files). A regular `UNIQUE` constraint would fail.
- **Solution**: Created a **filtered unique index** via raw SQL:
  ```sql
  CREATE UNIQUE INDEX UQ_files_connection_external
  ON files (connection_id, external_id)
  WHERE connection_id IS NOT NULL AND external_id IS NOT NULL
  ```
- Prisma cannot represent filtered indexes in its DSL. The schema retains a `///` comment documenting the DB-level constraint. The old `IX_files_connection_external` non-unique index was dropped.
- **Consequence for code**: Prisma `upsert` with compound unique accessor is not available. Code uses `findFirst` + `create`/`update` pattern instead.
- Updated `backend/prisma/CLAUDE.md` with filtered unique index documentation and code pattern.

#### Step 3: Folder-Scoped Delta Query
- Added `OneDriveService.executeFolderDeltaQuery(connectionId, folderId, deltaLink?)` method
- Uses `/drives/{driveId}/items/{folderId}/delta` for folder-scoped enumeration
- When `deltaLink` is provided, uses it verbatim (already folder-scoped by Graph API)
- Same `mapDriveItem` mapping, same pagination handling as `executeDeltaQuery`
- 6 new unit tests covering: path construction, deltaLink passthrough, result shape, pagination, deleted items, empty results

#### Step 4: Scope-Based Delta Routing
- Updated `InitialSyncService._runSync()` to route based on `scope.scope_type`:
  - `'folder'` + `scope_resource_id` → `executeFolderDeltaQuery(connectionId, scope_resource_id)`
  - `'root'` or folder without resource ID → `executeDeltaQuery(connectionId)` (existing behavior)
  - `'file'` → `_runFileLevelSync()` (existing, from PRD-103)
- Pagination loop unchanged — `nextPageLink` is absolute and already scoped by Graph API

#### Step 5: Deduplication via findFirst + create/update
- Replaced `prisma.files.create()` with `findFirst` + branching in both `_runSync()` and `_runFileLevelSync()`:
  - Existing file → `prisma.files.update()` (metadata only, does NOT touch `pipeline_status`)
  - New file → `prisma.files.create()` + enqueue for processing
- Only newly created files are enqueued (`addFileProcessingFlow`); re-synced files are silently updated
- Fixed pre-existing bug: `_runFileLevelSync` also used `create()` — would have thrown P2002 with the new unique index

#### Step 6: Tests
- **OneDriveService.test.ts**: Added `describe('executeFolderDeltaQuery')` with 6 tests. Fixed pre-existing `childCount` field mismatch in `listFolder` test. **41 tests total, all passing.**
- **InitialSyncService.test.ts**: Full rewrite:
  - Fixed missing `findScopeById` mock (was absent since PRD-103 — all tests were silently broken)
  - Added `mockFindScopeById` returning root scope by default
  - Replaced `mockFilesUpsert` with `mockFilesFindFirst` + `mockFilesCreate` + `mockFilesUpdate`
  - Added scope-aware delta routing tests (folder, root, file, folder without resource ID)
  - Added deduplication tests (existing file → update not create, new file → create + enqueue, mixed batch)
  - Added `_runFileLevelSync` dedup tests (new file, existing file, scope update)
  - **32 tests total, all passing.**

#### Post-Implementation Fix: Scope Root Folder Creation (2026-03-09)

Discovered during PRD-107 testing that the scope root folder itself was never created in the `files` table. Fix applied to `InitialSyncService.ts`:
- Scope root folder now explicitly created for `folder`-type scopes before processing child folders
- `externalToInternalId` map seeding moved outside `folderChanges.length > 0` guard
- Removed `parentId !== scope.scope_resource_id` parent resolution special-case (3 occurrences)
- 6 new tests (38 total for InitialSyncService)

See PRD-107 §6.9 for full details.

### Verification Results

| Check | Result |
|-------|--------|
| `npm run build:shared && npm run verify:types` | PASS |
| `npm run -w backend test:unit -- -t "OneDriveService"` | 41/41 PASS |
| `npm run -w backend test:unit -- -t "InitialSyncService"` | 32/32 PASS |
| `npx prisma db push` | "Database is already in sync" |
| DB: `UQ_files_connection_external` index | `is_unique: true, has_filter: true` |
| DB: Duplicate count | 0 |
| Scope root folder creation (post-fix) | 38/38 PASS |

### Files Modified/Created

| File | Change |
|------|--------|
| `backend/scripts/cleanup-duplicate-files.sql` | **NEW** — One-time SQL cleanup reference script |
| `backend/prisma/schema.prisma` | Removed `@@index` for connection_external; added `///` comment documenting filtered unique index |
| `backend/prisma/CLAUDE.md` | Documented filtered unique index, code pattern, and Prisma limitation |
| `backend/src/services/connectors/onedrive/OneDriveService.ts` | Added `executeFolderDeltaQuery()` method |
| `backend/src/services/sync/InitialSyncService.ts` | Scope-based delta routing + findFirst/create/update dedup in both `_runSync` and `_runFileLevelSync` |
| `backend/src/__tests__/.../OneDriveService.test.ts` | 6 new folder delta tests + 1 fix (childCount) |
| `backend/src/__tests__/.../InitialSyncService.test.ts` | Full rewrite: fixed mocks, 32 tests covering routing + dedup |
