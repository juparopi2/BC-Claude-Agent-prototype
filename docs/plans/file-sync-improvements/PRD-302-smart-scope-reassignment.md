# PRD-302: Smart Scope Reassignment

**Last Updated**: 2026-03-25
**Effort**: Medium (M)
**Dependencies**: PRD-301 (same `batchUpdateScopes()` code path)

## Problem Statement

When a user changes their sync configuration from child folder scopes (e.g., level 3 folders) to a parent folder scope (e.g., level 1), the system:
1. Deletes all files from the child scopes (including search index chunks and embeddings)
2. Creates a new parent scope
3. Re-discovers the same files during initial sync
4. Re-downloads, re-chunks, and re-embeds every file

This results in unnecessary API costs (Cohere embedding calls), processing time, and a period where files are unavailable for RAG search.

## Current Behavior (Traced)

```
User clicks "Save Changes" in wizard
  → triggerSyncOperation({ toAdd: [parentScope], toRemove: [childScope1, childScope2] })
    → POST /api/connections/:id/scopes/batch

ConnectionService.batchUpdateScopes():
  Phase 1 (Remove): ScopeCleanupService.removeScope() for each child scope
    → Delete Graph subscription
    → NULL message_citations.file_id
    → Delete search index chunks (VectorSearchService.deleteChunksForFile)
    → Delete all files (FK cascade → file_chunks, image_embeddings)
    → Delete scope record

  Phase 2 (Create): Create parent scope in transaction
    → Set sync_status = 'sync_queued'

  Phase 3 (Enqueue): addInitialSyncJob(parentScope)
    → InitialSyncService._runSync()
      → Delta query returns ALL files (including previously synced ones)
      → All files appear as "new" → full re-processing pipeline
```

**Cost**: N files × (download + text extraction + chunking + Cohere API embedding call)

## Options Evaluated

| Option | Approach | Complexity | Pros | Cons |
|--------|----------|-----------|------|------|
| A. Reassign Before Delete | Move files to new scope before deleting old | M | Preserves all data, simple | Requires overlap detection |
| B. Skip Existing in Sync | During initial sync, skip files already in search | M-L | No deletion flow changes | Brief unavailability gap |
| C. Scope Hierarchy | Parent scope subsumes children | L | Elegant model | Major schema change |

**Recommendation: Option A — Reassign Before Delete**

## Solution: Reassign Before Delete

### Key Insight
Search index chunks are owned by `fileId`, not `scopeId`. If we reassign files to the new scope before deleting the old scope record, all embeddings and search index entries remain intact.

### Step 1: Add overlap detection to `ConnectionService.batchUpdateScopes()`

Before Phase 1 (remove), detect if any removed scope's files are covered by a new scope:

```typescript
function detectOverlaps(
  toRemove: ConnectionScope[],
  toAdd: ScopeInput[]
): Map<string, string>  // oldScopeId → matching new scope input index
```

Overlap criteria (same connection):
- New scope's `scopePath` is a prefix of old scope's `scopePath` (parent covers child)
- OR new scope's `scopeResourceId` equals old scope's parent folder
- Both are `include` mode

### Step 2: New method `ScopeCleanupService.reassignScopeFiles()`

```typescript
async reassignScopeFiles(
  oldScopeId: string,
  newScopeId: string,
  userId: string
): Promise<{ filesReassigned: number }>
```

1. `UPDATE files SET connection_scope_id = :newScopeId WHERE connection_scope_id = :oldScopeId AND deletion_status IS NULL`
2. `UPDATE files SET parent_folder_id = NULL WHERE connection_scope_id = :newScopeId AND is_folder = true` (folder hierarchy will be rebuilt by InitialSync)
3. Delete old scope's Graph subscription via `SubscriptionManager.deleteSubscription()`
4. NULL out old scope's message_citations (same as removeScope)
5. Delete old scope record (no FK cascade needed since files were moved)

### Step 3: Modified flow in `batchUpdateScopes()`

```
Phase 0 (NEW): Detect overlapping scopes
  overlaps = detectOverlaps(toRemoveScopes, input.add)

Phase 1: Process non-overlapping removes (unchanged)
  for scopeId NOT in overlaps → ScopeCleanupService.removeScope()

Phase 1b (NEW): Process overlapping scopes
  for scopeId IN overlaps:
    1. Create new scope first (needs ID for reassignment)
    2. ScopeCleanupService.reassignScopeFiles(oldScopeId, newScopeId)
    3. Remove from Phase 2 creation list (already created)

Phase 2: Create remaining scopes (unchanged)
Phase 3: Enqueue sync jobs (unchanged — InitialSync dedup handles reassigned files)
```

### Step 4: InitialSync dedup verification

The existing dedup logic in `InitialSyncService` (line ~309-330) already handles this correctly:
```typescript
const existing = await tx.files.findFirst({
  where: { connection_id: connectionId, external_id: item.id },
  select: { id: true, pipeline_status: true },
});
if (existing) {
  // Update metadata only — skip re-processing
}
```
Reassigned files have the same `connection_id` + `external_id`, so they'll be found and skipped.

## Files to Modify

| File | Change |
|------|--------|
| `backend/src/domains/connections/ConnectionService.ts` | Add overlap detection in `batchUpdateScopes()`, route to reassign vs delete |
| `backend/src/services/sync/ScopeCleanupService.ts` | Add `reassignScopeFiles()` method |

## Migration Strategy
No schema migration needed. `connection_scope_id` already supports reassignment. All data preserved in place.

## Success Criteria

- [ ] Changing child scopes → parent scope preserves existing files
- [ ] No re-download, re-chunking, or re-embedding for pre-existing files
- [ ] New files in parent scope (not previously in child scopes) are processed normally
- [ ] File count matches after transition (no duplicates, no missing files)
- [ ] Search results remain functional during transition (no gap in RAG availability)
- [ ] Message citations remain linked to files (not nulled out for reassigned files)
- [ ] Unit tests for: overlap detection logic, reassignScopeFiles(), modified batchUpdateScopes() flow

## Edge Cases

1. **Partial overlap**: Parent covers some children but not all → reassign overlapping, delete non-overlapping
2. **Child to child replacement**: Moving from folder A children to folder B children (no hierarchy overlap) → normal delete+create
3. **Reverse: parent to children**: Removing parent scope, adding child scopes → files in child folder ranges reassigned, files outside children deleted
4. **Concurrent sync**: Old scope is currently 'syncing' → ScopeCurrentlySyncingError blocks reassignment (same guard as delete)
5. **Files in failed state**: Reassigned as-is, remain failed in new scope (health check can retry them later)

## Out of Scope
- Cross-connection scope overlap detection
- Frontend visual indicator of "reassigned vs new" files
- Automatic scope consolidation suggestions
