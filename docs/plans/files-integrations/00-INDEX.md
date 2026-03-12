# Files Integrations — Master Plan

**Project**: External File Connectors (OneDrive, SharePoint)
**Status**: In Progress
**Created**: 2026-03-05
**Last Updated**: 2026-03-10

---

## 1. Business Context

MyWorkMate users currently upload files manually to their Knowledge Base for RAG search. This creates friction: users already have documents organized in OneDrive and SharePoint, and expect the AI assistant to access them seamlessly.

This initiative connects OneDrive and SharePoint as external file sources, enabling:
- Automatic sync of user-selected folders/sites into the RAG pipeline
- Near-real-time updates via Microsoft Graph Change Notifications
- Unified file browsing across local uploads and external sources
- Zero manual re-upload when documents change at the source

### Target Scale
- 5,000 - 10,000 concurrent users at launch
- Multi-tenant: users share Microsoft 365 tenants (rate limits are per-app-per-tenant)
- Estimated index size: 100M+ chunks in Azure AI Search (10K users x 1K docs x 10 chunks)

---

## 2. Architectural Decisions (Finalized)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Storage model | **Pure reference** | No blob duplication. Store only metadata + extracted text + embeddings locally. Preview/download via Graph API on-demand. |
| D2 | Sync strategy | **Graph Change Notifications (webhooks)** | Near-real-time (<3min avg), efficient API usage, scalable. Polling fallback for resilience. |
| D3 | Scope selection UX | **Multi-level selector** | SP: Sites -> Libraries -> Folders. OD: Folders. Users pick exactly what to sync. |
| D4 | Pipeline entry point | **Content provider abstraction** | `IFileContentProvider` interface with `BlobContentProvider` (existing) + `GraphApiContentProvider` (new). Extensible to future connectors. |
| D5 | Data model | **connections + connection_scopes** | Generic connections table + scopes table for per-user sync targets. |

---

## 3. PRD Index

Each PRD delivers backend functionality WITH its corresponding UI slice for E2E validation.

| PRD | Title | Status |
|---|---|---|
| [PRD-100](./PRD-100-foundation.md) | Infrastructure & Abstraction Layer | **COMPLETED** |
| [PRD-101](./PRD-101-onedrive-connection.md) | OneDrive Connection & Initial Sync | **COMPLETED** |
| [PRD-102](./PRD-102-wizard-bugfixes.md) | OneDrive Wizard Bug Fixes | **COMPLETED** |
| [PRD-103](./PRD-103-file-browsing-lite.md) | File-Level Browsing (Lite) | **COMPLETED** |
| [PRD-104](./PRD-104-scope-filtered-sync.md) | Scope-Filtered Sync & Deduplication | **COMPLETED** |
| [PRD-105](./PRD-105-scope-management.md) | Scope Management & Re-configuration | **COMPLETED** |
| [PRD-106](./PRD-106-file-type-validation.md) | File Type Validation & Pipeline Guard | **COMPLETED** |
| [PRD-107](./PRD-107-onedrive-ux-polish.md) | OneDrive File UX Polish | **COMPLETED** |
| [PRD-108](./PRD-108-webhook-sync-engine.md) | Real-Time Sync Engine (Webhooks) | **COMPLETED** |
| [PRD-109](./PRD-109-settings-disconnect.md) | Settings Connections Tab & Full Disconnect | **COMPLETED** |
| [PRD-110](./PRD-110-shared-files-browsing.md) | OneDrive "Shared With Me" Browsing | **COMPLETED** |
| [PRD-111](./PRD-111-sharepoint-connection.md) | SharePoint Connection — Backend | **COMPLETED** |
| [PRD-112](./PRD-112-scope-selection-inheritance.md) | Scope Selection Inheritance | **COMPLETED** |
| [PRD-113](./PRD-113-sharepoint-frontend.md) | SharePoint Frontend — Wizard, Browsing & Unified Views | Planned |

### Dependency Chain

