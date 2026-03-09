# PRD-105: Scope Management & Re-configuration

**Phase**: OneDrive Enhancement
**Status**: TODO
**Prerequisites**: PRD-104 (Scope-Filtered Sync)
**Estimated Effort**: 3–4 days
**Created**: 2026-03-09

---

## 1. Objective

Enable users to view, modify, and delete their sync scopes through the Connection Wizard. Currently, re-opening the wizard shows a blank folder tree with no indication of what's already synced. Users cannot see their current configuration, cannot add new scopes incrementally, and cannot remove scopes (with proper file cleanup).

---

## 2. Current State (After PRD-104)

- Connection Wizard always opens with a blank folder tree
- No API to retrieve existing scopes for a connection
- Removing a scope via direct DB deletion orphans synced files (no cascade to `files` table)
- No UI to compare previous vs. new scope selection
- No confirmation step showing what will be added/removed

---

## 3. Expected State (After PRD-105)

### Scope Pre-Selection
- When the wizard opens for an existing connection, the folder tree pre-checks all currently synced scopes
- Previously synced folders/files show a different visual state (e.g., filled checkbox + "Synced" badge)
- Users can see at a glance what's currently in their Knowledge Base

### Scope Diff & Confirmation
- When the user modifies selections and clicks "Save", a diff view shows:
  - **New scopes**: Items being added to sync (will be synced)
  - **Removed scopes**: Items being removed (files will be deleted from KB)
  - **Unchanged scopes**: Items staying as-is
- A confirmation modal summarizes the changes before executing

### Scope Removal with Cleanup
- Removing a scope triggers cleanup of all associated files:
  1. Delete AI Search embeddings for affected files
  2. Delete `file_chunks` records
  3. Delete `files` records
  4. Delete the `connection_scopes` record
- Cleanup is performed by a new `ScopeCleanupService`

### Scope Status Badges
- Each scope in the tree shows its current sync status (synced, syncing, error)
- Item count per scope displayed

---

## 4. Detailed Specifications

### 4.1 Backend — Scopes API

**New endpoint**: `GET /api/connections/:id/scopes`

Returns all scopes for a connection with file counts:

```typescript
interface ScopeWithStats {
  id: string;
  scopeType: string;
  scopeResourceId: string | null;
  scopeDisplayName: string | null;
  scopePath: string | null;
  syncStatus: string;
  lastSyncAt: string | null;
  itemCount: number;
  fileCount: number;  // actual files in DB for this scope
}
```

**New endpoint**: `DELETE /api/connections/:id/scopes/:scopeId`

Triggers `ScopeCleanupService.removeScope()`:

```typescript
async removeScope(scopeId: string, userId: string): Promise<ScopeRemovalResult> {
  // 1. Find all files linked to this scope
  const files = await prisma.files.findMany({
    where: { connection_scope_id: scopeId },
    select: { id: true },
  });
  const fileIds = files.map(f => f.id);

  // 2. Delete AI Search embeddings
  for (const fileId of fileIds) {
    await vectorSearchService.deleteChunksForFile(fileId, userId);
  }

  // 3. Delete file_chunks
  await prisma.file_chunks.deleteMany({
    where: { file_id: { in: fileIds } },
  });

  // 4. Delete files
  await prisma.files.deleteMany({
    where: { connection_scope_id: scopeId },
  });

  // 5. Delete scope record
  await prisma.connection_scopes.delete({
    where: { id: scopeId },
  });

  return { filesDeleted: fileIds.length, scopeId };
}
```

**New endpoint**: `POST /api/connections/:id/scopes/batch`

Accepts a diff payload for batch scope changes:
```typescript
interface ScopeBatchPayload {
  add: CreateScopeInput[];     // New scopes to create and sync
  remove: string[];            // Scope IDs to remove (with cleanup)
}
```

### 4.2 Frontend — Scope Pre-Selection

**File**: `frontend/components/connections/ConnectionWizard.tsx`

On wizard open for an existing connection:
1. Fetch `GET /api/connections/:id/scopes`
2. For each scope, find the corresponding tree node and mark it as checked
3. Use a different checkbox state for "already synced" vs "newly selected":
   - **Already synced**: Filled checkbox with subtle green badge ("Synced · 12 files")
   - **Newly selected**: Standard checkbox (empty → checked)
   - **Marked for removal**: Red strikethrough on previously-synced item

### 4.3 Frontend — Scope Diff Modal

When the user clicks "Save Changes" (replacing "Start Sync" for re-configuration):

```
┌─────────────────────────────────────────────────────────┐
│  Review Changes                                          │
│                                                          │
│  ➕ Adding:                                              │
│     📁 Projects/Alpha (will sync ~23 files)             │
│     📁 Reports/ (will sync ~8 files)                    │
│                                                          │
│  ➖ Removing:                                            │
│     📁 Old Archive/ (will delete 45 files from KB)      │
│                                                          │
│  ═ Unchanged:                                            │
│     📁 Documents/ (47 files synced)                     │
│                                                          │
│  [Cancel]                              [Apply Changes]   │
└─────────────────────────────────────────────────────────┘
```

### 4.4 New Service: ScopeCleanupService

**File**: `backend/src/services/sync/ScopeCleanupService.ts`

Handles the cleanup side of scope removal. Uses structured logging with service name `ScopeCleanupService`.

Error handling: If AI Search deletion fails for a specific file, log the error and continue with remaining files (best-effort cleanup). The scope record is only deleted after all files are cleaned up.

---

## 5. Affected Files

### New Files
| File | Purpose |
|------|---------|
| `backend/src/services/sync/ScopeCleanupService.ts` | Scope removal with file cleanup |

### Modified Files
| File | Change |
|------|--------|
| `frontend/components/connections/ConnectionWizard.tsx` | Scope pre-selection, diff UI |
| `backend/src/routes/connections.ts` | GET scopes, DELETE scope, POST batch endpoints |
| `backend/src/domains/connections/ConnectionRepository.ts` | Scope queries with file counts |
| `backend/src/domains/connections/ConnectionService.ts` | Scope management business logic |

---

## 6. Success Criteria

- [ ] Re-opening wizard shows currently synced scopes pre-checked
- [ ] "Already synced" scopes show file count and synced badge
- [ ] Adding new scopes triggers sync only for new scopes
- [ ] Removing a scope deletes its files, chunks, and AI Search embeddings
- [ ] Diff modal shows clear summary of changes before applying
- [ ] Unchanged scopes are not re-synced
- [ ] `ScopeCleanupService` handles partial failures gracefully
- [ ] All existing tests pass
- [ ] Type-check and lint pass

---

## 7. Out of Scope

- Scope-level sync status indicators in the Files sidebar (PRD-107)
- Real-time sync events for scope changes (PRD-108)
- Shared files scope management (PRD-110)
