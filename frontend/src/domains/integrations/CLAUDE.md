# Frontend Integrations Domain

## Purpose

UI state management for cloud connections (OneDrive + SharePoint): connection lifecycle, sync status tracking, real-time WebSocket events, and connection health monitoring.

## Stores

### integrationListStore
Connection list and wizard state management.

- `connections: Connection[]` — active cloud connections
- `wizardState` — connection wizard step tracking
- **Actions**: `fetchConnections()`, `refreshConnection(id)`, `removeConnection(id)`

### syncStatusStore
Real-time sync operation tracking.

- `activeSyncs: Record<scopeId, SyncEntry>` — ongoing sync operations
- `operations: Map<key, SyncOperation>` — granular operation tracking

**`useShallow` required**: `selectVisibleOperations()` returns a derived array — must wrap with `useShallow` to prevent infinite re-render loop. See `.claude/rules/zustand-selectors.md`.

## Hooks

| Hook | Purpose |
|---|---|
| `useIntegrations` | Fetch connections on mount |
| `useSyncEvents` | WebSocket listener for sync/processing/file events (incl. `processing:started` PRD-305) |
| `useSyncRetry` | PRD-305: Fetch failed files from health API, retry via `/api/files/{id}/retry-processing` |
| `useAuthHealth` | Auth token health polling |
| `useConnectionHealth` | Connection status polling |
| `useSyncOperation` | Individual operation lifecycle tracking |

### useSyncEvents — Event Types Handled

| Event | Effect |
|---|---|
| `sync:progress` | Update activeSyncs with progress % |
| `sync:completed` | Transition to 'processing' if processingTotal > 0 |
| `sync:error` | Mark sync as failed |
| `processing:started` | PRD-305: Prime store with total so panel shows "Processing 0/N" immediately |
| `processing:progress` | Update processing count |
| `processing:completed` | Transition to 'idle' |
| `file_added` / `file_updated` / `file_removed` | Update file stores |
| `connection:expired` / `connection:disconnected` | Mark connection unhealthy |

## Connection Wizard Flow

```
1. Select provider (OneDrive / SharePoint)
2. OAuth redirect → token storage
3. Browse files/folders (lazy-loaded tree)
4. Select scopes (folders/files to sync)
5. Confirm selection
6. InitialSync dispatched to BullMQ
```

## Sync Status Three-Phase (PRD-305)

```
sync:completed (processingTotal > 0)
    → status = 'processing'
        → processing:started (first file enters extraction)
            → SyncProgressPanel shows "Processing 0/N files..."
        → processing:progress (each file completes)
            → SyncProgressPanel shows "Processing X/N files..."
        → processing:completed
            → status = 'idle'
            → If failed > 0: SyncFailedFilesSection shows retry UI
```

If `processingTotal === 0` at sync completion, status goes directly to 'idle'.

## UI Patterns

- **Toast suppression**: Suppress individual file toasts when `SyncProgressPanel` is visible
- **Folder tree invalidation**: Clear cached folder listings on `file_added`/`file_updated`/`file_removed` events for 'onedrive-root'/'sharepoint-root' source types
- **Optimistic updates**: Connection removal updates store immediately, then confirms with backend

## Key Files

| File | Purpose |
|---|---|
| `stores/integrationListStore.ts` | Connection list + wizard state |
| `stores/syncStatusStore.ts` | Sync operation tracking |
| `hooks/useSyncEvents.ts` | WebSocket event listener |
| `hooks/useSyncRetry.ts` | PRD-305: Failed file retry for SyncProgressPanel |
| `hooks/useIntegrations.ts` | Connection fetching |
| `components/ConnectionCard.tsx` | Connection display + actions |
| `components/ConnectionWizard.tsx` | Multi-step connection setup |

## Related

- Backend connectors: `backend/src/services/connectors/CLAUDE.md`
- Backend sync: `backend/src/services/sync/CLAUDE.md`
- Zustand selectors: `.claude/rules/zustand-selectors.md`