```
PRD-100 (Foundation) ──── COMPLETED
   │
   v
PRD-101 (OneDrive) ───── COMPLETED
   │
   v
PRD-102 (Bug Fixes) ──── COMPLETED
   │
   v
PRD-103 (File Browsing Lite) ── COMPLETED
   │
   v
PRD-104 (Scope-Filtered Sync) ── COMPLETED
   │
   v
PRD-105 (Scope Management) ── COMPLETED
   │
   v
PRD-106 (File Type Validation) ── COMPLETED
   │
   v
PRD-107 (OneDrive UX Polish) ── COMPLETED
   │
   ├──→ PRD-108 (Webhooks) ── COMPLETED
   │
   ├──→ PRD-109 (Settings Disconnect) ── COMPLETED
   │
   ├──→ PRD-110 (Shared Files) ── COMPLETED
   │
   ├──→ PRD-112 (Scope Selection Inheritance) ── COMPLETED
   │
   └──→ PRD-111 (SharePoint Backend) ── COMPLETED
         │
         v
       PRD-113 (SharePoint Frontend) ── Planned
```

PRD-100 through PRD-107 form the completed OneDrive foundation. PRD-108 through PRD-112 are all completed. The remaining work is SharePoint: PRD-111 (backend) → PRD-113 (frontend).

### Renumbering History (2026-03-09)

The PRD series was renumbered to reflect the actual implementation order and insert new critical PRDs discovered during manual testing:

| Old # | New # | Reason |
|-------|-------|--------|
| PRD-104 | PRD-102 | Implemented before file browsing, sequential after PRD-101 |
| PRD-105 (Phase 1) | PRD-103 | Completed; Phase 2 extracted to PRD-106 |
| _(new)_ | PRD-104 | Critical sync bugs discovered during testing |
| _(new)_ | PRD-105 | Scope management gap discovered during testing |
| PRD-105 (Phase 2) | PRD-106 | Extracted file type validation from browsing |
| _(new)_ | PRD-107 | UX polish items collected during testing |
| PRD-102 | PRD-108 | Moved later — webhooks depend on working sync |
| PRD-107 | PRD-109 | Moved later — disconnect needs working scopes |
| PRD-106 | PRD-110 | Moved later — shared files depend on UX polish |
| PRD-103 | PRD-111 | Moved later — SharePoint depends on webhooks |

### Issues Discovered During Testing (2026-03-09)

| Severity | Issue | PRD |
|----------|-------|-----|
| **CRITICAL** | Sync ignores folder scope — syncs entire drive | PRD-104 |
| **CRITICAL** | No duplicate prevention — re-sync creates duplicate files | PRD-104 |
| HIGH | No scope pre-selection on re-configure | PRD-105 |
| HIGH | No confirmation modals for scope changes | PRD-105 |
| HIGH | Double-click downloads OneDrive files instead of opening in browser | PRD-107 |
| MEDIUM | Flat file list in sidebar — no synced folder structure | PRD-107 |
| MEDIUM | No frontend sync event listeners | PRD-107 |
| MEDIUM | No scope deletion/cleanup mechanism | PRD-105 |
| LOW | Unsupported files processed (no pipeline guard) | PRD-106 |
| HIGH | Scope root folder not created during folder sync | PRD-107 §6.9 |

### PRD-101 Implementation Summary

