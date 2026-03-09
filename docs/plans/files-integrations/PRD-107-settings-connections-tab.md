# PRD-107: Settings — Connections Tab & Full Disconnect Workflow

**Phase**: Cross-Provider Enhancement
**Status**: Planned
**Prerequisites**: PRD-101 (Implemented), PRD-104 (Bug Fixes)
**Estimated Effort**: 3–4 days
**Created**: 2026-03-09

---

## 1. Objective

Add a "Connections" tab to the Settings panel that provides a centralized management view for all active integrations. This tab complements the Connections panel in the right sidebar (which focuses on configuration and folder selection) by offering account-level operations: viewing connection status and performing full disconnection with complete data cleanup.

The key new capability is a **full disconnect workflow**: a destructive action that removes the connection, deletes all synced files from the database, removes all associated embeddings from Azure AI Search, and revokes stored tokens — effectively erasing all traces of the integration as if the user never connected.

This feature is designed to be **provider-agnostic**: the same UI pattern and cleanup workflow will apply to OneDrive, SharePoint, and any future connectors.

---

## 2. Current State

### Settings Panel
- Located in `frontend/components/settings/SettingsTabs.tsx`
- Current tabs: Account, Appearance, Usage, Billing, Capabilities
- No connections/integrations management

### Connection Management
- The Connections panel in the right sidebar shows ConnectionCards with status badges
- Clicking a connected card opens the ConnectionWizard for folder configuration
- No way to fully disconnect (delete connection + cleanup all synced data)
- `DELETE /api/connections/:id` exists but only deletes the connection record and scopes — does NOT clean up synced files or AI Search embeddings

### Data Cleanup Gaps
- `files` table rows with `connection_id` are NOT cascade-deleted when a connection is deleted
- `file_chunks` records for synced files persist after connection deletion
- AI Search embeddings for synced files persist after connection deletion
- MSAL token cache in Redis persists after connection deletion

---

## 3. Expected State (After PRD-107)

### Settings > Connections Tab

A new tab in Settings showing:

```
Connections

Manage your external data source connections. Changes here affect your entire account.

┌─────────────────────────────────────────────────────────────────────┐
│  ☁️  OneDrive                                              Connected │
│  Juan's OneDrive · 3 folders synced · 47 files indexed              │
│                                                                     │
│  [Configure]                              [Disconnect ▼ destructive]│
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  📊  Business Central                                    Connected  │
│  Contoso Ltd · Active since Mar 1, 2026                             │
│                                                                     │
│  [Configure]                              [Disconnect ▼ destructive]│
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  🏢  SharePoint                                      Not connected  │
│  Connect to sync SharePoint document libraries                      │
│                                                                     │
│  [Connect]                                                          │
└─────────────────────────────────────────────────────────────────────┘
```

**Each connected integration row shows**:
- Provider icon and name (from `PROVIDER_DISPLAY_NAME`)
- Connection display name (from `connections.display_name`)
- Summary stats: scopes count, files indexed count
- **Configure** button → opens the same ConnectionWizard modal (same as clicking from sidebar)
- **Disconnect** button → opens destructive confirmation modal

**Disconnected integrations show**:
- Provider icon and name
- Description text
- **Connect** button → opens ConnectionWizard at Step 1

### Disconnect Confirmation Modal

