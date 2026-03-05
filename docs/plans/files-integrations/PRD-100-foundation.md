# PRD-100: Foundation — Infrastructure & Abstraction Layer

**Phase**: Foundation
**Status**: Planned
**Prerequisites**: None
**Estimated Effort**: 5-7 days
**Created**: 2026-03-05

---

## 1. Objective

Establish the database schema, shared types/constants, content provider abstraction, and pipeline refactoring required by all subsequent PRDs. This phase delivers NO external integration — it prepares the codebase for OneDrive/SharePoint by building the internal infrastructure layer.

The UI deliverable is activating the Connections tab with real connection status (replacing the current "Coming soon" placeholders), using the new backend API and shared constants.

---

## 2. Current State

### Database
- `files` table has `blob_path` (required), no `source_type` or external reference fields
- No `connections` or `connection_scopes` tables
- BC tokens hardcoded in `users` table (`bc_access_token_encrypted`, `bc_token_expires_at`)

### Pipeline
- `FileExtractWorker` calls `FileUploadService.downloadFromBlob(blobPath)` directly
- `FileProcessingService.processFile()` assumes blob-based download
- No abstraction layer for file content sources

### Frontend
- Connections tab in `RightPanel.tsx` shows hardcoded list with all "Coming soon" except BC
- No backend API for connections — status is derived from user's BC token presence
- Provider names, icons, colors hardcoded inline in component

### Shared Package
- No provider constants, connection status enums, or sync status types
- No `FILE_SOURCE_TYPE` concept

---

## 3. Expected State (After PRD-100)

### Database
- `connections` table with encrypted token storage, provider type, status tracking
- `connection_scopes` table with sync cursor, subscription tracking, scope metadata
- `files` table extended with `source_type`, `external_id`, `external_drive_id`, `connection_id`, `external_url`, `external_modified_at`, `content_hash_external` columns
- All new columns nullable with defaults for backward compatibility

### Pipeline
- `IFileContentProvider` interface defined and implemented
- `BlobContentProvider` wraps existing blob download logic (no behavior change)
- `FileExtractWorker` uses `IFileContentProvider` instead of direct blob calls
- Existing file upload flow works identically (verified by existing + new tests)

### Frontend
- Connections tab reads from `GET /api/connections` API
- Provider icons, names, colors from shared constants
- BC shows real status. OneDrive/SharePoint show "Not connected" with "Connect" button (disabled — enabled in PRD-101)

### Shared Package
- Provider constants: `PROVIDER_ID`, `PROVIDER_DISPLAY_NAME`, `PROVIDER_ACCENT_COLOR`, `PROVIDER_ICON`
- Status constants: `CONNECTION_STATUS`, `SYNC_STATUS`, `FILE_SOURCE_TYPE`
- Zod schemas for connection/scope validation
- Type definitions: `ConnectionSummary`, `ConnectionScope`, `SyncState`

---

## 4. Detailed Specifications

### 4.1 Database Schema Changes

#### New Table: `connections`

```prisma
model connections {
  id                        String    @id @default(uuid()) @db.NVarChar(36)
  user_id                   String    @db.NVarChar(36)
  provider                  String    @db.NVarChar(50)
  status                    String    @db.NVarChar(30) @default("disconnected")
  display_name              String?   @db.NVarChar(200)

  // Encrypted tokens (AES-256-GCM, same pattern as BCTokenManager)
  access_token_encrypted    String?   @db.NVarChar(Max)
  refresh_token_encrypted   String?   @db.NVarChar(Max)
  token_expires_at          DateTime?

  // Provider-specific identifiers
  microsoft_drive_id        String?   @db.NVarChar(200)
  microsoft_site_id         String?   @db.NVarChar(200)

  // OAuth metadata
  scopes_granted            String?   @db.NVarChar(Max)    // JSON array
  msal_partition_key        String?   @db.NVarChar(200)    // For MSAL cache lookup
  microsoft_home_account_id String?   @db.NVarChar(200)    // For acquireTokenSilent

  // Error tracking
  last_error                String?   @db.NVarChar(Max)
  last_error_at             DateTime?

  created_at                DateTime  @default(now())
  updated_at                DateTime  @updatedAt

  // Relations
  users                     users     @relation(fields: [user_id], references: [id], onDelete: Cascade)
  connection_scopes         connection_scopes[]
  files                     files[]

  @@index([user_id, provider], name: "IX_connections_user_provider")
  @@index([user_id, status], name: "IX_connections_user_status")
}
```

