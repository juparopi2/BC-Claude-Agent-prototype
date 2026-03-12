# PRD-115: SharePoint Scope Selection Inheritance

**Phase**: SharePoint UX
**Status**: Implemented
**Prerequisites**: PRD-111 (SharePoint Backend), PRD-112 (OneDrive Scope Inheritance — reference implementation)
**Estimated Effort**: 1-2 days frontend, 0.5 day testing
**Created**: 2026-03-12
**Completed**: 2026-03-12

---

## 1. Objective

Bring the SharePoint wizard to feature parity with OneDrive's tri-state scope selection. Previously, SharePoint used simple on/off toggles per folder, while OneDrive implemented full include/exclude cascade with parent-child inheritance and a "Sync All" toggle.

---

## 2. Previous State (Before Implementation)

### OneDrive (ConnectionWizard.tsx)
- `getEffectiveCheckState()` inlined as a ~30-line `useCallback`
- `handleToggleSelect` inlined as a ~60-line `useCallback`
- `handleSyncAll` inlined as a ~10-line `useCallback`
- Tri-state checkboxes: checked, unchecked, indeterminate
- Parent selection cascades to all children
- Child deselection creates exclude scopes for descendants
- "Sync All" toggle at root level

### SharePoint (SharePointWizard.tsx)
- Simple `Set<string>` toggles for libraries (`selectedLibraries`)
- Simple `Map<string, FolderInfo>` toggles for folders (`selectedFolders`)
- No cascade: selecting a library did NOT auto-select subfolders
- No exclude scopes: only include mode supported in UI
- No "Sync All" toggle

---

## 3. Implementation

### Approach

Extracted pure tri-state selection logic into `wizard-utils.ts`, wrapped it in a reusable `useTriStateSelection` hook, and refactored both wizards to use it.

### Key Design Decisions

1. **`NodeInfo` abstraction**: A provider-agnostic `NodeInfo` interface (`id`, `parentId`, `isFolder`, `childIds`) decouples the selection logic from tree structure differences between OneDrive (`TreeNodeData` in flat maps) and SharePoint (`siteLibraries` nested map).

2. **`findNode` injection**: Each wizard provides a `findNodeForHook` adapter callback that bridges its tree structure to `NodeInfo`. This is the only connector-specific code.

3. **SharePoint `parentId` mapping**: Root-level folders in SharePoint libraries have `parentId: null` in `ExternalFileItem`. The SharePoint adapter maps these to `parentId: lib.driveId` so cascade inheritance flows correctly from library → folders.

4. **Exclusion priority over Sync All**: A bug fix was applied during implementation — `getEffectiveCheckState` now returns `false` for nodes inside an excluded subtree, preventing "Sync All" from overriding explicit exclusions on descendants. This fix benefits both wizards.

5. **`isSupported` guard in hook**: The `toggleSelect` function in the hook includes the `isSupported === false` guard internally, keeping call sites clean.

### Files Changed

| File | Action | Description |
|------|--------|-------------|
| `frontend/components/connections/wizard-utils.ts` | Modified | Added `ExplicitSelection`, `SYNC_ALL_KEY`, `NodeInfo` types + `getEffectiveCheckState`, `computeToggleSelect`, `computeSyncAllToggle` pure functions |
| `frontend/components/connections/useTriStateSelection.ts` | **Created** | Reusable React hook wrapping pure functions with `useState`/`useCallback` |
| `frontend/components/connections/ConnectionWizard.tsx` | Modified | Removed ~80 lines of inlined tri-state logic, replaced with hook call (~15 lines added) |
| `frontend/components/connections/SharePointWizard.tsx` | Modified | Replaced `selectedLibraries`/`selectedFolders` with tri-state hook; added "Sync All" toggle; rewrote scope generation with include/exclude support |
| `frontend/__tests__/components/connections/TriStateSelection.test.ts` | Modified | Imports shared function from `wizard-utils.ts`; added 8 SharePoint-specific test cases |

### Architecture

```
wizard-utils.ts (pure functions)
  ├── getEffectiveCheckState()    — recursive check state computation
  ├── computeToggleSelect()       — toggle logic (check/uncheck with cascade)
  └── computeSyncAllToggle()      — Sync All toggle logic

useTriStateSelection.ts (React hook)
  ├── wraps pure functions with useState + useCallback
  ├── returns: explicitSelections, isSyncAll, getCheckState, toggleSelect,
  │            toggleSyncAll, setExplicitSelections, reset
  └── accepts: findNode callback (connector-specific adapter)

ConnectionWizard.tsx (OneDrive)
  ├── findNodeForHook: nodeMap/sharedNodeMap → NodeInfo
  └── uses useTriStateSelection hook

SharePointWizard.tsx (SharePoint)
  ├── findNodeForHook: siteLibraries → NodeInfo (maps parentId: null → lib.driveId)
  ├── uses useTriStateSelection hook
  ├── "Sync All" toggle button in Step 3
  └── buildAndTriggerSync with include/exclude scope generation
```

---

## 4. Reference Files

| File | Purpose |
|---|---|
| `frontend/components/connections/wizard-utils.ts` | Shared types + pure tri-state selection functions |
| `frontend/components/connections/useTriStateSelection.ts` | Shared React hook |
| `frontend/components/connections/ConnectionWizard.tsx` | OneDrive wizard (uses hook) |
| `frontend/components/connections/SharePointWizard.tsx` | SharePoint wizard (uses hook) |
| `frontend/__tests__/components/connections/TriStateSelection.test.ts` | Unit tests for both OneDrive and SharePoint trees |
| `packages/shared/src/schemas/onedrive.schemas.ts` | `batchScopesSchema` (already supports `scopeMode`) |

---

## 5. Success Criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Selecting a library auto-selects all its subfolders | Done |
| 2 | Deselecting a subfolder within a selected library creates an exclude scope | Done |
| 3 | Tri-state checkbox shows indeterminate when partially selected | Done |
| 4 | "Sync All" toggle selects all libraries across all sites | Done |
| 5 | Both OneDrive and SharePoint wizards share the same selection logic via hook | Done |
| 6 | No regression in OneDrive wizard behavior | Done |

---

## 6. Verification

```bash
# Tri-state tests (22 pass: 14 OneDrive + 8 SharePoint)
npm run -w bc-agent-frontend test -- -t "Tri-State"

# Type check (clean)
npm run verify:types

# Frontend lint (0 errors)
npm run -w bc-agent-frontend lint
```

### Manual Testing Checklist

**OneDrive regression** (ConnectionWizard):
- [ ] Select folder → children inherit checked
- [ ] Deselect child → parent shows indeterminate
- [ ] Sync All → all checked
- [ ] Sync All + exclude child → child unchecked, rest checked
- [ ] Reopen wizard → pre-populated correctly
- [ ] Save & Sync generates correct API payload

**SharePoint new behavior** (SharePointWizard):
- [ ] Select library → all subfolders show checked (when expanded)
- [ ] Deselect subfolder → library shows indeterminate
- [ ] Sync All → all libraries and folders checked
- [ ] Sync All + exclude library → library unchecked
- [ ] Sync All + exclude folder → folder unchecked, library indeterminate
- [ ] Reopen wizard → pre-populated from include/exclude scopes
- [ ] Save & Sync generates correct include/exclude payload
- [ ] Back to sites (Step 2) preserves selections
