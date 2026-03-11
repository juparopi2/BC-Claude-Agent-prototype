# PRD-108: Real-Time Sync Engine (Change Notifications)

**Phase**: Webhooks
**Status**: COMPLETED (with post-implementation fixes — see Sections 13 and 14)
**Prerequisites**: PRD-107 (OneDrive UX Polish)
**Estimated Effort**: 6-8 days
**Created**: 2026-03-05
**Completed**: 2026-03-10

---

## 1. Objective

Enable near-real-time file synchronization using Microsoft Graph Change Notifications (webhooks). When a user modifies, adds, or deletes files in their synced OneDrive folders, the system detects changes and automatically updates the RAG pipeline.

UI deliverables include sync status badges, last-synced timestamps, real-time file appearance/removal, and sync error states.

---

## 2. Current State (After PRD-101)

- Users can connect OneDrive and perform initial sync via delta query
- External files are processed through the RAG pipeline
- `connection_scopes` table stores `delta_link` from initial sync
- `subscription_id` and `subscription_expires_at` columns exist but are unused
- No webhook infrastructure exists
- No mechanism to detect changes after initial sync

---

## 3. Expected State (After PRD-108)

### Backend
- Public HTTPS webhook endpoint receives Graph change notifications
- `SubscriptionManager`: create, renew, and delete Graph subscriptions per scope
- `DeltaSyncService`: process delta changes (new files, modified files, deleted files)
- `ExternalFileSyncWorker` (BullMQ): queue-based processing of change notifications
- `SubscriptionRenewalWorker`: cron-based renewal of expiring subscriptions
- Polling fallback: scheduled job catches missed webhook notifications
- Lifecycle notification handling (`reauthorizationRequired`, `subscriptionRemoved`)
- Two new BullMQ queues: `EXTERNAL_FILE_SYNC`, `SUBSCRIPTION_MGMT`

### Frontend
- Sync status badge on each connection scope:
  - Green dot + "Synced" + relative timestamp ("2 min ago")
  - Blue spinner + "Syncing..." (during active sync)
  - Red dot + "Sync error" + error details tooltip
- Files appear/disappear in real-time as changes are detected
- Modified files show brief "Updating..." indicator while re-processing
- Connection detail view shows subscription health status
- "Sync Now" manual trigger button for on-demand resync

---

## 4. Detailed Specifications

### 4.1 Webhook Endpoint

**Location**: `backend/src/services/sync/WebhookController.ts`
**Route**: `POST /api/webhooks/graph`

This is a PUBLIC endpoint — no user authentication. Validation is done via `clientState` matching.

#### Validation Flow (Microsoft Graph requirement)

When a subscription is created, Microsoft Graph sends a validation request:

```
POST /api/webhooks/graph?validationToken=<url-encoded-token>
Content-Type: text/plain

Response: 200 OK
Content-Type: text/plain
Body: <url-decoded-validation-token>
```

Must respond within 10 seconds.

#### Notification Flow

```
POST /api/webhooks/graph
Content-Type: application/json

{
  "value": [
    {
      "subscriptionId": "sub-uuid",
      "subscriptionExpirationDateTime": "2026-04-01T00:00:00Z",
      "changeType": "updated",
      "resource": "drives/drive-id/root",
      "clientState": "secret-per-scope",
      "tenantId": "tenant-uuid"
    }
  ]
}

Response: 202 Accepted (IMMEDIATELY — do NOT process inline)
```

#### Processing Flow

```
1. Receive notification
2. Validate clientState against stored connection_scopes
3. Respond 202 Accepted (within 3 seconds)
4. Enqueue job to EXTERNAL_FILE_SYNC queue:
   { subscriptionId, connectionId, scopeId, userId }
5. ExternalFileSyncWorker picks up job
6. Execute delta query using saved deltaLink
7. Process changes (create, update, delete)
8. Save new deltaLink
```

### 4.2 SubscriptionManager

**Location**: `backend/src/services/sync/SubscriptionManager.ts`

```typescript
export class SubscriptionManager {
  /**
   * Create a Graph change notification subscription for a scope.
   * POST /subscriptions
   *
   * resource: "drives/{driveId}/root"
   * changeType: "updated"
   * expirationDateTime: now + 29 days (max for driveItem)
   * notificationUrl: "https://{our-domain}/api/webhooks/graph"
   * clientState: random 128-char secret (stored in connection_scopes)
   * lifecycleNotificationUrl: "https://{our-domain}/api/webhooks/graph/lifecycle"
   */
  async createSubscription(
    connectionId: string,
    scopeId: string
  ): Promise<SubscriptionResult>;

  /**
   * Renew an existing subscription.
   * PATCH /subscriptions/{subscriptionId}
   * Extends expirationDateTime by another 29 days.
   */
  async renewSubscription(scopeId: string): Promise<void>;

  /**
   * Delete a subscription (when user disconnects or removes scope).
   * DELETE /subscriptions/{subscriptionId}
   */
  async deleteSubscription(scopeId: string): Promise<void>;

  /**
   * Find all scopes with subscriptions expiring within threshold.
   * Used by cron job for proactive renewal.
   */
  async findExpiringSubscriptions(
    withinHours: number
  ): Promise<ConnectionScopeWithConnection[]>;
}
```

