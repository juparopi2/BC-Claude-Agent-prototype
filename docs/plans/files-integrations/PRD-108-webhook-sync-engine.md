# PRD-108: Real-Time Sync Engine (Change Notifications)

**Phase**: Webhooks
**Status**: Planned
**Prerequisites**: PRD-107 (OneDrive UX Polish)
**Estimated Effort**: 6-8 days
**Created**: 2026-03-05

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

**Deduplication**: If multiple webhook notifications arrive for the same scope within a short window, use BullMQ job ID `sync--{scopeId}` to prevent duplicate processing. BullMQ will reject duplicate job IDs.

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
| Concurrent notifications for same scope | BullMQ job dedup via `sync--{scopeId}` job ID |

---

## 9. Out of Scope

- SharePoint change notifications (PRD-111 — same infra, different resource paths)
- Bidirectional sync (write back to OneDrive)
- Granular change tracking within files (only full file re-processing)
- Real-time collaborative editing awareness
- Webhook endpoint authentication beyond clientState validation
