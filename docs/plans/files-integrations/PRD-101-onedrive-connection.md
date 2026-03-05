# PRD-101: OneDrive Connection & Initial Sync

**Phase**: OneDrive
**Status**: Planned
**Prerequisites**: PRD-100 (Foundation)
**Estimated Effort**: 7-10 days
**Created**: 2026-03-05

---

## 1. Objective

Enable users to connect their OneDrive account, browse folders, select scopes to sync, and trigger an initial synchronization that processes external files through the RAG pipeline. This is the first full connector implementation, establishing patterns that SharePoint (PRD-103) will reuse.

UI deliverables include the connection wizard, OneDrive root in the folder tree, external file browsing, and sync progress indicators.

---

## 2. Current State (After PRD-100)

- `connections` and `connection_scopes` tables exist
- `files` table has `source_type`, `external_id`, `connection_id` columns
- `IFileContentProvider` interface exists with `BlobContentProvider` for local files
- `ContentProviderFactory` routes based on `source_type`
- `GraphTokenManager` can store/retrieve encrypted tokens
- Connections API (`GET /api/connections`) returns connection list
- Frontend Connections tab shows "Not connected" + disabled "Connect" for OneDrive

---

## 3. Expected State (After PRD-101)

### Backend
- Full OneDrive OAuth consent flow via MSAL (additional scopes: `Files.Read.All`)
- `OneDriveService`: browse drive, list folders/files, download content, execute delta query
- `GraphApiContentProvider`: download external files via Graph API for pipeline processing
- `InitialSyncService`: orchestrate first delta query + batch file record creation + pipeline enqueue
- External files flow through existing pipeline: extract -> chunk -> embed -> ready
- API endpoints: OAuth initiate/callback, browse remote folders, create scopes, trigger sync

### Frontend
- Connection wizard (multi-step modal):
  - Step 1: OAuth consent (redirect to Microsoft login)
  - Step 2: Browse OneDrive folders (lazy-loaded tree)
  - Step 3: Select folders to sync (checkboxes)
  - Step 4: Confirm and start sync
- OneDrive root node in FolderTree with blue accent (`#0078D4`)
- Breadcrumb shows OneDrive icon when navigating external folders
- Sync progress bar during initial sync (files processed / total)
- File list shows external files with sync status indicator
- Context menu for external files: "Add to Chat", "Open in OneDrive" (no rename/delete/move)

---

## 4. Detailed Specifications

### 4.1 OAuth Flow Extension

**Current scopes** (from `microsoft.types.ts`):
```typescript
['openid', 'profile', 'email', 'offline_access', 'User.Read',
 'https://api.businesscentral.dynamics.com/Financials.ReadWrite.All']
```

**Additional scopes for OneDrive**:
```typescript
['Files.Read.All']
// Files.Read.All: Read all files that user can access (delegated)
// Includes OneDrive personal files + files shared with the user
```

**OAuth flow for OneDrive connection**:

```
1. Frontend: User clicks "Connect" on OneDrive
2. Frontend: POST /api/connections/onedrive/auth/initiate
3. Backend: Create connection record (status='connecting')
4. Backend: Generate MSAL auth URL with Files.Read.All scope
   - Use connection.id as state parameter for callback routing
   - Use MSAL ConfidentialClientApplication with scopes: ['Files.Read.All']
5. Backend: Return { authUrl, connectionId }
6. Frontend: Redirect user to authUrl (or open popup)
7. User: Consents to Files.Read.All permission
8. Microsoft: Redirects to /api/auth/callback/onedrive?code=...&state=connectionId
9. Backend: Exchange code for tokens via MSAL acquireTokenByCode()
10. Backend: Store tokens in connection record (encrypted)
11. Backend: Update connection status -> 'connected'
12. Backend: Fetch user's drive ID via GET /me/drive
13. Backend: Store microsoft_drive_id in connection
14. Backend: Redirect to frontend with success indicator
15. Frontend: Connection wizard advances to Step 2 (browse)
```

**Key decision**: Use a SEPARATE callback endpoint `/api/auth/callback/onedrive` to avoid polluting the main auth callback. The connection ID is passed via OAuth state parameter.