When the user clicks "Disconnect", a confirmation modal appears:

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠️  Disconnect OneDrive                                    │
│                                                              │
│  This will permanently remove your OneDrive connection and   │
│  delete ALL associated data from MyWorkMate:                 │
│                                                              │
│  • 3 synced folder scopes will be removed                    │
│  • 47 indexed files will be deleted from your Knowledge Base │
│  • All AI search embeddings for these files will be removed  │
│  • Your OneDrive authentication tokens will be revoked       │
│                                                              │
│  Files in your OneDrive will NOT be affected.                │
│                                                              │
│  ⛔ This action is irreversible.                             │
│                                                              │
│  Type "DISCONNECT" to confirm:                               │
│  ┌──────────────────────────────┐                            │
│  │                              │                            │
│  └──────────────────────────────┘                            │
│                                                              │
│  [Cancel]                    [Disconnect OneDrive] (disabled)│
│                              (enabled when typed correctly)  │
└─────────────────────────────────────────────────────────────┘
```

**Safety features**:
- Destructive button is disabled until user types "DISCONNECT"
- Button uses destructive variant (red)
- Clear listing of what will be deleted
- Reassurance that source files are unaffected
- Provider name in title and button for clarity

---

## 4. Detailed Specifications

### 4.1 Backend — Full Disconnect API

**New endpoint**: `DELETE /api/connections/:id/full-disconnect`

This is a new endpoint (separate from the existing simple `DELETE /api/connections/:id`) that performs complete cleanup.

**Process** (sequential, within a single request):

```typescript
async fullDisconnect(connectionId: string, userId: string): Promise<FullDisconnectResult> {
  // 1. Verify ownership
  const connection = await this.connectionService.getConnection(connectionId, userId);

  // 2. Cancel any active webhook subscriptions (PRD-102)
  if (connection.scopes) {
    for (const scope of connection.scopes) {
      if (scope.subscriptionId) {
        await this.subscriptionManager.deleteSubscription(scope.id);
      }
    }
  }

  // 3. Find all synced files
  const syncedFiles = await prisma.files.findMany({
    where: { connection_id: connectionId, user_id: userId },
    select: { id: true },
  });
  const fileIds = syncedFiles.map(f => f.id);

  // 4. Delete AI Search embeddings for all synced files
  for (const fileId of fileIds) {
    await vectorSearchService.deleteChunksForFile(fileId, userId);
  }

  // 5. Delete file_chunks records
  await prisma.file_chunks.deleteMany({
    where: { file_id: { in: fileIds }, user_id: userId },
  });

  // 6. Delete files records
  await prisma.files.deleteMany({
    where: { connection_id: connectionId, user_id: userId },
  });

  // 7. Revoke stored tokens
  await graphTokenManager.revokeTokens(connectionId);

  // 8. Delete MSAL cache from Redis
  if (connection.msalPartitionKey) {
    await deleteMsalCache(connection.msalPartitionKey);
  }

  // 9. Delete connection record (cascades scopes)
  await prisma.connections.delete({ where: { id: connectionId } });

  // 10. Emit WebSocket event
  socket.emit('connection:disconnected', { connectionId, provider: connection.provider });

  return {
    filesDeleted: fileIds.length,
    scopesDeleted: connection.scopes?.length ?? 0,
    embeddingsCleared: true,
    tokensRevoked: true,
  };
}
```

**Response**: `200 OK` with `FullDisconnectResult` summary.

**Error handling**: If any step fails mid-way (e.g., AI Search deletion fails for one file), the endpoint should:
1. Log the error with full context
2. Continue with remaining cleanup steps (best-effort)
3. Return partial result indicating which steps succeeded/failed
4. The connection record is always deleted last (cleanup anchor)

### 4.2 Backend — Disconnect Summary API

**New endpoint**: `GET /api/connections/:id/disconnect-summary`

Returns the data that will be shown in the confirmation modal:

```typescript
interface DisconnectSummary {
  connectionId: string;
  provider: string;
  displayName: string;
  scopeCount: number;
  fileCount: number;
  chunkCount: number;  // approximate
}
```

This is a read-only endpoint that counts affected records without modifying anything.

### 4.3 Frontend — Settings Tab

**New file**: `frontend/components/settings/ConnectionsTab.tsx`

**Integration with existing Settings**:
- Add "Connections" tab to `SettingsTabs.tsx` tab list
- Position: after "Capabilities" (last tab)
- Icon: `Link2` or `Plug` from lucide-react

**Data source**: Uses `useIntegrations()` hook (existing from PRD-100) to fetch connection list.

**ConnectionRow component** (within ConnectionsTab):
- Provider icon (from `PROVIDER_ICON` mapping)
- Provider name (from `PROVIDER_DISPLAY_NAME`)
- Connection display name
- Stats summary: "{N} folders synced · {M} files indexed"
- Two action buttons: Configure (outline) and Disconnect (destructive)

### 4.4 Frontend — Disconnect Modal

**New file**: `frontend/components/connections/DisconnectConfirmModal.tsx`

**Props**:
```typescript
interface DisconnectConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  provider: string;
  displayName: string;
  summary: DisconnectSummary;
  onDisconnected: () => void;
}
```

**Behavior**:
1. Fetches `DisconnectSummary` from API when opened
2. Shows itemized list of what will be deleted
3. Text input for "DISCONNECT" confirmation
4. Destructive button disabled until input matches
5. On confirm: calls `DELETE /api/connections/:id/full-disconnect`
6. Shows loading spinner during cleanup
7. On success: closes modal, refreshes connection list, shows success toast
8. On partial failure: shows warning toast with details

### 4.5 Provider-Agnostic Design

The disconnect workflow is designed to work with any connector:

| Component | Provider-Specific Logic |
|---|---|
| Confirmation modal | Text interpolation only (provider name, display name) |
| Backend cleanup | Step 2 (webhook cancellation) is provider-specific. All other steps are generic. |
| Settings tab row | Icon and description from shared constants |
| Disconnect summary | Generic query by `connection_id` |

When SharePoint (PRD-103) or other connectors are added, they automatically appear in Settings > Connections and use the same disconnect workflow.

---

## 5. Implementation Order

### Step 1: Backend — Disconnect APIs (1 day)
1. Create `GET /api/connections/:id/disconnect-summary` endpoint
2. Create `DELETE /api/connections/:id/full-disconnect` endpoint
3. Implement sequential cleanup logic with error resilience
4. Unit tests: verify each cleanup step, test partial failure handling
5. Integration test: full disconnect → verify all data removed

### Step 2: Frontend — Settings Tab (1 day)
1. Create `ConnectionsTab.tsx` component
2. Add "Connections" tab to `SettingsTabs.tsx`
3. Implement `ConnectionRow` with provider info and action buttons
4. Wire "Configure" button to open ConnectionWizard
5. Wire "Connect" button for disconnected providers

### Step 3: Frontend — Disconnect Modal (1 day)
1. Create `DisconnectConfirmModal.tsx`
2. Implement typed confirmation input ("DISCONNECT")
3. Wire to `full-disconnect` API
4. Loading states and success/error toasts
5. Refresh connection list after disconnect

### Step 4: Integration Testing (0.5 day)
1. E2E: Connect OneDrive → sync files → disconnect → verify cleanup
2. Verify AI Search has no remaining embeddings for disconnected user's files
3. Verify files table has no remaining records with deleted connection_id
4. Verify MSAL cache is cleared from Redis

---

## 6. Affected Files

### New Files
| File | Purpose |
|---|---|
| `frontend/components/settings/ConnectionsTab.tsx` | Settings connections tab |
| `frontend/components/connections/DisconnectConfirmModal.tsx` | Destructive confirmation modal |

### Modified Files
| File | Change |
|---|---|
| `frontend/components/settings/SettingsTabs.tsx` | Add "Connections" tab |
| `backend/src/routes/connections.ts` | Add disconnect-summary and full-disconnect endpoints |
| `backend/src/domains/connections/ConnectionService.ts` | Add fullDisconnect() method |

---

## 7. Success Criteria

- [ ] "Connections" tab appears in Settings panel
- [ ] Active connections show provider info, display name, and stats
- [ ] "Configure" button opens ConnectionWizard modal
- [ ] "Disconnect" button opens confirmation modal
- [ ] Confirmation requires typing "DISCONNECT"
- [ ] Full disconnect removes: connection record, scopes, synced files, file chunks, AI Search embeddings, MSAL cache
- [ ] Source files in OneDrive are NOT affected
- [ ] WebSocket event notifies frontend of disconnection
- [ ] Partial failure is handled gracefully (best-effort cleanup)
- [ ] Disconnected providers show "Connect" button
- [ ] Works for all providers (provider-agnostic design)
- [ ] All existing tests pass
- [ ] Type-check and lint pass

---

## 8. Security Considerations

- The full-disconnect endpoint requires authentication (`authenticateMicrosoft` middleware)
- Ownership validation via `timingSafeCompare` (existing pattern in `ConnectionService`)
- The typed confirmation ("DISCONNECT") prevents accidental clicks
- Token revocation ensures no further Graph API access after disconnect
- MSAL cache deletion prevents silent re-authentication without explicit consent

---

## 9. Out of Scope

- Selective file removal (remove some synced files but keep connection) — use the ConnectionWizard for this
- Export/download of synced data before disconnect
- Undo/recovery after disconnect (stated as irreversible)
- Admin-level bulk disconnect (multi-user)
- Automatic disconnect on token expiry (separate concern for PRD-102 lifecycle handling)
