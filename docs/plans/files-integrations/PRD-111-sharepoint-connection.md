# PRD-111: SharePoint Connection

**Phase**: SharePoint
**Status**: Planned
**Prerequisites**: PRD-108 (Webhook Sync Engine)
**Estimated Effort**: 5-7 days
**Created**: 2026-03-05

---

## 1. Objective

Enable users to connect to SharePoint, discover accessible sites, browse document libraries, select scopes for sync, and leverage the entire webhook-based sync engine built in PRD-108. SharePoint differs from OneDrive primarily in its hierarchical resource model (Tenant -> Sites -> Document Libraries -> Folders/Files) and the multi-site nature of its content.

UI deliverables include the SharePoint connection wizard with multi-step site/library picker, SharePoint root in the folder tree with teal accent, and SharePoint-specific visual theming.

---

## 2. Current State (After PRD-108)

- Full OneDrive integration working (OAuth, browse, sync, webhooks)
- `IFileContentProvider` abstraction with `GraphApiContentProvider`
- Webhook infrastructure: `SubscriptionManager`, `DeltaSyncService`, `ExternalFileSyncWorker`
- Polling fallback and subscription renewal
- Frontend: ConnectionWizard (OneDrive-specific), folder tree with OneDrive root
- Shared constants: `PROVIDER_ID.SHAREPOINT` defined but unused

---

## 3. Expected State (After PRD-111)