**MSAL integration notes**:
- Reuse existing `MsalRedisCachePlugin` for token caching
- Use `homeAccountId` from the user's existing Microsoft login session
- `acquireTokenSilent` should work since user already authenticated with Microsoft
- If silent acquisition fails (new scope not consented), fall back to interactive auth

### 4.2 OneDriveService

**Location**: `backend/src/services/connectors/onedrive/OneDriveService.ts`

```typescript
export class OneDriveService {
  private logger = createChildLogger({ service: 'OneDriveService' });

  /**
   * Get user's drive metadata.
   * GET /me/drive
   */
  async getDriveInfo(connectionId: string): Promise<DriveInfo>;

  /**
   * List children of a folder (or root).
   * GET /drives/{driveId}/items/{itemId}/children
   * GET /drives/{driveId}/root/children (for root)
   * Supports pagination via @odata.nextLink
   */
  async listFolder(
    connectionId: string,
    folderId?: string, // null = root
    pageToken?: string
  ): Promise<FolderListResult>;

  /**
   * Download file content as Buffer.
   * GET /drives/{driveId}/items/{itemId}/content
   * Returns 302 redirect to download URL; follow redirect.
   */
  async downloadFileContent(
    connectionId: string,
    itemId: string
  ): Promise<FileContentResult>;

  /**
   * Get pre-authenticated download URL (for frontend preview).
   * GET /drives/{driveId}/items/{itemId}?$select=@microsoft.graph.downloadUrl
   * Returns temporary URL (valid ~1 hour).
   */
  async getDownloadUrl(
    connectionId: string,
    itemId: string
  ): Promise<string>;

  /**
   * Execute delta query for change tracking.
   * GET /drives/{driveId}/root/delta (first call: full enumeration)
   * GET /drives/{driveId}/root/delta?token=... (subsequent: changes only)
   * Returns all changed items + new deltaLink.
   */
  async executeDeltaQuery(
    connectionId: string,
    deltaLink?: string // null = initial full sync
  ): Promise<DeltaQueryResult>;
}
```

**Types**:
```typescript
interface DriveInfo {
  driveId: string;
  driveName: string;
  driveType: string; // 'personal' | 'business'
  ownerDisplayName: string;
  totalBytes: number;
  usedBytes: number;
}

interface FolderListResult {
  items: ExternalFileItem[];
  nextPageToken?: string; // @odata.nextLink
}

interface ExternalFileItem {
  id: string;           // driveItem ID
  name: string;
  isFolder: boolean;
  mimeType?: string;
  sizeBytes?: number;
  lastModifiedAt: string; // ISO 8601
  createdAt: string;
  webUrl: string;
  eTag?: string;
  parentId?: string;
  parentPath?: string;
}

interface DeltaQueryResult {
  changes: DeltaChange[];
  deltaLink: string;     // Save for next call
  hasMore: boolean;       // @odata.nextLink exists
  nextPageLink?: string;
}

interface DeltaChange {
  item: ExternalFileItem;
  changeType: 'created' | 'modified' | 'deleted';
  // 'deleted' when item has { deleted: {} } facet
}
```