**Status**: Completed + E2E Verified (2026-03-05). All 12 implementation steps + 10 E2E verification fixes complete. See [PRD-101 Section 9](./PRD-101-onedrive-connection.md#9-implementation-status) for details.

**Key deliverables**:
- 7 new backend services (GraphHttpClient, GraphRateLimiter, OneDriveService, GraphApiContentProvider, GraphTokenManager refresh, InitialSyncService, OAuth routes)
- 7 new API endpoints (OAuth initiate/callback, browse root/folder, create scopes, trigger sync, sync-status)
- Frontend ConnectionWizard (3-step: connect → browse → sync) with post-OAuth auto-resume via URL query params
- FolderTree interactive OneDrive node (filters by `sourceType`), Cloud badge overlay on file icons
- "Open in OneDrive" context menu action, backend content proxy (no CORS), `sourceType` API filter
- Schema updates: `microsoft_drive_id`, `scopes_granted`, `scope_path`, nullable `blob_path`
- `ParsedFile` extended: `sourceType`, `externalUrl` fields in shared + backend types
- Business Central card shows disabled with "Coming soon" badge
- 106+ unit tests across 9 test files; 168 backend test files (3650 tests), 53 frontend test files (810 tests), all passing

**Remaining gaps** (cosmetic/minor): Breadcrumb OneDrive icon, `sync:started` event. See [PRD-101 Section 10.4](./PRD-101-onedrive-connection.md#104-success-criteria-checklist).

---

## 4. Knowledge Base (Cross-Cutting Concerns)

### 4.1 Microsoft Graph API — Key Constraints

**Rate Limits (SharePoint/OneDrive specific)**:
- Per-user: 3,000 requests / 5 minutes
- Per-app-per-tenant (1K-5K licenses): 2,500 RU/min, 2,400,000 RU/24h
- Per-app-per-tenant (5K-15K licenses): 3,750 RU/min, 3,600,000 RU/24h
- Delta query with token: 1 RU. Without token: 2 RU. File download: 1 RU.
- Throttled: HTTP 429 with `Retry-After` header. Continued abuse leads to full block.

**Change Notification Subscriptions**:
- driveItem max expiration: ~29.4 days (42,300 minutes)
- Only `updated` changeType supported for drive root
- OneDrive Business: subscription only on root folder (not subfolders)
- Webhook must respond within 10 seconds. >10% slow responses in 10min = throttled.
- Failed deliveries retried with exponential backoff for up to 4 hours.
- Lifecycle notifications: `reauthorizationRequired`, `subscriptionRemoved`

**Delta Query Behavior**:
- First call without token: enumerates ALL items (full drive/folder scan)
- `?token=latest`: skip enumeration, get fresh deltaLink (no existing items)
- Token expiry: HTTP 410 Gone with `resyncChangesApplyDifferences`
- Deleted items: returned with `{ "deleted": {} }` facet
- Folder deletion: only folder marked, children implicit
- Always track by ID, not path. Same item may appear multiple times; use last occurrence.

### 4.2 Azure AI Search — Capacity Planning

| Tier | Storage/Partition | Max Partitions | Max Docs/Index | Suitable For |
|---|---|---|---|---|
| S1 | 160 GB | 12 | 24 billion | Up to ~20M chunks |
| S2 | 512 GB | 12 | 24 billion | Up to ~75M chunks |
| S3 | 1,024 GB | 12 | 24 billion | 75M+ chunks |

**Estimation for 10K users x 1K docs x 10 chunks = 100M chunks**:
- Per chunk: ~8KB (text 2KB + vector 1536d 6KB) = ~800 GB total
- Requires: S1 with 5-6 partitions OR S2 with 2 partitions
- With image vectors (1024d, +4KB): ~1.2TB -> S2 with 3 partitions
- Multi-tenant isolation: `userId` filter on EVERY query (existing pattern)

### 4.3 Existing System Integration Points

**Files table** (`backend/prisma/schema.prisma`):
- Currently: `blob_path` required, `source_type` not present
- Pipeline assumes blob download via `FileUploadService.downloadFromBlob()`
- State machine: `registered -> uploaded -> queued -> extracting -> chunking -> embedding -> ready`

**Auth system** (`backend/src/domains/auth/`):
- MSAL with Redis cache plugin for token management
- Current scopes: `User.Read`, `openid`, `profile`, `email`, `offline_access`, BC API scope
- Token refresh: triple-layer (middleware, WebSocket, frontend health check)
- BC tokens: AES-256-GCM encrypted in `users` table

**Queue system** (`backend/src/infrastructure/queue/`):
- BullMQ with 11 queues, flow-based sequencing for file pipeline
- Pipeline: FileExtractWorker -> FileChunkWorker -> FileEmbedWorker -> FilePipelineCompleteWorker
- Concurrency: Extract=8, Chunk=5, Embed=5

**Frontend file explorer** (`frontend/components/files/`):
- FolderTree with lazy loading, FileDataTable with TanStack Table
- FileIcon mapped by MIME type (lucide-react icons)
- Connections tab: OD=active (ConnectionWizard), BC/SP/PBI="Coming soon" (disabled)

### Schema Columns Deferred to PRD-101
The following columns were planned in PRD-100 but deferred to PRD-101 implementation:
- `connections.microsoft_drive_id` (NVarChar(200)) — stores the Graph API drive ID
- `connections.scopes_granted` (NVarChar(Max)) — tracks consented OAuth scopes
- `connection_scopes.scope_path` (NVarChar(1000)) — breadcrumb path for scope display
- `files.blob_path` made nullable — supports external files with no local blob

### 4.4 Source Type vs Fetch Strategy (Two Distinct Concepts)

The codebase has two different "source type" systems that must NOT be confused:

| Concept | Location | Values | Purpose |
|---|---|---|---|
| **`FILE_SOURCE_TYPE`** | `@bc-agent/shared` constants, DB column `files.source_type` | `local`, `onedrive`, `sharepoint` | Where the file **originated** from. Used by `ContentProviderFactory` to route download logic. |
| **`SourceType`** | `@bc-agent/shared` types (`source.types.ts`), DB column `message_citations.source_type`, RAG tool output | `blob_storage`, `chat_attachment`, `sharepoint`, `onedrive`, `email`, `web` | How the **frontend fetches** the file for preview. Maps to `FetchStrategy` via `getFetchStrategy()`. |

**Key rule**: When writing to `files.source_type` (DB), always use `FILE_SOURCE_TYPE.LOCAL` (the constant). When writing citation/RAG `sourceType`, use `'blob_storage'` (the fetch strategy) because all KB files are stored in Azure Blob Storage regardless of origin.

A file uploaded locally has `files.source_type = 'local'` AND `citation.sourceType = 'blob_storage'`. A future OneDrive file will have `files.source_type = 'onedrive'` AND `citation.sourceType = 'onedrive'` (fetched via Graph API proxy).

### 4.5 Coding Standards (Mandatory)

1. **No magic strings**: All provider IDs, status enums, file source types as constants in `@bc-agent/shared`. Use `FILE_SOURCE_TYPE.LOCAL` not `'local'`, `PROVIDER_ID.ONEDRIVE` not `'onedrive'`, etc.
2. **Strict typing**: No `any`. Use Zod for runtime validation at system boundaries.
3. **UPPERCASE IDs**: All UUIDs/GUIDs must be UPPERCASE throughout the system.
4. **Stateless singletons**: All services receive `ExecutionContext` or per-request params. No mutable instance state.
5. **Structured logging**: Use `createChildLogger({ service: 'ServiceName' })`. Never `console.log`.
6. **Error serialization**: Extract `{ message, stack, name, cause }` before logging.
7. **Tests before refactors**: Write tests covering existing behavior BEFORE modifying code.
8. **Shared package as source of truth**: Cross-cutting types, constants, and classification logic in `@bc-agent/shared`.

### 4.6 Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Token expiry during processing | High | Medium | `GraphTokenManager` auto-refresh via MSAL. Retry with fresh token. |
| Graph API rate limiting (shared tenant) | High | High | Per-tenant rate limiter with exponential backoff. Queue priority by tenant. |
| Webhook endpoint downtime | Medium | High | Polling fallback every 30min. Health check monitor. Lifecycle notifications. |
| Delta token expired (410 Gone) | Medium | Medium | Full resync automatically. Store timestamp of last successful sync. |
| Subscription renewal failure | Medium | Medium | Cron check every 12h. Alert if subscription < 24h remaining. |
| AI Search capacity exceeded | High | High | Capacity planning: start S1 2-partition, scale to S2 per telemetry. |
| SharePoint sites with 100K+ files | Low | High | Pagination in delta, batch processing, progress indicators. |
| Concurrent sync storms (10K users) | Medium | High | Stagger initial syncs. Priority queue. Circuit breaker per tenant. |
| Pipeline refactor breaks existing uploads | Medium | Critical | Comprehensive tests BEFORE refactor. Feature flag for gradual rollout. |

---

## 5. Shared Constants & Types (Created in PRD-100)

See `packages/shared/src/constants/providers.ts` and `packages/shared/src/constants/connection-status.ts` for actual implementations.

### Provider Constants (`@bc-agent/shared`)

```typescript
// constants/providers.ts — ACTUAL (no LOCAL provider; that's FILE_SOURCE_TYPE)
export const PROVIDER_ID = {
  BUSINESS_CENTRAL: 'business_central',
  ONEDRIVE: 'onedrive',
  SHAREPOINT: 'sharepoint',
  POWER_BI: 'power_bi',
} as const;

// Also exports: PROVIDER_DISPLAY_NAME, PROVIDER_ACCENT_COLOR, PROVIDER_ICON,
// PROVIDER_UI_ORDER, CONNECTIONS_API
```

### Connection & Sync Status Constants

```typescript
// constants/connection-status.ts — ACTUAL
export const CONNECTION_STATUS = {
  DISCONNECTED: 'disconnected',
  CONNECTED: 'connected',
  EXPIRED: 'expired',
  ERROR: 'error',
} as const; // Note: no 'connecting' (transient frontend state)

export const SYNC_STATUS = {
  IDLE: 'idle',
  SYNCING: 'syncing',
  ERROR: 'error',
} as const; // Note: 'idle' replaces 'pending'+'synced'

export const FILE_SOURCE_TYPE = {
  LOCAL: 'local',
  ONEDRIVE: 'onedrive',
  SHAREPOINT: 'sharepoint',
} as const;
```

---

## 6. Test Strategy (Cross-PRD)

### Unit Tests
- Every new service, manager, and utility gets unit tests
- Mock external dependencies (Graph API, MSAL, Azure AI Search)
- Test state machine transitions exhaustively
- Test error paths and retry logic

### Integration Tests
- Test `IFileContentProvider` implementations against mock HTTP servers
- Test pipeline flow with external file source (mock Graph API responses)
- Test webhook validation and notification processing
- Test subscription lifecycle (create, renew, expire, recreate)

### E2E Tests (Per PRD)
- Each PRD defines specific E2E success criteria
- Frontend + Backend integration verified at each phase
- Prefix test data: `e2e-conn-*` for connection test entities

### Load/Scale Considerations
- Rate limiter tests with concurrent requests
- Verify per-tenant throttling behavior
- Verify AI Search query performance with userId filter at scale

---

## 7. Deferred Considerations

### 7.1 Multi-User File Deduplication in AI Search

**Status**: Deferred — Not feasible without significant architectural redesign.

**Problem**: When two users in the same Microsoft 365 tenant both sync the same shared file, the system currently indexes it twice (once per user) in Azure AI Search, duplicating storage.

**Why it's hard**: The entire stack assumes per-user ownership of chunks:
- `file_chunks` table has `user_id` + `file_id` FK per chunk
- AI Search index filters every query by `userId eq X` for multi-tenant isolation
- `SoftDeleteService` deletes chunks by `userId + fileId` — shared chunks would break this (User A deleting would remove User B's data)
- `DuplicateDetectionService` only checks within a single user's library
- Billing/usage tracking is per-user per-file

**What would be needed**:
1. `file_chunk_references` mapping table (many-to-one: multiple file records → shared chunks)
2. Reference-counted chunk deletion (only delete when last reference removed)
3. Search filter redesign (query by file IDs instead of user ID, or permission-based filtering)
4. Billing attribution changes for shared chunks

**Estimated effort**: 2–3 months of engineering + comprehensive regression testing.

**Recommendation**: The storage cost of duplicate chunks (~8KB per chunk × 10 chunks per file) is negligible compared to the engineering complexity. At 10K users with 20% file overlap, the duplication amounts to ~16GB — well within AI Search capacity. Revisit only if AI Search storage becomes a real constraint at scale (S2+ tier pressure).

### 7.2 Full Connection Reset Script (E2E Testing)

A utility script or API endpoint for fully resetting a user's connection state to "new user" for E2E testing purposes. Should clean up:
- `connections` + `connection_scopes` records
- `files` records with `source_type = 'onedrive'`
- `file_chunks` for those files
- AI Search embeddings
- MSAL Redis cache

This is partially addressed by PRD-109 (full disconnect workflow), but a dedicated script would be useful for automated testing. Consider adding to `scripts/` or as a test helper in `PipelineTestHelper`.