**Subscription per scope**: Each `connection_scope` gets its own subscription. This allows granular control (user can unsync a single folder without affecting others).

**clientState**: Random 128-character string generated per scope, stored in `connection_scopes.client_state` column (new column). Used to validate that incoming notifications are authentic.

### 4.3 DeltaSyncService

**Location**: `backend/src/services/sync/DeltaSyncService.ts`

Processes delta query results after a webhook notification.

```typescript
export class DeltaSyncService {
  /**
   * Process all changes for a scope since last deltaLink.
   */
  async processChanges(
    connectionId: string,
    scopeId: string,
    userId: string
  ): Promise<DeltaSyncResult>;
}
```

**Change processing logic**:

```typescript
for (const change of deltaChanges) {
  if (change.changeType === 'deleted') {
    // File removed from source
    // 1. Find local file by external_id + connection_id
    // 2. Soft-delete: mark for deletion -> remove embeddings -> remove record
    // 3. Emit file:deleted WebSocket event
    await this.handleDeletedFile(change, userId);

  } else if (change.item.isFolder) {
    // Folder created/modified
    // 1. Create or update folder record in files table
    // 2. If new folder INSIDE a synced scope: include its files in future deltas
    await this.handleFolderChange(change, connectionId, scopeId, userId);

  } else {
    // File created or modified
    const existingFile = await this.findByExternalId(change.item.id, connectionId);

    if (!existingFile) {
      // NEW file: create record + enqueue pipeline
      await this.handleNewFile(change, connectionId, scopeId, userId);
    } else if (existingFile.content_hash_external !== change.item.eTag) {
      // MODIFIED file: re-process through pipeline
      // 1. Delete existing embeddings from AI Search
      // 2. Delete existing chunks from DB
      // 3. Reset pipeline_status to 'queued'
      // 4. Re-enqueue processing pipeline
      // 5. Emit file:readiness_changed (processing)
      await this.handleModifiedFile(existingFile, change, userId);
    }
    // else: eTag unchanged = no content change (e.g., metadata-only update) -> skip
  }
}
```

**Important**: Modified files require clearing existing embeddings before re-processing. The soft-delete pattern from `SoftDeleteService` is partially reused (delete from AI Search + chunks), but the file record itself is kept and re-processed.

### 4.4 ExternalFileSyncWorker

**Location**: `backend/src/infrastructure/queue/workers/ExternalFileSyncWorker.ts`
**Queue**: `EXTERNAL_FILE_SYNC`

```typescript
interface ExternalFileSyncJobData {
  subscriptionId: string;
  connectionId: string;
  scopeId: string;
  userId: string;
  trigger: 'webhook' | 'polling' | 'manual';
}
```

**Concurrency**: 5 (limited by Graph API rate limits)
**Lock duration**: LONG (90 seconds) — delta queries + file creation can be slow
**Retry**: 3 attempts with exponential backoff (5s, 15s, 45s)

**Process**:
1. Load connection and scope from DB
2. Verify connection status is 'connected'
3. Execute `DeltaSyncService.processChanges()`
4. Update `connection_scopes.last_synced_at`
5. Emit `sync:completed` WebSocket event
6. On error: update `connection_scopes.sync_status = 'error'`, emit `sync:error`

**Deduplication**: If multiple webhook notifications arrive for the same scope within a short window, use BullMQ job ID `delta-sync--{scopeId}` to prevent duplicate processing. BullMQ will reject duplicate job IDs.

