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
import { useFiles } from '@/src/domains/files';
import { SYNC_WS_EVENTS, type SyncWebSocketEvent } from '@bc-agent/shared';
import { toast } from 'sonner';

/**
 * Hook for subscribing to sync WebSocket events.
 *
 * Updates syncStatusStore and shows toasts on completion/error.
 * Call this once in FileExplorer — it listens globally.
 */
export function useSyncEvents(): void {
  const setSyncStatus = useSyncStatusStore((s) => s.setSyncStatus);
  const { refreshCurrentFolder } = useFiles();

  // Use refs to avoid re-subscribing on every render
  const refreshRef = useRef(refreshCurrentFolder);
  const setSyncStatusRef = useRef(setSyncStatus);

  useEffect(() => {
    refreshRef.current = refreshCurrentFolder;
  }, [refreshCurrentFolder]);

  useEffect(() => {
    setSyncStatusRef.current = setSyncStatus;
  }, [setSyncStatus]);

  const handleSyncEvent = useCallback((event: SyncWebSocketEvent) => {
    switch (event.type) {
      case SYNC_WS_EVENTS.SYNC_COMPLETED as 'sync:completed':
        setSyncStatusRef.current(event.scopeId, 'idle');
        refreshRef.current();
        toast.success('Sync completed', {
          description: `${event.totalFiles} file${event.totalFiles !== 1 ? 's' : ''} synced from OneDrive`,
        });
        break;

      case SYNC_WS_EVENTS.SYNC_ERROR as 'sync:error':
        setSyncStatusRef.current(event.scopeId, 'error');
        toast.error('Sync failed', {
          description: event.error,
        });
        break;

      case SYNC_WS_EVENTS.SYNC_PROGRESS as 'sync:progress':
        setSyncStatusRef.current(event.scopeId, 'syncing', event.percentage);
        break;
    }
  }, []);

  useEffect(() => {
    const client = getSocketClient();
    const unsubscribe = client.onSyncEvent(handleSyncEvent);
    return () => {
      unsubscribe();
    };
  }, [handleSyncEvent]);
}
