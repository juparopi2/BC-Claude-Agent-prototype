/**
 * useSyncEvents Hook (PRD-107)
 *
 * Subscribes to sync WebSocket events and updates stores.
 * Shows toast notifications on sync completion/error.
 *
 * @module domains/integrations/hooks/useSyncEvents
 */

import { useEffect, useRef, useCallback } from 'react';
import { getSocketClient } from '@/src/infrastructure/socket/SocketClient';
import { useSyncStatusStore } from '../stores/syncStatusStore';
import { useIntegrationListStore } from '../stores/integrationListStore';
import { useFolderTreeStore } from '@/src/domains/files/stores/folderTreeStore';
import { useFiles } from '@/src/domains/files';
import { SYNC_WS_EVENTS, PROVIDER_DISPLAY_NAME, CONNECTIONS_API, type SyncWebSocketEvent } from '@bc-agent/shared';
import { toast } from 'sonner';
import { env } from '@/lib/config/env';

/** Prevents concurrent refresh attempts for the same connection. */
const refreshingConnections = new Set<string>();

/**
 * Hook for subscribing to sync WebSocket events.
 *
 * Updates syncStatusStore and shows toasts on completion/error.
 * Call this once in FileExplorer — it listens globally.
 */
export function useSyncEvents(): void {
  const setSyncStatus = useSyncStatusStore((s) => s.setSyncStatus);
  const setLastSyncedAt = useSyncStatusStore((s) => s.setLastSyncedAt);
  const setSyncError = useSyncStatusStore((s) => s.setSyncError);
  const invalidateTreeFolder = useFolderTreeStore((s) => s.invalidateTreeFolder);
  const { refreshCurrentFolder } = useFiles();

  // Use refs to avoid re-subscribing on every render
  const refreshRef = useRef(refreshCurrentFolder);
  const setSyncStatusRef = useRef(setSyncStatus);
  const setLastSyncedAtRef = useRef(setLastSyncedAt);
  const setSyncErrorRef = useRef(setSyncError);
  const invalidateTreeFolderRef = useRef(invalidateTreeFolder);

  useEffect(() => {
    refreshRef.current = refreshCurrentFolder;
  }, [refreshCurrentFolder]);

  useEffect(() => {
    setSyncStatusRef.current = setSyncStatus;
  }, [setSyncStatus]);

  useEffect(() => {
    setLastSyncedAtRef.current = setLastSyncedAt;
  }, [setLastSyncedAt]);

  useEffect(() => {
    setSyncErrorRef.current = setSyncError;
  }, [setSyncError]);

  useEffect(() => {
    invalidateTreeFolderRef.current = invalidateTreeFolder;
  }, [invalidateTreeFolder]);

  const getProviderName = useCallback((connectionId: string): string => {
    const conn = useIntegrationListStore.getState().connections.find(c => c.id === connectionId);
    return conn ? PROVIDER_DISPLAY_NAME[conn.provider as keyof typeof PROVIDER_DISPLAY_NAME] ?? 'external source' : 'external source';
  }, []);

  const handleSyncEvent = useCallback((event: SyncWebSocketEvent) => {
    switch (event.type) {
      case SYNC_WS_EVENTS.SYNC_COMPLETED as 'sync:completed':
        setSyncStatusRef.current(event.scopeId, 'idle');
        setLastSyncedAtRef.current(event.scopeId, new Date().toISOString());
        refreshRef.current();
        // Invalidate all cached folder tree entries to force re-fetch
        for (const key of Object.keys(useFolderTreeStore.getState().treeFolders)) {
          invalidateTreeFolderRef.current(key);
        }
        toast.success('Sync completed', {
          description: `${event.totalFiles} file${event.totalFiles !== 1 ? 's' : ''} synced from ${getProviderName(event.connectionId)}`,
        });
        break;

      case SYNC_WS_EVENTS.SYNC_ERROR as 'sync:error':
        setSyncStatusRef.current(event.scopeId, 'error');
        setSyncErrorRef.current(event.scopeId, event.error);
        toast.error('Sync failed', {
          description: event.error,
        });
        break;

      case SYNC_WS_EVENTS.SYNC_PROGRESS as 'sync:progress':
        setSyncStatusRef.current(event.scopeId, 'syncing', event.percentage);
        break;

      case SYNC_WS_EVENTS.SYNC_FILE_ADDED as 'sync:file_added':
        refreshRef.current();
        toast.info('File synced', {
          description: `"${event.fileName}" added from ${getProviderName(event.connectionId)}`,
        });
        break;

      case SYNC_WS_EVENTS.SYNC_FILE_UPDATED as 'sync:file_updated':
        refreshRef.current();
        toast.info('File updated', {
          description: `"${event.fileName}" re-processing`,
        });
        break;

      case SYNC_WS_EVENTS.SYNC_FILE_REMOVED as 'sync:file_removed':
        refreshRef.current();
        break;

      case SYNC_WS_EVENTS.SUBSCRIPTION_ERROR as 'connection:subscription_error':
        toast.error('Sync subscription error', {
          description: event.error,
        });
        break;

      case SYNC_WS_EVENTS.CONNECTION_EXPIRED as 'connection:expired': {
        // Attempt silent token refresh before showing the reconnect banner
        const connId = event.connectionId;

        if (refreshingConnections.has(connId)) break;
        refreshingConnections.add(connId);

        (async () => {
          try {
            const resp = await fetch(
              `${env.apiUrl}${CONNECTIONS_API.BASE}/${connId}/refresh`,
              { method: 'POST', credentials: 'include' }
            );

            if (resp.ok) {
              const data = await resp.json() as { status: string };
              if (data.status === 'refreshed') {
                await useIntegrationListStore.getState().fetchConnections();
                toast.success('Connection restored', {
                  description: `${getProviderName(connId)} session renewed automatically.`,
                });
                return;
              }
            }
          } catch {
            // Silent refresh failed — fall through to manual reconnect
          } finally {
            refreshingConnections.delete(connId);
          }

          // Fall through: refresh failed, show manual reconnect flow
          useIntegrationListStore.getState().fetchConnections();
          invalidateTreeFolderRef.current('onedrive-root');
          invalidateTreeFolderRef.current('sharepoint-root');
          toast.warning(`${getProviderName(connId)} session expired`, {
            description: 'Please reconnect to continue syncing.',
          });
        })();
        break;
      }

      case SYNC_WS_EVENTS.CONNECTION_DISCONNECTED:
        // Refresh connections list after a full disconnect
        useIntegrationListStore.getState().fetchConnections();
        break;
    }
  }, [getProviderName]);

  useEffect(() => {
    const client = getSocketClient();
    const unsubscribe = client.onSyncEvent(handleSyncEvent);
    return () => {
      unsubscribe();
    };
  }, [handleSyncEvent]);
}
