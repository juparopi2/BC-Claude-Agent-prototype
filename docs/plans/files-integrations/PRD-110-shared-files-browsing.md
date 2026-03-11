# PRD-110: OneDrive "Shared With Me" Browsing & Sync

**Phase**: OneDrive Enhancement
**Status**: COMPLETED
**Prerequisites**: PRD-107 (OneDrive UX Polish)
**Estimated Effort**: 3–4 days
**Created**: 2026-03-09

---

## 1. Objective

Enable users to browse and sync files that have been shared with them in OneDrive, in addition to their personal "My Files". This fills a significant gap: in organizational environments, many critical documents are shared between colleagues rather than stored individually.

---

## 2. Current State (After PRD-107)

- The Connection Wizard only browses the user's personal drive via `/drives/{driveId}/root/children`
- No support for the Microsoft Graph `/me/drive/sharedWithMe` endpoint
- No UI distinction between "My Files" and "Shared with me"
- `OneDriveService.listFolder()` only accepts a `folderId` within the user's personal drive
- Shared items in Graph API have a `remoteItem` property pointing to the source drive

---

## 3. Expected State (After PRD-110)

### Browse Step Changes

The folder picker in the Connection Wizard displays two sections (tabs or segmented control):

1. **My Files** (default, current behavior): Shows the user's personal OneDrive folders and files
2. **Shared with me**: Shows items shared with the user by other people in the organization

### Shared Items Behavior

- **Shared folders**: Expandable, showing their contents (fetched from the source drive via `remoteItem.parentReference.driveId`)
- **Shared files**: Individual files selectable for sync
- **Shared items metadata**: Shows sharer name, sharing date, and permissions (read/edit)
- **Type validation**: Same rules as PRD-106 (unsupported types grayed out)

### Sync Behavior

