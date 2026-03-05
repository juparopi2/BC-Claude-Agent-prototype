# PRD-100: Foundation — Infrastructure & Abstraction Layer

**Phase**: Foundation
**Status**: Completed
**Prerequisites**: None
**Created**: 2026-03-05
**Completed**: 2026-03-05

---

## 1. Objective

Establish the database schema, shared types/constants, content provider abstraction, and pipeline refactoring required by all subsequent PRDs. This phase delivers NO external integration — it prepares the codebase for OneDrive/SharePoint by building the internal infrastructure layer.

The UI deliverable is activating the Connections tab with real connection status (replacing the current hardcoded placeholders), using the new backend API and shared constants.

---

## 2. Implementation Summary

All 8 planned steps were completed successfully:

| Step | Description | Status |
|---|---|---|
| 1 | Shared Package — Constants & Types | Done |
| 2 | Database Schema (Prisma + CHECK constraints) | Done |
| 3 | Safety Net — Pre-Refactor Tests | Done |
| 4 | IFileContentProvider + BlobContentProvider + Factory | Done |
| 5 | FileProcessingService Refactor | Done |
| 6 | GraphTokenManager | Done |
| 7 | Connections Domain + REST API | Done |
| 8 | Frontend — Connections Tab | Done |

### Verification Results

- **3,511 unit tests pass** (0 failures)
- **0 type errors** (`npm run verify:types`)
- **0 lint errors** (backend + frontend)
- Existing file upload pipeline unchanged (regression verified)

---

## 3. Deviations from Original PRD

The following table documents where the actual implementation differs from what was originally planned.

| Area | PRD Assumed | Actual Implementation | Reason |
|---|---|---|---|
| PK type | `@default(uuid()) @db.NVarChar(36)` | `@default(dbgenerated("newid()")) @db.UniqueIdentifier` | Matches every existing table in the codebase |
| Refactor target | `FileExtractWorker` | `FileProcessingService.processFile()` (lines ~197-204) | The blob download actually happens in the service, not the worker. The worker just calls `service.processFile(job)`. |
| `PROVIDER_ID` values | Included `LOCAL` | Does not include `LOCAL` | `LOCAL` is a file source type, not a provider. Handled by `FILE_SOURCE_TYPE.LOCAL` instead. |
| `CONNECTION_STATUS` | 5 values (incl. `connecting`) | 4 values: `disconnected`, `connected`, `expired`, `error` | `connecting` is a transient frontend state, not a DB value |
| `SYNC_STATUS` | 4 values (incl. `pending`, `synced`) | 3 values: `idle`, `syncing`, `error` | `idle` replaces `pending`+`synced`; simpler state machine |
| `connection_scopes.scope_type` | `drive_root`, `folder`, `site`, `library` | `root`, `folder`, `site`, `library` | Simplified naming |
| `ConnectionSummary` shape | Included `filesSyncedCount`, `lastSyncedAt` | Omitted — those are on scopes | Aggregation belongs at scope level, not connection level |
| Frontend domain | `frontend/src/domains/connections/` | `frontend/src/domains/integrations/` | Avoids collision with existing WebSocket `connection/` domain |
| Domain service name | `ConnectionManager` | `ConnectionService` | Matches project convention (`XxxService`) |
| Route file location | `backend/src/domains/connections/connections.routes.ts` | `backend/src/routes/connections.ts` | Matches project route convention (routes in `src/routes/`) |
| Timestamps | `@default(now())` / `@updatedAt` | `@default(dbgenerated("getutcdate()"))` | Matches every existing table; UTC guaranteed at DB level |
| `connections` unique constraint | Not specified | `@@unique([user_id, provider])` | Business rule: one connection per provider per user |
| `FileContentResult` | `buffer`, `mimeType`, `fileName`, `sizeBytes`, `contentHash` | `buffer`, `mimeType?` | Simplified — only buffer is needed by the pipeline; other fields unnecessary |
| `IFileContentProvider.getDownloadUrl` | Required method | Optional method (`getDownloadUrl?()`) | Not all providers support direct download URLs |
| `blobPath` on job | Not specified | Made optional (`blobPath?: string`) | External files won't have a blob path |
| Test file for safety net | `FileExtractWorker.test.ts` | `FileProcessingService.blobDownload.test.ts` + updated existing `FileProcessingService.test.ts` | Refactor was in the service, so tests target the service |
| `source_type` magic strings | Not addressed | `BatchUploadOrchestrator` now uses `FILE_SOURCE_TYPE.LOCAL` constant | Production code must use shared constants, not string literals. See 00-INDEX.md section 4.4 for the `FILE_SOURCE_TYPE` vs `SourceType` distinction. |

---

## 4. What Was Built

### 4.1 Shared Package (`packages/shared/src/`)

