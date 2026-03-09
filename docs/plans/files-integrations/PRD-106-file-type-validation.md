# PRD-106: File Type Validation & Pipeline Guard

**Phase**: OneDrive Enhancement
**Status**: TODO
**Prerequisites**: PRD-105 (Scope Management)
**Estimated Effort**: 1–2 days
**Created**: 2026-03-09

---

## 1. Objective

Add file type validation to the browse and sync pipeline. Unsupported file types (e.g., `.zip`, `.exe`, `.ech`) should be visually distinguished in the Connection Wizard and prevented from entering the RAG processing pipeline.

This was originally Phase 2 of the old PRD-105 (File-Level Browsing & Type Validation). Phase 1 (file visibility and selection) was completed as PRD-103. This PRD covers the remaining type validation work.

---

## 2. Current State (After PRD-103/105)

- Files are visible in the Connection Wizard folder tree (PRD-103)
- All files are selectable regardless of type — no validation
- Unsupported files (e.g., `.ech`) enter the pipeline and fail at the extraction stage
- No shared utility to check file type support
- Supported file types are defined in `@bc-agent/shared` (`SUPPORTED_FILE_TYPES`, `SUPPORTED_EXTENSIONS_DISPLAY` in `constants/file-type-categories.ts`) but not used for sync filtering

---

## 3. Expected State (After PRD-106)

### Browse Step Validation
- Unsupported files appear grayed out (reduced opacity) with no checkbox
- Tooltip on hover: "Unsupported file type. Supported: PDF, DOCX, XLSX, PPTX, CSV, TXT, MD, JPG, PNG, GIF, WebP, SVG, BMP, TIFF, JSON, JS, HTML, CSS"
- Supported files appear normal with selectable checkbox
- Folder selection includes all supported files within it (unsupported auto-excluded)

### Pipeline Guard
- `isFileSyncSupported()` shared utility checks MIME type against supported list
- Backend `InitialSyncService` skips unsupported files during sync
- Browse API response includes `isSupported: boolean` field per item
- Defense in depth: pipeline workers also check before processing

---

## 4. Detailed Specifications

### 4.1 Shared Utility

**New file**: `packages/shared/src/utils/file-support.ts`

```typescript
import { SUPPORTED_MIME_TYPES } from '../constants/file-type-categories';

/**
 * Check if a file's MIME type is supported for sync and RAG processing.
 * Uses the shared SUPPORTED_MIME_TYPES constant as single source of truth.
 */
export function isFileSyncSupported(mimeType: string | undefined | null): boolean {
  if (!mimeType) return false;
  return SUPPORTED_MIME_TYPES.includes(mimeType);
}
```

Export from `packages/shared/src/utils/index.ts` and `packages/shared/src/index.ts`.

### 4.2 Backend — Browse API Enhancement

**File**: `backend/src/routes/connections.ts`

Add `isSupported` field to browse response items:

```typescript
const items = data.items.map(item => ({
  ...item,
  isSupported: item.isFolder ? true : isFileSyncSupported(item.mimeType),
}));
```

### 4.3 Backend — Sync Filter

**File**: `backend/src/services/sync/InitialSyncService.ts`

Add file type check before creating/upserting file records:

```typescript
// Skip unsupported file types
if (!item.isFolder && !isFileSyncSupported(item.mimeType)) {
  this.logger.info(
    { name: item.name, mimeType: item.mimeType },
    'Skipping unsupported file type during sync'
  );
  continue;
}
```

### 4.4 Frontend — Unsupported File Visual

**File**: `frontend/components/connections/ConnectionWizard.tsx`

For files where `isSupported === false`:
- Reduce opacity to 0.5
- Remove checkbox (or show disabled checkbox)
- Add tooltip with supported types message
- Use `text-muted-foreground` color class

### 4.5 Frontend — Folder Selection Behavior

When a folder is selected, the selection logic should:
1. Select the folder itself (creates a folder scope)
2. Visually indicate that unsupported files within it won't be synced
3. Show count: "X supported files (Y unsupported excluded)"

---

## 5. Affected Files

### New Files
| File | Purpose |
|------|---------|
| `packages/shared/src/utils/file-support.ts` | `isFileSyncSupported()` utility |
| `packages/shared/src/__tests__/file-support.test.ts` | Unit tests |

### Modified Files
| File | Change |
|------|--------|
| `frontend/components/connections/ConnectionWizard.tsx` | Unsupported file visual state, tooltip |
| `backend/src/routes/connections.ts` | `isSupported` field in browse response |
| `backend/src/services/sync/InitialSyncService.ts` | Skip unsupported MIME types |
| `packages/shared/src/utils/index.ts` | Export new utility |
| `packages/shared/src/index.ts` | Re-export |

---

## 6. UI Mockup (Text)

```
▼ 📁 Documents                              ☑
    📄 report-2026.pdf         2.3 MB   ☑
    📄 budget.xlsx             890 KB   ☑
    📄 notes.txt               12 KB    ☑
    📄 backup.zip              45 MB    ⊘  (grayed, tooltip: "Unsupported...")
    📄 config.ech              1 KB     ⊘  (grayed, tooltip: "Unsupported...")
  ▶ 📁 Invoices                              ☐
```

---

## 7. Success Criteria

- [ ] `isFileSyncSupported()` correctly validates all supported MIME types
- [ ] Browse API includes `isSupported` field
- [ ] Unsupported files are grayed out with tooltip in wizard
- [ ] Unsupported files cannot be individually selected
- [ ] Sync skips unsupported file types (no pipeline entry)
- [ ] Supported files sync normally
- [ ] Unit tests for `isFileSyncSupported()` cover all supported + common unsupported types
- [ ] All existing tests pass
- [ ] Type-check and lint pass

---

## 8. Out of Scope

- File size limits (maximum file size for sync)
- Password-protected file detection
- File content validation (only MIME type check)
- Custom user-configurable file type filters