**Rate limiting**: Every Graph API call goes through a `GraphRateLimiter` that:
- Tracks RU usage per tenant (identified from connection's `microsoft_tenant_id`)
- Implements exponential backoff on 429 responses
- Reads `Retry-After` header and respects it
- Logs warning at 80% usage (when `RateLimit-Remaining` headers appear)

### 4.3 GraphApiContentProvider

**Location**: `backend/src/services/connectors/GraphApiContentProvider.ts`

Implements `IFileContentProvider` for external files.

```typescript
export class GraphApiContentProvider implements IFileContentProvider {
  async getContent(fileId: string, userId: string): Promise<FileContentResult> {
    const file = await this.fileRepository.findById(userId, fileId);
    if (!file.connection_id || !file.external_id || !file.external_drive_id) {
      throw new InvalidExternalFileError(fileId);
    }

    const oneDriveService = getOneDriveService();
    const result = await oneDriveService.downloadFileContent(
      file.connection_id,
      file.external_id
    );

    return {
      buffer: result.buffer,
      mimeType: file.mime_type,
      fileName: file.name,
      sizeBytes: result.buffer.length,
      contentHash: file.content_hash_external,
    };
  }

  async isAccessible(fileId: string, userId: string): Promise<boolean> {
    // Check: connection exists, is connected, token valid
    // Check: file still exists in Graph API (HEAD request)
  }

  async getDownloadUrl(fileId: string, userId: string): Promise<string> {
    const file = await this.fileRepository.findById(userId, fileId);
    const oneDriveService = getOneDriveService();
    return oneDriveService.getDownloadUrl(file.connection_id!, file.external_id!);
  }
}
```

### 4.4 Initial Sync Service

**Location**: `backend/src/services/sync/InitialSyncService.ts`

Orchestrates the first-time sync when a user selects scopes.

```typescript
export class InitialSyncService {
  /**
   * Sync a single scope (folder or drive root).
   * 1. Execute delta query without token (full enumeration)
   * 2. Page through all results
   * 3. For each file item: create record in files table
   * 4. For each file: enqueue processing pipeline
   * 5. Save deltaLink in connection_scopes
   * 6. Emit progress events via WebSocket
   */
  async syncScope(
    connectionId: string,
    scopeId: string,
    userId: string
  ): Promise<SyncResult>;
}
```

**File record creation for external files**:
```typescript
// Fields populated for external files:
{
  id: generateUUID(),                    // UPPERCASE
  user_id: userId,                       // UPPERCASE
  name: driveItem.name,
  mime_type: driveItem.mimeType || 'application/octet-stream',
  size_bytes: driveItem.sizeBytes || 0,
  blob_path: null,                       // No blob for external files
  is_folder: driveItem.isFolder,
  source_type: FILE_SOURCE_TYPE.ONEDRIVE,
  external_id: driveItem.id,
  external_drive_id: connection.microsoft_drive_id,
  connection_id: connectionId,
  connection_scope_id: scopeId,
  external_url: driveItem.webUrl,
  external_modified_at: driveItem.lastModifiedAt,
  content_hash_external: driveItem.eTag,
  pipeline_status: 'queued',            // Skip registered/uploaded states
  parent_folder_id: resolveParentFolder(driveItem),
}
```

**Pipeline entry point**: External files skip `registered` and `uploaded` states. They enter directly at `queued` because there's no blob upload step.

**State machine extension** (shared package):
```
External files: queued -> extracting -> chunking -> embedding -> ready
                  |
                  v
                failed -> queued (retry)
```

No changes to `PipelineStateMachine` needed — `queued` is already a valid starting state.

**Batch processing**:
- Delta query may return thousands of items
- Process in batches of 50 items
- Emit `sync:progress` WebSocket event per batch
- Use `ProcessingFlowFactory` to create pipeline flows for each file

### 4.5 API Endpoints (New)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/connections/onedrive/auth/initiate` | Start OAuth flow, return authUrl |
| `GET` | `/api/auth/callback/onedrive` | OAuth callback (from Microsoft redirect) |
| `GET` | `/api/connections/:id/browse` | Browse remote folder (paginated) |
| `GET` | `/api/connections/:id/browse/:folderId` | Browse specific folder |
| `POST` | `/api/connections/:id/scopes` | Create sync scopes (selected folders) |
| `POST` | `/api/connections/:id/scopes/:scopeId/sync` | Trigger initial sync for a scope |
| `GET` | `/api/connections/:id/sync-status` | Get sync progress for all scopes |

**Browse response shape**:
```typescript
{
  items: ExternalFileItem[];
  nextPageToken?: string;
  currentPath: string;       // "/Documents/Projects"
  parentId?: string;         // For "go up" navigation
  driveInfo: {
    name: string;
    totalBytes: number;
    usedBytes: number;
  };
}
```

### 4.6 Frontend: Connection Wizard

**New component**: `frontend/components/connections/ConnectionWizard.tsx`

Multi-step dialog using shadcn/ui `Dialog` + custom stepper.

#### Step 1: Connect
- Provider logo + description text
- "Connect with Microsoft" button
- Click -> POST to initiate endpoint -> redirect to Microsoft login
- On callback success: wizard auto-advances to Step 2
- On callback failure: show error with retry option

#### Step 2: Browse & Select
- Left panel: folder tree (lazy-loaded from browse API)
- Each folder has a checkbox for selection
- Folder expand loads children via browse API
- "Select All" checkbox at root level
- File count estimate per folder (from Graph API)
- Info text: "Select the folders you want to sync to your Knowledge Base"

#### Step 3: Confirm & Sync
- Summary: list of selected folders with estimated file counts
- Warning if >1000 files: "This may take several minutes to process"
- "Start Sync" button
- Click -> POST scopes + POST sync for each scope
- Progress bar: "Syncing... 234/1,204 files processed"
- On complete: "Sync complete! Your files are now searchable."
- Close wizard -> folder tree shows OneDrive root

### 4.7 Frontend: OneDrive in Folder Tree

**Modified**: `frontend/components/files/FolderTree.tsx`

After connection is established, a new root node appears:

```
My Files (existing)
  ├── Reports/
  └── Invoices/

OneDrive                    <- NEW root node
  ├── Documents/            <- Synced scope (bold, with checkmark)
  │   ├── Projects/
  │   └── Reports/
  └── Shared/               <- Synced scope (bold, with checkmark)
```

**Visual differentiation**:
- Root node icon: `<Cloud />` from lucide-react, colored `#0078D4`
- Root node label: "OneDrive" (from `PROVIDER_DISPLAY_NAME`)
- `border-left: 2px solid #0078D4` on tree items when inside OneDrive
- Synced scope folders: bold text + small checkmark badge

**Data source**: OneDrive folders come from `files` table with `source_type='onedrive'` and `is_folder=true`. The folder tree already uses `parent_folder_id` for nesting — external folders use the same mechanism with a virtual root.

**Virtual root approach**: Create a virtual folder record with `id = 'ONEDRIVE-ROOT-{connectionId}'`, `is_folder=true`, `source_type='onedrive'`, `parent_folder_id=null`. Synced folders become children of this root.

### 4.8 Frontend: External File Context Menu

External files (`source_type != 'local'`) get a reduced context menu:

| Action | Available | Reason |
|---|---|---|
| Add to Chat | Yes | Works via existing @mention system |
| Open in OneDrive | Yes (NEW) | Opens `external_url` in new tab |
| Download | Yes | Via `GraphApiContentProvider.getDownloadUrl()` |
| Rename | No | Read-only from external source |
| Move | No | Read-only from external source |
| Delete | No | Managed by sync, not user |
| Favorite | Yes | Local preference, no external change |
| Retry (if failed) | Yes | Re-processes through pipeline |

### 4.9 Frontend: File Preview for External Files

**Modified**: `frontend/components/files/modals/FilePreviewModal.tsx`

For external files, the preview URL changes:
- Local files: `GET /api/files/{id}/content` (from blob)
- External files: `GET /api/files/{id}/content` (backend proxies from Graph API via `GraphApiContentProvider.getDownloadUrl()`)

The backend's file content endpoint needs modification to handle external files:
```typescript
// GET /api/files/:id/content
if (file.source_type !== FILE_SOURCE_TYPE.LOCAL) {
  const provider = contentProviderFactory.getProvider(file.source_type);
  const downloadUrl = await provider.getDownloadUrl(file.id, userId);
  return res.redirect(downloadUrl); // Redirect to pre-authenticated Graph URL
}
// Existing blob SAS URL logic for local files
```

### 4.10 WebSocket Events (New)

```typescript
// Sync lifecycle events (emitted to user:{userId} room)
'sync:started'      -> { connectionId, scopeId, totalFiles }
'sync:progress'     -> { connectionId, scopeId, processedFiles, totalFiles, percentage }
'sync:completed'    -> { connectionId, scopeId, filesProcessed, duration }
'sync:error'        -> { connectionId, scopeId, error, canRetry }

// Reuse existing file events for individual file processing:
'file:readiness_changed' -> { fileId, readinessState, sourceType }
```

Event constants defined in `@bc-agent/shared` (`constants/sync-events.ts`).

---

## 5. Implementation Order

### Step 1: OneDriveService (2 days)
1. Implement `OneDriveService` with all Graph API methods
2. Implement `GraphRateLimiter` for per-tenant throttling
3. Unit tests with mocked HTTP responses (all Graph API endpoints)
4. Integration test with real Graph API (optional, requires test tenant)

### Step 2: GraphApiContentProvider (1 day)
1. Implement `GraphApiContentProvider`
2. Register in `ContentProviderFactory` for `onedrive` source type
3. Unit tests: download, accessibility check, download URL generation
4. Integration test: create external file record -> verify provider downloads correctly

### Step 3: OAuth Flow (1 day)
1. Create OneDrive-specific OAuth callback endpoint
2. Integrate with existing MSAL infrastructure
3. Token storage via `GraphTokenManager`
4. Test: full OAuth flow (may need manual testing with real Microsoft account)

### Step 4: Initial Sync Service (1.5 days)
1. Implement `InitialSyncService.syncScope()`
2. Batch processing with progress events
3. External file record creation
4. Pipeline enqueue via `ProcessingFlowFactory`
5. Unit tests: delta response processing, file record creation, batch logic
6. Integration test: mock delta response -> verify files created and pipeline queued

### Step 5: Browse & Scopes API (1 day)
1. Browse endpoints (lazy folder listing from Graph API)
2. Scope CRUD endpoints
3. Sync trigger endpoint
4. Unit + integration tests for all endpoints

### Step 6: Frontend — Connection Wizard (1.5 days)
1. `ConnectionWizard.tsx` (multi-step dialog)
2. `ScopeSelectorTree.tsx` (browsable folder tree with checkboxes)
3. Sync progress UI
4. Integration with `connectionListStore`

### Step 7: Frontend — Folder Tree + File List (1 day)
1. OneDrive root node in `FolderTree.tsx`
2. Visual differentiation (icon, color, border)
3. Context menu restrictions for external files
4. File preview proxy for external files
5. Breadcrumb updates for OneDrive navigation

---

## 6. Success Criteria

### Backend
- [ ] User can complete OneDrive OAuth flow and connection is stored with `status='connected'`
- [ ] `GET /api/connections/:id/browse` returns real OneDrive folder structure
- [ ] User can select folders and create connection scopes
- [ ] Initial sync creates file records with `source_type='onedrive'` and correct metadata
- [ ] External files process through pipeline: extract -> chunk -> embed -> ready
- [ ] `FileExtractWorker` correctly uses `GraphApiContentProvider` for external files
- [ ] WebSocket events fire during sync: `sync:started`, `sync:progress`, `sync:completed`
- [ ] Rate limiting respects per-tenant Graph API limits
- [ ] All new code has unit tests

### Frontend
- [ ] Connection wizard guides user through OAuth -> browse -> select -> sync
- [ ] OneDrive root node appears in folder tree after connection
- [ ] OneDrive folders/files display with blue accent color
- [ ] Sync progress shows during initial synchronization
- [ ] External files show in file list with correct sync status
- [ ] "Open in OneDrive" context menu action opens correct webUrl
- [ ] File preview works for external files (proxy through backend)
- [ ] "Add to Chat" works with external files (existing @mention flow)

### E2E Verification
1. New user -> Connect OneDrive -> Select "Documents" folder -> Start sync
2. Verify files appear in file list with "syncing" status
3. Wait for pipeline completion -> files show "ready" status
4. Navigate to OneDrive > Documents in folder tree -> see synced files
5. Open file preview -> content loads from Graph API
6. Use @mention to reference external file in chat
7. RAG agent can find and cite content from synced OneDrive files
8. Upload a LOCAL file -> verify existing flow still works (regression)

---

## 7. Risks & Mitigations (PRD-101 Specific)

| Risk | Mitigation |
|---|---|
| MSAL silent token acquisition fails for new scope | Implement interactive fallback with explicit consent prompt |
| Large OneDrive drives (10K+ files) slow initial sync | Batch processing (50/batch), progress events, allow cancellation |
| User disconnects mid-sync | Resume capability: check `sync_status` on connection, offer "Resume sync" |
| Graph API returns inconsistent data during pagination | Follow `@odata.nextLink` strictly, handle empty pages, track by item ID |
| Token refresh during long sync process | `GraphTokenManager` auto-refreshes before each API call. Pipeline retries use fresh token. |

---

## 8. Out of Scope

- Real-time sync / change notifications (PRD-102)
- SharePoint integration (PRD-103)
- Write operations to OneDrive (rename, delete, upload) — read-only integration
- Bidirectional sync — changes in our system do NOT propagate to OneDrive
- OneDrive Personal accounts (focus on OneDrive for Business/Work)