### Backend
- `SharePointService`: site discovery, library listing, folder/file browsing, delta queries
- OAuth flow with `Sites.Read.All` scope (separate consent from OneDrive's `Files.Read.All`)
- Reuse `GraphApiContentProvider` — SharePoint files use same Graph API download pattern
- Reuse `DeltaSyncService` — delta query works identically on site drives
- Reuse webhook infra — subscriptions on `sites/{siteId}/drive/root`
- API endpoints: SP OAuth, site discovery, library listing, browse, scope creation

### Frontend
- SharePoint connection wizard (4 steps: connect -> pick sites -> pick libraries/folders -> confirm)
- SharePoint root in folder tree with teal accent (`#038387`)
- Site grouping: folders grouped under site names in the tree
- Visual distinction between sites (Globe icon) and libraries (BookOpen icon)

---

## 4. Detailed Specifications

### 4.1 SharePoint Resource Hierarchy

```
Microsoft 365 Tenant
├── Site: "Marketing"           (site-id-1)
│   ├── Drive: "Documents"      (drive-id-1)   <- Default document library
│   │   ├── 📁 Campaigns/
│   │   └── 📁 Brand Assets/
│   ├── Drive: "Shared Files"   (drive-id-2)   <- Additional library
│   │   └── 📁 Templates/
│   └── Drive: "Site Assets"    (drive-id-3)   <- System library (usually hidden)
│
├── Site: "Engineering"         (site-id-2)
│   ├── Drive: "Documents"      (drive-id-4)
│   └── Drive: "Wiki"           (drive-id-5)
│
└── Site: "HR Portal"           (site-id-3)
    └── Drive: "Policies"       (drive-id-6)
```

**Key differences from OneDrive**:
- OneDrive: 1 user = 1 drive. Simple.
- SharePoint: 1 user may access N sites, each with M document libraries, each library is a separate drive.
- SharePoint scope selection requires 3 levels: Site -> Library -> Folder(s)
- Each library has its own drive ID — delta queries and subscriptions are per-drive.

### 4.2 OAuth Scope Extension

**Additional scope**:
```typescript
['Sites.Read.All']
// Sites.Read.All (delegated): Read items in all site collections
// Allows listing sites the user can access + reading files from those sites
```

**Note**: `Sites.Read.All` is a HIGH-PRIVILEGE scope. The user must have access to the SharePoint sites — the API only returns sites where the user has at least Read permission. Multi-tenant isolation is enforced by Microsoft, not by us.

**OAuth flow**: Same pattern as OneDrive (PRD-101):
1. POST `/api/connections/sharepoint/auth/initiate`
2. MSAL auth URL with `Sites.Read.All` scope
3. Callback stores tokens in `connections` table
4. Connection status -> 'connected'

### 4.3 SharePointService

**Location**: `backend/src/services/connectors/sharepoint/SharePointService.ts`

```typescript
export class SharePointService {
  /**
   * Discover SharePoint sites accessible to the user.
   * GET /sites?search=* (returns all sites user can access)
   * Uses pagination for large tenants.
   */
  async discoverSites(connectionId: string): Promise<SharePointSite[]>;

  /**
   * Get document libraries for a site.
   * GET /sites/{siteId}/drives
   * Filters out system drives (Site Assets, etc.) by default.
   */
  async getLibraries(
    connectionId: string,
    siteId: string,
    includeSystem?: boolean
  ): Promise<SharePointLibrary[]>;

  /**
   * Browse folder contents within a library.
   * GET /sites/{siteId}/drives/{driveId}/root/children
   * GET /sites/{siteId}/drives/{driveId}/items/{folderId}/children
   */
  async browseFolder(
    connectionId: string,
    siteId: string,
    driveId: string,
    folderId?: string,
    pageToken?: string
  ): Promise<FolderListResult>;

  /**
   * Download file content.
   * GET /drives/{driveId}/items/{itemId}/content
   * Same Graph API as OneDrive — drives are unified.
   */
  async downloadFileContent(
    connectionId: string,
    itemId: string,
    driveId: string
  ): Promise<FileContentResult>;

  /**
   * Execute delta query for a library drive.
   * GET /drives/{driveId}/root/delta
   * Same pattern as OneDrive — drive-level delta.
   */
  async executeDeltaQuery(
    connectionId: string,
    driveId: string,
    deltaLink?: string
  ): Promise<DeltaQueryResult>;
}
```

**Types**:
```typescript
interface SharePointSite {
  siteId: string;
  siteName: string;
  siteUrl: string;
  description?: string;
  isPersonalSite: boolean;
  lastModifiedAt: string;
}

interface SharePointLibrary {
  driveId: string;
  libraryName: string;
  description?: string;
  itemCount: number;
  sizeBytes: number;
  webUrl: string;
  isSystemLibrary: boolean; // "Site Assets", "Style Library", etc.
}
```

### 4.4 SharePoint-Specific Scope Model

SharePoint scopes are more granular than OneDrive:

| scope_type | external_id | display_name | Example |
|---|---|---|---|
| `site` | site ID | "Marketing" | Sync ALL libraries in a site |
| `library` | drive ID | "Documents (Marketing)" | Sync one library |
| `folder` | driveItem ID | "Campaigns (Marketing/Documents)" | Sync one folder in a library |

**Connection record**:
- `microsoft_site_id`: Set to the FIRST selected site (or null if multiple sites)
- For multiple sites: each site gets its own set of `connection_scopes`

**Subscription mapping**:
- Subscriptions are per-DRIVE, not per-site or per-folder
- When user selects a `site` scope: create subscription for each drive in that site
- When user selects a `library` scope: create subscription for that drive
- When user selects a `folder` scope: create subscription for the parent drive (filter changes by folder path)

### 4.5 GraphApiContentProvider — SharePoint Reuse

**Key insight**: SharePoint files use the same Graph API download endpoint as OneDrive: `GET /drives/{driveId}/items/{itemId}/content`. The existing `GraphApiContentProvider` works WITHOUT modification.

The only difference:
- OneDrive files: `external_drive_id` = user's personal drive ID
- SharePoint files: `external_drive_id` = site library's drive ID

Both stored in the same `files.external_drive_id` column.

### 4.6 DeltaSyncService — SharePoint Reuse

Delta queries work identically:
- OneDrive: `GET /drives/{userDriveId}/root/delta?token=...`
- SharePoint: `GET /drives/{libraryDriveId}/root/delta?token=...`

Same endpoint, same response format, same `deltaLink` tracking. The `DeltaSyncService` works WITHOUT modification.

**Folder-scoped filtering**: When a user syncs only a specific folder (not entire library), the delta query still returns ALL changes for the drive. The `DeltaSyncService` must filter changes:

```typescript
// In DeltaSyncService.processChanges():
if (scope.scope_type === 'folder') {
  // Filter: only process changes where item.parentReference.path
  // starts with the scope's external_path
  changes = changes.filter(c =>
    c.item.parentPath?.startsWith(scope.external_path!) ||
    c.item.id === scope.external_id
  );
}
```

### 4.7 API Endpoints (New)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/connections/sharepoint/auth/initiate` | Start SP OAuth flow |
| `GET` | `/api/auth/callback/sharepoint` | SP OAuth callback |
| `GET` | `/api/connections/:id/sites` | List accessible SP sites |
| `GET` | `/api/connections/:id/sites/:siteId/libraries` | List document libraries |
| `GET` | `/api/connections/:id/sites/:siteId/libraries/:driveId/browse` | Browse library folder |
| `GET` | `/api/connections/:id/sites/:siteId/libraries/:driveId/browse/:folderId` | Browse subfolder |

Scope creation and sync trigger reuse existing endpoints from PRD-101:
- `POST /api/connections/:id/scopes` — works for SP scopes too
- `POST /api/connections/:id/scopes/:scopeId/sync` — triggers initial sync

### 4.8 Frontend: SharePoint Connection Wizard

More complex than OneDrive due to multi-level hierarchy.

#### Step 1: Connect
Same as OneDrive: OAuth consent with `Sites.Read.All` scope.

#### Step 2: Select Sites
- Grid/list of accessible SharePoint sites
- Each site shows: name, URL, description, last modified
- Checkbox selection (multi-select)
- Search/filter input for large tenants with many sites
- "Select All" option (with warning for large tenants)

#### Step 3: Select Libraries & Folders
For each selected site, show its document libraries:

```
Marketing Site
├── ☑ Documents (234 files, 1.2 GB)
│   ├── ☐ Campaigns/          (select subfolder)
│   └── ☐ Brand Assets/       (select subfolder)
├── ☐ Shared Files (45 files, 300 MB)
└── ☐ Wiki (12 files, 50 MB)

Engineering Site
├── ☑ Documents (1,567 files, 4.5 GB)
└── ☐ Wiki (89 files, 200 MB)
```

- Library-level checkboxes = sync entire library
- Expandable libraries show folders = sync specific folder(s)
- File count and size estimates per library (from Graph API)
- Warning banner if total selected >5000 files

#### Step 4: Confirm & Sync
Same as OneDrive: summary of selections, estimated time, "Start Sync" button.

### 4.9 Frontend: SharePoint in Folder Tree

```
My Files
  └── ...

OneDrive (blue)
  └── ...

SharePoint (teal #038387)                    <- Root node
  ├── 🌐 Marketing                          <- Site node (Globe icon)
  │   ├── 📚 Documents                      <- Library node (BookOpen icon)
  │   │   ├── 📁 Campaigns/                 <- Regular folders
  │   │   └── 📁 Brand Assets/
  │   └── 📚 Shared Files
  └── 🌐 Engineering
      └── 📚 Documents
          └── 📁 Architecture/
```

**Visual elements**:
- Root: `<Globe />` icon, teal `#038387`
- Sites: `<Globe />` icon (smaller), teal accent
- Libraries: `<BookOpen />` icon (lucide), teal accent
- Folders/files: standard icons with `border-left: 2px solid #038387`

**Tree structure**: Three-level virtual hierarchy:
1. SharePoint root (virtual, `source_type='sharepoint'`)
2. Site nodes (virtual folders, one per site)
3. Library nodes (virtual folders, one per library)
4. Regular synced folders/files underneath

### 4.10 Frontend: SharePoint File Context Menu

Same restrictions as OneDrive external files, plus:

| Action | Available | Notes |
|---|---|---|
| Open in SharePoint | Yes | Opens `external_url` in new tab |
| View in Site | Yes | Opens site URL (site-level context) |

### 4.11 Frontend: SharePoint Visual Theme

When browsing inside SharePoint:

| Element | Style |
|---|---|
| Breadcrumb root | "🌐 SharePoint > Marketing > Documents > ..." |
| Data table header | `border-top: 2px solid #038387` |
| Info banner | "Files from SharePoint. Open in SharePoint to edit." |
| Status badges | Same as OneDrive but teal-colored |

### 4.12 OneDrive–SharePoint Unified Shared View

**Discovery** (PRD-110 live testing, March 2026):

The Microsoft Graph endpoint `/me/drive/sharedWithMe` returns items from **ALL drives** — both the user's personal OneDrive and any SharePoint document library drives. Each returned item carries a `remoteItem` facet with `parentReference.driveId` identifying the source drive.

This means PRD-110's "Shared with me" tab is already a **cross-provider** view that surfaces SharePoint items without any SharePoint-specific code.

**Key findings:**

1. **Unified API**: In OneDrive web (e.g., `pmcsoft-my.sharepoint.com`), "Shared" shows items from both OneDrive personal shares and SharePoint. The Graph API mirrors this unified view.

2. **Deprecation notice**: `/me/drive/sharedWithMe` is **deprecated** and will stop returning data after **November 2026**. The recommended replacement is `/me/shares`. Migration must be planned before that date.

3. **Permissions**: A `/sharedWithMe` request needs `Files.Read.All` to access shared items' content. Without it, some properties may be missing.

4. **SharePoint items identification**: When someone shares a SharePoint document library file, it appears in `/sharedWithMe` with a `driveId` pointing to the SharePoint site's document library drive. The item is browsable and downloadable via the same Graph API patterns (`GET /drives/{driveId}/items/{itemId}/content`).

**Architecture decision — two browsing approaches in the folder tree:**

| Section | What it shows | Source |
|---|---|---|
| **OneDrive** -> "My Files" | Personal drive files | `/drives/{userDriveId}/...` |
| **OneDrive** -> "Shared with me" | Cross-provider shared items (OneDrive + SharePoint) | `/me/drive/sharedWithMe` |
| **SharePoint** (PRD-111) | Only explicitly connected SharePoint sites/libraries | `/sites/{siteId}/drives/...` |

**Scope overlap**: A SharePoint file could appear both in OneDrive "Shared with me" AND in the SharePoint section. The sync engine uses `external_drive_id` + `external_id` as the canonical identity, so duplicate file records will NOT be created — the same file will be recognized regardless of the browsing path used.

**Future considerations** (out of scope for PRD-110/111):
- Browse by people, by meeting, by media (advanced features from OneDrive web)
- Migrate from `/me/drive/sharedWithMe` to `/me/shares` before Nov 2026

---

## 5. Implementation Order

### Step 1: SharePointService (2 days)
1. Implement site discovery (`GET /sites?search=*`)
2. Implement library listing (`GET /sites/{siteId}/drives`)
3. Implement folder browsing (reuse OneDrive patterns)
4. Implement delta query (reuse OneDrive patterns)
5. System library filtering (exclude "Site Assets", "Style Library", etc.)
6. Unit tests with mocked Graph API responses

### Step 2: OAuth + Connection Flow (0.5 day)
1. SharePoint-specific callback endpoint
2. MSAL auth with `Sites.Read.All` scope
3. Token storage in connection record
4. Unit test: OAuth flow state management

### Step 3: API Endpoints (1 day)
1. Site discovery endpoint
2. Library listing endpoint
3. Library/folder browse endpoint
4. Wire into existing scope/sync endpoints
5. Unit + integration tests

### Step 4: DeltaSyncService — Folder Filtering (0.5 day)
1. Add folder-path filtering for `scope_type='folder'` scopes
2. Unit tests: filter changes by parent path
3. Verify existing OneDrive sync still works (regression)

### Step 5: Frontend — Connection Wizard (2 days)
1. SharePoint-specific wizard steps (site picker, library picker)
2. Multi-level scope selection UI
3. Site search/filter
4. Library expansion with folder tree
5. Integration with connectionListStore

### Step 6: Frontend — Folder Tree + Visuals (1 day)
1. SharePoint root node with teal accent
2. Site and library virtual nodes
3. Breadcrumb SP-awareness
4. Context menu "Open in SharePoint"
5. Info banner for read-only SP files

---

## 6. Success Criteria

### Backend
- [ ] User can complete SharePoint OAuth flow with `Sites.Read.All` scope
- [ ] `GET /api/connections/:id/sites` returns accessible SharePoint sites
- [ ] `GET /api/connections/:id/sites/:siteId/libraries` returns document libraries
- [ ] System libraries (Site Assets, etc.) are filtered by default
- [ ] User can select sites, libraries, or folders as sync scopes
- [ ] Initial sync creates file records with `source_type='sharepoint'`
- [ ] External files process through pipeline to `ready` state
- [ ] Webhook subscriptions created per drive (one per library)
- [ ] Delta sync correctly filters changes for folder-scoped scopes
- [ ] All SharePoint sync uses the same webhook/polling infra as OneDrive
- [ ] All new code has unit tests

### Frontend
- [ ] SharePoint connection wizard guides through: connect -> sites -> libraries -> sync
- [ ] Site picker shows all accessible sites with search filter
- [ ] Library picker shows libraries per site with file count estimates
- [ ] SharePoint root appears in folder tree with teal accent
- [ ] Sites show Globe icon, libraries show BookOpen icon
- [ ] Breadcrumb shows "SharePoint > Site > Library > Folder" path
- [ ] Context menu shows "Open in SharePoint" for SP files
- [ ] Sync progress and status indicators work identically to OneDrive

### E2E Verification
1. New user -> Connect SharePoint -> See list of accessible sites
2. Select 2 sites with specific libraries -> Start sync
3. Verify files appear with `source_type='sharepoint'` and teal visual theme
4. Navigate folder tree: SharePoint > Site > Library > folders work correctly
5. RAG search returns content from SharePoint files
6. Add file to SharePoint library -> verify webhook triggers sync -> file appears
7. OneDrive integration still works after SharePoint addition (regression)
8. Both OneDrive and SharePoint files appear in same RAG search results

---

## 7. What Gets Reused vs What's New

| Component | Status | Notes |
|---|---|---|
| `IFileContentProvider` | Reused | Same interface, same `GraphApiContentProvider` |
| `ContentProviderFactory` | Reused | Already routes `sharepoint` -> `GraphApiContentProvider` |
| `GraphTokenManager` | Reused | Works with any connection record |
| `DeltaSyncService` | Extended | Add folder-path filtering for `scope_type='folder'` |
| `ExternalFileSyncWorker` | Reused | Same worker processes SP delta changes |
| `SubscriptionManager` | Reused | Subscriptions on `drives/{driveId}/root` — same for SP |
| `WebhookController` | Reused | Same endpoint receives SP notifications |
| `ConnectionManager` | Reused | Works with `provider='sharepoint'` |
| `syncStatusStore` | Reused | Same store tracks SP scope statuses |
| `SharePointService` | **NEW** | SP-specific: site discovery, library listing |
| SP OAuth callback | **NEW** | Separate callback for SP consent |
| SP Connection Wizard | **NEW** | Multi-step site/library picker |
| SP Folder Tree nodes | **NEW** | Site + library virtual nodes with teal theme |

**Estimated code reuse: ~70%** — the heavy infrastructure from PRD-100/101/108 pays off.

---

## 8. Risks & Mitigations (PRD-111 Specific)

| Risk | Mitigation |
|---|---|
| User has access to 100+ SharePoint sites | Paginated site discovery + search filter in wizard |
| Sites.Read.All is a high-privilege scope | Clear consent explanation in wizard. Only delegated (user's own access), not app-level. |
| Large libraries (50K+ files) in a site | Same batch processing as OneDrive. Progress indicators. Option to select subfolder instead of full library. |
| Multiple libraries per site = multiple subscriptions | Track subscription count per connection. Warn if >20 subscriptions. |
| Delta query returns all drive changes even for folder scopes | Filter in DeltaSyncService. Log filtered-out items for debugging. |
| SharePoint permissions change (user loses access to site) | Handle 403 errors gracefully. Update scope status to 'error'. Allow reconnection. |

---

## 9. Out of Scope

- SharePoint List data (non-file lists like Tasks, Calendars)
- SharePoint page content (.aspx pages)
- Cross-site search within SharePoint (each library is independent)
- SharePoint Online admin-level operations
- Writing back to SharePoint (create/update/delete files)
- SharePoint subsites (legacy model — deprecated by Microsoft)
