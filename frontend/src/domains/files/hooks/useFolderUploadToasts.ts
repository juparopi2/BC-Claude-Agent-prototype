/**
 * useFolderUploadToasts Hook
 *
 * Hook that shows toast notifications for folder upload session events.
 * Listens to WebSocket events via useFolderBatchEvents and displays
 * appropriate toasts for completion, cancellation, and failure.
 *
 * @module domains/files/hooks/useFolderUploadToasts
 */

import { useFolderBatchEvents } from './useFolderBatchEvents';
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

  useFolderBatchEvents({
    enabled,
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
