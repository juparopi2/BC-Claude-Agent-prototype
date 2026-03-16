# PRD-118: SharePoint Webhook Subscription Parity

## Status: IN PROGRESS
## Priority: P0 (Critical — affects real-time sync for SharePoint folder scopes)
## Dependencies: PRD-108 (completed), PRD-111 (completed), PRD-116 (completed)

---

## 1. Problem Statement

SharePoint folder scopes do not receive Microsoft Graph webhook subscriptions, and the polling fallback mechanism is dead code. Together, these gaps mean that changes to files inside a SharePoint folder scope are never detected in real time and have no safety net.

### 1.1 Root Problems

| # | Problem | Impact | Root Cause |
|---|---|---|---|
| **GAP 1** | SharePoint folder scopes never get webhook subscriptions | Changes only detectable via manual "Sync Now" | Two guards (`InitialSyncService` + `SubscriptionManager`) skip subscription creation when `remote_drive_id` is set — intended for OneDrive shared scopes, but SharePoint folder scopes also set `remote_drive_id` (to the library driveId) |
| **GAP 2** | Polling fallback (`pollDelta`) always finds 0 scopes | No safety net if webhooks fail — changes silently lost | PRD-116 changed post-sync status from `'idle'` to `'synced'`, but `pollDelta` still queries for `sync_status = 'idle'` |

---

## 2. Gap Analysis

### 2.1 GAP 1: SharePoint Folder Scopes Skip Webhook Subscriptions

**Symptom**: A SharePoint folder scope syncs correctly on initial sync, but subsequent changes are not detected in real time.

**Root Cause — Two redundant guards**:

#### Guard A: `InitialSyncService._runSync()` (line 429)

```typescript
// PRD-108: Create Graph subscription for webhook notifications
// PRD-110: Skip subscription for shared scopes (no webhook support for remote drives)
if (!scope.remote_drive_id) {
  // ... createSubscription()
}
```

SharePoint folder scopes have `remote_drive_id` set to the library's driveId (by `SharePointWizard.tsx`). Guard A evaluates `!remote_drive_id` as `false` and never calls `createSubscription()`.

#### Guard B: `SubscriptionManager.createSubscription()` (line 89)

```typescript
// PRD-110: Skip subscription for shared scopes (no webhook support for remote drives)
if (scope.remote_drive_id) {
  logger.info('Skipping subscription for shared scope (remote drive)');
  return;
}
```

Guard B is redundant with Guard A but also blocks the 2 other call sites:
1. `SubscriptionRenewalWorker.renewExpiring()` — subscription recreation on 404
2. `webhooks.ts` — subscription recreation on `subscriptionRemoved`

#### Scope Type Matrix

| scope_type | remote_drive_id | provider | Guard A | Guard B | Subscription |
|------------|----------------|----------|---------|---------|-------------|
| root (OneDrive) | null | onedrive | PASS | PASS | Created |
| folder (OneDrive) | null | onedrive | PASS | PASS | Created |
| folder (OneDrive shared) | `<remoteDriveId>` | onedrive | BLOCK | BLOCK | Correctly skipped |
| library (SharePoint) | null | sharepoint | PASS | PASS | Created |
| **folder (SharePoint)** | **`<libraryDriveId>`** | **sharepoint** | **BLOCK** | **BLOCK** | **BUG: Skipped** |

#### Why the driveId Resolution Was Dead Code

Inside `createSubscription()`, the driveId resolution branch for `scope.remote_drive_id` (line 107-108) was dead code because Guard B (line 89) already returned early for any scope with `remote_drive_id` set.

### 2.2 GAP 2: Polling Fallback Is Dead Code

**File**: `SubscriptionRenewalWorker.ts`, `pollDelta()` method (line 90)

```typescript
const staleScopeRows = await prisma.connection_scopes.findMany({
  where: {
    sync_status: 'idle',  // ← Only matches 'idle'
    last_sync_cursor: { not: null },
    last_sync_at: { lt: staleThreshold },
  },
});
```

After PRD-116, `InitialSyncService` and `DeltaSyncService` both set `sync_status = 'synced'` on completion. The value `'idle'` is only used for:
- Initial state before first sync
- Reset during disconnect

The cron job runs every 30 minutes but **always finds 0 matching scopes**, rendering the polling fallback completely inoperative.

---

## 3. Solution

### 3.1 Fix GAP 1

#### Fix 1A: `SubscriptionManager.createSubscription()` (primary)

1. Move the connection fetch (with `provider` in SELECT) **before** the guard.
2. Update the guard to skip only non-SharePoint scopes with `remote_drive_id`:

```typescript
if (scope.remote_drive_id && connection.provider !== 'sharepoint') {
  return; // Skip only OneDrive shared scopes
}
```

3. The existing driveId resolution branch (`else if (scope.remote_drive_id)`) is now reachable and correctly resolves the library driveId for SharePoint folder scopes.

#### Fix 1B: `InitialSyncService._runSync()` (caller guard)

Update the guard at line 429 to allow SharePoint folder scopes:

```typescript
const shouldCreateSubscription = !scope.remote_drive_id || connection.provider === 'sharepoint';
if (shouldCreateSubscription) { ... }
```

The same fix applies to `_runFileLevelSync()` (line 622).

#### Fix 1C: JSDoc update

Update `SubscriptionManager` module docstring from "for OneDrive connection scopes" to "for OneDrive and SharePoint connection scopes".

### 3.2 Fix GAP 2

Update `pollDelta()` query to match both `'synced'` and `'idle'` statuses:

```typescript
sync_status: { in: ['synced', 'idle'] },
```

---

## 4. Verification

### Automated Tests

1. SP folder scope (`scope_type='folder'`, `remote_drive_id` set, `provider='sharepoint'`) → subscription IS created
2. OneDrive shared scope (`remote_drive_id` set, `provider='onedrive'`) → subscription IS skipped (regression)
3. SP library scope (`scope_type='library'`, `remote_drive_id` null) → subscription IS created (regression)
4. OD root scope (no `remote_drive_id`) → subscription IS created (regression)
5. `pollDelta()`: scopes with `sync_status='synced'` ARE returned

### Manual

6. Connect SharePoint → select folder scope → verify `subscription_id` populated in DB
7. Modify file in SP folder → verify webhook triggers delta sync
8. Verify OneDrive sync unaffected
9. Verify shared items still skip subscription

---

## 5. Files Modified

| File | Change |
|------|--------|
| `backend/src/services/sync/SubscriptionManager.ts` | Move connection fetch, add `provider`, update guard + JSDoc |
| `backend/src/services/sync/InitialSyncService.ts` | Update subscription guards in `_runSync` and `_runFileLevelSync` |
| `backend/src/infrastructure/queue/workers/SubscriptionRenewalWorker.ts` | Fix polling `sync_status` filter |
| `backend/src/__tests__/unit/services/sync/SubscriptionManager.test.ts` | Add SP folder scope + regression tests |
| `backend/src/__tests__/unit/infrastructure/queue/workers/SubscriptionRenewalWorker.test.ts` | Add polling `sync_status` tests |
