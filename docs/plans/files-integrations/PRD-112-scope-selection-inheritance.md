# PRD-112: Scope Selection Inheritance & Granular Sync Control

**Phase**: OneDrive Enhancement
**Status**: COMPLETED
**Prerequisites**: PRD-105 (Scope Management), PRD-107 (OneDrive UX Polish)
**Estimated Effort**: 5–7 days
**Created**: 2026-03-09

---

## 1. Objective

Implement cascading selection in the Connection Wizard so that selecting a parent folder auto-selects all its children (files and subfolders), deselecting a child within a selected parent creates a selective sync, and partial selection states are clearly communicated via tri-state checkboxes and visual indicators.

Currently, each scope is independent — selecting a folder syncs everything inside it, but there is no way to exclude specific children. Users cannot express "sync this folder, except for file X" without creating individual file-level scopes for every desired item.

---

## 2. Current State (After PRD-105 + PRD-107)

- **Flat scope model**: Each `connection_scopes` record represents exactly one folder or one file. No parent-child relationship between scopes.
- **Folder scope = all descendants**: A folder scope syncs ALL contents via Microsoft Graph delta query. There is no exclusion mechanism.
- **Independent selection**: Checking/unchecking items in the wizard is independent — selecting a parent does NOT auto-select children in the UI.
- **No partial indicators**: No visual distinction between "all children synced" vs "some children synced".
- **Re-opening wizard**: Shows existing scopes pre-checked (PRD-105), but each item is a standalone toggle.

### What's Missing

| Capability | Current | Desired |
|-----------|---------|---------|
| Select parent → children selected | No | Yes |
| Deselect child within selected parent | Not possible | Creates exclusion |
| Tri-state checkbox (checked/unchecked/indeterminate) | No | Yes |
| Partial sync badge on parent | No | Amber/gray indicator |
| Exclude specific files from folder sync | Not possible | Via exclusion scopes |
| State persistence on wizard reopen | Flat pre-selection | Full inheritance tree |

---

## 3. Proposed Design

### 3.1 Scope Model Extension

The current model stores one scope per synced entity. To support exclusions, introduce an **exclusion model**:

#### Option A: Exclusion Records (Recommended)

Add a new column to `connection_scopes`:

```sql
ALTER TABLE connection_scopes ADD scope_mode NVARCHAR(20) NOT NULL DEFAULT 'include';
-- CHECK: scope_mode IN ('include', 'exclude')
```

- `include` (default): Existing behavior — this scope is synced.
- `exclude`: This item is explicitly excluded from its parent's sync.

**Example**: "Sync `Projects/` but exclude `Projects/Archive/old-report.xlsx`"

```
connection_scopes:
  { scope_type: 'folder', scope_resource_id: 'Projects-ID', scope_mode: 'include' }
  { scope_type: 'file',   scope_resource_id: 'old-report-ID', scope_mode: 'exclude' }
```

**Why not Option B (per-file scopes)?**: Converting a folder scope into N individual file scopes (one per included file) loses the delta query benefit and creates scope explosion for large folders.

#### Schema Change

```prisma
model connection_scopes {
  // ... existing fields ...
  scope_mode  String  @default("include") @db.NVarChar(20)
  // CHECK: scope_mode IN ('include', 'exclude')
}
```

### 3.2 Tri-State Checkbox Logic

Each item in the wizard's folder/file tree has one of three visual states:

| State | Meaning | Visual |
|-------|---------|--------|
| **Checked** | Item is included (explicitly or inherited from parent) | Filled checkbox |
| **Unchecked** | Item is not selected | Empty checkbox |
| **Indeterminate** | Some children selected, some not | Dash/minus checkbox |

#### Selection Rules

1. **Check a folder** → All descendants become checked (inherit from parent).
2. **Uncheck a child** within a checked folder → Parent becomes indeterminate, child is marked as excluded.
3. **Uncheck a folder** → All descendants become unchecked (exclusions cleared).
4. **Check all children** of an indeterminate parent → Parent becomes checked, exclusions cleared.
5. **Indeterminate is display-only** — users cannot directly set it.

### 3.3 Backend: Sync Engine Changes

#### 3.3.1 Post-Delta Filtering

`InitialSyncService._runSync()` and `IncrementalSyncService` must filter delta results against exclusion scopes:

```typescript
// After fetching delta changes, filter out excluded items
const exclusions = await repo.findExclusionScopes(connectionId, scopeId);
const excludedResourceIds = new Set(exclusions.map(e => e.scope_resource_id));

const filteredFileChanges = fileChanges.filter(
  (c) => !excludedResourceIds.has(c.item.id)
);
```

