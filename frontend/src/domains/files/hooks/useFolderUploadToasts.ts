/**
 * useFolderUploadToasts Hook
 *
 * Hook that shows toast notifications for folder upload session events.
 * Listens to WebSocket events via useFolderBatchEvents and displays
 * appropriate toasts for completion, cancellation, and failure.
 *
 * @module domains/files/hooks/useFolderUploadToasts
 */

import { useCallback } from 'react';
import { useFolderBatchEvents } from './useFolderBatchEvents';
import { useFolderTreeStore } from '../stores/folderTreeStore';
import { getFileApiClient } from '@/src/infrastructure/api';
import { toast } from 'sonner';

/**
 * Options for useFolderUploadToasts hook
 */
export interface UseFolderUploadToastsOptions {
  /** Whether to enable toast notifications (default: true) */
  enabled?: boolean;
}

/**
 * Hook that shows toast notifications for folder upload events
 *
 * Subscribes to folder batch WebSocket events and shows appropriate
 * toasts when sessions complete, are cancelled, or fail.
 *
 * @param options - Hook options
 *
 * @example
 * ```tsx
 * function FileUploadZone() {
 *   // Show toasts for folder upload events
 *   useFolderUploadToasts({ enabled: true });
 *
 *   return <DropZone />;
 * }
 * ```
 */
export function useFolderUploadToasts(
  options: UseFolderUploadToastsOptions = {}
): void {
  const { enabled = true } = options;

  // Refresh root folders in tree as safety net
  const handleTreeRefreshNeeded = useCallback(async () => {
    try {
      const fileApi = getFileApiClient();
      const result = await fileApi.getFiles({ folderId: undefined });
      if (result.success) {
        const rootFolders = result.data.files.filter((f: { isFolder: boolean }) => f.isFolder);
        useFolderTreeStore.getState().setTreeFolders('root', rootFolders);
      }
    } catch {
      // Non-critical: tree will be refreshed on next navigation
    }
  }, []);

  useFolderBatchEvents({
    enabled,
    onTreeRefreshNeeded: handleTreeRefreshNeeded,
    onSessionComplete: (sessionId, completedFolders, failedFolders) => {
      if (failedFolders === 0) {
        toast.success('Upload complete', {
          description: completedFolders === 1
            ? '1 folder uploaded successfully'
            : `${completedFolders} folders uploaded successfully`,
        });
      } else {
        toast.warning('Upload completed with errors', {
          description: `${completedFolders} folder(s) succeeded, ${failedFolders} folder(s) failed`,
        });
      }
    },
    onSessionCancel: (sessionId, filesRolledBack) => {
      toast.info('Upload cancelled', {
        description: filesRolledBack > 0
          ? `${filesRolledBack} file(s) removed`
          : 'No files were uploaded',
      });
    },
    onSessionFail: (sessionId, error) => {
      toast.error('Upload failed', {
        description: error.length > 100 ? `${error.substring(0, 100)}...` : error,
        duration: 8000,
      });
    },
  });
}
