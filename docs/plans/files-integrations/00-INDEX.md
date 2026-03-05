# Files Integrations — Master Plan

**Project**: External File Connectors (OneDrive, SharePoint)
**Status**: Planning
**Created**: 2026-03-05
**Last Updated**: 2026-03-05

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

| PRD | Phase | Title | Backend Deliverables | UI Deliverables |
|---|---|---|---|---|
| [PRD-100](./PRD-100-foundation.md) | Foundation | Infrastructure & Abstraction Layer | Schema, `IFileContentProvider`, pipeline refactor, connections API, shared constants | Connections tab activated with real status, provider icons |
| [PRD-101](./PRD-101-onedrive-connection.md) | OneDrive | OneDrive Connection & Initial Sync | OAuth flow, `OneDriveService`, `GraphApiContentProvider`, initial delta sync, pipeline integration | Connection wizard, OneDrive folder tree root, browse + file list, sync progress |
| [PRD-102](./PRD-102-webhook-sync-engine.md) | Webhooks | Real-Time Sync Engine | Webhook endpoint, `SubscriptionManager`, `DeltaSyncService`, lifecycle handling, polling fallback | Sync status badges, last-synced timestamps, real-time file appearance, sync error states |
| [PRD-103](./PRD-103-sharepoint-connection.md) | SharePoint | SharePoint Connection | `SharePointService`, multi-site discovery, library browsing, SP-specific delta, reuse webhook infra | SP connection wizard (multi-step site/library picker), SP folder tree root, SP visual theme |

### Dependency Chain

```
PRD-100 (Foundation)
   |
   v
PRD-101 (OneDrive) -------> PRD-102 (Webhooks)
                                |
                                v
                          PRD-103 (SharePoint)
```

PRD-100 is a hard prerequisite for all others. PRD-101 and PRD-102 are sequential (need files to exist before syncing changes). PRD-103 reuses all infrastructure from 100-102.

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
- Connections tab: BC="Configure", SP/OD/PBI="Coming soon" (placeholder)

### 4.4 Coding Standards (Mandatory)

1. **No magic strings**: All provider IDs, status enums, event names as constants in `@bc-agent/shared`
2. **Strict typing**: No `any`. Use Zod for runtime validation at system boundaries.
3. **UPPERCASE IDs**: All UUIDs/GUIDs must be UPPERCASE throughout the system.
4. **Stateless singletons**: All services receive `ExecutionContext` or per-request params. No mutable instance state.
5. **Structured logging**: Use `createChildLogger({ service: 'ServiceName' })`. Never `console.log`.
6. **Error serialization**: Extract `{ message, stack, name, cause }` before logging.
7. **Tests before refactors**: Write tests covering existing behavior BEFORE modifying code.
8. **Shared package as source of truth**: Cross-cutting types, constants, and classification logic in `@bc-agent/shared`.

### 4.5 Risks & Mitigations

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

## 5. Shared Constants & Types (To Be Created in PRD-100)

### Provider Constants (`@bc-agent/shared`)

```typescript
// constants/providers.ts
export const PROVIDER_ID = {
  LOCAL: 'local',
  ONEDRIVE: 'onedrive',
  SHAREPOINT: 'sharepoint',
  BUSINESS_CENTRAL: 'business_central',
  POWER_BI: 'power_bi',
} as const;

export const PROVIDER_DISPLAY_NAME = {
  [PROVIDER_ID.LOCAL]: 'My Files',
  [PROVIDER_ID.ONEDRIVE]: 'OneDrive',
  [PROVIDER_ID.SHAREPOINT]: 'SharePoint',
  [PROVIDER_ID.BUSINESS_CENTRAL]: 'Business Central',
  [PROVIDER_ID.POWER_BI]: 'Power BI',
} as const;

export const PROVIDER_ACCENT_COLOR = {
  [PROVIDER_ID.LOCAL]: 'neutral',
  [PROVIDER_ID.ONEDRIVE]: '#0078D4',
  [PROVIDER_ID.SHAREPOINT]: '#038387',
  [PROVIDER_ID.BUSINESS_CENTRAL]: '#00BCF2',
  [PROVIDER_ID.POWER_BI]: '#F2C811',
} as const;

export const PROVIDER_ICON = {
  [PROVIDER_ID.LOCAL]: 'HardDrive',
  [PROVIDER_ID.ONEDRIVE]: 'Cloud',
  [PROVIDER_ID.SHAREPOINT]: 'Globe',
  [PROVIDER_ID.BUSINESS_CENTRAL]: 'Building2',
  [PROVIDER_ID.POWER_BI]: 'BarChart3',
} as const;
```

### Connection & Sync Status Constants

```typescript
// constants/connection-status.ts
export const CONNECTION_STATUS = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error',
  EXPIRED: 'expired',
} as const;

export const SYNC_STATUS = {
  PENDING: 'pending',
  SYNCING: 'syncing',
  SYNCED: 'synced',
  ERROR: 'error',
} as const;

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