**CHECK constraints** (applied via raw SQL after `db push`):
- `CK_connections_provider`: `provider IN ('onedrive', 'sharepoint', 'business_central', 'power_bi')`
- `CK_connections_status`: `status IN ('disconnected', 'connecting', 'connected', 'error', 'expired')`

#### New Table: `connection_scopes`

```prisma
model connection_scopes {
  id                        String    @id @default(uuid()) @db.NVarChar(36)
  connection_id             String    @db.NVarChar(36)

  // What to sync
  scope_type                String    @db.NVarChar(50)
  external_id               String    @db.NVarChar(500)
  external_path             String?   @db.NVarChar(1000)
  display_name              String    @db.NVarChar(300)

  // Sync state
  sync_status               String    @db.NVarChar(30) @default("pending")
  delta_link                String?   @db.NVarChar(Max)
  last_synced_at            DateTime?
  last_sync_error           String?   @db.NVarChar(Max)
  files_synced_count        Int       @default(0)
  files_total_count         Int       @default(0)

  // Webhook subscription
  subscription_id           String?   @db.NVarChar(200)
  subscription_expires_at   DateTime?

  created_at                DateTime  @default(now())
  updated_at                DateTime  @updatedAt

  // Relations
  connections               connections @relation(fields: [connection_id], references: [id], onDelete: Cascade)

  @@index([connection_id], name: "IX_connection_scopes_connection")
  @@index([subscription_id], name: "IX_connection_scopes_subscription")
  @@index([sync_status], name: "IX_connection_scopes_sync_status")
}
```

**CHECK constraints**:
- `CK_connection_scopes_scope_type`: `scope_type IN ('drive_root', 'folder', 'site', 'library')`
- `CK_connection_scopes_sync_status`: `sync_status IN ('pending', 'syncing', 'synced', 'error')`

#### Modified Table: `files` (new columns)

```prisma
// ADD to existing files model:
source_type               String    @db.NVarChar(30) @default("local")
external_id               String?   @db.NVarChar(500)
external_drive_id         String?   @db.NVarChar(200)
connection_id             String?   @db.NVarChar(36)
connection_scope_id       String?   @db.NVarChar(36)
external_url              String?   @db.NVarChar(2000)
external_modified_at      DateTime?
content_hash_external     String?   @db.NVarChar(100)

// Relations
connections               connections? @relation(fields: [connection_id], references: [id])
```

**CHECK constraint**:
- `CK_files_source_type`: `source_type IN ('local', 'onedrive', 'sharepoint')`

**Index**:
- `IX_files_external_id`: `(connection_id, external_id)` — for dedup and delta lookups

**Migration notes**:
- All existing files get `source_type = 'local'` (column default)
- All new columns are nullable — zero impact on existing upload flow
- No `blob_path` changes — it remains required for local files, NULL for external files

### 4.2 IFileContentProvider Interface

**Location**: `backend/src/services/connectors/IFileContentProvider.ts`

```typescript
export interface FileContentResult {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  contentHash?: string;
}

export interface IFileContentProvider {
  getContent(fileId: string, userId: string): Promise<FileContentResult>;
  isAccessible(fileId: string, userId: string): Promise<boolean>;
  getDownloadUrl(fileId: string, userId: string): Promise<string>;
}
```

**Location**: `backend/src/services/connectors/BlobContentProvider.ts`

Wraps existing `FileUploadService.downloadFromBlob()`. Must produce identical behavior to current direct calls in `FileExtractWorker`.

**Location**: `backend/src/services/connectors/ContentProviderFactory.ts`

