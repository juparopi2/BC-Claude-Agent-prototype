/**
 * Files Domain - Hooks
 *
 * Re-exports all file-related React hooks.
 *
 * @module domains/files/hooks
 */

export { useFileSelection, type UseFileSelectionReturn } from './useFileSelection';
export { useFiles, type UseFilesReturn } from './useFiles';
export { useFileUpload, type UseFileUploadReturn } from './useFileUpload';
export { useFolderUpload, type UseFolderUploadReturn } from './useFolderUpload';
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
export {
  useFolderBatchEvents,
  type UseFolderBatchEventsOptions,
} from './useFolderBatchEvents';
export {
  useFolderUploadToasts,
  type UseFolderUploadToastsOptions,
} from './useFolderUploadToasts';

// V2 Hooks (Batch Upload Pipeline)
export {
  useBatchUploadV2,
  type UseBatchUploadV2Return,
  useBlobUploadV2,
  type BlobUploadFile,
  type BlobUploadResult,
  useFileConfirmV2,
  useDuplicateResolutionV2,
  useUploadProgressV2,
  type UploadProgressV2,
  type UploadCountsV2,
  type UploadPhaseV2,
} from './v2';
