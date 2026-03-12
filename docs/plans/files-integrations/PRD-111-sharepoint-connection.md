# PRD-111: SharePoint Connection — Backend

**Phase**: SharePoint
**Status**: Implemented (commit 5ac405c, 2026-03-11)
**Prerequisites**: PRD-108 (Webhook Sync Engine), PRD-110 (Shared Files), PRD-112 (Scope Exclusion)
**Estimated Effort**: 4-5 days (backend only)
**Created**: 2026-03-05
**Revised**: 2026-03-11
**Frontend Companion**: [PRD-113](./PRD-113-sharepoint-frontend.md)

---

## 1. Objective

Enable the backend to connect to SharePoint via Microsoft Graph API, discover accessible sites, enumerate document libraries, browse folder contents, create sync scopes, and leverage the entire existing sync engine (delta queries, webhooks, folder hierarchy, scope exclusion) for SharePoint document libraries.

This PRD is **backend-only**. The frontend companion (PRD-113) handles UI, wizard, folder tree, and visual theming.

---

## 2. Current State (After PRD-112)

### What Exists and Works
- **Full OneDrive integration**: OAuth, browse, scope management, initial sync, delta sync, webhooks, scope exclusion
- **Abstraction layers** (from PRD-100):
  - `IFileContentProvider` with `GraphApiContentProvider` — uses `/drives/{driveId}/items/{id}/content` (works for ANY drive, including SharePoint)
  - `ContentProviderFactory` — already routes `'sharepoint'` → `GraphApiContentProvider`
  - `GraphTokenManager` — AES-256-GCM encryption, works with any connection record
- **Sync engine** (PRD-108):
  - `InitialSyncService` — full enumeration via delta query, folder hierarchy resolution, MIME filtering, batch upserts
  - `DeltaSyncService` — incremental sync with cursor, soft-delete, per-file WebSocket events
  - `ExternalFileSyncWorker` — BullMQ worker processing delta changes
  - `SubscriptionManager` — Graph webhook subscriptions per drive
  - `WebhookController` — receives notifications, triggers delta sync
- **Scope management** (PRD-105, PRD-112):
  - `ScopeCleanupService` — cascading scope removal (files, chunks, embeddings, subscriptions, citations)
  - Batch add/remove scopes
  - Include/exclude mode with cascading exclusion for folders
- **Shared files** (PRD-110):
  - `browse-shared` endpoints for `/me/drive/sharedWithMe`
  - `remoteDriveId` / `remoteItemId` support in ExternalFileItem and DB schema
- **Database schema**:
  - `connections` table with `microsoft_resource_id` field (unused — available for SharePoint)
  - `connection_scopes` with `scope_type` already supporting `'site'` and `'library'`
  - `files` table with `source_type` already supporting `'sharepoint'`
  - `FILE_SOURCE_TYPE.SHAREPOINT` constant defined in shared package
  - `PROVIDER_ID.SHAREPOINT` constant defined but unused
- **Folder hierarchy** (PRD-107):
  - `FolderHierarchyResolver` — depth-sorted upserts (parents before children), external-to-internal ID mapping
  - `ensureScopeRootFolder()` — creates root folder for scope
