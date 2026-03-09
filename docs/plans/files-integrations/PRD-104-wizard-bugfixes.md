# PRD-104: OneDrive Connection Wizard — Bug Fixes

**Phase**: OneDrive (Post PRD-101)
**Status**: Planned
**Prerequisites**: PRD-101 (Implemented)
**Estimated Effort**: 0.5–1 day
**Created**: 2026-03-09

---

## 1. Objective

Fix 5 confirmed bugs in the OneDrive ConnectionWizard that degrade the user experience. All issues are low-complexity, isolated to specific files, and can be resolved in a single batch without architectural changes.

---

## 2. Bug Inventory

### Bug 1: Folder Cannot Be Collapsed After Expanding

**Severity**: High (broken interaction)
**File**: `frontend/components/connections/ConnectionWizard.tsx`
**Lines**: 365, 410–426

**Symptom**: Once a folder is expanded in the "Select folders to sync" tree, clicking the chevron does not collapse it. Instead, it re-fetches and re-opens.

**Root Cause**: Stale `nodeMap` reference. When children are fetched (lines 410–426), the `setNodeMap` call adds **child nodes** but does NOT update the **parent node**. The parent entry in `nodeMap` still has `children: null`.

On the next click:
1. `nodeMap.get(itemId)` retrieves the stale parent with `children: null`
2. The condition `if (node.children !== null)` (line 369) fails
3. Code falls through to the fetch-and-expand branch instead of toggle

**Fix**: After setting children on the tree, also update the parent node in `nodeMap`:
```typescript
setNodeMap((prev) => {
  const next = new Map(prev);
  // Update parent node with loaded children
  const updatedParent = findNode(/* current tree */, itemId);
  if (updatedParent) next.set(itemId, updatedParent);
  // Add child nodes
  for (const child of children) {
    next.set(child.item.id, child);
  }
  return next;
});
```

**Alternative approach**: Instead of looking up `nodeMap` for the children check, always use `findNode()` on the current tree state (which IS updated correctly). This eliminates the stale reference problem entirely.

---

### Bug 2: Modal Shows "Sign In" for Already-Connected Users

**Severity**: High (confusing flow)
**File**: `frontend/components/layout/RightPanel.tsx` (line 127) + `frontend/components/connections/ConnectionWizard.tsx` (lines 199, 255–261)

**Symptom**: When a user clicks a ConnectionCard with `status='connected'`, the wizard opens at Step 1 ("Sign in with your Microsoft account") instead of Step 2 ("Select folders to sync").

**Root Cause**: `RightPanel.tsx` line 127 calls `openWizard(providerId)` without passing the existing connection ID. The wizard defaults `step` to `'connect'` (line 199) and only advances to `'browse'` if `initialConnectionId` is provided (lines 255–261). That prop is only set from the OAuth callback URL query params — never from a card click.

**Fix**: In `RightPanel.tsx`, when a connected card is clicked, look up the existing connection ID from the `integrationListStore` and pass it to the wizard:
```typescript
onClick={() => {
  const existingConnection = connections.find(
    (c) => c.provider === providerId && c.status === CONNECTION_STATUS.CONNECTED
  );
  if (existingConnection) {
    setInitialConnectionId(existingConnection.id);
  }
  openWizard(providerId);
}}
```

---

### Bug 3: Button Label Says "Connected" Instead of "Configure"

**Severity**: Low (UX clarity)
**File**: `frontend/src/domains/integrations/components/ConnectionCard.tsx` (line 27)

**Symptom**: The badge on a connected card reads "Connected" (status indicator) rather than "Configure" (action indicator). Since the card is clickable and opens configuration, the label is misleading.

**Root Cause**: Static label mapping:
```typescript
connected: { label: 'Connected', variant: 'default' }
```

**Fix**: Change to:
```typescript
connected: { label: 'Configure', variant: 'default' }
```

---