**New files:**
- `constants/providers.ts` — `PROVIDER_ID`, `PROVIDER_DISPLAY_NAME`, `PROVIDER_ACCENT_COLOR`, `PROVIDER_ICON`, `PROVIDER_UI_ORDER`, `CONNECTIONS_API`
- `constants/connection-status.ts` — `CONNECTION_STATUS`, `SYNC_STATUS`, `FILE_SOURCE_TYPE` + derived TypeScript types
- `types/connection.types.ts` — `ConnectionSummary`, `ConnectionScopeDetail`, `ConnectionListResponse`
- `schemas/connection.schemas.ts` — `createConnectionSchema`, `updateConnectionSchema`, `connectionIdParamSchema` (Zod)

**Modified files:**
- `constants/index.ts` — re-exports new constant files
- `types/index.ts` — re-exports new types
- `schemas/index.ts` — re-exports new schemas
- `index.ts` — re-exports all new public APIs

### 4.2 Database Schema (`backend/prisma/schema.prisma`)

#### New Table: `connections`

```prisma
model connections {
  id                        String    @id @default(dbgenerated("newid()")) @db.UniqueIdentifier
  user_id                   String    @db.UniqueIdentifier
  provider                  String    @db.NVarChar(50)
  status                    String    @default("disconnected") @db.NVarChar(30)
  display_name              String?   @db.NVarChar(200)

  // Encrypted tokens (AES-256-GCM)
  access_token_encrypted    String?   @db.NVarChar(Max)
  refresh_token_encrypted   String?   @db.NVarChar(Max)
  token_expires_at          DateTime? @db.DateTime

  // Microsoft-specific
  microsoft_drive_id        String?   @db.NVarChar(200)
  microsoft_site_id         String?   @db.NVarChar(200)
  scopes_granted            String?   @db.NVarChar(Max)
  msal_partition_key        String?   @db.NVarChar(200)
  microsoft_home_account_id String?   @db.NVarChar(200)

  // Error tracking
  last_error                String?   @db.NVarChar(Max)
  last_error_at             DateTime? @db.DateTime

  // Timestamps
  created_at                DateTime  @default(dbgenerated("getutcdate()")) @db.DateTime
  updated_at                DateTime  @default(dbgenerated("getutcdate()")) @db.DateTime

  // Relations
  users                     users     @relation(fields: [user_id], references: [id], onDelete: Cascade)
  connection_scopes         connection_scopes[]
  files                     files[]

  @@unique([user_id, provider], name: "UQ_connections_user_provider")
  @@index([user_id, status], name: "IX_connections_user_status")
}
```

#### New Table: `connection_scopes`

```prisma
model connection_scopes {
  id                      String    @id @default(dbgenerated("newid()")) @db.UniqueIdentifier
  connection_id           String    @db.UniqueIdentifier
  scope_type              String    @db.NVarChar(50)
  scope_resource_id       String    @db.NVarChar(500)
  scope_display_name      String    @db.NVarChar(300)
  scope_path              String?   @db.NVarChar(1000)

  // Sync state
  sync_status             String    @default("idle") @db.NVarChar(30)
  delta_link              String?   @db.NVarChar(Max)
  last_synced_at          DateTime? @db.DateTime
  last_sync_error         String?   @db.NVarChar(Max)
  item_count              Int       @default(0)

  // Webhook
  subscription_id         String?   @db.NVarChar(200)
  subscription_expires_at DateTime? @db.DateTime

  // Timestamps
  created_at              DateTime  @default(dbgenerated("getutcdate()")) @db.DateTime

  // Relations
  connections             connections @relation(fields: [connection_id], references: [id], onDelete: Cascade)

  @@index([connection_id], name: "IX_connection_scopes_connection")
  @@index([subscription_id], name: "IX_connection_scopes_subscription")
  @@index([sync_status], name: "IX_connection_scopes_sync_status")
}
```

#### Modified Table: `files` (new columns)

```prisma
// Added to existing files model:
connection_id             String?   @db.UniqueIdentifier
connection_scope_id       String?   @db.UniqueIdentifier
external_drive_id         String?   @db.NVarChar(200)
external_url              String?   @db.NVarChar(2000)
external_modified_at      DateTime? @db.DateTime
content_hash_external     String?   @db.NVarChar(100)

// Changed default
source_type               String    @default("local") @db.NVarChar(30)  // was "blob_storage"

// New relation + index
connections               connections? @relation(fields: [connection_id], references: [id])
@@index([connection_id, external_id], name: "IX_files_connection_external")
```

#### CHECK Constraints (applied via raw SQL)

