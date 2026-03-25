# PRD-301: Scope Selection UX Fix

**Last Updated**: 2026-03-25
**Effort**: Small (S)
**Dependencies**: None

## Problem Statement

Users cannot deselect all synced folders in the ConnectionWizard. When a user unchecks every folder during reconfiguration, the wizard silently closes without saving changes, leaving all scopes intact.

## Root Cause Analysis

**File**: `frontend/components/connections/ConnectionWizard.tsx`, line 1137

```typescript
const hasChanges = explicitSelections.size > 0 || values.some((s) => s.status === 'new' || s.status === 'removed')
```

When the user unchecks all folders:
1. `explicitSelections` map becomes empty (all entries removed by toggle logic)
2. `explicitSelections.size > 0` evaluates to `false`
3. `selectedScopes` values still have `status: 'existing'` (never transitioned to 'removed')
4. `values.some(s => s.status === 'new' || s.status === 'removed')` evaluates to `false`
5. `hasChanges = false` → wizard calls `onClose()` without saving

**Backend is NOT the issue**: `batchScopesSchema` in `packages/shared/src/schemas/onedrive.schemas.ts` (line 43-61) allows remove-only operations. The refinement only requires at least one operation (add OR remove).

## Solution

### Step 1: Extract `computeScopeDiff()` utility

Create a shared function (in `frontend/components/connections/wizard-utils.ts` or adjacent) that computes the diff between existing scopes and current explicit selections. This is the same logic already in `buildAndTriggerSync()` (lines 881-894) but extracted for reuse.

```typescript
function computeScopeDiff(
  existingScopes: ConnectionScopeDetail[],
  explicitSelections: Map<string, ExplicitSelection>,
  isSyncAll: boolean,
  findNodeInMaps: (id: string) => TreeNode | undefined
): { toAdd: ScopeInput[], toRemove: string[] }
```

### Step 2: Fix `hasChanges` detection

Replace line 1137 with:
```typescript
const { toAdd, toRemove } = computeScopeDiff(existingScopes, explicitSelections, isSyncAll, findNodeInMaps)
const hasChanges = toAdd.length > 0 || toRemove.length > 0
```

### Step 3: Update `buildAndTriggerSync()` to use `computeScopeDiff()`

Refactor lines 840-894 to call the extracted function, eliminating code duplication.

### Step 4: Add remove-all warning in ScopeDiffView

In `frontend/components/connections/ScopeDiffView.tsx`, when `toRemove.length > 0 && toAdd.length === 0`, show a clear warning:
- "All synced folders will be removed. Files and embeddings will be deleted."
- Use destructive/warning styling

### Step 5: Handle zero-scope connection state

A connection with 0 scopes should:
- Remain in 'connected' status (valid state)
- Show "0 folders synced" in the connection card
- Allow user to re-open wizard and add scopes later

No backend changes needed for this — the connection model already supports zero scopes.

## Files to Modify

| File | Change |
|------|--------|
| `frontend/components/connections/ConnectionWizard.tsx` | Extract `computeScopeDiff`, fix `hasChanges` logic (line 1137) |
| `frontend/components/connections/wizard-utils.ts` | New `computeScopeDiff()` function |
| `frontend/components/connections/ScopeDiffView.tsx` | Add warning for remove-all case |

## Success Criteria

- [ ] User can deselect all folders in reconfiguration mode and click "Save Changes"
- [ ] ScopeDiffView shows all removals with a warning message
- [ ] All files and embeddings are deleted when confirmed
- [ ] Connection stays in 'connected' state with 0 scopes
- [ ] User can re-open wizard and add new scopes
- [ ] No backend changes needed
- [ ] Button disabled logic (line 1133) remains correct for initial setup (non-reconfiguring) mode

## Out of Scope
- Changing the initial setup flow (non-reconfiguring mode correctly requires min 1 scope)
- Backend validation changes