> **Note**: The job ID uses `--` as separator, not `:`. BullMQ forbids `:` in custom job IDs because Redis uses `:` as a key namespace separator (see Section 13, Bug #2).

### 4.5 SubscriptionRenewalWorker

**Location**: `backend/src/infrastructure/queue/workers/SubscriptionRenewalWorker.ts`
**Queue**: `SUBSCRIPTION_MGMT`

**Cron schedule**: Every 12 hours (`0 */12 * * *`)

**Process**:
1. Find all subscriptions expiring within 48 hours
2. For each: attempt `PATCH /subscriptions/{id}` to renew
3. If renewal fails (404 = subscription already expired):
   - Recreate subscription
   - Trigger delta sync to catch up on missed changes
4. Update `subscription_expires_at` in DB
5. Log all renewal results

### 4.6 Lifecycle Notification Handler

**Route**: `POST /api/webhooks/graph/lifecycle`

Handles Microsoft Graph lifecycle notifications:

#### `reauthorizationRequired`
- Microsoft is about to revoke the subscription because the token is expiring
- Action: Call `POST /subscriptions/{id}/reauthorize` with fresh token
- Or: Renew the subscription via PATCH

#### `subscriptionRemoved`
- Microsoft has removed the subscription (e.g., admin consent revoked)
- Action: Recreate subscription + trigger full delta sync
- Update `connection_scopes.subscription_id` with new ID

### 4.7 Polling Fallback

**Location**: `backend/src/services/sync/SyncScheduler.ts`

Even with webhooks, some notifications may be lost (network issues, our endpoint down, etc.). A polling job runs as safety net.

**Cron schedule**: Every 30 minutes (`*/30 * * * *`)
**Queue**: `EXTERNAL_FILE_SYNC` (same queue, different trigger)

**Process**:
1. Find all scopes where `last_synced_at < NOW() - 30 minutes` AND `sync_status = 'synced'`
2. For each: enqueue delta sync job with `trigger: 'polling'`
3. This catches any missed webhook notifications

**Optimization**: If the delta query returns no changes, cost is 1 RU per scope. For 10K users with 2 scopes each = 20K RU per polling cycle. At 30-min intervals = ~40K RU/hour. Well within per-app limits.

### 4.8 New Database Column

Add to `connection_scopes`:
```prisma
client_state              String?   @db.NVarChar(200)   // Webhook validation secret
```

### 4.9 New Queue Definitions

Add to `QueueName` enum and queue constants:

```typescript
EXTERNAL_FILE_SYNC = 'external-file-sync'
SUBSCRIPTION_MGMT = 'subscription-mgmt'
```

**Configuration**:
| Queue | Concurrency | Lock Duration | Retry |
|---|---|---|---|
| EXTERNAL_FILE_SYNC | 5 | 90s (LONG) | 3 attempts, exponential 5s |
| SUBSCRIPTION_MGMT | 2 | 60s (MEDIUM) | 3 attempts, exponential 10s |

### 4.10 WebSocket Events (New)

Add to existing sync events from PRD-101:

```typescript
// Scope-level sync events
'sync:file_added'     -> { connectionId, scopeId, fileId, fileName, sourceType }
'sync:file_updated'   -> { connectionId, scopeId, fileId, fileName }
'sync:file_removed'   -> { connectionId, scopeId, fileId, fileName }

// Subscription health events
'connection:subscription_renewed'  -> { connectionId, scopeId, expiresAt }
'connection:subscription_error'    -> { connectionId, scopeId, error }
```

### 4.11 Frontend: Sync Status Indicators

**Modified**: `frontend/components/layout/RightPanel.tsx` (connections tab)

Each connection scope shows sync status:

```
OneDrive — Connected
├── Documents/     ✓ Synced (2 min ago)     [Sync Now]
├── Projects/      ⟳ Syncing... (43%)
└── Shared/        ✗ Sync error             [Retry]
```

**New store**: `frontend/src/domains/connections/stores/syncStatusStore.ts`

```typescript
interface ScopeStatus {
  syncStatus: SyncStatus;
  lastSyncedAt: string | null;
  filesProcessed: number;
  filesTotal: number;
  error: string | null;
}

interface SyncStatusState {
  scopeStatuses: Map<string, ScopeStatus>;
}
```

**Updated by**: WebSocket events (sync:*, connection:*)

**New hook**: `frontend/src/domains/connections/hooks/useSyncEvents.ts`

Subscribes to sync WebSocket events and updates `syncStatusStore`.

### 4.12 Frontend: Real-Time File Updates

When `sync:file_added` is received:
1. `fileListStore.addFile(newFile)` — file appears in list immediately
2. `fileProcessingStore.setProcessingStatus(fileId, { readinessState: 'processing' })`
3. File shows spinner in status column while processing
4. On `file:readiness_changed(ready)`: status updates to checkmark

When `sync:file_removed` is received:
1. `fileListStore.deleteFiles([fileId])` — file disappears from list
2. If file was in preview modal: close modal with toast "File was removed from source"

When `sync:file_updated` is received:
1. `fileListStore.updateFile(fileId, { readinessState: 'processing' })`
2. Brief "Updating..." indicator appears
3. On `file:readiness_changed(ready)`: back to normal

### 4.13 Frontend: Manual Sync Button

Each synced scope shows a "Sync Now" button.

Click -> `POST /api/connections/:id/scopes/:scopeId/sync`
Backend enqueues delta sync job with `trigger: 'manual'`.
Button shows spinner during sync, disabled to prevent double-click.

---

## 5. Implementation Order

### Step 1: Webhook Endpoint + Validation (1 day)
1. Create `WebhookController` with validation logic
2. Create lifecycle notification handler endpoint
3. Unit tests: validation token response, notification parsing, clientState verification
4. Manual test: use Microsoft Graph Explorer to send test notification

### Step 2: SubscriptionManager (1.5 days)
1. Implement create, renew, delete operations
2. Add `client_state` column to `connection_scopes`
3. Unit tests with mocked Graph API responses
4. Integration test: create subscription -> verify DB state

### Step 3: DeltaSyncService (2 days)
1. Implement change processing logic (new, modified, deleted)
2. Handle modified files: clear embeddings -> re-process
3. Handle deleted files: soft-delete pipeline
4. Unit tests: all change type scenarios
5. Integration test: mock delta response with mixed changes

### Step 4: Queue Workers (1 day)
1. Implement `ExternalFileSyncWorker`
2. Implement `SubscriptionRenewalWorker`
3. Add new queues to `QueueManager` and `WorkerRegistry`
4. Configure cron schedules
5. Unit tests for both workers

### Step 5: Polling Fallback + Lifecycle Handling (0.5 day)
1. Implement `SyncScheduler` cron job
2. Wire lifecycle notifications to subscription renewal
3. Unit tests for polling logic and lifecycle handlers

### Step 6: Frontend — Sync Status UI (1 day)
1. Create `syncStatusStore`
2. Create `useSyncEvents` hook
3. Sync status badges in connections tab
4. "Sync Now" button
5. Real-time file add/remove/update in file list

### Step 7: Integration Testing (1 day)
1. End-to-end webhook flow: notification -> delta sync -> file processing
2. Subscription renewal cycle test
3. Polling fallback test
4. Modified file re-processing test
5. Deleted file cleanup test

---

## 6. Success Criteria

### Backend
- [ ] Webhook endpoint correctly validates Microsoft Graph notifications
- [ ] Subscriptions are created when scopes are added (PRD-101 triggers this post-sync)
- [ ] Webhook notifications trigger delta sync within 30 seconds
- [ ] New files in OneDrive appear in the system and process through pipeline
- [ ] Modified files have their embeddings regenerated
- [ ] Deleted files are soft-deleted and embeddings removed
- [ ] Subscriptions auto-renew before expiration (48h buffer)
- [ ] Polling fallback catches missed notifications (30-min interval)
- [ ] Lifecycle notifications handled (reauthorize, subscription removed)
- [ ] Rate limiting prevents Graph API throttling
- [ ] All new code has unit tests

### Frontend
- [ ] Sync status badges show correct state per scope (synced, syncing, error)
- [ ] "Last synced X ago" timestamp updates in real-time
- [ ] New files appear in file list when added to OneDrive
- [ ] Modified files show "Updating..." briefly then return to normal
- [ ] Deleted files disappear from file list
- [ ] "Sync Now" button triggers immediate resync
- [ ] Sync errors show actionable error message with retry option

### E2E Verification
1. Add a file to synced OneDrive folder -> verify it appears in system within 5 minutes
2. Modify a file in OneDrive -> verify embeddings are regenerated
3. Delete a file from OneDrive -> verify it disappears from system
4. Disable webhook endpoint -> wait 30 min -> verify polling catches up
5. "Sync Now" button -> verify immediate delta sync executes
6. RAG search returns content from newly synced files

---

## 7. Infrastructure Requirements

### Public HTTPS Endpoint
The webhook endpoint MUST be publicly accessible via HTTPS. Options:
1. **Azure Container Apps** (current infra): Already HTTPS with custom domain
2. **Development**: Use ngrok or Azure Dev Tunnels for local testing
3. **Webhook URL**: `https://{DOMAIN}/api/webhooks/graph`

### Environment Variables (New)
```bash
# Webhook configuration
GRAPH_WEBHOOK_BASE_URL=https://myworkmate.azurecontainerapps.io
GRAPH_WEBHOOK_PATH=/api/webhooks/graph
GRAPH_LIFECYCLE_WEBHOOK_PATH=/api/webhooks/graph/lifecycle

# Sync configuration
SYNC_POLLING_INTERVAL_MINUTES=30
SUBSCRIPTION_RENEWAL_BUFFER_HOURS=48
SUBSCRIPTION_MAX_DURATION_DAYS=29
```

---

## 8. Risks & Mitigations (PRD-108 Specific)

| Risk | Mitigation |
|---|---|
| Webhook endpoint must respond within 10 seconds | Process async: respond 202 immediately, enqueue job |
| Microsoft drops notifications if endpoint is slow (>10% fail) | Monitor response times. Alert if p95 > 5 seconds. |
| Subscription expires without renewal (cron failure) | Polling fallback every 30 min catches missed changes. Manual "Sync Now" as escape hatch. |
| Delta token expires (410 Gone) | Catch 410, clear deltaLink, restart full enumeration for scope |
| Modified file re-processing leaves stale embeddings | Delete ALL chunks/embeddings BEFORE re-processing. Atomic: mark file as 'queued' before deletion. |
| Concurrent notifications for same scope | Each webhook creates a unique BullMQ job; `sync_status === 'syncing'` guard + delta cursor idempotency prevent conflicts (see Section 14, Bug #7) |
| Delta cursor URLs are absolute | Graph `@odata.deltaLink` and `@odata.nextLink` are full absolute URLs — must be passed verbatim to fetch, never prepend the Graph API base URL (see Section 13, Bug #3) |
| Overlapping scopes on same connection | Adding parent + child folders as separate scopes causes `connection_scope_id` reassignment during sync. Files from parent delta get reassigned to child scopes, making parent appear empty. Users should add only the top-level folder; sub-folders are included automatically by the folder-scoped delta query. |

---

## 9. Out of Scope

- SharePoint change notifications (PRD-111 — same infra, different resource paths)
- Bidirectional sync (write back to OneDrive)
- Granular change tracking within files (only full file re-processing)
- Real-time collaborative editing awareness
- Webhook endpoint authentication beyond clientState validation
- Cross-connection deduplication (see Section 10)

---

## 10. Implementation Notes (From PRD-104)

### 10.1 Re-Connection to Same Scope Triggers Full Re-Processing

**Observed during PRD-104 verification (2026-03-09)**

When a user disconnects and reconnects to the same OneDrive scope (or creates a second connection pointing to the same folder), all files are re-processed through the full embedding pipeline — even though identical content already exists in the system from the previous connection.

**Root cause**: Deduplication in PRD-104 is scoped to `(connection_id, external_id)`. A new connection gets a new `connection_id`, so all files appear as "new" to the `findFirst` check in `InitialSyncService`, triggering `addFileProcessingFlow()` for every file.

**Impact**: Unnecessary compute cost (extraction + chunking + embedding) for files whose content hasn't changed. For large scopes (1000+ files), this can mean significant Azure AI Search and OpenAI embedding costs.

**Possible optimization for PRD-108**: When `DeltaSyncService` or `InitialSyncService` creates a new file, check if an identical file already exists for the same user by comparing `(user_id, external_id, content_hash_external)`. If a match is found with `pipeline_status = 'ready'`:
1. Copy existing `file_chunks` to the new file record (re-link chunk references)
2. Reuse existing AI Search embeddings (or clone them with the new file ID)
3. Set `pipeline_status = 'ready'` directly, skipping the processing pipeline

**Decision**: Deferred — this optimization requires careful handling of chunk/embedding ownership across connections and is better addressed alongside PRD-108's content change detection logic, which already compares `content_hash_external` (eTag). The infrastructure for "skip processing if content is identical" aligns naturally with the "skip processing if content hasn't changed" logic in `DeltaSyncService.processChanges()`.

---

## 11. Implementation Summary (2026-03-10)

### New Files (5)

| File | Purpose |
|------|---------|
| `backend/src/services/sync/SubscriptionManager.ts` | Graph subscription lifecycle (create/renew/delete). `clientState` generated via `crypto.randomBytes(64).toString('hex').toUpperCase()`. Singleton: `getSubscriptionManager()`. |
| `backend/src/services/sync/DeltaSyncService.ts` | Incremental delta sync. `syncDelta()` returns `DeltaSyncResult { newFiles, updatedFiles, deletedFiles, skipped }`. Handles new/modified/deleted files and folders. Modified files: clear embeddings + re-process. |
| `backend/src/routes/webhooks.ts` | Public webhook endpoint (no auth). `POST /graph`: validation handshake (200 text/plain) + notification processing (202 + async enqueue). `POST /graph/lifecycle`: handles reauthorizationRequired, subscriptionRemoved, missed. |
| `backend/src/infrastructure/queue/workers/ExternalFileSyncWorker.ts` | BullMQ worker for `EXTERNAL_FILE_SYNC` queue. Dynamic import of DeltaSyncService. |
| `backend/src/infrastructure/queue/workers/SubscriptionRenewalWorker.ts` | BullMQ worker for `SUBSCRIPTION_MGMT` queue. Two job types: `renew-subscriptions` + `poll-delta`. |

### Modified Files (17)

| File | Changes |
|------|---------|
| `packages/shared/src/constants/sync-events.ts` | Added 5 events: SYNC_FILE_ADDED, SYNC_FILE_UPDATED, SYNC_FILE_REMOVED, SUBSCRIPTION_RENEWED, SUBSCRIPTION_ERROR |
| `packages/shared/src/types/onedrive.types.ts` | Added 5 payload interfaces + extended SyncWebSocketEvent union |
| `packages/shared/src/types/index.ts` + `src/index.ts` | Re-exported new payload types |
| `backend/prisma/schema.prisma` | Added `client_state String? @db.NVarChar(200)` to connection_scopes |
| `backend/src/services/connectors/onedrive/GraphHttpClient.ts` | Added `post<T>()`, `patch<T>()`, `delete()` methods |
| `backend/src/infrastructure/queue/constants/queue.constants.ts` | EXTERNAL_FILE_SYNC + SUBSCRIPTION_MGMT queues, cron patterns, concurrency, backoff, lock config, job priorities |
| `backend/src/infrastructure/queue/types/jobs.types.ts` | ExternalFileSyncJob + SubscriptionMgmtJob interfaces |
| `backend/src/infrastructure/config/environment.ts` | GRAPH_WEBHOOK_BASE_URL, SYNC_POLLING_INTERVAL_MINUTES, SUBSCRIPTION_RENEWAL_BUFFER_HOURS, SUBSCRIPTION_MAX_DURATION_DAYS |
| `backend/src/infrastructure/queue/MessageQueue.ts` | Imported/registered new workers, added `addExternalFileSyncJob()` with jobId dedup |
| `backend/src/infrastructure/queue/core/QueueManager.ts` | createQueue for both new queues |
| `backend/src/infrastructure/queue/core/WorkerRegistry.ts` | Default concurrency for new queues |
| `backend/src/infrastructure/queue/core/ScheduledJobManager.ts` | `initializeSyncJobs()`: renew every 12h, poll every 30m |
| `backend/src/services/sync/InitialSyncService.ts` | Fire-and-forget subscription creation post-sync (if GRAPH_WEBHOOK_BASE_URL set) |
| `backend/src/routes/connections.ts` | "Sync Now" uses DeltaSyncService if scope has cursor, else InitialSyncService |
| `backend/src/services/sync/ScopeCleanupService.ts` | Deletes Graph subscription on scope removal |
| `backend/src/domains/connections/ConnectionRepository.ts` | Added subscription_id to ScopeRow + select clauses |
| `backend/src/server.ts` | Registered `/api/webhooks` route (public, no auth) |
| `frontend/src/infrastructure/socket/SocketClient.ts` | 5 new event listeners for sync/subscription events |
| `frontend/src/domains/integrations/stores/syncStatusStore.ts` | Added lastSyncedAt + error fields and actions |
| `frontend/src/domains/integrations/hooks/useSyncEvents.ts` | Handlers for file_added/updated/removed + subscription_error |

### Key Design Decisions

1. **DeltaSyncService separate from InitialSyncService** — Different concerns (incremental vs full enumeration)
2. **BullMQ jobId dedup** — `delta-sync--${scopeId}` prevents concurrent processing
3. **Polling fallback every 30 min** — Safety net for missed webhooks (1 RU/scope if no changes)
4. **Fire-and-forget subscription creation** — Non-fatal; polling covers the gap
5. **Modified file = clear embeddings first** — Delete ALL chunks/embeddings BEFORE re-processing
6. **Dynamic imports** throughout to avoid circular dependencies

---

## 12. Local Development & Debugging Guide

### 12.1 Dev Tunnel Setup

The webhook endpoint must be publicly reachable. For local development, use Azure Dev Tunnels:

```bash
npm run dev:tunnel
```

This starts the backend dev server and opens a persistent dev tunnel. **Critical**: the tunnel must use `--protocol http` (not `https`) because the local Node.js server speaks plain HTTP. The tunnel terminates TLS and forwards HTTP to localhost.

The server performs a POST self-test 5 seconds after startup. Look for:
- `"Webhook endpoint reachable"` — tunnel is working
- `"Webhook self-test failed"` — check tunnel status, firewall, or port

### 12.2 Debugging with LOG_SERVICES

Filter backend logs to webhook/sync services:

```bash
LOG_SERVICES=WebhookRoutes,SubscriptionManager,DeltaSyncService,ExternalFileSyncWorker,SubscriptionRenewalWorker,InitialSyncService,GraphHttpClient npm run dev
```

### 12.3 Log File Location

Persistent logs are written to `backend/logs/app.log`. This file is useful for post-hoc debugging when the console scrollback is lost.

### 12.4 Common Failure Modes

| Symptom | Diagnosis |
|---------|-----------|
| Tunnel returns 502 | `--protocol https` in dev-tunnel.sh tells tunnel the local service speaks HTTPS; backend is HTTP. Use `--protocol http`. |
| Graph API returns 404 `ResourceNotFound` with `"Invalid version: v1.0https:"` | Delta cursor URL is being double-prefixed with base URL. See Section 13, Bug #3. |
| BullMQ throws `ERR invalid characters in job ID` | Job ID contains `:` which is forbidden. Use `--` as separator. See Section 13, Bug #2. |
| Subscription creation fails with "URL not reachable" | `GRAPH_WEBHOOK_BASE_URL` is not set or the tunnel is not running. |
| Delta sync returns 410 Gone | Delta token has expired. Clear `last_sync_cursor` and re-run initial sync for the scope. |
| Files from parent scope reassigned to child scope | Overlapping scopes on same connection. See Risks table. |

---

## 13. Post-Implementation Bug Fixes (2026-03-10)

Bugs discovered during end-to-end testing after initial implementation.

### Bug #1: Dev tunnel returns 502 (FIXED)

**Root cause**: `dev-tunnel.sh` used `--protocol https`, which told the Azure Dev Tunnel that the local service speaks HTTPS. The backend serves plain HTTP on localhost.

**Fix**: Changed `--protocol https` to `--protocol http` in `backend/scripts/dev-tunnel.sh`.

**Evidence**: After fix, tunnel correctly forwards `POST /api/webhooks/graph` and webhook self-test passes.

### Bug #2: BullMQ jobId with colon (FIXED)

**Root cause**: The deduplication job ID was `delta-sync:${scopeId}`. BullMQ uses Redis under the hood, and Redis uses `:` as a key namespace separator. BullMQ explicitly forbids `:` in custom job IDs.

**Fix**: Changed job ID format from `delta-sync:${scopeId}` to `delta-sync--${scopeId}` in `MessageQueue.addExternalFileSyncJob()`.

**Lesson learned**: Never use `:` in BullMQ job IDs. Use `--` as an alternative separator.

### Bug #3: Delta query URL doubled (FIXED)

**Root cause**: `GraphHttpClient.get()` always prepended `BASE_URL` (`https://graph.microsoft.com/v1.0`) to the path. But Microsoft Graph `@odata.deltaLink` and `@odata.nextLink` cursors are **full absolute URLs**. When `DeltaSyncService` passed `scope.last_sync_cursor` (an absolute URL) through `OneDriveService.executeFolderDeltaQuery()` to `GraphHttpClient.get()`, the result was a doubled URL:

```
https://graph.microsoft.com/v1.0https://graph.microsoft.com/v1.0/drives/...
```

Graph API returned 404 with `"Invalid version: v1.0https:"`.

**Fix**: Added `absoluteUrl` parameter to `GraphHttpClient.get()` (the infrastructure already existed in `fetchWithRetry()` and was used by `getWithPagination()`). Updated `OneDriveService.executeDeltaQuery()` and `executeFolderDeltaQuery()` to pass `absoluteUrl: true` when using a stored deltaLink.

**Files changed**:
- `backend/src/services/connectors/onedrive/GraphHttpClient.ts` — `get()` now accepts optional `absoluteUrl` param
- `backend/src/services/connectors/onedrive/OneDriveService.ts` — Both delta methods pass `true` when using absolute cursor URLs

**Official docs confirm**: Microsoft Graph delta links are always full absolute URLs (source: [driveItem-delta.md](https://github.com/microsoftgraph/microsoft-graph-docs-contrib/blob/main/api-reference/v1.0/api/driveitem-delta.md)).

### Bug #4: Delta sync creates files at root folder (FIXED)

**Root cause**: `DeltaSyncService` did not implement the `externalToInternalId` folder mapping pattern from `InitialSyncService`. New files and folders created during delta sync had `parent_folder_id = NULL`, placing them at the root level regardless of their actual location in OneDrive.

**Fix**:
1. Extracted folder hierarchy resolution logic into shared `FolderHierarchyResolver.ts` utility (5 functions: `buildFolderMap`, `ensureScopeRootFolder`, `resolveParentFolderId`, `sortFoldersByDepth`, `upsertFolder`)
2. Refactored `DeltaSyncService` to build folder map, process changes in order (deletions → folders sorted by depth → files), and resolve `parent_folder_id` for all items
3. Refactored `InitialSyncService` to use the same shared utility (identical behavior, unified code)
4. Updated file records also get `parent_folder_id` updated (handles file moves)

**Files changed**:
- `backend/src/services/sync/FolderHierarchyResolver.ts` (new) — shared folder resolution logic
- `backend/src/services/sync/DeltaSyncService.ts` — restructured change processing with three-phase approach
- `backend/src/services/sync/InitialSyncService.ts` — delegated folder logic to shared utility

---

## 14. Post-Implementation Bug Fixes — Round 2 (2026-03-10)

Bugs discovered during real-world OneDrive delete testing. The symptom: a file deleted in OneDrive disappears in real-time (WebSocket event works) but **reappears after page refresh**.

### Bug #5: `deletion_status` not set on delta sync deletions (CRITICAL — FIXED)

**Root cause**: `DeltaSyncService` soft-delete only set `deleted_at`:

```typescript
data: { deleted_at: new Date() }  // Missing deletion_status!
```

But the frontend file listing API (`FileRepository.findMany()`) filters by `deletion_status: null` — NOT by `deleted_at`. Since `deletion_status` was never set by delta sync, deleted files remained visible in all queries after page refresh.

The existing `SoftDeleteService` (used for manual `DELETE /api/files`) correctly sets `deletion_status = 'pending'` first.

**Fix**: Added `deletion_status: 'pending'` to both soft-delete paths in `DeltaSyncService`:
1. Direct file deletion (line ~302): `data: { deleted_at: new Date(), deletion_status: 'pending' }`
2. Child file deletion inside folder deletion (line ~252): same

**File changed**: `backend/src/services/sync/DeltaSyncService.ts`

### Bug #6: No embedding/chunk cleanup for deleted files (MEDIUM — FIXED)

**Root cause**: When `DeltaSyncService` deleted a file, it did NOT:
1. Delete vector embeddings from AI Search (`VectorSearchService.deleteChunksForFile()`)
2. Delete `file_chunks` records from DB

Compare with modified files (which DO clean up embeddings) and `SoftDeleteService` (which does full cleanup). This left orphaned embeddings in AI Search, meaning RAG queries could still return results from deleted files.

**Fix**: Added embedding + chunk cleanup before each soft-delete in `DeltaSyncService`:
```typescript
// Clean up embeddings + chunks (same pattern as modified files)
try {
  await VectorSearchService.getInstance().deleteChunksForFile(fileId, userId);
} catch (vecErr) { /* log warn, don't abort */ }
await prisma.file_chunks.deleteMany({ where: { file_id: fileId } });
```

Applied in both paths: direct file deletion AND child files of deleted folders.

**File changed**: `backend/src/services/sync/DeltaSyncService.ts`

### Bug #7: BullMQ dedup silently drops concurrent webhooks (LOW — FIXED)

**Root cause**: `MessageQueue.addExternalFileSyncJob()` used `jobId: delta-sync--${scopeId}`. If a job with this ID was already queued/active, BullMQ silently discarded the new one. This meant if two webhooks arrived within the sync execution window (~500ms-2s), the second was lost — its changes would only be picked up by the 30-min polling fallback.

**Fix**: Removed fixed jobId entirely. Each webhook now creates a unique job (BullMQ auto-generates IDs). The `sync_status === 'syncing'` guard in `DeltaSyncService` prevents truly concurrent execution, but the second job remains in the queue and runs after the first completes. The delta cursor mechanism makes this safe — the second query simply returns 0 changes if nothing new happened.

**File changed**: `backend/src/infrastructure/queue/MessageQueue.ts`

**Note**: Updated Section 8, Risk table entry for "Concurrent notifications for same scope" — dedup is no longer via jobId but via delta cursor idempotency.

### Logging Improvements (added alongside bug fixes)

Added structured logging across the webhook/sync pipeline for better observability:

| File | New Logging |
|------|-------------|
| `backend/src/routes/webhooks.ts` | Full notification payload (subscriptionId, changeType, resource) on webhook receipt |
| `backend/src/infrastructure/queue/MessageQueue.ts` | Job enqueue details (jobId, scopeId, triggerType) |
| `backend/src/services/sync/DeltaSyncService.ts` | Delta change categorization summary (deletions/folders/files), per-deletion DB lookup result, per-deletion soft-delete confirmation |
| `backend/src/services/connectors/onedrive/OneDriveService.ts` | Raw deleted items with `deleted` facet from Graph API delta response |

**Recommended LOG_SERVICES for debugging**:
```bash
LOG_SERVICES=WebhookRoutes,SubscriptionManager,DeltaSyncService,ExternalFileSyncWorker,SubscriptionRenewalWorker,InitialSyncService,GraphHttpClient,FolderHierarchyResolver,MessageQueue,OneDriveService npm run dev
```

---

## 15. Post-Implementation Bug Fixes — Round 3 (2026-03-11)

Bugs discovered during real-world testing with file/folder add/delete in OneDrive.

### Bug #8: "undefined" file names on deleted delta items (HIGH — FIXED)

**Root cause**: Microsoft Graph API deleted delta items only contain `id` and a `deleted` facet — **no `name` field**. In `OneDriveService.mapDriveItem()`, `String(item.name)` produced the literal string `"undefined"` when `item.name` was absent. This propagated to logs, WebSocket events, and frontend toasts.

**Fix**:
1. `OneDriveService.ts` — `mapDriveItem()`: Changed `String(item.name)` to `item.name != null ? String(item.name) : ''`
2. `DeltaSyncService.ts` — Added `name` to the deletion DB lookup `select` clause and used `item.name || existing.name` as fallback for WebSocket events, so the name stored during initial sync is used when Graph omits it

### Bug #9: Folder deletion FK constraint violation (HIGH — FIXED)

**Root cause**: When deleting a folder, `DeltaSyncService` only soft-deleted immediate child **files** (`is_folder: false`) then attempted to hard-delete the folder. If the folder had **subfolders**, those records still referenced it via `parent_folder_id` with `onDelete: NoAction`, causing a FK constraint violation.

Additionally, Graph API only sends a delete event for the **top-level folder** — subfolders are NOT individually reported as deleted.

**Fix**: Replaced flat child-file-only logic with recursive descendant collection:
1. `collectDescendants()` recursively finds all files and subfolders under the deleted folder
2. All descendant files are soft-deleted (with embedding + chunk cleanup)
3. All descendant subfolders are hard-deleted bottom-up (deepest first to respect FK ordering)
4. The folder itself is hard-deleted last

**File changed**: `backend/src/services/sync/DeltaSyncService.ts`

### Bug #10: "undefined files synced from OneDrive" toast (MEDIUM — FIXED)

**Root cause**: `DeltaSyncService` emitted `SYNC_COMPLETED` with `{ newFiles, updatedFiles, deletedFiles, skipped }` but the `SyncCompletedPayload` type expects `{ totalFiles }`. The frontend read `event.totalFiles` → `undefined` → toast showed "undefined files synced from OneDrive".

`InitialSyncService` correctly sends `totalFiles`.

**Fix**: Added `totalFiles: result.newFiles + result.updatedFiles + result.deletedFiles` to the `SYNC_COMPLETED` payload. Extra fields (`newFiles`, `updatedFiles`, etc.) kept for log visibility.

**File changed**: `backend/src/services/sync/DeltaSyncService.ts`

### Bug #11: Breadcrumb & file tree don't update after delta sync (LOW — FIXED)

**Root cause**: `useSyncEvents` hook called `refreshCurrentFolder()` on sync events, which only refreshes the file list for the current folder. It never invalidated the `treeFolders` cache in `folderTreeStore`, so the sidebar folder tree and breadcrumb did not reflect changes from delta sync.

**Fix**: On `SYNC_COMPLETED`, invalidate all cached entries in `folderTreeStore.treeFolders` via `invalidateTreeFolder()` for each cached key. This forces re-fetch on next expand without clearing navigation state (`currentFolderId`, `folderPath`, `expandedFolderIds`).

**File changed**: `frontend/src/domains/integrations/hooks/useSyncEvents.ts`

### Bug #12: Folder deletion blocked by FK constraint on soft-deleted children (HIGH — FIXED)

**Root cause**: When deleting a folder, Phase 1 soft-deletes all descendant files by setting `deleted_at` and `deletion_status: 'pending'`, but does NOT null out `parent_folder_id`. When Phase 3 attempts to hard-delete the folder record, the FK constraint (`FK__files__parent_fo__41B8C09B`, `onDelete: NoAction`) blocks the delete because soft-deleted children still reference the folder.

Additionally, when a folder is deleted in OneDrive, the delta response often includes both the folder AND its individual child files as separate deletion items. After the folder deletion handler already soft-deletes all descendants, the individual file items are processed again redundantly.

**Fix**:
1. Added `parent_folder_id: null` to the descendant file soft-delete data, releasing the FK reference before the folder is hard-deleted
2. Added `deletion_status` to the deletion lookup `select` clause and a guard to skip files already soft-deleted (e.g., processed as part of a folder deletion earlier in the same batch)

**File changed**: `backend/src/services/sync/DeltaSyncService.ts`
