/**
 * Files Domain - Hooks
 *
 * Re-exports all file-related React hooks.
 *
 * @module domains/files/hooks
 */

export { useFileSelection, type UseFileSelectionReturn } from './useFileSelection';
export { useFiles, type UseFilesReturn } from './useFiles';
export { useFolderNavigation, type UseFolderNavigationReturn } from './useFolderNavigation';
export { useFileActions, type UseFileActionsReturn } from './useFileActions';
export { useGoToFilePath, type UseGoToFilePathReturn } from './useGoToFilePath';
export { useFileRetry, type UseFileRetryReturn } from './useFileRetry';
export {
  useFileProcessingEvents,
  type UseFileProcessingEventsOptions,
} from './useFileProcessingEvents';
export {
  useFileDeleteEvents,
  type UseFileDeleteEventsOptions,
} from './useFileDeleteEvents';

// Hooks (Batch Upload Pipeline)
export {
  useBatchUpload,
  type UseBatchUploadReturn,
} from './useBatchUpload';
export {
  useBlobUpload,
  type BlobUploadFile,
  type BlobUploadResult,
} from './useBlobUpload';
export { useFileConfirm } from './useFileConfirm';
export { useDuplicateResolution } from './useDuplicateResolution';
export {
  useFolderDuplicateResolution,
  type FolderDuplicateResolutionResult,
} from './useFolderDuplicateResolution';
export {
  useUploadProgress,
  computeBatchProgress,
  type UploadProgress,
  type UploadCounts,
  type UploadPhase,
} from './useUploadProgress';