```typescript
export class ContentProviderFactory {
  getProvider(sourceType: FileSourceType): IFileContentProvider {
    switch (sourceType) {
      case FILE_SOURCE_TYPE.LOCAL:
        return getBlobContentProvider();
      case FILE_SOURCE_TYPE.ONEDRIVE:
      case FILE_SOURCE_TYPE.SHAREPOINT:
        return getGraphApiContentProvider();
      default:
        throw new UnknownSourceTypeError(sourceType);
    }
  }
}
```

### 4.3 Pipeline Refactor

**Critical file**: `backend/src/infrastructure/queue/workers/FileExtractWorker.ts`

**Before**:
```typescript
// Direct blob download
const buffer = await this.fileUploadService.downloadFromBlob(job.data.blobPath);
```

**After**:
```typescript
// Content provider abstraction
const file = await this.fileRepository.findById(job.data.userId, job.data.fileId);
const provider = this.contentProviderFactory.getProvider(file.source_type);
const { buffer } = await provider.getContent(file.id, file.user_id);
```

**Refactor rules**:
1. Write comprehensive tests for `FileExtractWorker` BEFORE refactoring
2. Ensure `BlobContentProvider` produces byte-identical behavior
3. `source_type` defaults to `'local'` — existing files route through `BlobContentProvider`
4. No changes to `FileChunkWorker`, `FileEmbedWorker`, or any downstream pipeline

### 4.4 Connections API

**Location**: `backend/src/domains/connections/`

#### Endpoints

| Method | Path | Description | Auth |
|---|---|---|---|
| `GET` | `/api/connections` | List user's connections with status | Authenticated |
| `GET` | `/api/connections/:id` | Get connection details (no tokens) | Authenticated + owner |
| `POST` | `/api/connections` | Create connection record (pre-OAuth) | Authenticated |
| `PATCH` | `/api/connections/:id` | Update connection metadata | Authenticated + owner |
| `DELETE` | `/api/connections/:id` | Disconnect (revoke tokens, remove scopes) | Authenticated + owner |
| `GET` | `/api/connections/:id/scopes` | List scopes for a connection | Authenticated + owner |

**Response shape** (`ConnectionSummary`):
```typescript
{
  id: string;
  provider: ProviderId;
  status: ConnectionStatus;
  displayName: string | null;
  scopeCount: number;
  filesSyncedCount: number;
  lastSyncedAt: string | null; // ISO 8601
  lastError: string | null;
  createdAt: string;
}
```

**Security**: Connections MUST enforce `user_id` match (same pattern as `validateSessionOwnership`).

### 4.5 Shared Package Additions

**New files in `packages/shared/src/`**:

1. `constants/providers.ts` — Provider IDs, display names, colors, icons
2. `constants/connection-status.ts` — Connection status, sync status, file source type
3. `types/connection.types.ts` — `ConnectionSummary`, `ConnectionScope`, `SyncState`, `ConnectionScopeDetail`
4. `schemas/connection.schemas.ts` — Zod schemas for API validation

**Export from `packages/shared/src/index.ts`**.

### 4.6 GraphTokenManager

**Location**: `backend/src/services/connectors/GraphTokenManager.ts`

Manages per-connection Graph API tokens using the existing MSAL infrastructure.

```typescript
export class GraphTokenManager {
  /**
   * Get a valid access token for a connection.
   * Auto-refreshes via MSAL acquireTokenSilent if expired.
   * Throws ConnectionTokenExpiredError if refresh fails.
   */
  async getValidToken(connectionId: string): Promise<string>;

  /**
   * Store tokens after initial OAuth exchange.
   * Encrypts before persisting (AES-256-GCM).
   */
  async storeTokens(connectionId: string, tokenResult: TokenAcquisitionResult): Promise<void>;

  /**
   * Revoke and clear tokens for a connection.
   */
  async revokeTokens(connectionId: string): Promise<void>;
}
```

Reuses `MsalRedisCachePlugin` and encryption patterns from `BCTokenManager`.

### 4.7 Frontend: Connections Tab Activation

**Modified**: `frontend/components/layout/RightPanel.tsx`

**Before**: Hardcoded list with "Coming soon" strings.
**After**: Fetches from `GET /api/connections` and renders dynamic list.