#### 3.3.2 Exclusion Scope Resolution

New method in `ConnectionRepository`:

```typescript
async findExclusionScopes(connectionId: string, parentScopeId: string): Promise<ConnectionScope[]> {
  return prisma.connection_scopes.findMany({
    where: {
      connection_id: connectionId,
      scope_mode: 'exclude',
      // Exclusions are associated with the parent include scope
      // via a new parent_scope_id column, or by matching scope_path prefix
    },
  });
}
```

#### 3.3.3 Cleanup on Exclusion Add

When a user adds an exclusion to an already-synced scope:
1. Find the file record matching the excluded `scope_resource_id`
2. Run `ScopeCleanupService` logic for that single file (null citations, delete embeddings, delete file)
3. Create the `exclude` scope record

### 3.4 Frontend: Wizard Tree with Inheritance

#### 3.4.1 Selection State Store

New store or extension of `ConnectionWizard` state:

```typescript
interface TreeSelectionState {
  // Map of external item ID → explicit selection state
  // Items not in the map inherit from their parent
  explicitSelections: Map<string, 'include' | 'exclude'>;
}

// Derived computation:
function getEffectiveState(itemId: string, parentId: string | null): 'checked' | 'unchecked' | 'indeterminate' {
  const explicit = explicitSelections.get(itemId);
  if (explicit === 'include') return 'checked';
  if (explicit === 'exclude') return 'unchecked';

  // Inherit from parent
  if (parentId) return getEffectiveState(parentId, getParentOf(parentId));

  return 'unchecked'; // Root-level default
}
```

#### 3.4.2 Indeterminate Computation

A folder is indeterminate when:
- It is checked (explicitly or inherited), AND
- At least one descendant is explicitly excluded, AND
- At least one descendant is NOT excluded (still included)

This requires knowing the children of each folder, which is available from the browse tree already loaded in the wizard.

#### 3.4.3 Visual Indicators

| State | Checkbox | Badge |
|-------|----------|-------|
| All children synced | Filled green | "Synced · N files" (existing) |
| Some children excluded | Filled amber | "Partial · N of M files" |
| Not synced | Empty | — |
| Newly selected | Filled blue | "Will sync" (existing) |

### 3.5 API Changes

#### Batch Scopes Enhancement

`POST /api/connections/:id/scopes/batch` — extend `ScopeBatchInput`:

```typescript
interface ScopeBatchInput {
  add: Array<{
    scopeType: 'folder' | 'file';
    scopeResourceId: string;
    scopeDisplayName: string;
    scopePath?: string;
    scopeMode?: 'include' | 'exclude';  // NEW — defaults to 'include'
  }>;
  remove: string[];  // scope IDs
}
```

#### Scopes Response Enhancement

`GET /api/connections/:id/scopes` — include `scopeMode` in response:

```typescript
interface ConnectionScopeWithStats {
  // ... existing fields ...
  scopeMode: 'include' | 'exclude';  // NEW
}
```

---

## 4. Detailed Specifications

### 4.1 New/Modified Files

#### Backend

| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | Add `scope_mode` column to `connection_scopes` |
| `backend/src/domains/connections/ConnectionRepository.ts` | Add `findExclusionScopes()`, update `findScopesWithFileCounts()` to include `scope_mode` |
| `backend/src/domains/connections/ConnectionService.ts` | Handle `scopeMode` in batch operations |
| `backend/src/services/sync/InitialSyncService.ts` | Post-delta exclusion filtering |
| `backend/src/services/sync/IncrementalSyncService.ts` | Post-delta exclusion filtering (same pattern) |
| `backend/src/services/sync/ScopeCleanupService.ts` | Single-file cleanup when adding exclusion to synced scope |
| `backend/src/routes/connections.ts` | Pass `scopeMode` through batch endpoint |
| `packages/shared/src/types/connection.types.ts` | Add `scopeMode` to scope types |
| `packages/shared/src/schemas/onedrive.schemas.ts` | Update `batchScopesSchema` with `scopeMode` |

#### Frontend

| File | Change |
|------|--------|
| `frontend/components/connections/ConnectionWizard.tsx` | Tri-state checkbox logic, inheritance computation, indeterminate state |
| `frontend/components/connections/ScopeDiffView.tsx` | Show exclusions in diff view |
| `frontend/components/files/FolderTree.tsx` | Partial sync amber badge on folders |

### 4.2 Schema Migration

