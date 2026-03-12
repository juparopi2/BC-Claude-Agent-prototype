# PRD-115: SharePoint Scope Selection Inheritance

**Phase**: SharePoint UX
**Status**: Proposed
**Prerequisites**: PRD-111 (SharePoint Backend), PRD-112 (OneDrive Scope Inheritance — reference implementation)
**Estimated Effort**: 1-2 days frontend, 0.5 day testing
**Created**: 2026-03-12

---

## 1. Objective

Bring the SharePoint wizard to feature parity with OneDrive's tri-state scope selection. Currently, SharePoint uses simple on/off toggles per folder, while OneDrive implements full include/exclude cascade with parent-child inheritance and a "Sync All" toggle.

---

## 2. Current State

### OneDrive (ConnectionWizard.tsx)
- `getEffectiveCheckState()` with recursive traversal (lines 344-380)
- Tri-state checkboxes: checked, unchecked, indeterminate
- Parent selection cascades to all children
- Child deselection creates exclude scopes for descendants
- "Sync All" toggle at root level (lines 712-772)

### SharePoint (SharePointWizard.tsx)
- Simple `Set<string>` toggles for libraries
- Simple `Map<string, FolderInfo>` toggles for folders
- No cascade: selecting a library does NOT auto-select subfolders
- No exclude scopes: only include mode supported in UI
- No "Sync All" toggle

---

## 3. Proposed Approach

Extract a generic `useTriStateSelection` hook from `ConnectionWizard.tsx`, then refactor both wizards to use it.

### Key Differences vs OneDrive
- SharePoint has a **two-level selection model**: sites → libraries → folders
- OneDrive has a **flat tree**: root → folders (single drive)
- The hook must handle SharePoint's site→library→folder hierarchy
- Library-level selection must cascade to folder-level

### Scope
- **Frontend only** — the backend `scope_mode` include/exclude is already supported in schema and batch API
- No backend changes required

---

## 4. Reference Files

| File | Purpose |
|---|---|
| `frontend/components/connections/ConnectionWizard.tsx` | OneDrive implementation (reference) |
| `frontend/components/connections/SharePointWizard.tsx` | Target for refactoring |
| `frontend/components/connections/wizard-utils.ts` | Shared tree utilities |
| `packages/shared/src/schemas/onedrive.schemas.ts` | `batchScopesSchema` (already supports `scopeMode`) |

---

## 5. Success Criteria

1. Selecting a library auto-selects all its subfolders
2. Deselecting a subfolder within a selected library creates an exclude scope
3. Tri-state checkbox shows indeterminate when partially selected
4. "Sync All" toggle selects all libraries across all sites
5. Both OneDrive and SharePoint wizards share the same selection logic via hook
6. No regression in OneDrive wizard behavior