| Table | Constraint | Column | Values |
|---|---|---|---|
| `connections` | `CK_connections_provider` | `provider` | business_central, onedrive, sharepoint, power_bi |
| `connections` | `CK_connections_status` | `status` | disconnected, connected, expired, error |
| `connection_scopes` | `CK_connection_scopes_scope_type` | `scope_type` | root, folder, site, library |
| `connection_scopes` | `CK_connection_scopes_sync_status` | `sync_status` | idle, syncing, error |
| `files` | `CK_files_source_type` | `source_type` | local, onedrive, sharepoint |

#### Post-Push SQL

```sql
-- Migrate existing rows from old default to new default
UPDATE files SET source_type = 'local' WHERE source_type = 'blob_storage';
```

### 4.3 Content Provider Abstraction (`backend/src/services/connectors/`)

| File | Purpose |
|---|---|
| `IFileContentProvider.ts` | Interface: `getContent(fileId, userId)`, `isAccessible(fileId, userId)`, optional `getDownloadUrl(fileId, userId)` |
| `BlobContentProvider.ts` | Wraps `FileRepository.findById()` + `FileUploadService.downloadFromBlob()`. Singleton via `getBlobContentProvider()`. |
| `ContentProviderFactory.ts` | Routes by `source_type`: LOCAL -> BlobContentProvider, ONEDRIVE/SHAREPOINT -> throws "not implemented (PRD-101/PRD-103)". Singleton via `getContentProviderFactory()`. |
| `GraphTokenManager.ts` | AES-256-GCM encryption (matching BCTokenManager pattern). Methods: `getValidToken()`, `storeTokens()`, `revokeTokens()`. Custom `ConnectionTokenExpiredError`. Singleton via `getGraphTokenManager()`. |
| `index.ts` | Barrel exports |

### 4.4 Pipeline Refactor (`backend/src/services/files/FileProcessingService.ts`)

**Before** (lines ~197-204):
```typescript
const fileUploadService = getFileUploadService();
const buffer = await fileUploadService.downloadFromBlob(blobPath);
```

**After**:
```typescript
const sourceType = await fileRepository.getSourceType(userId, fileId);
const { getContentProviderFactory } = await import('@/services/connectors');
const provider = getContentProviderFactory().getProvider(sourceType);
const { buffer } = await provider.getContent(fileId, userId);
```

**Other changes:**
- `FileRepository.ts`: Added `getSourceType(userId, fileId): Promise<string>` method
- `jobs.types.ts`: Changed `blobPath: string` to `blobPath?: string`

### 4.5 Connections Domain (`backend/src/domains/connections/`)

| File | Purpose |
|---|---|
| `ConnectionRepository.ts` | Prisma CRUD (findByUser, findById, create, update, delete, findScopesByConnection, countScopesByConnection). Excludes sensitive credential fields from SELECTs. All returned IDs `.toUpperCase()`. |
| `ConnectionService.ts` | Business logic with ownership validation via `timingSafeCompare`. Maps DB rows to `ConnectionSummary`/`ConnectionScopeDetail`. Domain errors: `ConnectionNotFoundError`, `ConnectionForbiddenError`. |
| `index.ts` | Barrel exports |