**New store**: `frontend/src/domains/connections/stores/connectionListStore.ts`

```typescript
interface ConnectionListState {
  connections: ConnectionSummary[];
  isLoading: boolean;
  error: string | null;
}
```

**New hook**: `frontend/src/domains/connections/hooks/useConnections.ts`

Fetches connections on mount, provides `connectProvider(providerId)` and `disconnectProvider(connectionId)` actions.

**Visual changes**:
- Each provider shows icon from `PROVIDER_ICON` constant (mapped to lucide-react)
- Color accent from `PROVIDER_ACCENT_COLOR`
- Status badge: "Connected" (green), "Not connected" (gray), "Error" (red)
- BC: Shows "Configure" (existing behavior, now driven by connections API)
- OneDrive/SharePoint: Shows "Connect" button (disabled in this PRD — enabled in PRD-101)
- Power BI: Shows "Coming soon" (no connection record)

---

## 5. Implementation Order

### Step 1: Shared Package Constants & Types (0.5 day)
1. Create `constants/providers.ts` with all provider constants
2. Create `constants/connection-status.ts` with status enums
3. Create `types/connection.types.ts` with TypeScript interfaces
4. Create `schemas/connection.schemas.ts` with Zod schemas
5. Export from index
6. Run `npm run build:shared` and `npm run verify:types`

### Step 2: Database Schema (0.5 day)
1. Add `connections` model to `schema.prisma`
2. Add `connection_scopes` model to `schema.prisma`
3. Add new columns to `files` model
4. Run `npx prisma db push` + `npx prisma generate`
5. Apply CHECK constraints via raw SQL
6. Verify with `npx prisma validate`

### Step 3: Safety Net — Tests for FileExtractWorker (1 day)
1. Write unit tests covering current `FileExtractWorker.process()` behavior:
   - Successful extraction from blob
   - CAS state transitions (queued -> extracting -> chunking)
   - Failure paths (blob not found, extraction error, CAS failure)
   - Progress event emission
2. Write integration test: upload file -> verify full pipeline produces embeddings
3. These tests MUST pass before and after the refactor

### Step 4: IFileContentProvider + BlobContentProvider (1 day)
1. Create `IFileContentProvider` interface
2. Implement `BlobContentProvider` wrapping existing logic
3. Implement `ContentProviderFactory`
4. Unit tests for `BlobContentProvider` (mock FileUploadService)
5. Unit tests for `ContentProviderFactory` routing

### Step 5: FileExtractWorker Refactor (1 day)
1. Inject `ContentProviderFactory` into `FileExtractWorker`
2. Replace direct blob download with provider abstraction
3. All Step 3 tests MUST still pass
4. Manual smoke test: upload a local file, verify full pipeline succeeds

### Step 6: GraphTokenManager (0.5 day)
1. Implement `GraphTokenManager` with MSAL integration
2. Reuse encryption patterns from `BCTokenManager`
3. Unit tests with mocked MSAL client

### Step 7: Connections Domain + API (1 day)
1. Create `ConnectionRepository` with Prisma queries
2. Create `ConnectionManager` domain service
3. Create API routes (`/api/connections`)
4. Apply `validateConnectionOwnership` middleware
5. Unit tests for repository and manager
6. Integration test: CRUD operations on connections

### Step 8: Frontend Connections Tab (1 day)
1. Create `connectionListStore` (Zustand)
2. Create `useConnections` hook
3. Update `RightPanel.tsx` to use API data + shared constants
4. Provider icons mapped from `PROVIDER_ICON` -> lucide-react components
5. Run `npm run -w bc-agent-frontend lint`

---

## 6. Success Criteria

### Backend
- [ ] `connections` and `connection_scopes` tables exist with correct schema and constraints
- [ ] `files` table has `source_type` column defaulting to `'local'`
- [ ] `GET /api/connections` returns list of connections for authenticated user
- [ ] Existing file upload flow works identically (all existing tests pass)
- [ ] `FileExtractWorker` uses `IFileContentProvider` abstraction
- [ ] `BlobContentProvider` is the default for `source_type='local'`
- [ ] `ContentProviderFactory` correctly routes based on `source_type`
- [ ] All new code has unit tests with >80% coverage
- [ ] `npm run verify:types` passes
- [ ] `npm run -w backend lint` passes

