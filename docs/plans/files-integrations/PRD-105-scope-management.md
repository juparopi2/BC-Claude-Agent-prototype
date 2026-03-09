# PRD-105: Scope Management & Re-configuration

**Phase**: OneDrive Enhancement
**Status**: DONE
**Prerequisites**: PRD-104 (Scope-Filtered Sync)
**Estimated Effort**: 3–4 days
**Created**: 2026-03-09
**Completed**: 2026-03-09

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
  1. NULL out `message_citations.file_id` for affected files (preserve citation text)
  2. Delete AI Search embeddings for affected files (best-effort)
  3. Delete `files` records (FK cascades handle `file_chunks`, `image_embeddings`, `message_file_attachments`)
  4. Delete the `connection_scopes` record
- Cleanup is performed by `ScopeCleanupService`
- Syncing scopes are blocked from removal (409 Conflict)

### Scope Status Badges
- Each scope in the tree shows its current sync status (synced, syncing, error)
- Actual file count per scope displayed (real COUNT query on `files` table)

---

## 4. Detailed Specifications

### 4.1 Backend — Scopes API

**Enhanced endpoint**: `GET /api/connections/:id/scopes`

Now returns scopes with actual `fileCount` from the DB via `findScopesWithFileCounts()` (LEFT JOIN + COUNT):

```typescript
interface ConnectionScopeWithStats extends ConnectionScopeDetail {
  fileCount: number;  // actual files in DB for this scope
}
```

**New endpoint**: `DELETE /api/connections/:id/scopes/:scopeId`

Triggers `ScopeCleanupService.removeScope()` with full cascade:

```typescript
async removeScope(connectionId, scopeId, userId): Promise<ScopeRemovalResult> {
  // 1. Validate scope exists and belongs to connection
  // 2. Guard: block if sync_status === 'syncing' → ScopeCurrentlySyncingError (409)
  // 3. Fetch files for scope
  // 4. NULL out message_citations.file_id (raw SQL subquery)
  // 5. Best-effort AI Search cleanup (deleteChunksForFile per file, log+continue on failure)
  // 6. Delete files (FK cascades handle chunks, embeddings, attachments)
  // 7. Delete scope record
  return { filesDeleted, scopeId };
}
```

**New endpoint**: `POST /api/connections/:id/scopes/batch`

Accepts a diff payload validated by `batchScopesSchema`:
```typescript
interface ScopeBatchInput {
  add: Array<{ scopeType, scopeResourceId, scopeDisplayName, scopePath? }>;  // max 50
  remove: string[];  // scope IDs, max 50
}

interface ScopeBatchResult {
  added: ConnectionScopeDetail[];  // newly created scopes (with fileCount: 0)
  removed: Array<{ scopeId: string; filesDeleted: number }>;
}
```

Removes are processed first (sequential, via ScopeCleanupService), then adds (with fire-and-forget sync trigger per new scope).

### 4.2 Frontend — Scope Pre-Selection

**File**: `frontend/components/connections/ConnectionWizard.tsx`

On wizard open for an existing connection:
1. Fetch `GET /api/connections/:id/scopes` in parallel with browse data
2. Pre-populate `selectedScopes` Map with `status: 'existing'` entries matched by `scopeResourceId`
3. Three-state checkbox toggle:
   - **Already synced** (`existing`): Filled checkbox with green "Synced · N files" badge
   - **Newly selected** (`new`): Standard checked checkbox
   - **Marked for removal** (`removed`): Unchecked checkbox with strikethrough name + red "Will remove" badge
4. Button changes: "Save Changes" when reconfiguring, "Continue" for first-time

### 4.3 Frontend — Scope Diff View

**File**: `frontend/components/connections/ScopeDiffView.tsx`

Inline component shown when user clicks "Save Changes" and changes exist:

```
┌─────────────────────────────────────────────────────────┐
│  Review Changes                                          │
│                                                          │
│  ➕ Adding (2):                                         │
│     Projects/Alpha                                       │
│     Reports/                                             │
│                                                          │
│  ➖ Removing (1):                                       │
│     Old Archive/ — will delete 45 files                  │
│                                                          │
│  🔄 Unchanged (1)                                       │
│                                                          │
│  [Cancel]                              [Apply Changes]   │
└─────────────────────────────────────────────────────────┘
```