### 4.6 REST API (`backend/src/routes/connections.ts`)

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/api/connections` | List user's connections | `{ connections, count }` |
| `GET` | `/api/connections/:id` | Get single connection | `ConnectionSummary` |
| `POST` | `/api/connections` | Create connection | 201 + `ConnectionSummary` |
| `PATCH` | `/api/connections/:id` | Update connection | 204 |
| `DELETE` | `/api/connections/:id` | Delete connection + scopes | 204 |
| `GET` | `/api/connections/:id/scopes` | List scopes for connection | `{ scopes, count }` |

All endpoints use `authenticateMicrosoft` middleware. Validation via Zod schemas from `@bc-agent/shared`.

Route registered in `backend/src/server.ts`: `app.use('/api/connections', connectionsRoutes)`.

### 4.7 Frontend (`frontend/src/domains/integrations/`)

| File | Purpose |
|---|---|
| `stores/integrationListStore.ts` | Zustand store: `connections[]`, `isLoading`, `error`, `hasFetched`, `fetchConnections()` |
| `hooks/useIntegrations.ts` | Fetches on mount if not already fetched. Returns `{ connections, isLoading, error }`. |
| `components/ConnectionCard.tsx` | Provider card with lucide-react icon mapping, status badges (connected/disconnected/expired/error/coming_soon), opacity for inactive providers. |
| `index.ts` | Barrel exports |

**Modified:** `frontend/components/layout/RightPanel.tsx`
- Replaced hardcoded provider list with dynamic rendering using `PROVIDER_UI_ORDER`
- Uses `useIntegrations()` hook to fetch connections from API
- `DISABLED_PROVIDERS` Set for OneDrive, SharePoint, Power BI (enabled in future PRDs)

---

## 5. Complete File Inventory

### New Files (24)

| File | Purpose |
|---|---|
| `packages/shared/src/constants/providers.ts` | Provider constants |
| `packages/shared/src/constants/connection-status.ts` | Status constants |
| `packages/shared/src/types/connection.types.ts` | TypeScript interfaces |
| `packages/shared/src/schemas/connection.schemas.ts` | Zod schemas |
| `backend/src/services/connectors/IFileContentProvider.ts` | Provider interface |
| `backend/src/services/connectors/BlobContentProvider.ts` | Blob provider |
| `backend/src/services/connectors/ContentProviderFactory.ts` | Provider routing |
| `backend/src/services/connectors/GraphTokenManager.ts` | Graph API tokens |
| `backend/src/services/connectors/index.ts` | Barrel exports |
| `backend/src/domains/connections/ConnectionRepository.ts` | Data access |
| `backend/src/domains/connections/ConnectionService.ts` | Business logic |
| `backend/src/domains/connections/index.ts` | Barrel exports |
| `backend/src/routes/connections.ts` | REST API |
| `frontend/src/domains/integrations/stores/integrationListStore.ts` | Zustand store |
| `frontend/src/domains/integrations/hooks/useIntegrations.ts` | React hook |
| `frontend/src/domains/integrations/components/ConnectionCard.tsx` | UI component |
| `frontend/src/domains/integrations/index.ts` | Barrel exports |
| `backend/src/__tests__/unit/services/connectors/BlobContentProvider.test.ts` | 7 tests |
| `backend/src/__tests__/unit/services/connectors/ContentProviderFactory.test.ts` | 4 tests |
| `backend/src/__tests__/unit/services/connectors/GraphTokenManager.test.ts` | 10 tests |
| `backend/src/__tests__/unit/domains/connections/ConnectionRepository.test.ts` | 9 tests |
| `backend/src/__tests__/unit/domains/connections/ConnectionService.test.ts` | 11 tests |
| `backend/src/__tests__/unit/services/files/FileProcessingService.blobDownload.test.ts` | 11 tests |
| `backend/src/__tests__/unit/routes/connections.test.ts` | Route tests |

### Modified Files (12)

| File | Change |
|---|---|
| `backend/prisma/schema.prisma` | Add `connections` + `connection_scopes`; extend `files`; change `source_type` default |
| `backend/prisma/CLAUDE.md` | Added 5 new CHECK constraints to inventory |
| `backend/src/services/files/FileProcessingService.ts` | Use ContentProviderFactory instead of direct downloadFromBlob |
| `backend/src/services/files/repository/FileRepository.ts` | Add `getSourceType()` method |
| `backend/src/infrastructure/queue/types/jobs.types.ts` | Make `blobPath` optional |
| `backend/src/server.ts` | Register connections route |
| `backend/src/__tests__/unit/services/files/FileProcessingService.test.ts` | Updated mocks for content provider abstraction |
| `frontend/components/layout/RightPanel.tsx` | Dynamic connections from API |
| `packages/shared/src/constants/index.ts` | Export new constants |
| `packages/shared/src/types/index.ts` | Export new types |
| `packages/shared/src/schemas/index.ts` | Export new schemas |
| `packages/shared/src/index.ts` | Re-export all new public APIs |

---

## 6. Success Criteria

### Backend
- [x] `connections` and `connection_scopes` tables exist with correct schema and constraints
- [x] `files` table has `source_type` column defaulting to `'local'`
- [x] `GET /api/connections` returns list of connections for authenticated user
- [x] Existing file upload flow works identically (all 3,511 existing tests pass)
- [x] `FileProcessingService` uses `IFileContentProvider` abstraction
- [x] `BlobContentProvider` is the default for `source_type='local'`
- [x] `ContentProviderFactory` correctly routes based on `source_type`
- [x] All new code has unit tests (52 new tests across 6 test files)
- [x] `npm run verify:types` passes (0 errors)
- [x] `npm run -w backend lint` passes (0 errors)

### Frontend
- [x] Connections tab shows dynamic list from API via `useIntegrations()` hook
- [x] Provider icons mapped from `PROVIDER_ICON` to lucide-react components
- [x] BC connection shows real status from API
- [x] OneDrive/SharePoint/Power BI show as disabled ("Coming soon")
- [x] `npm run -w bc-agent-frontend lint` passes (0 errors)

---

## 7. Out of Scope

- OneDrive/SharePoint OAuth flow (PRD-101)
- `GraphApiContentProvider` implementation (PRD-101)
- External file browsing or sync (PRD-101, PRD-102)
- Webhook infrastructure (PRD-102)
- SharePoint multi-site discovery (PRD-103)
- BC token migration from `users` to `connections` table (future)