### Frontend
- [ ] Connections tab shows dynamic list from API
- [ ] Provider icons and colors match `PROVIDER_ACCENT_COLOR` and `PROVIDER_ICON`
- [ ] BC connection shows real status (connected/disconnected)
- [ ] OneDrive/SharePoint show "Not connected" with disabled "Connect" button
- [ ] `npm run -w bc-agent-frontend lint` passes

### E2E Verification
1. Upload a local file -> verify it processes through pipeline to `ready` status (regression)
2. Call `GET /api/connections` -> verify empty array for new user
3. Verify connections tab renders with correct icons and statuses
4. Verify existing RAG search still works with local files (regression)

---

## 7. Files to Create/Modify

### New Files
| Path | Purpose |
|---|---|
| `packages/shared/src/constants/providers.ts` | Provider ID, name, color, icon constants |
| `packages/shared/src/constants/connection-status.ts` | Connection status, sync status, source type constants |
| `packages/shared/src/types/connection.types.ts` | TypeScript interfaces |
| `packages/shared/src/schemas/connection.schemas.ts` | Zod validation schemas |
| `backend/src/services/connectors/IFileContentProvider.ts` | Content provider interface |
| `backend/src/services/connectors/BlobContentProvider.ts` | Blob storage provider |
| `backend/src/services/connectors/ContentProviderFactory.ts` | Provider routing factory |
| `backend/src/services/connectors/GraphTokenManager.ts` | Graph API token management |
| `backend/src/domains/connections/ConnectionManager.ts` | Connection CRUD domain logic |
| `backend/src/domains/connections/ConnectionRepository.ts` | Prisma-based data access |
| `backend/src/domains/connections/connections.routes.ts` | API routes |
| `frontend/src/domains/connections/stores/connectionListStore.ts` | Connection list state |
| `frontend/src/domains/connections/hooks/useConnections.ts` | Connection operations hook |

### Modified Files
| Path | Change |
|---|---|
| `backend/prisma/schema.prisma` | Add `connections`, `connection_scopes` models; extend `files` |
| `backend/src/infrastructure/queue/workers/FileExtractWorker.ts` | Use `IFileContentProvider` |
| `frontend/components/layout/RightPanel.tsx` | Dynamic connections list from API |
| `packages/shared/src/index.ts` | Export new constants and types |

### New Test Files
| Path | Coverage |
|---|---|
| `backend/src/__tests__/unit/services/connectors/BlobContentProvider.test.ts` | Provider implementation |
| `backend/src/__tests__/unit/services/connectors/ContentProviderFactory.test.ts` | Factory routing |
| `backend/src/__tests__/unit/services/connectors/GraphTokenManager.test.ts` | Token management |
| `backend/src/__tests__/unit/domains/connections/ConnectionManager.test.ts` | CRUD logic |
| `backend/src/__tests__/unit/infrastructure/queue/workers/FileExtractWorker.test.ts` | Pipeline refactor safety |
| `backend/src/__tests__/integration/connections/connections-api.test.ts` | API E2E |

---

## 8. Risks & Mitigations (PRD-100 Specific)

| Risk | Mitigation |
|---|---|
| FileExtractWorker refactor breaks existing upload flow | Write comprehensive tests BEFORE refactoring (Step 3). Run full test suite after. |
| Schema migration breaks existing queries | All new columns nullable with defaults. No column renames or type changes. |
| BC token migration from users table to connections table | NOT in this PRD. BC stays in users table. Future PRD can migrate. |
| Frontend breaks if API returns unexpected shape | Zod validation on API response. Graceful fallback to "loading" state. |

---

## 9. Out of Scope

- OneDrive/SharePoint OAuth flow (PRD-101)
- `GraphApiContentProvider` implementation (PRD-101)
- External file browsing or sync (PRD-101, PRD-102)
- Webhook infrastructure (PRD-102)
- SharePoint multi-site discovery (PRD-103)
- BC token migration from `users` to `connections` table (future)