### 4.4 Service: ScopeCleanupService

**File**: `backend/src/services/sync/ScopeCleanupService.ts`

Singleton with `createChildLogger({ service: 'ScopeCleanupService' })`.

Cleanup cascade follows `cleanup-user-onedrive-files.sql` pattern:
1. NULL citations (no FK cascade on `message_citations.file_id`)
2. Best-effort AI Search deletion (errors logged, don't abort)
3. Delete files via `deleteMany` (FK cascades handle dependents)
4. Delete scope record

Error class `ScopeCurrentlySyncingError` blocks removal of actively syncing scopes.

---

## 5. Implementation Details

### New Files
| File | Purpose |
|------|---------|
| `backend/src/services/sync/ScopeCleanupService.ts` | Scope removal with cascading file + AI Search cleanup |
| `frontend/components/connections/ScopeDiffView.tsx` | Diff summary UI for reconfiguration |
| `backend/src/__tests__/unit/services/sync/ScopeCleanupService.test.ts` | 23 unit tests for scope cleanup |

### Modified Files
| File | Change |
|------|--------|
| `packages/shared/src/types/connection.types.ts` | Added `ConnectionScopeWithStats`, `ScopeBatchInput`, `ScopeBatchResult` |
| `packages/shared/src/schemas/onedrive.schemas.ts` | Added `batchScopesSchema`, `scopeIdParamSchema` |
| `packages/shared/src/index.ts` | Re-exported new types and schemas |
| `packages/shared/src/types/index.ts` | Re-exported new types |
| `packages/shared/src/schemas/index.ts` | Re-exported new schemas |
| `backend/src/domains/connections/ConnectionRepository.ts` | Added `findScopesWithFileCounts`, `findFilesByScopeId`, `deleteScopeById` |
| `backend/src/domains/connections/ConnectionService.ts` | Added `listScopesWithStats`, `deleteScope`, `batchUpdateScopes` |
| `backend/src/domains/connections/index.ts` | Re-exported `ScopeCurrentlySyncingError` |
| `backend/src/routes/connections.ts` | Added DELETE scope, POST batch, enhanced GET scopes with file counts |
| `frontend/components/connections/ConnectionWizard.tsx` | Scope pre-selection, 3-state toggle, diff view, batch API integration |

### Design Decisions
| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Direct deletion (not SoftDeleteService) | Scope removal is a bulk admin operation, not a user-visible soft-delete |
| D2 | Separate operations per remove (not single TX) | Removes involve external services (AI Search); return per-operation results |
| D3 | Block syncing scope removal (409) | Avoid race conditions between sync writing files and cleanup deleting them |
| D4 | Real COUNT query for fileCount | `item_count` on scope reflects delta changes, not actual DB file count |

---

## 6. Success Criteria

- [x] Re-opening wizard shows currently synced scopes pre-checked
- [x] "Already synced" scopes show file count and synced badge
- [x] Adding new scopes triggers sync only for new scopes
- [x] Removing a scope deletes its files, chunks, and AI Search embeddings
- [x] Diff view shows clear summary of changes before applying
- [x] Unchanged scopes are not re-synced
- [x] `ScopeCleanupService` handles partial failures gracefully
- [x] All existing tests pass
- [x] Type-check and lint pass
- [x] 23 unit tests for ScopeCleanupService pass

---

## 7. Verification

```bash
# Type-check
npm run build:shared && npm run verify:types

# Backend build
npm run -w backend build

# Unit tests
npm run -w backend test:unit -- -t "ScopeCleanupService"

# Lint
npm run -w backend lint
npm run -w bc-agent-frontend lint
```

---

## 8. Out of Scope

- Scope-level sync status indicators in the Files sidebar (PRD-107)
- Real-time sync events for scope changes (PRD-108)
- Shared files scope management (PRD-110)