### Bug 4: Subtitle References "AI Search" Instead of Agent Name

**Severity**: Low (copy consistency)
**File**: `frontend/components/connections/ConnectionWizard.tsx` — browse step header

**Symptom**: The browse step says "Choose which OneDrive folders to make available for AI search". Should reference the RAG agent's display name.

**Root Cause**: Hardcoded text instead of using shared constants.

**Fix**: Import from `@bc-agent/shared` and interpolate:
```typescript
import { AGENT_DISPLAY_NAME, AGENT_ID } from '@bc-agent/shared';

// In the browse step:
`Choose which OneDrive folders to make available for the ${AGENT_DISPLAY_NAME[AGENT_ID.RAG_AGENT]} agent`
// Result: "Choose which OneDrive folders to make available for the Knowledge Base Expert agent"
```

---

### Bug 5: "Empty Folder" Shown for Folders Containing Only Files

**Severity**: Medium (misleading)
**File**: `frontend/components/connections/ConnectionWizard.tsx` (lines 168–174, 400–408)

**Symptom**: Expanding a folder that contains files but no subfolders shows "Empty folder" text.

**Root Cause**: Lines 400–401 filter results to only keep subfolders:
```typescript
const subFolders = data.items.filter((i) => i.isFolder)
```
If a folder has 10 PDFs and 0 subfolders, `subFolders.length === 0`, and the UI renders "Empty folder" (lines 168–174).

**Fix**: Two options depending on PRD-105 (file browsing) timeline:

**Option A** (minimal, standalone): Change the "Empty folder" message to account for files:
```typescript
// After fetching data.items
const totalItems = data.items.length;
const subFolders = data.items.filter((i) => i.isFolder);
// Store totalItems count for display

// In render:
{node.children.length === 0 ? (
  <div className="...">
    {node.totalItemCount > 0
      ? `${node.totalItemCount} file(s) — select parent folder to sync`
      : 'Empty folder'}
  </div>
) : (/* render children */)}
```

**Option B** (if PRD-105 ships first): Files will be rendered in the tree, making the "Empty folder" message naturally correct.

**Recommendation**: Implement Option A now. It is standalone and communicates the presence of files even before PRD-105 adds file-level browsing.

---

## 3. Implementation Order

All 5 fixes are independent and can be done in any order. Recommended sequence by impact:

1. **Bug 1** (collapse) — highest user impact, broken interaction
2. **Bug 2** (modal step) — confusing flow for returning users
3. **Bug 5** (empty folder) — misleading information
4. **Bug 3** (button label) — trivial 1-line change
5. **Bug 4** (subtitle text) — trivial import + interpolation

---

## 4. Affected Files

| File | Bugs |
|---|---|
| `frontend/components/connections/ConnectionWizard.tsx` | #1, #4, #5 |
| `frontend/components/layout/RightPanel.tsx` | #2 |
| `frontend/src/domains/integrations/components/ConnectionCard.tsx` | #3 |

Total: 3 files modified. No backend changes. No new files.

---

## 5. Testing

- Bug 1: Expand folder → click chevron → verify it collapses. Repeat 3x.
- Bug 2: Have a connected OneDrive → click card → verify wizard opens at Step 2.
- Bug 3: Visual check — badge reads "Configure".
- Bug 4: Visual check — subtitle mentions "Knowledge Base Expert agent".
- Bug 5: Expand a folder that has files but no subfolders → verify it shows file count, not "Empty folder".

---

## 6. Success Criteria

- [ ] Folders can be expanded AND collapsed in the tree (toggle works)
- [ ] Connected users see folder picker directly (skip authentication step)
- [ ] Badge text says "Configure" for connected providers
- [ ] Subtitle uses agent display name from `@bc-agent/shared`
- [ ] Folders with only files show accurate item count instead of "Empty folder"
- [ ] All existing frontend tests pass
- [ ] `npm run -w bc-agent-frontend lint` passes