- Shared files are synced using the **source drive ID** from `remoteItem.parentReference.driveId` and `remoteItem.id`
- Files table records: `source_type = 'onedrive'`, `external_drive_id` = source drive ID (NOT the user's drive)
- Delta sync (PRD-108): Shared items require separate delta tracking per source drive. This is a complexity consideration — see Section 6.

---

## 4. Detailed Specifications

### 4.1 Microsoft Graph API Endpoints

**List shared items**:
```
GET /me/drive/sharedWithMe
```
Returns a collection of `driveItem` resources with `remoteItem` property.

**Browse inside a shared folder**:
```
GET /drives/{remoteItem.parentReference.driveId}/items/{remoteItem.id}/children
```
This requires `Files.Read.All` scope (already granted in PRD-101 OAuth flow).

**Key data structure** (shared item from Graph API):
```json
{
  "id": "local-reference-id",
  "name": "Shared Project",
  "folder": { "childCount": 5 },
  "remoteItem": {
    "id": "actual-item-id",
    "name": "Shared Project",
    "parentReference": {
      "driveId": "source-drive-id",
      "driveType": "business"
    },
    "shared": {
      "owner": { "user": { "displayName": "Jane Smith" } },
      "sharedDateTime": "2026-03-01T10:00:00Z",
      "scope": "users"
    }
  }
}
```

### 4.2 Backend Changes

**`OneDriveService`** — New methods:
```typescript
/**
 * List items shared with the current user.
 * GET /me/drive/sharedWithMe
 */
async listSharedWithMe(connectionId: string): Promise<OneDriveBrowseResult>;

/**
 * Browse inside a shared folder (may be on a different drive).
 * GET /drives/{driveId}/items/{itemId}/children
 */
async listSharedFolder(
  connectionId: string,
  driveId: string,
  itemId: string
): Promise<OneDriveBrowseResult>;
```

**New API routes** (`backend/src/routes/connections.ts`):
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/connections/:id/browse-shared` | List items shared with user |
| `GET` | `/api/connections/:id/browse-shared/:driveId/:itemId` | Browse inside a shared folder |

**`OneDriveBrowseItem`** — Extended with shared metadata:
```typescript
interface OneDriveBrowseItem {
  id: string;
  name: string;
  isFolder: boolean;
  mimeType?: string;
  size?: number;
  lastModified?: string;
  isSupported?: boolean;  // from PRD-106
  // New fields for shared items:
  isShared?: boolean;
  sharedBy?: string;       // display name of sharer
  sharedDate?: string;     // ISO date
  remoteDriveId?: string;  // source drive ID (for browsing/syncing)
  remoteItemId?: string;   // actual item ID on source drive
}
```

### 4.3 Frontend Changes

**Connection Wizard browse step**:
- Add segmented control or tabs: `[My Files]  [Shared with me]`
- "My Files" tab uses existing `listFolder()` API
- "Shared with me" tab uses new `browse-shared` API
- Shared items show additional metadata: "Shared by {name} on {date}"
- Folder expansion for shared items calls `browse-shared/:driveId/:itemId`

**Selection model**:
- Shared items create scopes with additional metadata:
  - `scope_type = 'folder'` or `'file'` (same as personal items)
  - `scope_resource_id` = `remoteItem.id` (actual item ID on source drive)
  - New field needed: `remote_drive_id` on `connection_scopes` table
- This allows the sync engine to fetch content from the correct drive

### 4.4 Schema Changes

**`connection_scopes`** — New column:
```prisma
remote_drive_id    String?   @db.NVarChar(200)   // Source drive for shared items
```

When `remote_drive_id` is set, the sync engine uses it instead of the connection's `microsoft_drive_id`.

### 4.5 Content Download for Shared Files

**`GraphApiContentProvider`** (from PRD-101):
- Currently downloads via `/drives/{driveId}/items/{itemId}/content`
- For shared files: use `remote_drive_id` (from scope) instead of connection's drive ID
- The `Files.Read.All` scope grants permission to read from any drive the user has access to

---

## 5. Implementation Order

### Step 1: Backend — Shared Items API (1 day)
1. Add `listSharedWithMe()` to `OneDriveService`
2. Add `listSharedFolder()` to `OneDriveService`
3. Add browse-shared routes to `connections.ts`
4. Map `remoteItem` properties to `OneDriveBrowseItem`
5. Unit tests with mocked Graph API responses

### Step 2: Schema + Scope Changes (0.5 day)
1. Add `remote_drive_id` column to `connection_scopes`
2. Update scope creation logic to store `remote_drive_id` for shared items
3. Update `GraphApiContentProvider` to use `remote_drive_id` when present

### Step 3: Frontend — Tabs + Shared Browsing (1.5 days)
1. Add segmented control (My Files / Shared with me) to browse step
2. Implement shared items list with metadata (sharer, date)
3. Wire folder expansion for shared items to `browse-shared/:driveId/:itemId`
4. Reuse existing selection model (file/folder checkboxes)
5. Visual indicator for shared items (e.g., shared icon overlay)

### Step 4: Sync Integration (0.5 day)
1. Ensure `InitialSyncService` handles shared scopes (uses `remote_drive_id`)
2. Ensure `GraphApiContentProvider` downloads from correct drive
3. Integration test: sync a shared file — verify it processes through pipeline

---

## 6. Delta Sync Considerations (PRD-108 Impact)

Shared items introduce complexity for the webhook sync engine:

### Challenge: Subscription Scope
- Graph change notification subscriptions are per-drive: `/subscriptions` with `resource: "drives/{driveId}/root"`
- The user's personal drive subscription does NOT notify about changes in shared items (those are on other users' drives)
- Creating subscriptions on other users' drives requires application-level permissions (not delegated)

### Proposed Strategy
1. **No real-time sync for shared items**: Shared items rely on polling fallback (every 30 minutes) rather than webhooks
2. **Polling endpoint**: `GET /me/drive/sharedWithMe` with `$select=id,lastModifiedDateTime,eTag` to detect changes
3. **Manual sync**: "Sync Now" button triggers immediate check for shared item changes
4. **Delta support**: The sharedWithMe endpoint does NOT support delta queries. Changes must be detected by comparing `eTag` values against stored `content_hash_external`

This is an acceptable trade-off: shared items change less frequently than personal files, and the polling fallback provides reasonable freshness (30-minute maximum lag).

### Future Enhancement
Application-level permissions (`Files.Read.All` application scope) would allow subscribing to any drive in the tenant. This requires admin consent and is out of scope for PRD-110.

---

## 7. Edge Cases

| Scenario | Behavior |
|---|---|
| Sharer revokes sharing permission | Next sync attempt gets 403 — mark file as `error`, notify user |
| Sharer deletes the original file | Next sync attempt gets 404 — soft-delete local copy, notify user |
| Shared folder with 1000+ items | Pagination via `@odata.nextLink` (same as personal drive browsing) |
| Same file shared by multiple people | Each sharing creates a separate entry in sharedWithMe; deduplicate by `remoteItem.id` |
| Shared item is a OneNote notebook | Unsupported type — grayed out (PRD-106 file type validation) |

---

## 8. Affected Files

### New Files
| File | Purpose |
|---|---|
| (none — extends existing files) | |

### Modified Files
| File | Change |
|---|---|
| `backend/src/services/connectors/onedrive/OneDriveService.ts` | Add `listSharedWithMe()`, `listSharedFolder()` |
| `backend/src/routes/connections.ts` | Add browse-shared routes |
| `backend/src/services/connectors/GraphApiContentProvider.ts` | Use `remote_drive_id` for shared items |
| `backend/src/services/sync/InitialSyncService.ts` | Handle shared scopes |
| `backend/prisma/schema.prisma` | Add `remote_drive_id` to `connection_scopes` |
| `frontend/components/connections/ConnectionWizard.tsx` | Add tabs, shared browsing |

---

## 9. Success Criteria

- [x] "Shared with me" tab displays items shared by other users
- [x] Shared folders can be expanded to browse their contents
- [x] Shared items show sharer name and sharing date
- [x] Shared files can be selected and synced
- [x] Synced shared files are processed through the RAG pipeline
- [x] Content download works for shared items (uses source drive ID)
- [x] File type validation applies to shared items (PRD-106)
- [x] Permission revocation is handled gracefully (403 — error state)
- [x] All existing tests pass
- [x] Type-check and lint pass

---

## 10. Out of Scope

- "Shared by me" view (files the user has shared with others)
- Real-time webhook notifications for shared items (polling only)
- Application-level permissions for cross-drive subscriptions
- Sharing management (share/unshare files from within MyWorkMate)
- SharePoint shared libraries (covered by PRD-111)

---

## 11. Implementation Status

**Completed**: 2026-03-11

### Shared Package
- `ExternalFileItem` extended with 5 optional fields: `isShared`, `sharedBy`, `sharedDate`, `remoteDriveId`, `remoteItemId`
- `createScopesSchema` and `batchScopesSchema` extended with optional `remoteDriveId` field

### Database
- `connection_scopes.remote_drive_id` column added (NVarChar(200), nullable)
- Applied via `prisma db push`

### Backend — OneDriveService
- `mapSharedDriveItem()` helper maps Graph `/me/drive/sharedWithMe` items to `ExternalFileItem`
- `listSharedWithMe(connectionId)` — fetches shared items via Graph API
- `listSharedFolder(connectionId, driveId, itemId, pageToken?)` — browses remote drive folders
- `downloadFileContentFromDrive(connectionId, driveId, itemId)` — downloads from explicit drive
- `getDownloadUrlFromDrive(connectionId, driveId, itemId)` — gets download URL from explicit drive

### Backend — Routes
- `GET /api/connections/:id/browse-shared` — lists shared items
- `GET /api/connections/:id/browse-shared/:driveId/:itemId` — browses shared folders

### Backend — Scope Creation
- `ConnectionRepository.createScope()` accepts `remoteDriveId`
- `ScopeRow` interface includes `remote_drive_id`
- Routes and `ConnectionService.batchUpdateScopes()` forward `remoteDriveId`

### Backend — Sync Services
- `InitialSyncService`: resolves effective drive ID (`scope.remote_drive_id ?? connection.microsoft_drive_id`), skips subscription for shared scopes
- `DeltaSyncService`: same effective drive ID pattern
- `SubscriptionManager.createSubscription()`: early return for shared scopes
- `GraphApiContentProvider`: routes downloads by `external_drive_id` (shared files use `downloadFileContentFromDrive`)

### Frontend
- Tab UI: "My Files" / "Shared with me" segmented control
- Lazy loading of shared items on first tab switch
- Shared folder expansion via `browse-shared/:driveId/:itemId`
- Children of shared folders inherit `remoteDriveId`
- "Shared by {name}" metadata label with Users icon
- Scope payloads include `remoteDriveId` for both first-time and batch modes

### Design Decisions
- **Effective drive ID pattern**: `scope.remote_drive_id ?? connection.microsoft_drive_id` — shared scopes use the remote drive, personal scopes use the connection drive
- **No webhooks for shared scopes**: Subscription creation is skipped because Graph subscriptions can only target the user's own drive
- **`external_drive_id` on files**: Shared files store the remote drive ID so `GraphApiContentProvider` can route downloads correctly
- **Children inherit remoteDriveId**: When expanding a shared folder, all children nodes inherit the parent's `remoteDriveId` for correct drill-down

---

## 9. Post-Testing Bugfixes (PRD-110b)

Issues found during live testing against a real PMC SharePoint/OneDrive account.

### Fix 1: "Expected string, received null" on scope batch

**Root cause**: `scopePath: s.path` in the frontend sends `null` for shared items with no `parentPath`. Zod's `z.string().optional()` rejects `null`.

**Fix** (two-sided):
- **Frontend** (`ConnectionWizard.tsx`): Changed `scopePath: s.path` to `...(s.path != null && { scopePath: s.path })` on both batch and first-time-setup payloads
- **Backend** (`onedrive.schemas.ts`): Changed `scopePath` from `.optional()` to `.nullish()` in both `createScopesSchema` and `batchScopesSchema`

### Fix 2: Incomplete shared items (pagination)

**Root cause**: `listSharedWithMe()` called Graph API with no query params — only the first page returned (sometimes just 1 item).

**Fix** (`OneDriveService.ts`): Auto-paginate with `$top=200`, follow `@odata.nextLink` up to 10 pages (max 2000 items). Returns full list with `nextPageToken: null`.

### Fix 3: Right-click context menu

**Implementation** (`FolderTree.tsx`): Wrapped OneDrive section with `<ContextMenu>` from shadcn/ui. Right-click shows "Configure" item with `Settings2` icon that opens `ConnectionWizard`.

### Fix 4: 404 on shared file sync

**Root cause**: `_runFileLevelSync` called `getItemMetadata(connectionId, itemId)` which uses the user's **personal drive ID**. Shared items have `scope_resource_id` = `remoteItem.id` living on the **remote drive** — hence `itemNotFound` 404.

**Fix**:
- **OneDriveService**: Added `getItemMetadataFromDrive(connectionId, driveId, itemId)` — follows existing `downloadFileContentFromDrive` pattern
- **InitialSyncService**: When `scope.remote_drive_id` exists, routes to `getItemMetadataFromDrive` with the remote drive ID

### Fix 5: Shared file icon

**Implementation**: Added `is_shared` boolean column to `files` table (default `false`). Set to `true` during sync when `scope.remote_drive_id` exists. Propagated through `FileDbRecord` → `parseFile()` → `ParsedFile` → `FileIcon.tsx`.

**Visual**: Shared OneDrive files show a `Users` badge (two people icon) instead of the `Cloud` badge. Color remains Microsoft blue (`#0078D4`).

### Files modified
| File | Change |
|------|--------|
| `packages/shared/src/schemas/onedrive.schemas.ts` | `scopePath` → `.nullish()` |
| `packages/shared/src/types/file.types.ts` | Added `isShared` to `ParsedFile` |
| `frontend/components/connections/ConnectionWizard.tsx` | Conditional spread for `scopePath` |
| `frontend/components/files/FolderTree.tsx` | Right-click context menu |
| `frontend/components/files/FileIcon.tsx` | `Users` badge for shared files |
| `backend/prisma/schema.prisma` | Added `is_shared` column to `files` |
| `backend/src/types/file.types.ts` | Added `is_shared` to `FileDbRecord`, `parseFile()` |
| `backend/src/services/connectors/onedrive/OneDriveService.ts` | Auto-paginate `listSharedWithMe`, added `getItemMetadataFromDrive` |
| `backend/src/services/sync/InitialSyncService.ts` | Remote drive routing for file-level sync, `is_shared` flag |
| `docs/plans/files-integrations/PRD-111-sharepoint-connection.md` | Section 4.12: OneDrive–SharePoint unified shared view |