```sql
-- Add scope_mode column
ALTER TABLE connection_scopes
  ADD scope_mode NVARCHAR(20) NOT NULL
  CONSTRAINT DF_connection_scopes_scope_mode DEFAULT 'include';

-- Add CHECK constraint
ALTER TABLE connection_scopes
  ADD CONSTRAINT CK_connection_scopes_scope_mode
  CHECK (scope_mode IN ('include', 'exclude'));
```

Backwards compatible: all existing scopes default to `'include'`, preserving current behavior.

### 4.3 Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Exclusion model (not per-file scopes) | Preserves delta query efficiency; folder scope + exclusions is O(exclusions), not O(files) |
| D2 | `scope_mode` column (not separate table) | Simpler query; exclusions are rare compared to includes; same lifecycle as scopes |
| D3 | Post-delta filtering (not Graph API filter) | Microsoft Graph delta doesn't support item-level exclusions; filtering must happen locally |
| D4 | Explicit selections map (not derived from DOM) | Decouples selection state from tree rendering; enables serialization for wizard persistence |
| D5 | Indeterminate is computed, not stored | Reduces state complexity; derived from explicit selections + tree structure |

---

## 5. Edge Cases

### 5.1 Large Folder Exclusions
If a user excludes 80% of files in a folder, the system still syncs the full delta and filters locally. For very large folders with many exclusions, performance may degrade. **Mitigation**: Show a warning when exclusion count exceeds a threshold (e.g., 50) suggesting the user create individual file scopes instead.

### 5.2 New Files in Partially-Excluded Folders
When a new file appears in OneDrive within a partially-excluded folder:
- **Default behavior**: New files are included (inherit from parent `include` scope).
- **User expectation**: This is correct — only explicitly excluded items are excluded.
- Incremental sync must check against exclusion set for new files too.

### 5.3 Folder Exclusion (Not Just Files)
Users may want to exclude a subfolder (e.g., "sync Projects/ but exclude Projects/Archive/"). This works naturally with the exclusion model — a folder-type exclusion scope prevents sync of that entire subtree.

### 5.4 Migration from Existing Scopes
Existing `connection_scopes` records get `scope_mode = 'include'` automatically (default value). No data migration needed. The wizard will show existing behavior until users start using exclusions.

---

## 6. Success Criteria

- [ ] Selecting a parent folder auto-selects all visible children in the wizard
- [ ] Deselecting a child within a selected parent shows parent as indeterminate
- [ ] Unchecking a parent unchecks all descendants
- [ ] Checking all children of an indeterminate parent clears exclusions
- [ ] Partial sync badge (amber) shown on folders with exclusions
- [ ] Exclusion scopes persisted to DB with `scope_mode = 'exclude'`
- [ ] Sync engine filters out excluded items from delta results
- [ ] Adding an exclusion to an already-synced scope removes the excluded file
- [ ] Re-opening wizard reconstructs full inheritance tree from stored scopes
- [ ] Diff view (PRD-105) correctly shows new exclusions
- [ ] New files in partially-excluded folders are synced by default
- [ ] Backwards compatible: existing scopes work unchanged
- [ ] Type-check and lint pass
- [ ] Unit tests for tri-state logic, exclusion filtering, and scope cleanup

---

## 7. Verification

```bash
# Type-check
npm run build:shared && npm run verify:types

# Backend build
npm run -w backend build

# Unit tests
npm run -w backend test:unit -- -t "ScopeExclusion"
npm run -w backend test:unit -- -t "TriStateSelection"

# Lint
npm run -w backend lint
npm run -w bc-agent-frontend lint
```

---

## 8. Out of Scope

- Drag-and-drop scope reordering
- Scope templates ("sync all Excel files", "exclude all images")
- Regex-based exclusion patterns (e.g., `*.tmp`)
- Sync scheduling (time-based sync windows)
- Cross-connector scope inheritance (SharePoint + OneDrive unified tree)
- Conflict resolution when an excluded file is referenced in a chat citation

---

## 9. Relationship to Other PRDs

| PRD | Relationship |
|-----|-------------|
| PRD-105 | **Builds on**: Scope pre-selection, diff view, batch API — all extended with exclusion support |
| PRD-107 | **Builds on**: Folder hierarchy storage — required for parent-child resolution in the wizard |
| PRD-108 | **Interacts**: Webhook sync must respect exclusions when processing incremental changes |
| PRD-110 | **Before**: Shared files browsing will benefit from the same selection inheritance UX |
| PRD-111 | **Before**: SharePoint connection will reuse the same tri-state selection model |