- **Deduplication** (PRD-104):
  - DB-level filtered unique index `UQ_files_connection_external` on `(connection_id, external_id)` WHERE NOT NULL
  - Prisma findFirst + create/update pattern (can't use `upsert` with filtered index)

### What's Unused but Prepared
- `PROVIDER_ID.SHAREPOINT` — defined in `@bc-agent/shared`
- `FILE_SOURCE_TYPE.SHAREPOINT` — defined in `@bc-agent/shared`
- `scope_type: 'site' | 'library'` — in Zod schemas and DB CHECK constraint
- `connections.microsoft_resource_id` — available for SharePoint site IDs

---

## 3. Lessons Learned from Previous PRDs

These discoveries from OneDrive development MUST be incorporated into the SharePoint implementation:

### 3.1 Sync Bugs (PRD-104 — CRITICAL)

**Problem**: Initial sync ignored folder scopes and synced the entire drive.
**Root cause**: Delta query was always executed at drive root, not scoped to the selected folder.
**Fix applied**: `OneDriveService.executeFolderDeltaQuery()` uses `/drives/{driveId}/items/{folderId}/delta`.
**SharePoint implication**: SharePoint has the same per-folder delta endpoint. `SharePointService` MUST use folder-scoped delta for `scope_type='folder'` scopes.

**Problem**: Re-sync created duplicate files because there was no dedup guard.
**Root cause**: No unique constraint on `(connection_id, external_id)`.
**Fix applied**: Filtered unique index at DB level + findFirst/create pattern.
**SharePoint implication**: Same index works — SharePoint files stored with `source_type='sharepoint'` and same `connection_id`. No additional dedup logic needed.

### 3.2 Folder Hierarchy (PRD-107)

**Problem**: Flat file list — no folder structure in sidebar.
**Root cause**: Folders were not being created as `is_folder=true` records with `parent_folder_id`.
**Fix applied**: `FolderHierarchyResolver` builds folder map, sorts by depth, upserts parents before children.
**SharePoint implication**: Same resolver works. SharePoint items have identical `parentReference` structure in Graph API. Library root must be created as scope root folder.

**Problem**: Scope root folder was not created during folder-scoped sync.
**Fix applied**: `ensureScopeRootFolder()` creates the root folder record before processing children.
**SharePoint implication**: For `scope_type='library'`, the library root is the scope root. For `scope_type='folder'`, the selected folder is root. For `scope_type='site'`, each library within the site needs its own virtual root.

### 3.3 File Type Validation (PRD-106)

**Problem**: Unsupported MIME types (images, videos, executables) were processed through the full pipeline.
**Fix applied**: `isSupportedFileType()` filter in `InitialSyncService` before enqueuing.
**SharePoint implication**: Same filter applies. SharePoint libraries may contain additional file types (`.aspx` pages, `.one` notebooks) that should be filtered. Ensure `.aspx` and `.one` are in the unsupported list.

### 3.4 Scope Cleanup Complexity (PRD-109)

**Problem**: Full disconnect has 6 cascading cleanup steps.
**Fix**: `ScopeCleanupService` handles each step with non-fatal error handling.
**SharePoint implication**: Same cleanup service works — it operates on connection/scope IDs, not provider-specific logic. However, SharePoint connections may have MORE scopes (multiple sites × multiple libraries) so cleanup must be efficient.

### 3.5 Scope Exclusion Cascading (PRD-112)

**Problem**: Excluding a folder should exclude all its children, but new files added later could bypass exclusion.
**Fix**: `InitialSyncService` checks exclusion scopes by path prefix before upserting.
**SharePoint implication**: Same path-based exclusion works. SharePoint paths use the same format (`/drives/{driveId}/root:/path/to/folder`).

### 3.6 Shared Items Cross-Provider (PRD-110)

**Discovery**: `/me/drive/sharedWithMe` returns items from ALL drives — OneDrive personal AND SharePoint document libraries. Each item has `remoteItem.parentReference.driveId` identifying the source.
**SharePoint implication**: "Shared with me" is already cross-provider. A SharePoint file shared with the user appears in the existing shared view WITHOUT any SharePoint-specific code. The `remoteDriveId` field correctly identifies the SharePoint library drive.

### 3.7 OAuth Scope Considerations

**Discovery**: OneDrive uses `Files.Read.All`. SharePoint additionally needs `Sites.Read.All` for site discovery.
**Key constraint**: `Sites.Read.All` is a HIGH-PRIVILEGE delegated scope — it grants read access to ALL sites the user can access (which Microsoft enforces — we don't need to filter by permission).
**Design decision**: Use SEPARATE OAuth flows for OneDrive and SharePoint. This allows:
  - Users to connect only OneDrive without granting Sites.Read.All
  - Incremental consent — SharePoint consent is additive
  - Separate token storage and refresh cycles

### 3.8 Wizard Complexity (PRD-102)

**Discovery**: The OneDrive wizard had multiple bugs discovered only during manual testing (tree loading states, scope selection inconsistencies, error boundaries).
**SharePoint implication**: The SharePoint wizard is MORE complex (3-level hierarchy). Frontend PRD-113 must account for thorough error handling. Backend must provide clear error responses for each level (site listing, library listing, folder browsing).

---

## 4. Microsoft Graph API — SharePoint Specifics

### 4.1 Unified Drive Model

The Graph API treats OneDrive and SharePoint document libraries through the **same drive/driveItem model**:

| OneDrive | SharePoint Equivalent |
|---|---|
| `GET /me/drive` | `GET /sites/{siteId}/drive` (default doc library) |
| `GET /me/drive/root/children` | `GET /sites/{siteId}/drive/root/children` |
| `GET /me/drive/root/delta` | `GET /drives/{libraryDriveId}/root/delta` |
| `GET /drives/{driveId}/items/{id}/content` | Same — works for any drive |

**Key insight**: Once you have a `driveId`, all operations are identical. The only difference is how you discover that `driveId`:
- OneDrive: from user's profile (`/me/drive`)
- SharePoint: from site enumeration (`/sites/{siteId}/drives`)

### 4.2 SharePoint Resource Hierarchy

```
Microsoft 365 Tenant
├── Site: "Marketing"           (composite site-id)
│   ├── Drive: "Documents"      (drive-id)   ← Default doc library
│   │   ├── 📁 Campaigns/
│   │   └── 📁 Brand Assets/
│   ├── Drive: "Shared Files"   (drive-id)   ← Additional library
│   └── Drive: "Site Assets"    (drive-id)   ← System library (filter out)
│
├── Site: "Engineering"         (composite site-id)
│   ├── Drive: "Documents"      (drive-id)
│   └── Drive: "Wiki"           (drive-id)
│
└── Site: "HR Portal"           (composite site-id)
    └── Drive: "Policies"       (drive-id)
```

**Site ID format**: Composite `{hostname},{siteCollectionId},{webId}` (e.g., `contoso.sharepoint.com,da60e844-ba1d-49bc-b4d4-d5e36bae9019,712a596e-90a1-49e3-9b48-bfa80bee8740`).

### 4.3 Site Discovery Endpoints

| Endpoint | Permissions | Notes |
|---|---|---|
| `GET /sites?search=*` | `Sites.Read.All` (delegated) | Returns all searchable sites. Free text search. |
| `GET /me/followedSites` | `Sites.Read.All` (delegated) | Only sites user explicitly followed. |
| `GET /sites/{siteId}/drives` | `Files.Read` (minimum) | All document libraries for a site. |
| `GET /sites/{siteId}/drives?$select=*,system` | Same | Include system/hidden drives. |

**Filtering system libraries**: Drives with a `system` facet (e.g., "Site Assets", "Style Library") should be hidden by default. Names to filter: `"Site Assets"`, `"Style Library"`, `"appdata"`, `"Preservation Hold Library"`.

### 4.4 Delta Sync Compatibility

SharePoint delta queries use the EXACT same pattern as OneDrive:
- `GET /drives/{driveId}/root/delta` — all items in drive
- `GET /drives/{driveId}/items/{folderId}/delta` — folder-scoped
- Response: `@odata.nextLink` (pagination) or `@odata.deltaLink` (cursor)
- Token expiry: HTTP 410 Gone → fall back to full resync

**Differences**:
- SharePoint supports timestamp-based tokens (`?token=2026-03-11T00:00:00Z`); OneDrive consumer does not
- SharePoint omits `ctag` on created items (OneDrive doesn't)
- Both omit `ctag`, `size` on deleted items

These differences don't affect our sync logic since we track by `id` and `eTag`.

### 4.5 Webhook Subscriptions for SharePoint

Same subscription model as OneDrive:
```
POST /subscriptions
{
  "resource": "drives/{driveId}/root",
  "changeType": "updated",
  "notificationUrl": "{webhookUrl}",
  "expirationDateTime": "...",
  "clientState": "{secret}"
}
```

- Subscriptions are per-DRIVE (per document library), not per-site
- Same max expiration: ~29.4 days
- Same lifecycle notifications: `reauthorizationRequired`, `subscriptionRemoved`
- Same validation handshake on creation

**Important**: A site with 5 document libraries = 5 subscriptions. A user syncing 3 sites with average 3 libraries each = 9 subscriptions. The `SubscriptionManager` already handles this per-scope.

### 4.6 Required Permissions

| Operation | Minimum Delegated Permission |
|---|---|
| Search/list sites | `Sites.Read.All` |
| List document libraries | `Files.Read` (with site access) |
| Browse/download files | `Files.Read` (with site access) |
| Delta query on drives | `Files.Read` (with site access) |
| Create webhook subscriptions | `Files.Read` (with site access) |
| List followed sites | `Sites.Read.All` |

**OAuth scopes for SharePoint connection**: `['Sites.Read.All', 'Files.Read.All', 'offline_access']`

Note: `Files.Read.All` is already granted for OneDrive. If the user has both connections, the tokens may share this scope. `Sites.Read.All` is the only NEW scope needed.

### 4.7 User File Organization Patterns in SharePoint

All patterns that must be supported:

| Pattern | Discovery Method | Drive Source |
|---|---|---|
| SharePoint team sites (M365 Group) | `GET /sites?search=*` | `GET /sites/{id}/drives` |
| SharePoint communication sites | `GET /sites?search=*` | `GET /sites/{id}/drives` |
| Multiple document libraries per site | `GET /sites/{id}/drives` | Each drive is separate |
| Folder hierarchies within libraries | `GET /drives/{id}/root/children` | Standard drill-down |
| Shared items from SP sites | `/me/drive/sharedWithMe` (PRD-110) | `remoteDriveId` identifies source |
| Hub sites | No special Graph property | Treated as regular sites |

**NOT supported** (out of scope):
- SharePoint lists (non-document lists like Tasks, Calendars)
- SharePoint page content (`.aspx` pages)
- Subsites (legacy model — deprecated by Microsoft)
- Personal sites (`isPersonalSite: true` — these ARE OneDrive, filter them out)

---

## 5. Database Schema Changes

### 5.1 Connections Table — No Changes

The existing `connections` table already has all needed fields:

| Field | Usage for SharePoint |
|---|---|
| `provider` | `'sharepoint'` (already in CHECK constraint) |
| `microsoft_resource_id` | **Unused currently** — will store the primary site ID (first selected site) for quick access. Null if multiple sites. |
| `microsoft_drive_id` | **Will NOT be set** for SharePoint (unlike OneDrive which stores the user's drive). SharePoint has multiple drives — they're tracked in `connection_scopes`. |
| `microsoft_tenant_id` | Same Microsoft tenant as OneDrive. |
| `msal_home_account_id` | MSAL cache key for SharePoint tokens. |
| `access_token_encrypted` / `refresh_token_encrypted` | SharePoint OAuth tokens. |
| `scopes_granted` | `'Sites.Read.All Files.Read.All offline_access'` |

**Unique constraint**: `(user_id, provider)` — one SharePoint connection per user. Multiple sites are tracked via scopes.

### 5.2 Connection Scopes — SharePoint Scope Types

Existing scope types and their SharePoint usage:

| scope_type | external_id (scope_resource_id) | remote_drive_id | display_name | sync behavior |
|---|---|---|---|---|
| `site` | SharePoint site composite ID | NULL | Site display name | Sync ALL libraries in the site. Creates one subscription per library drive. |
| `library` | Library drive ID | NULL | "Library Name (Site Name)" | Sync one document library. One subscription on this drive. |
| `folder` | DriveItem folder ID | Library drive ID | "Folder (Site/Library)" | Sync one folder. Subscription on parent drive, filter by path. |

**New column needed**: `scope_site_id` (NVarChar(500), nullable) — stores the SharePoint site composite ID for library and folder scopes. Needed for:
- API routing (site context required for library listing)
- Display in frontend (grouping scopes by site)
- Resolving which site a library belongs to

**Alternative**: Store site ID in `scope_path` as a structured prefix. But a dedicated column is cleaner and avoids parsing.

### 5.3 Files Table — No Changes

SharePoint files use the same fields as OneDrive:

| Field | SharePoint Value |
|---|---|
| `source_type` | `'sharepoint'` |
| `connection_id` | SharePoint connection UUID |
| `connection_scope_id` | Scope UUID (site, library, or folder) |
| `external_id` | DriveItem ID from Graph API |
| `external_drive_id` | Library drive ID |
| `external_url` | `webUrl` from Graph API |
| `external_modified_at` | `lastModifiedDateTime` from Graph API |
| `content_hash_external` | `eTag` from Graph API |

The filtered unique index `UQ_files_connection_external` works for SharePoint too — dedup by `(connection_id, external_id)`.

---

## 6. Service Design

### 6.1 SharePointService

**Location**: `backend/src/services/connectors/sharepoint/SharePointService.ts`

```typescript
import { createChildLogger } from '@/shared/utils/logger';
import type { GraphHttpClient } from '@/services/connectors/graph/GraphHttpClient';
import type { ExternalFileItem, FolderListResult, DeltaQueryResult } from '@bc-agent/shared';

export interface SharePointSite {
  siteId: string;          // Composite ID (hostname,siteCollectionId,webId)
  displayName: string;
  description: string | null;
  webUrl: string;
  isPersonalSite: boolean;
  lastModifiedAt: string;
}

export interface SharePointLibrary {
  driveId: string;
  displayName: string;
  description: string | null;
  webUrl: string;
  itemCount: number;
  sizeBytes: number;
  isSystemLibrary: boolean;
}

export class SharePointService {
  private logger = createChildLogger({ service: 'SharePointService' });

  constructor(private graphClient: GraphHttpClient) {}

  /**
   * Discover SharePoint sites accessible to the user.
   * Filters out personal sites (isPersonalSite=true — those are OneDrive).
   * Paginates for large tenants.
   */
  async discoverSites(
    connectionId: string,
    searchQuery?: string,
    pageToken?: string
  ): Promise<{ sites: SharePointSite[]; nextPageToken: string | null }>;

  /**
   * Get user's followed (favorited) sites.
   * Subset of all accessible sites — the ones user explicitly follows.
   */
  async getFollowedSites(connectionId: string): Promise<SharePointSite[]>;

  /**
   * List document libraries for a specific site.
   * Filters out system libraries by default.
   */
  async getLibraries(
    connectionId: string,
    siteId: string,
    includeSystem?: boolean
  ): Promise<SharePointLibrary[]>;

  /**
   * Browse folder contents within a library drive.
   * Reuses ExternalFileItem type — same shape as OneDrive items.
   */
  async browseFolder(
    connectionId: string,
    driveId: string,
    folderId?: string,
    pageToken?: string
  ): Promise<FolderListResult>;

  /**
   * Execute delta query on a library drive.
   * Same endpoint as OneDrive: GET /drives/{driveId}/root/delta
   * Reuses DeltaQueryResult type.
   */
  async executeDeltaQuery(
    connectionId: string,
    driveId: string,
    deltaLink?: string
  ): Promise<DeltaQueryResult>;

  /**
   * Execute folder-scoped delta query.
   * Same as OneDrive: GET /drives/{driveId}/items/{folderId}/delta
   * LESSON: PRD-104 — always use folder-scoped delta for folder scopes.
   */
  async executeFolderDeltaQuery(
    connectionId: string,
    driveId: string,
    folderId: string,
    deltaLink?: string
  ): Promise<DeltaQueryResult>;
}
```

**System library detection**: Filter by known system library names AND the `system` facet:
```typescript
const SYSTEM_LIBRARY_NAMES = new Set([
  'Site Assets', 'Style Library', 'appdata',
  'Preservation Hold Library', 'Form Templates',
  'Site Pages', 'SiteAssets',
]);

function isSystemLibrary(drive: GraphDriveResponse): boolean {
  return drive.system != null || SYSTEM_LIBRARY_NAMES.has(drive.name);
}
```

### 6.2 OAuth Flow

**Pattern**: Same as OneDrive (PRD-101) with different scopes.

```typescript
// SharePoint OAuth configuration
const SP_SCOPES = ['Sites.Read.All', 'Files.Read.All', 'offline_access'];

// Routes (in backend/src/routes/connections.ts or new sharepoint-auth.ts):
// POST /api/connections/sharepoint/auth/initiate → MSAL auth URL
// GET  /api/auth/callback/sharepoint            → Token exchange + connection creation
```

**Token storage**: Same `connections` table, `provider='sharepoint'`, tokens encrypted via `GraphTokenManager`.

**MSAL cache**: Same `MsalRedisCachePlugin`, keyed by `msal_home_account_id`. If the same Microsoft account is used for both OneDrive and SharePoint, MSAL handles token caching internally — but connection records are separate.

### 6.3 Sync Integration — Reuse Pattern

The key insight: **InitialSyncService and DeltaSyncService are provider-agnostic**. They work with `connection_scopes` and `driveId` — not with provider-specific logic.

| Component | Reuse Status | SharePoint Adaptation |
|---|---|---|
| `InitialSyncService` | **100% reuse** | No changes. Works with any scope that has a `driveId`. |
| `DeltaSyncService` | **100% reuse** | No changes. Same delta query pattern. |
| `FolderHierarchyResolver` | **100% reuse** | Same Graph API `parentReference` structure. |
| `ScopeCleanupService` | **100% reuse** | Same cascading cleanup logic. |
| `SubscriptionManager` | **100% reuse** | Same webhook subscription model. |
| `ExternalFileSyncWorker` | **100% reuse** | Same BullMQ worker. |
| `GraphApiContentProvider` | **100% reuse** | Same download endpoint. |
| `GraphTokenManager` | **100% reuse** | Same token refresh. |

**What's new**:
- `SharePointService` — site discovery and library listing
- OAuth endpoints for SharePoint
- API endpoints for site/library browsing
- Scope-site association logic (which scopes belong to which site)

### 6.4 Site-Scope Sync Strategy

When a user selects a `site`-level scope:

1. Enumerate all non-system libraries: `GET /sites/{siteId}/drives`
2. For each library, create a child scope of type `library` (or handle internally)
3. Run `InitialSyncService.syncScope()` for each library drive
4. Create webhook subscription for each library drive

**Design choice**: We do NOT create sub-scopes automatically. A `site` scope means "sync everything in this site." The sync service will enumerate libraries at sync time and handle them internally. This avoids scope explosion (a site with 10 libraries doesn't create 10 scope records).

**Implementation**:
```typescript
// In InitialSyncService, when scope.scope_type === 'site':
// 1. Get all libraries for the site
// 2. For each library, execute delta query and process files
// 3. All files point to the same site-level scope (connection_scope_id)
// 4. external_drive_id distinguishes which library each file came from
```

### 6.5 Handling Site-Level Subscriptions

For `site`-level scopes, subscriptions must be created per library drive:
- The scope has ONE `subscription_id` field — not enough for multiple drives
- **Solution**: Use the existing `subscription_id` for the first/default library. Additional subscriptions tracked via a mapping approach.

**Option A (Simple)**: Create separate `library` scopes for each drive within a site scope. Pros: clean subscription tracking. Cons: scope explosion.

**Option B (Recommended)**: Add a `subscriptions` JSON column to `connection_scopes` for site-level scopes that need multiple subscriptions. Or use a lightweight `scope_subscriptions` association table.

**Recommended approach**: For MVP, automatically expand `site` scopes into individual `library` scopes at creation time. This reuses existing per-scope subscription tracking without schema changes. The frontend (PRD-113) groups these library scopes visually under their parent site.

---

## 7. API Endpoints

### 7.1 New Endpoints

| Method | Path | Description | Response |
|---|---|---|---|
| `POST` | `/api/connections/sharepoint/auth/initiate` | Start SP OAuth flow | `{ authUrl: string }` |
| `GET` | `/api/auth/callback/sharepoint` | SP OAuth callback | Redirect to frontend |
| `GET` | `/api/connections/:id/sites` | List accessible SP sites | `{ sites: SharePointSite[], nextPageToken }` |
| `GET` | `/api/connections/:id/sites/:siteId/libraries` | List document libraries | `{ libraries: SharePointLibrary[] }` |
| `GET` | `/api/connections/:id/sites/:siteId/libraries/:driveId/browse` | Browse library root | `FolderListResult` |
| `GET` | `/api/connections/:id/sites/:siteId/libraries/:driveId/browse/:folderId` | Browse subfolder | `FolderListResult` |

### 7.2 Reused Endpoints (No Changes)

| Method | Path | SharePoint Usage |
|---|---|---|
| `GET` | `/api/connections` | Lists all connections (includes SP) |
| `GET` | `/api/connections/:id` | SP connection detail |
| `GET` | `/api/connections/:id/scopes` | SP scopes (sites/libraries/folders) |
| `POST` | `/api/connections/:id/scopes` | Create SP scopes |
| `POST` | `/api/connections/:id/scopes/batch` | Batch add/remove SP scopes |
| `DELETE` | `/api/connections/:id/scopes/:scopeId` | Delete SP scope (cascade) |
| `POST` | `/api/connections/:id/scopes/:scopeId/sync` | Trigger SP sync |
| `GET` | `/api/connections/:id/sync-status` | SP scope sync statuses |
| `GET` | `/api/connections/:id/disconnect-summary` | SP disconnect preview |
| `DELETE` | `/api/connections/:id/full-disconnect` | SP full disconnect |

### 7.3 Validation Schemas

New schemas for SharePoint-specific params:

```typescript
// In onedrive.schemas.ts (rename to graph.schemas.ts or add new file)
export const siteIdParamSchema = z.object({
  siteId: z.string().min(1, 'Site ID is required'),
  // Site IDs are composite: hostname,guid,guid — not UUID format
});

export const libraryBrowseParamSchema = z.object({
  siteId: z.string().min(1),
  driveId: z.string().min(1),
  folderId: z.string().optional(),
});

export const siteSearchQuerySchema = z.object({
  search: z.string().max(200).optional(),
  pageToken: z.string().optional(),
});
```

---

## 8. Shared Package Changes

### 8.1 New Types (`packages/shared/src/types/sharepoint.types.ts`)

```typescript
/**
 * SharePoint Site discovery result.
 */
export interface SharePointSite {
  siteId: string;
  displayName: string;
  description: string | null;
  webUrl: string;
  isPersonalSite: boolean;
  lastModifiedAt: string;
}

/**
 * SharePoint Document Library (drive within a site).
 */
export interface SharePointLibrary {
  driveId: string;
  displayName: string;
  description: string | null;
  webUrl: string;
  itemCount: number;
  sizeBytes: number;
  isSystemLibrary: boolean;
  siteId: string;    // Parent site reference
  siteName: string;  // Parent site display name
}
```

### 8.2 Existing Types — No Changes

- `ExternalFileItem` — already supports SharePoint (same Graph API shape)
- `FolderListResult` — same pagination shape
- `DeltaQueryResult` — same delta response shape
- `ConnectionSummary` — already supports any provider
- `ConnectionScopeDetail` — `scopeType` already allows 'site'/'library'
- All `Sync*Payload` types — provider-agnostic (use `connectionId`/`scopeId`)

### 8.3 Schema Rename Consideration

Currently: `packages/shared/src/schemas/onedrive.schemas.ts`
The scope schemas (`createScopesSchema`, `batchScopesSchema`) are provider-agnostic — they work for SharePoint too.

**Option**: Rename to `connection.schemas.ts` or `scope.schemas.ts`.
**Decision**: Keep current name for now (avoid breaking imports). Add SharePoint-specific schemas alongside. Rename is a separate cleanup task.

---

## 9. Implementation Order

### Step 1: Schema & Types (0.5 day)

1. Add `scope_site_id` column to `connection_scopes` table (Prisma schema + db push)
2. Create `packages/shared/src/types/sharepoint.types.ts` with SharePointSite and SharePointLibrary
3. Add new Zod schemas for SharePoint API params
4. Export from shared package index
5. Run `npm run build:shared` to verify

### Step 2: SharePointService (1.5 days)

1. Create `backend/src/services/connectors/sharepoint/SharePointService.ts`
2. Implement `discoverSites()` — `GET /sites?search=*` with pagination, filter `isPersonalSite`
3. Implement `getFollowedSites()` — `GET /me/followedSites`
4. Implement `getLibraries()` — `GET /sites/{siteId}/drives` with system library filtering
5. Implement `browseFolder()` — reuse OneDrive browse pattern via `/drives/{driveId}/...`
6. Implement `executeDeltaQuery()` and `executeFolderDeltaQuery()` — same as OneDrive
7. Unit tests with mocked Graph API responses:
   - Site discovery (normal, empty, paginated, personal site filtering)
   - Library listing (normal, system library filtering)
   - Folder browsing (root, subfolder, pagination)
   - Delta query (initial, incremental, 410 Gone fallback)

### Step 3: OAuth Flow (0.5 day)

1. Add SharePoint OAuth routes (initiate + callback)
2. MSAL auth with `Sites.Read.All` + `Files.Read.All` scopes
3. Token storage in `connections` table (`provider='sharepoint'`)
4. Handle duplicate connection guard (unique constraint on user_id + provider)
5. Unit test: OAuth state management, token encryption

### Step 4: API Endpoints (1 day)

1. Add site discovery endpoint: `GET /api/connections/:id/sites`
2. Add library listing endpoint: `GET /api/connections/:id/sites/:siteId/libraries`
3. Add library browse endpoints (root + subfolder)
4. Wire SharePointService into routes with ownership validation
5. Verify existing scope/sync endpoints work for SharePoint scopes
6. Integration tests:
   - Site discovery with ownership validation
   - Library listing with system library filtering
   - Scope creation with `scope_type='library'`
   - Sync trigger for library scope

### Step 5: Sync Verification (0.5 day)

1. Verify `InitialSyncService` works with SharePoint library scopes
2. Verify `DeltaSyncService` works with SharePoint delta cursors
3. Verify `FolderHierarchyResolver` handles SharePoint parent references
4. Verify `SubscriptionManager` creates webhooks on SharePoint drives
5. Verify `ScopeCleanupService` cascades correctly for SharePoint scopes
6. Verify dedup index works for SharePoint files
7. Regression test: OneDrive sync still works after changes

### Step 6: Site-Level Scope Expansion (0.5 day)

1. Implement scope expansion: when `scope_type='site'`, auto-create library scopes
2. Each library scope gets its own subscription via `SubscriptionManager`
3. Populate `scope_site_id` on all library/folder scopes
4. Unit tests for scope expansion logic
5. Verify cleanup cascades correctly (delete site scope → libraries cleaned up)

---

## 10. Success Criteria (Backend Only)

### API
- [ ] `POST /api/connections/sharepoint/auth/initiate` returns valid MSAL auth URL
- [ ] OAuth callback creates connection with `provider='sharepoint'`, encrypted tokens
- [ ] `GET /api/connections/:id/sites` returns accessible SharePoint sites (personal filtered out)
- [ ] `GET /api/connections/:id/sites/:siteId/libraries` returns document libraries (system filtered)
- [ ] `GET .../libraries/:driveId/browse` returns folder contents with correct `ExternalFileItem` shape
- [ ] Scope creation works for `site`, `library`, and `folder` scope types
- [ ] Site-level scopes expand to library scopes automatically

### Sync
- [ ] Initial sync creates file records with `source_type='sharepoint'`
- [ ] Folder hierarchy is correctly built (parents before children)
- [ ] Scope root folder is created for library and folder scopes
- [ ] File type validation filters unsupported SharePoint file types (`.aspx`, `.one`)
- [ ] Dedup works — re-sync doesn't create duplicate files
- [ ] Exclusion scopes work for SharePoint folders
- [ ] Delta sync correctly processes incremental changes
- [ ] 410 Gone response triggers full resync

### Webhooks
- [ ] Webhook subscriptions created per library drive
- [ ] Webhook notifications trigger `DeltaSyncService` for correct scope
- [ ] Subscription renewal works for SharePoint drives

### Cleanup
- [ ] Scope deletion cascades: files → chunks → embeddings → citations → subscription
- [ ] Full disconnect cleans up all SharePoint scopes, tokens, and MSAL cache
- [ ] WebSocket `connection:disconnected` emitted

### Tests
- [ ] Unit tests for `SharePointService` (all methods)
- [ ] Unit tests for OAuth flow
- [ ] Unit tests for site-level scope expansion
- [ ] Integration tests for API endpoints
- [ ] Regression: OneDrive sync unaffected

---

## 11. What Gets Reused vs What's New

| Component | Status | Notes |
|---|---|---|
| `GraphApiContentProvider` | **100% reuse** | Same `/drives/{id}/items/{id}/content` |
| `ContentProviderFactory` | **100% reuse** | Already routes `'sharepoint'` |
| `GraphTokenManager` | **100% reuse** | Any connection record |
| `GraphHttpClient` | **100% reuse** | Any Graph API call |
| `GraphRateLimiter` | **100% reuse** | Per-tenant limiting |
| `InitialSyncService` | **100% reuse** | Works with any driveId |
| `DeltaSyncService` | **100% reuse** | Same delta pattern |
| `FolderHierarchyResolver` | **100% reuse** | Same parentReference |
| `ScopeCleanupService` | **100% reuse** | Provider-agnostic |
| `SubscriptionManager` | **100% reuse** | Per-drive subscriptions |
| `ExternalFileSyncWorker` | **100% reuse** | Same BullMQ worker |
| `WebhookController` | **100% reuse** | Same notification format |
| `ConnectionRepository` | **Minor extension** | Add `scope_site_id` field |
| `ConnectionService` | **Minor extension** | Add site-scope expansion |
| `SharePointService` | **NEW** | Site discovery + library listing |
| OAuth routes | **NEW** | SP-specific auth flow |
| API routes | **NEW** | Site/library browse endpoints |

**Estimated new code**: ~30% of total (service + routes + tests). ~70% reuse.

---

## 12. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| User has 100+ accessible sites | Medium | Medium | Paginated site discovery + search filter. Frontend search in PRD-113. |
| `Sites.Read.All` consent concerns | Medium | High | Clear explanation in wizard. Delegated scope = user's own access only. |
| Large libraries (50K+ files) | Low | High | Same batch processing + progress indicators as OneDrive. |
| Multiple subscriptions per site | High | Medium | Track subscription count. Warn if >20 total subscriptions. |
| Site-scope expansion creates many library scopes | Medium | Medium | Limit to 20 libraries per site. Warn user if site has more. |
| SharePoint permissions change (user loses site access) | Medium | Medium | Handle 403 gracefully. Update scope status to `'error'`. Allow re-auth. |
| Composite site IDs are long (500+ chars) | High | Low | `scope_site_id` is NVarChar(500). `siteId` param validated as non-empty string (not UUID). |
| `/sharedWithMe` deprecation (Nov 2026) | Certain | High | Tracked separately. Not blocking for PRD-111 (uses direct site access). |
| OneDrive and SharePoint share same MSAL account | High | Low | Separate `connections` records. MSAL cache handles internally. No conflict. |

---

## 13. Out of Scope

- SharePoint List data (non-document lists like Tasks, Calendars)
- SharePoint page content (`.aspx` pages — filtered as unsupported)
- SharePoint subsites (legacy model, deprecated by Microsoft)
- SharePoint Online admin-level operations
- Writing back to SharePoint (create/update/delete files)
- Cross-site search (each library syncs independently)
- SharePoint hub site metadata (no Graph API property — treated as regular sites)
- Frontend UI (see [PRD-113](./PRD-113-sharepoint-frontend.md))
- `/me/drive/sharedWithMe` → `/me/shares` migration (separate future PRD)

---

## 14. Post-Implementation Notes

### 14.1 AADSTS50011 — Redirect URI Not Registered (2026-03-12)

**Symptom:** SharePoint OAuth callback returned `AADSTS50011: The redirect URI 'https://app-bcagent-backend-dev.../api/auth/callback/sharepoint' specified in the request does not match the redirect URIs configured for the application`.

**Root cause:** The Azure AD App Registration only had 2 redirect URIs registered (for the main login flow). OneDrive worked via the fast-path (`acquireTokenSilent`) which doesn't need a redirect URI, masking the missing registration. SharePoint required explicit consent for `Sites.Read.All`, triggering the full OAuth redirect which exposed the gap.

**Fix:**
1. Created `infrastructure/scripts/setup-app-registration.sh` — idempotent IaC for App Registration
2. Removed BC scope from login flow (incremental consent: `LOGIN_SCOPES` without `Financials.ReadWrite.All`)
3. Registered all 6 redirect URIs (3 localhost + 3 production)
4. See `infrastructure/README.md` for ongoing App Registration management

### 14.2 Scope Cleanup — GRAPH_SCOPES Naming Conflict (2026-03-12)

Renamed the two conflicting `GRAPH_SCOPES` objects:
- `@bc-agent/shared` → `GRAPH_API_SCOPES` (connector permission strings: `Files.Read.All`, `Sites.Read.All`)
- `backend/microsoft.types.ts` → `AUTH_BASE_SCOPES` (OIDC scopes: `openid`, `profile`, etc.) — now unexported

Connector code now uses `GRAPH_API_SCOPES` from shared package instead of hardcoded strings.

### 14.3 `driveId: null` — Folder Scopes Missing `remoteDriveId` (2026-03-12)

**Symptom:** SharePoint sync fails with `drives/null/items/.../delta` → 400 error for folder scopes.

**Root cause:** The frontend `SharePointWizard` had the `driveId` available in `selectedFolders` state but did NOT include `remoteDriveId` in the batch scope payload sent to the API. The backend resolution logic in `InitialSyncService` and `DeltaSyncService` fell through to `null`.

**Fix:**
1. Frontend: Added `remoteDriveId: info.driveId` to folder scope objects in `SharePointWizard.tsx`
2. Backend: Added explicit null guard for `effectiveDriveId` in both `InitialSyncService` and `DeltaSyncService` that throws a descriptive error instead of silently passing `null`

### 14.4 Pagination Loop Using OneDrive Service for SharePoint (2026-03-12)

**Symptom:** Multi-page delta queries for SharePoint libraries silently used the OneDrive service for pagination, which does not pass the explicit `driveId` required by SharePoint.

**Root cause:** The `while (nextPageLink)` pagination loops in both `InitialSyncService` and `DeltaSyncService` unconditionally called `getOneDriveService().executeDeltaQuery()` regardless of the connection provider.

**Fix:** Added provider-aware branching in both pagination loops: SharePoint connections use `getSharePointService().executeDeltaQuery(connectionId, effectiveDriveId, nextPageLink)`, OneDrive connections continue using the existing path.

### 14.5 `itemCount` Hardcoded to 0 (2026-03-12)

**Symptom:** Libraries in the SharePoint wizard always showed "0 items, {size}".

**Root cause:** `SharePointService.getLibraries()` hardcoded `itemCount: 0`. The Graph API `/sites/{siteId}/drives` response includes `quota.fileCount` (tenant-dependent).

**Fix:**
1. Changed `itemCount` type from `number` to `number | null` in `SharePointLibrary` interface
2. Backend extracts `quota.fileCount` when available, falls back to `null`
3. Frontend conditionally displays count only when non-null

### 14.6 Files Hidden in Wizard Folder Tree (2026-03-12)

**Symptom:** Only folders were visible when expanding libraries in the SharePoint wizard. Files were fetched from the API but filtered out before rendering.

**Root cause:** Three `.filter(item => item.isFolder)` calls in `SharePointWizard.tsx` (in `handleToggleLibraryExpand`, `handleToggleFolderExpand`, and children rendering) plus a `return null` guard in `LibFolderNode` for non-folder items.

**Fix:**
1. Removed all three folder-only filters
2. Added file leaf node rendering in `LibFolderNode` with typed file icons (reusing `file-type-utils`), file name, and size display
3. Files are non-expandable and non-selectable (display-only)

### 14.7 Tri-State Selection Deferred (2026-03-12)

OneDrive's `ConnectionWizard` implements full include/exclude cascade with `getEffectiveCheckState()` and recursive traversal. SharePoint uses simple on/off toggles per folder for now. Deferred to [PRD-115](./PRD-115-sharepoint-scope-inheritance.md) as a separate PR.

### 14.8 Duplicate Sync Trigger Fix

Both SharePointWizard and ConnectionWizard (OneDrive) had a bug where selecting new include scopes triggered sync **twice**:

1. `POST /scopes/batch` — backend `batchUpdateScopes()` creates scope AND calls `syncScope()` internally
2. `POST /scopes/{id}/sync` — frontend explicitly called sync again after the batch response

This caused a race condition in `ensureScopeRootFolder` where two concurrent `_runSync` calls both attempted to create the same root folder row, with the second failing on `UQ_files_connection_external` unique constraint.

**Fix (frontend):** Removed the redundant `/sync` POST calls from both wizards. The batch endpoint already triggers sync for each new include scope.

**Fix (backend, defense-in-depth):** `ensureScopeRootFolder` in `FolderHierarchyResolver.ts` now catches Prisma P2002 (unique constraint violation) errors, re-queries the existing folder, and continues gracefully instead of crashing.
