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
import { useSyncStatusStore, selectHasActiveOperations } from '../stores/syncStatusStore';
import { useIntegrationListStore } from '../stores/integrationListStore';
import { useFolderTreeStore } from '@/src/domains/files/stores/folderTreeStore';
import { useFileHealthStore } from '@/src/domains/files/stores/fileHealthStore';
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
  const setProcessingProgress = useSyncStatusStore((s) => s.setProcessingProgress);
  const invalidateTreeFolder = useFolderTreeStore((s) => s.invalidateTreeFolder);
  const { refreshCurrentFolder } = useFiles();

  // Use refs to avoid re-subscribing on every render
  const refreshRef = useRef(refreshCurrentFolder);
  const setSyncStatusRef = useRef(setSyncStatus);
  const setLastSyncedAtRef = useRef(setLastSyncedAt);
  const setSyncErrorRef = useRef(setSyncError);
  const setProcessingProgressRef = useRef(setProcessingProgress);
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
    setProcessingProgressRef.current = setProcessingProgress;
  }, [setProcessingProgress]);

  useEffect(() => {
    invalidateTreeFolderRef.current = invalidateTreeFolder;
  }, [invalidateTreeFolder]);

  const getProviderName = useCallback((connectionId: string): string => {
    const conn = useIntegrationListStore.getState().connections.find(c => c.id === connectionId);
    return conn ? PROVIDER_DISPLAY_NAME[conn.provider as keyof typeof PROVIDER_DISPLAY_NAME] ?? 'external source' : 'external source';
  }, []);

  const handleSyncEvent = useCallback((event: SyncWebSocketEvent) => {
    switch (event.type) {
      case SYNC_WS_EVENTS.SYNC_COMPLETED as 'sync:completed': {
        // Check if there are files that need processing (PRD-117)
        const processingTotal = event.processingTotal ?? 0;

        if (processingTotal > 0) {
          // Two-phase: discovery complete, but processing still pending
          setSyncStatusRef.current(event.scopeId, 'processing');
          setLastSyncedAtRef.current(event.scopeId, new Date().toISOString());
          refreshRef.current();
          for (const key of Object.keys(useFolderTreeStore.getState().treeFolders)) {
            invalidateTreeFolderRef.current(key);
          }
          // Do NOT call completeScope() yet — wait for processing:completed
          if (!selectHasActiveOperations(useSyncStatusStore.getState())) {
            toast.info('Sync discovered files', {
              description: `${event.totalFiles} file${event.totalFiles !== 1 ? 's' : ''} found — processing for search...`,
            });
          }
        } else {
          setSyncStatusRef.current(event.scopeId, 'idle');
          setLastSyncedAtRef.current(event.scopeId, new Date().toISOString());
          refreshRef.current();
          // Invalidate all cached folder tree entries to force re-fetch
          for (const key of Object.keys(useFolderTreeStore.getState().treeFolders)) {
            invalidateTreeFolderRef.current(key);
          }
          // Notify the operation tracker
          useSyncStatusStore.getState().completeScope(event.scopeId);
          // Suppress toast when SyncProgressPanel is handling it
          if (!selectHasActiveOperations(useSyncStatusStore.getState())) {
            toast.success('Sync completed', {
              description: `${event.totalFiles} file${event.totalFiles !== 1 ? 's' : ''} synced from ${getProviderName(event.connectionId)}`,
            });
          }
        }
        break;
      }

      case SYNC_WS_EVENTS.SYNC_ERROR as 'sync:error': {
        setSyncStatusRef.current(event.scopeId, 'error');
        setSyncErrorRef.current(event.scopeId, event.error);
        // Notify the operation tracker
        useSyncStatusStore.getState().failScope(event.scopeId, event.error);
        // Suppress toast when SyncProgressPanel is handling it
        if (!selectHasActiveOperations(useSyncStatusStore.getState())) {
          toast.error('Sync failed', {
            description: event.error,
          });
        }
        break;
      }

      case SYNC_WS_EVENTS.SYNC_PROGRESS as 'sync:progress':
        setSyncStatusRef.current(event.scopeId, 'syncing', event.percentage);
        break;

      case SYNC_WS_EVENTS.PROCESSING_STARTED as 'processing:started':
        // PRD-305: Prime store so SyncProgressPanel transitions from "Discovering..." to "Processing 0/N"
        setProcessingProgressRef.current(event.scopeId, {
          total: event.total,
          completed: 0,
          failed: 0,
        });
        break;

      case SYNC_WS_EVENTS.PROCESSING_PROGRESS as 'processing:progress':
        setProcessingProgressRef.current(event.scopeId, {
          total: event.total,
          completed: event.completed,
          failed: event.failed,
        });
        break;

      case SYNC_WS_EVENTS.PROCESSING_COMPLETED as 'processing:completed': {
        setSyncStatusRef.current(event.scopeId, 'idle');
        useSyncStatusStore.getState().completeScope(event.scopeId);
        refreshRef.current();
        if (!selectHasActiveOperations(useSyncStatusStore.getState())) {
          toast.success('Files ready for search', {
            description: `${event.totalReady} file${event.totalReady !== 1 ? 's' : ''} processed${event.totalFailed > 0 ? ` (${event.totalFailed} failed)` : ''}`,
          });
        }
        break;
      }

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

      case SYNC_WS_EVENTS.SYNC_HEALTH_REPORT:
        // PRD-300: Health report received — future UI will surface this
        break;

      case SYNC_WS_EVENTS.SYNC_RECOVERY_COMPLETED:
        // PRD-300: Recovery completed — future UI will surface this
        break;

      case SYNC_WS_EVENTS.SYNC_RECONCILIATION_STARTED as 'sync:reconciliation_started':
        useFileHealthStore.getState().setReconciling(true);
        break;

      case SYNC_WS_EVENTS.SYNC_RECONCILIATION_COMPLETED as 'sync:reconciliation_completed': {
        // Always reset isReconciling — even if report is null (error/cooldown path)
        useFileHealthStore.getState().setReconciling(false);

        // report is null when reconciliation failed (cooldown, in-progress, or error)
        if (!event.report) break;

        const totalIssues =
          event.report.missingFromSearchCount +
          event.report.orphanedInSearchCount +
          event.report.failedRetriableCount +
          event.report.stuckFilesCount +
          event.report.imagesMissingEmbeddingsCount;

        const totalRepairs =
          event.report.repairs.missingRequeued +
          event.report.repairs.orphansDeleted +
          event.report.repairs.failedRequeued +
          event.report.repairs.stuckRequeued +
          event.report.repairs.imageRequeued;

        const folderRepairs = event.report.repairs?.folderHierarchy?.scopeRootsRecreated ?? 0;

        // Refresh UI for ANY trigger when repairs were made (folders restored, files requeued)
        if (totalRepairs > 0 || folderRepairs > 0) {
          refreshRef.current();
          // Invalidate folder tree cache so expanded libraries re-fetch their children
          for (const key of Object.keys(useFolderTreeStore.getState().treeFolders)) {
            invalidateTreeFolderRef.current(key);
          }
        }

        // Toast: cron shows background repair, login shows subtle notification
        if (event.triggeredBy === 'cron' && totalIssues > 0) {
          if (event.report.dryRun) {
            toast.info('Background file check', {
              description: `${totalIssues} issue${totalIssues !== 1 ? 's' : ''} detected.`,
            });
          } else {
            toast.success('Background file repair', {
              description: `${totalRepairs} file${totalRepairs !== 1 ? 's' : ''} repaired automatically.`,
            });
          }
        } else if (event.triggeredBy === 'login' && (totalRepairs > 0 || folderRepairs > 0)) {
          toast.success('Files synchronized', {
            description: `${totalRepairs + folderRepairs} issue${(totalRepairs + folderRepairs) !== 1 ? 's' : ''} repaired on login.`,
          });
        }
        break;
      }
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
